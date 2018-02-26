var path = require('path'),
	express = require('express'),
	bodyParser = require('body-parser'),
	rcfile = require('./rcfile'),
	opn = require('opn');

exports.login = function(opts, cb) {
	var app = express();

	app.use(bodyParser.urlencoded({
		extended: false
	}));

	app.post('/login', function(req, res) {
		var config = rcfile.get();

		var user = JSON.parse(req.body.u);

		var username = user.username;

		config.gateways = config.gateways || {};
		config.gateways[opts.gateway] = Object.assign(user, {
			user: username,
			login: Date.now()
		});

		if (opts.isDefault) {
			config.defaultGateway = opts.gateway;
		}

		res.sendFile(path.join(__dirname + '/../www/success.html'));

		rcfile.save(config);

		setTimeout(function() {
			server.close();
		}, 5000);
		cb(null, username);

	});

	var server = app.listen(function(err) {
		if (err) return cb(err);

		var port = server.address().port,
			dest;

		if (opts.google) {
			dest = 'https://' + opts.gateway + '/login/google?clip=' + port;
		} else if (opts.register) {
			dest = 'https://' + opts.gateway + '/register?clip=' + port;
		} else {
			dest = 'https://' + opts.gateway + '/login?clip=' + port;
		}

		app.get('/css.css', function(req, res) {
			res.sendFile(path.join(__dirname, '../www/css.css'));
		});

		app.get('/login', function(req, res) {
			res.redirect(dest);
		});

		app.get('/welcome', function(req, res) {
			res.sendFile(path.join(__dirname, '../www/welcome.html'));
		});


		opn('http://127.0.0.1:' + port + '/' + (opts.welcome ? 'welcome' : 'login')).catch(cb);
	});
};