var util = require('util'),
	request = require('request'),
	Daemon = require('./daemon'),
	rcfile = require('./rcfile');

var daemon = new Daemon();

exports.login = function(gateway, username, password, isDefault, cb) {
	request({
		method: 'POST',
		url: 'https://' + gateway + '/login',
		json: {
			username: username,
			password: password
		}
	}, function(err, res, body) {
		if (err) console.error('Unable to connect to gateway.', err);
		else if (res.statusCode == 200) {
			var config = rcfile.get();

			config.gateways = config.gateways || {};

			config.gateways[gateway] = Object.assign(body, {
				user: username,
				login: Date.now()
			});

			if (isDefault) {
				config.defaultGateway = gateway;
			}

			rcfile.save(config);

			daemon.reload(function(err) {
				cb();
			});

			
		}
		else if (res.statusCode == 401) cb(new HTTPError(401, 'Invalid username or password.'));
		else cb(new Error(res.statusCode + ' ' + res.statusMessage + '\n', body));
	});
};

exports.logout = function(gateway, cb) {
	if (gateway) {
		var config = rcfile.get();
		if (config.gateways && config.gateways[gateway]) {
			delete config.gateways[gateway];
			rcfile.save(config);
			cb(null, 'Logged out of ' + gateway);
		} else {
			cb(new Error('Not logged in to that gateway.'));
		}
	} else {
		rcfile.update({ gateways: {} });
		cb(null, 'Logged out of all accounts.');
	}
	
	daemon.reload(function(err) {
		
	});
};

exports.forgot = function(gateway, username, cb) {
	request({
		method: 'POST',
		url: 'https://' + gateway + '/user/forgot',
		json: {
			username: username
		}
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode != 202) cb(new HTTPError(res.statusCode, res.statusMessage, body));
		else cb();
	});
};
exports.verify = function(gateway, token, cb) {
	request({
		method: 'GET',
		url: 'https://' + gateway + '/user/verify/' + token,
		json: true
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode != 200) cb(new HTTPError(res.statusCode, res.statusMessage, body));
		else cb();
	});
};

exports.reset = function(gateway, token, password, isDefault, cb) {
	request({
		method: 'POST',
		url: 'https://' + gateway + '/user/reset',
		json: {
			token: token,
			password: password
		}
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode == 200) {
			var config = rcfile.get();

			config.gateways = config.gateways || {};

			config.gateways[gateway] = Object.assign(body, {
				user: body.username,
				login: Date.now()
			});

			if (isDefault) {
				config.defaultGateway = gateway;
			}

			rcfile.save(config);

			daemon.reload(function(err) {
				cb(null, body);
			});

		}
		else cb(new HTTPError(res.statusCode, res.statusMessage, body));
	});
};


exports.register = function(gateway, username, password, isDefault, cb) {
	request({
		method: 'POST',
		url: 'https://' + gateway + '/user',
		json: {
			username: username,
			password: password
		}
	}, function(err, res, body) {
		if (err) cb(err);
		else if (res.statusCode == 201) {
			var config = rcfile.get();

			config.gateways = config.gateways || {};

			config.gateways[gateway] = Object.assign(body, {
				user: username,
				login: Date.now()
			});

			if (isDefault) {
				config.defaultGateway = gateway;
			}

			rcfile.save(config);

			cb(null, body.mustVerify);
			
		}
		else cb(new HTTPError(res.statusCode, res.statusMessage, body));
	});
};

exports.reserve = function(host, store, similar, serviceOpts, cb) {
	var config = rcfile.get(),
		gateway = host.split('.').slice(1).join('.');

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'PUT',
			url: 'https://' + gateway + '/reservations/' + host,
			followRedirects: false,
			auth: {
				bearer: config.gateways[gateway].token
			},
			json: {
				store: !!store,
				similar: !!similar,
				serviceOpts: serviceOpts
			}
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200) cb(null, 200, host);
			else if (res.statusCode == 201) cb(null, 201, host);
			else if (res.statusCode == 303) cb(null, 303, res.headers.location.substr(14));
			else cb(null, body);
		});
	} else {
		cb(null, 401);
	}
};

exports.reservations = function(gateway, cb) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'GET',
			url: 'https://' + gateway + '/reservations',
			auth: {
				bearer: config.gateways[gateway].token
			},
			json: true
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200 && Array.isArray(body)) cb(null, body);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		cb(new Error('Not logged in to gateway.'));
	}
};

exports.unreserve = function(host, cb) {
	var config = rcfile.get(),
		gateway = host.split('.').slice(1).join('.');

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'DELETE',
			url: 'https://' + gateway + '/reservations/' + host,
			auth: {
				bearer: config.gateways[gateway].token
			}
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 204) cb();
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		cb(new Error('Not logged in to gateway.'));
	}
};

exports.invite = function(gateway, team, email, admin) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'PUT',
			url: 'https://' + gateway + '/team/' + team + '/invites/' + email,
			auth: {
				bearer: config.gateways[gateway].token
			},
			json: {
				admin: admin
			}
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200 || res.statusCode == 201) cb(null, res.statusCode);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		console.log(gateway + ': not logged in to gateway');
	}
};

exports.rminvite = function(gateway, team, email, cb) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'DELETE',
			url: 'https://' + gateway + '/team/' + team + '/invites/' + email,
			auth: {
				bearer: config.gateways[gateway].token
			}
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200 || res.statusCode == 404) cb(null, res.statusCode);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		console.log(gateway + ': not logged in to gateway');
	}
};

exports.invites = function(gateway, team, cb) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'GET',
			url: 'https://' + gateway + '/team/' + team + '/invites',
			auth: {
				bearer: config.gateways[gateway].token
			},
			json: true
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200) cb(null, body);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		console.log(gateway + ': not logged in to gateway');
	}
};

exports.members = function(gateway, team, cb) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'GET',
			url: 'https://' + gateway + '/team/' + team + '/members',
			auth: {
				bearer: config.gateways[gateway].token
			},
			json: true
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200) cb(null, body);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		console.log(gateway + ': not logged in to gateway');
	}
};

exports.rmmember = function(gateway, team, email, cb) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'DELETE',
			url: 'https://' + gateway + '/team/' + team + '/members/' + email,
			auth: {
				bearer: config.gateways[gateway].token
			}
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200 || res.statusCode == 404) cb(null, res.statusCode);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		console.log(gateway + ': not logged in to gateway');
	}
};

exports.regions = function(gateway, cb) {
	var config = rcfile.get();

	if (config.gateways[gateway] && config.gateways[gateway].token) {
		request({
			method: 'GET',
			url: 'https://' + gateway + '/regions',
			auth: {
				bearer: config.gateways[gateway].token
			},
			json: true
		}, function(err, res, body) {
			if (err) cb(err);
			else if (res.statusCode == 200) cb(null, body);
			else cb(new HTTPError(res.statusCode, res.statusMessage, body));
		});
	} else {
		cb(new Error(gateway + ': not logged in to gateway'));
	}
};


function HTTPError(code, message, body) {
	Error.call(this, message);
	this.message = message;
	this.code = code;
	this.body = body;
}
util.inherits(HTTPError, Error);
