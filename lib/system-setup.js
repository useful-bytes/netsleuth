var https = require('https'),
	fs = require('fs'),
	path = require('path'),
	child_process = require('child_process'),
	commandExists = require('command-exists'),
	sudoPrompt = require('sudo-prompt'),
	pcb = require('./pcb');


var exe = child_process.execSync,
	ADMIN_GROUP,
	LAUNCH_PLIST = '/Library/LaunchDaemons/io.netsleuth.loopback.plist';


exports.getStatus = function(cb) {
	var status = {
		ok: true,
		authbindConfigured: false,
		authbindInstalled: false,
		loopbackConfigured: true,
		pkg: null
	};
	if (process.platform == 'win32') return cb(null, status);

	var done = pcb(function(err) {
		cb(err, !err && status);
	});

	fs.access('/etc/authbind/byport/80', fs.constants.X_OK, done(function(err) {
		if (err) status.ok = false;
		else status.authbindConfigured = true;
	}));

	commandExists('authbind', done(function(err, exists) {
		if (err) return done.fail(err);
		status.authbindInstalled = exists;
		status.ok = status.ok && exists;
	}));

	if (process.platform == 'linux') {
		commandExists('apt-get', done(function(err, exists) {
			if (err) return done.fail(err);
			if (exists) status.pkg = 'apt';
		}));

		// note: redhat systems do not package authbind, so looking for yum would be of no use
	}

	if (process.platform == 'darwin') {
		if (process.arch == 'x64') status.pkg = 'self';
		fs.access(LAUNCH_PLIST, done(function(err) {
			if (err) status.ok = status.loopbackConfigured = false;
		}));
	}
};

exports.install = function(cb) {

	if (process.platform == 'win32') return cb();

	if (process.getuid() != 0) {
		return require('sudo-prompt').exec('node "' + path.join(__dirname, '..', 'bin', 'system-setup.js') + '"', { name: 'netsleuth setup' }, function(err, stdout, stderr) {
			if (err) cb(err);
			else cb();
		});
	}

	var done = pcb(cb);

	if (process.env.NS_ADMIN_GROUP && !/[\s:]/.test(process.env.NS_ADMIN_GROUP)) ADMIN_GROUP = process.env.NS_ADMIN_GROUP;
	else if (process.platform == 'darwin') ADMIN_GROUP = 'admin';
	else {
		var ugroups;
		try {
			if (process.getuid() == 0) ugroups = exe('sudo -nu \\#' + (process.env.PKEXEC_UID || process.env.SUDO_UID || 0) + ' groups');
			else ugroups = exe('groups');

			var ugroup = {};
			ugroups.toString().trim().split(' ').forEach(function(group) {
				ugroup[group] = true;
			});

			// make an educated guess about what group this distro places admin users into by default
			// failing that, fall back to the user's primary group, which is probably their user group
			if (ugroup.adm) ADMIN_GROUP = 'adm'; // debian systems
			else if (ugroup.wheel) ADMIN_GROUP = 'wheel'; // redhat systems
			else ADMIN_GROUP = ugroups[0];

		} catch(ex) {
			// make a guess
			ADMIN_GROUP = 'adm';
		}
	}


	if (process.platform == 'darwin') {

		if (process.arch == 'x64' && !fs.existsSync('/usr/local/bin/authbind')) {
			var tar = fs.createWriteStream('/tmp/authbind.tar.gz');
			// from https://github.com/Castaglia/MacOSX-authbind
			var req = https.get('https://netsleuth.io/dist/darwin/authbind.tar.gz', function(res) {
				if (res.statusCode != 200) done.fail(new Error('Failed to download authbind package.'));
				else res.pipe(tar);
			});

			req.on('error', done.fail);
			tar.on('error', done.fail);

			tar.on('finish', done(function() {
				exe('mkdir -p /tmp/authbind');
				exe('tar -xzf /tmp/authbind.tar.gz', {
					cwd: '/tmp/authbind'
				});
				copy('/tmp/authbind/authbind', '/usr/local/bin/authbind', 'root:wheel', '755');
				exe('mkdir -p /usr/local/lib/authbind');
				copy('/tmp/authbind/libauthbind.dylib', '/usr/local/lib/authbind/libauthbind.dylib', 'root:wheel', '644');
				copy('/tmp/authbind/helper', '/usr/local/lib/authbind/helper', 'root:wheel', '4755');
				exe('rm -rf /tmp/authbind*');
			}));
		}


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
		].join('\n'), done(function(err) {
			if (err) return console.error('Failed to install startup loopback setup script', err);
			exe('chown root:wheel ' + LAUNCH_PLIST);
			exe('chmod 0644 ' + LAUNCH_PLIST);
			exe('launchctl load ' + LAUNCH_PLIST);
		}));

		done.exec(function() {
			require('../bin/loopback');
		});

	} else if (process.platform == 'linux') {
		done.exec(function() {
			if (commandExists.sync('apt-get')) {
				exe('apt-get install -y authbind');
			}
		});
	}

	done.exec(function() {
		exe('mkdir -p /etc/authbind/byport');
		authorize(80);
		authorize(443);
	});

	done();

};

exports.uninstall = function(cb) {

	if (process.platform == 'win32') return cb();

	if (process.getuid() != 0) {
		return require('sudo-prompt').exec('node "' + path.join(__dirname, '..', 'bin', 'system-setup.js') + '" uninstall', { name: 'netsleuth setup' }, function(err, stdout, stderr) {
			if (err) cb(err);
			else cb();
		});
	}

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
};

exports.printStatus = function(status) {
	if (!status.authbindInstalled) {
		if (status.pkg) console.error('- authbind must be installed');
		else console.error('- you must manually install authbind');
	}
	if (!status.authbindConfigured) console.error('- authbind must be configured');
	if (!status.loopbackConfigured) console.error('- the loopback interface must be configured');

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