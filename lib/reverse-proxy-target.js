var util = require('util'),
	os = require('os'),
	loopbackIp = require('./loopback-ip'),
	Target = require('./target'),
	GatewayServer = require('../gateway');

var ipish = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])))$/;


// proxy targets hosted in this (the daemon) process
function ReverseProxyTarget(inspector, opts) {
	var self = this;
	Target.call(this, inspector, opts);
	this.state = Target.SERVICE_STATE.OPEN;

	if (opts.gateway) {
		this.gateway = opts.gateway;
	}

	if (typeof opts == 'string') opts = { target: opts };

	if (!opts || !opts.target) throw new Error('Must specify target host for inspection');

}
util.inherits(ReverseProxyTarget, Target);

ReverseProxyTarget.prototype.send = function(msg) {
	if (this.msg) this.msg.emit('inspector-message', msg);
};

ReverseProxyTarget.prototype.sendBin = function(type, id, chunk, cb) {
	if (this.msg) this.msg.emit('inspector-data', type, id, chunk, cb);
};

ReverseProxyTarget.prototype.init = function(cb) {
	var self = this,
		opts = this.opts,
		cert,
		sans = [],
		gateway;

	if (this.gateway) {
		
		gateway = this.gateway;
		up();

	} else {

		if (opts.host) {
			var p = opts.host.indexOf(':');
			if (p >= 0) {

				opts.port = parseInt(opts.host.substr(p+1), 10) || 80;
				if (opts.port != 80) opts.sport = opts.port + 1;

				opts.host = opts.host.substr(0, p);

				if (!opts.host || opts.host == '*') {
					opts.host = '*' + ':' + opts.port;
					sans.push('localhost');
				} else {
					sans.push(opts.host);
				}
			} else {
				if (opts.host != '*') sans.push(opts.host);
			}
			if (opts.host[0] == '*') opts.ip = null;
		}

		var ip = opts.ip;
		if (!ip && ipish.test(opts.host)) ip = opts.host;

		if (ip) {
			sans.push(ip);
		} else {
			var iface = os.networkInterfaces();
			for (var dev in iface) {
				iface[dev].forEach(function(addr) {
					sans.push(addr.address);
				});
			}
		}

		if (self.inspector.server.localCA) self.inspector.server.localCA.get({
			cn: os.hostname(),
			sans: sans
		}, function(err, issue) {
			cert = issue;
			prepare();
		});
		else prepare();
	}

	function sonerror(err) {
		self.inspector.console.error('Failed to listen for HTTPS connections', err);
	}

	function sonlistening() {
		gateway.https.removeListener('error', sonerror);
	}
	function slisten(ip) {
		gateway.https.once('error', sonerror);
		gateway.https.once('listening', sonlistening);
		gateway.https.listen(opts.sport || 443, ip);
	}

	function prepare() {
		gateway = this.gateway = new GatewayServer(opts.gatewayOpts || {
			noForwarded: true,
			https: cert
		});
		gateway._exclusive = true;


		if (ip || ip === null) {
			function onerror(err) {
				gateway.http.removeListener('listening', onlistening);
				console.error('ReverseProxyTarget listen error', err);
				self.emit('error', err);
				if (cb) cb(err);
			}
			function onlistening() {
				gateway.http.removeListener('error', onerror);
				up(ip);
			}

			gateway.http.once('error', onerror);
			gateway.http.once('listening', onlistening);

			gateway.http.listen(opts.port || 80, ip);

			if (cert) slisten(ip);
		} else {
			tryListen();
		}
	}

	function tryListen() {
		try {
			var ip = loopbackIp.next();
		} catch (ex) {
			self.emit('error', ex);
			if (cb) cb(err);
			return;
		}
		console.log('trying', ip);

		function onerror(err) {
			gateway.http.removeListener('listening', onlistening);
			if (err.code == 'EADDRINUSE') tryListen();
			else {
				self.emit('error', err);
				if (cb) cb(err);
			}
		}
		function onlistening() {
			gateway.http.removeListener('error', onerror);
			if (cert) slisten(ip);
			up(ip);
		}

		gateway.http.once('error', onerror);
		gateway.http.once('listening', onlistening);

		gateway.http.listen(opts.port || 80, ip);
	}

	function up(ip) {

		var msg = self.msg = gateway.inspect(opts.host[0] == '*' ? '*' : opts.host, opts.serviceOpts);

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

		if (ip) self.emit('ip', ip);
		self.emit('hostname', opts.host || ip, ip);

		if (cb) cb(null, opts.host || ip);

	}
};
ReverseProxyTarget.prototype.connect = function() {
	// noop
};

ReverseProxyTarget.prototype.close = function() {
	Target.prototype.close.call(this);
	if (this.gateway && this.gateway._exclusive) {
		this.gateway.close();
		this.gateway = null;
	}
	this.msg && this.msg.emit('close');
};

ReverseProxyTarget.prototype.reconnect = function() {
	// noop
};

exports = module.exports = ReverseProxyTarget;
