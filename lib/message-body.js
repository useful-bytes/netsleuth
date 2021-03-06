var stream = require('stream'),
	util = require('util'),
	zlib = require('zlib'),
	fs = require('fs'),
	os = require('os'),
	path = require('path'),
	mimeTypes = require('mime-types'),
	mimeDb = require('mime-db'),
	charset = require('./charset'),
	iltorb,
	Iconv,
	contentTypeParser = require('content-type-parser');

var UNSAFE = /[\\/:*?"<>|]/g;

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


function elideUrl(url, maxLength) {
	if (maxLength < 2) return '';
	if (url.length > maxLength) return url = url.substr(0, Math.floor(maxLength/2)-1) + '…' + url.substr(url.length - Math.round(maxLength/2));
	return url;
}

// MessageBody buffers HTTP request/response bodies in-memory until their size
// becomes too large, at which point it dumps the buffered data to disk and
// streams the rest to that file.
function MessageBody(txn, headers, opts) {
	var self = this;
	stream.Transform.call(self);
	opts = opts || {};
	self.input = self;
	self.txn = txn;
	self.headers = headers;
	self.length = 0;
	self.chunks = [];
	self.maxSize = isFinite(opts.maxSize) ? opts.maxSize : 1024 * 1024 * 10;
	self.fileable = true;
	self.warned = false;
	self.warnSize = isFinite(opts.warnSize) ? opts.warnSize : Math.floor(self.maxSize / 2);
	if (opts.tmpDir) {
		self.tmpDir = opts.tmpDir;
	} else {
		self.tmpDir = path.join(os.tmpdir(), 'netsleuth');
		fs.mkdir(self.tmpDir, function() {});
	}
	self.kind = opts.kind || 'unknown';
	self.on('finish', function() {
		if (self.out) self.out.end();
	});
}
util.inherits(MessageBody, stream.Transform);

MessageBody.prototype._transform = function(chunk, enc, cb) {
	this.length += chunk.length;
	this.push(chunk);
	if (this.out) {
		this.out.write(chunk, cb);
	} else {
		this.chunks.push(chunk);
		if (!this.warned && this.length > this.warnSize) {
			this.warned = true;
			this.emit('big');
			cb();
		} else if (this.fileable && this.length > this.maxSize) {
			this.toFile(cb);
		} else {
			cb();
		}
	}
};

MessageBody.prototype.data = function() {
	this.chunks = [Buffer.concat(this.chunks)];
	return this.chunks[0];
};

MessageBody.prototype.toFile = function(cb) {
	var self = this,
		ce = self.headers['content-encoding'],
		decoder;


	var ext = '.' + (mimeTypes.extension(self.headers['content-type']) || 'bin');

	if (ce == 'gzip')  self.decoder = zlib.createGunzip();
	else if (ce == 'inflate') self.decoder = zlib.createInflate();
	else if (ce == 'br') {
		if (iltorb) self.decoder = iltorb.decompressStream();
		else ext += '.br';
	}

	var filename = self.txn.date.toISOString() + ' [' + self.txn.id + ' ' + self.kind + '] ';

	var fullUrl = self.txn.originalProto + '_' + self.txn.originalHost + self.txn.originalPath;

	if (path.extname(fullUrl) == ext) ext = '';

	filename += elideUrl(fullUrl, 255 - filename.length - ext.length) + ext;

	filename = filename.replace(UNSAFE, '_');

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

	self.out.write(self.data(), cb);
	self.chunks = null;
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

	decoder(self.data(), function(err, body) {

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