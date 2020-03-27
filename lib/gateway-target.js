var url = require('url'),
	util = require('util'),
	crypto = require('crypto'),
	os = require('os'),
	request = require('request'),
	WebSocket = require('ws'),
	Target = require('./target'),
	RemoteTarget = require('./remote-target'),
	GatewayError = require('./gateway-error');

var thisHid = getHid();

// targets hosted on a gateway server (connects out to gateway)
function GatewayTarget(inspector, opts) {
	var self = this;
	RemoteTarget.call(this, inspector, opts);
	this.hosted = true;

	self.gateway = opts.gateway || gatewayFromHost(self.host.host);
	if (opts.token) {
		self.token = opts.token;
	} else {
		if (self.opts.gateways && self.opts.gateways[self.gateway]) {
			self.token = self.opts.gateways[self.gateway].token;
		}
	}
}
util.inherits(GatewayTarget, RemoteTarget);

GatewayTarget.prototype.init = function(cb) {
	var self = this;
	if (self.state == Target.SERVICE_STATE.CLOSED) return;

	self.state = Target.SERVICE_STATE.PREFLIGHT;

	request({
		method: 'POST',
		url: 'https://' + self.gateway + '/host',
		headers: {
			Authorization: 'Bearer ' + self.token,
			'User-Agent': self.ua,
			Host: self.gateway
		},
		json: {
			host: self.host && self.host.host,
			region: self.opts.region,
			temp: self.opts.temp,
			serviceOpts: self.opts.serviceOpts
		}
	}, function(err, res, body) {
		if (err) {
			var e = new Error('Unable to connect to gateway service: ' + err.message);
			e.inner = err;
			return retry(e);
		}
		if (res.statusCode != 200 && res.statusCode != 201) {
			var e = new GatewayError(res.statusCode, body);
			if (res.statusCode >= 500) retry(e);
			else self.emit('error', e);
			if (cb) cb(e);
			return;
		}

		self.host = url.parse('https://' + body.host);

		self.gatewayUrl = 'wss://' + body.host + '/.well-known/netsleuth';

		self.emit('hostname', body.host);

		self.connect();
		if (cb) cb(null, body);

	});

	function retry(err) {
		self.emit('temp-error', err);
		self._connto = setTimeout(function() {
			self.init(cb);
		}, 5000);
	}
};

GatewayTarget.prototype.connect = function() {
	var self = this;
	self.state = Target.SERVICE_STATE.CONNECTING;
	var ws = self.ws = new WebSocket(self.gatewayUrl, [], {
		headers: {
			Authorization: 'Bearer ' + self.token,
			'User-Agent': self.ua
		}
	});

	ws.on('open', function() {
		self.state = Target.SERVICE_STATE.OPEN;
		self.emit('connected', 'Connected to gateway.');
		self.send({
			m: 'cfg',
			opts: self.opts.serviceOpts,
			hid: thisHid
		});
		if (self.ready) self.send({ m: 'ready' });
	});

	ws.on('message', function(data) {
		self.handleMsg(data);
	});


	ws.on('error', function(err) {
		if (self.state < Target.SERVICE_STATE.DISCONNECTED) {
			self.emit('temp-error', err, 'Gateway connection error.');
		}
	});

	ws.on('unexpected-response', function(req, res) {
		if (res.statusCode == 301 || res.statusCode == 302 || res.statusCode == 303 || res.statusCode == 307 || res.statusCode == 308) {
			self.state = Target.SERVICE_STATE.REDIRECTING;
			ws.terminate();
			if (self.gatewayUrl == res.headers.location) {
				self.state = Target.SERVICE_STATE.ERROR;
				return self.emit('error', new Error('Redirect loop'));
			}
			self.gatewayUrl = res.headers.location;
			return self.connect();
		}

		self.state = Target.SERVICE_STATE.ERROR;
		var err = self.serviceError = new GatewayError(res.statusCode, 'Unable to connect to gateway: ' + res.statusCode + ' ' + res.statusMessage);
		err.status = res.statusCode;
		err.statusMessage = res.statusMessage;

		if (res.headers['content-type'] != 'text/plain' || res.headers['content-length'] > 4096) ignoreResBody();
		else {
			var body = Buffer.alloc(0);

			res.on('data', function(d) {
				body = Buffer.concat([body, d]);
				if (body.length > 4096) ignoreResBody();
			});
			
			res.on('end', function() {
				err.message = body.toString();
				self.emit('error', err);
				ws.terminate();
			});

			res.on('error', ignoreResBody);
		}

		function ignoreResBody() {
			req.abort();
			self.emit('error', err);
			ws.terminate();
		}
	});

	ws.on('close', function(code, reason) {
		clearInterval(self._pinger);
		clearTimeout(self._pingto);
		if (self.state == Target.SERVICE_STATE.OPEN) {
			self.emit('closed', 'Connection to gateway closed.', code, reason);
		}

		if (self.state < Target.SERVICE_STATE.ERROR) {
			self.state = Target.SERVICE_STATE.DISCONNECTED;
			self._connto = setTimeout(function() {
				self.connect();
			}, 5000);
		}
	});

	ws.on('pong', function() {
		clearTimeout(self._pingto);
	});
};

GatewayTarget.prototype.close = function() {
	Target.prototype.close.call(this);
	this.state = Target.SERVICE_STATE.CLOSED;
	if (this.ws) this.ws.close();
};

GatewayTarget.prototype.reconnect = function() {
	this.close();
	this.connect();
}



function getHid() {
	var hash = crypto.createHash('sha256');
	hash.update(JSON.stringify({
		user: os.userInfo(),
		net: os.networkInterfaces()
	}));
	return hash.digest('base64');
}
function gatewayFromHost(host) {
	host = host.split('.');
	host.splice(0, 1);
	return host.join('.');
}


exports = module.exports = GatewayTarget;
