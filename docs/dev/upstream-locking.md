# Upstream Locking

V0 Preview only bundles CliRelay and codeProxy assets from GitHub Releases.

Current lock:

- CliRelay repository: https://github.com/kittors/CliRelay
- CliRelay version: v0.4.6
- CliRelay commit: eafc44b0fc978c769b7502cb69e1359578bb04bd
- CliRelay macOS arm64 asset: CliRelay_0.4.6_darwin_arm64.tar.gz
- CliRelay SHA-256: 2ec5b2d9132ecafcd175eded6c03b642d29e13d664bc70cac4c7814aa6b73dfc
- CliRelay extracted binary: cli-proxy-api
- codeProxy repository: https://github.com/kittors/codeProxy
- codeProxy version: v0.4.7
- codeProxy commit: d1e963d31b785986d355f85ccdf891ad8dcfc7f8
- codeProxy asset: panel-dist.zip
- codeProxy SHA-256: 00cfa8c1735dae9785c197dc91e3431d9aa1bfc31913363a5821daaaaf0abfee
- codeProxy entrypoint: manage.html

To update the lock, inspect each upstream release, record the tag commit, verify checksums or GitHub Release asset digests, and commit the lock change before running Release CI.
