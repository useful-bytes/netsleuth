#!/usr/bin/env node

var systemSetup = require('../lib/system-setup');


if (process.platform == 'win32') {
	console.error('This script is not necessary on Windows.');
	process.exit(0);
}

if (process.getuid() != 0) {
	console.error('This script must be run as root.  Please sudo and try again.');
	process.exit(1);
}

if (process.argv[process.argv.length-1] == 'uninstall') systemSetup.uninstall(function(err) {
	if (err) process.exit(1);
});
else systemSetup.install(function(err) {
	if (err) process.exit(1);
});
