#!/usr/bin/env node

var https = require('https'),
	fs = require('fs'),
	child_process = require('child_process');

if (process.platform != 'darwin' || process.arch != 'x64') {
	console.error('This script only works on Mac x64.  You must manually install authbind on your platform.');
	process.exit(1);
}

var exe = child_process.execSync;

var tar = fs.createWriteStream('/tmp/authbind.tar.gz');
https.get('https://netsleuth.io/dist/darwin/authbind.tar.gz', function(res) {
	res.pipe(tar);
});

tar.on('finish', function() {
	exe('mkdir -p /tmp/authbind');
	exe('tar -xzvf /tmp/authbind.tar.gz', {
		cwd: '/tmp/authbind'
	});
	copy('/tmp/authbind/authbind', '/usr/local/bin/authbind', 'root:wheel', '755');
	exe('mkdir -p /usr/local/lib/authbind');
	copy('/tmp/authbind/libauthbind.dylib', '/usr/local/lib/authbind/libauthbind.dylib', 'root:wheel', '644');
	copy('/tmp/authbind/helper', '/usr/local/lib/authbind/helper', 'root:wheel', '4755');
	exe('mkdir -p /etc/authbind/byport');
	authorize(80);
	authorize(443);
	exe('rm -rf /tmp/authbind*');
});

function copy(src, dest, owner, mod) {
	exe('cp ' + src + ' ' + dest);
	exe('chown ' + owner + ' ' + dest);
	exe('chmod ' + mod + ' ' + dest);
}
function authorize(port) {
	exe('touch /etc/authbind/byport/' + port);
	exe('chown root:admin /etc/authbind/byport/' + port);
	exe('chmod 750 /etc/authbind/byport/' + port);
}