var http = require('http'),
	fs = require('fs'),
	path = require('path'),
	events = require('events'),
	util = require('util'),
	worker_threads = require('worker_threads'),
	getStackFrames = require('../get-stack-frames');

var config = worker_threads.workerData,
	parent = worker_threads.parentPort,
	scripts = [];


function Host() {
	events.EventEmitter.call(this);
}
util.inherits(Host, events.EventEmitter);
Host.prototype.emit = function(type) {
	if (type == 'error') {
		return events.EventEmitter.prototype.emit.apply(this, arguments);
	}

	var handler = this._events[type],
		args = Array.prototype.slice.call(arguments, 1),
		results = [];

	if (handler === undefined) {
		return Promise.resolve(results);
	} else if (typeof handler == 'function') {
		results.push(handler.apply(this, args));
	} else {
		for (var i = 0; i < handler.length; i++) {
			results.push(handler[i].apply(this, args));
		}
	}

	return Promise.all(results);

};

function Request(txn) {
	this.method = txn.method;
	this.protocol = txn.targetProto;
	this.host = txn.targetHost;
	this.url = txn.targetPath;
	this.httpVersion = txn.originalVer;
	this.headers = Object.assign({}, txn.reqHeaders);
	this.sent = false;
}
util.inherits(Request, events.EventEmitter);

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
	if (this.synthenticResponse) throw new Error('A response has already been generated for this request.');
	if (this.sent) throw new Error('This request has been released to the target server.');
	return new SyntheticResponse(this, statusCode, headers, body);
};

function SyntheticResponse(req, statusCode, headers, body) {
	this.request = req;
	req.synthenticResponse = this;

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

	this.statusCode = statusCode || 200;
	this.statusMessage = http.STATUS_CODES[this.statusCode] || '(unknown)';
	this.headers = {};

	if (typeof body == 'string') this.body = Buffer.from(body);
	else if (Buffer.isBuffer(body)) this.body = body;
	else if (typeof body == 'object') {
		this.body = Buffer.from(JSON.stringify(body));
		this.headers['Content-Type'] = 'application/json';
	}
	if (this.body) this.headers['Content-Length'] = this.body.length;
	else throw new Error('Streaming body support not implemented.');

	Object.assign(this.headers, headers);
}
util.inherits(SyntheticResponse, events.EventEmitter);

SyntheticResponse.prototype.toObject = function() {
	return {
		statusCode: this.statusCode,
		statusMessage: this.statusMessage,
		headers: this.headers,
		body: this.body
	};
};
SyntheticResponse.prototype.transferList = function() {
	var list = [];
	if (this.body) list.push(this.body.buffer);
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

				if (req.synthenticResponse) return parent.postMessage({
					m: 'rok',
					id: msg.txn.id,
					res: req.synthenticResponse.toObject()
				}, req.synthenticResponse.transferList());

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
				console.error(err);
			});
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