
var availLocal = ipToLong('127.0.0.1'),
	LOCAL_MAX = ipToLong('127.255.255.255');

exports.next = function() {
	var ip = ++availLocal;
	if ((ip & 255) == 255 || (ip & 255) == 0) return exports.next();
	if (ip > LOCAL_MAX) throw new Error('No available loopback IP');
	return ipFromLong(ip);
};

function ipToLong(ip) {
	var ipl = 0;
	ip.split('.').forEach(function(octet) {
	 	ipl <<= 8;
		ipl += parseInt(octet);
	});
	return(ipl >>> 0);
}

function ipFromLong(ipl) {
	return ((ipl >>> 24) + '.' +
		(ipl >> 16 & 255) + '.' +
		(ipl >> 8 & 255) + '.' +
		(ipl & 255) );
}
