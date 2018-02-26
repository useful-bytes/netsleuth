
function RemoteConsole(inspector) {
	this.inspector = inspector;
}

RemoteConsole.prototype.info = function(msg, src, reqId) {
	this._send(msg, src || 'other', 'info', reqId);
};
RemoteConsole.prototype.warn = function(msg, src, reqId) {
	this._send(msg, src || 'other', 'warning', reqId);
};
RemoteConsole.prototype.error = function(msg, src, reqId) {
	this._send(msg, src || 'other', 'error', reqId);
};
RemoteConsole.prototype._send = function(msg, source, level, reqId) {
	this.inspector.broadcast({
		method: 'Log.entryAdded',
		params: { entry:
			{
				source: source,
				level: level,
				text: msg,
				networkRequestId: reqId,
				timestamp: Date.now() / 1000
			}
		}
	});
};

exports = module.exports = RemoteConsole;
