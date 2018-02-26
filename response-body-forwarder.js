var stream = require('stream'),
	util = require('util'),
	WebSocket = require('ws');

function ResponseBodyForwarder(id, ws) {
	stream.Writable.call(this);
	this.id = id;
	this.ws = ws;
	this.seen = 0;
}
util.inherits(ResponseBodyForwarder, stream.Writable);

ResponseBodyForwarder.prototype._write = function(chunk, enc, cb) {
	if (this.ws.readyState == WebSocket.OPEN) {
		if (!(chunk instanceof Buffer)) chunk = new Buffer(chunk, enc);
		this.seen += chunk.length;
		var header = new Buffer(5);
		header.writeUInt8(2, 0, true);
		header.writeUInt32LE(this.id, 1, true);
		this.ws.send(Buffer.concat([header, chunk], chunk.length + 5), {}, cb);
	} else cb();
};

exports = module.exports = ResponseBodyForwarder;