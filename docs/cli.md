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
  start                        Start the inspection server daemon
  stop                         Stop the inspection server daemon
  restart                      Stop and restart the inspection server daemon

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
  --version      Show version number                                   [boolean]
  --help         Show help                                             [boolean]
  --reserve, -r  Also reserve the hostname so no one else can take it even if
                 you are offline.  (Only applicable for public gateway.)
                                                                       [boolean]
  --store, -s    If reserving the hostname, enable offline storage mode.  (See
                 help for netsleuth reserve.)                          [boolean]
  --local, -l    Add target in local gateway mode.  In this mode, requests are
                 made to a proxy running on your machine and forwarded to the
                 target.                                               [boolean]
  --ca, -a       Location of the CA or self-signed certificate to use when
                 validating HTTPS certificates presented by the target.
  --insecure     Do not validate HTTPS certificates presented by the target.
                                                                       [boolean]
  --gateway, -g  Use this gateway server (if it cannot be inferred from
                 hostname)
  --auth, -A     Basic auth username:password that the gateway should require
                 before forwarding requests
  --tmp, -t      Add temporarily -- do not save this target configuration to
                 disk.                                                 [boolean]

Examples:
  netsleuth inspect http://localhost:3000 myapp.netsleuth.io
  netsleuth inspect --ca test.crt //staging.example.com staging.netsleuth.io
  netsleuth inspect --local https://example.com 127.0.0.2
```

In order to inspect a target in public mode, you must have an active [public gateway](/gateway) subscription. Inspecting in `local` mode has no additional requirements – the proxy server runs on your machine.

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
  --version        Show version number                                 [boolean]
  --help           Show help                                           [boolean]
  --unreserve, -u  Also cancel the hostname reservation (if applicable)[boolean]

Examples:
  netsleuth rm a.netsleuth.io b.netsleuth.io
```

### `reserve` {#reserve}

```term
Reserves a hostname on the public gateway.
Usage: netsleuth reserve [options] <hostname>...
<hostname>
  A hostname to reserve.  Reserved hostnames are unavailable for other users to
  take even if you are offline.  Can be a fully-qualified DNS name or a hostname
  that will be concatenated with the default gateway, ".netsleuth.io".

Options:
  --version      Show version number                                   [boolean]
  --help         Show help                                             [boolean]
  --store, -s    Enable request storage mode.  When enabled and you are offline,
                 the gateway will store incoming requests *except* GET, HEAD,
                 and OPTIONS requests.  Stored requests are delivered when the
                 target comes back online.                             [boolean]
  --similar, -m  If the requested hostname is not available, automatically
                 reserve a similar name.                               [boolean]
  --auth, -A     Basic auth username:password that the gateway should require
                 before forwarding requests.  Note: these credentials are not
                 stored in a secure fashion.

Examples:
  netsleuth reserve myapp.netsleuth.io
```

You can read more about how the [public gateway works here](/gateway).

If set, the `auth` option causes the gateway to check for an `Authorization: Basic …` header and respond with a 401 if the correct username and password was not supplied. The username and password are stored in plaintext; do not reuse credentials.

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