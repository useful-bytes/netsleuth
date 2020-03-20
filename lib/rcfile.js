var fs = require('fs'),
	os = require('os'),
	path = require('path');

function get() {
	var rc;
	try {
		rc = fs.readFileSync(path.join(os.homedir(), '.sleuthrc'));
		rc = JSON.parse(rc);
	} catch (ex) {
		if (ex.code == 'ENOENT') rc = {};
		else throw ex;
	}

	return rc;
}

function save(cfg) {
	var file = path.join(os.homedir(), '.sleuthrc');
	cfg = JSON.stringify(cfg, null, '\t');
	fs.writeFileSync(file, cfg, {
		mode: 0o600
	});

	try {
		if (process.getuid && process.getuid() == 0) {
			var uid = parseInt(process.env.PKEXEC_UID || process.env.SUDO_UID, 10),
				gid = parseInt(process.env.PKEXEC_GID || process.env.SUDO_GID, 10);
			fs.chownSync(file, uid, gid);
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
