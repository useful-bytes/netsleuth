var http = require('http'),
	https = require('https'),
	util = require('util'),
	url = require('url'),
	EventEmitter = require('events'),
	WebSocket = require('ws'),
	rawRespond = require('./lib/raw-respond');

var rexEscape = /([\\^$.|?*+()\[\]{}])/g, wildcard = /\\\*/g;

function GatewayServer(opts) {
	EventEmitter.call(this);
	var self = this;
	opts = opts || {};
	self.opts = opts;
	self.apps = {};
	self.hosts = {};
	self.ress = {};
	self.ws = {};
	self.reqid = 0;
	self.silenceTimeout = opts.silenceTimeout || (1000 * 60 * 2);
	self.pingFreq = opts.pingFreq || 120000;
	self.localCA = opts.localCA;

	var wss = self.wss = new WebSocket.Server({
		noServer: true
	});


	self.http = http.createServer();
	setupServer(self.http);

	if (opts.https) {
		self.https = https.createServer(opts.https);
		setupServer(self.https);
	}

	if (opts.forwardProxy) {
		self.fwdhttps = {}; // see handleConnect
		self.setupProxy(self.fwdhttp = http.createServer());
	}


	function setupServer(server) {
		server.on('request', function(req, res) {
			self.handleRequest(req, res);
		});

		server.on('upgrade', function(req, socket, head) {
			var reqHost = req.headers.host;

			// Attach an error handler now so that socket errors that happen before the upgrade is completed
			// do not bring down the process.  Remove this right before calling handleUpgrade() (which attaches its own error handler)
			socket.on('error', function(err) {
				// noop
			});

			if (!reqHost) {
				return rawRespond(socket, 400, 'Bad Request (missing host header)', 'Client did not supply the Host header, which well-behaved clients MUST supply.');
			}

			if (reqHost == self.opts.host) {
				if (self.gatewaySocketRequest) {
					if (self.gatewaySocketRequest(req, socket, head)) return;
				}
				
				rawRespond(socket, 404, 'Not Found', 'No WebSocket at ' + req.url);

			} else {
				if (opts.remoteInspection !== false && req.url == '/.well-known/netsleuth') {

					self.hostRequest(reqHost, req, function(err, ok, params) {
						if (err) return rawRespond(socket, 500, 'Internal Server Error', err.message);

						if (ok) {
							socket.removeAllListeners('error');
							wss.handleUpgrade(req, socket, head, function(client) {
								wss.emit('connection', client, req, params);
							});
						} else {
							params = params || {};
							rawRespond(socket, params.code || 404, params.status || 'Not Found', params.message || '', params.headers);
						}

					});
				

				} else {
					self.handleWs(req, socket, head);
				}
			}
			

			
		});

		server.on('connect', function(req, socket, head) { // http CONNECT method
			self.handleConnect(req, socket, head);			
		});

		server.on('checkContinue', function(req, res) {
			self.handleRequest(req, res, true);
		});

		server.on('checkExpectation', function(req, res) {
			self.handleRequest(req, res, true);
		});

		server.on('error', function(err) {
			console.error('gateway server error', err);
		});
	}



	function handleMsg(host, msg, originalMsg) {
		var now = Date.now();
		host.lastSeen = now;

		switch (msg.m) {
			case 'cfg':
				if (typeof msg.opts == 'object') {
					var hopts = host.opts = msg.opts;
					if (hopts.auth) {
						hopts.auth = 'Basic ' + Buffer.from(hopts.auth.user + ':' + hopts.auth.pass).toString('base64');
					}
				}
				self.emit('host-cfg', host, msg);
				break;

			case 'ready':
				self.emit('host-ready', host);
				break;

			case 'ack':
				var res = self.ress[msg.id];
				if (res) res.ackBy = null;
				break;

			case 'bad':
				self.respond(self.ress[msg.id], 400, 'Bad Request', msg.msg);
				break;

			case 'err':
				self.respond(self.ress[msg.id], 502, 'Bad Gateway', 'Network error communicating with target:\r\n\r\n' + msg.msg);
				break;

			case 'cont':
				var res = self.ress[msg.id];
				if (res) {
					res.writeContinue();
				}
				break;

			case 'res':
				var res = self.ress[msg.id];
				if (res) {
					if (originalMsg) res.bytes += originalMsg.length;
					else res.bytes += JSON.stringify(msg).length;
					if (host.noCache) {
						msg.headers['cache-control'] = 'no-store';
					}
					res.writeHead(msg.sc, msg.sm, msg.headers);
					res.expires = now + self.silenceTimeout;
				}
				break;

			case 'rese':
				var res = self.ress[msg.id];
				if (res) {
					res.end();
					self.emit('response-complete', host, res);
					delete self.ress[msg.id];
					delete host.ress[msg.id];
				}
				break;

			case 'info':
				var res = self.ress[msg.id];
				if (res && msg.sc >= 100 && msg.sc < 200) {
					// abuse http.ServerResponse to generate the informational headers
					var ires = new http.ServerResponse({});
					ires.sendDate = false; // prevents ServerResponse from adding a `Date` header
					ires._removedConnection = true; // prevents ServerResponse from adding a `Connection` header
					ires.writeHead(msg.sc, msg.sm, msg.headers);
					res._writeRaw(ires._header, 'ascii');
				}
				break;

			case 'rblock':
				self.respond(self.ress[msg.id], 450, 'Request Blocked', 'This request was blocked by script.');
				break;

			case 'block':
				host.blocks = msg.urls.map(function(str) {
					var rex;
					if (opts.regexBlockRules !== false && str.substr(0, 4) == 'rex:') rex = new RegExp(str.substr(4));
					else rex = new RegExp(str.replace(rexEscape, '\\$&').replace(wildcard, '.+'));
					rex.src = str;
					return rex;
				});
				break;

			case 'ua':
				host.uaOverride = msg.ua;
				break;

			case 'throttle':
				host.throttle = msg;
				break;

			case 'no-cache':
				host.noCache = msg.val;


			case 'wsupg':
				var info = self.ws[msg.id];
				if (info) info.resHeaders = msg.headers;
				break;

			case 'wsopen':
				var info = self.ws[msg.id];
				if (!info) return;

				info.socket.removeAllListeners('error');
				wss.handleUpgrade(info.req, info.socket, info.head, function(ws) {
					// TODO: we're not passing any extra upgrade response headers back to clients
					// wss emits headers(headers, req)

					info.ws = ws;

					// ws automatically responds to pings, which we do not want
					ws._receiver.removeAllListeners('ping');
					ws._receiver.on('ping', function(data) {
						ws.emit('ping', data);
					});


					ws.on('message', function(data) {
						if (typeof data == 'string') {
							self.send(host.ws, {
								m: 'wsm',
								id: msg.id,
								d: data
							});
						} else {
							self.sendBin(host.ws, 3, msg.id, data);
						}
					});

					ws.on('close', function() {
						self.send(host.ws, {
							m: 'wsclose',
							id: msg.id
						});
						delete self.ws[msg.id];
						if (host.wsconn) delete host.wsconn[msg.id];
						info.ws = null;
					});

					ws.on('error', function(err) {
						console.error('ws prox err', err);
					});

					ws.on('ping', function(data) {
						self.send(host.ws, {
							m: 'wsping',
							id: msg.id,
							d: data
						});
					});

					ws.on('pong', function(data) {
						self.send(host.ws, {
							m: 'wspong',
							id: msg.id,
							d: data
						});
					});
				});

				break;

			case 'wsm':
				var info = self.ws[msg.id];
				if (info && info.ws) info.ws.send(msg.d);
				break;

			case 'wsping':
				var info = self.ws[msg.id];
				if (info && info.ws) info.ws.ping(msg.d);
				break;

			case 'wspong':
				var info = self.ws[msg.id];
				if (info && info.ws) info.ws.pong(msg.d);
				break;

			case 'wsclose':
				var info = self.ws[msg.id];
				if (info && info.ws) info.ws.close();
				break;

			case 'wserr':
				var info = self.ws[msg.id];
				if (info) {
					delete self.ws[msg.id];
					delete host.wsconn[msg.id];

					// TODO: we should pass the server's HTTP response body back to clients instead of being lazy and doing this

					delete msg.headers.connection;
					delete msg.headers['content-type'];
					delete msg.headers['content-length'];
					rawRespond(info.socket, msg.code, msg.msg, 'netsleuth failed to establish a WebSocket connection with the target because it responded HTTP ' + msg.code + ' ' + msg.msg + '.', msg.headers);
				}
				break;

			case 'inspector':
				self.emit('inspector-connected', host, msg.id);
				break;
		}
	}

	function handleClose(host) {
		
		for (var id in host.ress) {
			self.respond(host.ress[id], 502, 'Bad Gateway', 'Inspector disconnected during request');
		}

		for (var id in host.wsconn) {
			var info = host.wsconn[id];
			if (info.ws) info.ws.close();
			else if (info.socket) info.socket.destroy();
			delete self.ws[id];
		}
		host.wsconn = null;

		self.removeHost(host);
	}

	wss.on('connection', function(ws, req, params) {
		var hostname = req.headers.host;
		if (hostname == '*') return ws.close();
		var host = ws.nshost = self.hosts[hostname] = new GatewayHost(hostname, 'remote', ws);
		host.ua = req.headers['user-agent'];

		if (params) for (var k in params) host[k] = params[k];

		ws.on('message', function(data) {

			if (typeof data == 'string') {
				try {
					var msg = JSON.parse(data);
					handleMsg(host, msg, data);
				} catch(ex) {
					console.error('error handling', msg || data, ex);
					self.removeHost(host);
				}
			} else {
				var type = data.readUInt8(0),
					id = data.readUInt32LE(1);
				var res = self.ress[id];
				if (res) {
					if (res.nshost != host) return self.removeHost(host);
					res.write(data.slice(5));
					res.bytes += data.length;
					res.expires = Date.now() + self.silenceTimeout;
				} else {
					var info = self.ws[id];
					if (info) {
						var payload = data.slice(5);
						info.ws.send(payload);
					}
				}
			}
		});

		ws.on('pong', function() {
			host.lastSeen = Date.now();
		});

		ws.on('close', function() {
			handleClose(host);
		});

		ws.on('error', function(err) {
			// no-op -- the `close` event will fire right after this
		});

		self.emit('host-online', host);

		self.send(host.ws, {
			m: 'cfg',
			ping: self.pingFreq
		});

	});

	self.on('local-inspector', function(host) {

		host.ws.on('inspector-message', function(msg) {
			handleMsg(host, msg);
		});

		host.ws.on('inspector-data', function(type, id, chunk) {
			if (type == 2 && self.ress[id]) {
				self.ress[id].write(chunk);
				self.ress[id].bytes += chunk.length;
			} else if (type == 3 && self.ws[id]) {
				self.ws[id].ws.send(chunk);
			}
		});

		host.ws.on('close', function() {
			handleClose(host);
		});
	});



	self.reaper = setInterval(function() {
		var now = Date.now();
		for (var id in self.ress) {
			var res = self.ress[id];
			if (res.ackBy && res.ackBy < now) {
				self.respond(res, 504, 'Gateway Timeout', 'Request timed out.  The inspector did not acknowledge this request.');
				if (!opts.forwardProxy && res.nshost) {
					self.removeHost(res.nshost);
				}
			}
			else if (res.expires < now) {
				self.respond(res, 504, 'Gateway Timeout', 'Request timed out.');
				if (res.nshost && res.nshost.ws.readyState == WebSocket.OPEN) self.send(res.nshost.ws, {
					m: 'err',
					id: res._id,
					t: 'timeout'
				});
			}
		}
	}, 10000);

}

util.inherits(GatewayServer, EventEmitter);

GatewayServer.prototype.respond = function(res, code, status, message, headers) {
	var self = this;
	if (res) {	
		if (res.headersSent) {
			if (res.socket) res.socket.destroy();
		} else {
			var msg = Buffer.from(message);
			headers = headers || {};
			headers.Connection = 'close';
			headers['Content-Type'] = 'text/plain';
			headers['Content-Length'] = msg.length;
			
			res.writeHead(code, status, headers);
			res.end(msg);
		}

		if (res.nshost) {
			self.emit('response-complete', res.nshost, res);
			delete self.ress[res._id];
			delete res.nshost.ress[res._id];
		}
	}
};


GatewayServer.prototype.send = function(ws, msg) {
	var self = this;
	if (ws._local) {
		ws.emit('gateway-message', msg);
	} else {
		ws.send(JSON.stringify(msg), function(err) {
			if (err) self.removeHost(ws.nshost);
		});
	}
};
GatewayServer.prototype.sendBin = function(ws, type, id, chunk) {
	var self = this;
	if (ws._local) {
		ws.emit('gateway-data', type, id, chunk);
	} else {
		var header = Buffer.allocUnsafe(5);
		header.writeUInt8(type, 0, true);
		header.writeUInt32LE(id, 1, true);
		ws.send(Buffer.concat([header, chunk], chunk.length + 5), function(err) {
			if (err) self.removeHost(ws.nshost);
		});
	}
};


GatewayServer.prototype.handleRequest = function(req, res, hasExpectation) {
	var self = this,
		hostname = req.headers.host,
		host;

	if (self.opts.forwardProxy || !hostname) {
		host = self.hosts['*'];
		if (!host) return self.respond(res, 400, 'Bad Request (missing host header)', 'Client did not supply the Host header, which well-behaved clients MUST supply.');
	} else {
		host = self.hosts[hostname] || self.hosts['*'];
	}

	// if (!host) {
	// 	var p = hostname.indexOf(':');
	// 	if (p > 0) {
	// 		var port = hostname.substr(p+1);
	// 		host = self.hosts['*:' + port];
	// 	}
	// }

	if (self.apps[hostname]) return self.apps[hostname](req, res);

	if (self.opts.handleRequest) {
		if (self.opts.handleRequest(req, res)) return;
	}

	if (req.url == '/robots.txt') {
		return self.respond(res, 200, 'OK', 'User-agent: *\r\nDisallow: /\r\nNoindex: /\r\nNofollow: /\r\n', {
			'Cache-Control': 'public, max-age=2592000'
		});
	}

	if (host) {

		var id = ++self.reqid;
		res._id = id;
		self.ress[id] = host.ress[id] = res;
		res.nshost = host;

		// 12 for " HTTP/1.1\r\n", 4 for ": " and "\r\n" in header lines, and final 4 for "\r\n\r\n" at end of headers
		res.bytes = req.method.length + req.url.length + 12 + req.rawHeaders.join('    ').length + 4;

		if (host.opts.auth) {
			if (req.headers.authorization == host.opts.auth) {
				delete req.headers.authorization;
			} else if (req.headers['proxy-authorization'] == host.opts.auth) {
				delete req.headers['proxy-authorization']
			} else {
				return self.respond(res, 401, 'Authorization Required', 'This host requires authorization to make requests.', {
					'WWW-Authenticate': 'Basic realm="netsleuth host ' + hostname + '"'
				});
			}
		}

		if (host.throttle.off) {
			return self.respond(res, 503, 'Service Unavialable', 'Currently set to offline mode.');
		}


		var proto = req.socket.encrypted ? 'https' : 'http',
			remote;

		if (req.socket.remoteFamily == 'IPv6') remote = '[' + req.socket.remoteAddress + ']';
		else remote = req.socket.remoteAddress;


		if (!host.opts.noForwarded && !self.opts.noForwarded) {
			var fwd = req.headers['forwarded'];
			if (fwd) fwd += ',';
			else fwd = '';

			req.headers['forwarded'] = fwd + 'for="' + remote + ':' + req.socket.remotePort + '";host="' + hostname + '";proto=' +  proto;
			res.bytes += req.headers['forwarded'].length + 13; // "forwarded: " + "\r\n"
		}


		if (host.blocks.length) {
			for (var i = 0; i < host.blocks.length; i++) {
				if (host.blocks[i].test(hostname + req.url)) {
					self.respond(res, 450, 'Request Blocked', 'This request URL matched an active request blocking pattern: ' + host.blocks[i].src);
					checkOpen() && self.send(host.ws, {
						m: 'blocked',
						id: id,
						remoteIP: remote,
						remotePort: req.socket.remotePort,
						proto: proto,
						method: req.method,
						url: req.url,
						headers: req.headers,
						raw: req.rawHeaders,
						rule: host.blocks[i].src
					});
					return;
				}
			}
		}

		if (host.uaOverride) {
			req.headers['user-agent'] = host.uaOverride;
		}

		if (host.noCache) {
			req.headers['cache-control'] = 'no-cache';
			delete req.headers['if-none-match'];
			delete req.headers['if-modified-since'];
		}


		if (checkOpen()) {
			var now = Date.now();
			res.ackBy = now + 10000;
			res.expires = now + self.silenceTimeout;

			self.send(host.ws, {
				m: 'r',
				id: id,
				remoteIP: remote,
				remotePort: req.socket.remotePort,
				proto: proto,
				ver: req.httpVersion,
				method: req.method,
				url: req.url,
				headers: req.headers,
				raw: req.rawHeaders
			});
		} else {
			self.respond(res, 502, 'Bad Gateway', 'Inspector not connected.');
		}

		req.on('error', function(err) {
			checkOpen() && self.send(host.ws, {
				m: 'err',
				id: msg.id,
				t: 'req-err',
				msg: err.message
			});
			self.emit('response-complete', host, res);
			delete self.ress[id];
			delete host.ress[id];
		});

		req.on('data', function(chunk) {
			res.bytes += chunk.length;
			checkOpen() && self.sendBin(host.ws, 1, id, chunk);
			res.expires = Date.now() + self.silenceTimeout;
		});

		req.on('end', function() {
			checkOpen() && self.send(host.ws, {
				m: 'e',
				id: id
			});
		});

	} else {
		if (self.apps.default) self.apps.default(req, res);
		else self.respond(res, 503, 'Service Unavailable', 'The host "' + hostname + '" does not have an active destination.');
	}

	function checkOpen() {
		if ((host.ws && host.ws.readyState == WebSocket.OPEN) || host.type == 'local') return true;
		else self.respond(res, 502, 'Bad Gateway', 'Inspector disconnected during request');
	}
};

GatewayServer.prototype.handleWs = function(req, socket, head) {
	var self = this,
		reqHost = req.headers.host;
		host = self.hosts[reqHost] || self.hosts['*'];

	if (!host) return rawRespond(socket, 503, 'Service Unavialable', 'The host "' + reqHost + '" does not have an active destination.');

	var id = ++self.reqid;
	self.ws[id] = host.wsconn[id] = {
		id: id,
		req: req,
		socket: socket,
		head: head
	};


	var proto = req.socket.encrypted ? 'wss' : 'ws',
		remote;

	if (req.socket.remoteFamily == 'IPv6') remote = '[' + req.socket.remoteAddress + ']';
	else remote = req.socket.remoteAddress;

	if (!host.opts.noForwarded && !self.opts.noForwarded) {
		var fwd = req.headers['forwarded'];
		if (fwd) fwd += ',';
		else fwd = '';

		req.headers['forwarded'] = fwd + 'for="' + remote + ':' + req.socket.remotePort + '";host="' + reqHost + '";proto=' +  proto;
	}

	self.send(host.ws, {
		m: 'ws',
		id: id,
		remoteIP: remote,
		remotePort: req.socket.remotePort,
		authority: (req.socket._authority && req.socket._authority.host) || (req.socket._parent && req.socket._parent._authority && req.socket._parent._authority.host),
		proto: proto,
		method: req.method,
		url: req.url,
		headers: req.headers,
		raw: req.rawHeaders
	});
};

GatewayServer.prototype.handleConnect = function(req, socket, head) {
	var self = this;
	if (!self.opts.forwardProxy) return rawRespond(socket, 405, 'Method Not Allowed', 'This server does not allow CONNECT requests.');
	else {
		var authority = url.parse('tcp://' + req.url);

		// We have to sniff out whether this is a plain HTTP or HTTPS connection.
		// WebSocket requests to http origins will be CONNECT to the proxy followed by plain HTTP

		socket.on('error', function(err) {
			console.error('CONNECT err', err);
		});

		socket.on('data', ondata);

		function ondata(data) {

			socket.pause();
			socket.removeListener('data', ondata);
			socket._authority = authority;

			if (data[0] == 22) { // ClientHello

				// Ideally, we wouldn't create a new https server for every host.
				// We do need to know the server hostname so we can present the correct certificate.
				// However, some clients don't send SNI, but we still know the hostname from the CONNECT
				// portion of the exchange.
				// Unfortunately, if we use SNICallback, node will kill SNI-less connections before we ever see them.
				// So, we create a new https.Server with a default cert for each hostname and distribute incoming
				// connections based on what we saw in the CONNECT request.

				if (self.fwdhttps[authority.hostname]) self.fwdhttps[authority.hostname].emit('connection', socket);
				else self.localCA.get(authority.hostname, function(err, tls) {
					if (err) return socket.destroy();
					var mitm = self.fwdhttps[authority.hostname] = https.createServer({
						cert: tls.cert,
						key: tls.key
					});
					self.setupProxy(mitm, true);
					mitm.emit('connection', socket);
				});
			} else {
				self.fwdhttp.emit('connection', socket);
				socket._readableState.flowing = true;
			}

			socket.unshift(data);


		}

		socket.write('HTTP/1.1 200 OK\r\n\r\n');
	}

};

GatewayServer.prototype.setupProxy = function(srv, secure) {
	var self = this;
	srv.on('request', function(req, res) {
		if (secure) req.url = 'https://' + req.socket._parent._authority.host + req.url;
		else req.url = 'http://' + req.socket._authority.host + req.url;
		self.handleRequest(req, res);
	});

	srv.on('upgrade', function(req, socket, head) {
		
		// Attach an error handler now so that socket errors that happen before the upgrade is completed
		// do not bring down the process.
		socket.on('error', function(err) {
			// noop
		});

		self.handleWs(req, socket, head);

	});

	srv.on('error', function(err) {
		console.error(err);
	});
}

function GatewayHost(name, type, connection) {
	this.type = type;
	this.ws = connection;
	this.name = name;
	this.ress = {};
	this.wsconn = {};
	this.opts = {};
	this.throttle = {};
	this.blocks = [];
	this.uaOverride = '';
	this.lastSeen = Date.now();
}

GatewayServer.prototype.hostRequest = function(host, req, cb) {
	if (this.hosts[host]) cb(null, false, {
		code: 409,
		status: 'Conflict',
		message: '"' + host + '" is currently in use.'
	});
	else cb(null, true);
};

GatewayServer.prototype.inspect = function(name, serviceOpts) {
	var self = this,
		msg = new InprocMessenger(name, self);

	if (typeof name != 'string') {
		throw new Error('Inspector name must be a string');
	}

	var host = new GatewayHost(name, 'local', msg);

	if (serviceOpts && serviceOpts.auth) host.opts.auth = 'Basic ' + Buffer.from(serviceOpts.auth.user + ':' + serviceOpts.auth.pass).toString('base64');

	self.hostRequest(name, null, function(err, ok, params) {
		process.nextTick(function() {
			if (err) return inspector.emit('error', err);
			if (!ok) return inspector.emit('error', new Error(params.message));

			self.hosts[name] = host;

			self.emit('local-inspector', host);
			msg.emit('ready');
		});
	});

	return msg;
};

GatewayServer.prototype.removeHost = function(hostname) {
	var self = this,
		host;

	if (typeof hostname == 'string') {
		host = self.hosts[hostname];
	} else if (typeof hostname == 'object') {
		host = hostname;
		hostname = host.name;
	}

	if (host) {
		delete self.hosts[hostname];

		if (host.ws && host.ws.terminate) host.ws.terminate();

		self.emit('host-offline', host);
	}
};

GatewayServer.prototype.close = function() {
	var self = this;
	if (self.http) self.http.close();
	if (self.https) self.https.close();
};

GatewayServer.prototype[util.inspect.custom] = true; // instruct console.log to ignore the `inspect` property



function getHost(url) {
	var path = url.split('/');
	if (path[1] == 'host') return path[2];
}




function InprocMessenger(host, gateway) {
	EventEmitter.call(this);
	this.readyState = WebSocket.OPEN;
	this._local = true;
}
util.inherits(InprocMessenger, EventEmitter);

InprocMessenger.prototype.close = function() {
	this.emit('close');
};

exports = module.exports = GatewayServer;
