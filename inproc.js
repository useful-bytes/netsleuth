var http = require('http'),
 	https = require('https'),
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
	Daemon = require('./lib/daemon'),
	rcfile = require('./lib/rcfile'),
	getStackFrames = require('./get-stack-frames');

var globalConfig = rcfile.get(),
	rexEscape = /([\\^$.|?*+()\[\]{}])/g, wildcard = /\\\*/g,
	uconfig = {};

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
	var projectConfig = getProjectConfig(opts) || {};
	var config = Object.assign({}, globalConfig, projectConfig.config, opts.config);

	var daemon = new Daemon(config);
	
	daemon.start(function(err, reused, host) {
		if (err) console.error('Unable to start netsleuth daemon', err);
		else {
			if (!reused) console.error('Started netsleuth daemon on ' + host);
			
			initProject(daemon, projectConfig);
		}
	});

}

function initProject(daemon, projectConfig) {
	if (projectConfig) {
		daemon.initProject(projectConfig, function(err) {
			if (err) console.error('Unable to initialize netsleuth project', err);
		});
	}
}


function attach(opts, readyCb) {
	if (typeof opts == 'function') {
		readyCb = opts;
		opts = {};
	} else if (typeof opts == 'string') {
		opts = { name: opts };
	} else if (!opts) {
		opts = {};
	}
	var projectConfig = getProjectConfig(opts);
	var config = Object.assign({}, globalConfig, projectConfig && projectConfig.config, opts.config);

	var daemon = new Daemon(config);

	if (projectConfig) {
		if (!opts.name) opts.name = projectConfig.project;
	}


	if (!opts.name) {
		opts.name = process.argv0 + '.' + process.pid;
		opts.transient = true;
	}

	if (opts.hooks !== false) installHooks();

	var ws = {}, reqId = 0, pending = [];

	var HttpClientRequest = http.ClientRequest;

	function ClientRequest(input, options, cb) {
		// NOTE: This is the patched ClientRequest hooked by netsleuth
		var self = this;
		var num = self.__reqNum = ++reqId;
		var id = self.__reqId = process.argv0 + '.' + process.pid + ':' + num;

		var args = Array.prototype.slice.call(arguments);

		if (typeof input == 'string') {
			input = url.parse(input);
		} else if (url.URL && input instanceof url.URL) {
			input = urlToOptions(input);
		} else {
			cb = options;
			options = input;
			input = null;
		}

		if (typeof options == 'function') {
			cb = options;
			options = Object.assign({}, input);
		} else {
			options = Object.assign({}, input, options);
		}

		var protocol = (options.uri && options.uri.protocol) || options.protocol || '';
		if (self.agent && self.agent.protocol) protocol = self.agent.protocol || '';
		self.__protocol = protocol;

		HttpClientRequest.apply(self, args);

		if (self.__ignore === undefined && options.agent && options.agent.__ignore) {
			self.__ignore = true;
		} else {

			if (!self.__init) self.__init = getStackFrames(__filename);

			self.once('response', function(res) {
				
				var fwd = new ResponseBodyForwarder(num, ws);
				
				// Save the stream's current flow state so we can restore it after calling pipe()
				// This is necessary so that res.pipe(…) and its call to res.on('data', …) do not
				// automatically call res.resume() and begin the flow of data before the inspected
				// application expects data to flow -- this can result in missed `data` events if
				// listeners are attached in later ticks.
				var flowing = res._readableState.flowing;
				res._readableState.flowing = false;

				res.pipe(fwd);

				res._readableState.flowing = flowing;

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

				if (!self.__ignore && uconfig.noCache) res.headers['cache-control'] = 'no-store';

				send({
					method: 'Network.responseReceived',
					params: {
						requestId: id,
						loaderId: 'ld',
						timestamp: Date.now() / 1000,
						wallTime: Date.now() / 1000,
						response: {
							protocol: protocol.substr(0,-1),
							url: protocol + '//' + self.getHeader('host') + self.path,
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
						throw err; // Unhandled 'error' event (in user code -- not netsleuth)
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
		// NOTE: This is a patched ClientRequest method hooked by netsleuth

		// First, apply overrides enabled in the inspector GUI (unless this is a special ignored request)
		if (!this.__ignore) {
			// "Offline" checkbox
			if (uconfig.throttle && uconfig.throttle.offline) {
				this._hasBody = false;
				blocked(this);
				return this.emit('error', new RequestBlockedError('Request blocked by netsleuth.  The "Offline" box is checked in the inspector GUI.'));
			}

			// "Request blocking" tab
			if (uconfig.blockedUrls && uconfig.blockedUrls.length) {
				var url = this.__protocol + '//' + this.getHeader('host') + this.path;
				for (var i = 0; i < uconfig.blockedUrls.length; i++) {
					if (uconfig.blockedUrls[i].test(url)) {
						this._hasBody = false;
						blocked(this);
						return this.emit('error', new RequestBlockedError('Request blocked by netsleuth.  URL matches a request blocking pattern set in the inspector GUI.'));
					}
				}
			}

			// "Disable cache" checkbox
			if (uconfig.noCache) {
				headers['cache-control'] = ['Cache-Control', 'no-cache'];
				delete headers['if-none-match'];
				delete headers['if-modified-since'];
			}

			// "User agent" override
			if (uconfig.ua) {
				headers['user-agent'] = ['User-Agent', uconfig.ua];
			}
		}

		HttpClientRequest.prototype._storeHeader.call(this, firstLine, headers);

		var self = this;
		if (!self.__ignore) {//process.nextTick(function() {

			var headers = self.__headers = {};
			var hlines = self._header.split('\r\n');

			for (var i = 1; i < hlines.length - 2; i++) {
				var colon = hlines[i].indexOf(':');
				headers[hlines[i].substr(0, colon)] = hlines[i].substr(colon + 2);
			}

			send({
				method: 'Network.requestWillBeSent',
				params: {
					requestId: self.__reqId,
					nsgroup: self.__nsgroup,
					loaderId: 'ld',
					documentURL: 'docurl',
					timestamp: Date.now() / 1000,
					wallTime: Date.now() / 1000,
					request: {
						url: self.__protocol + '//' + self.getHeader('host') + self.path,
						method: self.method,
						headers: headers,
						postData: ''
					},
					initiator: {
						type: 'script',
						stack: {
							callFrames: self.__init
						},
						url: 'script-url',
						lineNumber: 0
					},
					type: 'Other'
				}
			});
		}
		//});
		
	};

	ClientRequest.prototype.write = function(chunk, encoding, cb) {
		// NOTE: This is a patched ClientRequest method hooked by netsleuth
		var ret = http.OutgoingMessage.prototype.write.call(this, chunk, encoding, cb);

		if (this.__ignore) return ret;

		if (typeof encoding == 'function') encoding = undefined;

		if (!(chunk instanceof Buffer)) {
			chunk = Buffer.from(chunk, encoding);
		}

		sendBin(1, this.__reqNum, chunk);


		return ret;
	};

	ClientRequest.prototype.end = function(chunk, encoding, cb) {
		// NOTE: This is a patched ClientRequest method hooked by netsleuth
		var ret = http.OutgoingMessage.prototype.end.call(this, chunk, encoding, cb);

		if (this.__ignore) return ret;

		if (typeof encoding == 'function') encoding = undefined;
		if (typeof chunk == 'string') {
			chunk = Buffer.from(chunk, encoding);
		}
		if (chunk instanceof Buffer) {
			sendBin(1, this.__reqNum, chunk);
		}
		send({
			method: 'Network.requestComplete',
			params: {
				requestId: this.__reqId
			}
		});

		return ret;
	};





	http.request = function request(url, options, cb) {
		return new ClientRequest(url, options, cb);
	};

	http.get = function(url, options, cb) {
		var req = http.request(url, options, cb);
		req.end();
		return req;
	};

	https.request = function request(input, options, cb) {


		var args = Array.prototype.slice.call(arguments);

		if (typeof input == 'string') {
			input = url.parse(input);
		} else if (url.URL && input instanceof url.URL) {
			input = urlToOptions(input);
		} else {
			cb = options;
			options = input;
			input = null;
		}

		if (typeof options == 'function') {
			cb = options;
			options = Object.assign({}, input);
		} else {
			options = Object.assign({}, input, options);
		}

		options._defaultAgent = https.globalAgent;

		return new ClientRequest(options, cb);
	};

	https.get = function(url, options, cb) {
		var req = https.request(url, options, cb);
		req.end();
		return req;
	};

	http.ClientRequest = ClientRequest;
	https.ClientRequest = ClientRequest;



	var agent = new http.Agent();
	agent.__ignore = true;

	function connect() {
		var headers = {
			Origin: 'netsleuth:api',
			PID: process.argv0 + '.' + process.pid,
			'Sleuth-Transient': !!opts.transient,
		};
		if (opts.icon) headers.Icon = opts.icon;

		ws = new WebSocket('ws://' + daemon.host + '/inproc/' + opts.name, [], {
			agent: agent,
			headers: headers
		});

		ws.on('open', function() {
			if (pending.length) {
				var ops = pending;
				pending = [];
				for (var i = 0; i < ops.length; i++) {
					if (ops[i].op == 'msg') send(ops[i].msg);
					else if (ops[i].op == 'close') close();
					else sendBin(ops[i].type, ops[i].id, ops[i].chunk);
				}
			}
		});

		ws.on('message', function(msg) {
			msg = JSON.parse(msg);
			switch (msg.m) {
				case 'ready':
					if (readyCb) {
						readyCb();
						readyCb = null;
					}
					if (ws._socket && opts.unref !== false) ws._socket.unref();
					break;

				case 'config':
					uconfig = msg.config;
					if (uconfig.blockedUrls) uconfig.blockedUrls = uconfig.blockedUrls.map(function(str) {
						if (str.substr(0, 4) == 'rex:') return new RegExp(str.substr(4));
						else return new RegExp(str.replace(rexEscape, '\\$&').replace(wildcard, '.+'));
					});
					break;
			}
		});

		ws.on('close', function() {
			setTimeout(connect, 5000);
		});
		ws.on('error', function(err) {
			console.error('netsleuth connection error', err);
		});
	}


	process.nextTick(function() {
		// start() does a daemon health check.  Do it on the next tick so that startup sync i/o (eg require())
		// does not accidentally cause a timeout in communication with the daemon
		daemon.start(function(err, reused, host, version) {
			if (err) console.error('Unable to start netsleuth daemon', err);
			else {
				if (!reused) console.error('Started netsleuth daemon v' + version + ' on ' + host);
				if (projectConfig && opts.initProject !== false) initProject(daemon, projectConfig);
				connect();
			}
		});
	});



	function blocked(req) {
		send({
			method: 'Gateway.blocked',
			params: {
				requestId: req.__reqId,
				method: req.method,
				headers: { host: req.getHeader('host') },
				url: req.path
			}
		});
	}
	function send(msg) {
		if (ws && ws.readyState == WebSocket.OPEN) ws.send(JSON.stringify(msg));
		else pending.push({ op:'msg', msg:msg });
	}
	function sendBin(type, id, chunk) {
		if (ws && ws.readyState == WebSocket.OPEN) {
			var header = Buffer.allocUnsafe(5);
			header.writeUInt8(type, 0, true);
			header.writeUInt32LE(id, 1, true);
			ws.send(Buffer.concat([header, chunk], chunk.length + 5));
		}
		else pending.push({ op:'bin', type:type, id:id, chunk:chunk });
	}

	function close() {
		process.nextTick(function() {
			ws.removeAllListeners();
			ws.close();
		});
	}

	return {
		close: function() {
			if (ws && ws.readyState == WebSocket.OPEN) {
				close();
			} else {
				pending.push({ op:'close' });
			}
		}
	}
}

function urlToOptions(url) {
	const options = {
		protocol: url.protocol,
		hostname: typeof url.hostname === 'string' && url.hostname.startsWith('[') ?
			url.hostname.slice(1, -1) :
			url.hostname,
		hash: url.hash,
		search: url.search,
		pathname: url.pathname,
		path: (url.pathname || '') + (url.search || ''),
		href: url.href
	};
	if (url.port !== '') {
		options.port = Number(url.port);
	}
	if (url.username || url.password) {
		options.auth = url.username + ':' + url.password;
	}
	return options;
}

function RequestBlockedError(msg) {
	Error.captureStackTrace(this, this.constructor);
	this.name = this.constructor.name;
	this.message = msg;
}
util.inherits(RequestBlockedError, Error);

exports.attach = attach;
exports.init = init;
exports.getUserConfig = function() { return uconfig; };
exports.RequestBlockedError = RequestBlockedError;