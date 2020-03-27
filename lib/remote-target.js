var util = require('util'),
	Target = require('./target');

// abstract class for target types that are not hosted in-process
function RemoteTarget(inspector, opts) {
	Target.call(this, inspector, opts);
	this.state = Target.SERVICE_STATE.UNINITIALIZED;
}
util.inherits(RemoteTarget, Target);

RemoteTarget.prototype.send = function(msg) {
	if (this.state == Target.SERVICE_STATE.OPEN) this.ws.send(JSON.stringify(msg));
};

RemoteTarget.prototype.sendBin = function(type, id, chunk) {
	var header = Buffer.allocUnsafe(5);
	header.writeUInt8(type, 0, true);
	header.writeUInt32LE(id, 1, true);
	if (this.state == Target.SERVICE_STATE.OPEN) this.ws.send(Buffer.concat([header, chunk], chunk.length + 5));
};

exports = module.exports = RemoteTarget;
