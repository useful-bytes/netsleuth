
function joinRaw(headers) {
	var out = '';
	for (var i = 0; i < headers.length; i+=2) {
		out += headers[i] + ': ' + headers[i+1] + '\r\n'
	}
	return out;
}

exports = module.exports = joinRaw;