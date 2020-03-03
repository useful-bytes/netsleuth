var path = require('path'),
	fs = require('fs'),
	crypto = require('crypto'),
	express = require('express'),
	bodyParser = require('body-parser'),
	request = require('request'),
	rcfile = require('./rcfile'),
	Daemon = require('./daemon'),
	opn = require('opn');

exports.login = function(opts, cb) {
	var app = express(),
		sid = crypto.randomBytes(36).toString('base64');

	var gotted = false;

	app.get('/logged-in', function(req, res) {
		if (gotted) {
			return res.status(409).send('Error: double-complete');
		}
		gotted = true;

		request({
			method: 'POST',
			url: 'https://' + opts.gateway + '/login/claim',
			json: {
				sid: sid
			}
		}, function(err, cres, user) {
			if (err || cres.statusCode != 200) return res.status(500).send('Error completing login.');

			var config = rcfile.get();

			var username = user.username;

			config.gateways = config.gateways || {};
			config.gateways[opts.gateway] = Object.assign(user, {
				user: username,
				login: Date.now()
			});

			if (opts.isDefault) {
				config.defaultGateway = opts.gateway;
			}


			rcfile.save(config);

			res.sendFile(path.join(__dirname + '/../www/success.html'));

			setTimeout(function() {
				var daemon = new Daemon(config);
				daemon.reload(function(err) {
					cb(err, username);
				});
			}, 1000);

			setTimeout(function() {
				server.close();
			}, 5000);

		});
	});

	var server = app.listen(function(err) {
		if (err) return cb(err);

		var port = server.address().port,
			dest;

		if (opts.googleAuth) {
			dest = 'https://' + opts.gateway + '/login/google?clip=' + port + '&sid=' + encodeURIComponent(sid);
		} else if (opts.register) {
			dest = 'https://' + opts.gateway + '/register?clip=' + port + '&sid=' + encodeURIComponent(sid);
		} else {
			dest = 'https://' + opts.gateway + '/login?clip=' + port + '&sid=' + encodeURIComponent(sid);
		}

		app.get('/css.css', function(req, res) {
			res.sendFile(path.join(__dirname, '../www/css.css'));
		});

		app.get('/login', function(req, res) {
			res.redirect(dest);
		});

		app.get('/welcome', function(req, res) {
			fs.readFile(__dirname + '/../www/welcome.html', 'utf-8', function(err, content) {
				if (err) return res.status(500).send(err.stack);
				var msg = opts.welcomeMessage ? '<p>' + opts.welcomeMessage + '</p>' : '';
				res.type('html').send(content.replace('$GATEWAY', opts.gateway).replace('$MESSAGE', msg));
			});
		});

		app.use('/img', express.static(path.join(__dirname, '../www/img')));


		opn('http://127.0.0.1:' + port + '/' + (opts.welcome ? 'welcome' : 'login')).catch(cb);
	});
};