var fs = require('fs');

try {
	var worker_threads = require('worker_threads');
} catch (ex) {}

function Script(inspector, opts) {
	var self = this;
	self.inspector = inspector;
	self.dirs = opts.dirs;
	self.watches = [];
	self.reqs = {};
	self.ress = {};
	self.loads = 0;

	var dc = 0;
	if (worker_threads && self.dirs) self.dirs.forEach(function(dir) {
		fs.mkdir(dir, { mode: 0o755, recursive: true }, function(err) {
			if (err && err.code != 'EEXIST') {
				console.error(err);
			} else {
				self.watches.push(fs.watch(dir, function(type, file) {
					clearTimeout(self._reload);
					self._reload = setTimeout(function() {
						self.loadScripts();
					}, 50);
				}));
			}

			if (++dc == self.dirs.length) self.loadScripts();
		});
	});

}


Script.prototype.loadScripts = function() {
	var self = this;

	if (self.worker) self.worker.terminate();

	if (!self.dirs || !self.dirs.length) return;

	var worker = self.worker = new worker_threads.Worker(__dirname + '/script-run.js', {
		workerData: {
			name: self.inspector.name,
			dirs: self.dirs,
			iid: self.loads++
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

			case 'rerr':
				if (self.reqs[msg.id]) {
					if (msg.stop) self.reqs[msg.id].cb.call(null, msg.err);
					else self.reqs[msg.id].cb.call(null, null, {});
					delete self.reqs[msg.id];
				}
				self.inspector.console.source('network', msg.id).error('Interception script request handler threw exception.', msg.stop ? 'Request will be terminated.' : 'Request will be passed unmodified.', '\n', msg.err);
				break;

			case 'pok':
				if (self.ress[msg.id]) {
					// if (msg.res && msg.res.body) msg.res.body = Buffer.from(msg.res.body);
					self.ress[msg.id].cb.call(null, null, msg);
					delete self.ress[msg.id];
				}
				break;

			case 'perr':
				if (self.ress[msg.id]) {
					if (msg.stop) self.ress[msg.id].cb.call(null, msg.err);
					else self.ress[msg.id].cb.call(null, null, {});
					delete self.ress[msg.id];
				}
				self.inspector.console.source('network', msg.id).error('Interception script response handler threw exception.', msg.stop ? 'Response will be terminated.' : 'Response will be passed unmodified.', '\n', msg.err);
				break;

			case 'console':
				self.inspector.console.stack(msg.stack)[msg.t].apply(self.inspector.console, msg.args);
				break;

		}
	});

	worker.on('error', function(err) {
		console.error(err);
		self.inspector.console.error('Interception script threw an unhandled exception.\n' + err.stack);
	});

	worker.on('exit', function() {
		for (var id in self.reqs) self.reqs[id].cb.call(null, new Error('Interception script thread terminated unexpectedly.'));
		for (var id in self.ress) self.ress[id].cb.call(null, new Error('Interception script thread terminated unexpectedly.'));
		self.reqs = {};
		self.ress = {};
		if (self.worker == worker) self.worker = null;
	});
};

var txnOmit = {
	target: true,
	reqBody: true,
	resBody: true,
	req: true,
	res: true
};

Script.prototype.request = function(txn, cb) {
	var self = this;

	if (self.worker && self.scripts) {
		var obj = {};
		for (var k in txn) if (!txnOmit[k] && typeof txn[k] != 'function') obj[k] = txn[k];

		self.reqs[txn.id] = { cb: cb };

		self.worker.postMessage({
			m: 'r',
			txn: obj
		});
	} else cb(null, {});
};

Script.prototype.response = function(txn, cb) {
	var self = this;

	if (self.worker && self.scripts) {
		var obj = {};
		for (var k in txn) if (!txnOmit[k] && typeof txn[k] != 'function') obj[k] = txn[k];

		self.ress[txn.id] = { cb: cb };

		self.worker.postMessage({
			m: 'p',
			txn: obj
		});
	} else cb(null, {});
};

Script.prototype.done = function(txn) {
	var self = this;
	delete self.reqs[txn.id];
	delete self.ress[txn.id];
	if (self.worker) self.worker.postMessage({
		m: 'f',
		id: txn.id
	});
}

Script.prototype.close = function() {
	clearTimeout(self._reload);
	if (this.worker) {
		this.worker.terminate();
		this.worker = null;
	}
	if (this.watches) {
		this.watches.forEach(function(watch) {
			watch.close();
		});
		this.watches = null;
	}
};

exports = module.exports = Script;