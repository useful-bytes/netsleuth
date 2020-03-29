var os = require('os'),
	crypto = require('crypto'),
	forge = require('node-forge');

var ipish = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function CertificateAuthority(ca) {
	this.cert = forge.pki.certificateFromPem(ca.cert);
	this.certId = this.cert.generateSubjectKeyIdentifier().getBytes();
	if (ca.key) this.key = forge.pki.privateKeyFromPem(ca.key);
	this.certs = {};
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

		cert.setExtensions([{
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
		}, {
			name: 'subjectAltName',
			altNames: [ipish.test(opts.cn) ? { type: 7, ip: opts.cn } : { type: 2, value: opts.cn }]
		}]);


		cert.setSubject(attrs);
		cert.setIssuer(self.cert.subject.attributes);

		cert.sign(self.key, forge.md.sha256.create());


		cb(null, self.certs[opts.cn] = {
			cert: forge.pki.certificateToPem(cert),
			key: forge.pki.privateKeyToPem(keys.privateKey)
		});

	});
};

CertificateAuthority.prototype.get = function(cn, cb) {
	if (this.certs[cn]) cb(null, this.certs[cn]);
	else this.issue(cn, cb);
}

CertificateAuthority.prototype.isInstalled = function(cb) {
	var self = this;
	if (process.platform == 'win32') {
		child_process.exec('certutil -verifystore root ' + ca.cert.serialNumber, function(err) {
			if (err) cb(null, false);
			else cb(null, true);
		});
	} else if (process.platform == 'darwin') {
		
	}
};

CertificateAuthority.prototype.sha1 = function() {
	return forge.md.sha1.create().update(forge.asn1.toDer(forge.pki.certificateToAsn1(this.cert)).getBytes()).digest().toHex();
}


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