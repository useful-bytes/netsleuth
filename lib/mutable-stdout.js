var Writable = require('stream').Writable;

var mutableStdout = new Writable({
	write: function(chunk, enc, cb) {
		if (!this.muted) process.stdout.write(chunk, enc);
		cb();
	}
});

exports = module.exports = mutableStdout;