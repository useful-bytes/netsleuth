
function RemoteConsole(inspector) {
	this.inspector = inspector;
	this._source = 'other';
	this._stack = undefined;
	this._reqId = undefined;
}

RemoteConsole.prototype.source = function(src, reqId) {
	this._source = src;
	this._reqId = reqId;
	return this;
};
RemoteConsole.prototype.stack = function(stack) {
	this._stack = stack;
	return this;
};

RemoteConsole.prototype.debug = function() {
	this._send(arguments, 'verbose');
};
RemoteConsole.prototype.info = function() {
	this._send(arguments, 'info');
};
RemoteConsole.prototype.log = function() {
	this._send(arguments, 'info');
};
RemoteConsole.prototype.warn = function() {
	this._send(arguments, 'warning');
};
RemoteConsole.prototype.error = function() {
	this._send(arguments, 'error');
};
RemoteConsole.prototype._send = function(args, level) {
	args = Array.prototype.slice.call(args);

	var text = '';
	if (typeof args[0] == 'string') {
		text = args[0];
		args.splice(0, 1);
	}

	args = args.map(function(arg) {

		var robj = {
			type: typeof arg,
			value: arg
		};

		if (robj.type == 'object') {
			delete robj.value;
			robj.description = 'Object';
			robj.objectId = '0';

			if (arg === null) robj.subtype = 'null';
			else if (Array.isArray(arg)) robj.subtype = 'array';
			else if (arg instanceof Date) {
				robj.subtype = 'date';
				robj.description = arg.toString();
			}
			else if (arg instanceof Error) {
				robj.subtype = 'error';
				robj.description = arg.stack;
			}
			else if (arg instanceof Promise) robj.subtype = 'promise';

			robj.className = arg.constructor.name;

			robj.preview = {
				type: 'object',
				description: 'Object',
				subtype: robj.subtype,
				overflow: false,
				properties: Object.getOwnPropertyNames(arg).map(function(prop) {
					return {
						name: prop,
						type: typeof arg[prop],
						value: '' + arg[prop]
					}
				})
			}
		}

		return robj;
	});

	this.inspector.broadcast({
		method: 'Log.entryAdded',
		params: { entry:
			{
				source: this._source,
				level: level,
				text: text,
				args: args,
				networkRequestId: this._reqId,
				stackTrace: this._stack && { callFrames: this._stack },
				timestamp: Date.now() / 1000
			}
		}
	});

	this._source = 'other';
	this._stack = undefined;
	this._reqId = undefined;
};

exports = module.exports = RemoteConsole;
