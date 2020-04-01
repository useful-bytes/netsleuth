var child_process = require('child_process'),
	fs = require('fs'),
	path = require('path'),
	opn = require('opn'),
	commandExists = require('command-exists');

exports = module.exports = function(file) {
	if (process.platform == 'win32') child_process.exec('explorer /select,"' + file + '"');
	else if (process.platform == 'darwin') child_process.exec('/usr/bin/osascript -e "tell application \\"Finder\\" to reveal POSIX file \\"' + file + '\\""', function(err, stdout, stderr) {
		if (!err) child_process.exec('/usr/bin/osascript -e "tell application \\"Finder\\" to activate"', function(err, stdout, stderr) {});
	});
	else {
		commandExists('nautilus', function(err, exists) {
			if (err || !exists) fs.stat(file, function(err, stat) {
				if (err) return;
				if (!stat.isDirectory()) {
					file = path.dirname(file);
					opn(file).catch(function(err) {
						
					});
				}
			});
			else child_process.exec('nautilus "' + file + '"');
		});
		
	}
}