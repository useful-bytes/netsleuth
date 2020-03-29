
exports = module.exports = function(done) {
	var c = 0, n = 0;
	
	function stepDone(cb) {
		++n;

		return function execCb() {
			try {
				if (cb) cb.apply(this, arguments);
			} catch (ex) {
				return end(ex);
			}

			process.nextTick(function() {
				if (++c == n) end(null);
			});
		}
	}

	stepDone.fail = end;

	stepDone.exec = function(cb) {
		try {
			cb();
		} catch(ex) {
			end(ex);
		}
	}

	stepDone.end = function() {
		if (c == n) end(null);
	}

	function end() {
		if (done) done.apply(this, arguments);
		done = null;
	}


	return stepDone;
};