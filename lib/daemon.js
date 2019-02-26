var path = require('path'),
	child_process = require('child_process'),
	http = require('http'),
	request = require('request');

var agent = new http.Agent();
agent.__ignore = true;

function isAlive(port, cb) {
	request({
		url: 'http://127.0.0.1:' + port + '/sleuth',
		json: true,
		agent: agent,
		timeout: 1000
	}, function(err, res, body) {
		if (res && res.statusCode == 200 && body && body.sleuth) {
			cb(null, body);
		} else {
			if (res && res.statusCode == 200) cb(new Error('There is a HTTP service on port ' + port + ', but it does not appear to be the netsleuth daemon.'));
			else cb(err || new Error(res.statusCode));
		}
	});

}

function start(port, cb) {
	isAlive(port, function(err) {
		if (err) spawn(port, cb);
		else cb(null, true);
	});
}

function restart(port, cb) {
	isAlive(port, function(err, oldVersions) {
		if (err) cb(null, false);
		else stop(port, function(err) {
			if (err) cb(err);
			else setTimeout(function() {
				spawn(port, function(err) {
					if (err) cb(err);
					else cb(null, true, oldVersions.sleuth, require('../package.json').version);
				});
			}, 500);
		});
	});
}

function spawn(port, cb) {
	var proc = child_process.spawn('node', [path.join(__dirname, '..', 'bin', 'daemon.js'), port], {
		stdio: 'ignore',
		detached: true
	});

	proc.on('error', function(err) {
		if (cb) cb(err);
		cb = null;
	});

	proc.on('exit', function(code) {
		if (cb) cb(new Error('Server exited with code ' + code));
		cb = null;
	});

	proc.unref();

	ping();
	
	var attempts = 0;
	function ping() {
		isAlive(port, function(err) {
			if (cb) {
				if (err) {
					if (++attempts == 50) {
						cb(err);
						cb = null;
					}
					else setTimeout(ping, 100);
				} else {
					cb();
					cb = null;
				}
			}
		});
	}

}

function stop(port, cb) {
	request({
		method: 'POST',
		url: 'http://127.0.0.1:' + port + '/ipc/stop',
		headers: {
			Origin: 'netsleuth:api'
		},
		agent: agent
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode != 204) cb(new Error('HTTP ' + res.statusCode + ' ' + body));
		else cb();
	});
}

function reload(port, cb) {
	request({
		method: 'POST',
		url: 'http://127.0.0.1:' + port + '/ipc/reload',
		headers: {
			Origin: 'netsleuth:api'
		},
		agent: agent,
		timeout: 250
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode != 204) cb(new Error('HTTP ' + res.statusCode + ' ' + body));
		else cb();
	});
}

function initProject(port, config, cb) {
	request({
		method: 'POST',
		url: 'http://127.0.0.1:' + port + '/ipc/project',
		headers: {
			Origin: 'netsleuth:api'
		},
		agent: agent,
		json: config
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode != 204) cb(new Error('HTTP ' + res.statusCode + ' ' + body));
		else cb();
	});
}

exports.start = start;
exports.restart = restart;
exports.stop = stop;
exports.reload = reload;
exports.initProject = initProject;
