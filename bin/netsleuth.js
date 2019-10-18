#!/usr/bin/env node

var fs = require('fs'),
	path = require('path'),
	readline = require('readline'),
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
			console.error('Error communicating with inspection server: ' + err.message);
			process.exit(1);
		}
		else cb.apply(null, Array.prototype.slice.call(arguments, 1));
	};
}

function getServiceOpts(argv) {
	var opts;

	if (argv.auth) {
		var colon = argv.auth.indexOf(':'),
			user = argv.auth.substr(0, colon),
			pass = argv.auth.substr(colon+1);

		if (!user || !pass) {
			console.error('Invalid Basic auth.  Please provide “username:password”.');
			process.exit(1);
		}

		opts = {
			auth: {
				user: user,
				pass: pass
			}
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
		.option('reserve', {
			alias: 'r',
			boolean: true,
			describe: 'Also reserve the hostname so no one else can take it even if you are offline.  (Only applicable for public gateway.)'
		})
		.option('store', {
			alias: 's',
			boolean: true,
			describe: 'If reserving the hostname, enable offline storage mode.  (See help for `netsleuth reserve`.)'
		})
		.option('local', {
			alias: 'l',
			boolean: true,
			describe: 'Add target in local gateway mode.  In this mode, requests are made to a proxy running on your machine and forwarded to the target.'
		})
		// .option('add-host', {
		// 	alias: 'h',
		// 	boolean: true,
		// 	describe: 'Add an entry to your HOSTS file for this hostname pointing to 127.0.0.1.  netsleuth will sudo for you.'
		// })
		.option('ca', {
			alias: 'a',
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
			alias: 'R',
			describe: 'Use a gateway server hosted in this region.  Run `netsleuth regions` to see a list.',
			default: 'auto'
		})
		.option('auth', {
			alias: 'A',
			describe: 'Basic auth username:password that the gateway should require before forwarding requests'
		})
		.option('host-header', {
			alias: 'H',
			describe: 'Override the HTTP Host header sent to the target with this.'
		})
		.option('tmp', {
			alias: 't',
			boolean: true,
			describe: 'Add temporarily -- do not save this target configuration to disk.'
		})

	}, function(argv) {
		if (argv.reserve && argv.local) {
			yargs.showHelp();
			console.error('Cannot reserve a hostname for targets added in local mode.');
			process.exit(1);
		}
		if (argv.addHost && !argv.local) {
			yargs.showHelp();
			console.error('Hostname can only be added to your HOSTS file when adding a local mode target.');
			process.exit(1);
		}

		var hosts = config.hosts = config.hosts || {};

		if (argv.hostname && !argv.local && argv.hostname.indexOf('.') == -1) {
			argv.hostname = argv.hostname + '.' + defaultGateway;
		}

		if (hosts[argv.hostname]) {
			console.error('You already have a target using hostname ' + argv.hostname);
			process.exit(1);
		}


		var host = {
			target: argv.target,
			region: argv.region
		};

		if (argv.insecure) host.insecure = true;

		if (argv.local) host.local = true;
		else {
			if (argv.gateway) host.gateway = argv.gateway;
			else host.gateway = argv.hostname ? gatewayFromHost(argv.hostname) : defaultGateway;
		}

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

		host.serviceOpts = getServiceOpts(argv);

		daemon.add(Object.assign({ host: argv.hostname }, host), dres(function(body) {
			if (!argv.tmp) {
				config.hosts[body.host] = host;
				rcfile.save(config);
			}
			var proto = host.local ? 'http' : 'https';
			console.log('Inspecting ' + proto + '://' + body.host + ' \u27a1 ' + argv.target);

			if (argv.reserve) {
				gw.reserve(body.host, argv.store, false, host.serviceOpts, function(err, res, hostname) {
					if (err) console.error('Unable to connect to gateway to make reservation.', err);
					else if (res == 200) console.log(body.host + ': reservation updated');
					else if (res == 201) console.log(body.host + ': reserved');
					else if (res == 303) console.log(body.host + ': reserved ' + hostname);
					else if (res == 401) console.log(body.host + ': not logged in to gateway');
					else console.log(body.host + ': ' + res)
				});
			}
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
		.option('unreserve', {
			alias: 'u',
			boolean: true,
			describe: 'Also cancel the hostname reservation (if applicable)'
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
			unreserve: argv.unreserve
		}, dres(function() {

			toRemove.forEach(function(host) {
				delete config.hosts[host];
			});

			rcfile.save(config);
			console.log('Removed ' + toRemove.length + ' targets.');
		}));

		if (argv.unreserve) toRemove.forEach(function(host) {
			if (!config.hosts[host].local) {
				gw.unreserve(host, function(err) {
					if (err) {
						if (err.code) console.error(host + ': ' + err.code + ' ' + err.message);
						else console.error(host + ': Unable to connect to gateway to cancel reservation.  ' + err.message);
					}
					else console.log(host + ': unreserved');
				});
			}
		});

	})
	.command('reserve <hostname>...', 'Reserve a hostname on the public gateway', function(yargs) {
		yargs
		.usage('Reserves a hostname on the public gateway.\nUsage: $0 reserve [options] <hostname>...\n<hostname>\n  A hostname to reserve.  Reserved hostnames are unavailable for other users to take even if you are offline.  Can be a fully-qualified DNS name or a hostname that will be concatenated with the default gateway, ".' + defaultGateway + '".')
		.example('$0 reserve myapp.netsleuth.io')
		.option('store', {
			alias: 's',
			boolean: true,
			describe: 'Enable request storage mode.  When enabled and you are offline, the gateway will store incoming requests *except* GET, HEAD, and OPTIONS requests.  Stored requests are delivered when the target comes back online.'
		})
		.option('similar', {
			alias: 'm',
			boolean: true,
			describe: 'If the requested hostname is not available, automatically reserve a similar name.'
		})
		.option('auth', {
			alias: 'A',
			describe: 'Basic auth username:password that the gateway should require before forwarding requests.  Note: these credentials are not stored in a secure fashion.'
		})
		.epilog('Learn more about how the public gateway works: https://netsleuth.io/gateway')
	}, function(argv) {
		var serviceOpts = getServiceOpts(argv),
			hosts = argv._.slice(1);

		hosts.unshift(argv['hostname...']);
		hosts.forEach(function(host) {
			if (host.indexOf('.') == -1) {
				host = host + '.' + defaultGateway;
			}
			gw.reserve(host, argv.store, argv.similar, serviceOpts, function(err, res, hostname) {
				if (err) console.error('Unable to connect to gateway.', err);
				else if (res == 200) console.log(host + ': reservation updated');
				else if (res == 201) console.log(host + ': reserved');
				else if (res == 303) console.log(host + ': reserved ' + hostname);
				else if (res == 401) console.log(host + ': not logged in to gateway');
				else console.log(host + ': ' + res)
			});
		});
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
						console.log((rez.store ? '* ' : '- ') + rez.host);
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
	}, function(argv) {
		gw.regions(argv.gateway, function(err, regions) {
			if (err) console.error(err);
			else console.log(regions.join('\n'));
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
