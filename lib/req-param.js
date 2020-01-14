var fs = require('fs'),
	os = require('os'),
	util = require('util');


function openFile(f) {
	var info = fs.statSync(f);
	return {
		path: f,
		size: info.size,
		stream: fs.createReadStream(f)
	};
}

function Params(opts) {
	opts = opts || {};
	this.body = opts.body;
	this.headers = opts.headers;
	this.query = opts.query;
	this.profile = opts.profile;
	this.uploadFile = null;
	
	this.isRedirect = !!opts.isRedirect;
	this.noBody = !!opts.noBody;
}

Params.prototype.parse = function(param) {
	var op, k, v, delim;

	switch (param[0]) {
		case '@':
			if (this.uploadFile) throw new ParamError('Cannot specify more than one file to upload.', 105);
			try {
				var fn = param.substr(1);
				if (fn[0] == '~') { // bash doesn't substitute `~` when it immediately follows `@`, so we'll do it here for convenience
					fn = os.homedir() + fn.substr(1);
				}
				this.uploadFile = openFile(fn);
			} catch (ex) {
				throw new ParamError(ex.message, 66, ex);
			}
			break;
		case '+':
			var name = param.substr(1);
			if (!this.profile) throw new ParamError('Not using a profile; named payloads (+) cannot be accessed.', 107);
			else if (!this.profile.payloads || !this.profile.payloads[name]) throw new ParamError('Unknown payload "' + name + '".', 108);
			else {
				if (!this.body) this.body = {};
				for (var k in this.profile.payloads[name]) this.body[k] = this.profile.payloads[name][k];
			}
			break;

		case '?':
			op = '?';
			delim = param.indexOf('=');
			k = param.substr(1, delim-1);
			v = param.substr(delim+1);
			if (!k) throw new ParamError('Invalid query string param argument.', 111);

		default:
			if (!op) {
				// search param args for the first op token (ie = or :) and separate into key/value pair
				loop : for (var i = 1; i < param.length; i++) {
					switch (param[i]) {
						case '=':
							if (param[i+1] == '=') {
								op = '==';
								k = param.substr(0, i);
								v = param.substr(i + 2);
								break loop;
							}
						case ':':
							op = param[i];
							k = param.substr(0, i);
							v = param.substr(i + 1);
							break loop;
					}
				}
			}

			if (op) switch (op) {
				case '=':
				case '==':
					if (!this.body) {
						if (this.noBody) throw new ParamError('Body params not allowed.', 64);
						this.body = {};
					}
					if (!v) {
						delete this.body[k];
						if (!this.deletedBody) this.deletedBody = {};
						this.deletedBody[k] = true;
					} else {
						var vsub = v.substr(1);
						if (v[0] == '@') {
							if (v[1] == '~') { // bash doesn't substitute `~` when it immediately follows `@`, so we'll do it here for convenience
								v = os.homedir() + v.substr(1);
							}
							try {
								v = fs.readFileSync(v.substr(1), 'utf8');
							} catch (ex) {
								throw new ParamError(ex.message, 66);
							}
							try {
								v = JSON.parse(v);
							} catch (ex) {
								// noop
							}
						} else if (op == '=' && v == 'true') {
							v = true;
						} else if (op == '=' && v == 'false') {
							v = false;
						} else if (op == '=' && v == 'null') {
							v = null;
						} else if (v[0] == '\\' && (v[1] == '@')) {
							v = vsub;
						} else if (op == '=' && !isNaN(parseFloat(v)) && isFinite(v)) {
							v = parseFloat(v);
						}

						var kpath = k.split('.'),
							target = this.body;

						for (var i = 0; i < kpath.length-1; i++) {
							// check for escaped dots
							if (i < kpath.length-1 && kpath[i].substr(-1) == '\\') {
								if (kpath[i].substr(-2,1) == '\\') {
									kpath[i] = kpath[i].substr(0, kpath[i].length-1);
								} else {
									kpath[i] = kpath[i].substr(0, kpath[i].length - 1) + '.' + kpath[i+1];
									kpath.splice(i+1, 1);
									if (i == kpath.length-1) break;
								}
							}
							if (typeof target[kpath[i]] != 'object') target[kpath[i]] = {};
							target = target[kpath[i]];
						}

						if (kpath[i].substr(-2) == '[]') {
							var arrk = kpath[i].substr(0, kpath[i].length - 2);
							if (Array.isArray(target[arrk])) target[arrk].push(v);
							else target[arrk] = [v];
						} else {
							target[kpath[i]] = v;
						}

					}
					break;
				case '?':
					if (!this.isRedirect) {
						if (!this.query) this.query = {};
						this.query[k] = v;
					}
					break;
				case ':':
					if (!this.headers) this.headers = {};
					if (!v) {
						delete this.headers[k];
						if (!this.deletedHeaders) this.deletedHeaders = {};
						this.deletedHeaders[k] = true;
					}
					else this.headers[k] = v;
					break;
			}
			else throw new ParamError('Failed to parse params.', 109);
	}
};

function ParamError(msg, code) {
	Error.call(this, msg);
	this.message = msg;
	this.code = code;
}
util.inherits(ParamError, Error);

exports = module.exports = Params;