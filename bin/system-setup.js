#!/usr/bin/env node

var systemSetup = require('../lib/system-setup');


if (process.getuid && process.getuid() != 0) {
	console.error('This script must be run as root.  Please sudo and try again.');
	process.exit(1);
}

var opts = {};
for (var i = 2; i < process.argv.length; i++) {
	var eq = process.argv[i].indexOf('=');
	opts[process.argv[i].substr(0, eq)] = process.argv[i].substr(eq+1);
}

if (process.argv[process.argv.length-1] == 'uninstall') systemSetup.uninstall(opts, function(err) {
	if (err) process.exit(1);
});
else systemSetup.install(opts, function(err) {
	if (err) process.exit(1);
});
