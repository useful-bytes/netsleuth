var forge = require('node-forge');

exports = module.exports = function(file, pw) {
	var p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(file)), pw), 
		r = {
			cert: ''
		};

	var certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];

	certBags.forEach(function(bag) {
		r.cert += forge.pki.certificateToPem(bag.cert) + '\n';
	});

	var keyBag = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag][0];
	if (!keyBag) keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag][0];

	r.key = forge.pki.privateKeyToPem(keyBag.key);

	return r;
};
