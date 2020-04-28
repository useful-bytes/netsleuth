<p align="center">
  <img width="250" src="https://netsleuth.io/img/netsleuth.svg">
</p>
<h1 align="center"> netsleuth </h1>
<p align="center">
  <b ></b>
</p>

<br>

[netsleuth](https://netsleuth.io) brings the Chrome DevTools' Network tab to node.js with a native integration and to anything else that speaks HTTP via forward and reverse proxy server.

The [public gateway](https://netsleuth.io/gateway) allows you to get publicly accessible URLs for your local development environment, with full TLS and no headaches.

Getting started
===============
netsleuth can be installed as a global command line tool and/or as a dependency in your node.js project.
```sh
npm install -g netsleuth
snode myscript.js # runs myscript.js in an inspectable node process, or...
netsleuth inspect http://localhost:3000 myapp.netsleuth.io
```

```sh
npm install --save-dev netsleuth
```
```js
if (process.env.NODE_ENV == 'dev') {
    var netsleuth = require('netsleuth');
    netsleuth.attach(); // attach the inspector to this process
}
```

…then open http://localhost:9000 to start inspecting your HTTP(S) requests.

[**Read the full Getting Started Guide here.**](https://netsleuth.io/docs/getting-started)

Full documentation is available on [the netsleuth website](https://netsleuth.io/docs).