var EventEmitter = require('events'),
	util = require('util'),
	WebSocket = require('ws'),
	RemoteConsole = require('./remote-console')
	ResponseBody = require('./response-body');

function InprocInspector(server, opts) {
	var self = this;
	self.clients = [];
	self.targets = [];
	self.reqs = {};
	this.console = new RemoteConsole(this);
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
		// self.broadcastTargets(data);
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
						break;

					case 'Network.responseReceived':
						var info = self.reqs[id];
						info.res = msg.params.response;
						info.resBody = new ResponseBody(id, info.res);
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
					id = req.headers.pid + ':' + num;

				if (self.reqs[id]) {
					if (type == 1) {
						self.broadcast({
							method: 'Gateway.updateRequestBody',
							params: {
								id: id,
								body: data.slice(5).toString()
							}
						});
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
