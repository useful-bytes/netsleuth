#!/usr/bin/env node

// This checks whether there is already a netsleuth daemon running in the background.
// If there isn't, this does nothing.
// If there is, we restart it so you're not running a stale old version.
// If anything fails, we ignore it so npm continues on.

try {
	var rcfile = require('../lib/rcfile'),
		Daemon = require('../lib/daemon');

	var config = rcfile.get(),
		daemon = new Daemon(config);

	daemon.restart(function(err, running, oldVersion, newVersion) {
		if (err) console.error(err);
		else if (running) console.log('Restarted netsleuth daemon.  v' + oldVersion + ' \u27a1 v' + newVersion);
	});
} catch (ex) {
	console.error('Unable to restart netsleuth daemon.', ex);
}
