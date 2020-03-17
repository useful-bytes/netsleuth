#!/usr/bin/env node

var https = require('https'),
	fs = require('fs'),
	child_process = require('child_process');

// This script configures authbind on unix-like platforms.  (No action is necessary on Windows.)
// Additionally, it will automatically install authbind on Mac OS.
// Other platforms must install authbind manually with their distro's package manager.

if (process.platform == 'win32') {
	console.error('This script is not necessary on Windows.');
	process.exit(0);
}

if (process.getuid() != 0) {
	console.error('This script must be run as root.  Please sudo and try again.');
	process.exit(1);
}

var exe = child_process.execSync,
	ADMIN_GROUP = process.platform == 'darwin' ? 'admin' : 'adm';

if (process.env.NS_ADMIN_GROUP && !/[\s:]/.test(process.env.NS_ADMIN_GROUP)) ADMIN_GROUP = process.env.NS_ADMIN_GROUP;

if (process.platform == 'darwin' && process.arch == 'x64') {

	var tar = fs.createWriteStream('/tmp/authbind.tar.gz');
	// from https://github.com/Castaglia/MacOSX-authbind
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
} else {
	authorize(80);
	authorize(443);
	if (!require('command-exists').sync('authbind')) {
		console.error('Warning: authbind is not installed on your system.  netsleuth will be unable to listen on privileged ports (like HTTP\'s 80/443).  Please use your system\'s package manager to install authbind.  Learn more at https://netsleuth.io/docs/authbind');
	}
}


function copy(src, dest, owner, mod) {
	exe('cp ' + src + ' ' + dest);
	exe('chown ' + owner + ' ' + dest);
	exe('chmod ' + mod + ' ' + dest);
}
function authorize(port) {
	exe('touch /etc/authbind/byport/' + port);
	exe('chown root:' + ADMIN_GROUP + ' /etc/authbind/byport/' + port);
	exe('chmod 750 /etc/authbind/byport/' + port);
}