var fs = require('fs');

try {
	var worker_threads = require('worker_threads');
} catch (ex) {}

function Script(inspector, opts) {
	var self = this;
	self.inspector = inspector;
	self.dir = opts.dir;
	self.reqs = {};

	if (worker_threads) fs.mkdir(self.dir, { mode: 0o755, recursive: true }, function(err) {
		if (err && err.code != 'EEXIST') {
			console.error(err);
		} else {
			self.watch = fs.watch(self.dir, function(type, file) {
				clearTimeout(self._reload);
				self._reload = setTimeout(function() {
					self.loadScripts();
				}, 50);
			});

			self.loadScripts();
		}
	});
}


Script.prototype.loadScripts = function() {
	var self = this;

	if (self.worker) self.worker.terminate();

	var worker = self.worker = new worker_threads.Worker(__dirname + '/script-run.js', {
		workerData: {
			dir: self.dir
		}
	});

	worker.on('message', function(msg) {
		switch (msg.m) {
			case 'ready':
				self.scripts = msg.scripts;
				break;

			case 'rok':
				if (self.reqs[msg.id]) {
					if (msg.res && msg.res.body) msg.res.body = Buffer.from(msg.res.body);
					self.reqs[msg.id].cb.call(null, null, msg);
					delete self.reqs[msg.id];
				}
				break;

		}
	});
};

var txnOmit = {
	target: true,
	reqBody: true,
	resBody: true
};

Script.prototype.request = function(txn, cb) {
	var self = this;


	if (self.worker) {
		var obj = {};
		for (var k in txn) if (!txnOmit[k] && typeof txn[k] != 'function') obj[k] = txn[k];

		self.reqs[txn.id] = { cb: cb };

		self.worker.postMessage({
			m: 'r',
			txn: obj
		});
	} else cb();
};

Script.prototype.close = function() {
	clearTimeout(self._reload);
	if (this.worker) {
		this.worker.terminate();
		this.worker = null;
	}
	if (this.watch) {
		this.watch.close();
		this.watch = null;
	}
};

exports = module.exports = Script;