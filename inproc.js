var http = require('http'),
	fs = require('fs'),
	os = require('os'),
	url = require('url'),
	path = require('path'),
	WebSocket = require('ws'),
	util = require('util'),
	ResponseBodyForwarder = require('./response-body-forwarder'),
	joinRaw = require('./join-raw'),
	resourceType = require('./resource-type'),
	installHooks = require('./install-hooks'),
	daemon = require('./lib/daemon'),
	rcfile = require('./lib/rcfile'),
	getStackFrames = require('./get-stack-frames');

var globalConfig = rcfile.get(),
	dport = (globalConfig.port || 9000);


function getrcfile(from) {
	var rc;
	try {
		rc = fs.readFileSync(path.join(from, '.sleuthrc'));
		rc = JSON.parse(rc);
	} catch (ex) {
		if (ex.code == 'ENOENT' || ex.code == 'ENOTDIR') rc = null;
		else throw ex;
	}

	return rc;
}

function getProjectConfig(opts) {

	var projectConfig;

	if (opts && opts.rc) {
		projectConfig = getrcfile(opts.rc);
	} else {
		var wd,
			frames = getStackFrames(__filename);

		if (frames[0] && frames[0].url && frames[0].url.indexOf(path.sep) >= 0) {
			wd = frames[0].url.split(path.sep);
		} else {
			wd = process.cwd().split(path.sep);
		}

		while (!projectConfig && wd.length > 0) {
			projectConfig = getrcfile(wd.join(path.sep));
			wd.pop();
		}
	}

	return projectConfig;
}

function init(opts) {
	opts = opts || {};
	var projectConfig = getProjectConfig(opts);

	if (!opts.server) {
		opts.server = 'ws://127.0.0.1:' + dport;
		daemon.start(dport, function(err, reused) {
			if (err) console.error('Unable to start netsleuth daemon', err);
			else {
				if (!reused) console.error('Started netsleuth daemon on port ' + dport);
				
				initProject(opts, projectConfig);
			}
		});
	} else {
		initProject(opts, projectConfig);
	}
}

function initProject(opts, projectConfig) {

	if (projectConfig) {
		daemon.initProject(dport, projectConfig, function(err) {
			if (err) console.error('Unable to initialize netsleuth project', err);
		});
	}
}


function attach(opts, readyCb) {
	opts = opts || {};

	var projectConfig = getProjectConfig(opts);

	if (projectConfig) {
		if (!opts.name) opts.name = projectConfig.project;
	}


	if (typeof opts == 'string') opts = { name: opts };
	if (!opts.name) {
		opts.name = process.argv0 + '.' + process.pid;
		opts.transient = true;
	}

	if (opts.hooks !== false) installHooks();

	var ws = {}, reqId = 0, pending = [];

	var HttpClientRequest = http.ClientRequest;

	function ClientRequest(options, cb) {
		var self = this;
		HttpClientRequest.call(self, options, cb);

		if (typeof options == 'string') {
			options = url.parse(options);
		} else {
			options = util._extend({}, options);
		}

		var protocol = options.protocol;
		if (self.agent && self.agent.protocol) protocol = self.agent.protocol;
		self.__protocol = protocol;

		var num = self.__reqNum = ++reqId;
		var id = self.__reqId = process.argv0 + '.' + process.pid + ':' + num;

		if (self.__ignore === undefined && options.agent && options.agent.__ignore) {
			self.__ignore = true;
		} else {

			if (!self.__init) self.__init = getStackFrames(__filename);

			self.once('response', function(res) {
				
				var fwd = new ResponseBodyForwarder(num, ws);

				res.pipe(fwd);

				res.on('end', function() {
					if (res.complete) {
						send({
							method: 'Network.loadingFinished',
							params: {
								requestId: id,
								timestamp: Date.now() / 1000,
								encodedDataLength: fwd.seen
							}
						});
					}
				});

				var mime = res.headers['content-type'];
				if (mime) {
					mime = mime.split(';')[0];
				}

				for (var k in res.headers) {
					if (Array.isArray(res.headers[k])) res.headers[k] = res.headers[k].join('\n');
				}

				send({
					method: 'Network.responseReceived',
					params: {
						requestId: id,
						loaderId: 'ld',
						timestamp: Date.now() / 1000,
						wallTime: Date.now() / 1000,
						response: {
							protocol: protocol.substr(0,-1),
							url: protocol + '//' + self._headers.host + self.path,
							status: res.statusCode,
							statusText: res.statusMessage,
							headers: res.headers,
							headersText: 'HTTP/' + res.httpVersion + ' ' + res.statusCode + ' ' + res.statusMessage + '\r\n' + joinRaw(res.statusCode, res.statusMessage, res.rawHeaders),
							mimeType: mime,
							requestHeaders: self.__headers,
							requestHeadersText: self._header,
							remoteIPAddress: self.socket.remoteAddress,
							remotePort: self.socket.remotePort,
							connectionId: id
						},
						type: resourceType(res.headers['content-type'])
					}
				});
			});

			self.on('error', function(err) {
				send({
					method: 'Network.loadingFailed',
					params: {
						requestId: id,
						timestamp: Date.now() / 1000,
						type: 'Other',
						errorText: err.message
					}
				});


				if (self.listenerCount('error') < 2) {
					if (err instanceof Error) {
						throw err; // Unhandled 'error' event
					} else {
						var e = new Error('Unhandled "error" event. (' + err + ')');
						e.context = err;
						throw e;
					}
				}
			});
		}

	}
	util.inherits(ClientRequest, HttpClientRequest);

	ClientRequest.prototype._storeHeader = function(firstLine, headers) {
		HttpClientRequest.prototype._storeHeader.call(this, firstLine, headers);

		if (this.__ignore) return;

		var headers = this.__headers = {};
		var hlines = this._header.split('\r\n');

		for (var i = 1; i < hlines.length - 2; i++) {
			var colon = hlines[i].indexOf(':');
			headers[hlines[i].substr(0, colon)] = hlines[i].substr(colon + 2);
		}

		send({
			method: 'Network.requestWillBeSent',
			params: {
				requestId: this.__reqId,
				loaderId: 'ld',
				documentURL: 'docurl',
				timestamp: Date.now() / 1000,
				wallTime: Date.now() / 1000,
				request: {
					url: this.__protocol + '//' + this._headers.host + this.path,
					method: this.method,
					headers: headers,
					postData: ''
				},
				initiator: {
					type: 'script',
					stack: {
						callFrames: this.__init
					},
					url: 'script-url',
					lineNumber: 0
				},
				type: 'Other'
			}
		});
		
	};

	ClientRequest.prototype.write = function(chunk, encoding, cb) {
		var ret = http.OutgoingMessage.prototype.write.call(this, chunk, encoding, cb);

		if (!(chunk instanceof Buffer)) {
			chunk = new Buffer(chunk, encoding);
		}

		sendBin(1, this.__reqNum, chunk);


		return ret;
	};

	ClientRequest.prototype.end = function(chunk, encoding, cb) {
		var ret = http.OutgoingMessage.prototype.end.call(this, chunk, encoding, cb);

		if (typeof chunk == 'string') {
			chunk = new Buffer(chunk, encoding);
		}
		if (chunk instanceof Buffer) {
			sendBin(1, this.__reqNum, chunk);
		}

		return ret;
	};





	http.request = function request(options, cb) {
		return new ClientRequest(options, cb);
	};

	http.get = function(options, cb) {
		var req = http.request(options, cb);
		req.end();
		return req;
	};

	http.ClientRequest = ClientRequest;



	var agent = new http.Agent();
	agent.__ignore = true;

	function connect() {
		ws = new WebSocket(opts.server + '/inproc/' + opts.name, [], {
			agent: agent,
			headers: {
				Origin: 'netsleuth:api',
				PID: process.argv0 + '.' + process.pid,
				'Sleuth-Transient': !!opts.transient
			}
		});

		ws.on('open', function() {
			if (ws._socket) ws._socket.unref();
			if (pending.length) {
				var ops = pending;
				pending = [];
				for (var i = 0; i < ops.length; i++) {
					if (ops[i].op == 'msg') send(ops[i].msg);
					else sendBin(ops[i].type, ops[i].id, ops[i].chunk);
				}
			}
			if (readyCb) {
				readyCb();
				readyCb = null;
			}
		});
		ws.on('close', function() {
			setTimeout(connect, 5000);
		});
		ws.on('error', function(err) {
			console.error('netsleuth connection error', err);
			setTimeout(connect, 5000);
		});
	}


	if (!opts.server) {
		opts.server = 'ws://127.0.0.1:' + dport;
		daemon.start(dport, function(err, reused) {
			if (err) console.error('Unable to start netsleuth daemon', err);
			else {
				if (!reused) console.error('Started netsleuth daemon on port ' + dport);
				if (projectConfig) initProject(opts, projectConfig);
				connect();
			}
		});
	} else {
		if (projectConfig) initProject(opts, projectConfig);
		connect();
	}



	function send(msg) {
		if (ws && ws.readyState == WebSocket.OPEN) ws.send(JSON.stringify(msg));
		else pending.push({ op:'msg', msg:msg });
	}
	function sendBin(type, id, chunk) {
		if (ws && ws.readyState == WebSocket.OPEN) {
			var header = new Buffer(5);
			header.writeUInt8(type, 0, true);
			header.writeUInt32LE(id, 1, true);
			ws.send(Buffer.concat([header, chunk], chunk.length + 5));
		}
		else pending.push({ op:'bin', type:type, id:id, chunk:chunk });
	}
}


exports.attach = attach;
exports.init = init;