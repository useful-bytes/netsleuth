var stream = require('stream'),
	util = require('util'),
	WebSocket = require('ws');

function ResponseBodyForwarder(id, sendBin) {
	stream.Writable.call(this);
	this.id = id;
	this.sendBin = sendBin;
	this.seen = 0;
}
util.inherits(ResponseBodyForwarder, stream.Writable);

ResponseBodyForwarder.prototype._write = function(chunk, enc, cb) {
	var self = this;
	if (!(chunk instanceof Buffer)) chunk = Buffer.from(chunk, enc);
	this.seen += chunk.length;

	this.sendBin(2, this.id, chunk, cb);

};

exports = module.exports = ResponseBodyForwarder;