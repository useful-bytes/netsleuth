#!/usr/bin/env node

var child_process = require('child_process');

if (process.platform != 'darwin') {
	console.error('This script is only necessary on Mac OS.');
	process.exit(0);
}

// Unlike all other OSes, Mac OS only allows you to bind to 127.0.0.1
// This script adds aliases to the loopback interface so we can listen on 127.0.0.2 ...

for (var i = 2; i < 22; i++) {
	child_process.exec('ifconfig lo0 alias 127.0.0.' + i + ' up', function() {});
}
