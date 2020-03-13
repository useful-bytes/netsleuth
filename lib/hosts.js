var Hosts = require('hosts-so-easy').default,
	sudoPrompt = require('sudo-prompt');

exports.add = function(ip, name, cb) {
	go('add', ip, name, cb);
};

exports.remove = function(ip, name, cb) {
	go('remove', ip, name, cb);
};

function go(op, ip, name, cb) {

	var hosts = new Hosts({
		atomicWrites: false, // causes failures on Windows
		noWrites: true,
		header: 'netsleuth hosts'
	});

	hosts[op](ip, name);

	hosts._update(function(err) {
		if (err) {
			if (require.main !== module) {
				sudoPrompt.exec('node ' + __filename + ' ' + op + ' ' + ip + ' ' + name, { name: 'netsleuth HOSTS file modifier' }, function(err, stdout, stderr) {
					if (err) cb(err);
					else if (stderr) cb(new Error(stderr));
					else cb();
				});
			} else {
				cb(err);
			}
		}
		else cb();
	});
}

if (require.main === module) {
	exports[process.argv[2]](process.argv[3], process.argv[4], function(err) {
		if (err) {
			process.stderr.write(err.message);
			process.exit(1);
		} else {
			process.exit(0);
		}
	});
}