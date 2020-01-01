var path = require('path'),
	child_process = require('child_process'),
	http = require('http'),
	url = require('url'),
	rcfile = require('./rcfile');

var config = rcfile.get();

var agent = new http.Agent();
agent.__ignore = true;

function Daemon(opts) {
	opts = opts || {};
	this.opts = opts;
	this.autoStart = opts.autoStart;

	var host = opts.host || process.env.NETSLEUTH_HOST || config.host;

	if (!host) {
		try {
			if (process.platform == 'linux' && fs.readFileSync('/proc/self/cgroup', 'utf8').indexOf('docker') > 0) {
				// This process is running inside a docker container, so use the magic hostname to connect to the bare-metal host
				// Note: the magic hostname does not work on docker-for-linux; see https://github.com/docker/for-linux/issues/264
				host = 'host.docker.internal:9000';
				// Running the netsleuth daemon inside a container is not a supported configuration, so we will not auto-start it.
				// If you *really* want the daemon to run in the container, you can override this by explicitly passing in `autoStart: true`
				if (opts.autoStart !== true) this.autoStart = false;
			} else host = '127.0.0.1:9000';
		} catch (ex) {
			host = '127.0.0.1:9000';
		}
	}

	this.setHost(host);

}

Daemon.prototype.setHost = function(host) {

	var parsed = this._host = url.parse('http://' + host);

	if (!parsed.hostname || !parsed.port || parsed.pathname != '/' || host[host.length-1] == '/') throw new Error('Invalid inspector host "' + host + '".  Must specify host and port.');

	this.host = host;

};

function request(opts, cb) {
	var ropts = url.parse(opts.url),
		body,
		to;
	ropts.agent = opts.agent;
	ropts.headers = opts.headers || {};
	if (typeof opts.json == 'object') {
		body = Buffer.from(JSON.stringify(opts.json));
		ropts.headers['Content-Type'] = 'application/json';
		ropts.headers['Content-Length'] = body.length;
	}
	ropts.method = opts.method;
	var req = http.request(ropts);
	req.on('error', function(err) {
		done(err);
	});
	req.on('response', function(res) {
		var buf = [];
		res.on('data', function(chunk) {
			buf.push(chunk);
		});
		res.on('end', function() {
			clearTimeout(to);
			buf = Buffer.concat(buf);
			if (opts.json) buf = JSON.parse(buf.toString());
			done(null, res, buf);
		});
	});
	req.end(body);
	if (opts.timeout) {
		to = setTimeout(function() {
			req.abort();
			done(new Error('Request timeout'));
		}, opts.timeout);
	}

	function done() {
		if (cb) cb.apply(this, arguments);
		cb = null;
	}
}


Daemon.prototype.isAlive = function(cb) {
	var self = this;
	request({
		url: 'http://' + self.host + '/sleuth',
		json: true,
		agent: agent,
		timeout: 2500
	}, function(err, res, body) {
		if (res && res.statusCode == 200 && body && body.sleuth) {
			cb(null, body, self.host);
		} else {
			if (res && res.statusCode) {
				var ex = new Error('There is a HTTP service on ' + self.host + ', but it does not appear to be the netsleuth daemon.');
				ex.fatal = true;
				cb(ex);
			}
			else cb(err || new Error('unknown error'));
		}
	});
};

Daemon.prototype.start = function(cb) {
	var self = this;
	self.isAlive(function(err, versions, host) {
		if (err) {
			if (err.fatal) cb(err);
			else if (self.autoStart !== false) self.spawn(cb);
			else cb(new Error('netsleuth daemon is not running and auto-start is disabled.'));
		} else cb(null, true, host, versions.sleuth);
	});
};

Daemon.prototype.restart = function(cb) {
	var self = this;
	if (self.autoStart === false) cb(new Error('Cannot restart netsleuth daemon because auto-start is disabled.'));
	else self.isAlive(function(err, oldVersions) {
		if (err) cb(null, false);
		else self.stop(function(err) {
			if (err) cb(err);
			else setTimeout(function() {
				self.spawn(function(err) {
					if (err) cb(err);
					else cb(null, true, oldVersions.sleuth, require('../package.json').version);
				});
			}, 500);
		});
	});
};

Daemon.prototype.spawn = function(cb) {
	var self = this;
	var proc = child_process.spawn('node', [path.join(__dirname, '..', 'bin', 'daemon.js'), self._host.port], {
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
		self.isAlive(function(err, versions) {
			if (cb) {
				if (err) {
					if (++attempts == 50) {
						cb(err);
						cb = null;
					}
					else setTimeout(ping, 100);
				} else {
					cb(null, false, self.host, versions.sleuth);
					cb = null;
				}
			}
		});
	}

};

Daemon.prototype.stop = function(cb) {
	var self = this;
	request({
		method: 'POST',
		url: 'http://' + self.host + '/ipc/stop',
		headers: {
			Origin: 'netsleuth:api'
		},
		agent: agent
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode != 204) cb(new Error('HTTP ' + res.statusCode + ' ' + body));
		else cb();
	});
};

Daemon.prototype.reload = function(cb) {
	var self = this;
	request({
		method: 'POST',
		url: 'http://' + self.host + '/ipc/reload',
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
};

Daemon.prototype.initProject = function(config, cb) {
	var self = this;
	request({
		method: 'POST',
		url: 'http://' + self.host + '/ipc/project',
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
};

Daemon.prototype.add = function(opts, cb) {
	var self = this;
	request({
		method: 'POST',
		url: 'http://' + self.host + '/ipc/add',
		headers: {
			Origin: 'netsleuth:api'
		},
		agent: agent,
		json: opts
	}, function(err, res, body) {
		if (err) return cb(err);
		if (res.statusCode != 200) return cb(new Error(body || 'HTTP ' + res.statusCode));

		cb(null, body);

	});
}

Daemon.prototype.rm = function(opts, cb) {
	var self = this;
	self.start(function(err) {
		if (err) cb(err);
		else request({
			method: 'POST',
			url: 'http://' + self.host + '/ipc/rm',
			headers: {
				Origin: 'netsleuth:api'
			},
			agent: agent,
			json: opts
		}, function(err, res, body) {
			if (err) return cb(err);
			if (res.statusCode != 200) return cb(new Error(body || 'HTTP ' + res.statusCode));

			cb(null, body);

		});
	});
};


exports = module.exports = Daemon;
