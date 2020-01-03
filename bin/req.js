#!/usr/bin/env node

var fs = require('fs'),
	util = require('util'),
	url = require('url'),
	querystring = require('querystring'),
	path = require('path'),
	readline = require('readline'),
	zlib = require('zlib'),
	os = require('os'),
	http = require('http'),
	https = require('https'),
	c = require('ansi-colors'),
	inproc = require('../inproc'),
	rcfile = require('../lib/rcfile'),
	reqHeaders = require('../lib/req-headers'),
	package = require('../package.json');

// Note: other dependencies are require()d on-demand below in order to optimize startup time


var config = rcfile.get(),
	defaultGateway = config.defaultGateway || 'netsleuth.io',
	defaultTeam;

var yargs = require('yargs')
	.command('profile', 'Modify a profile', function(yargs) {
		require('./req-profile').yargs(yargs);
	})
	.command('*', 'req', function(yargs) {
		yargs
		.option('follow', {
			alias: 'F',
			group: 'HTTP Behavior',
			boolean: true,
			describe: 'Follow HTTP 3xx redirects'
		})
		.option('continue', {
			boolean: true,
			group: 'HTTP Behavior',
			describe: 'Send Expect: 100-continue and wait for a 100 before sending request body'
		})
		.option('txt', {
			boolean: true,
			// conflicts: ['json','bin'],
			group: 'HTTP Behavior',
			describe: 'Set request Content-Type: text/plain (utf8)'
		})
		.option('json', {
			boolean: true,
			// conflicts: ['txt','bin'],
			group: 'HTTP Behavior',
			describe: 'Set request Content-Type: and Accept: application/json (implied when using `key=val` params)'
		})
		.option('bin', {
			boolean: true,
			// conflicts: ['txt','json'],
			group: 'HTTP Behavior',
			describe: 'Set request Content-Type: application/octet-stream'
		})
		.option('type', {
			alias: 't',
			group: 'HTTP Behavior',
			describe: 'Set request Content-Type to the mimetype normally associated with the specified file extension'
		})
		.option('charset', {
			alias: 'c',
			group: 'HTTP Behavior',
			describe: 'Add a `charset` directive to the request Content-Type.'
		})
		.option('gzip', {
			alias: 'z',
			boolean: true,
			group: 'HTTP Behavior',
			describe: 'Set Accept-Encoding: gzip'
		})
		.option('gzip-req', {
			alias: 'Z',
			boolean: true,
			group: 'HTTP Behavior',
			describe: 'Compress the request body'
		})
		.option('ua', {
			alias: 'u',
			group: 'HTTP Behavior',
			describe: 'Use a common User-Agent string.  Choices: {chrome,firefox}[-{win,mac,linux}] safari edge ie ios android curl'
		})
		.option('enc', {
			group: 'HTTP Behavior',
			describe: 'Force the response body to be treated as text with this character encoding'
		})
		.option('no-ua', {
			alias: 'U',
			boolean: true,
			group: 'HTTP Behavior',
			describe: 'Do not set default User-Agent'
		})
		.option('raw', {
			alias: 'r',
			boolean: true,
			group: 'Display',
			describe: 'Response body should be streamed out unmodified (ie disable pretty-printing)'
		})
		.option('quiet', {
			alias: 'q',
			group: 'Display',
			boolean: true,
			describe: 'Do not print any HTTP information, only the response body in the terminal'
		})
		.option('term-enc', {
			group: 'Display',
			default: 'utf-8',
			describe: 'Character encoding used when sending data to the terminal'
		})
		.option('secure', {
			alias: 's',
			boolean: true,
			group: 'Network Behavior',
			describe: 'Force TLS (https)'
		})
		.option('4', {
			boolean: true,
			group: 'Network Behavior',
			describe: 'Use IPv4 only'
		})
		.option('6', {
			boolean: true,
			group: 'Network Behavior',
			describe: 'Use IPv6 only'
		})
		.option('bind', {
			group: 'Network Behavior',
			describe: 'Local interface to bind for network connections'
		})
		.option('inspector', {
			alias: 'i',
			describe: 'Inspector GUI tab to send this request to',
			group: 'GUI',
			default: 'req-cli'
		})
		.option('no-inspector', {
			alias: 'I',
			boolean: true,
			group: 'GUI',
			describe: 'Do not send this request to the Inspector GUI'
		})
		.option('chrome-cookies', {
			alias: 'C',
			boolean: true,
			describe: 'Use your browser\'s cookies for this request'
		})
		.option('1945', {
			boolean: true,
			group: 'HTTP Behavior',
			describe: 'Strictly follow RFC1945 when handling HTTP 301/302 redirects and do not change the request method'
		})
		.option('out-enc', {
			group: 'Output',
			describe: 'Enable character encoding conversion and use this encoding when sending data to non-terminal outputs.'
		})
		.option('har', {
			group: 'Output',
			describe: 'Write request and response details to a HAR file located at this path, or - for stdout.  If the file already exists, data will be appended.'
		})
		.option('diff', {
			group: 'Display',
			describe: 'Diff the request/response against one saved in this HAR file (or - for stdin).  Use #entry to specify an entry index (like har: scheme, above; default 0)'
		})
		.option('help', {
			alias: '?',
			boolean: true,
			describe: 'Show my help'
		})
		.option('version', {
			alias: 'v',
			boolean: true,
			describe: 'Show version number'
		})
		// .help(false)
	}),
	argv = yargs.argv;

if (argv._[0] == 'profile') return;

if (argv.help) {
	yargs.showHelp(function(optTxt) {
		optTxt = '\n' + optTxt.substr(5);
		if (process.stdout.isTTY) {
			var ui = require('cliui')({
					width: Math.min(process.stdout.columns, 120)
				}),
				help;

			try {
				help = fs.readFileSync(path.join(__dirname, '../dist/docs/req.md.ansi'), 'utf-8');
			} catch (ex) {
				try {
					help = require('../build/docs').buildDoc('req');
				} catch (ex) {
					console.error(ex);
					fatal('Unable to find or build help.  If this is a normal install, this should not happen.  Otherwise, make sure dev dependencies are installed and/or run node build/docs.');
				}
			}
			help = help.replace('$OPTIONS', optTxt);

			ui.div(help);
			process.stdout.write(ui.toString());
		} else {
			
			try {
				help = fs.readFileSync(path.join(__dirname, '../dist/docs/req.md.txt'), 'utf-8');
			} catch (ex) {
				try {
					help = require('../build/docs').buildDoc('req', true);
				} catch (ex) {
					console.error(ex);
					fatal('Unable to find or build help.  If this is a normal install, this should not happen.  Otherwise, make sure dev dependencies are installed and/or run node build/docs.');
				}
			}
			help = help.replace('$OPTIONS', optTxt);

			process.stdout.write(help);
		}

		process.exit(1);
	});
}
if (argv.version) {
	process.stderr.write('netsleuth req v' + package.version + ' running on node ' + process.version);
	process.exit(1);
}

if (argv.noInspector) {
	inprocReady = true;
} else {
	var ns = inproc.attach({
		name: argv.inspector,
		unref: false
	}, function() {
		// console.log(Date.now()-d);
		inprocReady = true;
		if (stdinPiped !== null) request(method, uri);
	});
}


var args = argv._,
	methodish = /^([A-Z]+|get|head|post|put|delete|trace|options|patch)$/,
	method,
	resOk,
	stdinPiped = null,
	inprocReady,
	defaultHost = argv[6] ? '[::1]' : '127.0.0.1',
	har;


// When yargs sees a single dash following an option, it parses it as a positional argument rather than a value for that option, and sets the option to `true` (rather than the expected string).
// In order to support the convention of giving an option `-` to specify stdin/stdout rather than a file, we'll just remove single dashes that end up in the positional args.
for (var i = 0; i < args.length; i++) if (args[i] == '-') args.splice(i, 1);

if (args.length == 0) return fatal('Missing URL.  Run ' + c.yellow('req --help') + ' for usage information.', 64);

if (argv.har) har = new (require('../lib/har'))(argv.har === true ? process.stdout : argv.har);

if (methodish.test(args[0])) method = args.shift().toUpperCase();

var uri = args.shift();

if (uri[0] == ':') uri = 'http://' + defaultHost + uri;
else if (uri.substr(0,2) == '//') uri = 'http:' + uri;

var diff, stdinIsBody = true;
if (argv.diff) {
	if (argv.diff === true || argv.diff == '-' || (argv.diff[0] == '-' && argv.diff[1] == '#')) {
		stdinIsBody = false;
		diff = '';
		process.stdin.setEncoding('utf-8');
		process.stdin.on('data', function(chunk) {
			diff += chunk;
		});
		process.stdin.on('end', function() {
			var sel;
			if (typeof argv.diff == 'string') {
				var seli = argv.diff.indexOf('#');
				if (seli > 0) sel = argv.diff.substr(seli+1);
			}

			try {
				diff = JSON.parse(diff);
			} catch (ex) {
				return fatal('Unable to parse HAR from stdin.  ' + ex.message, 66);
			}

			prepareDiff(sel);

			stdinPiped = false;
			if (inprocReady) request(method, uri);
		});
	} else {
		var seli = argv.diff.indexOf('#'), file, sel;
		if (seli > 0) {
			file = argv.diff.substr(0, seli);
			sel = argv.diff.substr(seli+1);
		} else file = argv.diff;
		try {
			diff = JSON.parse(fs.readFileSync(file));
		} catch (ex) {
			return fatal('Unable to load HAR file.  ' + ex.message, 66);
		}
		prepareDiff(sel);
	}
}

function prepareDiff(sel) {
	try {
		diff = diff.log.entries[sel || 0];

		headers(diff.request);
		headers(diff.response);

		function headers(o) {
			o._headers = o.headers || [];
			o.headers = {};
			o._headerName = {};
			o._headers.forEach(function(hdr) {
				o.headers[hdr.name.toLowerCase()] = hdr.value;
				o._headerName[hdr.name.toLowerCase()] = hdr.name;
			});
		}
		if (!diff) return fatal('Invalid HAR entry index.', 66);
	} catch (ex) {
		return fatal('Input HAR is not valid.  ' + ex.message, 66);
	}
}

if (stdinIsBody) {
	if (process.stdin.isTTY) {
		stdinPiped = false;
		if (inprocReady) request(method, uri);
	} else {
		process.stdin.once('readable', function() {
			var d = process.stdin.read();
			stdinPiped = !!d;

			if (d) {
				process.stdin.unshift(d);
			}
			if (inprocReady) request(method, uri);
		});
	}
}

function openFile(f) {
	var info = fs.statSync(f);
	return {
		path: f,
		size: info.size,
		stream: fs.createReadStream(f)
	}
}

var printBody = true;
if (argv.har === true) {
	argv.quiet = true;
	printBody = false;
}

var REQ_PROTO = 1,
	REQ_STATUS = 2,
	REQ_BODY = 3,
	RES_PROTO = 4,
	RES_BODY = 5;
function out(type, str) {
	if (type == REQ_PROTO && !argv.quiet) process.stderr.write(str);
	else if (type == REQ_STATUS && !argv.quiet) process.stderr.write(str);
	else if (type == REQ_BODY && !argv.quiet) process.stderr.write(str);
	else if (type == RES_PROTO && !argv.quiet) process.stderr.write(str);
	else if (type == RES_BODY && printBody) process.stdout.write(str);
}

function request(method, uri, isRedirect, noBody) {
	var opts = url.parse(uri, true),
		logger,
		profile,
		body,
		rawBody,
		bodyStream,
		streamLength,
		uploadFile,
		bodyFromCli,
		qparam;

	var defaultHeaders = opts.headers = {};

	if (argv.ua) {
		var uas = require('../lib/common-ua.json'),
			ua = argv.ua;

		if (ua == 'chrome' || ua == 'firefox') {
			ua += '-' + ({'win32':'win', darwin:'mac', linux:'linux'})[process.platform];
		}

		if (uas[ua]) defaultHeaders['User-Agent'] = uas[ua];
		else fatal('Unknown common User-Agent identifier.  Available options: ' + Object.keys(uas).join(' '), 116);
	}
	else if (!argv.noUa) defaultHeaders['User-Agent'] = 'netsleuth/' + package.version + ' (req; +https://netsleuth.io)';

	if (opts.protocol == 'har:' && !isRedirect) {

		if (opts.host && !opts.pathname) opts.pathname = opts.host; // har:file.har
		else if (opts.host && opts.pathname) opts.pathname = path.join(opts.host, opts.pathname); // har:p/file.bar
		// else har:/abs/file.bar

		try {
			var inHar = JSON.parse(fs.readFileSync(opts.pathname));
		} catch (ex) {
			return fatal(ex.message);
		}

		if (!inHar.log || !inHar.log.entries) return fatal('Not a valid HAR file.', 115);

		var ihar = parseInt(opts.hash && opts.hash.substr(1)) || 0;

		if (!inHar.log.entries[ihar]) return fatal('Invalid HAR entry index.', 115);

		var hreq = inHar.log.entries[ihar].request;

		opts = url.parse(hreq.url, true);
		opts.headers = {};
		method = hreq.method;

		hreq.headers.forEach(function(head) {
			if (head.name[0] != ':') opts.headers[head.name] = head.value;
		});

		if (hreq.postData && hreq.postData.text) {
			if (hreq.postData.encoding == 'base64') {
				body = Buffer.from(hreq.postData.text, 'base64');
			} else {
				if (hreq.postData.mimeType && hreq.postData.mimeType.substr(0, 16).toLowerCase() == 'application/json') {
					body = JSON.parse(hreq.postData.text);
				} else {
					body = hreq.postData.text;
				}
			}
		}

	} else {

		if (!opts.hostname) {
			if (isRedirect) {
				return fatal('Invalid redirect location.  Cannot follow.', 107);
			} else if (opts.pathname[0] != '/') {
				var profileName = opts.pathname.substr(0, opts.pathname.indexOf('/'));
				opts.path = opts.path.substr(profileName.length);
				opts.pathname = opts.pathname.substr(profileName.length);
				profile = config.profiles && config.profiles[profileName];
				if (!profile) {
					return fatal('Unknown profile "' + profileName + '".  See help for information about profiles.', 108);

				} else {
					opts.profile = profile;
					var phost = url.parse(profile.host);
					opts.protocol = phost.protocol;
					opts.hostname = phost.hostname;
					opts.port = phost.port;
					opts.auth = phost.auth;
					setProfile(profile);
				}
			} else {
				opts.hostname = defaultHost;
			}
		} else if (uri.profile) setProfile(uri.profile);

	}

	if (har) logger = har.entry(opts);

	function setProfile(prof) {
		profile = prof;
		opts.headers = Object.assign({}, defaultHeaders, profile.headers);
		opts.family = profile.family;
		if (profile.gzip) argv.gzip = true;
	}

	if (!opts.protocol) opts.protocol = 'http:';
	if (argv.secure) opts.protocol = 'https:';
	var secure = opts.protocol == 'https:';
	if (!opts.port) opts.port = secure ? '443' : '80';

	var origin = opts.protocol + '//' + opts.hostname;
	if (opts.port) origin += ':' + opts.port;

	if (argv.bind) opts.localAddress = argv.bind;
	if (argv[4]) opts.family = 4;
	if (argv[6]) opts.family = 6;

	if (opts.auth && opts.auth.indexOf(':') == -1) {
		opts.headers.Authorization = 'Bearer ' + opts.auth;
	}

	if (argv.gzip) opts.headers['Accept-Encoding'] = 'gzip';


	// if -- is found on the command line, then disable param parsing and treat the remaining command line as raw request body.
	// this is made difficult by yargs hiding `--` from argv._ 
	var dd = process.argv.indexOf('--');
	var ddPos;
	if (dd >= 0) ddPos = dd - (process.argv.length - args.length);
	else ddPos = args.length - 1;

	for (var i = 0; i <= ddPos; i++) parseParam(args[i]);

	if (dd >= 0) {
		if (body) return fatal('Cannot specify request body data arguments and raw body content.', 114);
		body = args.slice(Math.max(ddPos+1, 0)).join(' ');
		if (body) bodyFromCli = true;
	}


	if (qparam) { // is set if param args mutate the query string (ie `k==v`).  don't touch the qs otherwise to avoid adding an unwanted `=` (eg /foo?bar -> /foo?bar=)
		opts.search = '?' + querystring.stringify(opts.query);
		opts.path = opts.pathname + opts.search;
	}

	if (stdinPiped) {
		if (body || uploadFile) return fatal('Cannot specify request body data arguments and pipe data into stdin.', 102);
		bodyStream = process.stdin;
		if (opts.headers['Content-Length']) {
			streamLength = opts.headers['Content-Length'];
		} else {
			opts.headers['Transfer-Encoding'] = 'chunked';
		}
	} else {
		if (body && uploadFile) return fatal('Cannot specify request body data arguments and file upload.', 106);
	}

	if (argv.json) opts.headers['Accept'] = 'application/json, */*';

	function setType(getDefault) {
		var checkType = true;

		if (opts.headers['Content-Type']) {

			if (argv.json || argv.txt || argv.bin || argv.type || argv.charset) warn('Explicit `Content-Type:<val>` header param overrides options; ignoring --json, --txt, --bin, --type, and --charset.')

		} else {
			if (argv.json) {
				opts.headers['Content-Type'] = 'application/json';
				// strictly speaking (rfc8259), this mimetype does not permit a charset directive; utf-8 is the default and only charset
				if (argv.charset && argv.charset.toLowerCase() != 'utf-8') fatal('JSON only permits UTF-8 character encoding.', 113);
				checkType = false;
			} else if (argv.bin) {
				opts.headers['Content-Type'] = 'application/octet-stream';
				// rfc2046
				if (argv.charset) fatal('Binary files cannot specify a character encoding.', 113);
				checkType = false;
			} else if (argv.type) {
				var type = require('mime-types').lookup(argv.type);
				if (type) opts.headers['Content-Type'] = type;
				else return fatal('Could not map extension "' + argv.type + '" to a mimetype.', 110);
			} else if (argv.txt || bodyFromCli) {
				opts.headers['Content-Type'] = 'text/plain; charset=utf-8';
			} else {
				if (getDefault) opts.headers['Content-Type'] = getDefault();
			}

			if (checkType && argv.charset) {
				var type = require('content-type-parser')(opts.headers['Content-Type']);
				if (type) {
					type.set('charset', argv.charset);
					opts.headers['Content-Type'] = type.toString();
				}
			}
		}
	}

	var compressedLength = false, uncompressedLength;
	if (noBody) {
		body = null;
		rawBody = undefined;
		bodyStream = null;
	} else {
		if (body) {
			if (typeof body == 'object' && !Buffer.isBuffer(body)) {
				rawBody = Buffer.from(JSON.stringify(body));
				argv.json = true;
			}
			else rawBody = Buffer.from(body);

			if (logger) logger.setReqBody(rawBody);

			if (argv.gzipReq) {
				uncompressedLength = rawBody.length;
				rawBody = zlib.gzipSync(rawBody);
				compressedLength = true;
				if (logger) logger.compressedReqLength = rawBody.length;
			}
			opts.headers['Content-Length'] = rawBody.length;
			setType();
		} else if (uploadFile) {
			bodyStream = uploadFile.stream;
			streamLength = opts.headers['Content-Length'] = uploadFile.size;
			setType(function() {
				return require('mime-types').lookup(uploadFile.path) || 'application/octet-stream';
			});
		} else if (stdinPiped) setType();


		if ((body || bodyStream) && argv.gzipReq) {
			if (!compressedLength) {
				opts.headers['Transfer-Encoding'] = 'chunked';
			}
			opts.headers['Content-Encoding'] = 'gzip';
		}
	}

	if (argv.continue) opts.headers['Expect'] = '100-continue';
	var expectContinue = opts.headers['Expect'] == '100-continue';
	if (expectContinue && !(body || bodyStream)) return fatal('Cannot expect a 100 Continue when there is no request body to send.', 112);

	if (argv.chromeCookies) {
		require('chrome-cookies-secure').getCookies(origin + opts.pathname, 'header', function(err, cookies) {
			if (err) return fatal('Unable to get Chrome cookies.', 100, err);
			opts.headers.Cookie = cookies;
			makeReq();
		});
	} else makeReq();

	function diffHeaders(ui, harMsg, headers, headerName) {
		for (var k in headers) {

			var hval= { text:'' };
			if (headers[k].toString() == harMsg.headers[k]) hval.text = headers[k];
			else {
				if (harMsg.headers[k]) hval.text = c.red.strikethrough(harMsg.headers[k]) + '\n';
				hval.text += c.green(headers[k]);
			}

			ui.div({
				width: k.length + 2,
				text: (harMsg.headers[k] ? c.cyan : c.green)(headerName ? headerName[k] : k) + ':'
			}, hval);
		}

		for (var k in harMsg.headers) {
			if (!headers[k]) ui.div(c.red.strikethrough(harMsg._headerName[k]) + ': ' + c.red.strikethrough(harMsg.headers[k]));
		}
	}
	function mapHeaderNames(raw) {
		var r = {};
		for (var i = 0; i < raw.length; i+=2) {
			r[raw[i].toLowerCase()] = raw[i];
		}
		return r;
	}

	function makeReq() {
		var bodySent = false;
		if (!method) method = rawBody || bodyStream ? 'POST' : 'GET';
		opts.method = method;

		var req = (secure ? https : http).request(opts);
		req.__init = [{functionName: 'cli', url: 'req ' + process.pid + ' (' + process.ppid + ')' }];
		req.__nsgroup = process.ppid;

		if (diff) {
			var ui = require('cliui')({
				width: process.stderr.columns
			});


			var cmethod, cpath, cproto;
			if (method == diff.request.method) cmethod = { width: method.length+1, text: c.yellow(method) };
			else cmethod = { width: Math.max(diff.request.method.length, method.length) + 1, text: c.red.strikethrough(diff.request.method) + '\n' + c.green(method) };
			           
			if (diff.request.httpVersion == 'http/1.1') cproto = { width:9, text: c.gray('HTTP/1.1') };
			else cproto = { width: Math.max(diff.request.httpVersion.length, 9), text: c.red.strikethrough(diff.request.httpVersion) + '\n' + c.green('HTTP/1.1') };
			cproto.padding=[0,0,0,1];

			var ourl = url.parse(diff.request.url);
			if (opts.path == ourl.path) cpath = { width: opts.path.length, text: c.cyan.underline(opts.path) };
			else cpath = { width: Math.min(Math.max(ourl.path.length, opts.path.length), process.stderr.columns - cmethod.width - cproto.width - 1),
			               text: c.red.underline.strikethrough(ourl.path) + '\n' +
			                     c.green.underline(opts.path) };

			ui.div(cmethod, cpath, cproto);

			var headers = reqHeaders.get(req);
			diffHeaders(ui, diff.request, headers.values, headers.names);

			out(REQ_PROTO, ui.toString() + '\n');

		} else {
			out(REQ_PROTO, c.yellow(method) + ' ' + c.cyan.underline(opts.path) + c.gray(' HTTP/1.1\n'));
			var headers = reqHeaders.get(req);
			for (var k in headers.values) {
				out(REQ_PROTO, c.cyan(headers.names[k]) + ': ' + headers.values[k] + '\n');
			}
		}
		out(REQ_PROTO, '\n');
		

		req.on('error', function(err) {
			// On some versions of node, the `req` will fire a socket error in some situations even when the response was successfully received.
			// We set `resOk=true` when the `res` `end` event fires so we can ignore this spurious error.
			if (!resOk) {
				process.stderr.write(c.bgRed('Error:') + ' ' + err.message + '\n');
				done();
			}
		});

		req.on('response', function(res) {
			if (!bodySent) out(REQ_STATUS, c.gray(']') + '\n\n');
			var scolor = c.white;
			if (res.statusCode >= 200 && res.statusCode < 300) scolor = c.green;
			if (res.statusCode >= 300 && res.statusCode < 400) scolor = c.cyan;
			if (res.statusCode >= 400 && res.statusCode < 500) scolor = c.yellow;
			if (res.statusCode >= 500) scolor = c.red;

			if (diff) {
				var ui = require('cliui')({
					width: process.stderr.columns
				});

				var cproto, cstatus, cstatustxt;
				var hver = 'HTTP/' + res.httpVersion;
				if (diff.response.httpVersion.toUpperCase() == hver) cproto = { width:hver.length+1, text: c.gray(hver) };
				else cproto = { width: Math.max(diff.request.httpVersion.length+1, hver.length+1), text: c.red.strikethrough(diff.request.httpVersion) + '\n' + c.green(hver) };
				 

				if (diff.response.status == res.statusCode) cstatus = { width: 4, text: scolor.bold(res.statusCode) };
				else cstatus = { width: 4, text: c.red.strikethrough(diff.response.status) + '\n' + c.green(res.statusCode) };

				if (diff.response.statusText == res.statusMessage) cstatustxt = { text: scolor(res.statusMessage) };
				else cstatustxt = { text: c.red(diff.response.statusText) + '\n' + c.green(res.statusMessage) };

				ui.div(cproto, cstatus, cstatustxt);

				diffHeaders(ui, diff.response, res.headers, mapHeaderNames(res.rawHeaders));
				out(RES_PROTO, ui.toString() + '\n');


			} else {
				out(RES_PROTO, c.gray('HTTP/' + res.httpVersion) + ' ' + scolor.bold(res.statusCode) + ' ' + scolor(res.statusMessage) + '\n');
				for (var i = 0; i < res.rawHeaders.length; i+=2) {
					out(RES_PROTO, c.cyan(res.rawHeaders[i]) + ': ' + res.rawHeaders[i+1] + '\n');
				}
			}
			out(RES_PROTO, '\n');

			var ctype = (res.headers['content-type'] || '').toLowerCase();

			var entity = res;

			if (res.headers['content-encoding'] == 'gzip') {
				entity = zlib.createGunzip();
				res.pipe(entity);
			}
			if (logger) logger.observeResBody(entity);


			if (diff) {
				var ct = require('content-type-parser')(ctype),
					enc = argv.enc || require('../lib/charset')(ct);

				var resStr='', resBuf;
				if (enc == 'utf-8') {
					entity.setEncoding('utf-8');
					entity.on('data', function(str) {
						resStr += str;
					});
				} else if (enc && enc != 'utf-8') {
					entity = charConv(entity, enc, 'utf-8');
					entity.on('data', function(buf) {
						resStr += buf.toString();
					});
				} else {
					resBuf = [];
					entity.on('data', function(buf) {
						resBuf.push(buf);
					});
				}

				entity.on('end', function() {
					resOk = true;
					if (resBuf) {
						outBody('response', Buffer.concat(resBuf));
					} else {
						try {
							outBody('response', JSON.parse(resStr));
						} catch (ex) {
							outBody('response', resStr);
						}
					}
					done(res, opts);
				});


			}
			else if (printBody) {
				var output = process.stdout;
				if (argv.follow && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					output = process.stderr;
				}

				if (!argv.raw && ctype && ctype.substr(0, 16) == 'application/json' && process.stdout.isTTY) {
					var buf = '';
					entity.setEncoding(argv.enc || 'utf-8');
					entity.on('data', function(d) {
						buf += d;
					});
					entity.on('end', function() {
						resOk = true;
						try {
							buf = JSON.parse(buf);
							console.dir(buf, {
								depth: null,
								colors: true
							});
						} catch (ex) {
							process.stderr.write(c.bgRed('<unable to parse JSON>') + '\n');
							output.write(buf);
						}
						done(res, opts);
					});
				} else {
					var hidden = false, seen = 0;

					if (output.isTTY) {
						var ct = require('content-type-parser')(ctype),
							enc = argv.enc || require('../lib/charset')(ct);

						if (enc) {
							if (enc == argv.termEnc.toLowerCase()) entity.pipe(output);
							else charConv(entity, enc, argv.termEnc).pipe(output);
						} else {
							hidden = true;
							process.stderr.write(c.gray('[binary data not displayed...'));
							entity.on('data', function(d) {
								seen += d.length;
							});
						}

					} else {
						if (argv.enc || argv.outEnc) {
							var ct = require('content-type-parser')(ctype),
								enc = argv.enc || require('../lib/charset')(ct),
								outEnc = argv.outEnc || 'utf-8';

							if (!enc || enc == outEnc.toLowerCase()) entity.pipe(output);
							else charConv(entity, enc, outEnc).pipe(output);
						}
						else entity.pipe(output);
					}
					entity.on('end', function() {
						resOk = true;
						if (hidden) process.stderr.write(c.gray(' ' + seen + ' bytes]\n'));
						process.stderr.write('\n');
						done(res, opts);
					});
				}
			} else {
				// not printing body
				entity.on('data', function(chunk) {
					// noop here, but data may be consumed by the HAR logger
				});
				entity.on('end', function() {
					resOk = true;
					done(res, opts);
				});
			}

		});

		if (logger) logger.observe(req);
		function prefixLines(prefix, val) {
			if (Buffer.isBuffer(val)) return prefix + c.gray('[' + val.length + ' bytes of binary data]')
			return prefix + val.replace(/\r?\n/g, '\n' + prefix);
		}
		function outBody(type, entity) {
			var compEntity, entity;
			if (type == 'request') {
				compEntity = diff && diff.request && diff.request.postData;
			} else {
				compEntity = diff && diff.response && diff.response.content;
			}

			if (compEntity) {
				if (compEntity.encoding == 'base64') {
					var ct = require('content-type-parser')(compEntity.mimeType),
						enc = require('../lib/charset')(ct),
						buf = Buffer.from(compEntity.text, 'base64');

					if (enc == 'utf-8') compEntity = buf.toString();
					else if (enc) compEntity = charConv(buf, enc, 'utf-8').toString();
					else compEntity = buf;
				}
				else compEntity = compEntity.text;
			}

			if (diff) {
				if (compEntity) {

					var differ = require('../lib/differ');
					try {
						var compObj = JSON.parse(compEntity);
					} catch(ex) {
					}

					if (compObj) {
						if (typeof entity == 'object' && !Buffer.isBuffer(entity)) {
							differ.diff(compObj, entity);
							return;
						} else {
							printInspect(compObj, c.red.bold('-'));
							_out('\n');

							if (!entity) {
								_out(c.green.bold('*') + c.gray(type + ' has no body'));
							} else if (typeof entity == 'string') {
								_out(entity.split(/\r?\n/).map(function(line) {
									return c.green.bold('+') + line
								}).join('\n'));
							} else {
								_out(c.green.bold('+') + c.gray('[' + entity.length + ' bytes of binary data]'));
							}

						}
					} else {

						if (Buffer.isBuffer(compEntity) && Buffer.isBuffer(entity)) {
							if (compEntity.compare(entity) == 0) _out(c.gray('[' + entity.length + ' bytes of identical binary data]'));
							else _out(c.gray('[' + c.red(compEntity.length) + ' ' + c.green(entity.length) + ' bytes of differing binary data]'));
						} else if (typeof compEntity == 'string' && typeof entity == 'string') {
							_out(differ.string(compEntity, entity));
						} else if (!entity) {
							_out(prefixLines(c.red.bold('-'), compEntity) + '\n');
							_out(c.green.bold('*') + c.gray(type + ' has no body'));
						} else if (typeof entity == 'object' && !Buffer.isBuffer(entity)) {
							_out(prefixLines(c.red.bold('-'), compEntity) + '\n');
							printInspect(entity, c.green.bold('+'));
						} else {
							_out(prefixLines(c.red.bold('-'), compEntity) + '\n');
							_out(prefixLines(c.green.bold('+'), entity));
						}
					}


				} else {
					if (entity) {
						_out(c.red.bold('*') + c.gray('previous ' + type + ' had no body\n'));
						if (typeof entity == 'object') {
							if (Buffer.isBuffer(entity)) {
								_out(c.green.bold('+') + c.gray('[' + entity.length + ' bytes of binary data]'));
							} else {
								printInspect(entity, c.green.bold('+'));
							}
						} else {
							_out(prefixLines(c.green.bold('+'), entity));
						}
					}
				}

				_out('\n\n');

			} else {
				if (typeof entity == 'object') {
					if (Buffer.isBuffer(entity)) _out(c.gray('[binary ' + entity.length + ' bytes]'));
					else printInspect(entity);
				} else {
					_out(entity);
				}
				
			}


			function printInspect(obj, line) {
				
				var nbody = util.inspect(obj, {
					depth: null,
					colors: true
				});

				if (line) nbody = prefixLines(line, nbody);
				
				_out(nbody);
			}

			function _out(str) {
				out(type == 'request' ? REQ_BODY : RES_BODY, str);
			}
		}

		function sendReqBody() {
			bodySent = true;
			if (body) {
				outBody('request', body);
				if (compressedLength) out(REQ_BODY, c.gray('\n[original ' + uncompressedLength + ' bytes; transmitted ' + rawBody.length + ' gzipped bytes]'));
				out(REQ_BODY, '\n\n');
			} else if (stdinPiped) {
				out(REQ_BODY, c.gray('[uploading stdin... '));
			} else if (uploadFile) {
				out(REQ_BODY, c.gray('[uploading file... '));
			} else if (diff) {
				outBody('request', null);
			}

			if (bodyStream) {
				var seen = 0;
				if (argv.gzipReq) {
					var gzip = zlib.createGzip();
					gzip.pipe(req);
					bodyStream.pipe(gzip);
					gzip.on('data', function(d) {
						seen += d.length;
					});
					gzip.on('end', function() {
						out(REQ_BODY, c.gray('compressed to ' + seen + ' bytes]') + '\n\n');
						if (logger) loggger.compressedReqLength = seen;
					});
				} else {
					bodyStream.pipe(req);
					bodyStream.on('data', function(d) {
						seen += d.length;
						if (seen > streamLength) {
							barf('Body too large.  Input stream larger than specified size (' + streamLength + ' bytes).', 103);
						}
					});
					bodyStream.on('end', function() {
						if (seen < streamLength) {
							barf('Body too small.  Input stream ended with ' + seen + ' bytes, which is smaller than the specified size (' + streamLength + ' bytes).', 104);
						} else {
							out(REQ_BODY, c.gray(seen + ' bytes]') + '\n\n');
						}
					});
				}
				if (diff) {
					var bodyBuf = [];
					bodyStream.on('data', function(chunk) {
						bodyBuf.push(chunk);
					});
					bodyStream.on('end', function() {
						var ct = require('content-type-parser')(req.getHeader('content-type')),
							enc = require('../lib/charset')(ct),
							buf = Buffer.concat(bodyBuf);

						if (enc == 'utf-8') buf = buf.toString();
						else if (enc) buf = charConv(buf, enc, 'utf-8').toString();

						try {
							buf = JSON.parse(buf.toString());
						} catch (noop) {}

						outBody('request', buf);
					});
				}
				if (logger) logger.observeReqBody(req);
			} else {
				req.end(rawBody);
				if (logger) {
					if (rawBody) logger.setReqBody(rawBody);
					logger.reqEnd();
				}
			}
		}

		if (expectContinue) {
			out(REQ_STATUS, c.gray('[waiting for 100 Continue...'));
			req.on('continue', function() {
				out(REQ_STATUS, c.gray(' ok]\n'));
				sendReqBody();
			});
		}
		else sendReqBody();

		function barf(msg, code) {
			resOk = true; // abuse this to supress duplicate error messages.
			req.emit('error', new Error(msg)); // emitted so the inspector GUI gets the error
			console.error(c.bgRed('Error:') + ' ' + msg);
			process.exit(code || 1);
		}
	}

	// TODO: use lib/req-param instead
	function parseParam(param) {
		var op, k, v, delim;

		switch (param[0]) {
			case '@':
				if (uploadFile) return fatal('Cannot specify more than one file to upload.', 105);
				try {
					var fn = param.substr(1);
					if (fn[0] == '~') { // bash doesn't substitute `~` when it immediately follows `@`, so we'll do it here for convenience
						fn = os.homedir() + fn.substr(1);
					}
					uploadFile = openFile(fn);
				} catch (ex) {
					console.error(ex)
					return fatal(ex.message, 66, ex);
				}
				break;
			case '+':
				var name = param.substr(1);
				if (!profile) return fatal('Not using a profile; named payloads (' + c.yellow('%') + ') cannot be accessed.', 107);
				else if (!profile.payloads || !profile.payloads[name]) return fatal('Unknown payload "' + name + '".', 108);
				else {
					if (!body) body = {};
					for (var k in profile.payloads[name]) body[k] = profile.payloads[name][k];
				}
				break;

			case '?':
				op = '?';
				delim = param.indexOf('=');
				k = param.substr(1, delim-1);
				v = param.substr(delim+1);
				if (!k) return fatal('Invalid query string param argument.', 111);

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
						if (!body) body = {};
						if (!v) delete body[k];
						else {
							var vsub = v.substr(1);
							if (v[0] == '@') {
								try {
									v = fs.readFileSync(v.substr(1), 'utf8');
								} catch (ex) {
									fatal(ex.message, 66);
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

							if (k.indexOf('.') > 0) {
								var kpath = k.split('.'),
									target = body;

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

								target[kpath[i]] = v;
							} else body[k] = v;
						}
						break;
					case '?':
						if (!isRedirect) {
							qparam = true;
							opts.query[k] = v;
						}
						break;
					case ':':
						if (!v) delete opts.headers[k];
						else opts.headers[k] = v;
						break;
				}
				else return fatal(' Failed to parse params.', 109);
		}
	}
}

function charConv(streamOrBuffer, from, to) {
	try {
		var iconv = new (require('iconv').Iconv)(from, to + '//TRANSLIT//IGNORE');
	} catch (ex) {
		return fatal('Response body requires character encoding conversion from "' + from + '" to "' + to + '", but the native iconv module failed to load.  ' + ex.message, 70);
	}

	if (Buffer.isBuffer(streamOrBuffer)) {
		return iconv.convert(streamOrBuffer);
	} else {
		streamOrBuffer.pipe(iconv);
		return iconv;
	}
}

function done(res, opts) {
	if (res && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && argv.follow) {
		var method = opts.method,
			newUri = url.parse(url.resolve(opts, res.headers.location)),
			noBody = false;

		if (method != 'HEAD' && (res.statusCode == 303 || (!argv[1945] && (res.statusCode == 301 || res.statusCode == 302)))) {
			method = 'GET';
			noBody = true;
		} else if (stdinPiped) {
			return fatal('Cannot follow redirect.  A ' + res.statusCode + ' requires the client to resubmit the request body.  stdin has already been consumed; it is not possible to resubmit the request body.', 101);
		}

		if (opts.auth) newUri.auth = opts.auth;
		if (opts.profile && 
			opts.protocol == newUri.protocol &&
			opts.hostname == newUri.hostname &&
			opts.port == newUri.port
		) {
			newUri.profile = opts.profile;
		}

		out(REQ_PROTO, '\n');
		request(method, newUri, true, noBody);
	}
	else {
		if (ns) ns.close();

		if (har) har.save(function(err) {
			if (err) warn(err.message);
			exit();
		});
		else exit();

		function exit() {
			setTimeout(function() { // give the inspector socket a moment to finish

				if (!res) process.exit(1);

				if (res.statusCode < 300) process.exit(0);
				
				// For HTTP errors, try to communicate the status code.
				// Unfortunately, we have to fit the status code into 8 bits.

				var code = res.statusCode.toString();
				if (code[1] == '0') code = code[0] + code[2];
				else code = code[0] + '9';

				process.exit(code);
			});

			var HistoryFile = require('../lib/historyfile'),
				hf = new HistoryFile('.sleuth_history');
			hf.insert(uri);
		}
			
	}
}

function fatal(msg, code) {
	console.error(c.bgRed('Error:') + ' ' + msg);
	process.exit(code || 1);
}
function warn(msg) {
	console.warn(c.bgYellow('Warning:') + ' ' + msg);
}