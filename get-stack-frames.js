function getStackFrames(ignoreFile) {
	var handler = Error.prepareStackTrace,
		dummy = {};
	Error.prepareStackTrace = function(o, trace) {
		return trace;
	};
	Error.captureStackTrace(dummy);

	var stack = dummy.stack;
	Error.prepareStackTrace = handler;

	var frames = [];

	for (var i = 0; i < stack.length; i++) {
		var file = stack[i].getFileName();
		if (file != __filename && file != ignoreFile) {
			frames.push({
				url: file,
				lineNumber: stack[i].getLineNumber() - 1, // ignore the node wrapper line
				columnNumber: stack[i].getColumnNumber(),
				functionName: stack[i].getFunctionName()
			});
		}
	}

	frames.push({
		functionName: '(' + process.argv0 + '.' + process.pid + ')'
	});

	return frames;

}

exports = module.exports = getStackFrames;