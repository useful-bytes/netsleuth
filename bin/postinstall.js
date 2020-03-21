#!/usr/bin/env node
var path = require('path'),
	fs = require('fs');

// If anything fails, we ignore it so npm continues on.
try {
	
	// This script can run in several different permission scenarios:
	// 1. Regular module installation (npm install netsleuth)
	//    This script runs as the regular user
	// 2. Regular global installation (npm install -g netsleuth)
	//    This script runs as the regular user if the user is allowed to write to the global installation destination.
	//    This is the usual case on Windows.  On unix, the default is /usr/local/*, which normally requires root. (Thus install fails)
	//    However, some package managers change the global install location to somewhere user-writable, so this would work.
	// 3. Root global installation with npm < 7 (sudo npm install -g netsleuth)
	//    When installing as root, npm < 7 drops permissions to the `nobody` user before running postinstall scripts.
	//    This puts us in a hard place since we can't really do anything under this unprivileged account.
	//    This can be avoided by running npm install -g --unsafe-perm, but no one does that.
	// 4. Root global installation with npm ≥ 7 (sudo npm install -g netsleuth)
	//    npm 7 will no longer drop permissions, so this script will run as root (https://github.com/npm/uid-number/issues/7#issuecomment-521376705)
	//    (ie the same as running with --unsafe-perm)
	//
	// To complicate matters (since they aren't enough already)...
	// - The value of $HOME will vary when you sudo npm …  By default:
	//   - On Mac and Ubuntu, it remains the invoking user's (eg /home/me)
	//   - On Fedora, it changes to /root
	//   ...but this can be worked around by ignoring $HOME since `os.homedir()` will look up the home dir of the process' current euid
	//   if $HOME is unset
	// - The UID of `nobody` varies
	//   - Most Linuxes set it to 65534
	//   - Mac sets it to -2 in passwd, but `process.getuid()` will return 4294967294 (ie uint32 underflow of -2)
	//   - Some unixes use other values (99 redhat, 9999 Android, 32767 BSD, 60001 Solaris)
	//   - Some unixes don't have a `nobody` (eg in Docker); npm < 7 fails to install

	// Given all that, let's make a guess at who we're running as...

	var euid = process.getuid && process.getuid(),
		iuid = parseInt(process.env.PKEXEC_UID || process.env.SUDO_UID, 10),
		igid = parseInt(process.env.PKEXEC_GID || process.env.SUDO_GID, 10) || 'nogroup',
		euser;

	// note: euid will be undefined on Windows, so it will (correctly) fall through to `user`
	if (euid === 0) euser = 'root';
	else if (euid == 99 || euid == 9999 || euid == 32767 || euid == 60001 || euid == 65534 || euid == 4294967294) euser = 'nobody';
	else euser = 'user';

	// if we are running as root, try to drop to the invoking user's privileges
	if (euser == 'root' && iuid) {
		try {
			process.setgid(igid);
			process.setuid(iuid);
			delete process.env.HOME;
			euser = 'user';
		} catch (ex) {}
	}

	if (euser != 'user') {
		console.error('\n\nWarning: netsleuth\'s postinstall script is running as ' + euser + '.');
		console.error('It must be running under your user account to work correctly.');
		console.error('Please run `netsleuth restart` to ensure the correct version is running.\n');
	} else {

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

	}



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
	failed(ex);
}

function failed(err) {
	console.error('netsleuth postinstall script failed', err);
}