
exports = module.exports = function(done) {
	var c = 0, n = 0;
	
	function stepDone(cb) {
		if (cb) {
			++n;

			return function execCb() {
				try {
					cb.apply(this, arguments);
				} catch (ex) {
					return end(ex);
				}

				process.nextTick(function() {
					if (++c == n) end(null);
				});
			}
		} else {
			if (c == n) end(null);
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

	function end() {
		if (done) done.apply(this, arguments);
		done = null;
	}


	return stepDone;
};