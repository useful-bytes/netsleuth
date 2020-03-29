var fs = require('fs'),
	os = require('os'),
	path = require('path');


var CONFIG_BASE = exports.CONFIG_BASE = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
	CONFIG_DIR = exports.CONFIG_DIR = path.join(CONFIG_BASE, 'netsleuth'),
	CONFIG_FILE = exports.CONFIG_FILE = path.join(CONFIG_DIR, 'config.json'),
	RUN_BASE;

if (process.platform == 'win32') RUN_BASE = exports.RUN_BASE = '\\\\.\\pipe';
else {
	RUN_BASE = exports.RUN_BASE = process.env.XDG_RUNTIME_DIR;
	if (!RUN_BASE) try {
		fs.accessSync('/run/user/' + process.getuid(), fs.constants.W_OK);
		RUN_BASE = exports.RUN_BASE = '/run/user/' + process.getuid();
	} catch (ex) {
		RUN_BASE = exports.RUN_BASE = CONFIG_DIR; // darwin likely ends up here
	}
}

try {
	fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 }); // note: opts only on node >= 10.12
} catch (ex) {
	console.error('Failed to create config dir', ex);
}

function get() {
	var rc;
	try {
		rc = fs.readFileSync(CONFIG_FILE);
		rc = JSON.parse(rc);
	} catch (ex) {
		if (ex.code == 'ENOENT') {
			// migrate 1.x file
			try {
				rc = fs.readFileSync(path.join(os.homedir(), '.sleuthrc'));
				rc = JSON.parse(rc);
			} catch (ex) {
				if (ex.code == 'ENOENT') rc = {}
				else throw ex;
			}
		}
		else throw ex;
	}

	return rc;
}

function save(cfg) {
	cfg = JSON.stringify(cfg, null, '\t');
	fs.writeFileSync(CONFIG_FILE, cfg, {
		mode: 0o600
	});

	try {
		if (process.getuid && process.getuid() == 0) {
			var uid = parseInt(process.env.PKEXEC_UID || process.env.SUDO_UID, 10),
				gid = parseInt(process.env.PKEXEC_GID || process.env.SUDO_GID, 10);
			fs.chownSync(CONFIG_FILE, uid, gid);
		}
	} catch (ex) { console.error('.sleuthrc chown', ex); }
}

function update(cfg) {
	cfg = Object.assign(get(), cfg);
	save(cfg);
}

exports.get = get;
exports.save = save;
exports.update = update;
