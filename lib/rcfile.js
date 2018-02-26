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
	cfg = JSON.stringify(cfg, null, '\t');
	fs.writeFileSync(path.join(os.homedir(), '.sleuthrc'), cfg);
}

function update(cfg) {
	cfg = Object.assign(get(), cfg);
	save(cfg);
}

exports.get = get;
exports.save = save;
exports.update = update;
