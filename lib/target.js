var http = require('http'),
	https = require('https'),
	tls = require('tls'),
	url = require('url'),
	util = require('util'),
	os = require('os'),
	events = require('events'),
	stream = require('stream'),
	WebSocket = require('ws'),
	duplexer2 = require('duplexer2'),
	serverCert = require('./server-cert'),
	HTTPTransaction = require('./http-transaction'),
	MessageBody = require('./message-body'),
	ThrottleStream = require('./throttle-stream'),
	GatewayError = require('./gateway-error'),
	version = require('../package.json').version;

var COMMA = /, */, COLON = /:/g;

// abstract class for all target types
function Target(inspector, opts) {
	events.EventEmitter.call(this);
	this.inspector = inspector;
	this.ready = false;
	this.opts = opts;
	this.ua = 'netsleuth/' + version + ' (' + os.platform() + '; ' + os.arch() + '; ' + os.release() +') node/' + process.versions.node;
	this.cwss = new WebSocket.Server({
		noServer: true
	});

	var agentOpts = {
			keepAlive: true,
			maxSockets: Infinity
		},
		secureAgentOpts = Object.assign({}, agentOpts);

	secureAgentOpts.secureContext = inspector.server.secureContext;
	if (opts.hostHeader) secureAgentOpts.servername = opts.hostHeader;

	this.httpAgent = new http.Agent(agentOpts);
	this.httpsAgent = new https.Agent(secureAgentOpts);

	if (opts.host) {
		if (opts.host.indexOf('://') == -1) this.host = url.parse('https://' + opts.host);
		else this.host = url.parse(opts.host);
		if (opts.host[0] == '*') this.host.host = opts.host;
	}
	if (opts.target) {
		if (opts.target.substr(0, 2) == '//') this.url = url.parse('same:' + opts.target);
		else if (opts.target.indexOf('://') == -1) this.url = url.parse('same://' + opts.target);
		else this.url = url.parse(opts.target);
	}

}
util.inherits(Target, events.EventEmitter);

Target.SERVICE_STATE = {
	UNINITIALIZED: 0,
	PREFLIGHT: 1,
	OPEN: 2,
	CONNECTING: 3,
	DISCONNECTED: 4,
	// Do not auto-reconnect following states
	ERROR: 5,
	REDIRECTING: 6,
	CLOSED: 7
};

Target.prototype.checkHealth = function() {
	var self = this;
	var req = (self.url.protocol == 'https:' ? https : http).request({
		host: self.url.hostname,
		port: parseInt(self.url.port, 10) || (self.url.protocol == 'https:' ? 443 : 80),
		method: 'HEAD',
		path: '/',
		headers: {
			Host: opts.hostHeader ? opts.hostHeader : self.url.host,
			'User-Agent': self.ua
		},
		agent: (self.url.protocol == 'https:' ? self.httpsAgent : self.httpAgent),
		timeout: 5000
	});

	req.on('response', function(res) {
		if (res.statusCode < 500) {
			self.ready = true;
			self.send({ m: 'ready' });
			console.log('target ready', self.url.hostname);
		} else retry();
	});

	req.on('error', retry);

	req.end();

	function retry() {
		if (!this.closed) setTimeout(function() {
			self.checkHealth();
		}, 5000);
	}
};

Target.prototype.close = function() {
	this.closed = true;
	clearTimeout(this._connto);
};


Target.prototype.handleBin = function(type, id, payload) {
	var self = this,
		txn = self.inspector.reqs[id];

	if (txn) {
		if (type == 1) {
			if (txn.reqBody && !txn.reqBody.input.write(payload)) self.send({
				m: 'rp',
				id: txn.id
			});
			self.emit('req-data', txn, payload);
		} else if (type == 2) {
			if (txn.resBody && !txn.resBody.input.write(payload)) self.send({
				m: 'pp',
				id: txn.id
			});
			self.emit('res-data', txn, payload);
		} else if (type == 3) {
			if (txn.wsraw && !txn.wsraw.push(payload)) self.send({
				m: 'wsp',
				id: txn.id
			});
		}
	}
};

Target.prototype.handleMsg = function(data, isParsed) {
	var self = this,
		msg;

	if (isParsed) {
		msg = data;
	} else if (typeof data == 'string') {
		try {
			msg = JSON.parse(data);
		} catch (ex) {
			return console.error('error handling', msg || data, ex);
		}
	} else {
		if (data.length > 5) {
			var type = data.readUInt8(0),
				id = data.readUInt32LE(1);

			if (this.pid) id = this.pid + ':' + id;

			self.handleBin(type, id, data.slice(5));
		}
		return;
	}

	switch (msg.m) {
		case 'ri':
			var txn = new HTTPTransaction(self, msg);
			if (txn.reqBody) txn.reqBody.on('file', function() {
				self.emit('req-large', txn);
			});
			self.emit('request-created', txn);
			self.emit('request', txn);
			break;

		case 'p':
			var txn = self.inspector.reqs[msg.id];
			if (txn) {

				txn.authorized = msg.authorized;
				txn.authorizationError = msg.authorizationError;
				txn.resStatus = msg.statusCode;
				txn.resMessage = msg.statusMessage;
				txn.resHeaders = msg.headers;
				txn.resRawHeaders = msg.rawHeaders;
				txn.remoteIP = msg.remoteIP;
				txn.remotePort = msg.remotePort;

				txn.resBody = new MessageBody(txn, msg.headers, {
					maxSize: self.opts.resMaxSize,
					kind: 'res',
					host: txn.originalHost
				});

				txn.resBody.on('file', function() {
					self.emit('res-large', txn);
				});

				txn.resBody.input.on('drain', function() {
					self.send({
						m: 'pr',
						id: txn.id
					});
				});

				txn.resBody.on('data', function() {
					// noop
				});


				self.emit('response', txn);
			}

			break;
		case 'pe':
			var txn = self.inspector.reqs[msg.id];
			if (txn) {
				txn.complete = msg.complete;
				if (txn.resBody) txn.resBody.input.end();
				self.emit('res-end', txn);
			}
			break;

		case 'r':
			var txn = new HTTPTransaction(self, msg, self.opts),
				proto,
				origin;

			if (txn.reqBody) {

				txn.reqBody.on('file', function() {
					self.emit('req-large', txn);
				});


				if (self.inspector.config.throttle && self.inspector.config.throttle.uploadThroughput) {
					txn.reqBody.input = new ThrottleStream({ bps: self.inspector.config.throttle.uploadThroughput });
					txn.reqBody.input.pipe(txn.reqBody);
				}

				txn.reqBody.input.on('drain', function() {
					self.send({
						m: 'rr',
						id: txn.id
					});
				});
			}

			if (self.forwardProxy) {
				origin = url.parse(msg.url);
				proto = origin.protocol;

				if (!origin.host) {
					return self.send({
						m: 'bad',
						id: msg.id,
						msg: 'Invalid request URL.'
					});
				}

				origin.method = msg.method;
				origin.headers = Object.assign({}, msg.headers);
				delete origin.headers['proxy-connection']; // this is not a valid header, but some clients send it anyway

			} else {

				msg.headers.host = self.url.host;

				proto = self.url.protocol;
				if (proto == 'same:') proto = msg.proto + ':';

				origin = {
					host: self.url.hostname,
					port: parseInt(self.url.port, 10) || (proto == 'https:' ? 443 : 80),
					method: msg.method,
					path: msg.url,
					headers: Object.assign({}, msg.headers, {
						host: self.opts.hostHeader ? self.opts.hostHeader : self.url.host
					})
				};

				txn.targetHost = self.url.host;
				txn.targetProto = proto;
			}

			origin.rejectUnauthorized = false; // we will manually implement security checks
			origin.ca = self.opts.ca;

			self.emit('request-created', txn);

			if (self.inspector.config.throttle && self.inspector.config.throttle.latency) setTimeout(processReq, self.inspector.config.throttle.latency);
			else processReq();

			function processReq() {
				self.inspector.script.request(txn, function(err, mods) {
					if (err) {
						self.emit('request', txn);
						txn.complete = true;
						txn.resStatus = 502;
						txn.resMessage = 'Bad Gateway';
						txn.resHeaders = {};
						err.message = 'Interception script error: ' + err.message;
						self.emit('req-error', txn, err);
						self.inspector.script.done(txn);
						return self.send({
							m: 'err',
							id: msg.id,
							msg: 'Interception script threw an unhandled exception.  See the netsleuth GUI for this target for more details.'
						});
					}
					if (mods.block) {
						txn.complete = true;
						txn.resStatus = 450;
						txn.resMessage = 'Request Blocked';
						txn.resHeaders = {};
						self.emit('req-blocked', txn, 'script');
						self.inspector.script.done(txn);
						return self.send({
							m: 'rblock',
							id: msg.id
						});
					}
					if (mods.res) {
						txn.resStatus = mods.res.statusCode;
						txn.resMessage = mods.res.statusMessage;
						txn.resHeaders = mods.res.headers;
						self.emit('request', txn);
						self.emit('response', txn);
						
						self.send({
							m: 'res',
							id: msg.id,
							sc: mods.res.statusCode,
							sm: mods.res.statusMessage,
							headers: mods.res.headers
						});

						mkResBody(mods.res);
						txn.complete = true;
						txn.resBody.input.end(mods.res.body);

						return;
					}
					if (mods.method) origin.method = mods.method;
					if (mods.proto) proto = mods.proto;
					if (mods.host) origin.host = mods.host;
					if (mods.path) origin.path = mods.path;
					if (mods.headers) {
						txn.reqHeaders = Object.assign({}, mods.headers);
						origin.headers = mods.headers;
					}


					origin.agent = (proto == 'https:' ? self.httpsAgent : self.httpAgent);

					var req = (proto == 'https:' ? https : http).request(origin);

					txn.req = req;

					req.on('socket', function() {
						if (self.forwardProxy) req.socket.once('connect', function() {
							if (req.socket.remoteFamily == 'IPv6') txn.remoteIP = '[' + req.socket.remoteAddress + ']';
							else txn.remoteIP = req.socket.remoteAddress;
							txn.remotePort = req.socket.remotePort;
						});

						// `secure` is emitted AFTER this event.  http listens for `secure` to do its business, so we can destroy here if needed.
						req.socket.once('secureConnect', function() {
							// If a tls session is reused, it's not possible to get the server certificate.
							// But, since we're reusing a session we already decided was OK, it's safe to ignore the authorized error.

							if (self.reqsShowTargetTLSState) {
								if (req.socket.isSessionReused()) {
									txn.authorized = true;
								} else {
									txn.authorized = req.socket.authorized;
									txn.authorizationError = req.socket.authorizationError;
								}
							}

							if (!req.socket.authorized && !req.socket.isSessionReused()) {

								var cert = req.socket.getPeerCertificate();

								cert.raw = serverCert.pemEncode(cert.raw.toString('base64'), 64);
								cert.hostname = url.parse('https://' + txn.targetHost).hostname.toLowerCase();

								var isrv = self.inspector.server;

								if (!isrv.acceptedCerts[cert.hostname] || !isrv.acceptedCerts[cert.hostname][cert.fingerprint256.replace(COLON, '')]) {

									self.emit('untrusted-cert', cert);

									var err = new Error(req.socket.authorizationError);
									err.code = req.socket.authorizationError;
									req.socket.destroy(err);

								}

							}
						});
					});

					req.on('continue', function() {
						if (!http.ServerResponse.prototype.writeProcessing) {
							// old (node < 10) does not support `information` event, so we have to handle `continue`
							// on node >= 10, the 100 Continue will be sent from the `information` event
							self.emit('req-continue', txn);
							self.send({
								m: 'cont',
								id: msg.id
							});
						}
					});

					req.on('information', function(info) {
						self.emit('req-information', txn, info);
						self.send({
							m: 'info',
							id: msg.id,
							sc: info.statusCode,
							sm: info.statusMessage,
							headers: info.headers,
							raw: info.rawHeaders
						});
					});

					req.on('error', function(err) {
						if (txn.destroy) return;

						console.error(err);
						if (!msg.replay) {
							self.send({
								m: 'err',
								id: msg.id,
								msg: err.message
							});
						}

						self.inspector.script.done(txn);

						if (txn.complete) {

							self.emit('warn', 'Error after response for ' + txn.method + ' ' + txn.url() + ' completed\n' + err.message, txn);

						} else {
							
							self.emit('req-error', txn, err);

						}

					});

					req.on('response', function(res) {
						if (res.statusCode >= 102 && res.statusCode <= 199) {
							// node < 10 did not parse informational responses correctly -- it misinterperted them as a regular response.
							// https://github.com/nodejs/node/issues/9282
							// If you get here, it means your node's HTTP parser is broken, and there's not much we can do to fix it.
							// This means we have to kill the response and report a failure.
							var err = new Error('Got an informational response (HTTP ' + res.statusCode + '), but your version of node (v' + process.versions.node + ') does not correctly parse this kind of response.  Upgrade to node v10.0.0 or later to fix.');
							self.emit('req-error', err);

							self.send({
								m: 'err',
								id: msg.id,
								msg: err.message
							});
						}

						txn.res = res;
						txn.resStatus = res.statusCode;
						txn.resMessage = res.statusMessage;
						txn.resHeaders = res.headers;
						txn.resRawHeaders = res.rawHeaders;

						self.inspector.script.response(txn, function(err, mods) {
							if (err) {
								txn.complete = true;
								txn.resStatus = 502;
								txn.resMessage = 'Bad Gateway';
								txn.resHeaders = {};
								self.emit('req-error', txn, err);
								return self.send({
									m: 'err',
									id: msg.id,
									msg: 'Interception script threw an unhandled exception.  See the netsleuth GUI for this target for more details.'
								});
							}
							if (mods.block) {
								txn.complete = true;
								txn.resStatus = 450;
								txn.resMessage = 'Request Blocked';
								txn.resHeaders = {};
								self.emit('req-blocked', txn, 'script');
								res.destroy();
								return self.send({
									m: 'rblock',
									id: msg.id
								});
							}
							
							if (mods.statusCode) res.statusCode = txn.resStatus = mods.statusCode;
							if (mods.statusMessage) res.statusMessage = txn.resMessage = mods.statusMessage;
							if (mods.headers) res.headers = txn.resHeaders = Object.assign({}, mods.headers);



							var loc = res.headers.location;
							if (loc) {

								if (loc.substr(0,2) == '//') loc = msg.proto + ':' + loc;
								var ploc = url.parse(loc);

								if (self.host && ploc.host) {
									ploc.host = self.host.host;
								}

								var newLoc = url.format(ploc);
								if (res.headers.location != newLoc) res.headers['x-sleuth-original-location'] = res.headers.location;
								res.headers.location = newLoc;

							}

							if (proto == 'https:') {
								if (!res.socket.authorized && !res.socket.authorizationError) res.socket.authorizationError = '(unknown error)';
								if (!res.socket.authorized && self.insecureError != res.socket.authorizationError) {
									txn.insecureError = self.insecureError = res.socket.authorizationError;
									self.emit('res-insecure', txn);

								} else if (res.socket.authorized && typeof self.insecureError == 'string') {
									self.insecureError = null;
									self.emit('res-secure', txn);
								}
							}

							if (!msg.replay) {
								self.send({
									m: 'res',
									id: msg.id,
									sc: res.statusCode,
									sm: res.statusMessage,
									headers: res.headers,
									raw: res.rawHeaders
								});
							}

							for (var k in res.headers) {
								if (Array.isArray(res.headers[k])) res.headers[k] = res.headers[k].join('\n');
							}


							if (res.headers.warning) {
								self.emit('warn', 'Warning from ' + msg.method + ' ' + msg.url + ': ' + res.headers.warning, txn);
							}


							mkResBody(res);

							if (mods.body) {
								res.destroy();
								txn.complete = true;
								txn.resBody.input.end(mods.body);
							} else {
								res.pipe(txn.resBody.input);

								res.on('close', function() {
									process.nextTick(function() {
										if (!res.complete) {
											if (!msg.replay && !res.complete) {
												self.send({
													m: 'err',
													id: msg.id,
													msg: 'incomplete response'
												});
											}

											if (txn.reqBody) txn.reqBody.destroy();
											if (txn.resBody) txn.resBody.destroy();
										}
										self.emit('res-close', txn);
										self.inspector.script.done(txn);
									});
								});

								res.on('end', function() {
									if (res.complete) {
										txn.complete = true;
									}
								});
							}

							self.emit('response', txn);
						});

					});

					self.emit('request', txn);

					function mkResBody(res) {
						txn.resBody = new MessageBody(txn, res.headers, {
							maxSize: self.opts.resMaxSize,
							kind: 'res',
							host: txn.originalHost
						});
						txn.resBody.on('file', function() {
							self.emit('res-large', txn);
						});

						if (self.inspector.config.throttle && self.inspector.config.throttle.downloadThroughput) {
							txn.resBody.input = new ThrottleStream({ bps: self.inspector.config.throttle.downloadThroughput });
							txn.resBody.input.pipe(txn.resBody);
						}

						txn.resBody.input.on('drain', function() {
							self.send({
								m: 'pr',
								id: txn.id
							});
						});

						var forwarder = new stream.Writable({
							write: function(chunk, enc, cb) {
								self.emit('res-data', txn, chunk);
								if (!msg.replay) {
									if (txn._resPause === true) {
										txn._resPause = cb;
										self.sendBin(2, msg.id, chunk);
									}
									else self.sendBin(2, msg.id, chunk, cb);
								}
								else cb();
							}
						});

						forwarder.on('finish', function() {
							if (!msg.replay) self.send({
								m: 'rese',
								id: msg.id,
							});
							self.emit('res-end', txn);
							self.inspector.script.done(txn);
						});

						forwarder.on('error', function(err) {
							req.emit('error', err);
						});

						txn.resBody.pipe(forwarder);
					}

					if (txn.reqBody) txn.reqBody.pipe(req);
					else req.end();
				});
			}

			self.send({
				m: 'ack',
				id: msg.id
			});

			break;

		case 'pp':
			var txn = self.inspector.reqs[msg.id];
			if (txn && !txn._resPause) {
				txn._resPause = true;
			}
			break;

		case 'pr':
			var txn = self.inspector.reqs[msg.id];
			if (txn) {
				if (typeof txn._resPause == 'function') txn._resPause();
				txn._resPause = false;
			}
			break;

		case 'wsp':
			var txn = self.inspector.reqs[msg.id];
			if (txn && !txn._wsPause) {
				txn._wsPause = true;
			}
			break;


		case 'wsr':
			var txn = self.inspector.reqs[msg.id];
			if (txn) {
				if (typeof txn._wsPause == 'function') txn._wsPause();
				txn._wsPause = false;
			}
			break;

		case 'ws':

			var proto,
				wsurl;

			var headers = Object.assign({}, msg.headers);
			delete headers.host;
			delete headers.connection;
			delete headers.upgrade;
			for (var k in headers) {
				if (k.substr(0, 14) == 'sec-websocket-') delete headers[k];
			}

			if (self.forwardProxy) {
				proto = msg.proto + ':';
				wsurl = msg.url;
			} else {

				proto = self.url.protocol;
				if (proto == 'same:') proto = msg.proto + ':';
				else if (proto == 'https:') proto = 'wss:';
				else proto = 'ws:';

				var port = parseInt(self.url.port, 10) || (proto == 'wss:' ? 443 : 80);
				if ((proto == 'http:' && port == 80) || (proto == 'wss:' && port == 443)) port = '';
				else port = ':' + port;

				var wsurl = proto + '//' + self.url.hostname + port + msg.url;

				headers.Host = self.opts.hostHeader ? self.opts.hostHeader : self.url.host;
			}

			var subproto = null;
			if (msg.headers['sec-websocket-protocol']) subproto = msg.headers['sec-websocket-protocol'].split(COMMA);


			var ws = new WebSocket(wsurl, subproto, {
				headers: headers,
				rejectUnauthorized: !self.opts.insecure,
				ca: self.opts.ca
			});

			var txn = new HTTPTransaction(self, msg);
			txn.ws = ws;

			// WebSocket data flows through several streams to present a consistent interface and apply throttling.
			// The gateway host does not parse WebSocket data in order to reduce its load and simplify flow control.
			// It simply shovels bytes between the client and the daemon.
			//
			//          +---------------+
			//          |               |           A WSStream represents a readable raw stream of bytes demultiplexed from
			//          |     wsraw     |           and writable stream multiplexed to a connection to a host.
			//          |  (WSStream)   |           If the host is a remote Gateway, this is over a WebSocket.
			//          +---------------+           Local proxy hosts use simple inproc messaging.
			//             |        ^
			//             v        |
			//    +------------+ +------------+
			//    | wsIncoming | | wsOutgoing |     ThrottleStreams that apply the user's throttling config, one each direction.
			//    +------------+ +------------+     If throttling is disabled, wsraw/wssock are piped directly to each other.
			//             |        ^
			//             v        |
			//          +---------------+
			//          |               |           wssock represents a logical socket that sends/recieves bytes on the
			//          |     wssock    |           remote (host) side.  The HTTP client is on the other end of this socket.
			//          |  (Duplexer2)  |
			//          +---------------+
			//                 /\
			//                 ||
			//                 \/
			//          +---------------+
			//          |               |           A WebSocket instance that parses the raw bytes received on and writes
			//          |      rws      |           WebSocket frames to the logical wssock.
			//          |  (WebSocket)  |
			//          +---------------+
			//
			// Separately, ws is the connection between the target server and the daemon.

			txn.wsraw = new stream.Duplex({
				read: function() {
					self.send({
						msg: 'wsr',
						id: msg.id
					});
				},
				write: function(chunk, enc, cb) {
					if (txn._wsPause === true) {
						txn._wsPause = cb;
						self.sendBin(3, msg.id, chunk);
					}
					self.sendBin(3, msg.id, chunk, cb);
				}
			});

			if (self.inspector.config.throttle && self.inspector.config.throttle.downloadThroughput) {
				txn.wsIncoming = new ThrottleStream({ bps: self.inspector.config.throttle.downloadThroughput });
				txn.wsraw.pipe(txn.wsIncoming);
			}
			else txn.wsIncoming = txn.wsraw;

			if (self.inspector.config.throttle && self.inspector.config.throttle.uploadThroughput) {
				txn.wsOutgoing = new ThrottleStream({ bps: self.inspector.config.throttle.uploadThroughput });
			}
			else txn.wsOutgoing = txn.wsraw;

			txn.wssock = duplexer2(txn.wsOutgoing, txn.wsIncoming);

			txn.wssock.setTimeout = txn.wssock.setNoDelay = function() {};

			ws.on('close', function() {
				self.send({
					m: 'wsclose',
					id: msg.id
				});
				txn.ws = null;
				self.emit('ws-close', txn);
				
			});

			ws.on('error', function(err) {
				self.emit('ws-error', txn, err);
			});

			ws.on('upgrade', function(res) {
				self.send({
					m: 'wsupg',
					id: msg.id,
					headers: res.headers
				});
				
				txn.resStatus = res.statusCode;
				txn.resMessage = res.statusMessage;
				txn.resHeaders = res.headers;

				self.emit('ws-upgrade', txn);
			});

			ws.on('open', function() {
				// ws automatically responds to pings, which we do not want
				ws._receiver.removeAllListeners('ping');
				ws._receiver.on('ping', function(data) {
					ws.emit('ping', data);
				});

				// synthesize a parser for the client ws data stream
				self.cwss.handleUpgrade({
					method: 'GET',
					headers: msg.headers,
					connection: {},
				}, txn.wssock, {}, function(rws) {
					// this is called synchronously (unless verifyClient is used, which we don't)
					txn.rws = rws;
					rws._receiver.removeAllListeners('ping');
					rws._receiver.on('ping', function(data) {
						ws.ping(data);
					});

					rws.on('message', function(data) {
						ws.send(data);
						self.emit('ws-frame-sent', txn, data);
					});

					rws.on('pong', function(data) {
						ws.pong(data);
					});
				});


				self.send({
					m: 'wsopen',
					id: msg.id
				});
			});

			ws.on('message', function(data) {
				txn.rws.send(data); // TODO: better flow control
				self.emit('ws-frame-received', txn, data);
			});

			ws.on('ping', function(data) {
				txn.rws.ping(data);
			});

			ws.on('pong', function(data) {
				txn.rws.pong(data);
			});

			ws.on('unexpected-response', function(req, res) {
				self.send({
					m: 'wserr',
					id: msg.id,
					code: res.statusCode,
					msg: res.statusMessage,
					headers: res.headers
				});

				self.emit('ws-unexpected-response', txn, {
					statusCode: res.statusCode,
					statusMessage: res.statusMessage,
					headers: res.headers
				});
			});

			self.send({
				m: 'wsack',
				id: msg.id
			});

			self.emit('ws-request', txn);

			break;

		case 'wsclose':
			var txn = self.inspector.reqs[msg.id];
			if (txn) {
				if (txn.ws) txn.ws.close();
			} 
			break;


		case 'e':
			var txn = self.inspector.reqs[msg.id];
			if (txn) {
				if (txn.reqBody) txn.reqBody.input.end();
				self.emit('req-end', txn);
			}
			break;

		case 'err':
			var txt, txn = self.inspector.reqs[msg.id];
			if (txn) {
				switch (msg.t) {
					case 'req-err': txt = 'request error: ' + msg.msg; break;
					case 'timeout': txt = 'gateway timeout'; break;
					case 'err': txt = msg.msg; break;
					default: txt = '[unknown] ' + msg.msg;
				}

				self.emit('req-error', txn, new Error(txt));
				self.inspector.script.done(txn);
			}
			break;

		case 'cx':
			self.emit('error', new Error('Your subscription has ended.  Visit https://netsleuth.io/ for more information.'));
			break;

		case 'blocked':
			var txn = new HTTPTransaction(self, msg);
			txn.complete = true;
			txn.resStatus = 450;
			txn.resMessage = 'Request Blocked';
			txn.resHeaders = {};
			self.emit('req-blocked', txn, msg.rule);
			break;

		case 'msg':
			self.emit('console-msg', msg.t, msg.msg);
			break;

		case 'cfg':

			clearInterval(self._pinger);
			clearTimeout(self._pingto);

			self._pinger = setInterval(function() {
				try {
					clearTimeout(self._pingto);
					self.ws.ping();
					self._pingto = setTimeout(function() {
						console.error('ping timeout', self.gateway);
						self.ws.close();
					}, 10000);
					
				} catch (ex) {
					console.error(ex);
				}
			}, msg.ping);
			break;

		case 'ej':
			self.serviceError = new GatewayError(403, 'This device was disconnected from the gateway because you logged in from another device.  Type "reconnect" to reconnect.');
			console.log(self.serviceError);
			self.state = Target.SERVICE_STATE.ERROR;
			self.emit('force-disconnect');			
			break;
	}

};

Target.prototype.sendConfig = function() {
	this.send({
		m: 'config',
		config: {
			blockedUrls: this.inspector.config.blockedUrls,
			ua: this.inspector.config.ua,
			throttle: this.inspector.config.throttle,
			noCache: this.inspector.config.noCache
		}
	});
};


exports = module.exports = Target;
