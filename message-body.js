var stream = require('stream'),
	util = require('util'),
	zlib = require('zlib'),
	iltorb,
	Iconv,
	contentTypeParser = require('content-type-parser');


MessageBody.native = true;
try {
	iltorb = require('iltorb');
} catch (ex) {
	console.warn('Unable to load iltorb native module.', ex.message);
	MessageBody.native = false;
}
try {
	Iconv = require('iconv').Iconv;
} catch (ex) {
	console.warn('Unable to load iconv native module.', ex.message);
	MessageBody.native = false;
}

function MessageBody(id, message, chunk) {
	stream.Writable.call(this);
	this.message = message;
	this.data = chunk || new Buffer(0);
}
util.inherits(MessageBody, stream.Writable);

MessageBody.prototype._write = function(chunk, enc, cb) {
	this.append(chunk);
	cb();
};
MessageBody.prototype._writev = function(chunks, cb) {
	var len = 0;
	this.data = Buffer.concat(chunks.map(function(c) {
		len += c.chunk.lenth;
		return c.chunk;
	}), len);
	cb();
}

MessageBody.prototype.append = function(chunk) {
	this.data = Buffer.concat([this.data, chunk], this.data.length + chunk.length);
};

MessageBody.prototype.get = function(cb) {

	var self = this,
		ce = self.message.headers['content-encoding'],
		decoder;

	if (ce == 'gzip') {
		decoder = zlib.gunzip;
	} else if (ce == 'inflate') {
		decoder = zlib.inflate;
	} else if (ce == 'br') {
		if (iltorb) {
			decoder = iltorb.decompress;
		} else {
			decoder = function(b, cb) { cb(new Error('iltorb failed to load; cannot decompress brotli-compressed response')); };
		}
	} else {
		decoder = function(b, cb) { cb(null, b); };
	}

	decoder(self.data, function(err, body) {

		if (err) {
			cb(err);
		} else {
			var b64 = false,
				charset = 'utf-8';

			var ct = contentTypeParser(self.message.headers['content-type']);
			if (ct) {

				if (ct.type == 'text' || (ct.type == 'application' && ct.subtype == 'json')) {
					var charset = ct.get('charset') || 'windows-1252';

					if (charset == 'utf-8') {
						cb(null, false, body.toString());
					} else {
						if (Iconv) {
							try {
								var iconv = new Iconv(charset, 'utf-8//TRANSLIT//IGNORE');
								cb(null, false, iconv.convert(body).toString());

							} catch(ex) {
								cb(ex);
							}
						} else {
							cb(new Error('iconv failed to load; cannot handle charset ' + charset));
						}
					}

				} else {
					cb(null, true, body.toString('base64'));
				}
			} else {
				cb(null, true, body.toString('base64'));
			}

		}
	});
};

exports = module.exports = MessageBody;