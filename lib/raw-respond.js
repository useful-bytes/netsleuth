
function rawRespond(socket, code, status, message, extraHeaders) {
	if (socket) {
		var msg = Buffer.from(message);
		if (extraHeaders) {
			var r = '';
			for (var k in extraHeaders) {
				r += k + ': ' + extraHeaders[k] + '\r\n';
			}
			extraHeaders = r;
		} else extraHeaders = '';
		socket.on('error', ignore);
		socket.write('HTTP/1.1 ' + code + ' ' + status + '\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ' + msg.length + '\r\n' + extraHeaders + '\r\n');
		socket.end(msg);
	}
}

function ignore(err) {
	// noop
}

exports = module.exports = rawRespond;
