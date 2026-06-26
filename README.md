# CliRelay Desktop

[中文](./README_zh.md) | English

CliRelay Desktop is an independent, unofficial desktop companion for [CliRelay](https://github.com/kittors/CliRelay). It packages a local CliRelay sidecar and the codeProxy management panel into a Tauri desktop app, so you can start, stop, monitor, and update a local CliRelay runtime from a native macOS shell.

This project is not affiliated with or maintained by the CliRelay or codeProxy authors.

## Status

CliRelay Desktop is currently a V0 Preview. The preview build targets macOS Apple Silicon, is ad-hoc signed, and is not notarized by Apple. Treat it as a technical preview for local testing, not as a hardened production distribution.

The preview bundles locked upstream assets. The exact upstream versions and checksums are recorded in [`upstream-lock.json`](./upstream-lock.json).

The bundled management panel is loaded from local packaged resources where possible, avoiding runtime dependence on GitHub REST API downloads.

## What It Does

- Manages a local CliRelay sidecar lifecycle: start, stop, restart, health checks, and recovery states.
- Opens the bundled `/manage` control panel after the service is ready.
- Provides a macOS menu bar entry for service status and quick actions.
- Imports an existing CliRelay `config.yaml` or initializes a default runtime config from the bundled example.
- Requires a management secret before opening management functionality.
- Lets you configure service port, language, login startup, and silent startup behavior.
- Opens data and log directories from the settings UI.
- Checks preview updates for Desktop and upstream component updates for CliRelay and codeProxy.
- Stores runtime files under the user's macOS Application Support directory instead of inside the app bundle.

## Requirements

For the preview app:

- macOS 13 or newer
- Apple Silicon Mac

For local development:

- Node.js and pnpm
- Rust toolchain compatible with Rust `1.77.2` or newer
- Tauri 2 system prerequisites for macOS
- Network access when refreshing locked upstream assets

## Install the Preview App

1. Download the latest preview DMG from the project's release page.
2. Open the DMG and drag `CliRelay Desktop.app` into `Applications`.
3. Launch the app.
4. Because the preview is ad-hoc signed and not notarized, macOS may block the first launch. Open it only if you trust the build source and have verified the downloaded file.
5. On first run, import an existing CliRelay config or initialize the bundled default config.
6. Set the management secret when prompted.
7. Use the management panel or menu bar entry to start and manage the local service.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the frontend dev server:

```bash
pnpm dev
```

Run the Tauri desktop app in development mode:

```bash
pnpm tauri dev
```

Run checks:

```bash
pnpm typecheck
pnpm test
```

Build the frontend:

```bash
pnpm build
```

Build the macOS DMG:

```bash
pnpm tauri build
```

## Upstream Assets

The locked upstream versions and checksums live in [`upstream-lock.json`](./upstream-lock.json).

Update the locked upstream release metadata:

```bash
pnpm upstream:update
```

Pin specific upstream release tags:

```bash
pnpm upstream:update -- --clirelay-version vX.Y.Z --codeproxy-version vX.Y.Z
```

Fetch and verify the bundled CliRelay sidecar, default config, and codeProxy panel assets:

```bash
pnpm upstream:fetch
```

Verify already-fetched bundled assets:

```bash
pnpm upstream:verify
```

Fetched assets are written into:

- `src-tauri/binaries/clirelay-aarch64-apple-darwin`
- `src-tauri/resources/config.example.yaml`
- `src-tauri/resources/panel/`

## Runtime Files

On macOS, user data is stored under:

```text
~/Library/Application Support/CliRelay Desktop/
```

Important runtime paths:

- Runtime config: `~/Library/Application Support/CliRelay Desktop/runtime/config.yaml`
- Runtime sidecar: `~/Library/Application Support/CliRelay Desktop/runtime/sidecar/cli-proxy-api`
- Local management panel: `~/Library/Application Support/CliRelay Desktop/runtime/panel/`
- Desktop settings: `~/Library/Application Support/CliRelay Desktop/state/desktop-settings.json`
- Component state: `~/Library/Application Support/CliRelay Desktop/state/component-state.json`
- Backups: `~/Library/Application Support/CliRelay Desktop/backups/`

Logs are stored under:

```text
~/Library/Logs/CliRelay Desktop/
```

## Configuration Notes

CliRelay Desktop starts the sidecar on `127.0.0.1` and uses port `8317` by default. The port can be changed in Settings when the service is stopped.

The bundled default config keeps CliRelay's Docker-oriented auto-update disabled for the desktop runtime. Desktop-managed component updates are handled through the app update flow instead.

For API and provider configuration, edit the runtime `config.yaml` through the management panel or by opening the data directory from Settings.

## Troubleshooting

- If the service does not start, open the status view and check the suggested recovery action.
- If port `8317` is already in use, connect to the detected service or stop it and change the Desktop port.
- If the management panel cannot open, make sure the service is running and the management secret has been configured.
- If an upstream component update fails, check `desktop.log` and `clirelay.log` from the log directory.
- If macOS blocks the preview app, confirm that you intended to run an ad-hoc signed, non-notarized preview build.

## Project Layout

```text
src/                  React frontend
src-tauri/            Tauri shell and Rust service management
src-tauri/resources/  Bundled config example and management panel assets
src-tauri/binaries/   Bundled CliRelay sidecar binary
scripts/              Upstream asset fetch and verification scripts
upstream-lock.json    Locked upstream versions, release assets, and checksums
```

## Security

CliRelay Desktop runs a local service that can proxy model API traffic and manage credentials. Review your runtime config before enabling remote access, CORS origins, TLS, unauthenticated access, or management endpoints. Keep the management secret private.

## License and Notices

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for bundled upstream component notices. This desktop app is an independent project and does not imply endorsement by upstream projects.

## Friend Link

- [LINUX DO](https://linux.do/)