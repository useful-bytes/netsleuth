var Yargs = require('yargs/yargs');

var rexEscape = /([\\^$.|?*+()\[\]{}])/g, wildcard = /\\\*/g;

exports = module.exports = function SessionCLI(inspector) {

	var parser = Yargs()
	.command('notify', 'Show notifications when requests are received', function(yargs) {
		yargs
		.usage('Usage: notify <command>\n\nManage request notifications.  When a request is received, its URL is matched against active patterns and a desktop notification is shown.')
		.demandCommand()
		.command('add', 'Add a new notification pattern', function(yargs) {
			yargs
			.usage('Usage: notify add [options] <pattern>\n\nAdds a new pattern.  When a request\'s path matches the pattern, a notification will be shown.')
			.demand(1, 1)
			.option('method', {
				alias: 'm', 
				describe: 'HTTP method',
				default: '*'
			})
			.option('regex', {
				alias: 'r',
				boolean: true,
				describe: '<pattern> is a regex'
			})
			.option('case-sensitive', {
				alias: 'A',
				boolean: true,
				describe: 'Pattern is case-sensitive'
			})
			
		}, function(argv) {
			try {
				var rex;
				if (argv.regex) {
					rex = new RegExp(argv._[2], argv.caseSensitive ? '' : 'i');
				} else {
					rex = new RegExp(argv._[2].replace(rexEscape, '\\$&').replace(wildcard, '.+'), argv.caseSensitive ? '' : 'i');
				}
				inspector.notify.push({
					method: argv.method.toUpperCase(),
					rex: rex
				});
				argv.setResult('Added');
			} catch (ex) {
				argv.setResult('Unable to add pattern: ' + ex.message);
			}
		})
		.command('ls', 'List active notification patterns', function(yargs) {
			yargs
			.usage('Usage: notify ls\n\nShows all patterns.')	
		}, function(argv) {
			var r = '';
			for (var i = 0; i < inspector.notify.length; i++) {
				r += '[' + (i+1) + '] ' + inspector.notify[i].method + ' ' + inspector.notify[i].rex.toString() + '\n';
			}
			r += inspector.notify.length + ' patterns';
			argv.setResult(r);
		})
		.command('rm', 'Remove a notification pattern', function(yargs) {
			yargs
			.usage('Usage: notify rm <id>\n\nRemoves a pattern by id (as seen in notify ls), or * to remove all patterns.')
			.demand(1)
		}, function(argv) {
			if (argv._[2] == '*') {
				inspector.notify = [];
				argv.setResult('Removed all patterns');
			} else {
				var id = parseInt(argv._[2], 10);
				if (!id) return argv.setResult('id must be a number.');
				if (id > inspector.notify.length) return argv.setResult('Invalid id.');

				var rmed = inspector.notify.splice(id-1, 1);

				argv.setResult('Removed ' + rmed[0].method + ' ' + rmed[0].rex.toString());
			}
		})
	})
	.command('reconnect', 'Reconnect to gateway', function(yargs) {
		
	}, function(argv) {
		argv.setResult('Reconnecting...');
		inspector.reconnect();
	})
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

	this.parse = function(msg, reply) {
		var result;

		// when typing:
		// msg.params.silent when typing
		// msg.params.objectGroup == 'completion'
		// msg.params.expression == 'this'

		if (msg.params.silent) {
			// autocomplete
			reply({
				result: {
					type: 'object',
					subtype: 'error', // null = gray, regexp = brown, date/error = black
					value: 'result',
					description: ''
				}
			});
		} else {
			var str = msg.params.expression;
			if (str == 'help') {
				parser.parse('', function() {
					done('success', parser.getUsageInstance().help() + '\nType “<command> --help” for more information about a particular command.');
				});
			}
			else parser.parse(str, {
				setResult: function(str) {
					result = str;
				}
			}, function(err, argv, output) {
				if (!result) result = output;
				if (result) done('success', result);
				else done('error', 'Unknown command.  Type “help” for a list of available commands.');
			});
		}

		function done(type, res) {
			reply({
				result: {
					type: 'object',
					subtype: type == 'error' ? 'regexp' : 'date',
					description: res
				}
			});
		}

	};

};