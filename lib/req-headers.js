var http = require('http');

// As of node 12, OutgoingMessage#_headers is a runtime deprecation, resulting in console warnings.
// Unfortunately, the documented APIs do not provide a way to get the *actual* headers, only the normalized version.
// For display purposes, we need to get the real headers sent over the wire.
// For compatibility, use req._headers on node < 12.
// On node >= 12, we have to do the following ugly hack since the only place real header names exist is a property hidden behind a Symbol

if (process.versions.node.substr(0, process.versions.node.indexOf('.')) >= 12) {
	var msg = new http.OutgoingMessage(),
		syms = Object.getOwnPropertySymbols(msg),
		kOutHeaders;

	for (var i = 0; i < syms.length; i++) {
		if (syms[i].description == 'kOutHeaders') {
			kOutHeaders = syms[i];
			break;
		}
	}
}

exports.get = function getReqHeaders(req) {
	var r = {
		values: {},
		names: {}
	};

	if (kOutHeaders) {
		for (var k in req[kOutHeaders]) {
			var h = req[kOutHeaders][k][0],
				v = req[kOutHeaders][k][1];

			r.values[h.toLowerCase()] = v;
			r.names[h.toLowerCase()] = h;
		}
	} else {
		r.values = req._headers;
		r.names = req._headerNames;
	}
	return r;
};
