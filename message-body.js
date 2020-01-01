var stream = require('stream'),
	util = require('util'),
	zlib = require('zlib'),
	fs = require('fs'),
	os = require('os'),
	path = require('path'),
	mimeTypes = require('mime-types'),
	mimeDb = require('mime-db'),
	charset = require('./lib/charset'),
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

function MessageBody(id, message, opts) {
	var self = this;
	stream.Writable.call(self);
	opts = opts || {};
	self.id = id;
	self.date = new Date();
	self.message = message;
	self.headers = message.headers || message.getHeaders();
	self.length = 0;
	self.data = new Buffer(0);
	self.maxSize = isFinite(opts.maxSize) ? opts.maxSize : 1024 * 1024 * 10;
	if (opts.tmpDir) {
		self.tmpDir = opts.tmpDir;
	} else {
		self.tmpDir = path.join(os.tmpdir(), 'netsleuth');
		fs.mkdir(self.tmpDir, function() {});
	}
	self.kind = opts.kind || 'unknown';
	self.host = opts.host || '(unknown)';
	self.host = self.host.replace(':', '_');
	self.on('finish', function() {
		if (self.out) self.out.end();
	});
}
util.inherits(MessageBody, stream.Writable);

MessageBody.prototype._write = function(chunk, enc, cb) {
	this.append(chunk, cb);
};
// MessageBody.prototype._writev = function(chunks, cb) {
// 	var len = 0;
// 	this.data = Buffer.concat(chunks.map(function(c) {
// 		len += c.chunk.lenth;
// 		return c.chunk;
// 	}), len);
// 	cb();
// };

MessageBody.prototype.append = function(chunk, cb) {
	this.length += chunk.length;
	if (this.out) {
		this.out.write(chunk, cb);
	} else {
		this.data = Buffer.concat([this.data, chunk], this.length);
		if (this.length > this.maxSize) {
			this.toFile(cb);
		} else {
			if (cb) cb();
		}
	}
};

MessageBody.prototype.toFile = function(cb) {
	var self = this,
		ce = self.headers['content-encoding'],
		decoder;

	var filename = (+self.date) + ' [' + self.id + '] ' + self.kind + ' ' + self.host;

	filename += '.' + (mimeTypes.extension(self.headers['content-type']) || 'bin');

	if (ce == 'gzip')  self.decoder = zlib.createGunzip();
	else if (ce == 'inflate') self.decoder = zlib.createInflate();
	else if (ce == 'br') {
		if (iltorb) self.decoder = iltorb.decompressStream();
		else filename += '.br';
	}

	self.file = fs.createWriteStream(path.join(self.tmpDir, filename));

	self.file.on('error', function(err) {
		console.error('MessageBody to file error', err);
	});

	if (self.decoder) {
		self.decoder.on('error', function(err) {
			console.error('MessageBody to file decode error', err);
		});
		self.decoder.pipe(self.file);
		self.out = self.decoder;
	} else {
		self.out = self.file;
	}

	self.out.write(self.data, cb);
	self.data = null;
	self.emit('file', self.file.path);
};

MessageBody.prototype.get = function(cb) {

	var self = this,
		ce = self.headers['content-encoding'],
		decoder;


	if (self.file) {
		return cb(null, false, '(body too large; written to ' + self.file.path + ')');	
	}

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
			var ct = contentTypeParser(self.headers['content-type']),
				enc = charset(ct);

			if (enc) {

				if (enc == 'utf-8') {
					cb(null, false, body.toString());
				} else {
					if (Iconv) {
						try {
							var iconv = new Iconv(enc, 'utf-8//TRANSLIT//IGNORE');
							cb(null, false, iconv.convert(body).toString());

						} catch(ex) {
							cb(ex);
						}
					} else {
						cb(new Error('iconv failed to load; cannot handle charset ' + enc));
					}
				}

			} else {
				cb(null, true, body.toString('base64'));
			}

		}
	});
};

exports = module.exports = MessageBody;