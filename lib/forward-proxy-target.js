var util = require('util'),
	loopbackIp = require('./loopback-ip'),
	Target = require('./target'),
	GatewayServer = require('../gateway');

var ipish = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;


// proxy targets hosted in this (the daemon) process
function ForwardProxyTarget(inspector, opts) {
	var self = this;
	Target.call(this, inspector, opts);
	this.state = Target.SERVICE_STATE.OPEN;
	this.forwardProxy = true;

	if (opts.gateway) {
		this.gateway = opts.gateway;
	}

}
util.inherits(ForwardProxyTarget, Target);

ForwardProxyTarget.prototype.send = function(msg) {
	if (this.msg) this.msg.emit('inspector-message', msg);
};

ForwardProxyTarget.prototype.sendBin = function(type, id, chunk) {
	if (this.msg) this.msg.emit('inspector-data', type, id, chunk);
};

ForwardProxyTarget.prototype.init = function(cb) {
	var self = this,
		opts = this.opts,
		gateway;

	if (this.gateway) {
		gateway = this.gateway;
	} else {
		gateway = this.gateway = new GatewayServer(opts.gatewayOpts || {
			forwardProxy: true,
			noForwarded: true,
			localCA: self.inspector.server.localCA
		});
		gateway._exclusive = true;
	}

	var msg = self.msg = gateway.inspect('*', opts.serviceOpts);

	msg.on('gateway-message', function(msg) {
		self.handleMsg(msg, true);
	});

	msg.on('gateway-data', function(type, id, chunk) {
		self.handleBin(type, id, chunk);
	});

	msg.on('close', function() {
		self.msg = null;
		self.close();
		process.nextTick(function() {
			self.emit('destroy');
		});
	});

	if (cb) cb(null);

};
ForwardProxyTarget.prototype.connect = function() {
	// noop
};

ForwardProxyTarget.prototype.close = function() {
	Target.prototype.close.call(this);
	if (this.gateway && this.gateway._exclusive) {
		this.gateway.close();
		this.gateway = null;
	}
	this.msg && this.msg.emit('close');
};

ForwardProxyTarget.prototype.reconnect = function() {
	// noop
};

exports = module.exports = ForwardProxyTarget;
