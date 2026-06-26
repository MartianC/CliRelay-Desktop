# CliRelay Desktop

中文 | [English](./README.md)

CliRelay Desktop 是 [CliRelay](https://github.com/kittors/CliRelay) 的独立非官方桌面宿主。它把本地 CliRelay sidecar 和 codeProxy 管理面板打包进 Tauri 桌面应用，让你可以用 macOS 原生窗口和菜单栏启动、停止、监控、配置和更新本地 CliRelay 运行时。

本项目不隶属于 CliRelay 或 codeProxy 官方项目，也不由其作者维护。

## 项目状态

CliRelay Desktop 当前处于 V0 Preview 阶段。预览版面向 macOS Apple Silicon，使用 Ad Hoc 签名，未经过 Apple 公证。请把它视为本地技术预览版本，而不是已经加固的生产发行版。

当前预览版会打包锁定的上游资产，具体版本和校验值记录在 [`upstream-lock.json`](./upstream-lock.json)。

管理面板会优先从本地随包资源加载，尽量避免运行时依赖 GitHub REST API 下载导致启动失败。

## 主要功能

- 管理本地 CliRelay sidecar 生命周期：启动、停止、重启、健康检查和异常恢复。
- 服务就绪后打开内置 `/manage` 管理面板。
- 提供 macOS 菜单栏入口，用于查看服务状态和执行快捷操作。
- 支持导入已有 CliRelay `config.yaml`，也可以从随包示例初始化默认运行配置。
- 打开管理功能前要求设置 management secret。
- 支持配置服务端口、界面语言、登录时启动和静默启动行为。
- 可从设置页直接打开数据目录和日志目录。
- 支持检查 Desktop 预览版更新，以及 CliRelay、codeProxy 上游组件更新。
- 将运行时文件写入用户目录，而不是写入应用包内部。

## 系统要求

运行预览版应用需要：

- macOS 13 或更高版本
- Apple Silicon Mac

本地开发需要：

- Node.js 和 pnpm
- Rust 工具链，兼容 Rust `1.77.2` 或更高版本
- macOS 上的 Tauri 2 系统依赖
- 刷新上游锁定资产时需要网络访问

## 安装预览版

1. 从项目 Release 页面下载最新预览版 DMG。
2. 打开 DMG，把 `CliRelay Desktop.app` 拖入 `Applications`。
3. 启动应用。
4. 由于预览版是 Ad Hoc 签名且未公证，macOS 首次启动时可能阻止运行。请仅在信任构建来源并校验下载文件完整性后继续。
5. 首次运行时，选择导入已有 CliRelay 配置，或初始化随包默认配置。
6. 按提示设置 management secret。
7. 使用管理面板或菜单栏入口启动和管理本地服务。

## 本地开发

安装依赖：

```bash
pnpm install
```

启动前端开发服务器：

```bash
pnpm dev
```

以开发模式启动 Tauri 桌面应用：

```bash
pnpm tauri dev
```

运行检查：

```bash
pnpm typecheck
pnpm test
```

构建前端产物：

```bash
pnpm build
```

构建 macOS DMG：

```bash
pnpm tauri build
```

## 上游资产

锁定的上游版本、下载地址和校验值记录在 [`upstream-lock.json`](./upstream-lock.json)。

更新锁定的上游 Release 元数据：

```bash
pnpm upstream:update
```

指定上游 Release tag：

```bash
pnpm upstream:update -- --clirelay-version vX.Y.Z --codeproxy-version vX.Y.Z
```

拉取并校验随包的 CliRelay sidecar、默认配置和 codeProxy 面板资源：

```bash
pnpm upstream:fetch
```

校验已经拉取到本地的随包资产：

```bash
pnpm upstream:verify
```

拉取后的文件会写入：

- `src-tauri/binaries/clirelay-aarch64-apple-darwin`
- `src-tauri/resources/config.example.yaml`
- `src-tauri/resources/panel/`

## 运行时文件

在 macOS 上，用户数据目录为：

```text
~/Library/Application Support/CliRelay Desktop/
```

重要运行时路径：

- 运行配置：`~/Library/Application Support/CliRelay Desktop/runtime/config.yaml`
- 运行时 sidecar：`~/Library/Application Support/CliRelay Desktop/runtime/sidecar/cli-proxy-api`
- 本地管理面板：`~/Library/Application Support/CliRelay Desktop/runtime/panel/`
- Desktop 设置：`~/Library/Application Support/CliRelay Desktop/state/desktop-settings.json`
- 组件状态：`~/Library/Application Support/CliRelay Desktop/state/component-state.json`
- 备份目录：`~/Library/Application Support/CliRelay Desktop/backups/`

日志目录为：

```text
~/Library/Logs/CliRelay Desktop/
```

## 配置说明

CliRelay Desktop 会在 `127.0.0.1` 启动 sidecar，默认端口为 `8317`。服务停止时，可以在设置页修改端口。

随包默认配置会关闭 CliRelay 面向 Docker 部署路径的自动更新能力。Desktop 运行时的组件更新由应用内的更新流程处理。

API key、供应商凭据、路由、代理、TLS、CORS 等 CliRelay 配置可以通过管理面板维护，也可以从设置页打开数据目录后编辑运行时 `config.yaml`。

## 常见问题

- 如果服务无法启动，先打开状态页，根据推荐操作处理端口占用、外部服务或异常状态。
- 如果默认端口 `8317` 被占用，可以连接已检测到的 CliRelay 类服务，也可以停止占用进程后在设置页更换端口。
- 如果管理面板无法打开，请确认服务已运行，并且 management secret 已设置。
- 如果上游组件更新失败，请从日志目录查看 `desktop.log` 和 `clirelay.log`。
- 如果 macOS 阻止启动预览版，请确认你确实要运行一个 Ad Hoc 签名、未公证的预览构建。

## 项目结构

```text
src/                  React 前端
src-tauri/            Tauri 外壳和 Rust 服务管理逻辑
src-tauri/resources/  随包默认配置和管理面板资源
src-tauri/binaries/   随包 CliRelay sidecar 二进制
scripts/              上游资产拉取和校验脚本
upstream-lock.json    锁定的上游版本、Release 资产和校验值
```

## 安全提示

CliRelay Desktop 会运行一个本地服务，用于代理模型 API 流量并管理凭据。启用远程访问、CORS 来源、TLS、免认证访问或管理端点前，请先审查运行配置。请妥善保管 management secret。

## 许可证和第三方声明

随包上游组件声明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。本桌面应用是独立项目，不代表上游项目背书。

## 友情链接

- [LINUX DO](https://linux.do/)