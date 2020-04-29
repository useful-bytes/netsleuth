Changelog
=========
2.0.1 2020-04-28
----------------
- UI tweaks

2.0.0 2020-04-27
----------------
- Major refactor of internals
- Add local CA for automatic self-issued TLS certificates
- Add support for local forward HTTP(S) proxy
- Add support for self-issued HTTPS on local reverse proxy targets
- Add UI for certificate trust (when a target presents an invalid certificate)
- req: add support for TLS client certificates
- Improved handling of large request/response bodies
- Request replay UI
- Add support for HTTP/2 requests in native node.js integration
- Basic request/response modification scripting support
- Network speed throttling (GUI and req CLI)
- Better backpressure handling
- Misc UI improvements and tweaks
- Numerous bug fixes

1.0.9 2020-03-20
----------------
- Prevent `req` and `snode` from popping up a project init/login window
- Fix postinstall bug

1.0.8 2020-03-19
----------------
- Prefer the globally installed version of netsleuth when starting the daemon
- Ensure .sleuthrc file gets the correct ownership and permissions
- Fix the postinstall script so it handles the various users it might run as

1.0.7 2020-03-19
----------------
- Fix typo in postinstall script

1.0.6 2020-03-18
----------------
- Display system setup message in GUI rather than than trying to automatically sudo during npm install.  (In retrospect, this was probably an overaggressive choice given the lack of context.)

1.0.5 2020-03-17
----------------
- Multiple bugfixes for local proxy mode
- Improve authbind support on Linux
- Automatic Mac loopback config

1.0.4 2020-03-12
----------------
- Add support for authbind on unix platforms to enable listening on privileged ports (< 1024)
- Automatic installation of authbind binaries on Mac OS

1.0.3 2020-03-12
----------------
- Fix DevTools GUI on case-sensitive filesystems
- Fix browser version warning check
- Update docs

1.0.2 2020-03-04
----------------
- Add `netsleuth project` CLI command

1.0.1 2020-03-03
----------------
- Fix a daemon crash when adding first target

1.0.0 2020-03-03
----------------
Initial public release