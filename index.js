var GatewayServer = require('./gateway'),
	InspectionServer = require('./server'),
	inproc = require('./inproc');

exports = module.exports = {
	GatewayServer: GatewayServer,
	InspectionServer: InspectionServer,
	attach: inproc.attach,
	init: inproc.init
};
