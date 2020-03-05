API
---

Using netsleuth's node.js API, you can integrate netsleuth in to your project's development environment for your team's convenience.

- node.js projects use this API for direct integration.
- If your project is not a node.js project, you can integrate netsleuth into your project's dev environment using the `netsleuth project` command -- see the [project config docs](/docs/project).

All developers can use the [CLI](/docs/cli) to manage their netsleuth configuration.

### `netsleuth.attach([options][, readyCb])` {#attach}

The `attach` method attaches the netsleuth inspector to node's core `http` and `https` modules. netsleuth monkey patches the core modules to install hooks which allow it to monitor every HTTP(S) request made _from_ the node process. This means that no code changes are necessary in your application and you do not have to make requests through a proxy; request inspection "just works".

The recommended way to attach netsleuth is by conditionally calling `attach` if running in a dev environment **as the very first thing your application does**:

```js
if (process.env.NODE_ENV == 'dev') {
	require('netsleuth').attach();
}
```

It is important that this happens _before_ any other modules are `require`d or `import`ed so netsleuth can properly install its hooks before other modules have a chance to run.

After netsleuth patches the core http modules, it will optionally perform a number of other steps for your convenience:

- Automatically start the netsleuth daemon if it is not already running.
- If necessary, initialize the project using the [`.sleuthrc` project config file](/docs/project), which allows your project to automatically set up public hostnames for every developer on your team.
- Install `require` hooks that allow it to further patch well-known third-party HTTP libraries (such as [request](https://www.npmjs.com/package/request)) to provide accurate stack traces in the "Initiator" column of the inspector.

#### Options {#attach_options}

- `name` - the name as seen on the inspector list ([http://localhost:9000/](http://localhost:9000/){target=_blank}). Requests are grouped by name. Defaults to the project name (if configured in a `.sleuthrc` file), or the process executable name + pid (eg `node.1234`)
- `transient` - if `true`, the inspector will be automatically deleted when the the process ends. If no `name` is provided, this will default to `true`.
- `autoStart` - if `false`, netsleuth will not attempt to automatically start its daemon. netsleuth will not work if the daemon is not running.
- `initProject` - if `false`, netsleuth will not use your project's `.sleuthrc` to autoconfigure itself.
- `hooks` - if `false`, netsleuth will not install `require` hooks that allow it to further patch well-known third-party HTTP libraries to provide accurate stack traces in the "Initiator" column of the inspector.
- `host` - the netsleuth daemon's host and port. Defaults to `127.0.0.1:9000` unless it detects that the process is [running in a Docker container](#docker).

#### `readyCb` {#attach_cb}

The `readyCb` is invoked when netsleuth successfully connects to the daemon. Requests made before the daemon connection is ready are not buffered, so you may want to delay your application's intitialization until this callback.

### `netsleuth.init([options])` {#init}

`init()` performs netsleuth's project autoconfiguration without attaching the inspector to the process (ie nothing is patched).

Options are similar to `attach()` except `name`, `transient`, `hooks`, and `initProject` do not apply.

### `netsleuth.InspectionServer` {#inspectionserver}

The `InspectionServer` class is normally instantiated by the netsleuth daemon at startup. `InspectionServer` provides facilities for inspection targets to submit their request/response events to the daemon. Normal user code should not need to use this class.

#### `new InspectionServer([opts])` {#inspectionserver_new}

##### Options

- `port` - the inspection server's HTTP service listens on this port
- `https` - also create a HTTPS service. These options are passed to [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener).

Note: the server does not start listening automatically; you must call `server.http.listen(port)` and/or `server.https.listen(httpsPort)`.

#### `InspectionServer#inspect([opts])` {#inspectionserver_inspect}

Adds a new inspection instance. Inspection instances can be:

- [[remote]], for incoming requests received a public gateway and forwarded to a target;
- [[local]], for incoming requests received by a `GatewayServer` running on the local daemon and forwarded to a target; or
- [[inproc]], for outgoing requests from a process connected to the `InspectionServer`. inproc inspectors are added by [`inspectInproc()`](#inspectionserver_inspectinproc).

This method is ultimately what the CLI's [`$netsleuth inspect`](cli#inspect) calls; see its documentation for a more complete explanation of the following options.

##### Options

Some options only apply to [[remote]] and/or [[local]] inspectors for incoming requests.

- `host` - [[remote]] [[local]] the hostname or IP for incoming requests (eg `example.netsleuth.io` for remote or `127.0.0.2` for local)
- `target` - [[remote]] [[local]] Origin URL of the server requests will be forwarded to
- `gateway` - [[remote]] the public gateway that will host this inspector's incoming requests. Defaults to removing the first DNS label of `host` (eg `example.netsleuth.io` ⇒ `netsleuth.io`).
- `token` - [[remote]] the user's auth token for the `gateway`. Defaults to the user's saved token stored in `.sleuthrc`.
- `gatewayUrl` - [[remote]] where the netsleuth inspector protocol resource is located. Defaults to `wss://[host]/.well-known/netsleuth`
- `gcFreqMs` - how often the request garbage collector should run. Defaults to 15 minutes.
- `gcFreqCount` - how
- `gcMinLifetime` - how old a request must be before it is eligible for garbage collection. Defaults to 5 minutes.
- `reqMaxSize` - the max number of request body bytes to buffer in-memory. Larger requests are saved to disk in `tmpDir`. Defaults to 10 MB.
- `resMaxSize` - the max number of response body bytes to buffer in-memory. Larger responses are saved to disk in `tmpDir`. Defaults to 10 MB.
- `tmpDir` - folder for storing temporary files. Defaults to [`os.tmpdir()`](https://nodejs.org/api/os.html#os_os_tmpdir)` + '/netsleuth'`
- `insecure` - [[remote]] [[local]] do not validate HTTPS certificates
- `ca` - [[remote]] [[local]] PEM of the CA or self-signed certificate to use when validating HTTPS certificates presented by the target.
- `serviceOpts` - [[remote]] [[local]] options sent to the gateway when the inspector first connects.
    - `auth` - the gateway should require these `Authorization: Basic` credentials before forwarding incoming requests
    
    - `user`
    - `pass`
    
- `region` - [[remote]] the gateway should host this instance in this cloud region (see `netsleuth region` for a list).

Returns an `Inspector` instance.

#### `InspectionServer#remove(host)` {#inspectionserver_remove}

Removes a remote or local inspection instance by hostname.

#### `InspectionServer#inspectInproc(name, transient)` {#inspectionserver_inspectinproc}

Adds an [[inproc]] inspector instance.

- `name` - the name to display in the netsleuth UI. Requests are grouped by name. Defaults to the process name and pid.
- `transient` - transient inspectors are automatically removed when the inspected process disconnects.

### `netsleuth.GatewayServer` {#gatewayserver}

The `GatewayServer` class is normally instantiated by the netsleuth daemon at startup. When [[local]] mode inspection targets are added, they are added to the daemon's default gateway. `GatewayServer` accepts incoming http(s) requests, forwards them to target server(s), receives and forwards responses to clients, and submits the request/response events to the `InspectionServer`. Normal user code should not need to use this class.

#### `new GatewayServer([opts])` {#gatewayserver_new}

##### Options

- `silenceTimeout` - how long a request/response should be allowed to sit idle before timing out. Defaults to 2 minutes.
- `pingFreq` - how often to check connection health. Defaults to 2 minutes.
- `https` - create a https server. These options are passed to [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener).
- `host` - the server's natural hostname

Docker {#docker}
------

Processes running inside Docker containers may be inspected so long as the following caveats are observed.

Running the netsleuth daemon inside a Docker container is not a supported configuration; it is meant to run on your real machine. Processes running inside containers should connect to the global inspector daemon running on your host OS.

This means you should manually install the [netsleuth CLI](/docs/cli) on your host machine and run `netsleuth [start](/docs/cli#start)` before starting your Docker container.

If netslueth detects that an inspected process is running inside a docker container, its behavior is altered:

*   The default `host` [option](#attach_options) is changed to `host.docker.internal:9000`.
*   The default `autoStart` [option](#attach_options) is changed to `false`.

The magic DNS name `host.docker.internal` resolves to your host OS LAN IP address. This feature requires Docker v18.03 or later. You must ensure that processes running in containers can reach the daemon (ie check your firewall). Note that docker-for-linux [does not yet support this magic hostname](https://github.com/docker/for-linux/issues/264). See the linked issue for workarounds.