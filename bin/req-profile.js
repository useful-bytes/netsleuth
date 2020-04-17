#!/usr/bin/env node

var url = require('url'),
	path = require('path'),
	c = require('ansi-colors'),
	rcfile = require('../lib/rcfile'),
	Params = require('../lib/req-param');

var config = rcfile.get();


function getParams(argv, noBody) {
	var args = argv._, params = new Params({ noBody: noBody });

	try {
		for (var i = 2; i <= args.length - 1; i++) params.parse(args[i]);
	} catch (ex) {
		fatal(ex.message, ex.code);
	}
	return params;
}

function getCookies(origin, cb) {
	require('chrome-cookies-secure').getCookies(origin + '/', 'header', function(err, cookies) {
		if (err) return fatal('Unable to get Chrome cookies.  ' + err.message, 100, err);
		cb(null, cookies);
	});
}


exports.yargs = function(yargs) {
	return yargs.command(['add <name> <url>', 'new'], 'Add a profile', function(yargs) {
		profileOptions(yargs)
		.help();
	}, function(argv) {
		if (argv.name.indexOf('.') >= 0) return fatal('Profile names may not contain dots.');
		if (!config.profiles) config.profiles = {};
		// if (config.profiles[argv.name]) return fatal('There is already a profile named "' + argv.name + '".');

		var params = getParams(argv, true);

		var prof = config.profiles[argv.name] = {
			host: argv.url
		};

		if (params.headers) prof.headers = params.headers;
		if (params.query) prof.query = params.query;

		if (argv.ca) prof.ca = path.resolve(process.cwd(), argv.ca);
		if (argv.clientCert) prof.clientCert = path.resolve(process.cwd(), argv.clientCert);
		if (argv.clientKey) prof.clientKey = path.resolve(process.cwd(), argv.clientKey);
		if (argv.clientKeyPw) prof.clientKeyPw = argv.clientKeyPw;

		if (argv.chromeCookies) {
			getCookies(argv.url, function(err, cookies) {
				if (cookies) {
					if (!prof.headers) prof.headers = {};
					prof.headers.Cookie = cookies;
				}
				rcfile.save(config);
				console.log('Profile created.');
			});
		} else {
			rcfile.save(config);
			console.log('Profile created.');
		}

	})
	.command(['edit <name>', 'mod'], 'Edit a profile', function(yargs) {
		profileOptions(yargs)
		.option('host', {
			alias: 'h',
			description: 'Change the host to this URL.'
		})
		.help();	
	}, function(argv) {
		if (!config.profiles || !config.profiles[argv.name]) return fatal('There is no profile named "' + argv.name + '".');
		
		var params = getParams(argv, true),
			profile = config.profiles[argv.name];

		if (argv.host) profile.host = argv.host;

		if (params.query) profile.query = Object.assign(profile.query || {}, params.query);

		if (params.headers) profile.headers = Object.assign(profile.headers || {}, params.headers);
		if (profile.headers && params.deletedHeaders) for (var k in params.deletedHeaders) delete profile.headers[k];

		if (params.body) profile.body = Object.assign(profile.body || {}, params.body);
		if (profile.body && params.deletedBody) for (var k in params.deletedBody) delete profile.body[k];

		if (argv.ca) profile.ca = path.resolve(process.cwd(), argv.ca);
		if (argv.clientCert) profile.clientCert = path.resolve(process.cwd(), argv.clientCert);
		if (argv.clientKey) profile.clientKey = path.resolve(process.cwd(), argv.clientKey);
		if (argv.clientKeyPw) profile.clientKeyPw = argv.clientKeyPw;

		if (argv.chromeCookies) {
			getCookies(profile.host, function(err, cookies) {
				if (cookies) {
					if (!profile.headers) profile.headers = {};
					profile.headers.Cookie = cookies;
				}
				rcfile.save(config);
				console.log('Profile updated.');
			});
		} else {
			rcfile.save(config);
			console.log('Profile updated.');
		}
	})
	.command(['rm <name>', 'del'], 'Delete a profile', function(yargs) {
		profileOptions(yargs)
		.help();
	}, function(argv) {
		if (!config.profiles || !config.profiles[argv.name]) return fatal('There is no profile named "' + argv.name + '".');
		
		delete config.profiles[argv.name];
		rcfile.save(config);
		console.log('Profile deleted.');

	})
	.command(['ls'], 'List profiles', function(yargs) {
		yargs.help();
	}, list)
	.command(['payload <profile> <payload-name>', 'pl'], 'Add or edit a named payload on a profile', function(yargs) {
		yargs.help();
	}, function(argv) {
		if (!config.profiles || !config.profiles[argv.profile]) return fatal('There is no profile named "' + argv.profile + '".');
		
		var params = getParams(argv);

		var pl = config.profiles[argv.profile].payloads || {};

		pl[argv.payloadName] = params.body;

		config.profiles[argv.profile].payloads = pl;
		rcfile.save(config);
		console.log('Profile payload updated.');

	})
	.demand(1)
	.help(true);
};

function list(argv) {
	if (!config.profiles) return fatal('There are no profiles.');
	for (var k in config.profiles) console.log(k, '->', config.profiles[k].host);
}

exports.list = list;
exports.exec = function(argv) {

};

function profileOptions(yargs) {
	return yargs.option('chrome-cookies', {
		alias: 'C',
		boolean: true,
		description: 'Save your browser\'s cookies to this profile'
	})
	.option('ca', {
		group: 'Network Behavior',
		describe: 'Validate TLS certificates using the CA certificate(s) in this file'
	})
	.option('client-cert', {
		group: 'Network Behavior',
		describe: 'Present TLS client certificate from this PEM or PFX file'
	})
	.option('client-key', {
		group: 'Network Behavior',
		describe: 'File containing key for PEM client-cert'
	})
	.option('client-key-pw', {
		group: 'Network Behavior',
		describe: 'Password for client certificate\'s private key'
	});
}


function fatal(msg, code) {
	console.error(c.bgRed('Error:') + ' ' + msg);
	process.exit(code || 1);
}

// allow this file to be invoked directly
if (require.main == module) {
	exports.yargs(require('yargs')).argv;
}