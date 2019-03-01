#!/usr/bin/env node

var fs = require('fs'),
	os = require('os'),
	dialog = require('dialog'),
	rcfile = require('../lib/rcfile'),
	gw = require('../lib/gateway-client'),
	browserLogin = require('../lib/browser-login'),
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
			return fs.readFileSync(path);
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

}


function isLocal(req, res, next) {
	var origin = req.headers.origin || '';
	if (origin.substr(0, 10) != 'netsleuth:' &&
		origin != 'http://localhost:' + port &&
		origin != 'http://127.0.0.1:' + port
	) res.status(403).send('This request must be made from an allowed origin.');
	else if (req.socket.remoteAddress == '127.0.0.1' || req.socket.remoteAddress == '::ffff:127.0.0.1') next();
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

	var host = req.body;

	addHost(host, function(err, inspector) {

		if (err) ierr(err);
		else {

			inspector.on('error', ierr);

			inspector.on('hostname', function(host) {
				inspector.removeListener('error', ierr);
				res.send({host:host});
			});
			
		}
			
		function ierr(err) {
			inspector.removeListener('error', ierr);
			res.status(err.status || 500).send(err.message);
			if (host.host) server.remove(host.host);
			else inspector.close();
		}
	});

});

server.app.post('/ipc/rm', isLocal, function(req, res) {
	if (req.body && req.body.hosts && Array.isArray(req.body.hosts)) {
		req.body.hosts.forEach(function(host) {
			server.remove(host);
		});
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
				var host = hostFrom[project.project + ':' + inspect.hostname];
				if (host) {

				} else {
					registerProjectHost(project, inspect);
				}
			});
		}

		res.sendStatus(204);
	}
});


function registerProjectHost(project, inspect) {
	var hostname = inspect.hostname.replace('{user}', username());
	if (hostname.indexOf('.') == -1) hostname += '.' + project.gateway;
	if (inspect.reserve) {
		gw.reserve(hostname, inspect.store, true, function(err, res, hostname) {
			if (err) console.error(err);
			else if (hostname) {
				config.hosts = config.hosts || {};
				var from = project.project + ':' + inspect.hostname;
				var host = hostFrom[from] = config.hosts[hostname] = {
					from: from,
					host: hostname,
					target: inspect.target,
					gateway: project.gateway
				};
				rcfile.save(config);

				addHost(host, function(err, inspector) {
					
				});
			}
		});
	}
}

server.http.listen(port);

