#!/usr/bin/env node

var fs = require('fs'),
	os = require('os'),
	dialog = require('dialog'),
	rcfile = require('../lib/rcfile'),
	gw = require('../lib/gateway-client'),
	browserLogin = require('../lib/browser-login'),
	hosts = require('../lib/hosts'),
	serverCert = require('../lib/server-cert'),
	Server = require('../server');

if (!process.stdout.isTTY) {
	process.on('uncaughtException', function(err) {
		server.http.close();
		dialog.err('The Network Sleuth inspection server has crashed due to an uncaught exception.\n\n' + err.stack, 'Network Sleuth');
		process.exit(1);
	});
}

var config = rcfile.get(),
	port = +process.argv[2];

var server = new Server({
	gateways: config.gateways,
	port: port
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

	var inspector;

	if (host.local) {
		inspector = server.inspectOutgoing(host, cb);
	} else {
		inspector = server.inspect(host);

		inspector.on('error', function(err) {
			console.log('insp err', host, err);
		});
		
		if (cb) cb(null, inspector);
	}

}

function reload() {
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

	addHost(req.body, function(err, inspector, ip) {

		if (err) ierr(err);
		else {


			inspector.on('error', ierr);

			inspector.on('hostname', function(host) {
				inspector.removeListener('error', ierr);

				if (ip) {
					req.body.ip = ip;
					inspector.opts.ip = ip;
					host = req.body.host;
				}
				
				if (!req.body.temp) {
					reload();
					config.hosts[host] = req.body;
					rcfile.save(config);
				}

				if (req.body.local) {
					if (req.body.hostsfile) {
						hosts.add(ip, host, function(err) {
							res.send({ host: host, hostsUpdated: !err });
						});
					} else res.send({ host: host });
				}
				else res.send({ host: host });
			});
			
		}

		function ierr(err) {
			console.error('ierr', err);
			if (inspector) inspector.removeListener('error', ierr);
			res.status(err.status || 500).send(err.message);
			if (req.body.host) server.remove(req.body.host);
			else if (inspector) inspector.close();
		}
			
	});

});

server.app.post('/ipc/rm', isLocal, function(req, res) {
	if (req.body && req.body.hosts && Array.isArray(req.body.hosts)) {
		reload();
		req.body.hosts.forEach(function(host) {
			var insp = server.inspectors[host];
			if (insp.opts.hostsfile) {
				hosts.remove(insp.opts.ip, insp.opts.host, function(err) {
					if (err) console.error('error removing HOSTS entry for ' + insp.opts.host, err);
				});
			}
			server.remove(host);
			delete config.hosts[host];

			if (!host.local && !req.body.keepReservation) gw.unreserve(host, function(err) {
				if (err) console.error('error unreserving host', host);
			});
		});
		rcfile.save(config);
	}
	res.send({});
});

server.app.post('/ipc/project', isLocal, function(req, res) {
	
	var project = req.body || {}

	var gw = project.gateway || 'netsleuth.io';
	if (!config.gateways || !config.gateways[gw]) {
		browserLogin.login({
			gateway: gw,
			google: project.googleAuth,
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
					from = project.project + ':' + inspect.hostname;
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


function registerProjectHost(project, inspect) {

	if (inspect.local) {
		var from = project.project + ':L:' + inspect.target;
		var host = hostFrom[from] = {
			local: true,
			from: from,
			target: inspect.target,
			insecure: inspect.insecure,
			gcFreqMs: inspect.gcFreqMs,
			gcFreqCount: inspect.gcFreqCount,
			gcMinLifetime: inspect.gcMinLifetime,
			reqMaxSize: inspect.reqMaxSize,
			resMaxSize: inspect.resMaxSize
		};
		addHost(host, function(err, inspector, ip) {
			if (err) return console.error('unable to add local inspector', err);
			host.host = ip;
			config.hosts[ip] = host;
			rcfile.save(config);
		});
	} else {
		if (!inspect.hostname) return console.error('missing hostname', inspect);
		var hostname = inspect.hostname.replace('{user}', username());
		if (hostname.indexOf('.') == -1) hostname += '.' + project.gateway;

		gw.reserve(hostname, inspect.store, true, {}, function(err, res, hostname) {
			if (err) console.error(err);
			else if (hostname) {
				config.hosts = config.hosts || {};
				var from = project.project + ':' + inspect.hostname;
				var host = hostFrom[from] = config.hosts[hostname] = {
					from: from,
					host: hostname,
					gateway: project.gateway,
					target: inspect.target,
					insecure: inspect.insecure,
					gcFreqMs: inspect.gcFreqMs,
					gcFreqCount: inspect.gcFreqCount,
					gcMinLifetime: inspect.gcMinLifetime,
					reqMaxSize: inspect.reqMaxSize,
					resMaxSize: inspect.resMaxSize
				};
				rcfile.save(config);

				addHost(host, function(err, inspector) {
					
				});
			}
		});
	}
}

server.http.listen(port);

