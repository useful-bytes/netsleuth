var Yargs = require('yargs/yargs');


exports = module.exports = function SessionCLI(inspector) {

	var parser = Yargs()
	.command('versions', 'Show version info', function(yargs) {
		
	}, function(argv) {
		var r = 'netseuth: ' + require('./package.json').version
		for (var k in process.versions) {
			r += '\n' + k + ': ' + process.versions[k];
		}
		argv.setResult(r);
	})
	.help();

	parser.$0 = '';

	this.parse = function(str, cb) {
		var result;

		if (str == 'help') {
			parser.parse('', function() {
				cb(null, 'success', parser.getUsageInstance().help());
				
			});
		}
		else parser.parse(str, {
			setResult: function(str) {
				result = str;
			}
		}, function(err, argv, output) {
			if (!result) result = output;
			if (result) cb(null, 'success', result);
			else cb(null, 'error', 'Unknown command.  Type “help” for a list of available commands.');
		});
	};

};