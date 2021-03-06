#!/usr/bin/env node

if (process.env.NETSLEUTH_DAEMON_INSPECT) require('../inproc').attach('netsleuth-daemon');

var fs = require('fs'),
	os = require('os'),
	path = require('path'),
	child_process = require('child_process'),
	dialog = require('dialog'),
	opn = require('opn'),
	request = require('request'),
	rcfile = require('../lib/rcfile'),
	gw = require('../lib/gateway-client'),
	browserLogin = require('../lib/browser-login'),
	hosts = require('../lib/hosts'),
	serverCert = require('../lib/server-cert'),
	CertificateAuthority = require('../lib/certs'),
	systemSetup = require('../lib/system-setup'),
	reveal = require('../lib/reveal'),
	Server = require('../server'),
	version = require('../package.json').version;

if (!process.stdout.isTTY) {
	process.on('uncaughtException', function(err) {
		server.http.close();
		dialog.err('The netsleuth daemon has crashed due to an uncaught exception.\n\n' + err.stack, 'netsleuth');
		process.exit(1);
	});
}

var config = rcfile.get(),
	port = +process.argv[2],
	ua = 'netsleuth/' + version + ' (' + os.platform() + '; ' + os.arch() + '; ' + os.release() +') node/' + process.versions.node;

var ca;
try {
	ca = new CertificateAuthority({
		cert: fs.readFileSync(rcfile.CONFIG_DIR + '/ca.cer'),
		key: fs.readFileSync(rcfile.CONFIG_DIR + '/ca.key')
	});
} catch (ex) {
	console.error('failed to load CA', ex);
	var gen = CertificateAuthority.generate();
	try {
		fs.writeFileSync(rcfile.CONFIG_DIR + '/ca.cer', gen.cert);
		fs.writeFileSync(rcfile.CONFIG_DIR + '/ca.key', gen.key);
	} catch (ex) {
		console.error('failed to save generated CA', ex);
	}
	ca = new CertificateAuthority(gen);
}

var scriptDir;
if (config.scriptDir === null) scriptDir = null
else scriptDir = config.scriptDir ? path.resolve(rcfile.CONFIG_DIR, config.scriptDir) : path.join(rcfile.CONFIG_DIR, 'scripts');

var server = new Server({
	gateways: config.gateways,
	port: port,
	scriptDir: scriptDir,
	localCA: ca,
	trustedCerts: loadTrustedCerts()
});


function username() {
	if (os.userInfo) return os.userInfo().username;
	else return process.env.USER || process.env.USERNAME;
}

var hostFrom = {};

for (var hostname in config.hosts) {
	var host = config.hosts[hostname];
	host.host = hostname;
	if (host.from) hostFrom[host.from] = host;
	addHost(host);
}

function addHost(host, cb) {

	if (host.ca) {
		host.ca = host.ca.map(function(path) {
			if (path.substr(0,28) == '-----BEGIN CERTIFICATE-----\n') return path;
			else return fs.readFileSync(path);
		});
	}

	var inspector = server.inspect(host);

	inspector.on('error', function(err) {
		console.log('insp err', host, err);
	});

	inspector.addTarget('main', host);
	
	if (cb) cb(null, inspector);

}

function setupHost(host, cb) {
	addHost(host, function(err, inspector, ip) {

		if (err) ierr(err);
		else {

			var lastErr, timeout = setTimeout(function() {
				var msg = 'Timed out waiting for host to come online.';
				if (lastErr) msg += ' Last error: ' + lastErr.message;
				ierr(new Error(msg));
			}, 20000);


			inspector.on('error', ierr);
			inspector.on('temp-error', problem);

			inspector.once('hostname', function(hostname, ip) {
				clearTimeout(timeout);
				inspector.removeListener('error', ierr);
				inspector.removeListener('temp-error', problem);

				if (ip) {
					host.ip = ip;
					// inspector.opts.ip = ip;
					// host.host = hostname;
				}

				host.host = inspector.name;
				
				if (!host.temp) {
					reload();
					if (!config.hosts) config.hosts = {};
					config.hosts[host.host] = host;
					rcfile.save(config);
				}

				if (host.local) {
					if (host.hostsfile && host.ip) {
						hosts.add(host.ip, hostname, function(err) {
							cb(null, { host: host.host, hostsUpdated: !err });
						});
					} else cb(null, { host: host.host });
				}
				else cb(null, { host: host.host });
			});
			
		}

		function problem(err) {
			console.error('insp problem', err);
			lastErr = err;
		}

		function ierr(err) {
			clearTimeout(timeout);
			console.error('ierr', err);
			if (inspector) {
				inspector.removeListener('error', ierr);
				inspector.close();
			}
			cb(err);
			if (host.host) server.remove(host.host);
		}
	});
}

function reload() {
	cache = {};
	config = rcfile.get();
	server.opts.gateways = config.gateways;
	console.log('reloaded config');
}


function isLocal(req, res, next) {
	var origin = req.headers.origin || '';
	if (origin.substr(0, 10) != 'netsleuth:' &&
		origin != 'http://localhost:' + port &&
		origin != 'http://127.0.0.1:' + port &&
		req.headers['sec-fetch-site'] != 'same-origin'
	) res.status(403).send('This request must be made from an allowed origin.');
	else if (req.socket.remoteAddress == '127.0.0.1' || req.socket.remoteAddress == '::1' || req.socket.remoteAddress == '::ffff:127.0.0.1') next();
	else res.status(403).send('This request must be made from localhost.');
}

server.app.post('/ipc/stop', isLocal, function(req, res) {
	res.sendStatus(204);
	setTimeout(function() {
		process.exit(0);
	}, 1);
});

server.app.post('/ipc/reload', isLocal, function(req, res) {
	reload();
	res.sendStatus(204);
});

server.app.post('/ipc/add', isLocal, function(req, res) {

	if (req.body.local || (config.gateways && config.gateways[req.body.gateway] && config.gateways[req.body.gateway].token)) {
		
		setupHost(req.body, function(err, result) {
			if (err) res.status(err.status || 500).send({ message: err.message });
			else res.send(result);
		});

	} else {
		if (req.body.gateway) res.status(401).send({ message: 'Not logged in to gateway ' + req.body.gateway });
		else res.status(400).send({ message: 'Must specify a gateway.' });
	}

});

server.app.post('/ipc/rm', isLocal, function(req, res) {
	if (req.body && req.body.hosts && Array.isArray(req.body.hosts)) {
		reload();
		req.body.hosts.forEach(function(host) {
			var insp = server.inspectors[host];
			if (insp.opts.deletable === false) return res.sendStatus(403);
			if (insp.opts.hostsfile) {
				hosts.remove(insp.opts.ip, insp.opts.host, function(err) {
					if (err) console.error('error removing HOSTS entry for ' + insp.opts.host, err);
				});
			}
			var hosted = insp.targets.main && insp.targets.main.hosted;
			server.remove(host);
			delete config.hosts[host];

			if (hosted && !req.body.keepReservation) gw.unreserve(host, function(err) {
				if (err) console.error('error unreserving host', host);
			});
		});
		rcfile.save(config);
	}
	res.send({});
});

server.app.post('/ipc/project', isLocal, function(req, res) {
	
	var project = req.body || {}

	var gw = project.gateway = project.gateway || 'netsleuth.io';
	if (!config.gateways || !config.gateways[gw]) {
		browserLogin.login({
			gateway: gw,
			googleAuth: project.googleAuth,
			welcomeMessage: project.welcomeMessage,
			welcome: true
		}, function(err, username) {
			if (err) res.sendStatus(500);
			else register();
		});
	} else register();


	function register() {
		reload();

		if (Array.isArray(project.inspect)) {
			project.inspect.forEach(function(inspect) {
				var from;
				if (inspect.local) {
					from = project.project + ':L:' + inspect.target;
				} else {
					from = project.project + ':' + inspect.host;
				}
				var host = hostFrom[from];
				if (host) {
					// this host has already been added
				} else {
					registerProjectHost(project, inspect);
				}
			});
		}

		res.sendStatus(204);
	}
});

server.app.get('/ipc/cert/:host', isLocal, function(req, res) {
	serverCert.get('https://' + req.params.host, function(err, cert) {
		if (err) res.sendStatus(500);
		else res.send(cert);
	});
});

server.app.post('/ipc/find-best-region', isLocal, function(req, res) {
	if (!req.body.gateway) return res.status(400).send('Must specify gateway service.');
	findBestRegion(req.body, function(err, results) {
		if (err) res.status(500).send({ message: err.message });
		else res.send(results);
	});
});

server.app.get('/ipc/gateways', isLocal, function(req, res) {
	if (!config.gateways) config.gateways = {};
	if (!config.gateways['netsleuth.io']) config.gateways['netsleuth.io'] = {};

	var gws = {}, arr = [], ops = 0, gwdone = 0;

	for (var gw in config.gateways) {
		arr.push(gws[gw] = {
			name: gw,
			loggedIn: !!config.gateways[gw].token,
			username: config.gateways[gw].username,
			domains: null,
			regions: null,
			defaultRegion: config.gateways[gw].defaultRegion
		});

		ops += 2;

		getGatewayInfo(gw, 'domains', function(err, domains, gw) {
			gws[gw].domains = domains;
			if (++gwdone == ops) done();
		});
		getGatewayInfo(gw, 'regions', function(err, regions, gw) {
			gws[gw].regions = regions && regions.map(function(region) {
				return region.id;
			});
			
			if (++gwdone == ops) done();
		});

		if (gw == 'netsleuth.io' && config.gateways[gw].token) {
			++ops;
			request({
				url: 'https://netsleuth.io/user/subscription',
				headers: {
					Authorization: 'Bearer ' + config.gateways[gw].token
				},
				json: true
			}, function(err, res, body) {
				if (res && res.statusCode == 200) gws['netsleuth.io'].plan = true;
				if (++gwdone == ops) done();
			});
		}
	}

	function done() {
		arr.sort(function(a, b) {
			if (a.name < b.name) return -1;
			if (a.name > b.name) return 1;
			return 0;
		});
		res.send({
			default: config.defaultGateway || 'netsleuth.io',
			gateways: arr
		});
	}
});

server.app.get('/ipc/setup', isLocal, function(req, res) {
	systemSetup.getStatus(ca, function(err, status) {
		if (err) res.status(500).send(err.message);
		else res.send(status);
	});
});

server.app.post('/ipc/setup', isLocal, function(req, res) {
	var iopts = {};
	if (req.body.ca) {
		iopts.ca = rcfile.CONFIG_DIR + '/ca.cer';
	}
	systemSetup.install(iopts, function(err) {
		res.send({ err: err && err.message });
		if (!err && process.platform != 'win32') child_process.exec('node "' + path.join(__dirname, 'netsleuth.js') + '" restart');
	});
});

server.app.get('/logged-in', function(req, res) {
	reload();
	res.redirect('/');
});


var COLON = /:/g;
server.trustCert = function(cert) {
	fs.mkdir(path.join(rcfile.CONFIG_DIR, 'trust'), 0o700, function(err) {
		if (err && err.code != 'EEXIST') return console.error('Failed to create trust dir', err);
		fs.mkdir(path.join(rcfile.CONFIG_DIR, 'trust', cert.hostname), 0o700, function(err) {
			if (err && err.code != 'EEXIST') return console.error('Failed to create host trust dir', err);
			fs.writeFile(path.join(rcfile.CONFIG_DIR, 'trust', cert.hostname, cert.fingerprint256.replace(COLON, '') + '.cer'), cert.raw, { mode: 0o600 }, function(err) {
				if (err) return console.error('Failed to write trust cert', err);
			});
		});
	});
};

function loadTrustedCerts() {
	var pems = [];
	try {
		fs.readdirSync(rcfile.CONFIG_DIR + '/trust').forEach(function(dir) {
			try {
				fs.readdirSync(path.join(rcfile.CONFIG_DIR, 'trust', dir)).forEach(function(file) {
					try {
						if (path.extname(file) == '.cer') pems.push({
							hostname: dir,
							raw: fs.readFileSync(path.join(rcfile.CONFIG_DIR, 'trust', dir, file), 'utf-8')
						});
					} catch (ex) {}
				});
			} catch (ex) {}
		});
	} catch (ex) {}
	return pems;
}

server.openFile = function(path) {
	opn(path).catch(function(err) {
		console.error(err);
	});
};

server.revealFile = reveal;

var cache = {};
function getGatewayInfo(gw, type, cb) {
	if (cache[gw] && cache[gw][type]) process.nextTick(function() {
		cb(null, cache[gw][type], gw);
	});
	else {
		var headers = {
			'User-Agent': ua
		};
		if (config.gateways && config.gateways[gw] && config.gateways[gw].token) headers.Authorization = 'Bearer ' + config.gateways[gw].token;
		request({
			url: 'https://' + gw + '/gateway/' + type,
			headers: headers,
			json: true
		}, function(err, res, data) {
			if (err) return cb(err, null, gw);
			else if (res.statusCode != 200) return cb(new Error('Unable to get ' + type + '.  HTTP ' + res.statusCode), null, gw);
			else {
				if (!cache[gw]) cache[gw] = {};
				cache[gw][type] = data;
				cb(null, data, gw);
			}
		});
	}
}


function registerProjectHost(project, inspect) {

	if (inspect.local) {
		var from = project.project + ':L:' + inspect.target;
		var host = hostFrom[from] = Object.assign(inspect, {
			local: true,
			from: from
		});
		setupHost(host, function(err) {
			if (err) return console.error('unable to add local inspector', err);
		});
	} else {
		if (!inspect.host) return console.error('missing hostname', inspect);
		var hostname = inspect.host.replace('{user}', username());
		if (hostname.indexOf('.') == -1) hostname += '.' + project.gateway;

		region(project.gateway, function(err, defaultRegion) {
			if (err) return console.error(err);

			var from = project.project + ':' + inspect.host;
			var host = hostFrom[from] = Object.assign(inspect, {
				host: hostname,
				from: from,
				gateway: project.gateway || 'netsleuth.io'
			});

			setupHost(host, function(err) {
				if (err) return console.error(err);
			});


		});
	}
}

var regionSearch = {};
function region(gw, cb) {
	if (config.gateways && config.gateways[gw] && config.gateways[gw].defaultRegion) cb(null, config.gateways[gw].defaultRegion);
	else if (regionSearch[gw]) regionSearch[gw].push(searched);
	else findBestRegion({ gateway: gw }, searched);

	function searched(err, results) {
		if (err) return cb(err);
		if (results[0] && results[0].ms) cb(null, results[0].id);
		else cb(new Error('Unable to automatically find the best default region.  Run `netsleuth regions best` to try again.'));
	}
}

function findBestRegion(opts, cb) {
	try {
		var Ping = require('net-ping'),
			session = Ping.createSession();
	} catch (ex) {
		return cb(ex);
	}
	regionSearch[opts.gateway] = [];

	getGatewayInfo(opts.gateway, 'regions', function(err, regions) {		
		if (err) return _cb(err);

		var results = regions.map(ping),
			complete = 0;

		function ping(region) {
			var result = {
				id: region.id,
				ms: [],
				errs: 0
			};
			go();
			return result;

			function go() {
				session.pingHost(region.ping, function(err, target, sent, rcvd) {
					if (err) {
						if (++result.errs == 3) done();
						else setTimeout(go, 250);
					}
					else if (result.ms.push(rcvd - sent) >= 3) done();
					else setTimeout(go, 250);
				});
			}

			function done() {
				if (++complete == results.length) {
					results.forEach(function(result) {
						if (result.ms.length) result.ms = result.ms.reduce(sum) / result.ms.length;
						else result.ms = null;
					});
					results.sort(function(a, b) {
						if (a.ms === null) return 1;
						if (b.ms === null) return -1;
						return a.ms - b.ms;
					});

					if (results[0].ms !== null && opts.save !== false) {
						reload();
						if (!config.gateways) config.gateways = {};
						if (!config.gateways[opts.gateway]) config.gateways[opts.gateway] = {};
						config.gateways[opts.gateway].defaultRegion = results[0].id;
						rcfile.save(config);
					}
					_cb(null, results);
				}
			}
		}

	});

	function _cb(err, results) {
		cb(err, results);
		for (var i = 0; i < regionSearch[opts.gateway].length; i++) regionSearch[opts.gatways][i](err, results);

		delete regionSearch[opts.gateway];
	}
}

function sum(total, val) {
	return total + val;
}

if (!config.gateways || !config.gateways['netsleuth.io'] || !config.gateways['netsleuth.io'].defaultRegion) findBestRegion({ gateway: 'netsleuth.io' }, function(err, results) {
	if (err) console.error('No default region set', err);
	else if (results[0].ms == null) console.error('No default region set; unable to find best');
	else console.log('Set default region to ' + results[0].id);
});

server.http.listen(port);

