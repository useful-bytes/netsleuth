var util = require('util'),
	Target = require('./target'),
	RemoteTarget = require('./remote-target');

// node targets that run on this machine (InspectionServer accepts incoming tcp/unix socket connections)
// note: "inproc" here refers to the type of target, not the method of communication
function InprocTarget(inspector, opts) {
	var self = this;
	RemoteTarget.call(this, inspector, opts);
	var ws = this.ws = opts.client;
	this.state = Target.SERVICE_STATE.OPEN;
	this.pid = opts.req.headers.pid;

	ws.on('close', function() {
		this.state = Target.SERVICE_STATE.CLOSED;
		self.emit('destroy');
	});

	ws.on('error', function(err) {
		console.error('inproc insp err', err);
	});

	ws.on('message', function(data) {
		self.handleMsg(data);
	});

	this.sendConfig();
}
util.inherits(InprocTarget, RemoteTarget);

InprocTarget.prototype.init = function(cb) {
	this.send({ m: 'ready' });
	if (cb) cb();
};

InprocTarget.prototype.connect = function() {
	// noop
};

InprocTarget.prototype.close = function() {
	Target.prototype.close.call(this);
	this.ws.close();
};

InprocTarget.prototype.reconnect = function() {
	// noop
};

exports = module.exports = InprocTarget;
