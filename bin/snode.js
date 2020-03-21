#!/usr/bin/env node

var argv = require('yargs')
	.option('sleuth-server', {
		describe: 'URL of the inspection server',
		default: 'ws://127.0.0.1:9000'
	})
	.option('sleuth-name', {
		describe: 'Name of this process',
		default: 'snode.<pid>'
	})
	.argv;

var opts = {
	initProject: false
};
opts.server = argv.sleuthServer;

// if server is explictly specifed, inproc inspector skips automatic daemon startup
if (opts.server == 'ws://127.0.0.1:9000') delete opts.server;
if (argv.sleuthName != 'snode.<pid>') opts.name = argv.sleuthName;

var inproc = require('../inproc');

inproc.attach(opts, function() {	

	if (argv._[0]) {
		require(argv._[0]);
	} else {
		var repl = require('repl').start();
		repl.on('exit', function() {
			process.exit(0);
		});
	}
});

