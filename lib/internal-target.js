var util = require('util'),
	Target = require('./target'),
	inproc = require('../inproc');

var ipish = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;


// proxy targets hosted in this (the daemon) process
function InternalTarget(inspector, opts) {
	var self = this;
	Target.call(this, inspector, opts);
	this.state = Target.SERVICE_STATE.OPEN;
	this.pid = process.argv0 + '.' + process.pid;
	this.reqsShowTargetTLSState = true;

	this.ClientRequest = inproc.patch(function(msg) {
		self.handleMsg(msg, true);
	}, function(type, id, chunk) {
		self.handleBin(type, self.pid + ':' + id, chunk);
	});

}
util.inherits(InternalTarget, Target);

InternalTarget.prototype.send = function(msg) {
	if (this.msg) this.msg.emit('inspector-message', msg);
};

InternalTarget.prototype.sendBin = function(type, id, chunk, cb) {
	if (this.msg) this.msg.emit('inspector-data', type, id, chunk, cb);
};

InternalTarget.prototype.init = function(cb) {
	
	if (cb) cb(null);

};
InternalTarget.prototype.connect = function() {
	// noop
};

InternalTarget.prototype.close = function() {
	// noop
};

InternalTarget.prototype.reconnect = function() {
	// noop
};

exports = module.exports = InternalTarget;
