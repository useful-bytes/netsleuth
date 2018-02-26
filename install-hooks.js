var getStackFrames = require('./get-stack-frames'),
	Module = require('module'),
	loader = Module._load;

var hooked;

module.exports = exports = function installHooks() {
	if (hooked) return;
	hooked = true;

	Module._load = function(request, parent) {
		var mod = loader.call(this, request, parent);
		if (request == 'request') return hookedRequest(mod);
		return mod;
	};


	function hookedRequest(realRequest) {
		function request() {
			var req = realRequest.apply(this, arguments),
				stack = getStackFrames(__filename);

			req.once('request', function(req) {
				req.__init = stack;
			});
			return req;
		}

		['get','head','options','post','put','patch','del','delete'].forEach(function(method) {
			request[method] = function() {
				var req = realRequest[method].apply(realRequest, arguments),
					stack = getStackFrames(__filename);

				req.once('request', function(req) {
					req.__init = stack;
				});

				return req;
			}
		});

		// copy the rest of the stuff
		for (var k in realRequest) {
			if (!request[k]) request[k] = realRequest[k];
		}

		return request;
	}
}
