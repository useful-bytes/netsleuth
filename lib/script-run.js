var http = require('http'),
	fs = require('fs'),
	path = require('path'),
	events = require('events'),
	util = require('util'),
	worker_threads = require('worker_threads'),
	getStackFrames = require('../get-stack-frames');

var config = worker_threads.workerData,
	parent = worker_threads.parentPort,
	scripts = [],
	reqs = {};

function Host() {
	events.EventEmitter.call(this);
	this.stopOnError = false;
	this.name = config.name;
	this.iid = config.iid;
}
util.inherits(Host, events.EventEmitter);

function Request(txn) {
	events.EventEmitter.call(this);
	this.id = txn.id;
	reqs[txn.id] = this;
	this.method = txn.method;
	this.protocol = txn.targetProto;
	this.host = txn.targetHost;
	this.url = txn.targetPath;
	this.httpVersion = txn.originalVer;
	this.headers = Object.assign({}, txn.reqHeaders);
	this.sent = false;
}
util.inherits(Request, events.EventEmitter);

Host.prototype.emit = Request.prototype.emit = function(type) {
	if (type == 'error') {
		return events.EventEmitter.prototype.emit.apply(this, arguments);
	}

	var handler = this._events[type],
		args = Array.prototype.slice.call(arguments, 1),
		results = [];

	if (handler === undefined) {
		return Promise.resolve(results);
	} else if (typeof handler == 'function') {
		try {
			results.push(handler.apply(this, args));
		} catch (ex) {
			results.push(Promise.reject(ex));
		}
	} else {
		for (var i = 0; i < handler.length; i++) {
			try {
				results.push(handler[i].apply(this, args));
			} catch (ex) {
				results.push(Promise.reject(ex));
			}
		}
	}

	return Promise.all(results);

};

Request.prototype.getHeader = function(name) {
	return this.headers[name];
};
Request.prototype.setHeader = function(name, val) {
	this.headers[name] = val;
};
Request.prototype.removeHeader = function(name) {
	delete this.headers[name];
};


Request.prototype.respond = function(statusCode, headers, body) {
	if (this.response) throw new Error('This request already has a response.');

	if (typeof statusCode != 'number' || statusCode < 100 || statusCode > 999) {
		body = headers;
		headers = statusCode;
		statusCode = 200;
	}

	if (typeof headers == 'object') {
		if (typeof body == 'undefined') {
			body = headers;
			headers = null;
		}
	} else {
		body = headers;
		headers = null;
	}

	var res = new Response(this, {});
	res.synthetic = true;

	res.statusCode = statusCode || 200;
	res.statusMessage = http.STATUS_CODES[res.statusCode] || '(unknown)';
	Object.assign(this.headers, headers);
	if (body) res.setBody(body);
	else throw new Error('Streaming body support not implemented.');

	return res;

};


function Response(req, txn) {
	this.request = req;
	req.response = this;
	this.statusCode = txn.resStatus;
	this.statusMessage = txn.resMessage;
	this.headers = Object.assign({}, txn.resHeaders);
}
util.inherits(Response, events.EventEmitter);

Response.prototype.setBody = function(body) {
	if (typeof body == 'string') {
		this.body = Buffer.from(body);
		this.headers['content-type'] = 'text/plain; charset=utf-8';
	}
	else if (Buffer.isBuffer(body)) this.body = body;
	else if (typeof body == 'object') {
		this.body = Buffer.from(JSON.stringify(body));
		this.headers['content-type'] = 'application/json';
	}
	if (this.body) this.headers['content-length'] = this.body.length;
};

Response.prototype.toObject = function() {
	return {
		statusCode: this.statusCode,
		statusMessage: this.statusMessage,
		headers: this.headers,
		body: this.body
	};
};
Response.prototype.transferList = function() {
	var list = [];
	// Make sure we don't attempt to transfer a Buffer that has a shared backing allocation
	// https://github.com/nodejs/node/issues/32752
	if (this.body && this.body.length == this.body.buffer.byteLength) list.push(this.body.buffer);
	return list;
};


global.host = new Host();
global.nodeConsole = console;
global.console = {};
['log','warn','error'].forEach(function(method) {
	console[method] = function() {
		nodeConsole[method].apply(nodeConsole, arguments);
		parent.postMessage({
			m: 'console',
			t: method,
			args: Array.prototype.slice.call(arguments),
			stack: getStackFrames(__filename)
		});
	};
});

fs.readdirSync(config.dir).forEach(function(file) {
	try {
		if (path.extname(file) == '.js') scripts.push(require(path.join(config.dir, file)));
	} catch (ex) {
		console.error('Failed to load interception script ' + file + '\n', ex);
	}
});


parent.on('message', function(msg) {
	switch (msg.m) {
		case 'r':
			var req = new Request(msg.txn);

			host.emit('request', req).then(function(results) {
				req.sent = true;

				for (var i = 0; i < results.length; i++) {
					if (results[i] === false) {
						return parent.postMessage({
							m: 'rok',
							id: msg.txn.id,
							block: true
						});
					}
				}

				if (req.response) return parent.postMessage({
					m: 'rok',
					id: msg.txn.id,
					res: req.response.toObject()
				}, req.response.transferList());

				var rmsg = {
					m: 'rok',
					id: msg.txn.id
				};

				if (msg.txn.method != req.method) rmsg.method = req.method;
				if (msg.txn.targetProto != req.protocol) rmsg.proto = req.protocol;
				if (msg.txn.targetHost != req.host) rmsg.host = req.host;
				if (msg.txn.targetPath != req.url) rmsg.path = req.url;
				if (!equal(msg.txn.reqHeaders, req.headers)) rmsg.headers = req.headers;
				if (this.buffer) rmsg.reqData = true;


				parent.postMessage(rmsg);
			}).catch(function(err) {
				parent.postMessage({
					m: 'rerr',
					id: msg.txn.id,
					stop: host.stopOnError,
					err: err
				});
			});
			break;

		case 'p':
			var req = reqs[msg.txn.id],
				res = new Response(req, msg.txn);

			if (req) req.emit('response', res).then(function(results) {
				
				for (var i = 0; i < results.length; i++) {
					if (results[i] === false) {
						return parent.postMessage({
							m: 'pok',
							id: msg.txn.id,
							block: true
						});
					}
				}


				var rmsg = {
					m: 'pok',
					id: msg.txn.id
				};

				if (res.statusCode != msg.txn.resStatus) rmsg.statusCode = res.statusCode;
				if (res.statusMessage =! msg.txn.resMessage) rmsg.statusMessage = res.statusMessage;
				if (!equal(msg.txn.resHeaders, res.headers)) rmsg.headers = res.headers;

				if (res.body) rmsg.body = res.body;

				parent.postMessage(rmsg, res.transferList());

			}).catch(function(err) {
				parent.postMessage({
					m: 'perr',
					id: msg.txn.id,
					stop: host.stopOnError,
					err: err
				});
			});

			break;
		case 'f':
			delete reqs[msg.id];
			break;
	}
});

parent.postMessage({
	m: 'ready',
	scripts: scripts.length
});


function equal(a, b) {
	for (var k in a) {
		if (a[k] != b[k]) return false;
	}
	for (var k in b) if (!a[k]) return false;
	return true;
}