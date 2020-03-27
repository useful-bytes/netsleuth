
var joinRaw = require('./join-raw'),
	MessageBody = require('./message-body');

function HTTPTransaction(target, msg, opts) {
	this.id = msg.id;
	this.date = Date.now();
	this.target = target;
	this.targetProto = msg.proto;
	this.targetHost = msg.host || msg.headers && msg.headers.host;
	this.targetPath = msg.url;
	this.originalProto = msg.proto;
	this.originalHost = msg.host || msg.headers && msg.headers.host;
	this.originalPath = msg.url;
	this.method = msg.method.toUpperCase();
	this.complete = false;
	this.remoteIP = msg.remoteIP;
	this.remotePort = msg.remotePort;
	this.stack = msg.stack || null;
	this.reqHeaders = {};
	this.reqRawHeaders = msg.raw;

	if (msg.headers) {
		for (var k in msg.headers) this.reqHeaders[k.toLowerCase()] = msg.headers[k];
	}

	if ((this.reqHeaders['content-length'] || this.reqHeaders['transfer-encoding'] == 'chunked') && this.method != 'HEAD') {
		this.reqBody = new MessageBody(msg.id, msg.headers, {
			maxSize: opts && opts.reqMaxSize,
			kind: 'req',
			host: msg.headers.host
		});
	} else this.reqBody = null;

	this.resHeaders = null;
	this.resBody = null;

}

HTTPTransaction.prototype.url = function() {
	return this.originalProto + '://' + this.originalHost + this.originalPath;
};

HTTPTransaction.prototype.getRawReqHeaders = function() {
	var raw = this.method + ' '  + this.originalPath + ' HTTP/1.1\r\n';
	if (this.reqRawHeaders) raw += joinRaw(this.reqRawHeaders);
	else for (var k in this.reqHeaders) {
		raw += k + ': ' + this.reqHeaders[k] + '\r\n';
	}
	return raw;
};
HTTPTransaction.prototype.getRawResHeaders = function() {
	return 'HTTP/1.1 ' + this.resStatus + ' ' + this.resStatus + '\r\n' + joinRaw(this.resRawHeaders);
};

exports = module.exports = HTTPTransaction;
