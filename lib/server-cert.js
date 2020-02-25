var tls = require('tls'),
	url = require('url');

exports.get = function(uri, cb) {
	uri = url.parse(uri);
	var opts = {
		host: uri.hostname,
		port: parseInt(uri.port, 10) || 443,
		rejectUnauthorized: false,
		servername: uri.hostname
	};

	var socket = tls.connect(opts, function() {
		var cert = socket.getPeerCertificate();
		delete cert.pubkey;
		cert.raw = pemEncode(cert.raw.toString('base64'), 64);
		cert.valid = socket.authorized;
		cb(null, cert);
		socket.end();
	});

	socket.on('error', cb);
};

function pemEncode(str, n) {
  var ret = [];

  for (var i = 1; i <= str.length; i++) {
    ret.push(str[i - 1]);
    var mod = i % n;

    if (mod === 0) {
      ret.push('\n');
    }
  }

  return '-----BEGIN CERTIFICATE-----\n' + ret.join('') + '\n-----END CERTIFICATE-----';
}