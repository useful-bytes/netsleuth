var http = require('http'),
	https = require('https'),
	util = require('util'),
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
	self.reqid = 0;
	self.silenceTimeout = opts.silenceTimeout || (1000 * 60 * 2);
	self.pingFreq = opts.pingFreq || 120000;

	var wss = self.wss = new WebSocket.Server({
		noServer: true
	});


	self.http = http.createServer(handleRequest);
	setupServer(self.http);

	if (opts.https) {
		self.https = https.createServer(opts.https, handleRequest);
		setupServer(self.https);
	}


	function setupServer(server) {
		server.on('upgrade', function(req, socket, head) {
			var reqHost = req.headers.host;

			socket.on('error', function(err) {
				console.error('websocket error', err);
			});

			if (!reqHost) {
				return rawRespond(socket, 400, 'Bad Request (missing host header)', 'Client did not supply the Host header, which well-behaved clients MUST supply.');
			}

			if (reqHost == self.opts.host) {
				if (self.gatewaySocketRequest) {
					if (self.gatewaySocketRequest(req, socket, head)) return;
				}

				if (req.url.substr(0,6) == '/host/') {
					var hostname = getHost(req.url);

					// return rawRespond(socket, 308, 'Permanent Redirect', 'netsleuth websocket location has moved', {
					// 	Location: 'wss://' + hostname + '/.well-known/netsleuth'
					// });

					self.hostRequest(hostname, req, function(err, ok, params) {
						if (err) return rawRespond(socket, 500, 'Internal Server Error', err.message);

						if (ok) {
							wss.handleUpgrade(req, socket, head, function(client) {
								req.headers.host = hostname;
								wss.emit('connection', client, req, params);
							});
						} else {
							params = params || {};
							rawRespond(socket, params.code || 404, params.status || 'Not Found', params.message || '', params.headers);
						}

					});

				} else rawRespond(socket, 404, 'Not Found', 'No WebSocket at ' + req.url);

			} else {
				if (req.url == '/.well-known/netsleuth') {

					self.hostRequest(reqHost, req, function(err, ok, params) {
						if (err) return rawRespond(socket, 500, 'Internal Server Error', err.message);

						if (ok) {
							wss.handleUpgrade(req, socket, head, function(client) {
								wss.emit('connection', client, req, params);
							});
						} else {
							params = params || {};
							rawRespond(socket, params.code || 404, params.status || 'Not Found', params.message || '', params.headers);
						}

					});
				

				} else {
					rawRespond(socket, 501, 'Not Implemented', 'Gateway does not yet support forwarding WebSocket connections.');
				}
			}
			

			
		});

		server.on('checkContinue', function(req, res) {
			handleRequest(req, res, true);
		});

		server.on('checkExpectation', function(req, res) {
			handleRequest(req, res, true);
		});

		server.on('error', function(err) {
			console.error('gateway server error', err);
		});
	}

	function send(ws, msg) {
		if (ws._local) {
			ws.emit('gateway-message', msg);
		} else {
			ws.send(JSON.stringify(msg), function(err) {
				if (err) {
					console.error('SEND ERR', err);
					self.removeHost(ws.nshost);
				}
			});
		}
	}
	function sendBin(ws, id, chunk) {
		if (ws._local) {
			ws.emit('req-data', id, chunk);
		} else {
			var header = Buffer.allocUnsafe(4);
			header.writeUInt32LE(id, 0, true);
			ws.send(Buffer.concat([header, chunk], chunk.length + 4));
		}
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

			case 'err':
				respond(self.ress[msg.id], 502, 'Bad Gateway', 'Network error communicating with target:\r\n\r\n' + msg.msg);
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

			case 'block':
				host.blocks = msg.urls.map(function(str) {
					if (str.substr(0, 4) == 'rex:') return new RegExp(str.substr(4));
					else return new RegExp(str.replace(rexEscape, '\\$&').replace(wildcard, '.+'));
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

			case 'inspector':
				self.emit('inspector-connected', host, msg.id);
				break;
		}
	}

	function handleClose(host) {
		
		for (var id in host.ress) {
			respond(host.ress[id], 502, 'Bad Gateway', 'Inspector disconnected during request');
		}

		self.removeHost(host);
	}

	wss.on('connection', function(ws, req, params) {
		var hostname = req.headers.host;
		var host = ws.nshost = self.hosts[hostname] = {
			type: 'remote',
			name: hostname,
			ua: req.headers['user-agent'],
			ws: ws,
			ress: {},
			opts: {},
			throttle: {},
			blocks: [],
			uaOverride: '',
			lastSeen: Date.now()
		};

		if (params) for (var k in params) host[k] = params[k];

		ws.on('message', function(data) {

			if (typeof data == 'string') {
				try {
					var msg = JSON.parse(data);
				} catch(ex) {
					self.removeHost(host)
				}
				// console.log(msg);
				// if (msg.id && (!self.ress[msg.id] || self.ress[msg.id].nshost != host)) self.removeHost(host);
				// else handleMsg(host, msg, data);
				handleMsg(host, msg, data);
			} else {
				var id = data.readUInt32LE(0);
				var res = self.ress[id];
				if (res) {
					if (res.nshost != host) return self.removeHost(host);
					res.write(data.slice(4));
					res.bytes += data.length;
					res.expires = Date.now() + self.silenceTimeout;
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

		send(host.ws, {
			m: 'cfg',
			ping: self.pingFreq
		});

	});

	self.on('local-inspector', function(host) {

		host.inspector.on('inspector-message', function(msg) {
			handleMsg(host, msg);
		});

		host.inspector.on('res-data', function(id, chunk) {
			self.ress[id].write(chunk);
			self.ress[id].bytes += chunk.length;
		});

		host.inspector.on('close', function() {
			handleClose(host);
		});
	});







	function handleRequest(req, res, hasExpectation) {
		var hostname = req.headers.host,
			host = self.hosts[hostname];

		if (!hostname) {
			return respond(res, 400, 'Bad Request (missing host header)', 'Client did not supply the Host header, which well-behaved clients MUST supply.');
		}
		if (self.apps[hostname]) return self.apps[hostname](req, res);

		if (self.opts.handleRequest) {
			if (self.opts.handleRequest(req, res)) return;
		}

		if (req.url == '/robots.txt') {
			return respond(res, 200, 'OK', 'User-agent: *\r\nDisallow: /\r\nNoindex: /\r\nNofollow: /\r\n', {
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
					return respond(res, 401, 'Authorization Required', 'This host requires authorization to make requests.', {
						'WWW-Authenticate': 'Basic realm="netsleuth host ' + hostname + '"'
					});
				}
			}

			if (host.throttle.off) {
				return respond(res, 503, 'Service Unavialable', 'Currently set to offline mode.');
			}

			if (host.blocks.length) {
				for (var i = 0; i < host.blocks.length; i++) {
					if (host.blocks[i].test(hostname + req.url)) {
						respond(res, 450, 'Request Blocked', 'This request URL matched an active request blocking pattern: ' + host.blocks[i].toString());
						checkOpen() && send(host.ws, {
							m: 'blocked',
							id: id,
							method: req.method,
							url: req.url,
							headers: req.headers,
							raw: req.rawHeaders
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


			if (checkOpen()) {
				send(host.ws, {
					m: 'r',
					id: id,
					remoteIP: remote,
					remotePort: req.socket.remotePort,
					proto: proto,
					method: req.method,
					url: req.url,
					headers: req.headers,
					raw: req.rawHeaders
				});

				var now = Date.now();
				res.ackBy = now + 10000;
				res.expires = now + self.silenceTimeout;
			} else {
				respond(res, 502, 'Bad Gateway', 'Inspector not connected.');
			}

			req.on('error', function(err) {
				checkOpen() && send(host.ws, {
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
				checkOpen() && sendBin(host.ws, id, chunk);
				res.expires = Date.now() + self.silenceTimeout;
			});

			req.on('end', function() {
				checkOpen() && send(host.ws, {
					m: 'e',
					id: id
				});
			});

		} else {
			if (self.apps.default) self.apps.default(req, res);
			else respond(res, 503, 'Service Unavailable', 'The host "' + hostname + '" does not have an active destination.');
		}

		function checkOpen() {
			if ((host.ws && host.ws.readyState == WebSocket.OPEN) || host.type == 'local') return true;
			else respond(res, 502, 'Bad Gateway', 'Inspector disconnected during request');
		}
	}



	function respond(res, code, status, message, headers) {
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
	}

	self.reaper = setInterval(function() {
		var now = Date.now();
		for (var id in self.ress) {
			var res = self.ress[id];
			if (res.ackBy && res.ackBy < now) {
				respond(res, 504, 'Gateway Timeout', 'Request timed out.  The inspector did not acknowledge this request.');
				if (res.nshost) {
					self.removeHost(res.nshost);
				}
			}
			else if (res.expires < now) {
				respond(res, 504, 'Gateway Timeout', 'Request timed out.');
				if (res.nshost && res.nshost.ws.readyState == WebSocket.OPEN) send(res.nshost.ws, {
					m: 'err',
					id: res._id,
					t: 'timeout'
				});
			}
		}
	}, 10000);

}

util.inherits(GatewayServer, EventEmitter);

GatewayServer.prototype.hostRequest = function(host, req, cb) {
	if (this.hosts[host]) cb(null, false, {
		code: 409,
		status: 'Conflict',
		message: '"' + host + '" is currently in use.'
	});
	else cb(null, true);
};

GatewayServer.prototype.inspect = function(name) {
	var self = this,
		inspector = new LocalInspectorInstance(name, self);

	if (typeof name != 'string') {
		throw new Error('Inspector name must be a string');
	}

	var host = {
		type: 'local',
		ws: inspector,
		name: name,
		inspector: inspector,
		ress: {},
		opts: {},
		throttle: {},
		blocks: [],
		uaOverride: ''
	};

	self.hostRequest(name, null, function(err, ok, params) {
		process.nextTick(function() {
			if (err) return inspector.emit('error', err);
			if (!ok) return inspector.emit('error', new Error(params.message));

			self.hosts[name] = host;

			self.emit('local-inspector', host);
			inspector.emit('ready');
		});
	});

	return inspector;
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

		if (host.ws) host.ws.terminate();

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




function LocalInspectorInstance(host, gateway) {
	EventEmitter.call(this);
	this.host = host;
	this.gateway = gateway;
	this.readyState = WebSocket.OPEN;
	this._local = true;
	this.ress = {};
}
util.inherits(LocalInspectorInstance, EventEmitter);

LocalInspectorInstance.prototype.close = function() {
	this.gateway.close();
	this.emit('close');
};

exports = module.exports = GatewayServer;
