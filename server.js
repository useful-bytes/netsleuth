var http = require('http'),
	https = require('https'),
	fs = require('fs'),
	url = require('url'),
	os = require('os'),
	path = require('path'),
	util = require('util'),
	zlib = require('zlib'),
	stream = require('stream'),
	EventEmitter = require('events'),
	request = require('request'),
	clipboardy = require('clipboardy'),
	iltorb = require('iltorb'),
	Iconv = require('iconv').Iconv,
	express = require('express'),
	bodyParser = require('body-parser'),
	WebSocket = require('ws'),
	contentTypeParser = require('content-type-parser'),
	resourceType = require('./resource-type'),
	joinRaw = require('./join-raw'),
	InprocInspector = require('./inproc-inspector'),
	RemoteConsole = require('./remote-console'),
	ResponseBody = require('./response-body'),
	GatewayServer = require('./gateway'),
	rawRespond = require('./lib/raw-respond'),
	version = require('./package.json').version;

var argv = require('yargs').argv;

var app = express();

var wsid = 0;

var DEVTOOLS = path.join(__dirname, 'deps', 'devtools-frontend');

exports = module.exports = InspectionServer;


function missingOpt(name) {
	throw new TypeError('Missing required option: ' + name);
}
function gatewayFromHost(host) {
	host = host.split('.');
	host.splice(0, 1);
	return host.join('.');
}

function GatewayError(status, message) {
	Error.call(this, message);
	this.status = status;
}
util.inherits(GatewayError, Error);

function Inspector(server, opts) {
	var self = this;
	EventEmitter.call(this);
	this.server = server;
	if (opts.host) {
		if (opts.host.indexOf('://') == -1) this.host = url.parse('https://' + opts.host);
		else this.host = url.parse(opts.host);
	}
	if (opts.target) {
		if (opts.target.substr(0, 2) == '//') this.target = url.parse('same:' + opts.target);
		else if (opts.target.indexOf('://') == -1) this.target = url.parse('same://' + opts.target);
		else this.target = url.parse(opts.target);
	} else throw new TypeError('Missing required option: target');

	self.friendlyTarget = self.target.href;
	if (self.friendlyTarget.substr(0, 5) == 'same:') self.friendlyTarget = self.friendlyTarget.substr(5);

	self.gateway = opts.gateway || gatewayFromHost(this.host.host);
	if (opts.token) {
		self.token = opts.token;
	} else {
		if (server.opts.gateways && server.opts.gateways[self.gateway]) {
			self.token = server.opts.gateways[self.gateway].token;
		}
	}

	this.clients = [];
	this.console = new RemoteConsole(this);
	this.service = null;
	this.serviceState = 0;
	this.serviceError = null;
	this.reqs = {};
	this.buffer = [];
	var ready;


	function send(msg) {
		if (self.service._local) self.service.emit('inspector-message', msg);
		else if (self.service.readyState == WebSocket.OPEN) self.service.send(JSON.stringify(msg));
	}
	function sendBin(id, chunk) {
		if (self.service._local) self.service.emit('res-data', id, chunk);
		else if (self.service.readyState == WebSocket.OPEN) {
			var header = new Buffer(4);
			header.writeUInt32LE(id, 0, true);
			self.service.send(Buffer.concat([header, chunk], chunk.length + 4));
		}
	}

	function handleMsg(msg) {
		switch (msg.m) {
			case 'r':
				msg.headers.host = self.target.host;

				var proto = self.target.protocol;
				if (proto == 'same:') proto = msg.proto + ':';

				var req = (proto == 'https:' ? https : http).request({
					host: self.target.hostname,
					port: parseInt(self.target.port, 10) || (proto == 'https:' ? 443 : 80),
					method: msg.method,
					path: msg.url,
					headers: Object.assign({}, msg.headers, {
						host: self.target.host
					}),
					rejectUnauthorized: opts.insecure ? false : true,
					ca: opts.ca
				});

				var info = self.reqs[msg.id] = {
					proto: proto,
					msg: msg,
					req: req
				};

				req.on('error', function(err) {
					console.error(err);
					if (!msg.replay) {
						send({
							m: 'err',
							id: msg.id,
							msg: err.message
						});
					}
					delete self.reqs[msg.id].req;

					self.broadcast({
						method: 'Network.loadingFailed',
						params: {
							requestId: msg.id,
							timestamp: Date.now() / 1000,
							type: 'Other',
							errorText: err.message
						}
					});

					self.console.error('Unable to ' + msg.method + ' ' + proto + '//' + self.target.host + msg.url + '\n' + err.message, 'network');

				});

				req.on('response', function(res) {

					var loc = res.headers.location;
					if (loc) {

						if (loc.substr(0,2) == '//') loc = msg.proto + ':' + loc;
						var ploc = url.parse(loc);

						if (ploc.host) {
							ploc.host = self.host.host;
						}

						var newLoc = url.format(ploc);
						if (res.headers.location != newLoc) res.headers['x-sleuth-original-location'] = res.headers.location;
						res.headers.location = newLoc;

					}

					if (proto == 'https:') {
						if (!res.socket.authorized && !res.socket.authorizationError) res.socket.authorizationError = '(unknown error)';
						if (!res.socket.authorized && self.insecureError != res.socket.authorizationError) {
							self.insecureError = res.socket.authorizationError;

							self.console.warn('Warning: connection to https://' + self.target.host + ' is not secure!  Certificate validation failed with error ' + res.socket.authorizationError + '.');
							self.broadcast({
								method: 'Gateway.securityState',
								params: {
									insecure: true,
									message: 'TLS error: ' + self.insecureError
								}
							});
						} else if (res.socket.authorized && typeof self.insecureError == 'string') {
							self.insecureError = null;
							self.console.info('The certificate for https://' + self.target.host + ' is now validating.');
							self.broadcast({
								method: 'Gateway.securityState',
								params: {
									insecure: false
								}
							});
						}
					}

					if (!msg.replay) {
						send({
							m: 'res',
							id: msg.id,
							sc: res.statusCode,
							sm: res.statusMessage,
							headers: res.headers,
							raw: res.rawHeaders
						});
					}

					var mime = res.headers['content-type'];
					if (mime) {
						mime = mime.split(';')[0];
					}

					for (var k in res.headers) {
						if (Array.isArray(res.headers[k])) res.headers[k] = res.headers[k].join('\n');
					}

					self.broadcast({
						method: 'Network.responseReceived',
						params: {
							requestId: msg.id,
							loaderId: 'ld',
							timestamp: Date.now() / 1000,
							wallTime: Date.now() / 1000,
							response: {
								protocol: proto,
								url: msg.proto + '://' + self.host.host + msg.url,
								status: res.statusCode,
								statusText: res.statusMessage,
								headers: res.headers,
								headersText: 'HTTP/1.1 ' + res.statusCode + ' ' + res.statusMessage + '\r\n' + joinRaw(res.statusCode, res.statusMessage, res.rawHeaders),
								mimeType: mime,
								requestHeaders: msg.headers,
								requestHeadersText: 'GET ' + msg.url + ' HTTP/1.1\r\n' + joinRaw(msg.raw),
								remoteIPAddress: msg.remoteIP,
								remotePort: msg.remotePort,
								connectionId: msg.id
							},
							type: resourceType(res.headers['content-type'])
						}
					});

					if (res.headers.warning) {
						self.console.warn('Warning from ' + msg.method + ' ' + msg.url + ': ' + res.headers.warning, 'network', msg.id);
					}

					info.resBody = new ResponseBody(msg.id, res);
					info.resHeaders = res.headers;


					res.on('data', function(chunk) {
						info.resBody.append(chunk);
						if (!msg.replay) sendBin(msg.id, chunk);
						self.broadcast({
							method: 'Network.dataReceived',
							params: {
								requestId: msg.id,
								timestamp: Date.now() / 1000,
								dataLength: chunk.length,
								encodedDataLength: chunk.length
							}
						});
					});

					res.on('close', function() {
						if (!msg.replay) {
							send({
								m: 'err',
								id: msg.id,
								msg: 'incomplete response'
							});
						}
						delete self.reqs[msg.id].req;

						self.broadcast({
							method: 'Network.loadingFailed',
							params: {
								requestId: msg.id,
								timestamp: Date.now() / 1000,
								type: 'Other',
								errorText: 'incomplete response'
							}
						});

						self.console.error('Response for ' + msg.method + ' ' + proto + '//' + self.target.host + msg.url + ' terminated prematurely', 'network');

					});

					res.on('end', function() {
						if (res.complete) {
							if (!msg.replay) {
								send({
									m: 'rese',
									id: msg.id,
								});
							}
							self.broadcast({
								method: 'Network.loadingFinished',
								params: {
									requestId: msg.id,
									timestamp: Date.now() / 1000,
									encodedDataLength: info.resBody.data.length
								}
							});
						}
					});
				});


				if ((msg.headers['content-length'] || msg.headers['transfer-encoding'] == 'chunked') && msg.method != 'HEAD') {
					info.reqBody = new Buffer(0);
				}
				
				self.broadcast({
					method: 'Network.requestWillBeSent',
					params: {
						requestId: msg.id,
						loaderId: 'ld',
						documentURL: 'docurl',
						timestamp: Date.now() / 1000,
						wallTime: Date.now() / 1000,
						request: {
							url: msg.proto + '://' + self.host.host + msg.url,
							method: msg.method,
							headers: msg.headers,
							postData: info.reqBody ? '' : undefined
						},
						type: 'Other'
					}
				});

				break;

			case 'e':
				self.reqs[msg.id].req.end();
				break;

			case 'err':
				break;

			case 'cx':
				self.console.error('Your subscription has ended.  Visit https://netsleuth.io/ for more information.');
				self.emit('error', new Error('Subscription cancelled.'));
				break;

			case 'blocked':
				self.console.warn('Blocked request for ' + msg.method + ' ' + msg.headers.host + msg.url, 'network');
				break;

			case 'msg':
				if (self.console[msg.t]) {
					self.console[msg.t](msg.msg);
				} else {
					self.console.log(msg.m);
				}
		}

	}

	var ua = 'netsleuth/' + version + ' (' + os.platform() + '; ' + os.arch() + '; ' + os.release() +') node/' + process.versions.node;

	function connect() {
		var service = self.service = new WebSocket('ws://' + self.gateway + '/host/' + self.host.host, [], {
			headers: {
				Authorization: 'Bearer ' + self.token,
				'User-Agent': ua
			}
		});

		service.on('open', function() {
			self.serviceState = 1;
			self.console.info('Connected to gateway.');
			self.broadcast({
				method: 'Gateway.connectionState',
				params: {
					state: self.serviceState
				}
			});
			if (ready) send({ m: 'ready' });
		});

		service.on('message', function(data) {
			if (typeof data == 'string') {
				var msg = JSON.parse(data);
				handleMsg(msg);

			} else {
				if (data.length > 4) {
					var id = data.readUInt32LE(0);
					self.reqs[id].req.write(data.slice(4));
					self.reqs[id].reqBody = Buffer.concat([self.reqs[id].reqBody, data.slice(4)]);
					self.broadcast({
						method: 'Gateway.updateRequestBody',
						params: {
							id: id,
							body: data.slice(4).toString()
						}
					});
				}
			}


		});


		service.on('error', function(err) {
			if (self.serviceState < 2) {
				console.error('Gateway connection error.', err);
				self.console.error('Gateway connection error: ' + err.message);
			}
		});

		service.on('unexpected-response', function(req, res) {
			// if (res.statusCode >= 400 && res.statusCode <= 403) {

				self.serviceState = 3;
				var err = self.serviceError = new GatewayError(res.statusCode, 'Unable to connect to gateway: ' + res.statusCode + ' ' + res.statusMessage);
				err.status = res.statusCode;
				err.statusMessage = res.statusMessage;

				if (res.headers['content-type'] != 'text/plain' || res.headers['content-length'] > 4096) ignoreResBody();
				else {
					var body = new Buffer(0);

					res.on('data', function(d) {
						body = Buffer.concat([body, d]);
						if (body.length > 4096) ignoreResBody();
					});
					
					res.on('end', function() {
						err.message = body.toString();
						self.emit('error', err);
						service.finalize(true);
					});

					res.on('error', ignoreResBody);
				}

				// if (res.statusCode == 401) err.message += ' Invalid token.  Check your auth token and try again.';
				// if (res.statusCode == 402) err.message += ' You do not have an active subscription.  Visit https://netsleuth.io for more info.';
				// if (res.statusCode == 403) err.message += ' "' + self.host.host + '" is reserved by another user.  Choose a different hostname.';

				// err.message += ' (' + res.statusCode + ')';

				// self.emit('error', err);


				function ignoreResBody() {
					req.abort();
					self.emit('error', err);
					service.finalize(true);
				}
			// }
			// req.abort();
			// service.finalize(true);
		});

		service.on('close', function(code, reason) {
			if (self.serviceState == 1) {
				console.error('Connection to gateway closed.', code, reason);
				self.console.error('Connection to gateway closed. ' + code + ' ' + reason);
			}
			if (self.serviceState != 3) self.serviceState = 2;
			self.broadcast({
				method: 'Gateway.connectionState',
				params: {
					state: self.serviceState,
					message: 'Disconnected from gateway'
				}
			});

			for (var id in self.reqs) {
				if (self.reqs[id].req) {
					self.reqs[id].req.socket.destroy();
					delete self.reqs[id].req;
					self.broadcast({
						method: 'Network.loadingFailed',
						params: {
							requestId: id,
							timestamp: Date.now() / 1000,
							type: 'Other',
							errorText: 'disconnected from gateway during request'
						}
					});
				}
			}
			if (self.serviceState < 3) setTimeout(connect, 5000);
		});
	}


	function checkTarget() {
		var req = (self.target.protocol == 'https:' ? https : http).request({
			host: self.target.hostname,
			port: parseInt(self.target.port, 10) || (self.target.protocol == 'https:' ? 443 : 80),
			method: 'HEAD',
			path: '/',
			headers: {
				Host: self.target.host
			},
			timeout: 5000
		});

		req.on('response', function(res) {
			if (res.statusCode < 500) {
				ready = true;
				send({ m: 'ready' });
			} else setTimeout(checkTarget, 5000);
		});

		req.on('error', function(err) {
			setTimeout(checkTarget, 5000);
		});

		req.end();
	}


	if (self.gateway._local) {
		var lii = self.service = self.gateway;
		lii.on('gateway-message', handleMsg);
		lii.on('req-data', function(id, chunk) {
			self.reqs[id].reqBody = Buffer.concat([self.reqs[id].reqBody, chunk]);
			self.broadcast({
				method: 'Gateway.updateRequestBody',
				params: {
					id: id,
					body: data.toString()
				}
			});
		});

		self.serviceState = 1;

	} else {
		if (self.host) {
			connect();
			checkTarget();
		} else {
			request({
				url: 'https://' + self.gateway + '/hostname',
				headers: {
					Authorization: 'Bearer ' + self.token
				},
				json: true
			}, function(err, res, body) {
				if (err) {
					var e = new Error('Unable to get an autogenerated hostname: ' + err.message);
					e.inner = err;
					return self.emit('error', e);
				}
				if (res.statusCode != 200) return self.emit('error', new GatewayError(res.statusCode, 'Unable to get an autogenerated hostname: HTTP ' + res.statusCode + ' ' + body));

				self.host = url.parse('https://' + body.host);
				server.newRemoteInspector(self);
				connect();
				checkTarget();
			});
		}
	}
		

};
util.inherits(Inspector, EventEmitter);

Inspector.prototype.close = function() {
	if (this.shutdown) return;
	this.shutdown = true;
	this.serviceState = 3;
	if (this.service) this.service.close();
	this.console.warn('This inspector has been removed!');
	this.broadcast({
		method: 'Gateway.close'
	});
	this.clients.forEach(function(ws) {
		ws.close();
	});
};
Inspector.prototype.broadcast = function(msg) {
	var self = this;
	if (self.buffer) {
		self.buffer.push(msg);
	} else {
		msg = JSON.stringify(msg);
		self.clients.forEach(function(ws) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(msg);
			}
		});
	}
};

Inspector.prototype.connection = function(ws, req) {
	var self = this;
	ws.id = ++wsid;
	self.clients.push(ws);

	ws.on('message', function(data) {
		try {
			var msg = JSON.parse(data);
			switch (msg.method) {
				case 'Network.enable':
					reply();
					if (self.serviceState != 1) {
						setTimeout(function() {
							self.console.error('Not connected to gateway.');
							if (self.serviceError) self.console.error(self.serviceError.message);
						}, 100);
					} else {
						send({
							m: 'inspector',
							id: ws.id
						});
					}
					csend({
						method: 'Gateway.connectionState',
						params: {
							state: self.serviceState
						}
					});
					if (self.insecureError) csend({
						method: 'Gateway.securityState',
						params: {
							insecure: true,
							message: 'TLS error: ' + self.insecureError
						}
					});
					break;

				case 'Network.getResponseBody':
					var req = self.reqs[msg.params.requestId];
					var body = req && req.resBody;
					if (body) {

						body.get(function(err, b64, body) {
							if (err) {
								self.console.error('Error getting the response body of ' + req.msg.method + ' ' + req.msg.url + ': ' + err.message);
								csend({
									id: msg.id,
									result: {
										body: '(body not available: ' + err.message + ')',
										base64Encoded: false
									}
								});
							} else {
								csend({
									id: msg.id,
									result: {
										body: body,
										base64Encoded: b64
									}
								});
							}
						});
						// var decoder, ce = req.resHeaders['content-encoding'];

						// if (ce == 'gzip') {
						// 	decoder = zlib.gunzip;
						// } else if (ce == 'inflate') {
						// 	decoder = zlib.inflate;
						// } else if (ce == 'br') {
						// 	decoder = iltorb.decompress;
						// } else {
						// 	decoder = function(b, cb) { cb(null, b); };
						// }

						// decoder(body, function(err, body) {

						// 	if (err) {
						// 		self.console.error('Error decompressing the response body of ' + req.msg.method + ' ' + req.msg.url + ': ' + err.message);
						// 		csend({
						// 			id: msg.id,
						// 			result: {
						// 				body: '(body not available -- decompression error)',
						// 				base64Encoded: false
						// 			}
						// 		});
						// 	} else {
						// 		var b64 = false,
						// 			charset = 'utf-8';

						// 		var ct = contentTypeParser(req.resHeaders['content-type']);
						// 		if (ct) {

						// 			if (ct.type == 'text' || (ct.type == 'application' && ct.subtype == 'json')) {
						// 				var charset = ct.get('charset') || 'windows-1252';

						// 				try {
						// 					var iconv = new Iconv(charset, 'utf-8//TRANSLIT//IGNORE');
						// 					body = iconv.convert(body).toString();

						// 				} catch(ex) {

						// 				}
						// 			} else {
						// 				body = body.toString('base64');
						// 				b64 = true;
						// 			}
						// 		} else {
						// 			body = body.toString('base64');
						// 			b64 = true;
						// 		}



						// 		csend({
						// 			id: msg.id,
						// 			result: {
						// 				body: body,
						// 				base64Encoded: b64
						// 			}
						// 		});
						// 	}


						// });

					} else {
						csend({
							id: msg.id,
							result: {
								body: '(body no longer available -- discarded to save memory)'
							}
						});
					}
					break;

				case 'Network.setBlockedURLs':
					send({
						m: 'block',
						urls: msg.params.urls
					});
					reply();
					break;

				case 'Network.setUserAgentOverride':
					send({
						m: 'ua',
						ua: msg.params.userAgent
					});
					reply();
					break;

				case 'Network.emulateNetworkConditions':
					send({
						m: 'throttle',
						off: msg.params.offline,
						latency: msg.params.latency,
						down: msg.params.downloadThroughput,
						up: msg.params.uploadTHroughput
					});
					reply();
					break;

				case 'Clipboard.write':
					clipboardy.write(msg.params.text);
					break;

				default:
					console.log(msg);
					reply();
			}
		} catch (ex) {
			console.error('Client protocol error:', ex.stack);
		}

		function reply(res) {
			csend({
				id: msg.id,
				result: res || {}
			});
		}
	});

	ws.on('error', function(err) {
		console.error('inspector connection error', err);
	});

	ws.on('close', function() {
		for (var i = 0; i < self.clients.length; i++) {
			if (self.clients[i] == ws) return self.clients.splice(i, 1);
		}
	});

	if (self.buffer) {
		var buf = self.buffer;
		self.buffer = null;
		buf.forEach(function(msg) {
			self.broadcast(msg);
		});
	}

	function csend(msg) {
		ws.send(JSON.stringify(msg));
	}
	function send(msg) {
		if (self.service._local) self.service.emit('inspector-message', msg);
		else self.service.send(JSON.stringify(msg));
	}

};


function InspectionServer(opts) {
	var self = this;
	self.opts = opts = opts || {};
	self.inspectors = {};
	self.monitors = [];

	var app = this.app = express();

	app.use(bodyParser.json());

	app.get('/sleuth', function(req, res) {
		res.send(Object.assign({}, process.versions, {
			sleuth: require('./package.json').version
		}));
	});

	app.get('/json/version', function(req, res) {
		res.send({
			Browser: "node/" + process.versions.node,
			"Protocol-Version": "1.2",
			"User-Agent": "node/" + process.versions.node + ' (' + Object.keys(process.versions).map(function(lib) {
					return lib + ' ' + process.versions[lib];
				}).join(' ') + ')',
			"V8-Version": process.versions.v8,
			"WebKit-Version": "537.36 (@534d5e694425b60df9a2db2df8884681a90b69da)"
		});
	});

	app.use('/inspect', express.static(path.join(__dirname, 'overrides')));
	app.use('/inspect', express.static(DEVTOOLS));
	app.use('/jq', express.static(path.dirname(require.resolve('jquery'))));
	app.use(express.static(__dirname + '/www'));


	app.get('/inspect/:host', function(req, res, next) {
		if (self.inspectors[req.params.host]) res.sendFile(DEVTOOLS + '/inspector.html');
		else next();
	});

	var httpServer = this.http = http.createServer(app),
		ws = this.ws = new WebSocket.Server({
			noServer: true,
			verifyClient: function(info, cb) {
				if (info.req.url == '/targets') return cb(true);

				var host = getInspectorId(info.req.url);
				if (host && host.type == 'inproc') {
					var existing = self.inspectors[host.name];
					if (!existing) cb(true);
					else if (existing instanceof InprocInspector) cb(true);
					else cb(false, 409, 'Conflict');
				}
				else if (host && self.inspectors[host.name]) cb(true);
				else cb(false, 404, 'Not Found');
			}
		});


	function onupgrade(req, socket, head) {
		var origin = req.headers.origin || '';
		if (origin.substr(0,10) != 'netsleuth:' &&
			origin != 'http://localhost:9000' &&
			origin != 'http://127.0.0.1:9000') return rawRespond(socket, 403, 'Forbidden', 'This request must be made from an allowed origin.');

		ws.handleUpgrade(req, socket, head, function(client) {
			if (req.url == '/targets') {
				self.targetMonitorConnection(client, req);
			} else {
				var host = getInspectorId(req.url);
				if (host) {
					if (host.type == 'inproc') {
						if (!self.inspectors[host.name]) self.inspectInproc(host.name, req.headers['sleuth-transient'] == 'true');
						self.inspectors[host.name].target(client, req);
					} else {
						self.inspectors[host.name].connection(client, req);
					}
					client.on('pong', function() {
						client.isAlive = true;
					});
					ws.emit('connection', client, req);
				}
			}
		});
	}

	httpServer.on('upgrade', onupgrade);

	if (opts.https) {
		var httpsServer = this.https = https.createServer(opts.https, app);
		httpsServer.on('upgrade', onupgrade);
	}


};

InspectionServer.prototype.remove = function(host) {
	if (this.inspectors[host]) {
		this.inspectors[host].close();
		this.inspectors[host].removeAllListeners();
		delete this.inspectors[host];
		this.monitorBroadcast({
			m: 'rm',
			host: host
		});
	}
}

InspectionServer.prototype[util.inspect.custom] = true; // instruct console.log to ignore the `inspect` property
InspectionServer.prototype.inspect = function(opts) {
	var inspector = new Inspector(this, opts);

	if (opts.host) {
		this.newRemoteInspector(inspector);
	}

	return inspector;
};

InspectionServer.prototype.newRemoteInspector = function(inspector) {
	this.inspectors[inspector.host.hostname] = inspector;

	var href = inspector.target.href;
	if (href && href.substr(0, 5) == 'same:') href = href.substr(5);

	
	this.monitorBroadcast({
		m: 'new',
		type: 1,
		host: inspector.host.host,
		target: href
	});

	process.nextTick(function() {
		inspector.emit('hostname', inspector.host.host);
	});
};

InspectionServer.prototype.inspectInproc = function(name, transient) {
	var self = this,
		inspector = self.inspectors[name] = new InprocInspector(self);

	if (transient) {
		inspector.on('no-targets', function() {
			self.remove(name);
		});
	}

	self.monitorBroadcast({
		m: 'new',
		type: 2,
		host: name
	});

	return inspector;
};

InspectionServer.prototype.targetMonitorConnection = function(ws, req) {
	var self = this;
	self.monitors.push(ws);

	ws.on('close', function() {
		for (var i = 0; i < self.monitors.length; i++) {
			if (self.monitors[i] == ws) return self.monitors.splice(i, 1);
		}
	});

	ws.on('error', function(err) {
		console.warn('monitor error', err);
	});

	var inspectors = [];
	for (var k in self.inspectors) {
		inspectors.push({
			type: self.inspectors[k] instanceof InprocInspector ? 2 : 1,
			host: k,
			target: self.inspectors[k].friendlyTarget
		});
	}

	ws.send(JSON.stringify({
		m: 'init',
		inspectors: inspectors
	}));
};

InspectionServer.prototype.monitorBroadcast = function(msg) {
	var self = this;
	msg = JSON.stringify(msg);
	for (var i = 0; i < self.monitors.length; i++) {
		if (self.monitors[i].readyState == WebSocket.OPEN) self.monitors[i].send(msg);
	}
};


var availLocal = ipToLong('127.0.0.1'), LOCAL_MAX = ipToLong('127.255.255.255');
InspectionServer.nextLocal = function() {
	var ip = ++availLocal;
	console.log(ip, ipFromLong(ip), ip & 255);
	if ((ip & 255) == 255 || (ip & 255) == 0) return InspectionServer.nextLocal();
	if (ip > LOCAL_MAX) throw new Error('No available loopback IP');
	return ipFromLong(ip);
};

InspectionServer.prototype.inspectOutgoing = function(opts, cb) {
	var self = this,
		gateway = new GatewayServer(opts.gatewayOpts || {
			noForwarded: true
		});

	if (typeof opts == 'string') opts = { target: opts };

	if (!opts || !opts.target) throw new Error('Must specify target host for outgoing inspection');

	var ip = opts.ip || opts.host;

	if (ip) {
		gateway.http.listen(opts.port || 80, ip, function(err) {
			if (err) {
				if (cb) cb(err);
				else self.emit('error', err);
			} else {
				up(ip);
			}
		});
	} else {
		tryListen();
	}

	function tryListen() {
		var ip = InspectionServer.nextLocal();
		console.log('trying', ip);
		gateway.http.listen(opts.port || 80, ip, function(err) {
			if (err) {
				if (err.code == 'EADDRINUSE') tryListen();
				else {
					if (cb) cb(err);
					else self.emit('error', err);
				}
			} else {
				up(ip);
			}
		});
	}

	function up(ip) {
		var inspector = self.inspect({
			host: ip,
			target: opts.target,
			gateway: gateway.inspect(ip)
		});
		if (cb) cb(null, inspector, ip);
	}
};

function ipToLong(ip) {
	var ipl = 0;
	ip.split('.').forEach(function(octet) {
	 	ipl <<= 8;
		ipl += parseInt(octet);
	});
	return(ipl >>> 0);
}

function ipFromLong(ipl) {
	return ((ipl >>> 24) + '.' +
		(ipl >> 16 & 255) + '.' +
		(ipl >> 8 & 255) + '.' +
		(ipl & 255) );
}

InspectionServer.prototype.broadcast = function(msg) {
	msg = JSON.stringify(msg);
	this.ws.clients.forEach(function(client) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(msg);
		}
	});
};

InspectionServer.prototype.close = function() {
	clearInverval(this.wsping);
	this.ws.close();
	this.http.close();
	if (this.https) this.https.close();
};








function getInspectorId(url) {
	var path = url.split('/');
	if (path[1] == 'inspect' || path[1] == 'inproc') return { type: path[1], name: path[2] };
}