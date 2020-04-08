var http = require('http'),
	https = require('https'),
	tls = require('tls'),
	fs = require('fs'),
	os = require('os'),
	url = require('url'),
	path = require('path'),
	util = require('util'),
	crypto = require('crypto'),
	EventEmitter = require('events'),
	request = require('request'),
	clipboardy = require('clipboardy'),
	notifier = require('node-notifier'),
	express = require('express'),
	bodyParser = require('body-parser'),
	WebSocket = require('ws'),
	resourceType = require('./resource-type'),
	RemoteConsole = require('./remote-console'),
	MessageBody = require('./lib/message-body'),
	rawRespond = require('./lib/raw-respond'),
	insensitize = require('./lib/insensitize'),
	serverCert = require('./lib/server-cert'),
	SessionCLI = require('./session-cli'),
	Script = require('./lib/script'),
	Target = require('./lib/target'),
	GatewayTarget = require('./lib/gateway-target'),
	InprocTarget = require('./lib/inproc-target'),
	ReverseProxyTarget = require('./lib/reverse-proxy-target'),
	ForwardProxyTarget = require('./lib/forward-proxy-target'),
	InternalTarget = require('./lib/internal-target'),
	version = require('./package.json').version;

var argv = require('yargs').argv;

var wsid = 0;

var DEVTOOLS = path.join(__dirname, 'deps', 'devtools-frontend'),
	DEVTOOLS_CASE_SENSITIVE = !fs.existsSync(DEVTOOLS + '/InSPECtOR.HtML'),
	UNSAFE = /[\\/:*?"<>|]/g,
	COLON = /:/g;

exports = module.exports = InspectionServer;


function missingOpt(name) {
	throw new TypeError('Missing required option: ' + name);
}
function gatewayFromHost(host) {
	host = host.split('.');
	host.splice(0, 1);
	return host.join('.');
}

function stringVals(obj) {
	var r = {};
	for (var k in obj) r[k] = obj[k].toString();
	return r;
}

var thisHid = getHid();

// An Inspector instance maps roughly to an open GUI tab (ie localhost:9000/inspect/something)
// in that it pairs target(s) to an inspection GUI.
// The Inspector is responsible for receiving HTTP request/response data from a target,
// which can be a remote host on the gateway server, a local proxy host (forward or reverse),
// or another node process on this machine.  This data can be received over a WebSocket, TODO
// over a interprocess unix domain socket, or by in-process function call.
// The Inspector does the necesssary translation of various HTTP events into the
// DevTools Wire Protocol, which is sent over WebSocket to connected GUI pages (the "frontend").
// An Inspector instance supports multiple targets and zero or more GUI instances may be
// connected at any time.
function Inspector(server, opts) {
	var self = this;
	EventEmitter.call(this);
	this.server = server;
	this.opts = opts;


	this.id = crypto.randomBytes(33).toString('base64');
	this.name = opts.name;
	this.tn = 0;
	this.targets = {};
	this.clients = [];
	this.console = new RemoteConsole(this);
	this.reqn = 0;
	this.reqs = {};
	this.lastGC = Date.now();
	this.gcFreqMs = opts.gcFreqMs || 1000*60*15;
	this.gcFreqCount = opts.gcFreqCount || 500;
	this.gcMinLifetime = opts.gcMinLifetime || 1000*60*5;
	this.buffer = [];
	this.sessionCLI = new SessionCLI(this);
	this.notify = [];
	this.tmpDir = opts.tmpDir || path.join(os.tmpdir(), 'netsleuth');
	fs.mkdir(this.tmpDir, function() {});
	this.config = {
		blockedUrls: [],
		ua: null,
		throttle: {
			offline: false
		},
		noCache: false
	};

	self._gctimer = setInterval(function() {
		self.reqGC();
	}, self.gcFreqMs);


	// every hour, delete any temp files more than 24 hours old
	// (temp files are saved when a request body is > 100 kB or response body is > 10 MB)
	self._tmpcleanup = setInterval(function() {
		fs.readdir(self.tmpDir, function(err, files) {
			if (err) return console.error('error cleaning temp dir', err);
			files.forEach(function(file) {
				file = path.join(self.tmpDir, file);
				fs.stat(file, function(err, stats) {
					if (err) return console.error('error stating temp file', file, err);
					if (stats.mtime < Date.now() - (1000 * 60 * 60 * 24)) {
						fs.unlink(file, function(err) {
							if (err) return console.error('error deleting temp file', file, err);
						});
					}
				});
			});
		});
	}, 1000 * 60 * 60);

	// self.connect = preconnect;

	self.script = new Script(self, {
		dir: server.scriptDir ? path.join(server.scriptDir, opts.name.replace(UNSAFE, '_')) : null
	});

	self.addTarget('_req', {
		internal: true
	});


};
util.inherits(Inspector, EventEmitter);

Inspector.prototype.addTarget = function(id, opts) {
	var self = this;

	if (typeof id == 'object') {
		opts = id;
		id = 'target' + ++self.tn;
	}

	var target;
	if (opts.local) { // local proxy mode
		target = self.targets[id] = new ReverseProxyTarget(self, opts);
	} else if (opts.fwd) {
		target = self.targets[id] = new ForwardProxyTarget(self, opts);
	} else if (opts.inproc) {
		target = self.targets[id] = new InprocTarget(self, opts);
	} else if (opts.internal) {
		target = self.targets[id] = new InternalTarget(self, opts);
	} else {
		target = self.targets[id] = new GatewayTarget(self, opts);
		if (!target.token && self.server.opts.gateways && self.server.opts.gateways[target.gateway]) {
			target.token = self.server.opts.gateways[target.gateway].token;
		}
	}

	target.id = id;


	target.on('connected', function(msg) {
		self.console.info(msg);
		self.broadcast({
			method: 'Gateway.connectionState',
			params: {
				state: target.state
			}
		});
	});

	target.on('temp-error', function(err, msg) {
		console.error('Gateway connection error.', err);
		self.console.error('Gateway connection error: ' + err.message);
	});

	target.on('error', function(err) {
		self.console.error(err.message);
		self.emit('error', err);
	});

	target.on('closed', function(msg, code, reason) {
		console.error(msg, code, reason);
		self.console.error(msg + ' ' + code + ' ' + reason);
		self.broadcast({
			method: 'Gateway.connectionState',
			params: {
				state: self.state,
				message: 'Disconnected from target'
			}
		});

		for (var id in self.reqs) {
			var txn = self.reqs[id];
			if (txn.req) {
				if (txn.req.socket) txn.req.socket.destroy();
				delete txn.req;
				if (txn.reqBody) txn.reqBody.destroy();
				if (txn.resBody) txn.resBody.destroy();
				self.broadcast({
					method: 'Network.loadingFailed',
					params: {
						requestId: id,
						timestamp: Date.now() / 1000,
						type: 'Other',
						errorText: 'disconnected from target during request'
					}
				});
			} else if (txn.ws) {
				txn.ws.close();
			}
		}
	});

	target.on('warn', function(msg, txn) {
		self.console.source('network', txn.id).warn(msg);
	});

	target.on('console-msg', function(type, msg) {
		if (self.console[type]) {
			self.console[type](msg);
		} else {
			self.console.log(msg);
		}
	});

	target.on('request-created', function(txn) {		
		// do garbage collection on the nextish tick if necessary
		if (++self.reqn % self.gcFreqCount == 0) self.reqGC();

		self.reqs[txn.id] = txn;
	});

	target.on('request', function(txn) {
		
		self.broadcast({
			method: 'Network.requestWillBeSent',
			params: {
				requestId: txn.id,
				loaderId: 'ld',
				documentURL: 'docurl',
				timestamp: Date.now() / 1000,
				wallTime: Date.now() / 1000,
				request: {
					url: txn.originalProto + '://' + txn.originalHost + txn.originalPath,
					method: txn.method,
					headers: stringVals(txn.reqHeaders),
					postData: txn.reqBody ? '' : undefined
				},
				initiator: txn.stack && {
					type: 'script',
					stack: {
						callFrames: txn.stack
					},
					url: 'script-url',
					lineNumber: 0
				},
				type: 'Other'
			}
		});

		for (var i = 0; i < self.notify.length; i++) {
			var n = self.notify[i];
			if (n.method == '*' || n.method == txn.method) {
				if (n.rex.test(txn.originalPath)) {
					notifier.notify({
						title: txn.originalHost,
						message: txn.method + ' ' + txn.originalPath
					});
					break;
				}
			}
		}
	});

	target.on('req-contunue', function(txn) {
		self.console.source('network', txn.id).debug('Got 100 Continue for ' + txn.url());
	});

	target.on('req-information', function(txn, info) {
		self.console.source('network', txn.id).info('HTTP ' + info.statusCode + ' ' + info.statusMessage + ' from ' + txn.url());
	});

	target.on('req-large', function(txn) {
		self.broadcast({
			method: 'Gateway.updateRequestBody',
			params: {
				id: txn.id,
				sentToDisk: true,
				file: txn.reqBody.file.path
			}
		});
	});

	target.on('res-large', function(txn) {
		self.broadcast({
			method: 'Gateway.responseBodyLarge',
			params: {
				id: txn.id,
				file: txn.resBody.file.path
			}
		});
	});

	target.on('req-blocked', function(txn, rule) {
		// TODO: update blocks panel

		self.broadcast({
			method: 'Network.requestWillBeSent',
			params: {
				requestId: txn.id,
				loaderId: 'ld',
				documentURL: 'docurl',
				timestamp: Date.now() / 1000,
				wallTime: Date.now() / 1000,
				request: {
					url: txn.originalProto + '://' + txn.originalHost + txn.originalPath,
					method: txn.method,
					headers: stringVals(txn.reqHeaders),
					postData: txn.reqBody ? '' : undefined
				},
				initiator: txn.stack && {
					type: 'script',
					stack: {
						callFrames: txn.stack
					},
					url: 'script-url',
					lineNumber: 0
				},
				type: 'Other'
			}
		});

		self.broadcast({
			method: 'Network.loadingFailed',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				type: 'Other',
				errorText: 'Blocked'
			}
		});


		self.console.source('network', txn.id).warn('Blocked request for ' + txn.method + ' ' + txn.url());
	});

	target.on('req-error', function(txn, err) {
		
		txn.destroy = true;
		if (txn.req && txn.req.socket) txn.req.socket.destroy();
		if (txn.reqBody) txn.reqBody.destroy();
		if (txn.resBody) txn.resBody.destroy();
		txn.done = true;

		self.broadcast({
			method: 'Network.loadingFailed',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				type: 'Other',
				errorText: err.message
			}
		});

		self.console.source('network', txn.id).error('Unable to ' + txn.method + ' ' + txn.url() + '\n' + err.message);

	});

	target.on('req-data', function(txn, payload) {
		if (txn.reqBody && !txn.reqBody.file) {
			self.broadcast({
				method: 'Gateway.updateRequestBody',
				params: {
					id: txn.id,
					body: payload.toString() // TODO: binary?
				}
			});
		}
	});


	target.on('response', function(txn) {
		var mime = txn.resHeaders['content-type'];
		if (mime) {
			mime = mime.split(';')[0];
		}
		self.broadcast({
			method: 'Network.responseReceived',
			params: {
				requestId: txn.id,
				loaderId: 'ld',
				timestamp: Date.now() / 1000,
				wallTime: Date.now() / 1000,
				response: {
					protocol: txn.originalProto + ':',
					url: txn.url(),
					securityState: txn.targetProto == 'https' ? (txn.authorized ? 'secure' : 'insecure') : 'neutral',
					securityDetails: txn.authorizationError,
					status: txn.resStatus,
					statusText: txn.resMessage,
					headers: stringVals(txn.resHeaders),
					headersText: txn.getRawResHeaders(),
					mimeType: mime,
					requestHeaders: stringVals(txn.reqHeaders),
					requestHeadersText: txn.getRawReqHeaders(),
					remoteIPAddress: txn.remoteIP,
					remotePort: txn.remotePort,
					connectionId: txn.id
				},
				type: resourceType(txn.resHeaders['content-type'])
			}
		});
	});

	target.on('res-insecure', function(txn) {
		self.console.source('network', txn.id).warn('Warning: connection to https://' + txn.targetHost + ' is not secure!  Certificate validation failed with error ' + txn.insecureError + '.');
		self.broadcast({
			method: 'Gateway.securityState',
			params: {
				insecure: true,
				message: 'TLS error: ' + txn.insecureError
			}
		});
	});

	target.on('res-secure', function(txn) {
		self.console.source('network', txn.id).info('The certificate for https://' + txn.targetHost + ' is now validating.');
		self.broadcast({
			method: 'Gateway.securityState',
			params: {
				insecure: false
			}
		});
	});

	target.on('res-data', function(txn, chunk) {
		self.broadcast({
			method: 'Network.dataReceived',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				dataLength: chunk.length,
				encodedDataLength: chunk.length
			}
		});
	});

	target.on('res-close', function(txn) {
		txn.done = true;
		if (!txn.complete) {

			self.broadcast({
				method: 'Network.loadingFailed',
				params: {
					requestId: txn.id,
					timestamp: Date.now() / 1000,
					type: 'Other',
					errorText: 'incomplete response'
				}
			});

			self.console.source('network', txn.id).error('Response for ' + txn.method + ' ' + txn.url() + ' terminated prematurely');
		}
	});

	target.on('res-end', function(txn) {
		txn.done = true;
		if (txn.complete) {
			self.broadcast({
				method: 'Network.loadingFinished',
				params: {
					requestId: txn.id,
					timestamp: Date.now() / 1000,
					encodedDataLength: txn.resBody && txn.resBody.length
				}
			});
		}
	});

	target.on('ws-close', function(txn) {
		txn.done = true;

		self.broadcast({
			method: 'Network.webSocketClosed',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000
			}
		});
	});

	target.on('ws-error', function(txn, err) {
		self.console.source('network', txn.id).error('WebSocket error: ' + err);
	});

	target.on('ws-upgrade', function(txn) {
		self.broadcast({
			method: 'Network.webSocketHandshakeResponseReceived',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				response: {
					status: txn.resStatus,
					statusText: txn.resMessage,
					headers: stringVals(txn.resHeaders),
					headersText: 'TODO',
					requestHeaders: stringVals(txn.reqHeaders),
					requestHeadersText: 'TODO'
				}
			}
		});
	});

	target.on('ws-frame-received', function(txn, payload) {
		var bin = !(typeof payload == 'string');

		self.broadcast({
			method: 'Network.webSocketFrameReceived',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				response: {
					opcode: bin ? 2 : 1,
					mask: false,
					payloadData: bin ? payload.toString('base64') : payload
				}
			}
		});
	});

	target.on('ws-frame-sent', function(txn, payload) {
		var bin = !(typeof payload == 'string');
		
		self.broadcast({
			method: 'Network.webSocketFrameSent',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				response: {
					opcode: bin ? 2 : 1,
					mask: false,
					payloadData: bin ? payload.toString('base64') : payload
				}
			}
		});
	});

	target.on('ws-unexpected-response', function(txn, res) {
		self.broadcast({
			method: 'Network.webSocketFrameError',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				errorMessage: 'Unexpected response code: ' + res.statusCode + ' ' + res.statusMessage
			}
		});
		
		self.console.source('network', txn.id).error('WebSocket connection to ' + txn.url() + ' failed: Error during WebSocket handshake: Unexpected response code: ' + res.statusCode + ' ' + res.statusMessage);

	});

	target.on('ws-request', function(txn) {
		self.reqs[txn.id] = txn;
		self.broadcast({
			method: 'Network.webSocketCreated',
			params: {
				requestId: txn.id,
				url: txn.url(),
				initiator: {}
			}
		});

		self.broadcast({
			method: 'Network.webSocketWillSendHandshakeRequest',
			params: {
				requestId: txn.id,
				timestamp: Date.now() / 1000,
				wallTime: Date.now() / 1000,
				request: {
					headers: stringVals(txn.headers)
				}
			}
		});
	});

	target.on('force-disconnect', function() {
		self.console.error(target.serviceError);
		self.broadcast({
			method: 'Gateway.connectionState',
			params: {
				state: self.targets.main.state,
				message: 'Disconnected from gateway'
			}
		});
	});

	target.on('hostname', function(hostname, ip) {
		self.name = hostname;
		if (self.opts.port && self.opts.port != 80) self.name += ':' + self.opts.port;
		self.emit('hostname', hostname, ip);
	});

	target.on('untrusted-cert', function(cert) {
		cert.id = cert.fingerprint256.replace(COLON, '');
		if (!self.server.rejectedCerts[cert.id]) {
			self.broadcast({
				method: 'Gateway.untrustedCert', 
				params: {
					cert: cert
				}
			});
			self.server.badCerts[cert.id] = cert;
		}
	});

	target.on('destroy', function() {
		self.removeTarget(target.id);
	});

	target.init();

	this.updateTargets();

	return target;

};

Inspector.prototype.reqGC = function() {
	var self = this, now = Date.now(), del=0;
	for (var id in self.reqs) {
		if (!self.reqs[id].ws && self.reqs[id].date + self.gcMinLifetime < now) {
			delete self.reqs[id];
			++del;
		}
	}
};


Inspector.prototype.removeTarget = function(id) {
	if (this.targets[id]) {
		this.targets[id].close();
		this.targets[id].removeAllListeners();
		delete this.targets[id];
	}
	this.updateTargets();
};

Inspector.prototype.reconnect = function() {
	for (var id in this.targets) this.targets[id].reconnect();
};

Inspector.prototype.close = function() {
	if (this.shutdown) return;
	this.shutdown = true;
	clearInterval(this._gctimer);
	clearTimeout(this._connto);
	this.reqs = {};
	for (var id in this.targets) this.removeTarget(id);
	if (this.script) this.script.close();
	// if (this.gateway && this.gateway._local) this.gateway.close();
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

					if (!MessageBody.native) {
						setTimeout(function() {
							self.console.warn('Native modules failed to build.  Some features (such as brotli decoding and non-utf8 character encoding support) will not work.  See https://netsleuth.io/docs/native for more information.');
						}, 100);
					}

					if (self.targets.main) {
						if (self.targets.main.state != Target.SERVICE_STATE.OPEN) {
							setTimeout(function() {
								self.console.error('Not connected to gateway.');
								if (self.serviceError) self.console.error(self.serviceError.message);
							}, 100);
						} else {
							send({
								m: 'inspector',
								iid: ws.id
							});
						}
						csend({
							method: 'Gateway.connectionState',
							params: {
								state: self.targets.main.state
							}
						});
					} else {
						var n = 0,
							open = 0;

						for (var id in self.targets) {
							++n;
							if (self.targets[id].state == Target.SERVICE_STATE.OPEN) ++open;
						}

						csend({
							method: 'Gateway.connectionState',
							params: {
								state: open ? 2 : 3
							}
						});

					}


					if (self.insecureError) csend({
						method: 'Gateway.securityState',
						params: {
							insecure: true,
							message: 'TLS error: ' + self.insecureError
						}
					});
					break;

				case 'Network.getResponseBody':
					var info = self.reqs[msg.params.requestId];
					var body = info && info.resBody;

					if (info) {
						if (body) {

							body.get(function(err, b64, body) {
								if (err) {
									self.console.error('Error getting the response body of ' + info.msg.method + ' ' + info.msg.url + ': ' + err.message);
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

						} else {
							csend({
								id: msg.id,
								result: {
									body: '(missing response body)'
								}
							});
						}

						
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
					self.config.blockedUrls = msg.params.urls;
					send({
						m: 'block',
						urls: msg.params.urls
					});
					reply();
					break;

				case 'Network.setUserAgentOverride':
					self.config.ua = msg.params.userAgent || null;
					send({
						m: 'ua',
						ua: msg.params.userAgent || null
					});
					reply();
					break;

				case 'Network.emulateNetworkConditions':
					self.config.throttle = msg.params;
					send({
						m: 'throttle',
						off: msg.params.offline,
						latency: msg.params.latency,
						down: msg.params.downloadThroughput,
						up: msg.params.uploadThroughput
					});
					reply();
					break;

				case 'Network.setCacheDisabled':
					self.config.noCache = msg.params.cacheDisabled;
					send({
						m: 'no-cache',
						val: msg.params.cacheDisabled
					});
					reply();
					break;

				case 'Clipboard.write':
					clipboardy.write(msg.params.text);
					break;


				case 'Runtime.evaluate':
					self.sessionCLI.parse(msg, reply);
					break;

				case 'Gateway.setCertTrust':
					self.server.setCertTrust(msg.params.hostname, msg.params.id, msg.params.op);
					break;

				case 'Gateway.openFile':
					self.server.openFile(msg.params.path);
					break;

				case 'Gateway.revealFile':
					self.server.revealFile(msg.params.path);
					break;

				case 'Gateway.clear':
					for (var id in self.reqs) if (self.reqs[id].done) delete self.reqs[id];
					break;

				case 'Gateway.replay':
					var txn = self.reqs[msg.params.id]
					if (txn) {
						if (txn.statusCode < 200) return self.console.error('Cannot replay requests that result in HTTP ' + txn.statusCode);
						var opts = url.parse(txn.targetUrl());

						opts.method = txn.method;
						opts.headers = txn.reqHeaders;
						opts.agent = opts.protocol == 'https:' ? https.globalAgent : http.globalAgent;
						opts.rejectUnauthorized = false;

						var req = new self.targets._req.ClientRequest(opts);
						req.__init = [{
							functionName: '(replay of ' + txn.id + ')'
						}];

						req.on('response', function(res) {
							res.on('data', function() {
								// noop
							});
						});

						req.on('error', function(err) {
							// noop
						});

						req.on('socket', function() {
							req.socket.once('secureConnect', function() {


								if (!req.socket.authorized && !req.socket.isSessionReused()) {
									var cert = req.socket.getPeerCertificate();

									cert.raw = serverCert.pemEncode(cert.raw.toString('base64'), 64);
									cert.hostname = url.parse('https://' + txn.targetHost).hostname.toLowerCase();

									if (!self.server.acceptedCerts[cert.hostname] || !self.server.acceptedCerts[cert.hostname][cert.fingerprint256.replace(COLON, '')]) {

										self.targets._req.emit('untrusted-cert', cert);
										var err = new Error(req.socket.authorizationError);
										err.code = req.socket.authorizationError;
										req.socket.destroy(err);
									}
								}
							});
						});

						if (txn.reqBody) {
							if (txn.reqBody.file) {
								fs.createReadStream(txn.reqBody.file.path).on('error', function(err) {
									self.console.error('Cannot replay request.  Unable to open saved request body.  ' + err.message);
									req.destroy();
								}).pipe(req);
							} else {
								req.end(txn.reqBody.data);
							}
						} else {
							req.end();
						}
					}
					break;

				default:
					// console.log(msg);
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

	// enable console
	csend({
		method: 'Runtime.executionContextCreated',
		params: {
			context: {
				id: 1,
				name: 'netsleuth',
				origin: 'origin'
			}
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
		for (var id in self.targets) self.targets[id].send(msg);
	}

};


Inspector.prototype.updateTargets = function() {
	var self = this,
		n = 0,
		open = 0;

	for (var id in self.targets) {
		++n;
		if (self.targets[id].state == Target.SERVICE_STATE.OPEN) ++open;
	}

	console.log(self.name + ': ' + n + ' targets, ' + open + ' open');

	self.broadcast({
		method: 'Gateway.connectionState',
		params: {
			state: open ? 2 : 3,
			message: 'No connected targets'
		}
	});

	if (n == 0) {
		self.emit('no-targets');
	}

	if (n == 1) {
		self.emit('has-targets');
	}
};


var CERT = /-----BEGIN CERTIFICATE-----\r?\n?(.+)\r?\n?-----END CERTIFICATE-----/s, LF = /\r?\n?/g;

function InspectionServer(opts) {
	var self = this;
	self.opts = opts = opts || {};
	self.inspectors = {};
	self.monitors = [];
	self.scriptDir = opts.scriptDir;
	self.localCA = opts.localCA;
	self.badCerts = {};
	self.rejectedCerts = {};
	self.acceptedCerts = {};

	self.secureContext = tls.createSecureContext({
		honorCipherOrder: true
	});

	if (opts.extraCAs) opts.extraCAs.forEach(function(pem) {
		self.secureContext.context.addCACert(pem);
	});

	if (opts.trustedCerts) opts.trustedCerts.forEach(function(cert) {
		if (cert.hostname == 'CA') {
			self.secureContext.context.addCACert(cert.raw);
		} else {
			var der = CERT.exec(cert.raw);
			if (der && der[1]) {
				der = Buffer.from(der[1].replace(LF, ''), 'base64');
				var hash = crypto.createHash('sha256');
				hash.update(der);
				self.setCertTrust(cert.hostname, hash.digest('hex').toUpperCase(), 'session', true);
			}
		}
	});

	var app = this.app = express();

	app.use(bodyParser.json());

	app.get('/ca.cer', function(req, res) {
		if (self.localCA) res.set('Content-Type', 'application/x-x509-ca-cert').send(self.localCA.pem());
		else res.sendStatus(404);
	});

	app.get('/sleuth', function(req, res) {
		res.send(Object.assign({}, process.versions, {
			sleuth: version
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

	var staticOpts = {
		maxAge: 1000*60*60*24
	};

	app.use('/inspect', express.static(path.join(__dirname, 'overrides'), staticOpts));
	var dtStatic = express.static(DEVTOOLS, staticOpts);
	if (DEVTOOLS_CASE_SENSITIVE) app.use('/inspect', insensitize(DEVTOOLS, dtStatic));
	else app.use('/inspect', dtStatic);
	app.use('/jq', express.static(path.dirname(require.resolve('jquery')), staticOpts));
	app.use(express.static(__dirname + '/www', staticOpts));

	app.get('/img/elevate.png', function(req, res) {
		res.set('Cache-Control', 'public, max-age=31536000');
		if (process.platform == 'win32') res.sendFile(__dirname + '/www/img/elevate.win.png');
		else if (process.platform == 'darwin') res.sendFile(__dirname + '/www/img/elevate.darwin.png');
		else res.sendFile(__dirname + '/www/img/elevate.unix.png');
	});


	app.get('/inspect/:host', function(req, res, next) {
		if (self.inspectors[req.params.host]) res.sendFile(DEVTOOLS + '/inspector.html');
		else next();
	});

	app.get('/inspect/:host/health', function(req, res) {
		if (self.inspectors[req.params.host]) res.send({ok:true});
		else res.sendStatus(404);
	});

	app.get('/inspect/:host/:group/last', function(req, res) {
		var insp = self.inspectors[req.params.host];
		if (insp && insp.lastReq[req.params.group]) res.send(insp.lastReq[req.params.group]);
		else res.sendStatus(404);
	});

	var ICON_CACHE = 'public, max-age=' + (60*60*24);
	app.get('/inspect/:host/favicon.ico', function(req, res) {
		var insp = self.inspectors[req.params.host];

		if (insp) {
			if (insp.opts.inproc) {
				res.set('Cache-Control', ICON_CACHE);
				if (insp.opts.icon) {
					fs.stat(insp.opts.icon, function(err, stats) {
						if (err) res.sendFile(__dirname + '/www/img/node.svg');
						else res.sendFile(insp.opts.icon);
					});
				} else res.sendFile(__dirname + '/www/img/node.svg');
			} else if (insp.targets.main && insp.targets.main.url) {
				request({
					url: insp.targets.main.url.href + 'favicon.ico',
					encoding: null
				}, function(err, ires, body) {
					if (err) res.sendStatus(500);
					else if (ires.statusCode == 200) {
						res.set({
							'Content-Type': ires.headers['content-type'],
							'Cache-Control': ICON_CACHE
						});
						res.send(body);
					}
					else res.sendStatus(404);
				});
			} else {
				res.sendStatus(501);
			}

		} else res.sendStatus(404);
	});

	app.get('/login', function(req, res) {
		require('./lib/browser-login').login({
			gateway: req.query.gateway || 'netsleuth.io',
			openBrowser: false,
			finished: 'http://localhost:' + opts.port + '/logged-in'
		}, function(err, opts) {
			if (err) res.status(500).send(err.stack);
			else res.redirect(opts.dest);
		});
	});

	var httpServer = this.http = http.createServer(onrequest),
		ws = this.ws = new WebSocket.Server({
			noServer: true,
			verifyClient: function(info, cb) {
				if (info.req.url == '/targets') return cb(true);

				var host = getInspectorId(info.req.url);
				if (host && host.type == 'inproc') {
					cb(true);
					// var existing = self.inspectors[host.name];
					// if (!existing) cb(true);
					// else if (existing.targets.main instanceof targets.InprocTarget) cb(true);
					// else cb(false, 409, 'Conflict');
				}
				else if (host && self.inspectors[host.name]) cb(true);
				else cb(false, 404, 'Not Found');
			}
		});

	function onrequest(req, res) {
		if (req.url[0] == '/') app(req, res);
		else if (fwd) fwd.targets.main.gateway.handleRequest(req, res);
		else rawRespond(req.socket, 403, 'Forbidden', 'Forward proxy server disabled.');
	}

	function onupgrade(req, socket, head) {
		socket.on('error', function(err) {
			console.error('inspector ws error', err);
		});
		var origin = req.headers.origin || '';
		if (origin.substr(0,10) != 'netsleuth:' &&
			origin != 'http://localhost:' + opts.port &&
			origin != 'http://127.0.0.1:' + opts.port) return rawRespond(socket, 403, 'Forbidden', 'This request must be made from an allowed origin.');

		ws.handleUpgrade(req, socket, head, function(client) {
			if (req.url == '/targets') {
				self.targetMonitorConnection(client, req);
			} else {
				var ti = getInspectorId(req.url);
				if (ti) {
					var inspector = self.inspectors[ti.name];
					if (ti.type == 'inproc') {
						// The client is an inspected process
						if (!inspector) inspector = self.inspectInproc(ti.name, req.headers['sleuth-transient'] == 'true', req.headers.icon);
						var target = inspector.addTarget({
							inproc: true,
							client: client,
							req: req
						});

						inspector.console.info(target.pid + ' connected');

						target.on('destroy', function() {
							inspector.console.info(target.pid + ' disconnected');
						});

					} else {
						// The client is the DevTools GUI
						if (inspector) inspector.connection(client, req);
						else console.log('oops');
					}
					client.on('pong', function() {
						client.isAlive = true;
					});
					ws.emit('connection', client, req);
				}
			}
		});
	}

	function onconnect(req, socket, head) {
		if (fwd) fwd.targets.main.gateway.handleConnect(req, socket, head);
		else rawRespond(socket, 405, 'Method Not Allowed', 'This server does not allow CONNECT requests because the forward proxy is disabled.');
	}

	httpServer.on('upgrade', onupgrade);

	httpServer.on('connect', onconnect);

	httpServer.on('error', function(err) {
		console.error('inspector http error', err);
	});

	ws.on('error', function(err) {
		console.error('inspector ws error', err);
	});

	if (opts.https) {
		var httpsServer = this.https = https.createServer(opts.https, app);
		httpsServer.on('upgrade', onupgrade);
		httpsServer.on('connect', onconnect);
	}

	var fwd = self.inspectors[':' + opts.port] = new Inspector(this, {
		fwd: true,
		deletable: false,
		name: ':' + opts.port
	});
	fwd.addTarget('main', {
		fwd: true
	});

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
};


InspectionServer.prototype[util.inspect.custom] = true; // instruct console.log to ignore the `inspect` property
InspectionServer.prototype.inspect = function(opts) {
	var self = this;
	this.remove(opts.host);
	opts.name = opts.host;
	var inspector = new Inspector(this, opts);

	var href = opts.target;
	if (href && href.substr(0, 5) == 'same:') href = href.substr(5);

	inspector.on('hostname', function(hostname) {
		self.inspectors[inspector.name] = inspector;
		
		self.monitorBroadcast({
			m: 'new',
			type: getInspectorType(inspector),
			host: inspector.name,
			target: href
		});
	});

	return inspector;
};

InspectionServer.prototype.inspectInproc = function(name, transient, icon) {
	var self = this,
		inspector = self.inspectors[name] = new Inspector(self, {
			inproc: true,
			name: name,
			transient: transient,
			icon: icon
		});

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

		var href = self.inspectors[k].targets.main && self.inspectors[k].targets.main.url && self.inspectors[k].targets.main.url.href;
		if (href && href.substr(0, 5) == 'same:') href = href.substr(5);

		inspectors.push({
			type: getInspectorType(self.inspectors[k]),
			host: k,
			target: href,
			deletable: self.inspectors[k].opts.deletable
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

InspectionServer.prototype.setCertTrust = function(hostname, id, op, cert) {
	if (!cert) cert = this.badCerts[id];
	if (!cert) return;

	if (op == 'reject') this.rejectedCerts[id] = true;
	else if (op == 'session' || op == 'perm') {
		if (!this.acceptedCerts[hostname]) this.acceptedCerts[hostname] = {};
		this.acceptedCerts[hostname][id] = true;
		if (op == 'perm') this.trustCert(cert);
	}

	delete this.badCerts[id];
};

InspectionServer.prototype.trustCert = function() {
	console.error('Cert trust not implemented');
};


function getHid() {
	var hash = crypto.createHash('sha256');
	hash.update(JSON.stringify({
		user: os.userInfo(),
		net: os.networkInterfaces()
	}));
	return hash.digest('base64');
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
	clearInterval(this.wsping);
	clearInterval(this._tmpcleanup);
	this.ws.close();
	this.http.close();
	if (this.https) this.https.close();
};


function getInspectorId(url) {
	var path = url.split('/');
	if (path[1] == 'inspect' || path[1] == 'inproc') return { type: path[1], name: path[2] };
}

function getInspectorType(insp) {
	if (insp.opts.inproc) return 2;
	if (insp.opts.local) return 3;
	if (insp.opts.fwd) return 4;
	return 1;
}
