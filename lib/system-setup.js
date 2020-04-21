var https = require('https'),
	fs = require('fs'),
	path = require('path'),
	child_process = require('child_process'),
	commandExists = require('command-exists'),
	sudoPrompt = require('sudo-prompt'),
	CertificateAuthority = require('./certs'),
	pcb = require('./pcb');


var exe = child_process.execSync,
	ADMIN_GROUP,
	LAUNCH_PLIST = '/Library/LaunchDaemons/io.netsleuth.loopback.plist',
	DEB_CA_STORE = '/usr/local/share/ca-certificates/extra',
	RH_CA_STORE = '/etc/pki/ca-trust/source/anchors';


exports.getStatus = function(ca, cb) {
	var status = {
		ok: true,
		caCertInstalled: null,
		authbindConfigured: null,
		authbindInstalled: null,
		loopbackConfigured: true,
		pkg: null
	};

	var done = pcb(function(err) {
		cb(err, !err && status);
	});

	if (ca) {
		if (process.platform == 'win32') {
			child_process.exec('certutil -verifystore root ' + ca.cert.serialNumber, done(function(err) {
				if (err) status.caCertInstalled = status.ok = false;
				else status.caCertInstalled = true;
			}));
		} else if (process.platform == 'darwin') {
			child_process.exec('/usr/bin/security find-certificate -a -c netsleuth', done(function(err, stdout, stderr) {
				if (err) console.error('Failed to search for CA cert');
				else {
					status.caCertInstalled = stdout.indexOf('\n    "snbr"<blob>=0x' + ca.cert.serialNumber.toUpperCase()) > 0;
					status.ok = status.ok && status.caCertInstalled;
				}
			}));
		} else {
			fs.access(DEB_CA_STORE + '/netsleuth.crt', done(function(err) {
				if (err) fs.access(RH_CA_STORE + '/netsleuth.crt', done(function(err) {
					if (err) status.ok = status.caCertInstalled = false;
					else status.caCertInstalled = true;
				}));
				else status.caCertInstalled = true;
			}));
		}
	}

	if (process.platform != 'win32') {
		fs.access('/etc/authbind/byport/80', fs.constants.X_OK, done(function(err) {
			if (err) status.authbindConfigured = status.ok = false;
			else status.authbindConfigured = true;
		}));

		commandExists('authbind', done(function(err, exists) {
			if (err) return done.fail(err);
			status.authbindInstalled = status.authbindInstalled = exists;
			status.ok = status.ok && exists;
		}));
	}

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

exports.install = function(opts, cb) {

	if ((process.getuid && process.getuid() != 0) || (!process.getuid && !opts.elevated)) {
		var ostr = '';
		opts.elevated = true;
		for (var k in opts) ostr += ' ' + k + '="' + opts[k] + '"';
		return require('sudo-prompt').exec('node "' + path.join(__dirname, '..', 'bin', 'system-setup.js') + '"' + ostr, { name: 'netsleuth setup' }, function(err, stdout, stderr) {
			if (err) cb(err);
			else cb();
		});
	}

	var done = pcb(cb);

	if (opts.ca) {
		if (process.platform == 'win32') child_process.exec('certutil -addstore -f root "' + opts.ca + '"', done());
		else if (process.platform == 'darwin') child_process.exec('/usr/bin/security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "' + opts.ca + '"', done());
		else {
			var CA_STORE;
			commandExists('update-ca-certificates', done(function(err, exists) { // debian
				if (exists) {
					CA_STORE = DEB_CA_STORE;
					fs.mkdir(CA_STORE, 0o755, done(function(err) {
						if (err && err.code != 'EEXIST') return console.error(err);
						copy('update-ca-certificates');
					}));
				}
				else commandExists('update-ca-trust', done(function(err, exists) { // rh
					if (exists) {
						CA_STORE = RH_CA_STORE;
						copy('update-ca-trust');
					}
					else console.error('unknown trust store');
				}));
			}));


			function copy(updateCmd) {

				var src = fs.createReadStream(opts.ca);
				var dest = fs.createWriteStream(CA_STORE + '/netsleuth.crt', {
					mode: 0o644
				});

				src.on('error', console.error);
				dest.on('error', console.error);

				dest.on('finish', done(function() {
					exe(updateCmd);
				}));

				src.pipe(dest);

			}
		}
	}

	if (process.platform != 'win32') {
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

	if (process.platform != 'win32') done.exec(function() {
		exe('mkdir -p /etc/authbind/byport');
		authorize(80);
		authorize(443);
	});

	done.end();

};

exports.uninstall = function(opts, cb) {


	if ((process.getuid && process.getuid() != 0) || (!process.getuid && !opts.elevated)) {
		var ostr = '';
		opts.elevated = true;
		for (var k in opts) ostr += ' ' + k + '="' + opts[k] + '"';
		return require('sudo-prompt').exec('node "' + path.join(__dirname, '..', 'bin', 'system-setup.js') + '"' + ostr + ' uninstall', { name: 'netsleuth setup' }, function(err, stdout, stderr) {
			if (err) cb(err);
			else cb();
		});
	}

	var done = pcb(cb);

	if (process.platform == 'darwin' && process.arch == 'x64') {
		try {
			exe('launchctl unload ' + LAUNCH_PLIST);
		} catch(ex) { }
		rm('/usr/local/bin/authbind', done());
		rm('/usr/local/lib/authbind/helper', done());
		rm('/usr/local/lib/authbind/libauthbind.dylib', done());
		rm(LAUNCH_PLIST, done());
		// loopback aliases will disappear on reboot
	}

	if (process.platform != 'win32') {
		rm('/etc/authbind/byport/80', done());
		rm('/etc/authbind/byport/443', done());
	}

	if (opts.ca) {
		var ca = new CertificateAuthority({
			cert: fs.readFileSync(opts.ca)
		});
		if (process.platform == 'win32') try {
			exe('certutil -delstore root ' + ca.cert.serialNumber);
		} catch (ex) {}
		else if (process.platform == 'darwin') try {
			exe('/usr/bin/security delete-certificate -t -Z ' + ca.sha1())
		} catch (ex) {}
		else {
			commandExists('update-ca-certificates', done(function(err, exists) { // debian
				if (exists) rm(DEB_CA_STORE + '/netsleuth.crt', done(function() {
					exe('update-ca-certificates');
				}));
				else commandExists('update-ca-trust', done(function(err, exists) { // rh
					if (exists) rm(RH_CA_STORE + '/netsleuth.crt', done(function() {
						exe('update-ca-trust');	
					}));
					else console.error('unknown trust store');
				}));
			}));
		}
	}

	done.end();
};

exports.printStatus = function(status) {
	if (status.authbindInstalled === false) {
		if (status.pkg) console.error('- authbind must be installed');
		else console.error('- you must manually install authbind');
	}
	if (status.authbindConfigured === false) console.error('- authbind must be configured');
	if (!status.loopbackConfigured) console.error('- the loopback interface must be configured');
	if (status.caCertInstalled === false) console.error('- proxy CA certificate is not installed as a truested CA');

}

function copy(src, dest, owner, mod) {
	exe('cp ' + src + ' ' + dest);
	exe('chown ' + owner + ' ' + dest);
	exe('chmod ' + mod + ' ' + dest);
}

function rm(file, cb) {
	fs.unlink(file, cb || function(err) {
		// ignore
	});
}

function authorize(port) {
	exe('touch /etc/authbind/byport/' + port);
	exe('chown root:' + ADMIN_GROUP + ' /etc/authbind/byport/' + port);
	exe('chmod 750 /etc/authbind/byport/' + port);
}