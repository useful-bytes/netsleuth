CLI
---

Using the netsleuth CLI, you can use netsleuth with any project using any programming language that makes HTTP(S) requests. For node.js projects, there is also an [API](/docs/api) available.

To use the CLI, you should install netsleuth as a global package so it is available on `PATH`. (Doing so may require `sudo` depending on how you installed node.)

```term
$ npm install -g netsleuth
```

The CLI interacts with the local netsleuth daemon and/or the public gateway API, depending on the command you run. If the daemon is not running, you may need to [start](#start) it first.

### Commands {#commands}

```term
Usage: netsleuth <command>

Commands:
  inspect <target> [hostname]  Add a new inspection target
  ls                           List inspection targets
  rm <target|hostname>...      Remove inspection target(s)
  reserve <hostname>...        Reserve a hostname on the public gateway
  reservations                 Lists your hostname reservations on the public
                               gateway
  unreserve <hostname>...      Cancel a hostname reservation on the public
                               gateway
  login                        Log in to the public gateway
  logout                       Log out of the public gateway
  register                     Create new account on the public gateway
  team                         Manage your team on the public gateway
  regions                      List available gateway regions
  start                        Start the inspection server daemon
  stop                         Stop the inspection server daemon
  restart                      Stop and restart the inspection server daemon
  setup                        Run netsleuth system setup
  ca                           Get the local netsleuth CA certificate
  project [path]               Run project autoconfiguration

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

### `inspect` {#inspect}

```term
Usage: netsleuth inspect [options] <target> [hostname]

Adds a new inspection target to your local inspection server.
<target>
  Origin URL of the server requests will be forwarded to (ie, paths ignored).
  The target can be any URL you can reach from your machine, and can be
  protocol-absolute to always use the same protocol to connect to the target
  (regardless of which protocol--HTTP or HTTPS--was used by the client to
  connect to the gateway), or protocol-relative if you want to use the same
  protocol that the client used for each request.
[hostname]
  Hostname to use for incoming requests.
  In public mode: Can be a fully-qualified DNS name or a hostname that will be
  concatenated with the default gateway, ".netsleuth.io".
  In local mode: can be a hostname or IP address.  (Protip: the loopback subnet
  is a /8; use a different loopback IP for each target.)

  If not specified, the hostname is autoassigned.

Options:
  --version          Show version number                               [boolean]
  --help             Show help                                         [boolean]
  --store, -s        Enable the gateway's offline storage mode.  (See help for
                     `netsleuth reserve`.)                             [boolean]
  --local, -l        Add target in local gateway mode.  In this mode, requests
                     are made to a proxy running on your machine and forwarded
                     to the target.                                    [boolean]
  --add-host, -h     Add an entry to your HOSTS file for this hostname pointing
                     to 127.0.0.1.  netsleuth will sudo for you.       [boolean]
  --ca, -c           Location of the CA or self-signed certificate to use when
                     validating HTTPS certificates presented by the target.
  --insecure         Do not validate HTTPS certificates presented by the target.
                                                                       [boolean]
  --gateway, -g      Use this gateway server (if it cannot be inferred from
                     hostname)
  --region, -r       Use a gateway server hosted in this region.  Run `netsleuth
                     regions` to see a list.                   [default: "auto"]
  --auth, -a         Basic auth username:password that the gateway should
                     require before forwarding requests
  --host-header, -H  Override the HTTP Host header sent to the target with this.
  --temp, -t         Add temporarily -- do not save this target configuration to
                     disk.                                             [boolean]

Examples:
  netsleuth inspect http://localhost:3000 myapp.netsleuth.io
  netsleuth inspect --ca test.crt //staging.example.com staging.netsleuth.io
  netsleuth inspect --local https://example.com 127.0.0.2
```

In order to inspect a target in public mode, you must have an active [public gateway](/gateway) subscription. Inspecting in `local` mode has no additional requirements – the proxy server runs on your machine.

If set, the `auth` option causes the gateway to check for an `Authorization: Basic …` header and respond with a 401 if the correct username and password was not supplied. The username and password are stored in plaintext; do not reuse credentials.

Note: netsleuth can also inspect outgoing requests made from a node process. It is not necessary to run any CLI commands for this functionality; see the [API docs](api) for more info.

### `rm` {#rm}

```term
Usage: netsleuth rm [options] <target|hostname>...
<target>
  An Origin URL to remove as an inspection target
<hostname>
  A hostname to remove as an inspection target

You need only specify *either* the target or hostname of an inspection target.

Options:
  --version               Show version number                          [boolean]
  --help                  Show help                                    [boolean]
  --keep-reservation, -R  Keeps your reservation of this hostname active on the
                          public gateway                               [boolean]

Examples:
  netsleuth rm a.netsleuth.io b.netsleuth.io
```

### `unreserve` {#unreserve}

```term
Usage: netsleuth unreserve <hostname>...
<hostname>
  A hostname reservation to cancel.  Can be a fully-qualified DNS name or a
  hostname that will be concatenated with the default gateway, ".netsleuth.io".

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]

Examples:
  netsleuth unreserve myapp.netsleuth.io
```

### `login` {#login}

```term
Usage: netsleuth login

Options:
  --version      Show version number                                   [boolean]
  --help         Show help                                             [boolean]
  --gateway, -g  The gateway host to use.  Defaults to the Network Sleuth public
                 gateway.                              [default: "netsleuth.io"]
  --default, -d  Use this as the default gateway when inspecting new targets.
                                                                       [boolean]
  --browser, -b  Login using your browser instead of by typing your username and
                 password in this terminal.                            [boolean]
  --google, -G   Login using your Google account (via browser).        [boolean]
  --forgot, -f   Send password reset token.                            [boolean]
  --reset, -r    Use this password reset token to set a new password.
  --verify, -v   Verify account using this verification token.
```

### `logout` {#logout}

```term
Usage: netsleuth logout [options]

Options:
  --version      Show version number                                   [boolean]
  --help         Show help                                             [boolean]
  --gateway, -g  The gateway to log out of.  Defaults to all gateways.
```

### `register` {#register}

```term
Usage: netsleuth register

Options:
  --version      Show version number                                   [boolean]
  --help         Show help                                             [boolean]
  --gateway, -g  The gateway host to use.  Defaults to the Network Sleuth public
                 gateway.                              [default: "netsleuth.io"]
  --default, -d  Use this as the default gateway when inspecting new targets.
                                                                       [boolean]
  --browser, -b  Register using your browser instead of by typing your username
                 and password in this terminal.                        [boolean]
  --google, -G   Register using your Google account (via browser).     [boolean]
```

An account is not required to use netsleuth in local gateway or node-integrated mode. It is only required to use the public gateway.

### `team` {#team}

This command manages your team account on the public gateway.

```term
Usage: netsleuth team

Commands:
  invite <email..>    Invite someone to your team
  invites             List pending invites
  rminvite <email..>  Delete an invitation
  ls                  List team members
  rm <email..>        Remove team members
```

### `regions` {#regions}

```term
Usage: netsleuth regions [options]

Commands:
  netsleuth regions best                 Find the best region to use as your
                                         default
  netsleuth regions default [region]     Get or set the default region for a
                                         gateway

Options:
  --version      Show version number                                   [boolean]
  --help         Show help                                             [boolean]
  --gateway, -g  Get region list from this gateway service.
                                                       [default: "netsleuth.io"]
```

### `start` {#start}

netsleuth runs a background daemon that forwards incoming requests to your targets. This starts the daemon if it is not already running. If you use [`netsleuth.init()`](/docs/api#init) or [`netsleuth.attach()`](/docs/api#attach) in your project, the daemon will be started automatically for you when you start your project.

```term
Usage: netsleuth start [options]

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

### `stop` {#stop}

This gracefully stops the daemon process.

```term
Usage: netsleuth stop [options]

Options:
  --version   Show version number                                      [boolean]
  --help      Show help                                                [boolean]
  --host, -h  Stop the server running on this host.
```

### `restart` {#restart}

This gracefully restarts the daemon process.

```term
Usage: netsleuth start [options]

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

### `setup` {#setup}

This command runs netsleuth's system setup script, which sets up [privileged port access](https://netsleuth.io/docs/privileged-ports) and optionally installs your generated [TLS CA certificate](https://netsleuth.io/docs/tls).

```term
Usage: sudo netsleuth setup [options]

Options:
  --version    Show version number                                     [boolean]
  --help       Show help                                               [boolean]
  --ca         Install the proxy CA certificate as a trusted CA        [boolean]
  --uninstall  Remove netsleuth's system modifications                 [boolean]
```

### `ca` {#ca}

```term
Usage: netsleuth ca

Prints the local CA certificate in PEM format.

Commands:
  ca issue <common-name> [san..]  Issue a certificate for this DNS name
```

### `ca issue` {#ca-issue}

```term
Usage: netsleuth ca issue [options] <common-name> [san..]

Using your netsleuth CA, issues a new certificate for the specified hostname(s).
<common-name>
  The certificate will be issued to this hostname.
[san..]
  The certificate will include these hostnames and/or IP addresses as Subject
  Alternative Names.

Options:
  --version     Show version number                                    [boolean]
  --help        Show help                                              [boolean]
  --cert, -c    Where to save the certificate                     [default: "-"]
  --key, -k     Where to save the private key                     [default: "-"]
  --months, -m  Months of validity                                  [default: 1]

The certificate and private key will be output in PEM format.  By default, they
are printed on stdout; use -c and -k to save to files.
```

### `project` {#project}

Runs [project autoconfiguration](https://netsleuth.io/docs/project).

```term
Usage: netsleuth project [path]

This will look for a .sleuthrc project configuration file in the current
directory (or path, if provided) and send it to the netsleuth daemon for
processing.  See https://netsleuth.io/docs/project for more info.

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

Configuration Options
---------------------

netsleuth stores configuration data in `~/.sleuthrc`. This file is modified by CLI commands, but you can also edit the file manually if necessary. Run `netsleuth restart` after saving changes.

The configuration file is a JSON file with the following keys:

- `gateways` - the public gateway servers you have logged in to. This section is maintained by the CLI. You can log in to the [netsleuth public gateway](/gateway) and/or your company’s on-premises gateway server.
- `hosts` - your inspection targets. This is an object.
    - Each key is a hostname.
    - `target` - the Origin to forward requests to.
    - `gateway` - the hostname of the gateway server
    - `local` - if `true`, this host runs in local mode. The netsleuth daemon will listen on the given IP of your machine and forward requests to the target (which may be runnning anywhere, not just on your machine).
    - `insecure` - do not validate the target’s TLS certificate.
    - `ca` - validate the target’s TLS certificate using this self-signed or CA certificate. (path to file)
    - `gcFreqMs` - garbage collect buffered request data this often. Defaults to 15 minutes.
    - `gcFreqCount` - garbage collect buffered request data after this many requests have been handled. Defaults to 500.
    - `gcMinLifetime` - the minimum amount of time that a request should stay in the in-memory buffer. When garbage collection runs, data older than this threshold will be discarded. Defaults to 5 minutes.
    - `tmpDir` - large request/response bodies will be stored on disk rather than buffered in-memory; store them in this temporary directory. Defaults to [`os.tmpdir()`](https://nodejs.org/api/os.html#os_os_tmpdir)` + '/netsleuth'`
    - `reqMaxSize` - request bodies larger than this (bytes) will be saved to temporary disk storage. Defaults to 10 MB.
    - `resMaxSize` - response bodies larger than this (bytes) will be saved to temporary disk storage. Defaults to 10 MB.
- `host` - the netsleuth daemon will bind to this IP & port. Defaults to `127.0.0.1:9000`
    - **Note:** if netsleuth’s node-integrated mode detects that your project is running inside a Docker container, it will automatically change the `host` to `host.docker.internal:9000` and disable `autoStart`. This requires Docker ≥ 18.03, and you must manually run the netsleuth daemon on your bare-metal machine. Running the netsleuth daemon inside a container is not a supported configuration.
- `defaultGateway` - when you run [`$netslueth inspect`](#inspect) with an unqualified `hostname`, use this gateway host to calculate a fully-qualified hostname.
- `autoStart` - if `false`, netsleuth will not attempt to automatically start the daemon when you call [`netsleuth.init()`](/docs/api#init) or [`netsleuth.attach()`](/docs/api#attach).