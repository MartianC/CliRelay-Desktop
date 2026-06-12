# Upstream Locking

V0 Preview only bundles CliRelay and codeProxy assets from GitHub Releases.

Current lock:

- CliRelay repository: https://github.com/kittors/CliRelay
- CliRelay version: v0.4.0
- CliRelay commit: 8f8bcf4fd24ea6b4d4af2e8da269f00d28442629
- CliRelay macOS arm64 asset: CliRelay_0.4.0_darwin_arm64.tar.gz
- CliRelay SHA-256: 3eea3c2c40a95c9aa16763367ca7c541f5df6a30f517c63b32b899ca0fa34a65
- CliRelay extracted binary: cli-proxy-api
- codeProxy repository: https://github.com/kittors/codeProxy
- codeProxy version: v0.4.0
- codeProxy commit: d9434790bdc4c0b23af1e27265003c270783c7ac
- codeProxy asset: panel-dist.zip
- codeProxy SHA-256: 92527fdd8b1a31c4d6fc0775266b422db28229357ac79273fed9aebb6709aa5d
- codeProxy entrypoint: manage.html

To update the lock, inspect each upstream release, record the tag commit, verify checksums or GitHub Release asset digests, and commit the lock change before running Release CI.
