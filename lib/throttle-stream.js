var stream = require('stream'),
	util = require('util');


function ThrottleStream(options) {
	options = options || {};
	stream.Transform.call(this, options);

	options.bps = options.bps || Infinity;
	options.pps = Math.min(options.pps || 10, options.bps);

	this.period = Math.round(1000 / options.pps);
	this.bpp = Math.ceil(options.bps / options.pps);

	this.budget = this.bpp;
}
util.inherits(ThrottleStream, stream.Transform);

ThrottleStream.prototype._transform = function(chunk, enc, cb) {
	var self = this,
		from = 0;

	release();

	function release() {
		var end = from + self.budget,
			out = chunk.slice(from, end);

		from += out.length;
		self.budget -= out.length;
		self.push(out);

		if (end < chunk.length) {
			setTimeout(function() {
				self.budget = self.bpp;
				release();
			}, self.period);
		} else cb();
	}

};


exports = module.exports = ThrottleStream;
