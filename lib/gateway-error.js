var util = require('util');

function GatewayError(status, message) {
	Error.call(this, message);
	this.status = status;
	delete this.message;
	this.message = message;
}
util.inherits(GatewayError, Error);

exports = module.exports = GatewayError;
