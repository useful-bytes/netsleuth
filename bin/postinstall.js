
var rcfile = require('../lib/rcfile'),
	daemon = require('../lib/daemon');

var config = rcfile.get();

// This checks whether there is already a netsleuth daemon running in the background.
// If there isn't, this does nothing.
// If there is, we restart it so you're not running a stale old version.

daemon.restart(config.port || 9000, function(err, running, oldVersion, newVersion) {
	if (err) console.error(err);
	else if (running) console.log('Restarted netsleuth daemon.  v' + oldVersion + ' \u27a1 v' + newVersion);
});
