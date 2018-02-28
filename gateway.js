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
	self.blocks = [];
	self.uaOverride = '';
	self.throttle = {};

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

			if (!reqHost) {
				return rawRespond(socket, 400, 'Bad Request (missing host header)', 'Client did not supply the Host header, which well-behaved clients MUST supply.');
			}

			if (reqHost == self.opts.host) {
				var hostname = getHost(req.url);

				if (self.gatewaySocketRequest) {
					if (self.gatewaySocketRequest(req, socket, head)) return;
				}

				if (hostname) {
					self.hostRequest(hostname, req, function(err, ok, params) {
						if (err) return rawRespond(500, 'Internal Server Error', err.message);

						if (ok) {
							wss.handleUpgrade(req, socket, head, function(client) {
								if (params) for (var k in params) client[k] = params[k];
								wss.emit('connection', client, req);
							});
						} else {
							params = params || {};
							rawRespond(socket, params.code || 404, params.status || 'Not Found', params.message || '', params.headers);
						}

					});
				} else rawRespond(socket, 404, 'Not Found', 'No WebSocket at ' + req.url);
			} else {
				rawRespond(socket, 501, 'Not Implemented', 'Gateway does not yet support forwarding WebSocket connections.');
			}
			

			
		});
	}

	function send(ws, msg) {
		if (ws._local) {
			ws.emit('gateway-message', msg);
		} else {
			ws.send(JSON.stringify(msg), function(err) {
				if (err) {
					console.error('SEND ERR', err);
					ws.terminate();
				}
			});
		}
	}
	function sendBin(ws, id, chunk) {
		if (ws._local) {
			ws.emit('req-data', id, chunk);
		} else {
			var header = new Buffer(4);
			header.writeUInt32LE(id, 0, true);
			ws.send(Buffer.concat([header, chunk], chunk.length + 4));
		}
	}


	function handleMsg(host, ws, msg, originalMsg) {
		switch (msg.m) {
			case 'ready':
				self.emit('host-ready', host, ws);
				break;

			case 'err':
				respond(self.ress[msg.id], 502, 'Bad Gateway', 'Network error communicating with target:\r\n\r\n' + msg.msg);
				break;

			case 'res':
				var res = self.ress[msg.id];
				if (res) {
					if (originalMsg) res.bytes += originalMsg.length;
					else res.bytes += JSON.stringify(msg).length;
					res.writeHead(msg.sc, msg.sm, msg.headers);
				}
				break;

			case 'rese':
				var res = self.ress[msg.id];
				if (res) {
					res.end();
					self.emit('response-complete', ws, res);
					delete self.ress[msg.id];
					delete ws.ress[msg.id];
				}
				break;

			case 'block':
				self.blocks = msg.urls.map(function(str) {
					if (str.substr(0, 4) == 'rex:') return new RegExp(str.substr(4));
					else return new RegExp(str.replace(rexEscape, '\\$&').replace(wildcard, '.+'));
				});
				break;

			case 'ua':
				self.uaOverride = msg.ua;
				break;

			case 'throttle':
				self.throttle = msg;
				break;

			case 'inspector':
				self.emit('inspector-connected', ws, msg.id);
				break;
		}
	}

	function handleClose(ws, host) {
		delete self.hosts[host];
		
		for (var id in ws.ress) {
			respond(ws.ress[id], 502, 'Bad Gateway', 'Inspector disconnected during request');
		}

		self.emit('host-offline', host);
	}

	wss.on('connection', function(ws, req) {
		var host = getHost(req.url);
		self.hosts[host] = ws;
		ws.ress = {};

		ws.on('message', function(data) {
			if (typeof data == 'string') {
				var msg = JSON.parse(data);
				handleMsg(host, ws, msg, data);
			} else {
				var id = data.readUInt32LE(0);
				self.ress[id].write(data.slice(4));
				self.ress[id].bytes += data.length;
			}
		});

		ws.on('close', function() {
			handleClose(ws, host);
		});

		self.emit('host-online', host, ws);

	});

	self.on('local-inspector', function(inspector, host) {

		inspector.on('inspector-message', function(msg) {
			handleMsg(host, inspector, msg);
		});

		inspector.on('res-data', function(id, chunk) {
			self.ress[id].write(chunk);
			self.ress[id].bytes += chunk.length;
		});

		inspector.on('close', function() {
			handleClose(inspector, host);
		});
	});







	function handleRequest(req, res) {
		var host = req.headers.host,
			ws = self.hosts[host];

		if (!host) {
			return respond(res, 400, 'Bad Request (missing host header)', 'Client did not supply the Host header, which well-behaved clients MUST supply.');
		}
		if (self.apps[host]) return self.apps[host](req, res);


		if (ws) {

			var id = ++self.reqid;
			res._id = id;
			self.ress[id] = ws.ress[id] = res;
			res.ws = ws;

			// 12 for " HTTP/1.1\r\n", 4 for ": " and "\r\n" in header lines, and final 4 for "\r\n\r\n" at end of headers
			res.bytes = req.method.length + req.url.length + 12 + req.rawHeaders.join('    ').length + 4;

			if (self.throttle.off) {
				return respond(res, 503, 'Service Unavialable', 'Currently set to offline mode.');
			}

			if (self.blocks.length) {
				for (var i = 0; i < self.blocks.length; i++) {
					if (self.blocks[i].test(host + req.url)) {
						respond(res, 450, 'Request Blocked', 'This request URL matched an active request blocking pattern: ' + self.blocks[i].toString());
						checkOpen() && send(ws, {
							m: 'blocked',
							id: ++self.reqid,
							method: req.method,
							url: req.url,
							headers: req.headers,
							raw: req.rawHeaders
						});
						return;
					}
				}
			}

			if (self.uaOverride) {
				req.headers['user-agent'] = self.uaOverride;
			}

			var proto = req.socket.encrypted ? 'https' : 'http',
				remote;

			if (req.socket.remoteFamily == 'IPv6') remote = '[' + req.socket.remoteAddress + ']';
			else remote = req.socket.remoteAddress;


			if (!self.opts.noForwarded) {
				var fwd = req.headers['forwarded'];
				if (fwd) fwd += ',';
				else fwd = '';

				req.headers['forwarded'] = fwd + 'for="' + remote + ':' + req.socket.remotePort + '";host="' + host + '";proto=' +  proto;
				res.bytes += req.headers['forwarded'].length + 13; // "forwarded: " + "\r\n"
			}


			checkOpen() && send(ws, {
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

			req.on('error', function(err) {
				checkOpen() && send(ws, {
					m: 'err',
					id: msg.id
				});
				self.emit('response-complete', ws, res);
				delete self.ress[id];
				delete ws.ress[id];
			});

			req.on('data', function(chunk) {
				res.bytes += chunk.length;
				checkOpen() && sendBin(ws, id, chunk);
			});

			req.on('end', function() {
				checkOpen() && send(ws, {
					m: 'e',
					id: id
				});
			});

		} else {
			if (self.apps.default) self.apps.default(req, res);
			else respond(res, 503, 'Service Unavailable', 'The host "' + host + '" does not have an active destination.');
		}

		function checkOpen() {
			if (ws.readyState == WebSocket.OPEN) return true;
			else respond(res, 502, 'Bad Gateway', 'Inspector disconnected during request');
		}
	}



	function respond(res, code, status, message) {
		if (res) {	
			if (res.headersSent) {
				if (res.socket) res.socket.destroy();
			} else {
				var msg = new Buffer(message);
				res.writeHead(code, status, {
					'Connection': 'close',
					'Content-Type': 'text/plain',
					'Content-Length': msg.length
				});
				res.end(msg);
			}

			if (res.ws) {
				self.emit('response-complete', res.ws, res);
				delete self.ress[res.id];
				delete res.ws.ress[res.id];
			}
		}
	}

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

GatewayServer.prototype.inspect = function(host) {
	var self = this,
		inspector = new LocalInspectorInstance(host, self);

	if (typeof host != 'string') {
		debugger;
		throw new Error('Host must be a string');
	}

	self.hostRequest(host, null, function(err, ok, params) {
		process.nextTick(function() {
			if (err) return inspector.emit('error', err);
			if (!ok) return inspector.emit('error', new Error(params.message));

			self.hosts[host] = inspector;

			self.emit('local-inspector', inspector, host);
			inspector.emit('ready');
		});
	});

	return inspector;
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
	this.emit('close');
};

exports = module.exports = GatewayServer;