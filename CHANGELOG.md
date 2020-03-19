Changelog
=========
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