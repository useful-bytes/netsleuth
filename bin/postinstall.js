#!/usr/bin/env node
var path = require('path'),
	fs = require('fs');

// If anything fails, we ignore it so npm continues on.
try {
	var rcfile = require('../lib/rcfile'),
		Daemon = require('../lib/daemon'),
		commandExists = require('command-exists');

	var config = rcfile.get(),
		daemon = new Daemon(config);


	if (process.platform != 'win32' && !config.noAuthbind && !process.env.NS_NOAUTHBIND) {
		// On unix platforms, we require a way to listen on privileged ports (only root can bind to ports <1024)
		var authbindConfigured = false,
			authbindInstalled = commandExists.sync('authbind');

		try {
			fs.accessSync('/etc/authbind/byport/80', fs.constants.X_OK);
			authbindConfigured = true;
		} catch (ex) { }



		if (!authbindInstalled || !authbindConfigured) {
			if (process.getuid() == 0) {
				require('./authbind');
				restart();
			} else {
				var state = [];
				if (!authbindInstalled) state.push('installed');
				if (!authbindConfigured) state.push('configured');

				console.error('netsleuth: authbind in not ' + state.join(' and ') + ' on your system, which is required for netsleuth to listen for connections on privileged ports (like HTTP\'s 80/443).');
				console.error('Learn more at https://netsleuth.io/docs/authbind');

				if (process.platform == 'darwin' || !authbindConfigured) {
					if (process.platform == 'darwin') console.error('netsleuth will now attempt to sudo to install and configure authbind...');
					else {
						if (!authbindInstalled) console.error('You will have to use your system\'s package manager (eg apt or yum) to install authbind.');
						console.error('netsleuth will now attempt to sudo to configure authbind...');
					}
					require('sudo-prompt').exec('node ' + path.join(__dirname, 'authbind.js'), { name: 'netsleuth setup' }, function(err, stdout, stderr) {
						if (err) console.error('netsleuth: authbind setup failed.', err);
						if (stderr) console.error(stderr);
						restart();
					});
				} else restart();
			}
		}
		else restart();
	}
	else restart();


	function restart() {
		// This checks whether there is already a netsleuth daemon running in the background.
		// If there isn't, this does nothing.
		// If there is, we restart it so you're not running a stale old version.
		daemon.restart(function(err, running, oldVersion, newVersion) {
			if (err) console.error('Unable to restart netsleuth daemon.', err);
			else if (running) console.log('Restarted netsleuth daemon.  v' + oldVersion + ' \u27a1 v' + newVersion);
		});
	}
} catch (ex) {
	failed(err);
}

function failed(err) {
	console.error('netsleuth postinstall script failed', err);
}