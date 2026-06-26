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

Update flow:

1. Run `pnpm upstream:update` to update `upstream-lock.json`, this document, and third-party notices.
2. Run `pnpm upstream:fetch` to download and verify the locked assets into ignored local build inputs.
3. Run `pnpm upstream:verify` before building or releasing.
4. Commit the lock, docs, and tests. Do not commit fetched `src-tauri/binaries/` or `src-tauri/resources/` outputs.

To pin a specific release, pass explicit tags:

```bash
pnpm upstream:update -- --clirelay-version vX.Y.Z --codeproxy-version vX.Y.Z
```
