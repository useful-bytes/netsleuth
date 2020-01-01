var Jsondiffpatch = require('jsondiffpatch'),
	c = require('ansi-colors'),
	DMP = require('diff-match-patch'),
	jdp = Jsondiffpatch.create({
		textDiff: {
			//minLength: 1
		}
	});

exports.diff = function(a, b) {
	var delta = jdp.diff(a, b);
	Jsondiffpatch.console.log(delta, a);
};

exports.string = function(a, b) {
	var dmp = new DMP();
	var diff = dmp.diff_main(a, b);
	dmp.diff_cleanupSemantic(diff);
	return diff.map(function(d) {
		if (d[0] == 0) return d[1];
		if (d[0] == 1) return c.green(d[1]);
		if (d[0] == -1) return c.strikethrough.red(d[1]);
	}).join('');
};