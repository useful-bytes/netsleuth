var fs = require('fs'),
	path = require('path');

exports = module.exports = function(root, static) {

	// This makes express.static case-insensitive

	var dirs = {};

	return function(req, res, next) {
		var dir = path.dirname(req.path),
			filename = path.basename(req.path).toLowerCase();

		if (dirs[dir]) check(dirs[dir]);
		else if (dirs[dir] === false) next();
		else fs.readdir(path.join(root, dir), function(err, files) {
			if (err) {
				dirs[dir] = false;
				return next();
			}

			var fmap = {};
			for (var i = 0; i < files.length; i++) {
				fmap[files[i].toLowerCase()] = files[i];
			}

			dirs[dir] = fmap;
			check(fmap);
		});


		function check(fmap) {

			if (fmap[filename]) {
				req.url = dir + '/' + fmap[filename];
				return static(req, res, next);
			}

			next();
		}
	}
};