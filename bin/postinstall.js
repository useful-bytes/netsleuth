#!/usr/bin/env node
var path = require('path'),
	fs = require('fs');

// If anything fails, we ignore it so npm continues on.
try {
	var rcfile = require('../lib/rcfile'),
		Daemon = require('../lib/daemon'),
		systemSetup = require('../lib/system-setup');

	var config = rcfile.get(),
		daemon = new Daemon(config);


	systemSetup.getStatus(function(err, status) {
		if (err) console.error('warning: netsleuth failed to get current system setup status.', err);
		else if (!status.ok) {
			console.error('netsleuth: System setup is incomplete');
			console.error('Additional system configuration is required to allow netsleuth to listen for connections on privileged ports.  See https://netsleuth.io/docs/privileged-ports');
			systemSetup.printStatus(status);
			console.error('\nThe GUI will prompt to complete this configuration for you, or you can run `sudo netsleuth setup`.');
		}
		restart();
	});


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