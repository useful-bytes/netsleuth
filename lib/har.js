var fs = require('fs'),
	url = require('url'),
	contentTypeParser = require('content-type-parser'),
	charset = require('./charset'),
	reqHeaders = require('./req-headers'),
	package = require('../package.json');

function HAR(pathOrStream) {
	this.path = pathOrStream;
	this.entries = [];
}

HAR.prototype.entry = function(opts) {
	var entry = new HAREntry(opts);
	this.entries.push(entry.out);
	return entry;
};

HAR.prototype.har = function(merge) {
	if (merge) {
		merge.log.entries.push.apply(merge.log.entries, this.entries);
		return merge;
	} else {
		return {
			log: {
				version: '1.2',
				creator: {
					name: 'netsleuth',
					version: package.version
				},
				entries: this.entries
			}
		};
	}
};

HAR.prototype.save = function(cb) {
	var self = this;
	if (typeof self.path == 'string') {
		fs.readFile(self.path, function(err, existing) {
			if (err && err.code != 'ENOENT') {
				return cb(new Error('Failed to save HAR.  File already exists, but unable to read it.  ' + err.message));
			}

			var har;
			if (existing) {
				try {
					har = JSON.parse(existing);
					if (!har.log || !har.log.version || !har.log.creator || !Array.isArray(har.log.entries)) throw new Error('File is JSON, but it is missing required properties.');
				} catch (ex) {
					return cb(new Error('Failed to save HAR.  File already exists, but it is not a valid HAR file.  ' + ex.message));
				}

				har = self.har(har);
			} else {
				har = self.har();
			}

			fs.writeFile(self.path, JSON.stringify(har, null, '\t'), function(err) {
				if (err) cb(new Error('Failed to save HAR.  ' + err.message));
				else cb();
			});


		});
	} else {
		self.path.write(JSON.stringify(self.har()), cb);
	}
};

function HAREntry(opts) {
	this.opts = opts;
	this.out = {
		startedDateTime: '',
		time: -1,
		request: {},
		response: {},
		cache: {},
		timings: {
			blocked: -1,
			dns: -1,
			connect: -1,
			send: -1,
			wait: -1,
			receive: -1,
			ssl: -1
		}
	};
	this.reqBody = [];
	this.resBody = [];
	this.resText = '';
}

HAREntry.prototype.setReqBody = function(buf) {
	this.reqBody = [buf];
};

HAREntry.prototype.observe = function(req) {
	var self = this;

	self.req = req;
	self.start = new Date();
	self.out.startedDateTime = self.start.toISOString();

	self.out.request.method = self.opts.method;
	self.out.request.url = url.format(self.opts);
	self.out.request.httpVersion = 'http/1.1';
	var headers = self.out.request.headers = [];

	var msgHeaders = reqHeaders.get(req);
	for (var k in msgHeaders.values) headers.push({
		name: msgHeaders.names[k],
		value: msgHeaders.values[k].toString()
	});

	self.out.request.cookies = [];
	self.out.request.queryString = [];

	self.out.request.headersSize = -1;
	self.out.request.bodySize = -1;

	req.on('response', function(res) {
		self.receiveStart = new Date();
		self.out.timings.wait = self.receiveStart - self.sent;
		self.res = res;
		self.out.response.status = res.statusCode;
		self.out.response.statusText = res.statusMessage;
		self.out.response.httpVersion = 'http/1.1';
		var headers = self.out.response.headers = [];

		for (var k in res.headers) headers.push({
			name: k,
			value: res.headers[k].toString()
		})

		self.out.response.content = {
			mimeType: res.headers['content-type'] || 'x-unknown'
		};

		self.out.response.headersSize = -1;
		self.out.response.cookies = [];
		self.out.response.redirectURL = '';
		self.out.response._transferSize = -1;

	});
};

HAREntry.prototype.observeReqBody = function(stream) {
	var self = this,
		write = stream.write || stream.prototype.write,
		end = stream.end || stream.prototype.end;

	stream.write = function(chunk, enc, cb) {
		if (typeof enc == 'string' || typeof chunk == 'string') self.reqBody.push(Buffer.from(chunk, enc));
		else self.reqBody.push(chunk);

		return write.call(stream, chunk, enc, cb);
	};

	stream.end = function(chunk, enc, cb) {
		if (typeof chunk == 'string') self.reqBody.push(Buffer.from(chunk, enc));
		else if (Buffer.isBuffer(chunk)) self.reqBody.push(chunk);

		self.reqEnd();

		return end.call(stream, chunk, enc, cb);
	};
};

HAREntry.prototype.reqEnd = function() {
	var self = this;
	self.sent = new Date();
	self.out.timings.send = Date.now() - self.start;
	process.nextTick(function() {
		var reqBody = Buffer.concat(self.reqBody);
		var size = self.compressedReqLength || reqBody.length;
		self.out.request.bodySize = size;


		if (size) {
			var ct = contentTypeParser(self.req._headers['content-type']),
				enc = charset(ct),
				pd = self.out.request.postData = {
					mimeType: self.req._headers['content-type']
				};

			if (enc == 'utf-8') pd.text = reqBody.toString('utf-8');
			else {
				try {
					var iconv = new (require('iconv').Iconv)(enc, 'utf-8//TRANSLIT//IGNORE');
					pd.text = iconv.convert(reqBody).toString();
				} catch (ex) {
					enc = null;
				}
			}
			if (!enc) {
				// this is technically a violation of the HAR standard, but it makes no allowances
				// for non-text request bodies :(
				pd.text = reqBody.toString('base64');
				pd.encoding = 'base64';
			}
		}
	});
};

HAREntry.prototype.observeResBody = function(stream) {
	var self = this;

	stream.on('data', function(chunk) {
		if (typeof chunk == 'string') {
			if (!self.resText) self.resText = chunk;
			else self.resText += chunk;
		}
		else self.resBody.push(chunk);
	});

	stream.on('end', function() {
		self.out.time = Date.now() - self.start;
		self.out.timings.receive = Date.now() - self.receiveStart;
		if (self.resText.length) {
			self.out.response.bodySize = -1;
			self.out.response.content.size = -1;
			self.out.response.content.text = self.resText;
		} else {
			var resBody = Buffer.concat(self.resBody);
			self.out.response.bodySize = resBody.length;
			self.out.response.content.size = resBody.length;

			var ct = contentTypeParser(self.res.headers['content-type']),
				enc = charset(ct);

			if (enc) {
				if (enc == 'utf-8') self.out.response.content.text = resBody.toString();
				else {
					try {
						var iconv = new (require('iconv').Iconv)(enc, 'utf-8//TRANSLIT//IGNORE');
						self.out.response.content.text = iconv.convert(resBody).toString();
					} catch (ex) {
						bin();
					}
				}
			} else bin();

			function bin() {
				self.out.response.content.text = resBody.toString('base64');
				self.out.response.content.encoding = 'base64';
			}

		}
	});
};


exports = module.exports = HAR;