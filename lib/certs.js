var os = require('os'),
	crypto = require('crypto'),
	forge = require('node-forge');

var ipish = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])))$/;

function CertificateAuthority(ca) {
	this.cert = forge.pki.certificateFromPem(ca.cert);
	this.certId = this.cert.generateSubjectKeyIdentifier().getBytes();
	if (ca.key) this.key = forge.pki.privateKeyFromPem(ca.key);
	this.certs = {};
}

function cacheKey(opts) {
	if (typeof opts == 'string') return opts;
	var key = opts.cn;
	if (opts.sans) opts.sans.forEach(function(san) {
		key += ',' + san;
	});
	return key;
}

CertificateAuthority.prototype.issue = function(opts, cb) {
	var self = this;
	if (typeof opts == 'string') opts = { cn: opts };
	forge.pki.rsa.generateKeyPair(2048, function(err, keys) {
		if (err) return cb(err);
		var cert = forge.pki.createCertificate();
		cert.publicKey = keys.publicKey;
		cert.validity.notBefore = new Date(Date.now() - 1000*60*10);
		cert.validity.notAfter = new Date(Date.now() + 1000*60*60*24*30*(opts.months || 1));

		cert.serialNumber = '05' + crypto.randomBytes(19).toString('hex');

		var attrs = [{
			name: 'commonName',
			value: opts.cn
		}];

		var sans, ext = [{
			name: 'basicConstraints',
			critical: true,
			cA: false
		}, {
			name: 'keyUsage',
			critical: true,
			digitalSignature: true
		}, {
			name: 'extKeyUsage',
			serverAuth: true
		}, {
			name: 'authorityKeyIdentifier',
			keyIdentifier: self.certId
		}, {
			name: 'subjectKeyIdentifier',
			keyIdentifier: cert.generateSubjectKeyIdentifier().getBytes()
		}, sans = {
			name: 'subjectAltName',
			altNames: [ipish.test(opts.cn) ? { type: 7, ip: opts.cn } : { type: 2, value: opts.cn }]
		}];

		if (opts.sans) opts.sans.forEach(function(san) {
			sans.altNames.push(ipish.test(san) ? { type: 7, ip: san } : { type: 2, value: san });
		});

		cert.setSubject(attrs);
		cert.setExtensions(ext);
		cert.setIssuer(self.cert.subject.attributes);

		cert.sign(self.key, forge.md.sha256.create());


		cb(null, self.certs[cacheKey(opts)] = {
			cert: forge.pki.certificateToPem(cert),
			key: forge.pki.privateKeyToPem(keys.privateKey)
		});

	});
};

CertificateAuthority.prototype.get = function(cn, cb) {
	var k = cacheKey(cn);
	if (this.certs[k]) cb(null, this.certs[k]);
	else this.issue(cn, cb);
}

CertificateAuthority.prototype.sha1 = function() {
	return forge.md.sha1.create().update(forge.asn1.toDer(forge.pki.certificateToAsn1(this.cert)).getBytes()).digest().toHex();
};

CertificateAuthority.prototype.pem = function() {
	return forge.pki.certificateToPem(this.cert);
};


CertificateAuthority.generate = function() {
	var keys = forge.pki.rsa.generateKeyPair(2048),
		cert = forge.pki.createCertificate();

	cert.publicKey = keys.publicKey;
	cert.serialNumber = '05' + crypto.randomBytes(19).toString('hex');
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date(Date.now() + 1000*60*60*24*365*20);

	var attrs = [{
		name: 'commonName',
		value: 'netsleuth CA for ' + os.userInfo().username + ' on ' + os.hostname()
	}];

	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	cert.setExtensions([{
		name: 'basicConstraints',
		critical: true,
		cA: true,
		pathLenConstraint: 0
	}, {
		name: 'keyUsage',
		critical: true,
		keyCertSign: true,
		cRLSign: true,
		digitalSignature: true,
		nonRepudiation: true,
		keyEncipherment: true,
		dataEncipherment: true
	}, {
		name: 'extKeyUsage',
		serverAuth: true,
		clientAuth: true,
		codeSigning: true,
		emailProtection: true,
		timeStamping: true
	}, {
		name: 'nsCertType',
		client: true,
		server: true,
		email: true,
		objsign: true,
		sslCA: true,
		emailCA: true,
		objCA: true
	}]);

	cert.sign(keys.privateKey, forge.md.sha256.create());

	return {
		cert: forge.pki.certificateToPem(cert),
		key: forge.pki.privateKeyToPem(keys.privateKey)
	};

};


exports = module.exports = CertificateAuthority;