# CliRelay Desktop V0 Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。所有步骤使用 checkbox (`- [ ]`) 语法追踪。

**Goal:** 交付一个可安装、可验证、可迭代的 macOS Apple Silicon 技术预览版 CliRelay Desktop。

**Architecture:** 桌面端使用 Tauri 2 作为宿主，Rust 负责 Sidecar 生命周期、状态机、日志、路径、更新检查和安全命令边界，React 只负责 Shell/Status/Settings 展示与受限命令调用。CliRelay 和 codeProxy 都不 fork、不重构、不重新实现，正式发布链只消费已锁定的上游 GitHub Release assets，并把本地打包的 `/manage` 放入零权限 Panel WebView。

**Tech Stack:** Tauri 2、Rust、TypeScript、React、Vite、pnpm、Vitest、GitHub Actions、macOS Ad Hoc codesign。

## 当前实施进度

**Last updated:** 2026-06-13（Asia/Shanghai）

**当前分支：** `dev`

**已完成提交：**

| Task | Commit | 状态 |
|---|---|---|
| Task 1 | `5e97a93 feat: scaffold tauri desktop app` | 已完成 |
| Task 2 | `ab2389a feat: define preview app metadata` | 已完成 |
| Task 3 | `a1194c6 feat: lock upstream release assets` | 已完成 |
| Task 4 | `032e434 feat: fetch verified upstream assets` | 已完成 |
| Task 4 修正 | `c2cad66 chore: ignore fetched upstream assets` | 已完成 |
| Task 5 | `c71d25f feat: add desktop paths and settings` | 已完成 |
| Task 6 | `d4eae19 feat: add service state machine` | 已完成 |
| Task 7 | `c1bc7a0 feat: add rotating logs` | 已完成 |
| Task 8 | `c6b0489 feat: add sidecar ownership checks` | 已完成 |
| Task 9 | `38db95c feat: add service health probes` | 已完成 |
| Task 10 | `0973de0 feat: manage sidecar lifecycle` | 已完成 |
| Task 11 | `0624486 feat: add safe desktop commands` | 已完成 |

**当前结论：** Task 1 到 Task 11 已完成。上游 CliRelay binary、`config.example.yaml` 和 codeProxy panel dist 不进入 git；它们由 `pnpm upstream:fetch` 按 `upstream-lock.json` 下载、校验和放置，并由 `.gitignore` 忽略。Desktop 路径、默认设置、`runtime/config.yaml` 首次生成、本地 panel 复制、服务状态机、日志轮转、Desktop 日志脱敏、CliRelay 原始输出采集、runtime-state、Sidecar 归属判断、健康检查、Panel ready、External 端口探测、Service Manager 启停重启流程、Rust command 白名单、Settings patch 校验和窗口 capability 初始隔离已经具备测试覆盖。

**下一步：** 从 Task 12 开始实现主窗口、Panel 窗口和 Settings 窗口管理。完整 React Shell、菜单栏和发布 CI 仍在后续 Task 中完成。

**最近验证：**

```bash
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml commands
cargo test --manifest-path src-tauri/Cargo.toml --test service_manager
cargo test --manifest-path src-tauri/Cargo.toml service::health
cargo test --manifest-path src-tauri/Cargo.toml service::ownership
cargo test --manifest-path src-tauri/Cargo.toml service::logs
cargo test --manifest-path src-tauri/Cargo.toml service::state
cargo test --manifest-path src-tauri/Cargo.toml settings
cargo test --manifest-path src-tauri/Cargo.toml paths
pnpm upstream:verify
pnpm tauri info
rg -n "greet|@tauri-apps/api|__TAURI_INTERNALS__|window\\.__TAURI__|invoke\\(" src src-tauri/resources/panel src-tauri/src src-tauri/capabilities
git ls-files src-tauri/binaries src-tauri/resources/config.example.yaml src-tauri/resources/panel
git check-ignore -v src-tauri/binaries/clirelay-aarch64-apple-darwin src-tauri/resources/config.example.yaml src-tauri/resources/panel/manage.html src-tauri/resources/panel/assets/panel-chunk.js
```

Expected: `pnpm test` 通过 6 个用例；`pnpm build` 通过；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml` 通过 36 个单元用例和 4 个 Service Manager 集成用例；`commands` 过滤器通过 5 个用例；`cargo test --manifest-path src-tauri/Cargo.toml --test service_manager` 通过 4 个用例；`service::health` 过滤器通过 6 个用例；`service::ownership` 过滤器通过 7 个用例；`service::logs` 过滤器通过 7 个用例；`service::state` 过滤器通过 2 个用例；`settings` 过滤器通过 7 个用例；`paths` 过滤器通过 2 个用例；`pnpm upstream:verify` 通过；`pnpm tauri info` 可读取配置（本机未安装 Xcode 属环境提示，不影响当前代码验证）；Panel dist 无 `@tauri-apps/api`、`__TAURI_INTERNALS__` 或 `window.__TAURI__` 命中；`git ls-files ...` 无输出；`git check-ignore -v ...` 命中 `.gitignore` 中的上游 fetch 输出规则。

---

## 0. 输入与固定常量

**来源文档：** `docs/dev/CliRelay_Desktop_V0_Preview_计划文档.md`

**仓库：** `https://github.com/MartianC/CliRelay-Desktop`

**默认分支：** `main`

**建议 Bundle ID：** `com.martianc.clirelay-desktop`

**应用显示名：** `CliRelay Desktop`

**Preview 更新索引：** `https://martianc.github.io/CliRelay-Desktop/latest-preview.json`

**Desktop 版本线：** `0.0.x-preview.N`

**首个实施版本：** `0.0.1-preview.1`

**最低 macOS：** `13.0`

**目标架构：** `aarch64-apple-darwin`

**默认端口：** `8317`

**数据目录：** `~/Library/Application Support/CliRelay Desktop/`

**日志目录：** `~/Library/Logs/CliRelay Desktop/`

**上游 CliRelay：**

```json
{
  "repository": "https://github.com/kittors/CliRelay",
  "version": "v0.4.0",
  "commit": "8f8bcf4fd24ea6b4d4af2e8da269f00d28442629",
  "asset": "CliRelay_0.4.0_darwin_arm64.tar.gz",
  "sha256": "3eea3c2c40a95c9aa16763367ca7c541f5df6a30f517c63b32b899ca0fa34a65",
  "extractedBinaryPath": "cli-proxy-api"
}
```

**上游 codeProxy：**

```json
{
  "repository": "https://github.com/kittors/codeProxy",
  "version": "v0.4.0",
  "commit": "d9434790bdc4c0b23af1e27265003c270783c7ac",
  "asset": "panel-dist.zip",
  "sha256": "92527fdd8b1a31c4d6fc0775266b422db28229357ac79273fed9aebb6709aa5d",
  "entrypoint": "manage.html"
}
```

**代码改动原因：** 这些常量会被 `tauri.conf.json`、`upstream-lock.json`、更新检查、Release CI、URL 白名单和 About 信息共同引用。CliRelay 启动时会在面板资源缺失时访问 GitHub REST API 下载 codeProxy；Desktop 直接打包已锁定的 codeProxy Release asset，可以避免用户运行时因网络或 API 限流导致 `/manage` 不可用。

## 1. 目标文件结构

实施完成后仓库采用标准 Tauri 单应用结构：

```text
CliRelay-Desktop/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── preview-release.yml
├── docs/
│   └── dev/
│       ├── CliRelay_Desktop_V0_Preview_计划文档.md
│       └── CliRelay_Desktop_V0_Preview_实施文档.md
├── scripts/
│   ├── fetch-upstream.ts
│   ├── verify-checksum.ts
│   ├── generate-build-manifest.ts
│   ├── generate-latest-preview.ts
│   └── generate-notices.ts
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   └── routes.ts
│   ├── bridge/
│   │   ├── commands.ts
│   │   └── types.ts
│   ├── components/
│   │   ├── StatusView.tsx
│   │   ├── SettingsView.tsx
│   │   └── FieldRow.tsx
│   ├── stores/
│   │   ├── serviceStore.ts
│   │   └── settingsStore.ts
│   └── styles/
│       └── app.css
├── src-tauri/
│   ├── binaries/
│   │   └── clirelay-aarch64-apple-darwin        # pnpm upstream:fetch 生成，git ignored
│   ├── capabilities/
│   │   ├── shell.json
│   │   ├── settings.json
│   │   └── panel.json
│   ├── resources/
│   │   ├── config.example.yaml                  # pnpm upstream:fetch 生成，git ignored
│   │   └── panel/                               # pnpm upstream:fetch 生成，git ignored
│   │       ├── manage.html
│   │       └── assets/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   ├── bootstrap.rs
│   │   ├── commands.rs
│   │   ├── paths.rs
│   │   ├── settings.rs
│   │   ├── tray.rs
│   │   ├── update_check.rs
│   │   ├── platform/
│   │   │   ├── mod.rs
│   │   │   └── macos.rs
│   │   ├── service/
│   │   │   ├── mod.rs
│   │   │   ├── health.rs
│   │   │   ├── logs.rs
│   │   │   ├── manager.rs
│   │   │   ├── ownership.rs
│   │   │   └── state.rs
│   │   └── windows/
│   │       ├── mod.rs
│   │       ├── main.rs
│   │       ├── panel.rs
│   │       └── settings.rs
│   ├── tests/
│   │   ├── fixtures/
│   │   │   └── mock-sidecar.rs
│   │   └── service_manager.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/
│   ├── update_check.test.ts
│   └── upstream_scripts.test.ts
├── LICENSE
├── README.md
├── THIRD_PARTY_NOTICES.md
├── package.json
├── pnpm-lock.yaml
└── upstream-lock.json
```

**代码改动原因：** 该结构把供应链脚本、Rust 宿主、前端 Shell、Tauri capabilities、mock Sidecar 测试和发布流水线分开，符合 V0 边界：Desktop 管生命周期，Panel 保持上游原样。

**当前状态说明：** `src-tauri/binaries/*`、`src-tauri/resources/config.example.yaml` 和 `src-tauri/resources/panel/` 是构建前置产物，不是源码。它们必须由 `pnpm upstream:fetch` 从锁定的 GitHub Release assets 获取，并在提交中保持 ignored。

## 2. 实施总顺序

- [x] Task 1：初始化 Tauri 2 + React + TypeScript 项目骨架
- [x] Task 2：写入项目元数据、License、README 和非官方声明
- [x] Task 3：锁定上游 CliRelay 和 codeProxy Release assets
- [x] Task 4：实现上游资产下载、校验和放置脚本
- [x] Task 5：实现路径、设置和默认配置生成
- [x] Task 6：实现服务状态机和表驱动测试
- [x] Task 7：实现日志轮转、日志脱敏和 Sidecar stdout/stderr 采集
- [x] Task 8：实现进程归属、runtime-state 和残留接管
- [x] Task 9：实现健康检查、Panel ready 判定和 External 探测
- [x] Task 10：实现 Service Manager 启停重启流程
- [x] Task 11：实现 Rust command 白名单和 Settings patch 校验
- [ ] Task 12：实现主窗口、Panel 窗口和 Settings 窗口管理
- [ ] Task 13：实现 React Shell、Status、Settings 和前端 bridge
- [ ] Task 14：实现菜单栏、Dock 恢复和退出行为
- [ ] Task 15：实现 Preview 更新检查
- [ ] Task 16：补齐 mock Sidecar 集成测试 8 个必选场景
- [ ] Task 17：实现 PR CI
- [ ] Task 18：实现 Preview Release CI、Ad Hoc 签名和 DMG smoke
- [ ] Task 19：完成手动验收矩阵和 Release 文案

每个 Task 单独提交。提交信息使用 `feat:`、`test:`、`ci:`、`docs:` 前缀；一项任务包含测试和实现时使用 `feat:`。

---

### Task 1: 初始化项目骨架

**Files:**
- Create: `package.json`
- Create: `src/main.tsx`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Modify: `.gitignore`

**代码改动原因：** 当前仓库只有文档，需要先生成 Tauri 2 桌面应用骨架，后续 Rust host、React Shell、CI 和 Release 任务才能在真实工程中落地。

- [x] **Step 1: 生成临时 Tauri 项目**

```bash
pnpm create tauri-app@latest clirelay-desktop-bootstrap
```

交互选择：

```text
Project name: clirelay-desktop
Identifier: com.martianc.clirelay-desktop
Package manager: pnpm
Frontend language: TypeScript
Frontend framework: React
Frontend template: Vite
```

Expected: 生成 `clirelay-desktop-bootstrap/`，其中包含 `src/`、`src-tauri/`、`package.json`。

- [x] **Step 2: 合并骨架到当前仓库**

```bash
rsync -a clirelay-desktop-bootstrap/ ./
rm -rf clirelay-desktop-bootstrap
```

Expected: 当前仓库根目录出现 `package.json`、`src/`、`src-tauri/`，原有 `docs/dev/` 保留。

- [x] **Step 3: 安装依赖并运行开发启动**

```bash
pnpm install
pnpm tauri dev
```

Expected: Rust 首次编译完成后打开 Tauri 窗口，显示默认 React 页面。

- [x] **Step 4: 首次提交**

```bash
git add package.json pnpm-lock.yaml src src-tauri .gitignore
git commit -m "feat: scaffold tauri desktop app"
```

Expected: 提交只包含项目骨架，不包含业务逻辑。

### Task 2: 写入项目元数据与声明

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Create: `LICENSE`
- Create: `README.md`
- Create: `THIRD_PARTY_NOTICES.md`

**代码改动原因：** 产品计划要求 Preview 不冒充官方版，Bundle ID 与未来 Stable 复用，Release 资产和 About 信息都需要稳定元数据。

- [x] **Step 1: 设置 package 元数据和脚本**

在 `package.json` 中确保脚本包含：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint ."
  }
}
```

Expected: `pnpm typecheck` 能执行 TypeScript 检查。

- [x] **Step 2: 设置 Tauri 产品信息**

在 `src-tauri/tauri.conf.json` 中设置：

```json
{
  "productName": "CliRelay Desktop",
  "version": "0.0.1-preview.1",
  "identifier": "com.martianc.clirelay-desktop",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:5174",
    "frontendDist": "../dist"
  },
  "bundle": {
    "active": true,
    "targets": ["dmg"],
    "externalBin": ["binaries/clirelay"],
    "macOS": {
      "minimumSystemVersion": "13.0"
    }
  }
}
```

Expected: `pnpm tauri dev` 继续能启动；若 `externalBin` 因 Sidecar 尚未放置而影响构建，在 Task 4 完成后再运行 `pnpm tauri build`。

- [x] **Step 3: 写 README 非官方声明**

`README.md` 至少包含：

```markdown
# CliRelay Desktop

CliRelay Desktop is an independent, unofficial desktop companion for CliRelay.
It is not affiliated with or maintained by the CliRelay project authors.

V0 Preview is ad-hoc signed and not notarized by Apple. It is intended for technical preview testing on macOS Apple Silicon.

V0 Preview bundles locked upstream release assets for CliRelay and codeProxy. codeProxy is included so the management panel can load from local packaged resources instead of relying on runtime GitHub REST API downloads.
```

Expected: README 明确 Preview、非官方、未公证，并说明 codeProxy 随包内置的原因。

- [x] **Step 4: 添加 MIT License 和 notices 初始内容**

`THIRD_PARTY_NOTICES.md` 首版包含：

```markdown
# Third Party Notices

This file is generated for each Preview release by `scripts/generate-notices.ts`.

Bundled upstream component:

- CliRelay v0.4.0, https://github.com/kittors/CliRelay
- codeProxy v0.4.0, https://github.com/kittors/codeProxy
```

Expected: Release CI 后续会更新依赖清单，但首版已经声明内置上游组件。

- [x] **Step 5: 验证并提交**

```bash
pnpm typecheck
git add package.json src-tauri/tauri.conf.json LICENSE README.md THIRD_PARTY_NOTICES.md
git commit -m "feat: define preview app metadata"
```

Expected: `pnpm typecheck` 通过。

### Task 3: 锁定上游 CliRelay 和 codeProxy Release assets

**Files:**
- Create: `upstream-lock.json`
- Create: `docs/dev/upstream-locking.md`

**代码改动原因：** V0 发布链只消费上游 Release assets；锁定文件必须让 CI 可校验、可追踪、可阻断，不能在构建时猜测 asset。codeProxy 必须随 Desktop 打包，避免 CliRelay 启动时因 GitHub REST API 请求失败而无法加载 `/manage`。

- [x] **Step 1: 创建 `upstream-lock.json`**

```json
{
  "clirelay": {
    "repository": "https://github.com/kittors/CliRelay",
    "version": "v0.4.0",
    "commit": "8f8bcf4fd24ea6b4d4af2e8da269f00d28442629",
    "assets": {
      "aarch64-apple-darwin": {
        "fileName": "CliRelay_0.4.0_darwin_arm64.tar.gz",
        "downloadUrl": "https://github.com/kittors/CliRelay/releases/download/v0.4.0/CliRelay_0.4.0_darwin_arm64.tar.gz",
        "sha256": "3eea3c2c40a95c9aa16763367ca7c541f5df6a30f517c63b32b899ca0fa34a65",
        "extractedBinaryPath": "cli-proxy-api"
      }
    }
  },
  "codeProxy": {
    "repository": "https://github.com/kittors/codeProxy",
    "version": "v0.4.0",
    "commit": "d9434790bdc4c0b23af1e27265003c270783c7ac",
    "asset": {
      "fileName": "panel-dist.zip",
      "downloadUrl": "https://github.com/kittors/codeProxy/releases/download/v0.4.0/panel-dist.zip",
      "sha256": "92527fdd8b1a31c4d6fc0775266b422db28229357ac79273fed9aebb6709aa5d",
      "entrypoint": "manage.html"
    }
  }
}
```

Expected: 文件只包含 V0 需要的 macOS arm64 CliRelay asset 和 codeProxy panel asset。

- [x] **Step 2: 记录锁定更新流程**

`docs/dev/upstream-locking.md` 写入：

```markdown
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
```

Expected: 后续维护者知道 lock 更新必须独立提交。

- [x] **Step 3: 验证并提交**

```bash
node -e "JSON.parse(require('fs').readFileSync('upstream-lock.json','utf8')); console.log('upstream lock ok')"
git add upstream-lock.json docs/dev/upstream-locking.md
git commit -m "feat: lock upstream release assets"
```

Expected: 输出 `upstream lock ok`。

### Task 4: 实现上游资产下载、校验和放置脚本

**Files:**
- Create: `scripts/fetch-upstream.ts`
- Create: `scripts/verify-checksum.ts`
- Create: `scripts/upstream-common.ts`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Create: `tests/upstream_scripts.test.ts`
- Generated ignored output: `src-tauri/resources/config.example.yaml`
- Generated ignored output: `src-tauri/resources/panel/manage.html`
- Generated ignored output: `src-tauri/resources/panel/assets/`
- Generated ignored output: `src-tauri/binaries/clirelay-aarch64-apple-darwin`

**代码改动原因：** 构建和发布不能依赖手工复制 Sidecar 或运行时 GitHub 下载。脚本必须从 lock 下载、计算 SHA-256、解包 CliRelay 二进制、复制 codeProxy panel 资源、重命名为 Tauri sidecar 目标文件，并复制上游 config example 作为默认配置来源。下载产物属于可复现构建输入，不能提交到 git。

- [x] **Step 1: 添加脚本命令**

`package.json` 添加：

```json
{
  "scripts": {
    "upstream:fetch": "tsx scripts/fetch-upstream.ts",
    "upstream:verify": "tsx scripts/verify-checksum.ts"
  },
  "devDependencies": {
    "tsx": "latest",
    "vitest": "latest"
  }
}
```

Run:

```bash
pnpm install
```

Expected: `tsx` 和 `vitest` 写入 `pnpm-lock.yaml`。

- [x] **Step 2: 实现下载脚本行为**

`scripts/fetch-upstream.ts` 必须完成：

```text
1. 读取 upstream-lock.json。
2. 下载 clirelay.assets.aarch64-apple-darwin asset 到临时目录。
3. 计算 CliRelay archive SHA-256，必须等于 lock 中的 sha256。
4. 解包 tar.gz。
5. 从解包目录取出 cli-proxy-api。
6. 写入 src-tauri/binaries/clirelay-aarch64-apple-darwin。
7. chmod 755。
8. 下载 codeProxy.asset 到临时目录。
9. 计算 codeProxy zip SHA-256，必须等于 lock 中的 sha256。
10. 解包 panel-dist.zip。
11. 将解包后的 manage.html 和 assets/ 写入 src-tauri/resources/panel/。
12. 校验 src-tauri/resources/panel/manage.html 存在。
13. 写入 src-tauri/resources/config.example.yaml。
14. 将 config.example.yaml 中 auto-update.enabled 改为 false。
15. 在 src-tauri/tauri.conf.json 的 bundle.resources 中包含 resources/config.example.yaml 和 resources/panel/**。
16. 确保 src-tauri/binaries/*、src-tauri/resources/config.example.yaml 和 src-tauri/resources/panel/ 被 .gitignore 忽略。
```

Expected: 脚本不会修改 `upstream-lock.json`，也不会要求把下载产物加入 git。

- [x] **Step 3: 实现校验脚本行为**

`scripts/verify-checksum.ts` 必须完成：

```text
1. 读取 upstream-lock.json。
2. 校验 src-tauri/binaries/clirelay-aarch64-apple-darwin 存在且可执行。
3. 计算当前二进制 SHA-256，记录到 stdout。
4. 下载的 archive SHA-256 只与 lock 比较，二进制 SHA-256 写入 build-manifest，不替代 archive SHA-256。
5. 校验 src-tauri/resources/panel/manage.html 存在。
6. 校验 src-tauri/resources/config.example.yaml 中 auto-update.enabled 为 false。
```

Expected: 缺文件、权限错误、panel 缺失、配置未禁用上游自动更新时退出码非 0。

- [x] **Step 4: 添加脚本测试**

`tests/upstream_scripts.test.ts` 覆盖：

```text
1. upstream-lock.json 能被解析。
2. clirelay.assets.aarch64-apple-darwin 包含 fileName、downloadUrl、sha256、extractedBinaryPath。
3. clirelay downloadUrl host 必须是 github.com。
4. clirelay sha256 必须是 64 位十六进制。
5. clirelay extractedBinaryPath 必须是 cli-proxy-api。
6. codeProxy.asset 包含 fileName、downloadUrl、sha256、entrypoint。
7. codeProxy downloadUrl host 必须是 github.com。
8. codeProxy sha256 必须是 64 位十六进制。
9. codeProxy entrypoint 必须是 manage.html。
10. 上游 fetch 输出路径必须被 `.gitignore` 忽略。
```

Run:

```bash
pnpm test tests/upstream_scripts.test.ts
```

Expected: 测试全部通过，并能防止上游产物忽略规则被误删。

- [x] **Step 5: 下载真实上游产物并验证，不提交产物**

```bash
pnpm upstream:fetch
pnpm upstream:verify
git ls-files src-tauri/binaries src-tauri/resources/config.example.yaml src-tauri/resources/panel
git check-ignore -v src-tauri/binaries/clirelay-aarch64-apple-darwin src-tauri/resources/config.example.yaml src-tauri/resources/panel/manage.html src-tauri/resources/panel/assets/panel-chunk.js
git add scripts tests package.json pnpm-lock.yaml upstream-lock.json src-tauri/tauri.conf.json .gitignore
git commit -m "feat: fetch verified upstream assets"
```

Expected: `src-tauri/binaries/clirelay-aarch64-apple-darwin` 存在且可执行，`src-tauri/resources/panel/manage.html` 存在；`git ls-files ...` 无输出，说明上游产物没有被跟踪。

- [x] **Step 6: 移除误跟踪的上游产物**

```bash
git rm --cached -r src-tauri/binaries src-tauri/resources/config.example.yaml src-tauri/resources/panel
git add .gitignore tests/upstream_scripts.test.ts
git commit -m "chore: ignore fetched upstream assets"
```

Expected: 历史修正提交 `c2cad66` 已完成；当前仓库中上游产物只作为 ignored 本地文件存在，可通过 `pnpm upstream:fetch` 重建。

### Task 5: 实现路径、设置和默认配置生成

**Files:**
- Create: `src-tauri/src/paths.rs`
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/settings.rs`
- Test: `src-tauri/src/paths.rs`

**代码改动原因：** Desktop 自身状态必须和上游 runtime 文件隔离，且首次运行要创建禁用上游自更新的 `config.yaml`。

- [x] **Step 1: 定义路径模型**

`paths.rs` 暴露：

```rust
pub struct DesktopPaths {
    pub app_data_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub state_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub log_dir: PathBuf,
    pub desktop_log: PathBuf,
    pub clirelay_log: PathBuf,
    pub settings_file: PathBuf,
    pub runtime_state_file: PathBuf,
    pub config_file: PathBuf,
    pub panel_dir: PathBuf,
}
```

Expected:

```text
runtime_dir = ~/Library/Application Support/CliRelay Desktop/runtime
state_dir = ~/Library/Application Support/CliRelay Desktop/state
log_dir = ~/Library/Logs/CliRelay Desktop
panel_dir = ~/Library/Application Support/CliRelay Desktop/runtime/panel
```

- [x] **Step 2: 定义设置模型**

`settings.rs` 定义：

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopSettings {
    pub schema_version: u32,
    pub first_run_completed: bool,
    pub auto_start_app: bool,
    pub auto_start_service: bool,
    pub open_panel_on_start: bool,
    pub port: u16,
    pub auto_check_new_versions: bool,
    pub last_update_check_at: Option<DateTime<Utc>>,
}
```

默认值：

```text
schema_version = 1
first_run_completed = false
auto_start_app = false
auto_start_service = false
open_panel_on_start = true
port = 8317
auto_check_new_versions = false
last_update_check_at = null
```

- [x] **Step 3: 实现配置创建**

首次创建 `runtime/config.yaml` 时：

```text
1. 从 src-tauri/resources/config.example.yaml 读取内容。
2. 将顶层 port 设置为 DesktopSettings.port。
3. 将 auto-update.enabled 设置为 false。
4. 不修改 remote-management.disable-control-panel，保持 false。
5. 不修改 remote-management.panel-github-repository；运行时优先使用本地 panel 目录，不依赖 GitHub 下载。
6. 不修改 host，保留上游默认。
7. 不生成 auths。
```

Expected: `config.yaml` 中包含 `port: 8317` 和 `auto-update.enabled: false`。

- [x] **Step 3.1: 复制本地 panel 资源**

首次启动或 panel 资源缺失时：

```text
1. 从 Tauri resource 读取 src-tauri/resources/panel/。
2. 复制 manage.html 和 assets/ 到 runtime/panel/。
3. 若复制后 runtime/panel/manage.html 不存在，启动前返回错误。
4. 不在运行时请求 GitHub REST API 拉取 codeProxy。
```

Expected: 无网络环境下，`runtime/panel/manage.html` 仍然存在。

- [x] **Step 4: 添加单元测试**

覆盖：

```text
1. 默认设置序列化后 schema_version 为 1。
2. 端口 1023 被拒绝。
3. 端口 1024 被接受。
4. 端口 65535 被接受。
5. config.yaml 写入后禁用 auto-update。
6. state 文件和 runtime 文件不在同一目录。
7. panel 资源复制后 runtime/panel/manage.html 存在。
```

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml settings
cargo test --manifest-path src-tauri/Cargo.toml paths
```

Expected: Task 5 相关测试通过，其中 `settings` 过滤器 7 个用例，`paths` 过滤器 2 个用例。

- [x] **Step 5: 提交**

```bash
git add src-tauri/src/paths.rs src-tauri/src/settings.rs src-tauri/src/lib.rs
git commit -m "feat: add desktop paths and settings"
```

Expected: 只包含路径、设置、默认配置相关变更。

### Task 6: 实现服务状态机

**Files:**
- Create: `src-tauri/src/service/mod.rs`
- Create: `src-tauri/src/service/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/service/state.rs`

**代码改动原因：** 菜单、窗口、按钮和退出行为都依赖统一状态机；先用表驱动测试固定合法转换，避免 UI 和 Service Manager 各自判断状态。

- [x] **Step 1: 定义核心状态**

`state.rs` 定义：

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Unhealthy,
    External,
    Error,
}
```

同时定义：

```rust
pub enum ServiceEvent {
    StartRequested,
    Ready,
    PortOccupiedExternalConfirmed,
    Timeout,
    ProcessExited,
    StopRequested,
    StopCompleted,
    HealthFailedThreeTimes,
    HealthRestored,
    RestartRequested,
    DisconnectExternal,
    CleanupError,
}
```

- [x] **Step 2: 实现转换函数**

```rust
pub fn transition(status: ServiceStatus, event: ServiceEvent) -> Result<ServiceStatus, StateTransitionError>
```

必须允许：

```text
Stopped + StartRequested -> Starting
Starting + Ready -> Running
Starting + PortOccupiedExternalConfirmed -> External
Starting + Timeout -> Error
Starting + ProcessExited -> Error
Running + HealthFailedThreeTimes -> Unhealthy
Running + ProcessExited -> Error
Running + StopRequested -> Stopping
Unhealthy + HealthRestored -> Running
Unhealthy + RestartRequested -> Stopping
Unhealthy + ProcessExited -> Error
Stopping + StopCompleted -> Stopped
Stopping + Timeout -> Error
External + DisconnectExternal -> Stopped
External + ProcessExited -> Stopped
Error + RestartRequested -> Starting
Error + CleanupError -> Stopped
```

- [x] **Step 3: 添加表驱动测试**

测试表覆盖上面的每一行，并额外覆盖：

```text
1. Starting 时 StopRequested 非法。
2. External 时 StopRequested 非法。
3. Stopped 时 StopRequested 非法。
4. Running 时 StartRequested 非法。
```

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml service::state
```

Expected: 合法转换返回目标状态，非法转换返回 `StateTransitionError`。

- [x] **Step 4: 提交**

```bash
git add src-tauri/src/service src-tauri/src/lib.rs
git commit -m "feat: add service state machine"
```

Expected: 状态机测试通过。

### Task 7: 实现日志轮转与脱敏

**Files:**
- Create: `src-tauri/src/service/logs.rs`
- Modify: `src-tauri/src/service/mod.rs`
- Test: `src-tauri/src/service/logs.rs`

**代码改动原因：** V0 必须分离 Desktop 日志和 CliRelay 原始 stdout/stderr，并避免 Desktop 日志写入 API key、token、cookie 或 authorization header。

- [x] **Step 1: 实现轮转策略**

`logs.rs` 常量：

```rust
pub const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_ROTATED_FILES: usize = 5;
```

轮转顺序：

```text
desktop.log.4 -> desktop.log.5
desktop.log.3 -> desktop.log.4
desktop.log.2 -> desktop.log.3
desktop.log.1 -> desktop.log.2
desktop.log -> desktop.log.1
```

`clirelay.log` 使用同样策略。

- [x] **Step 2: 实现脱敏函数**

```rust
pub fn redact_log_line(input: &str) -> String
```

必须替换：

```text
Authorization: Bearer abc -> Authorization: [REDACTED]
authorization: token -> authorization: [REDACTED]
api_key=abc -> api_key=[REDACTED]
api-key: abc -> api-key: [REDACTED]
cookie: abc -> cookie: [REDACTED]
oauth_token=abc -> oauth_token=[REDACTED]
```

- [x] **Step 3: 添加测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml service::logs
```

Expected:

```text
1. 超过 10MB 时触发轮转。
2. 最多保留 5 个轮转文件。
3. Desktop 日志脱敏 authorization。
4. Desktop 日志脱敏 cookie。
5. CliRelay 原始 stdout/stderr 不在 UI 中读取。
```

- [x] **Step 4: 提交**

```bash
git add src-tauri/src/service/logs.rs src-tauri/src/service/mod.rs
git commit -m "feat: add rotating logs"
```

### Task 8: 实现进程归属和 runtime-state

**Files:**
- Create: `src-tauri/src/service/ownership.rs`
- Modify: `src-tauri/src/service/mod.rs`
- Test: `src-tauri/src/service/ownership.rs`

**代码改动原因：** Desktop 只能停止自己拥有的 Sidecar。端口冲突、崩溃恢复和退出清理都必须先通过归属证据。

- [x] **Step 1: 定义 runtime-state**

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeState {
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub executable_path: PathBuf,
    pub executable_sha256: String,
    pub port: u16,
    pub desktop_version: String,
    pub launch_id: Uuid,
}
```

- [x] **Step 2: 定义归属证据**

```rust
pub enum ProcessOwnership {
    Owned,
    External,
    Stale,
    Unknown,
}
```

`Owned` 必须同时满足：

```text
1. PID 存在。
2. PID 启动时间匹配 runtime-state。
3. 可执行路径匹配 App 内 Sidecar。
4. 可执行 SHA-256 匹配。
```

- [x] **Step 3: 实现 macOS 查询**

`platform/macos.rs` 提供：

```rust
pub fn process_started_at(pid: u32) -> Result<DateTime<Utc>>;
pub fn process_executable_path(pid: u32) -> Result<PathBuf>;
pub fn terminate_pid(pid: u32) -> Result<()>;
pub fn kill_pid(pid: u32) -> Result<()>;
```

Expected: `terminate_pid` 只发送 SIGTERM，`kill_pid` 只发送 SIGKILL，调用方必须先确认 `Owned`。

- [x] **Step 4: 添加测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml service::ownership
```

Expected:

```text
1. PID 不存在 -> Stale。
2. 路径不匹配 -> External。
3. SHA-256 不匹配 -> External。
4. 四项证据匹配 -> Owned。
```

- [x] **Step 5: 提交**

```bash
git add src-tauri/src/service/ownership.rs src-tauri/src/platform src-tauri/src/service/mod.rs
git commit -m "feat: add sidecar ownership checks"
```

### Task 9: 实现健康检查、Panel ready 和 External 探测

**Files:**
- Create: `src-tauri/src/service/health.rs`
- Modify: `src-tauri/src/service/mod.rs`
- Test: `src-tauri/src/service/health.rs`

**代码改动原因：** Desktop 不能只判断进程存在，还要区分 TCP 可达、HTTP 可达、`/manage` ready、端口被未知服务占用和可确认 External CliRelay。

- [x] **Step 1: 定义检查结果**

```rust
pub enum HealthStatus {
    TcpClosed,
    HttpReachable,
    ManageReady,
    ManageTimeout,
}

pub enum PortProbe {
    Free,
    OccupiedCliRelayLike,
    OccupiedUnknown,
}
```

- [x] **Step 2: 实现启动 ready 超时**

```text
HTTP ready timeout = 20 秒
Panel ready timeout = 40 秒
单次请求 timeout = 1 秒
Running 健康检查间隔 = 5 秒
连续失败阈值 = 3 次
```

- [x] **Step 3: 实现 Panel ready 规则**

接受：

```text
GET /manage -> 200 HTML
GET /manage -> 301/302 到 /manage/login
GET /manage/login -> 200 HTML
```

不接受：

```text
TCP 可连接但 HTTP 无响应
HTTP 根路径可达但 /manage 超时
非 HTML 响应
```

- [x] **Step 4: 添加测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml service::health
```

Expected:

```text
1. 空闲端口返回 Free。
2. 未知 HTTP 服务返回 OccupiedUnknown。
3. /manage 可访问返回 OccupiedCliRelayLike。
4. /manage 302 到 /manage/login 时 Panel ready。
5. 连续 3 次健康失败产生 Unhealthy 信号。
```

- [x] **Step 5: 提交**

```bash
git add src-tauri/src/service/health.rs src-tauri/src/service/mod.rs
git commit -m "feat: add sidecar health checks"
```

### Task 10: 实现 Service Manager

**Files:**
- Create: `src-tauri/src/service/manager.rs`
- Modify: `src-tauri/src/service/mod.rs`
- Modify: `src-tauri/src/service/ownership.rs`
- Test: `src-tauri/tests/service_manager.rs`

**代码改动原因：** Host 是生命周期唯一权威，Bootstrap/Status 和菜单都只能发起动作，不能自行启动或停止 Sidecar。

- [x] **Step 1: 定义服务快照**

```rust
#[derive(Clone, Debug, Serialize)]
pub struct ServiceSnapshot {
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub port: u16,
    pub endpoint: String,
    pub panel_url: String,
    pub started_at: Option<DateTime<Utc>>,
    pub last_exit_code: Option<i32>,
    pub last_error: Option<String>,
    pub ownership: ProcessOwnership,
    pub clirelay_version: String,
    pub sidecar_sha256: String,
}
```

- [x] **Step 2: 实现启动流程**

`start_service()` 顺序：

```text
1. 如果当前不是 Stopped 或 Error，返回状态错误。
2. 确保路径和默认 config.yaml 存在。
3. 检查端口。
4. 端口空闲时启动 App 内 Sidecar。
5. 工作目录设置为 runtime/。
6. stdout/stderr 写入 clirelay.log。
7. 写 runtime-state.json。
8. 等待 HTTP ready。
9. 等待 /manage ready。
10. 状态进入 Running。
```

- [x] **Step 3: 实现停止流程**

`stop_service()` 顺序：

```text
1. 只允许 owned Running 或 owned Unhealthy。
2. 状态进入 Stopping。
3. 发送 SIGTERM。
4. 等待 5 秒。
5. 未退出时发送 SIGKILL。
6. 再等待 2 秒。
7. 删除 stale runtime-state。
8. 状态进入 Stopped。
```

- [x] **Step 4: 实现 External 临时连接**

`connect_external()` 只在用户确认后调用：

```text
1. 端口必须探测为 OccupiedCliRelayLike。
2. 状态进入 External。
3. 不写 runtime-state。
4. 不允许 stop/restart。
5. 退出 Desktop 时不影响外部进程。
```

- [x] **Step 5: 添加最小集成测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test service_manager
```

Expected:

```text
1. mock Sidecar 延迟 ready 后进入 Running。
2. mock Sidecar 立即退出后进入 Error。
3. stop_service 能让 mock Sidecar 退出并释放端口。
4. External CliRelay-like 端口可连接但不会被 Desktop 接管或停止。
```

- [x] **Step 6: 提交**

```bash
git add src-tauri/src/service/manager.rs src-tauri/tests/service_manager.rs src-tauri/src/service/mod.rs
git commit -m "feat: manage sidecar lifecycle"
```

### Task 11: 实现 Rust commands 与 Settings patch 校验

**Files:**
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/capabilities/shell.json`
- Create: `src-tauri/capabilities/settings.json`
- Create: `src-tauri/capabilities/panel.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/service/manager.rs`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Delete: `src-tauri/capabilities/default.json`
- Test: `src-tauri/src/commands.rs`

**代码改动原因：** 前端不能传 PID、路径、URL 或任意配置字段。命令白名单和 Rust 端校验是 Panel 零权限与 Shell 最小权限的核心。

- [x] **Step 1: 暴露命令白名单**

只注册：

```text
get_service_snapshot
start_service
stop_service
restart_service
open_panel
open_settings
open_log_directory
open_data_directory
copy_endpoint
copy_v1_endpoint
get_desktop_settings
update_desktop_settings
check_for_updates
```

- [x] **Step 2: 固定无参数路径命令**

```text
open_data_directory() 不接受路径参数。
open_log_directory() 不接受路径参数。
copy_endpoint() 不接受 URL 参数。
copy_v1_endpoint() 不接受 URL 参数。
```

生成地址：

```text
http://127.0.0.1:{port}
http://127.0.0.1:{port}/v1
```

- [x] **Step 3: 实现 Settings patch 白名单**

只允许：

```text
auto_start_app
auto_start_service
open_panel_on_start
port
auto_check_new_versions
```

拒绝：

```text
first_run_completed
schema_version
channel
data_dir
runtime_state
```

端口修改条件：

```text
服务状态必须是 Stopped。
端口范围必须是 1024-65535。
```

- [x] **Step 4: 配置 capabilities**

要求：

```text
shell.json 只绑定 Shell/Status webview。
settings.json 只绑定 Settings window。
panel.json 不授予 Tauri invoke、shell、fs、clipboard、process 权限。
Panel 页面不加载 @tauri-apps/api。
```

Panel 验收方式：

```text
在 Panel DevTools 控制台执行 window.__TAURI_INTERNALS__，应不可用或无法调用 Desktop commands。
```

- [x] **Step 5: 添加测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands
```

Expected:

```text
1. Running 时修改 port 被拒绝。
2. Stopped 时修改 8318 成功。
3. patch first_run_completed 被拒绝。
4. copy_endpoint 使用当前状态端口生成 URL。
```

- [x] **Step 6: 提交**

```bash
git add src-tauri/src/commands.rs src-tauri/capabilities src-tauri/src/lib.rs src-tauri/src/service/manager.rs src/App.tsx src/App.css
git commit -m "feat: add safe desktop commands"
```

### Task 12: 实现窗口管理

**Files:**
- Create: `src-tauri/src/windows/mod.rs`
- Create: `src-tauri/src/windows/main.rs`
- Create: `src-tauri/src/windows/panel.rs`
- Create: `src-tauri/src/windows/settings.rs`
- Modify: `src-tauri/src/bootstrap.rs`
- Modify: `src-tauri/src/lib.rs`

**代码改动原因：** 用户感知是单主窗口，但 Shell/Status 与 Panel 必须安全隔离。Settings 是独立普通窗口并保持单实例。

- [ ] **Step 1: 实现主窗口规则**

主窗口：

```text
default size = 1200 x 800
min size = 900 x 600
关闭按钮隐藏窗口，不停止服务
保存最后位置和尺寸
外接屏位置失效时居中
```

- [ ] **Step 2: 实现 Panel WebView**

Panel URL：

```text
http://127.0.0.1:{port}/manage
```

创建规则：

```text
1. 只有 Panel ready 后创建或显示。
2. Panel 使用零权限 capability。
3. Panel 导航只允许 127.0.0.1:{current-port} 和 localhost:{current-port}。
4. 外部 HTTPS 链接用系统浏览器打开。
5. file://、外部 HTTP、其他 localhost 端口默认阻止。
```

- [ ] **Step 3: 实现 Settings 单实例**

Settings：

```text
default size = 720 x 560
重复打开时聚焦现有窗口
不嵌入 Panel
使用 settings capability
```

- [ ] **Step 4: 实现 Dock 恢复规则**

Dock 点击：

```text
Running 且上次用户在 Panel -> 恢复 Panel
Running 且上次用户在 Status -> 恢复 Status
Starting/Unhealthy/Error/External/Stopped -> 显示 Status
Dock 点击不隐式启动服务
```

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/windows src-tauri/src/bootstrap.rs src-tauri/src/lib.rs
git commit -m "feat: manage desktop windows"
```

### Task 13: 实现 React Shell、Status、Settings 和 bridge

**Files:**
- Create: `src/bridge/types.ts`
- Create: `src/bridge/commands.ts`
- Create: `src/stores/serviceStore.ts`
- Create: `src/stores/settingsStore.ts`
- Create: `src/components/StatusView.tsx`
- Create: `src/components/SettingsView.tsx`
- Create: `src/components/FieldRow.tsx`
- Create: `src/styles/app.css`
- Modify: `src/main.tsx`
- Modify: `src/app/App.tsx`

**代码改动原因：** V0 Shell UI 只展示状态和恢复路径，不复制上游 `/manage` 功能；Settings 只覆盖计划允许的 General、Service、Update、About 区块。

- [ ] **Step 1: 定义前端类型**

`src/bridge/types.ts` 与 Rust JSON 对齐：

```ts
export type ServiceStatus =
  | "Stopped"
  | "Starting"
  | "Running"
  | "Stopping"
  | "Unhealthy"
  | "External"
  | "Error";

export interface ServiceSnapshot {
  status: ServiceStatus;
  pid: number | null;
  port: number;
  endpoint: string;
  panelUrl: string;
  startedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  ownership: "Owned" | "External" | "Stale" | "Unknown";
  clirelayVersion: string;
  codeProxyVersion: string;
  sidecarSha256: string;
}
```

- [ ] **Step 2: 封装 command bridge**

`commands.ts` 只导出白名单函数，不暴露通用 `invoke`：

```ts
export async function getServiceSnapshot(): Promise<ServiceSnapshot>;
export async function startService(): Promise<ServiceSnapshot>;
export async function stopService(): Promise<ServiceSnapshot>;
export async function restartService(): Promise<ServiceSnapshot>;
export async function openPanel(): Promise<void>;
export async function openSettings(): Promise<void>;
export async function openLogDirectory(): Promise<void>;
export async function openDataDirectory(): Promise<void>;
export async function copyEndpoint(): Promise<void>;
export async function copyV1Endpoint(): Promise<void>;
export async function getDesktopSettings(): Promise<DesktopSettings>;
export async function updateDesktopSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
export async function checkForUpdates(): Promise<UpdateCheckResult>;
```

- [ ] **Step 3: 实现 StatusView**

必须显示：

```text
当前状态
当前端口
PID
Endpoint
Panel URL
最近退出码
错误摘要
打开数据目录
打开日志目录
启动/停止/重启按钮
External 确认选择：连接现有服务 / 更改端口 / 取消
```

不显示：

```text
日志原文
独立 Diagnostics 页面
独立 About 页面
上游 provider/account/model 管理功能
```

- [ ] **Step 4: 实现 SettingsView**

区块：

```text
General: 登录时启动 Desktop、启动后自动启动服务、启动时打开管理面板
Service: 状态、端口、数据目录、日志目录、Desktop 版本、CliRelay 版本、Sidecar SHA-256
Update: Preview 通道、自动检查开关、手动检查、最新结果、GitHub Release 按钮、最后检查时间
About: App 名称、版本、Channel、上游项目链接、License、非官方声明
```

端口输入规则：

```text
Running/Starting/Unhealthy/External 时禁用。
Stopped 时允许 1024-65535。
保存失败时显示 Rust 返回的短错误。
```

- [ ] **Step 5: 运行前端检查**

```bash
pnpm typecheck
pnpm test
```

Expected: TypeScript 和前端测试通过。

- [ ] **Step 6: 提交**

```bash
git add src
git commit -m "feat: add desktop shell ui"
```

### Task 14: 实现菜单栏、Dock 和退出行为

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/bootstrap.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/tray.rs`

**代码改动原因：** V0 关闭主窗口后服务继续运行，菜单栏是服务管理入口；退出 Desktop 必须停止 owned Sidecar，不能影响 External。

- [ ] **Step 1: 实现菜单结构**

菜单顺序：

```text
CliRelay ● 运行中
打开管理面板
显示状态
设置
复制 API Base URL
复制 OpenAI /v1 URL
启动服务
停止服务
重新启动
打开数据目录
打开日志目录
退出 CliRelay Desktop
```

- [ ] **Step 2: 实现动作启用规则**

```text
Stopped: 启动启用，停止禁用，重启禁用
Starting: 三个服务动作全部禁用
Running owned: 启动禁用，停止启用，重启启用
Unhealthy owned: 启动禁用，停止启用，重启启用
Error: 启动启用，停止禁用，重启启用
Stopping: 三个服务动作全部禁用
External: 启动禁用，停止禁用，重启禁用，复制地址启用
```

- [ ] **Step 3: 实现退出 Desktop**

```text
1. owned Running/Unhealthy -> 先 stop_service。
2. 停止成功 -> 退出 App。
3. 停止失败 -> 显示 Status，不静默退出。
4. External -> 直接退出，不停止端口上的进程。
5. Stopped/Error -> 直接退出。
```

- [ ] **Step 4: 添加测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml tray
```

Expected: 每个状态下菜单项启用规则符合表格。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/tray.rs src-tauri/src/bootstrap.rs src-tauri/src/lib.rs
git commit -m "feat: add tray lifecycle controls"
```

### Task 15: 实现 Preview 更新检查

**Files:**
- Create: `src-tauri/src/update_check.rs`
- Create: `tests/update_check.test.ts`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/bridge/types.ts`
- Modify: `src/components/SettingsView.tsx`

**代码改动原因：** V0 只检查新版本，不自动下载或安装；所有 URL 必须固定来源并走白名单。

- [ ] **Step 1: 定义更新源**

常量：

```text
LATEST_PREVIEW_URL = https://martianc.github.io/CliRelay-Desktop/latest-preview.json
ALLOWED_RELEASE_HOST = github.com
ALLOWED_RELEASE_PATH_PREFIX = /MartianC/CliRelay-Desktop/releases/
ALLOWED_PAGES_HOST = martianc.github.io
ALLOWED_PAGES_PATH = /CliRelay-Desktop/latest-preview.json
```

- [ ] **Step 2: 定义 JSON 结构**

```rust
pub struct LatestPreview {
    pub channel: String,
    pub version: String,
    pub released_at: DateTime<Utc>,
    pub minimum_macos: String,
    pub clirelay_version: String,
    pub release_notes_summary: Vec<String>,
    pub release_url: Url,
    pub download_url: Url,
    pub sha256: String,
}
```

必须验证：

```text
channel == preview
version 是 SemVer prerelease
release_url 在 MartianC/CliRelay-Desktop releases 白名单内
download_url 在 MartianC/CliRelay-Desktop releases/download 白名单内
release_notes_summary 按纯文本处理
sha256 是 64 位十六进制
```

- [ ] **Step 3: 实现自动检查频率**

```text
auto_check_new_versions 默认 false
用户开启后 App 启动延迟检查一次
自动检查每天最多一次
手动检查不受频率限制
自动检查失败只写 desktop.log
手动检查失败显示在 Update 区
```

- [ ] **Step 4: 添加测试**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml update_check
pnpm test tests/update_check.test.ts
```

Expected:

```text
1. 0.0.1-preview.2 大于 0.0.1-preview.1。
2. Stable 版本不会被 Preview 通道接受。
3. 非 github.com 下载 URL 被拒绝。
4. release notes 不按 HTML 渲染。
```

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/update_check.rs src-tauri/src/commands.rs src/bridge src/components tests/update_check.test.ts
git commit -m "feat: add preview update checks"
```

### Task 16: 补齐 mock Sidecar 集成测试

**Files:**
- Create: `src-tauri/tests/fixtures/mock-sidecar.rs`
- Modify: `src-tauri/tests/service_manager.rs`
- Modify: `src-tauri/Cargo.toml`

**代码改动原因：** PR CI 不能依赖真实 CliRelay Release。mock Sidecar 用来稳定覆盖状态机、ready、端口冲突、停止和强杀路径。

- [ ] **Step 1: 实现 fixture 模式**

`mock-sidecar.rs` 支持：

```text
--port 8317
--mode delayed-ready
--mode exit-immediately
--mode manage-timeout
--mode unhealthy-after-ready
--mode ignore-sigterm
--ready-delay-ms 800
```

响应：

```text
GET /manage -> 200 text/html for delayed-ready
GET /manage -> no response for manage-timeout
GET / -> 200 text/plain for HTTP reachable cases
```

- [ ] **Step 2: 覆盖 8 个必选场景**

`service_manager.rs` 测试：

```text
1. 延迟启动后 /manage ready。
2. 启动后立即退出。
3. 端口被未知进程占用。
4. /manage 超时但 HTTP 可达。
5. Running 后连续 3 次健康失败进入 Unhealthy。
6. Unhealthy 后健康恢复为 Running，但不自动切 Panel。
7. SIGTERM 正常退出。
8. SIGTERM 超时后 SIGKILL。
```

- [ ] **Step 3: 运行集成测试**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test service_manager -- --nocapture
```

Expected: 8 个场景全部通过，测试结束后端口释放。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/tests src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "test: cover sidecar lifecycle scenarios"
```

### Task 17: 实现 PR CI

**Files:**
- Create: `.github/workflows/ci.yml`

**代码改动原因：** PR CI 需要在不下载真实上游 asset 的情况下验证前端、Rust、状态机和 mock Sidecar 行为。

- [ ] **Step 1: 创建 CI workflow**

`ci.yml` 触发：

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

运行平台：

```yaml
runs-on: macos-14
```

步骤：

```text
1. checkout
2. setup pnpm
3. setup node
4. setup rust stable
5. pnpm install --frozen-lockfile
6. pnpm lint
7. pnpm typecheck
8. pnpm test
9. cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
10. cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
11. cargo test --manifest-path src-tauri/Cargo.toml
12. cargo test --manifest-path src-tauri/Cargo.toml --test service_manager
```

- [ ] **Step 2: 验证本地命令**

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test service_manager
```

Expected: 所有命令通过。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add preview pr checks"
```

### Task 18: 实现 Preview Release CI

**Files:**
- Create: `.github/workflows/preview-release.yml`
- Create: `scripts/generate-build-manifest.ts`
- Create: `scripts/generate-latest-preview.ts`
- Modify: `scripts/generate-notices.ts`
- Modify: `package.json`

**代码改动原因：** V0 Preview 必须自动下载并校验上游 asset、Ad Hoc 签名、生成 DMG、checksums、manifest、latest-preview，并创建 GitHub prerelease。

- [ ] **Step 1: 添加 release 脚本**

`package.json` 添加：

```json
{
  "scripts": {
    "release:manifest": "tsx scripts/generate-build-manifest.ts",
    "release:latest-preview": "tsx scripts/generate-latest-preview.ts",
    "release:notices": "tsx scripts/generate-notices.ts"
  }
}
```

- [ ] **Step 2: 实现 build-manifest**

`build-manifest.json` 由脚本生成，字段来源固定为：

| 字段 | 来源 |
|---|---|
| `channel` | 字面量 `preview` |
| `desktopVersion` | `src-tauri/tauri.conf.json` 的 `version` |
| `desktopCommit` | CI 环境变量 `GITHUB_SHA` |
| `clirelayVersion` | `upstream-lock.json` |
| `clirelayCommit` | `upstream-lock.json` |
| `clirelayAssetUrl` | `upstream-lock.json` |
| `clirelayAssetSha256` | `upstream-lock.json` |
| `codeProxyVersion` | `upstream-lock.json` |
| `codeProxyCommit` | `upstream-lock.json` |
| `codeProxyAssetUrl` | `upstream-lock.json` |
| `codeProxyAssetSha256` | `upstream-lock.json` |
| `bundleIdentifier` | `src-tauri/tauri.conf.json` 的 `identifier` |
| `signing` | 字面量 `ad-hoc` |
| `notarized` | 布尔值 `false` |
| `runner` | CI runner 名称，Preview 固定为 `macos-14` |
| `builtAt` | 脚本运行时生成的 UTC ISO-8601 时间 |
| `artifacts.dmg.file` | `CliRelay-Desktop_0.0.1-preview.1_aarch64.dmg` |
| `artifacts.dmg.sha256` | `shasum -a 256` 对 DMG 的计算结果 |

Expected: 脚本输出的 manifest 不包含空字符串，不包含 `null`，不从网络读取 Desktop 元数据。

- [ ] **Step 3: 实现 latest-preview**

`latest-preview.json` 由脚本生成，字段来源固定为：

| 字段 | 来源 |
|---|---|
| `channel` | 字面量 `preview` |
| `version` | `src-tauri/tauri.conf.json` 的 `version` |
| `releasedAt` | 脚本运行时生成的 UTC ISO-8601 时间 |
| `minimumMacos` | 字面量 `13.0` |
| `clirelayVersion` | `upstream-lock.json` |
| `codeProxyVersion` | `upstream-lock.json` |
| `releaseNotesSummary` | 固定三行 Preview 摘要 |
| `releaseUrl` | `https://github.com/MartianC/CliRelay-Desktop/releases/tag/v0.0.1-preview.1` |
| `downloadUrl` | `https://github.com/MartianC/CliRelay-Desktop/releases/download/v0.0.1-preview.1/CliRelay-Desktop_0.0.1-preview.1_aarch64.dmg` |
| `sha256` | `shasum -a 256` 对 DMG 的计算结果 |

固定三行 Preview 摘要：

```text
首个 macOS Apple Silicon 技术预览版
内置 CliRelay v0.4.0 和 codeProxy v0.4.0 Release assets
使用 Ad Hoc 签名，未经过 Apple 公证
```

- [ ] **Step 4: 创建 Release workflow**

触发：

```yaml
on:
  workflow_dispatch:
  push:
    tags:
      - "v0.0.*-preview.*"
```

权限：

```yaml
permissions:
  contents: write
```

步骤：

```text
1. checkout
2. setup pnpm/node/rust
3. pnpm install --frozen-lockfile
4. pnpm upstream:fetch
5. pnpm upstream:verify
6. pnpm lint
7. pnpm typecheck
8. pnpm test
9. cargo test --manifest-path src-tauri/Cargo.toml
10. pnpm tauri build
11. codesign --force --deep --sign - --timestamp=none "src-tauri/target/release/bundle/macos/CliRelay Desktop.app"
12. codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/CliRelay Desktop.app"
13. spctl --assess --type execute --verbose=4 "src-tauri/target/release/bundle/macos/CliRelay Desktop.app" || true
14. 找到 DMG 并重命名为 CliRelay-Desktop_0.0.1-preview.1_aarch64.dmg
15. hdiutil attach DMG，确认 .app、CliRelay sidecar 和 codeProxy panel 资源存在
16. shasum -a 256 生成 checksums.txt
17. pnpm release:manifest
18. pnpm release:latest-preview
19. pnpm release:notices
20. gh release create v0.0.1-preview.1 --prerelease 上传 DMG、checksums、manifest、latest-preview、notices
21. 更新 gh-pages 分支的 latest-preview.json
```

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/preview-release.yml scripts package.json pnpm-lock.yaml
git commit -m "ci: add preview release pipeline"
```

### Task 19: 完成手动验收矩阵和 Release 文案

**Files:**
- Create: `docs/dev/V0_Preview_手动验收清单.md`
- Create: `docs/dev/V0_Preview_Release_说明模板.md`
- Modify: `README.md`

**代码改动原因：** Ad Hoc Preview 的安装、放行、日志敏感信息和 Release 不可变规则必须写清楚，否则技术预览用户会把未公证阻断误判为构建失败。

- [ ] **Step 1: 写手动验收清单**

`docs/dev/V0_Preview_手动验收清单.md` 包含：

```text
1. 首次启动。
2. 首次点击“启动 CliRelay”。
3. 关闭主窗口后菜单栏仍可控制。
4. 退出 Desktop 停止 owned Sidecar。
5. External 端口冲突确认。
6. Settings 修改端口。
7. 检查新版本。
8. 打开数据目录。
9. 打开日志目录。
10. OAuth 代表路径。
11. /manage 主要页面加载。
12. 路径含中文和空格。
13. 深色和浅色模式。
14. 无网络环境。
15. 代理或受限网络环境。
16. 休眠和唤醒。
```

每一项记录：

```text
测试日期
macOS 版本
设备架构
Desktop 版本
CliRelay 版本
codeProxy 版本
结果
备注
```

- [ ] **Step 2: 写 Release 说明模板**

`docs/dev/V0_Preview_Release_说明模板.md` 顶部包含：

```markdown
Preview build notice:
This build is ad-hoc signed and not notarized by Apple.
On first launch, macOS may block it. Use System Settings -> Privacy & Security -> Open Anyway, or right-click the app and choose Open.
Only install if you trust this project and the downloaded checksum matches.

预览版提示：
此构建使用 Ad Hoc 签名，未经过 Apple 公证。
首次启动时 macOS 可能阻止运行。请在 系统设置 -> 隐私与安全性 中选择仍要打开，或右键 App 后选择打开。
只有在你信任本项目且下载文件校验值匹配时才安装。
```

Release 资产列表固定为：

```text
CliRelay-Desktop_0.0.1-preview.1_aarch64.dmg
checksums.txt
build-manifest.json
latest-preview.json
THIRD_PARTY_NOTICES.md
```

- [ ] **Step 3: 补充 README 使用说明**

README 增加：

```text
1. V0 Preview 只支持 macOS Apple Silicon。
2. 使用 Ad Hoc 签名，未公证。
3. 首次运行可能需要手动放行。
4. 日志目录可能包含敏感信息，分享前自行检查。
5. Desktop 不修改、不 fork 上游 CliRelay 或 codeProxy。
6. Desktop 内置已锁定 codeProxy panel 资源，避免运行时依赖 GitHub REST API 下载管理面板。
```

- [ ] **Step 4: 提交**

```bash
git add docs/dev/V0_Preview_手动验收清单.md docs/dev/V0_Preview_Release_说明模板.md README.md
git commit -m "docs: add preview release checklist"
```

## 3. 阶段退出门槛

### 阶段 A：技术验证

必须满足：

```text
1. Tauri App 可启动。
2. `pnpm upstream:fetch` 能下载并校验 CliRelay v0.4.0 arm64 asset 和 codeProxy v0.4.0 panel asset。
3. Sidecar 能在 runtime/ 工作目录启动。
4. codeProxy panel 能复制到 runtime/panel/。
5. 无网络或 GitHub REST API 不可用时，/manage 或 /manage/login 仍能在 Panel ready 规则内识别。
6. App 退出能停止 owned Sidecar。
```

推荐提交范围：Task 1 到 Task 4。

当前状态：Task 1 到 Task 4 已完成，已满足上游锁定、下载、校验和本地 ignored 产物恢复能力；本阶段剩余的 Sidecar runtime 启动、panel runtime 复制和 owned Sidecar 退出清理仍待 Task 5、Task 9、Task 10 落地。

### 阶段 B：核心宿主

必须满足：

```text
1. 状态机表驱动测试通过。
2. mock Sidecar 8 个集成场景通过。
3. owned Sidecar 停止不误杀外部进程。
4. 日志轮转和脱敏测试通过。
5. runtime-state stale、External、Owned 三类路径可区分。
```

推荐提交范围：Task 5 到 Task 11。

### 阶段 C：桌面体验

必须满足：

```text
1. 首次启动强制显示主窗口。
2. 首次点击启动后切换到 Panel。
3. 关闭主窗口不停止服务。
4. 菜单栏可启动、停止、重启服务。
5. Settings 单实例。
6. Panel 零权限验收通过。
7. Panel 故障能回到 Status。
```

推荐提交范围：Task 12 到 Task 15。

### 阶段 D：Preview 发布

必须满足：

```text
1. Release CI 下载上游 asset 并校验 SHA-256。
2. `codesign --verify --deep --strict` 通过。
3. `spctl --assess` 只记录，不作为成功条件。
4. DMG 能挂载，.app bundle 存在。
5. Release 标记为 prerelease。
6. Release 页面包含未公证提示。
7. gh-pages/latest-preview.json 更新成功。
```

推荐提交范围：Task 16 到 Task 19。

## 4. 本地验证命令汇总

```bash
pnpm install
pnpm upstream:fetch
pnpm upstream:verify
git ls-files src-tauri/binaries src-tauri/resources/config.example.yaml src-tauri/resources/panel
git check-ignore -v src-tauri/binaries/clirelay-aarch64-apple-darwin src-tauri/resources/config.example.yaml src-tauri/resources/panel/manage.html src-tauri/resources/panel/assets/panel-chunk.js
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test service_manager
pnpm tauri build
```

Preview Release 本地烟测：

```bash
codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/CliRelay Desktop.app"
spctl --assess --type execute --verbose=4 "src-tauri/target/release/bundle/macos/CliRelay Desktop.app" || true
hdiutil attach "src-tauri/target/release/bundle/dmg/CliRelay Desktop_0.0.1-preview.1_aarch64.dmg"
```

Expected:

```text
codesign verify 通过。
spctl 可以失败但输出被记录。
DMG 可挂载并能看到 CliRelay Desktop.app。
```

## 5. 覆盖关系自检

| 原计划章节 | 实施任务 |
|---|---|
| 3 发布通道与版本策略 | Task 2、Task 15、Task 18、Task 19 |
| 4 Ad Hoc 分发策略 | Task 18、Task 19 |
| 5 更新检查 | Task 15 |
| 6 上游 Sidecar 供应链 | Task 3、Task 4、Task 18 |
| 7 数据目录与配置策略 | Task 5、Task 11、Task 13 |
| 8 应用启动模型 | Task 10、Task 12、Task 13 |
| 9 窗口模型 | Task 12、Task 13 |
| 10 菜单栏模型 | Task 14 |
| 11 服务生命周期 | Task 6、Task 8、Task 10、Task 16 |
| 12 健康检查与 ready 判定 | Task 9、Task 16 |
| 13 端口冲突与 External | Task 9、Task 10、Task 13、Task 16 |
| 14 残留进程与归属校验 | Task 8、Task 10、Task 16 |
| 15 安全模型 | Task 11、Task 12、Task 13 |
| 16 导航策略 | Task 12 |
| 17 Settings 设计 | Task 11、Task 13、Task 15 |
| 18 日志策略 | Task 7、Task 14、Task 19 |
| 19 macOS 系统集成 | Task 12、Task 14 |
| 20 UI 设计原则 | Task 13 |
| 21 Rust 模块建议 | Task 5 到 Task 12、Task 14、Task 15 |
| 22 CI/CD | Task 17、Task 18 |
| 23 测试计划 | Task 6、Task 7、Task 8、Task 9、Task 16、Task 17 |
| 24 V0 验收标准 | 阶段退出门槛、Task 19 |
| 25 风险清单 | Task 3、Task 4、Task 8、Task 11、Task 15、Task 18、Task 19 |
| 26 许可证与品牌 | Task 2、Task 19 |
| 27 阶段计划 | 阶段退出门槛 |
| 28 开发启动清单 | Task 1 到 Task 19 |

## 6. 技术参考

- Tauri 2 创建项目：`https://v2.tauri.app/start/create-project/`
- Tauri 2 开发与构建命令：`https://v2.tauri.app/develop/`
- Tauri 2 Sidecar：`https://v2.tauri.app/develop/sidecar/`
- Tauri 2 Capabilities：`https://v2.tauri.app/security/capabilities/`
- Tauri 2 System Tray：`https://v2.tauri.app/learn/system-tray/`
- Tauri GitHub Actions：`https://v2.tauri.app/distribute/pipelines/github/`
