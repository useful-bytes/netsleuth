#!/usr/bin/env node

var https = require('https'),
	fs = require('fs'),
	path = require('path'),
	child_process = require('child_process');

// This script configures authbind on unix-like platforms.  (No action is necessary on Windows.)
// Additionally, it will automatically install authbind on Mac OS.
// Other platforms must install authbind manually with their distro's package manager.


var exe = child_process.execSync,
	ADMIN_GROUP = process.platform == 'darwin' ? 'admin' : 'adm',
	LAUNCH_PLIST = '/Library/LaunchDaemons/io.netsleuth.loopback.plist';

if (process.env.NS_ADMIN_GROUP && !/[\s:]/.test(process.env.NS_ADMIN_GROUP)) ADMIN_GROUP = process.env.NS_ADMIN_GROUP;


function install() {

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

		require('./loopback');


		fs.writeFile(LAUNCH_PLIST, [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
			'<plist version="1.0">',
			'  <dict>',
			'      <key>Label</key>',
			'      <string>io.netsleuth.loopback</string>',
			'      <key>RunAtLoad</key>',
			'      <true/>',
			'      <key>ProgramArguments</key>',
			'      <array>',
			'          <string>' + process.execPath + '</string>',
			'          <string>' + path.join(__dirname, 'loopback.js') + '</string>',
			'      </array>',
			'      <key>StandardErrorPath</key>',
			'      <string>/var/log/loopback-alias.log</string>',
			'      <key>StandardOutPath</key>',
			'      <string>/var/log/loopback-alias.log</string>',
			'  </dict>',
			'</plist>'
		].join('\n'), function(err) {
			if (err) return console.error('Failed to install startup loopback setup script', err);
			exe('chown root:wheel ' + LAUNCH_PLIST);
			exe('chmod 0644 ' + LAUNCH_PLIST);
			exe('launchctl load ' + LAUNCH_PLIST);
		});

	} else {
		authorize(80);
		authorize(443);
		if (!require('command-exists').sync('authbind')) {
			console.error('Warning: authbind is not installed on your system.  netsleuth will be unable to listen on privileged ports (like HTTP\'s 80/443).  Please use your system\'s package manager to install authbind.  Learn more at https://netsleuth.io/docs/authbind');
		}
	}
}

function uninstall() {
	if (process.platform == 'darwin' && process.arch == 'x64') {
		try {
			exe('launchctl unload ' + LAUNCH_PLIST);
		} catch(ex) { }
		rm('/usr/local/bin/authbind');
		rm('/usr/local/lib/authbind/helper');
		rm('/usr/local/lib/authbind/libauthbind.dylib');
		rm(LAUNCH_PLIST);
		// loopback aliases will disappear on reboot
	}

	rm('/etc/authbind/byport/80');
	rm('/etc/authbind/byport/443');
}


function copy(src, dest, owner, mod) {
	exe('cp ' + src + ' ' + dest);
	exe('chown ' + owner + ' ' + dest);
	exe('chmod ' + mod + ' ' + dest);
}

function rm(file) {
	fs.unlink(file, function(err) {
		// ignore
	});
}

function authorize(port) {
	exe('touch /etc/authbind/byport/' + port);
	exe('chown root:' + ADMIN_GROUP + ' /etc/authbind/byport/' + port);
	exe('chmod 750 /etc/authbind/byport/' + port);
}


if (module === require.main) {

	if (process.platform == 'win32') {
		console.error('This script is not necessary on Windows.');
		process.exit(0);
	}

	if (process.getuid() != 0) {
		console.error('This script must be run as root.  Please sudo and try again.');
		process.exit(1);
	}

	if (process.argv[process.argv.length-1] == 'uninstall') uninstall();
	else install();
}

exports.install = install;
exports.uninstall = uninstall;
