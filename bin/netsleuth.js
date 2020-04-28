#!/usr/bin/env node

var fs = require('fs'),
	path = require('path'),
	readline = require('readline'),
	os = require('os'),
	rcfile = require('../lib/rcfile'),
	Daemon = require('../lib/daemon'),
	gw = require('../lib/gateway-client');

var config = rcfile.get(),
	defaultGateway = config.defaultGateway || 'netsleuth.io',
	defaultTeam;

if (config.gateways && config.gateways[defaultGateway] && config.gateways[defaultGateway].teams) {
	var teams = config.gateways[defaultGateway].teams;
	for (var i = 0; i < teams.length; i++) {
		if (teams[i].admin) {
			defaultTeam = teams[i].slug;
			break;
		}
	}
}

var daemon = new Daemon(config);

function runDaemon(cb) {
	daemon.start(function(err) {
		if (err) {
			console.error('Unable to start inspection server.', err);
			process.exit(1);
		} else cb();
	});
}

function dres(cb) {
	return function(err, body) {
		if (err) {
			if (err.message) console.error(err.message);
			else console.error('Error communicating with inspection server.', err);
			process.exit(1);
		}
		else cb.apply(null, Array.prototype.slice.call(arguments, 1));
	};
}

function getServiceOpts(argv) {
	var opts = {
		store: argv.store
	};

	if (argv.auth) {
		var colon = argv.auth.indexOf(':'),
			user = argv.auth.substr(0, colon),
			pass = argv.auth.substr(colon+1);

		if (!user || !pass) {
			console.error('Invalid Basic auth.  Please provide “username:password”.');
			process.exit(1);
		}

		opts.auth = {
			user: user,
			pass: pass
		};
	}

	return opts;
}

var yargs = require('yargs')
	.usage('Usage: $0 <command>')

	.command('inspect <target> [hostname]', 'Add a new inspection target', function(yargs) {
		yargs
		.usage('Usage: $0 inspect [options] <target> [hostname]\n\nAdds a new inspection target to your local inspection server.\n<target>\n  Origin URL of the server requests will be forwarded to (ie, paths ignored).  The target can be any URL you can reach from your machine, and can be protocol-absolute to always use the same protocol to connect to the target (regardless of which protocol--HTTP or HTTPS--was used by the client to connect to the gateway), or protocol-relative if you want to use the same protocol that the client used for each request.\n[hostname]\n  Hostname to use for incoming requests.\n  In public mode: Can be a fully-qualified DNS name or a hostname that will be concatenated with the default gateway, ".' + defaultGateway + '".\n  In local mode: can be a hostname or IP address.  (Protip: the loopback subnet is a /8; use a different loopback IP for each target.)\n\nIf not specified, the hostname is autoassigned.')
		.example('$0 inspect http://localhost:3000 myapp.netsleuth.io\n$0 inspect --ca test.crt //staging.example.com staging.netsleuth.io\n$0 inspect --local https://example.com 127.0.0.2')
		.option('store', {
			alias: 's',
			boolean: true,
			describe: 'Enable the gateway\'s offline storage mode.  (See help for `netsleuth reserve`.)'
		})
		.option('local', {
			alias: 'l',
			boolean: true,
			describe: 'Add target in local gateway mode.  In this mode, requests are made to a proxy running on your machine and forwarded to the target.'
		})
		.option('add-host', {
			alias: 'h',
			boolean: true,
			describe: 'Add an entry to your HOSTS file for this hostname pointing to 127.0.0.1.  netsleuth will sudo for you.'
		})
		.option('ca', {
			alias: 'c',
			describe: 'Location of the CA or self-signed certificate to use when validating HTTPS certificates presented by the target.'
		})
		.option('insecure', {
			boolean: true,
			describe: 'Do not validate HTTPS certificates presented by the target.'
		})
		.option('gateway', {
			alias: 'g',
			describe: 'Use this gateway server (if it cannot be inferred from hostname)'
		})
		.option('region', {
			alias: 'r',
			describe: 'Use a gateway server hosted in this region.  Run `netsleuth regions` to see a list.',
			default: 'auto'
		})
		.option('auth', {
			alias: 'a',
			describe: 'Basic auth username:password that the gateway should require before forwarding requests'
		})
		.option('host-header', {
			alias: 'H',
			describe: 'Override the HTTP Host header sent to the target with this.'
		})
		.option('temp', {
			alias: 't',
			boolean: true,
			describe: 'Add temporarily -- do not save this target configuration to disk.'
		})

	}, function(argv) {
		if (argv.addHost && !argv.local) {
			yargs.showHelp();
			console.error('Hostname can only be added to your HOSTS file when adding a local mode target.');
			process.exit(1);
		}

		var hosts = config.hosts = config.hosts || {};

		if (argv.hostname && !argv.local && argv.hostname.indexOf('.') == -1) {
			argv.hostname = argv.hostname + '.' + defaultGateway;
		}

		var host = {
			target: argv.target
		};

		if (argv.insecure) host.insecure = true;

		if (argv.local) host.local = true;
		else {
			if (argv.gateway) host.gateway = argv.gateway;
			else host.gateway = argv.hostname ? gatewayFromHost(argv.hostname) : defaultGateway;
		}

		if (argv.region == 'auto') {
			host.region = config.gateways[host.gateway] && config.gateways[host.gateway].defaultRegion;
		} else host.region = argv.region;

		if (argv.ca) {
			if (!Array.isArray(argv.ca)) argv.ca = [argv.ca];
			host.ca = argv.ca.map(function(file) {
				file = path.resolve(process.cwd(), file);
				try {
					if (fs.readFileSync(file).indexOf('-----BEGIN CERTIFICATE-----') == -1) {
						// yes, this is a dirty hack.  ¯\_(ツ)_/¯
						console.error('Unable to process CA certificate ' + file + ': the file does not appear to be a certificate.  Certificates must be PEM-encoded.');
						process.exit(1);
					}
				} catch (ex) {
					console.error('Unable to read CA certificate ' + file + '.', ex.message);
					process.exit(1);
				}

				return file;
			});
		}

		if (argv.hostHeader) host.hostHeader = argv.hostHeader;
		if (argv.temp) host.temp = true;
		if (argv.addHost) host.hostsfile = true;

		host.serviceOpts = getServiceOpts(argv);

		daemon.add(Object.assign({ host: argv.hostname }, host), dres(function(body) {
			var proto = host.local ? 'http' : 'https';
			console.log('Inspecting ' + proto + '://' + body.host + ' \u27a1 ' + argv.target);
		}));

	})

	.command('ls', 'List inspection targets', function(yargs) {
		yargs
		.usage('Usage: $0 ls')
	}, function(argv) {
		var count = 0;
		for (var hostname in config.hosts) {
			console.log(hostname + ' \u27a1 ' + config.hosts[hostname].target);
			++count;
		}
		console.log(count + ' targets.');
	})
	.command('rm <target|hostname>...', 'Remove inspection target(s)', function(yargs) {
		yargs
		.usage('Usage: $0 rm [options] <target|hostname>...\n<target>\n  An Origin URL to remove as an inspection target\n<hostname>\n  A hostname to remove as an inspection target\n\nYou need only specify *either* the target or hostname of an inspection target.')
		.example('$0 rm a.netsleuth.io b.netsleuth.io')
		.option('keep-reservation', {
			alias: 'R',
			boolean: true,
			describe: 'Keeps your reservation of this hostname active on the public gateway'
		})
	}, function(argv) {

		// yargs stuffs the first arg after `rm` into arv.target
		var args = argv._.slice(1);
		args.unshift(argv.target);

		var toRemove = args.map(function(spec) {
			if (config.hosts[spec]) return spec;
			if (config.hosts[spec + '.' + defaultGateway]) return spec + '.' + defaultGateway;
			for (var hostname in config.hosts) {
				if (config.hosts[hostname].target == spec) return hostname;
			}

			console.error('Hostname or target "' + spec + '" not found.');
			process.exit(1);
		});

		daemon.rm({
			hosts: toRemove,
			keepReservation: argv.keepReservation
		}, dres(function() {
			console.log('Removed ' + toRemove.length + ' targets.');
		}));

	})
	.command('reservations', 'Lists your hostname reservations on the public gateway', function(yargs) {
		yargs
		.usage('Usage: $0 reservations')
		.epilog('Learn more about how the public gateway works: https://netsleuth.io/gateway')
	}, function(argv) {
		Object.keys(config.gateways).forEach(function(gateway) {
			gw.reservations(gateway, function(err, reservations) {
				if (err) {
					if (err.code) console.error('\n# ' + gateway + '\n' + err.code + ' ' + err.message + '\n' + err.body);
					else console.error('\n# ' + gateway + '\nUnable to connect to gateway.\n' + err.message);
				}
				else {
					console.log('\n# ' + gateway + '\n');
					reservations.forEach(function(rez) {
						console.log((rez.serviceOpts && rez.serviceOpts.store ? '* ' : '- ') + rez.host);
					});
					console.log(reservations.length + ' reservations.');
				}
			});
		});
	})
	.command('unreserve <hostname>...', 'Cancel a hostname reservation on the public gateway', function(yargs) {
		yargs
		.usage('Usage: $0 unreserve <hostname>...\n<hostname>\n  A hostname reservation to cancel.  Can be a fully-qualified DNS name or a hostname that will be concatenated with the default gateway, ".' + defaultGateway + '".')
		.example('$0 unreserve myapp.netsleuth.io')
	}, function(argv) {
		var hosts = argv._.slice(1);
		hosts.unshift(argv['hostname...']);
		hosts.forEach(function(host) {
			if (host.indexOf('.') == -1) {
				host = host + '.' + defaultGateway;
			}
			gw.unreserve(host, function(err) {
				if (err) {
					if (err.code) console.error(host + ': ' + err.code + ' ' + err.message);
					else console.error(host + ': Unable to connect to gateway.  ' + err.message);
				}
				else console.log(host + ': unreserved');
			});
		});
	})
	.command('login', 'Log in to the public gateway', function(yargs) {
		yargs
		.usage('Usage: $0 login')
		.option('gateway', {
			alias: 'g',
			default: defaultGateway,
			describe: 'The gateway host to use.  Defaults to the Network Sleuth public gateway.'
		})
		.option('default', {
			alias: 'd',
			boolean: true,
			describe: 'Use this as the default gateway when inspecting new targets.'
		})
		.option('browser', {
			alias: 'b',
			boolean: true,
			describe: 'Login using your browser instead of by typing your username and password in this terminal.'
		})
		.option('google', {
			alias: 'G',
			boolean: true,
			describe: 'Login using your Google account (via browser).'
		})
		.option('forgot', {
			alias: 'f',
			boolean: true,
			describe: 'Send password reset token.'
		})
		.option('reset', {
			alias: 'r',
			describe: 'Use this password reset token to set a new password.'
		})
		.option('verify', {
			alias: 'v',
			describe: 'Verify account using this verification token.'
		})
	}, function(argv) {

		if (argv.google) return browserLogin(true);
		if (argv.browser) return browserLogin();

		if (argv.verify) return gw.verify(argv.gateway, argv.verify, function(err) {
			if (err) {
				if (err.code == 404) console.error('Invalid token.');
				else if (err.code) console.error(err.code + ' ' + err.message + '\n', err.body);
				else console.error('Unable to connect to gateway.', err);
			}
			else console.log('Account verified.');
		});

		var out = require('../lib/mutable-stdout');

		var rl = readline.createInterface({
			input: process.stdin,
			output: out,
			historySize: 0,
			terminal: true
		});

		if (argv.reset) {
			console.log('Reset password on ' + argv.gateway);
			rl.question('New Password: ', function(password) {
				rl.close();
				process.stdout.write('\n');
				gw.reset(argv.gateway, argv.reset, password, argv.default, function(err, user) {
					if (err) {
						if (err.code) console.error(err.code + ' ' + err.message + '\n', err.body);
						else console.error('Unable to connect to gateway.', err);
					}
					else console.log('Hi, ' + user.username + '!  Successfully reset password and logged in.');
				});
			});
			out.muted = true;
		} else {
			console.log('Login to ' + argv.gateway + ' (or press Ctrl+B to login using your browser)');

			rl.question('Username: ', function(username) {
				if (argv.forgot) {
					rl.close();
					process.stdout.write('\n');
					gw.forgot(argv.gateway, username, function(err) {
						if (err) {
							if (err.code == 404) console.error('Invalid username.');
							else if (err.code) console.error(err.code + ' ' + err.message + '\n', err.body);
							else console.error('Unable to connect to gateway.', err);
						}
						else console.log('Reset information sent.');
					});
				} else {
					rl.question('Password: ', function(password) {
						rl.close();
						process.stdout.write('\n');
						gw.login(argv.gateway, username, password, argv.default, function(err) {
							if (err) console.error(err.message);
							else console.log('Hi, ' + username + '!  Successfully logged in.');
						});
					});
					out.muted = true;
				}
			});
		}

		readline.emitKeypressEvents(process.stdin);

		process.stdin.on('keypress', function(s,key) {
			if (key.name == 'b' && key.ctrl) {
				rl.close();
				console.log('\n');
				browserLogin();
			}
		});

		function browserLogin(google) {
			console.log('Logging in using your browser...');
			require('../lib/browser-login').login({
				gateway: argv.gateway,
				isDefault: argv.default,
				google: google
			}, function(err, username) {
				if (err) {
					console.error('Unable to start callback server.');
					console.error(err);
					process.exit(1);
				}
				console.log('Hi, ' + username + '!  Successfully logged in.');
				process.exit(0);
			});
		}
	})
	.command('logout', 'Log out of the public gateway', function(yargs) {
		yargs
		.usage('Usage: $0 logout [options]')
		.option('gateway', {
			alias: 'g',
			describe: 'The gateway to log out of.  Defaults to all gateways.'
		})
	}, function(argv) {
		gw.logout(argv.gateway, function(err, msg) {
			if (err) console.error(err.message);
			else console.log(msg);
		});
	})
	.command('register', 'Create new account on the public gateway', function(yargs) {
		yargs
		.usage('Usage: $0 register')
		.option('gateway', {
			alias: 'g',
			default: defaultGateway,
			describe: 'The gateway host to use.  Defaults to the Network Sleuth public gateway.'
		})
		.option('default', {
			alias: 'd',
			boolean: true,
			describe: 'Use this as the default gateway when inspecting new targets.'
		})
		.option('browser', {
			alias: 'b',
			boolean: true,
			describe: 'Register using your browser instead of by typing your username and password in this terminal.'
		})
		.option('google', {
			alias: 'G',
			boolean: true,
			describe: 'Register using your Google account (via browser).'
		})
	}, function(argv) {

		if (argv.browser || argv.google) return browserRegister();

		console.log('Create account on ' + argv.gateway + ' (or press Ctrl+B to register using your browser)');

		var out = require('../lib/mutable-stdout');

		var rl = readline.createInterface({
			input: process.stdin,
			output: out,
			historySize: 0,
			terminal: true
		});

		rl.question('Username: ', function(username) {
			rl.question('Password: ', function(password) {
				rl.close();
				process.stdout.write('\n');
				gw.register(argv.gateway, username, password, argv.default, function(err, mustVerify) {
					if (err) {
						if (err.code == 409) console.error('Username already taken.');
						else if (err.code) console.error(err.code + ' ' + err.message + '\n', err.body);
						else console.error('Unable to connect to gateway.', err);
					}
					else {
						console.log('Hi, ' + username + '!  Successfully created account and logged in.');
						if (mustVerify) console.log('A verification email has been sent to you.  You must click the verification link in your email before using this account.');
					}
				});
			});
			out.muted = true;
		});

		readline.emitKeypressEvents(process.stdin);

		process.stdin.on('keypress', function(s,key) {
			if (key.name == 'b' && key.ctrl) {
				rl.close();
				console.log('\n');
				browserRegister();
			}
		});

		function browserRegister() {
			console.log('Registering using your browser...');
			require('../lib/browser-login').login({
				register: true,
				gateway: argv.gateway,
				isDefault: argv.default,
				google: argv.google
			}, function(err, username) {
				if (err) {
					console.error('Unable to start callback server.');
					console.error(err);
					process.exit(1);
				}
				console.log('Hi, ' + username + '!  Successfully created account and logged in.');
				process.exit(0);
			});
		}
	})

	.command('team', 'Manage your team on the public gateway', function(yargs) {
		yargs
		.demandCommand()
		.command('invite <email..>', 'Invite someone to your team', function(yargs) {
			yargs
			.usage('Usage: $0 team invite [options] <email..>')
			.option('gateway', {
				alias: 'g',
				default: defaultGateway,
				describe: 'The gateway host to use.'
			})
			.option('team', {
				alias: 't',
				default: defaultTeam,
				describe: 'The team to invite the user(s) to.'
			})
			.option('admin', {
				alias: 'a',
				boolean: true,
				describe: 'Make this user a team admin.'
			})

		}, function(argv) {

			argv.email.forEach(function(email) {
				gw.invite(argv.gateway, argv.team, email, argv.admin, function(err, code) {
					if (err) {
						if (err.code) console.error(email + ': ' + err.code + ' ' + err.message + ' ' + err.body);
						else console.error(email + ': Unable to connect to gateway.', err);
					} else {
						if (code == 200) console.log(email + ': added existing account to team');
						else if (code == 201) console.log(email + ': invitation email sent');
					}
				});
			});

		})
		.command('invites', 'List pending invites', function(yargs) {
			yargs
			.usage('Usage: $0 team invites [options]')
			.option('gateway', {
				alias: 'g',
				default: defaultGateway,
				describe: 'The gateway host to use.'
			})
			.option('team', {
				alias: 't',
				default: defaultTeam,
				describe: 'The team to list.'
			})

		}, function(argv) {
			gw.invites(argv.gateway, argv.team, function(err, invites) {
					if (err) {
						if (err.code) console.error(err.code + ' ' + err.message + ' ' + err.body);
						else console.error('Unable to connect to gateway.', err);
					} else invites.forEach(function(invite) {
						console.log(invite.email + (invite.admin ? ' (admin)' : ''));
					});
				});
		})
		.command('rminvite <email..>', 'Delete an invitation', function(yargs) {
			yargs
			.usage('Usage: $0 team rminvite [options] <email..>')
			.option('gateway', {
				alias: 'g',
				default: defaultGateway,
				describe: 'The gateway host to use.'
			})
			.option('team', {
				alias: 't',
				default: defaultTeam,
				describe: 'The team to delete invitation(s) from.'
			})

		}, function(argv) {
			argv.email.forEach(function(email) {
				gw.rminvite(argv.gateway, argv.team, email, function(err, code) {
					if (err) {
						if (err.code) console.error(email + ': ' + err.code + ' ' + err.message + ' ' + err.body);
						else console.error(email + ': Unable to connect to gateway.', err);
					} else {
						if (code == 200) console.log(email + ': deleted invitation');
						else if (code == 404) console.log(email + ': no invitation');
					}
				});
			});
		})
		.command('ls', 'List team members', function(yargs) {
			yargs
			.usage('Usage: $0 team ls [options]')
			.option('gateway', {
				alias: 'g',
				default: defaultGateway,
				describe: 'The gateway host to use.'
			})
			.option('team', {
				alias: 't',
				default: defaultTeam,
				describe: 'The team to list.'
			})

		}, function(argv) {
			gw.members(argv.gateway, argv.team, function(err, members) {
				if (err) {
					if (err.code) console.error(err.code + ' ' + err.message + ' ' + err.body);
					else console.error('Unable to connect to gateway.', err);
				} else members.forEach(function(member) {
					console.log(member.user.username + (member.admin ? ' (admin)' : ''));
				});
			});
		})
		.command('rm <email..>', 'Remove team members', function(yargs) {
			yargs
			.usage('Usage: $0 team rm [options] <email..>')
			.option('gateway', {
				alias: 'g',
				default: defaultGateway,
				describe: 'The gateway host to use.'
			})
			.option('team', {
				alias: 't',
				default: defaultTeam,
				describe: 'The team to remove user(s) from.'
			})

		}, function(argv) {
			argv.email.forEach(function(email) {
				gw.rmmember(argv.gateway, argv.team, email, function(err, code) {
					if (err) {
						if (err.code) console.error(email + ': ' + err.code + ' ' + err.message + ' ' + err.body);
						else console.error(email + ': Unable to connect to gateway.', err);
					} else {
						if (code == 200) console.log(email + ': removed member');
						else if (code == 404) console.log(email + ': not a member');
					}
				});
			});
		})

	}, function() {
		console.error('Invalid subcommand.');	
	})

	.command('regions', 'List available gateway regions', function(yargs) {
		yargs
		.usage('Usage: $0 regions [options]')
		.option('gateway', {
			alias: 'g',
			describe: 'Get region list from this gateway service.',
			default: defaultGateway
		})
		.command('best', 'Find the best region to use as your default', function(yargs) {
			yargs
			.usage('Usage $0 regions best [options]\n\nPings all available regions to find the one with the lowest latency from your machine, and sets it as your default region.')
			.option('no-save', {
				alias: 'S',
				boolean: true,
				describe: 'Do not update your config file with the best region'
			})
		}, function(argv) {
			daemon.findBestRegion({ gateway: argv.gateway, save: !argv.noSave }, function(err, results) {
				if (err) {
					console.error('Region search failed: ' + err.message);
					process.exit(1);
				}
				process.stdout.write('Latency  Region\n');
				results.forEach(function(region) {
					var ms = region.ms === null ? 'error' : Math.round(region.ms) + 'ms';
					process.stdout.write(ms + ' '.repeat(9-ms.length) + region.id + '\n');
				});
				if (results[0].ms !== null && !argv.noSave) process.stdout.write('\nSet default ' + argv.gateway + ' region to ' + results[0].id);
			});
		})
		.command('default [region]', 'Get or set the default region for a gateway', function(yargs) {
			
		}, function(argv) {
			if (!config.gateways[argv.gateway]) return console.error('No such gateway configured: ' + argv.gateway);
			if (argv.region) {
				gw.regions(argv.gateway, function(err, regions) {
					if (err) return console.error(err);
					for (var i = 0; i < regions.length; i++) {
						if (regions[i].id == argv.region) {
							config.gateways[argv.gateway].defaultRegion = argv.region;
							rcfile.save(config);
							return console.log('Set default ' + argv.gateway + ' region to ' + argv.region);
						}
					}
					console.error(argv.region + ' is not a valid ' + argv.gateway + ' region');
					process.exit(1);
				});
			} else {
				console.log('The default ' + argv.gateway + ' region is ' + config.gateways[argv.gateway].defaultRegion || '(unset)');
			}
		});
	}, function(argv) {
		gw.regions(argv.gateway, function(err, regions) {
			if (err) console.error(err);
			else regions.forEach(function(region) {
				console.log(region.id);
			});
		});
	})


	.command('start', 'Start the inspection server daemon', function(yargs) {
		yargs
		.usage('Usage: $0 start [options]')
		// .option('port', {
		// 	alias: 'p',
		// 	number: true,
		// 	default: config.port,
		// 	describe: 'Start the server on this port.'
		// })

	}, function(argv) {

		// since we're explicitly starting the daemon, override this
		daemon.autoStart = true;
		daemon.start(function(err, alreadyRunning, host, version) {
			if (err) {
				console.error(err);
				process.exit(1);
			} else {
				if (alreadyRunning) console.log('Daemon already running (v' + version + ' on ' + host + ').');
				else console.log('Daemon v' + version + ' now running on ' + host);
			}
		});

	})

	.command('stop', 'Stop the inspection server daemon', function(yargs) {
		yargs
		.usage('Usage: $0 stop [options]')
		.option('host', {
			alias: 'h',
			describe: 'Stop the server running on this host.'
		})

	}, function(argv) {

		if (argv.host) daemon.setHost(argv.host);

		daemon.stop(function(err) {
			if (err) {
				console.error(err);
				process.exit(1);
			} else {
				console.log('Daemon stopped.');
				process.exit(0);
			}
		});

	})

	.command('restart', 'Stop and restart the inspection server daemon', function(yargs) {
		yargs
		.usage('Usage: $0 restart [options]')
		// .option('port', {
		// 	alias: 'p',
		// 	number: true,
		// 	default: config.port,
		// 	describe: 'Stop the server running locally on this port.'
		// })

	}, function(argv) {

		daemon.autoStart = true;
		daemon.restart(function(err, running, oldVersion, newVersion) {
			if (err) {
				console.error(err);
				process.exit(1);
			} else {
				if (running) {
					if (oldVersion != newVersion) console.log('Daemon restarted with new version.  v' + oldVersion + ' \u27a1 v' + newVersion);
					else console.log('Daemon v' + newVersion + ' restarted.');
					process.exit(0);
				} else {
					console.error('Daemon was not running.');
					process.exit(1);
				}
			}
		});

	})
	.command('setup', 'Run netsleuth system setup', function(yargs) {
		yargs
		.usage('Usage: sudo $0 setup [options]')
		.option('ca', {
			boolean: true,
			describe: 'Install the proxy CA certificate as a trusted CA'
		})
		.option('uninstall', {
			boolean: true,
			describe: 'Remove netsleuth\'s system modifications'
		})
		.epilog('Learn more at https://netsleuth.io/docs/privileged-ports');

	}, function(argv) {

		var systemSetup = require('../lib/system-setup');
		
		if (argv.status) systemSetup.getStatus(getCa(), function(err, status) {
			if (err) {
				console.error(err.message);
				process.exit(1);
			}
			if (status.ok) console.log('System setup is complete.');
			else {
				console.log('System setup is not complete.');
				systemSetup.printStatus(status);
			}
		});
		else if (argv.uninstall) systemSetup.uninstall({
			ca: rcfile.CONFIG_DIR + '/ca.cer'
		}, function(err) {
			if (err) {
				console.error(err.message);
				process.exit(1);
			} else {
				console.log('Success.  Uninstalled.');
			}
		});
		else systemSetup.install({
			ca: argv.ca && rcfile.CONFIG_DIR + '/ca.cer'
		}, function(err) {
			if (err) {
				console.error(err.message);
				process.exit(1);
			} else {
				systemSetup.getStatus(getCa(), function(err, status) {
					if (err) {
						console.error('Setup completed successfully, but there was an error while verifying installation:', err.message);
						process.exit(1);
					}

					if (status.ok) console.log('Success.  Setup complete.');
					else {
						console.log('Setup is still incomplete.  You may need to manually complete these steps:');
						systemSetup.printStatus(status);
					}

					daemon.restart(function() {
						
					});

				});
			}
		});

	})
	.command('ca', 'Get the local netsleuth CA certificate', function(yargs) {
		yargs.usage('Usage: $0 ca\n\nPrints the local CA certificate in PEM format.')
		.command('issue <common-name> [san..]', 'Issue a certificate for this DNS name', function(yargs) {
			yargs
			.usage('Usage: $0 ca issue [options] <common-name> [san..]\n\nUsing your netsleuth CA, issues a new certificate for the specified hostname(s).\n<common-name>\n  The certificate will be issued to this hostname.\n[san..]\n  The certificate will include these hostnames and/or IP addresses as Subject Alternative Names.')
			.option('cert', {
				alias: 'c',
				describe: 'Where to save the certificate',
				default: '-'
			})
			.option('key', {
				alias: 'k',
				describe: 'Where to save the private key',
				default: '-'
			})
			.option('months', {
				alias: 'm',
				describe: 'Months of validity',
				default: 1
			})
			.epilog('The certificate and private key will be output in PEM format.  By default, they are printed on stdout; use -c and -k to save to files.');
		}, function(argv) {
			getCa().issue({ cn: argv.commonName, months: argv.months, sans: argv.san }, function(err, r) {
				if (err) {
					console.error(err);
					process.exit(1);
				}

				if (argv.cert == '-') console.log(r.cert);
				else fs.writeFileSync(argv.cert, r.cert);
				if (argv.key == '-') console.log(r.key);
				else fs.writeFileSync(argv.key, r.key);
			});
		});
	}, function(argv) {
		var stream = fs.createReadStream(rcfile.CONFIG_DIR + '/ca.cer', { encoding: 'utf-8' });
		stream.on('error', function(err) {
			console.error('No local CA has been set up.');
			process.exit(1);
		});
		stream.pipe(process.stdout);
	})
	.command('project [path]', 'Run project autoconfiguration', function(yargs) {
		yargs.usage('Usage: $0 project [path]\n\nThis will look for a .sleuthrc project configuration file in the current directory (or path, if provided) and send it to the netsleuth daemon for processing.  See https://netsleuth.io/docs/project for more info.')
	}, function(argv) {
		var dir = argv.path || process.cwd();
		try {
			var proj = JSON.parse(fs.readFileSync(path.join(dir, '.sleuthrc'), 'utf-8'));

			if (!proj || !proj.project) throw new Error('Not a valid .sleuthrc file.');

			var pconfig = Object.assign({}, config, proj.config),
				pdaemon = new Daemon(pconfig);

			pdaemon.autoStart = true;
			pdaemon.start(function(err, alreadyRunning, host, version) {
				if (err) {
					console.error(err);
					process.exit(1);
				} else {
					daemon.initProject(proj, function(err) {
						if (err) {
							console.error('Unable to initialize netsleuth project', err);
							process.exit(1);
						} else {
							console.log('Success');
							process.exit(0);
						}
					});
				}
			});
		} catch (ex) {
			console.error('Failed to read project file.  ' + ex.message);
			process.exit(1);
		}
	})
	.epilog('Run $0 <command> --help for details about each command, or visit https://netsleuth.io/docs/cli.')
	.demandCommand()
	.version()
	.help();

yargs.argv;

function gatewayFromHost(host) {
	host = host.split('.');
	host.splice(0, 1);
	return host.join('.');
}

function getCa() {
	try {
		var ca = new (require('../lib/certs'))({
			cert: fs.readFileSync(rcfile.CONFIG_DIR + '/ca.cer'),
			key: fs.readFileSync(rcfile.CONFIG_DIR + '/ca.key')
		});
		return ca;
	} catch (ex) {
		console.error('CA certificate not found.', ex.message);
		process.exit(1);
	}
}