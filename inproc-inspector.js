var EventEmitter = require('events'),
	util = require('util'),
	WebSocket = require('ws'),
	clipboardy = require('clipboardy'),
	notifier = require('node-notifier'),
	RemoteConsole = require('./remote-console'),
	SessionCLI = require('./session-cli'),
	MessageBody = require('./message-body');

function InprocInspector(server, opts) {
	var self = this;
	self.opts = opts;
	self.clients = [];
	self.targets = [];
	self.reqs = {};
	self.lastReq = {};
	self.console = new RemoteConsole(self);
	self.sessionCLI = new SessionCLI(self);
	self.notify = [];
}
util.inherits(InprocInspector, EventEmitter);

InprocInspector.prototype.close = function() {};

InprocInspector.prototype.broadcast = function(msg) {
	var self = this;
	if (typeof msg == 'object') msg = JSON.stringify(msg);
	self.clients.forEach(function(ws) {
		if (ws.readyState == WebSocket.OPEN) ws.send(msg);
	});
};
InprocInspector.prototype.broadcastTargets = function(msg) {
	var self = this;
	self.targets.forEach(function(ws) {
		if (ws.readyState == WebSocket.OPEN) ws.send(msg);
	});
};

InprocInspector.prototype.connection = function(ws, req) {
	var self = this;
	self.clients.push(ws);

	ws.on('message', function(data) {
		try {
			var msg = JSON.parse(data);
			switch (msg.method) {

				case 'Network.enable':
					csend({
						method: 'Gateway.connectionState',
						params: {
							state: self.targets.length ? 1 : 2
						}
					});

				case 'Network.getResponseBody':
					var info = self.reqs[msg.params.requestId],
						body = info && info.resBody;

					if (body) {
						body.get(function(err, b64, body) {
							if (err) {
								self.console.error('Error getting the response body of ' + info.req.method + ' ' + info.req.url + ': ' + err.message);
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
					}
					break;

				case 'Clipboard.write':
					clipboardy.write(msg.params.text);
					break;

				case 'Runtime.evaluate':
					self.sessionCLI.parse(msg, reply);
					break;

				default:
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

		function csend(msg) {
			ws.send(JSON.stringify(msg));
		}

		// enable console
		csend({
			method: 'Runtime.executionContextCreated',
			params: {
				context: {
					id: 1,
					name: 'default',
					origin: 'origin'
				}
			}
		});
		// self.broadcastTargets(data);
	});

	ws.on('error', function(err) {
		console.error('inproc inspector connection error', err);
	});

	ws.on('close', function() {
		for (var i = 0; i < self.clients.length; i++) {
			if (self.clients[i] == ws) return self.clients.splice(i, 1);
		}
	});


};

InprocInspector.prototype.updateTargets = function() {
	var self = this;

	console.log(self.targets.length + ' targets');

	self.broadcast({
		method: 'Gateway.connectionState',
		params: {
			state: self.targets.length ? 1 : 2,
			message: 'No connected targets'
		}
	});

	if (self.targets.length == 0) {
			self.emit('no-targets');
		}

	if (self.targets.length == 1) {
		self.emit('has-targets');
	}
}

InprocInspector.prototype.target = function(ws, req) {
	var self = this;
	self.targets.push(ws);
	ws.pid = req.headers.pid;

	self.console.info(ws.pid + ' connected');

	ws.on('message', function(data) {
		if (typeof data == 'string') {

			try {
				var msg = JSON.parse(data);

				var id = msg.params.requestId;

				switch (msg.method) {
					case 'Network.requestWillBeSent':
						var info = self.reqs[id] = {
							req: msg.params.request
						};
						self.lastReq[msg.params.nsgroup] = info;


						var headers = msg.params.request.headers;

						for (var k in headers) {
							var normalized = k.toLowerCase();
							if (normalized != k) {
								headers[normalized] = headers[k];
								delete headers[k];
							}
						}

						if ((headers['content-length'] || headers['transfer-encoding'] == 'chunked') && msg.params.request.method != 'HEAD') {
							info.reqBody = new MessageBody(id.replace(':', '_'), info.req, {
								maxSize: 1024 * 100,
								kind: 'req',
								host: info.req.headers.host
							});
							info.reqBody.on('file', function() {
								self.broadcast({
									method: 'Gateway.updateRequestBody',
									params: {
										id: id,
										sentToDisk: true
									}
								});
							});
						}


						for (var i = 0; i < self.notify.length; i++) {
							var n = self.notify[i];
							if (n.method == '*' || n.method == msg.params.request.method) {
								if (n.rex.test(msg.params.request.url)) {
									notifier.notify({
										title: self.opts.name,
										message: msg.params.request.method + ' ' + msg.params.request.url
									});
									break;
								}
							}
						}
						break;

					case 'Network.requestComplete':
						var info = self.reqs[id];
						if (info && info.reqBody) info.reqBody.end();
						return;

					case 'Network.responseReceived':
						var info = self.reqs[id];
						info.res = msg.params.response;
						info.resBody = new MessageBody(id.replace(':', '_'), info.res, {
							kind: 'res',
							host: ws.pid
						});
						break;

					case 'Network.loadingFinished':
					case 'Network.loadingFailed':
						var info = self.reqs[id];
						if (info && info.resBody) info.resBody.end();
						break;
						
				}
			} catch (ex) {
				console.error('Client protocol error:', ex.stack);
			}

			self.broadcast(data);

		} else {

			if (data.length > 5) {
				var type = data.readUInt8(0),
					num = data.readUInt32LE(1),
					id = req.headers.pid + ':' + num,
					info = self.reqs[id];

				if (info) {
					if (type == 1) {
						var payload = data.slice(5);
						if (info.reqBody) {
							info.reqBody.append(payload);
							if (!info.reqBody.file) {
								self.broadcast({
									method: 'Gateway.updateRequestBody',
									params: {
										id: id,
										body: payload.toString()
									}
								});
							}
						} else console.error('missing reqBody for ' + id);
					} else if (type == 2) {
						self.broadcast({
							method: 'Network.dataReceived',
							params: {
								requestId: id,
								timestamp: Date.now() / 1000,
								dataLength: data.length - 5,
								encodedDataLength: data.length - 5
							}
						})
						self.reqs[id].resBody.append(data.slice(5));
					}
				}

			}

		}
	});


	ws.on('close', function() {
		for (var i = 0; i < self.targets.length; i++) {
			if (self.targets[i] == ws) {
				self.targets.splice(i, 1);
				break;
			}
		}
		self.console.info(ws.pid + ' disconnected');
		self.updateTargets();
	});

	ws.on('error', function(err) {
		self.console.error('Socket error from ' + ws.pid + ': ' + err.message);
	});

	self.updateTargets();
};


exports = module.exports = InprocInspector;
