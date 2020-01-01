var stream = require('stream'),
	util = require('util'),
	WebSocket = require('ws');

function ResponseBodyForwarder(id, ws) {
	stream.Writable.call(this);
	this.id = id;
	this.ws = ws;
	this.seen = 0;
	this.buffer = null;
}
util.inherits(ResponseBodyForwarder, stream.Writable);

ResponseBodyForwarder.prototype._write = function(chunk, enc, cb) {
	var self = this;
	if (!(chunk instanceof Buffer)) chunk = new Buffer(chunk, enc);
	this.seen += chunk.length;

	if (this.ws.readyState == WebSocket.OPEN) {
		if (this.buffer) this.flushBuffer();
		this.report(chunk, cb);
	} else {
		if (!this.buffer) this.buffer = [];
		this.buffer.push(chunk);
		cb();
	}

};

ResponseBodyForwarder.prototype._final = function(cb) {
	var self = this;
	if (this.buffer && this.ws.once) {
		this.ws.once('open', function() {
			self.flushBuffer();
		});
	}
	cb();
};

ResponseBodyForwarder.prototype.flushBuffer = function() {
	this.report(Buffer.concat(this.buffer));
	this.buffer = null;
};

ResponseBodyForwarder.prototype.report = function(chunk, cb) {
	var header = new Buffer(5);
	header.writeUInt8(2, 0, true);
	header.writeUInt32LE(this.id, 1, true);
	this.ws.send(Buffer.concat([header, chunk], chunk.length + 5), {}, cb);
};

exports = module.exports = ResponseBodyForwarder;