

exports = module.exports = function(str) {
	str = str.toString();
	var n = parseFloat(str, 10);
	if (n) {
		var last = str.substr(-1).toLowerCase();
		if (last == 'k') n *= 1024;
		else if (last == 'm') n *= 1024*1024;
		else if (last == 'g') n *= 1024*1024*1024;
		n = Math.round(n);
	}
	return n;
};
