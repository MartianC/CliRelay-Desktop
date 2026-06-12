# CliRelay Desktop V0 Preview 计划文档

**文档版本：** 0.1  
**文档日期：** 2026-06-12  
**项目阶段：** V0 Preview 技术预览与可分发构建  
**首发平台：** macOS Apple Silicon（arm64）  
**后续平台：** Windows x64、Windows ARM64（远期路线，不进入 V0 验收）  
**建议技术栈：** Tauri 2 + Rust + TypeScript + React + Vite  

---

## 1. 执行摘要

CliRelay Desktop V0 Preview 是 CliRelay 的非官方桌面宿主。它不 fork、不修改、不重新实现 CliRelay 或 codeProxy，而是把固定版本的 CliRelay Release 二进制作为本地 Sidecar 运行，并把固定版本的 codeProxy Release 面板资源打入 App 包，最后在隔离 WebView 中打开上游原始 `/manage` 管理页面。

V0 Preview 的目标不是做正式公开版，而是交付一个可安装、可验证、可迭代的 macOS Apple Silicon 技术预览版。由于当前没有付费 Apple Developer 账号，V0 使用 Ad Hoc 签名，不做 Apple notarization，不承诺 Gatekeeper 无阻碍运行。

V0 的核心价值是验证桌面宿主层：启动、停止、菜单栏、窗口切换、端口冲突、日志文件、上游 Release 锁定和 GitHub prerelease 自动发布。正式的 Developer ID 签名、公证、Stable 通道和无阻碍安装体验留到后续 Public 版本。

### 1.1 V0 核心决策

| 决策项 | V0 结论 |
|---|---|
| 产品阶段 | Preview，不是 Public Stable |
| 上游关系 | 不 fork CliRelay，不 fork codeProxy |
| 上游资产来源 | 只消费上游 GitHub Release assets：CliRelay 二进制和 codeProxy 面板资源 |
| Sidecar 缺失 | 上游 Release 资产或 SHA-256 不完整则阻断发布 |
| 管理界面 | 原样加载 `http://127.0.0.1:<port>/manage` |
| 首发平台 | macOS Apple Silicon |
| 签名 | Ad Hoc 签名 |
| 公证 | V0 不做 Apple notarization |
| GitHub Release | 全部标记为 prerelease |
| 更新 | 仅检查新版本，不自动下载或安装 |
| 更新通道 | Preview 通道，固定读取 `latest-preview.json` |
| App 名称 | `CliRelay Desktop`，不带 Preview 后缀 |
| Bundle ID | 与未来正式版保持同一个 |
| 数据目录 | 固定 Desktop 专属目录，不自动导入旧配置 |
| UI 范围 | 单主窗口视觉模型 + Settings 辅助窗口 |
| 日志 | 只提供打开日志目录，不做日志页 |
| 诊断包 | V0 不提供导出诊断包 |
| Dock | V0 保留 Dock 图标 |

---

## 2. 产品边界

### 2.1 一句话定义

**CliRelay Desktop 是 CliRelay 的非官方本地桌面宿主与生命周期管理器。**

### 2.2 V0 目标

V0 解决以下问题：

1. 用户可以通过 macOS App 启动和停止本地 CliRelay。
2. 用户不需要 Docker、Go、Node.js 或 Rust 才能运行桌面预览版。
3. 服务状态、端口、PID、退出码和日志目录可以在桌面应用中找到。
4. 管理页面继续使用上游原始 `/manage`。
5. 关闭主窗口后服务继续由菜单栏管理。
6. 退出 Desktop 时停止本应用拥有的 Sidecar。
7. Preview 产物可以由 GitHub Actions 自动构建、Ad Hoc 签名和发布。

### 2.3 V0 明确不做

- 不修改 CliRelay 源码。
- 不修改或重新构建 codeProxy 页面；V0 只打包其 Release 产出的 `panel-dist.zip`。
- 不复制 provider、账号、模型、路由等管理功能。
- 不直接读写 CliRelay SQLite 数据库。
- 不自动导入用户已有 CliRelay 配置或 `auths`。
- 不允许自定义数据目录。
- 不提供日志查看页。
- 不提供诊断包导出。
- 不提供独立 Diagnostics 页面。
- 不提供独立 About、Onboarding、Status 页面。
- 不使用 Tauri updater 自动安装更新。
- 不生成 updater 包或 updater 签名文件。
- 不进入 Mac App Store。
- V0 不做 Developer ID 签名和 Apple notarization。
- V0 不支持 Intel Mac、Windows 或 Linux。
- V0 不做系统通知、URL Scheme、WidgetKit、Shortcuts。
- V0 不做隐藏 Dock 图标偏好。

### 2.4 External 模式边界

External 不是一等模式，只是端口冲突时的临时恢复路径。

External 模式允许：

- 用户确认后连接当前端口上的现有 CliRelay。
- 打开 `/manage`。
- 复制 API Base URL 和 `/v1` URL。

External 模式禁止：

- 持久化为 profile。
- 自动连接。
- 停止或重启外部实例。
- 退出 Desktop 时影响外部进程。
- 读取外部实例日志或数据目录。

---

## 3. 发布通道与版本策略

### 3.1 Preview 与 Stable

V0 使用 Preview 通道。所有 Ad Hoc 产物都发布为 GitHub prerelease，不进入 Stable。

Stable 通道保留给未来满足以下条件的版本：

- Developer ID Application 签名。
- Apple notarization。
- Gatekeeper 新用户安装体验通过。
- Stable `latest.json`。

### 3.2 版本号规则

V0 使用 SemVer 预发布版本：

```text
0.0.x-preview.N
```

示例：

```text
0.0.1-preview.1
0.0.1-preview.2
0.0.2-preview.1
```

正式公证版本再进入正式版本线，例如 `0.1.0` 或后续稳定版本。

### 3.3 App 名称与 Bundle ID

应用显示名：

```text
CliRelay Desktop
```

应用名不带 Preview 后缀。Preview 身份通过以下位置表达：

- Settings / About 中的 Channel。
- 版本号中的 `preview`。
- GitHub prerelease 标记。
- Release notes 顶部提示。
- `latest-preview.json`。

Bundle ID 与未来正式版保持同一个，避免 Preview 到 Stable 时出现两套 App、两套数据目录和两套登录项。

---

## 4. Ad Hoc 分发策略

### 4.1 Ad Hoc 的定位

V0 使用 Ad Hoc 签名，只适合技术预览、自用和小范围可信用户测试。它不能替代 Developer ID 签名和 Apple notarization。

V0 不承诺：

- Gatekeeper 无阻碍运行。
- `spctl --assess` 通过。
- 用户不需要手动放行。

V0 必须承诺：

- Bundle 内部签名结构完整。
- DMG 可下载和挂载。
- checksums 可核对。
- Release 明确说明未公证。
- 技术用户按说明可以手动允许运行。

### 4.2 Release 安装提示

每个 Preview Release 的顶部必须包含中英双语提示，至少说明：

```text
Preview build notice:
This build is ad-hoc signed and not notarized by Apple.
On first launch, macOS may block it. Use System Settings -> Privacy & Security -> Open Anyway, or right-click the app and choose Open.
Only install if you trust this project and the downloaded checksum matches.
```

中文说明：

```text
预览版提示：
此构建使用 Ad Hoc 签名，未经过 Apple 公证。
首次启动时 macOS 可能阻止运行。请在 系统设置 -> 隐私与安全性 中选择仍要打开，或右键 App 后选择打开。
只有在你信任本项目且下载文件校验值匹配时才安装。
```

### 4.3 Release 资产

V0 Preview 发布以下资产：

```text
CliRelay-Desktop_<version>_aarch64.dmg
checksums.txt
build-manifest.json
latest-preview.json
THIRD_PARTY_NOTICES.md
```

不发布：

```text
.app.tar.gz
.app.tar.gz.sig
Tauri updater manifest
updater 私钥相关文件
```

### 4.4 Release 不可变

同一个 Desktop 版本不允许覆盖 Release asset。

规则：

- tag 一旦发布，不替换 DMG。
- 不替换 checksums。
- 不替换 build manifest。
- 发现错误时发布新版本号。
- 撤回时标记 release 状态或移除 latest 指向，但修复必须使用新版本。

---

## 5. 更新检查

### 5.1 V0 只检查新版本

V0 不自动下载、不替换 `.app`、不调用 updater install。

检查新版本只做：

1. 请求固定 HTTPS URL 的 `latest-preview.json`。
2. 比较当前 Desktop 版本和最新 Preview 版本。
3. 显示 release notes 摘要。
4. 提供按钮打开 GitHub Release 下载页。

### 5.2 更新源

App 检查固定 URL：

```text
https://<owner>.github.io/<repo>/latest-preview.json
```

每个 GitHub prerelease 也上传一份当次 `latest-preview.json` 快照。固定 URL 由 Release CI 在发布成功后更新到 `gh-pages` 分支。

### 5.3 latest-preview.json

建议结构：

```json
{
  "channel": "preview",
  "version": "0.0.1-preview.2",
  "releasedAt": "2026-06-12T00:00:00Z",
  "minimumMacos": "13.0",
  "clirelayVersion": "v0.4.0",
  "codeProxyVersion": "v0.4.0",
  "releaseNotesSummary": [
    "修复启动失败提示",
    "更新内置 CliRelay 和 codeProxy Release assets"
  ],
  "releaseUrl": "https://github.com/<owner>/<repo>/releases/tag/v0.0.1-preview.2",
  "downloadUrl": "https://github.com/<owner>/<repo>/releases/download/v0.0.1-preview.2/CliRelay-Desktop_0.0.1-preview.2_aarch64.dmg",
  "sha256": "<dmg-sha256>"
}
```

### 5.4 安全约束

V0 不对 `latest-preview.json` 做加密签名校验，但必须满足：

- 使用 HTTPS 固定 URL。
- 不允许远程配置更新源。
- `releaseUrl` 和 `downloadUrl` 必须匹配白名单域名。
- 白名单只允许指定 GitHub repo 或未来官网域名。
- release notes 作为纯文本渲染。
- 不执行 HTML、脚本或远程命令。

### 5.5 Settings 行为

Update 区显示：

- 当前通道：Preview。
- 当前版本。
- 内置 CliRelay 版本。
- 内置 codeProxy 版本。
- 自动检查新版本开关，默认关闭。
- 手动检查按钮。
- 最后检查时间和结果。

自动检查规则：

- 用户开启后，App 启动后延迟检查一次。
- 每天最多自动检查一次。
- 手动检查不受频率限制。
- 自动检查失败不弹窗，只写入 `desktop.log`。
- 手动检查失败只在 Update 区显示简短错误。

---

## 6. 上游资产供应链

### 6.1 只消费上游 Release

V0 正式发布链只使用上游 GitHub Release assets，不从源码构建 CliRelay，也不从源码构建 codeProxy。

如果目标 CliRelay 版本没有 macOS arm64 Release asset，或目标 codeProxy 版本没有 `panel-dist.zip` Release asset，或任一 asset 无法提供可校验 SHA-256，Desktop 发布直接失败。

### 6.2 upstream-lock.json

`upstream-lock.json` 必须锁定精确 asset 信息。

示例：

```json
{
  "clirelay": {
    "repository": "https://github.com/kittors/CliRelay",
    "version": "v0.4.0",
    "commit": "<tag-resolved-commit>",
    "assets": {
      "aarch64-apple-darwin": {
        "fileName": "CliRelay_..._darwin_arm64.tar.gz",
        "downloadUrl": "https://github.com/kittors/CliRelay/releases/download/v0.4.0/...",
        "sha256": "<required>",
        "extractedBinaryPath": "<path-inside-archive-or-file>"
      }
    }
  },
  "codeProxy": {
    "repository": "https://github.com/kittors/codeProxy",
    "version": "v0.4.0",
    "commit": "<tag-resolved-commit>",
    "asset": {
      "fileName": "panel-dist.zip",
      "downloadUrl": "https://github.com/kittors/codeProxy/releases/download/v0.4.0/panel-dist.zip",
      "sha256": "<required>",
      "entrypoint": "manage.html"
    }
  }
}
```

锁定项：

- 上游 repository。
- tag 版本。
- tag 解析后的 commit。
- asset 文件名。
- asset 下载 URL。
- asset SHA-256。
- CliRelay 解包后的二进制相对路径。
- codeProxy 面板入口文件。

### 6.3 校验失败策略

CI 下载每个 asset 后必须计算 SHA-256。

如果实际 SHA-256 与 lock 不一致：

- CI 直接失败。
- 不自动更新 lock。
- 不猜测替代 asset。
- 不继续构建 DMG。

### 6.4 build-manifest.json

每个 Preview Release 必须发布 `build-manifest.json`。

建议结构：

```json
{
  "channel": "preview",
  "desktopVersion": "0.0.1-preview.1",
  "desktopCommit": "<desktop-commit>",
  "clirelayVersion": "v0.4.0",
  "clirelayCommit": "<clirelay-commit>",
  "clirelayAssetUrl": "https://github.com/kittors/CliRelay/releases/download/...",
  "clirelayAssetSha256": "<sha256>",
  "codeProxyVersion": "v0.4.0",
  "codeProxyCommit": "<codeproxy-commit>",
  "codeProxyAssetUrl": "https://github.com/kittors/codeProxy/releases/download/...",
  "codeProxyAssetSha256": "<sha256>",
  "bundleIdentifier": "com.example.clirelay-desktop",
  "signing": "ad-hoc",
  "notarized": false,
  "runner": "macos-14",
  "builtAt": "2026-06-12T00:00:00Z",
  "artifacts": {
    "dmg": {
      "file": "CliRelay-Desktop_0.0.1-preview.1_aarch64.dmg",
      "sha256": "<sha256>"
    }
  }
}
```

V0 不要求 artifact attestation。最低可追踪性由 `build-manifest.json`、`checksums.txt` 和 GitHub Actions run 链接提供。

---

## 7. 数据目录与配置策略

### 7.1 目录结构

V0 使用 Desktop 专属数据目录。

```text
~/Library/Application Support/CliRelay Desktop/
├── runtime/
│   ├── config.yaml
│   ├── auths/
│   └── ...
├── state/
│   ├── desktop-settings.json
│   └── runtime-state.json
└── backups/

~/Library/Logs/CliRelay Desktop/
├── desktop.log
├── desktop.log.1
├── clirelay.log
└── clirelay.log.1
```

`runtime/` 是 CliRelay 的工作目录。Desktop 自己的设置和运行态放在 `state/`，避免与上游文件混在一起。

### 7.2 不导入旧数据

V0 不自动扫描、不自动导入、不自动复用用户已有 CliRelay 配置、Docker volume 或 `auths`。

用户迁移只能通过文档手动完成。应用只提供“打开数据目录”入口。

### 7.3 不允许自定义数据目录

V0 不提供数据目录选择。Settings 只显示固定数据目录并提供打开入口。

原因：

- 避免迁移、权限、外置盘、同步盘和回滚复杂度。
- 减少配置损坏风险。
- 让 Preview 到 Stable 的升级路径保持简单。

### 7.4 首次配置

首次启动时 Desktop 在 `runtime/` 中创建默认 `config.yaml`。

默认配置必须关闭上游自更新：

```yaml
auto-update:
  enabled: false
```

Desktop 不强制设置 `CLIRELAY_LOCALE`，语言交给上游默认和 `/manage` 自身能力。

### 7.5 端口修改

端口是 Desktop 需要理解的最小 CliRelay 配置项。

规则：

- 默认端口：`8317`。
- 允许范围：`1024-65535`。
- 只允许在服务 Stopped 时修改。
- Settings 的 Service 区提供端口编辑。
- Desktop 优先受控写入 `config.yaml` 的端口字段。
- Desktop 只改端口字段，不改监听地址、host、bind address 或其他网络配置。
- 如果无法安全定位端口字段，拒绝保存，并提示用户到 `/manage` 或配置文件中手动修改。

### 7.6 Desktop 不处理监听地址

监听地址属于 CliRelay 配置，Desktop V0 不显示、不编辑、不校验、不警告。

Desktop 自身打开面板和复制地址时统一使用：

```text
http://127.0.0.1:<port>
```

### 7.7 配置损坏

如果用户手动改坏 `config.yaml` 导致 Sidecar 启动失败，Desktop 不自动修复。

V0 提供：

- 错误摘要。
- 打开数据目录。
- 打开日志目录。
- 重新启动。

V0 不提供：

- 自动修复配置。
- 重置数据目录。
- 清空配置按钮。
- 内置配置编辑器。

### 7.8 Preview 到 Stable

Preview 和未来 Stable 复用同一个 Bundle ID 和数据目录。

未来 Stable 首次检测到 Preview 数据时：

- 读取 `schemaVersion`。
- 备份用户数据到 `backups/pre-stable-<timestamp>/`。
- `runtime-state.json` 不迁移，启动时重建。
- 不静默改写 CliRelay 配置未知项。

---

## 8. 应用启动模型

### 8.1 Host 负责生命周期

Bootstrap/Status 窗口不负责启动服务。服务生命周期由 Rust Host 根据设置、用户动作和状态机管理。

窗口只负责：

- 展示当前状态。
- 接收用户动作。
- 显示恢复路径。
- 在 ready 后视觉切换到 Panel。

### 8.2 首次启动

首次启动必须显示主窗口。

首次启动页面说明：

- Desktop 将在本机运行 CliRelay。
- 默认 API 地址。
- 数据目录位置。
- 管理面板来自 CliRelay 的 `/manage`。
- Preview 未公证，安装和更新需要用户手动处理。

首次启动不自动启动服务。用户必须点击“启动 CliRelay”。

用户首次点击后：

- 创建基础目录。
- 标记 `first_run_completed = true`。
- 设置 `auto_start_service = true`。
- 设置 `open_panel_on_start = true`。
- 本次启动 Sidecar。

`auto_start_app` 仍保持 false。登录时启动必须由用户在 Settings 明确开启。

### 8.3 启动偏好

Settings General 区包含：

- 登录时启动 CliRelay Desktop。
- 启动 CliRelay Desktop 后自动启动服务。
- 启动时打开管理面板。

`关闭窗口后继续运行` 不作为设置项，V0 固定为 true。

### 8.4 启动流程

App 启动时：

1. 初始化单实例。
2. 读取 Desktop 设置。
3. 初始化日志、路径、菜单栏和状态机。
4. 如果是首次启动，立即显示主窗口。
5. 如果 `open_panel_on_start = true`，立即显示主窗口的 Bootstrap/Status mode。
6. 如果 `auto_start_service = true`，Host 在后台启动或接管服务。
7. 服务 Running 且 `/manage` ready 后，主窗口视觉切换到 Panel mode。
8. 如果 `open_panel_on_start = false` 且无错误，不显示主窗口，只保留菜单栏。
9. 如果失败、端口冲突或需要用户确认，显示主窗口 Status。

`open_panel_on_start` 只表示显示主窗口，不隐式启动服务。

---

## 9. 窗口模型

### 9.1 单主窗口视觉模型

V0 使用单主窗口视觉模型：

- Bootstrap/Status mode。
- Panel mode。

用户感知上是一个主窗口。安全实现上，Bootstrap/Status 与 Panel 必须 capability 隔离，可以用不同 webview、window label 或等价机制完成。

### 9.2 Bootstrap/Status mode

Bootstrap/Status 负责：

- first-run 说明。
- 当前启动步骤。
- 服务状态。
- 错误恢复。
- 端口冲突选择。
- External 确认。
- 打开日志目录。
- 打开数据目录。
- 重新启动或停止服务。

它显示当前步骤和可展开详情，不显示冗长 checklist。

启动步骤示例：

- 初始化数据目录。
- 检查端口。
- 启动 CliRelay。
- 等待服务响应。
- 打开管理面板。

### 9.3 Panel mode

Panel 打开：

```text
http://127.0.0.1:<port>/manage
```

Panel 在 `/manage` ready 后创建或显示，避免先显示连接错误页。

Panel 加载失败时回到 Bootstrap/Status mode，并显示：

- 服务状态。
- Panel URL。
- 错误摘要。
- 重试打开面板。
- 重启服务。
- 打开日志目录。

### 9.4 视觉过渡

Bootstrap/Status 到 Panel 的动画只在 Shell 侧完成。

推荐流程：

1. Shell 显示启动进度。
2. `/manage` ready。
3. Shell 进入 opening panel 过渡。
4. Shell fade/scale out。
5. 隐藏 Shell webview。
6. 显示零权限 Panel webview。

### 9.5 Settings 窗口

Settings 是独立普通窗口。

规则：

- 只允许一个 Settings 实例。
- 重复点击聚焦已有窗口。
- Settings 有自己的 capability。
- Settings 不嵌入 Panel。

Settings 区块：

- General。
- Service。
- Update。
- About。

### 9.6 Dock 与关闭行为

V0 保留 Dock 图标。

主窗口红色关闭按钮：

- 隐藏主窗口。
- 不停止服务。
- 服务继续由菜单栏管理。

Dock 点击恢复规则：

- 服务 Running 且上次用户在 Panel，恢复 Panel。
- 服务 Running 且上次用户在 Status，恢复 Status。
- 服务 Starting、Unhealthy、Error、External 或 Stopped，显示 Status。
- Dock 不是启动服务按钮，不隐式启动 Sidecar。

### 9.7 窗口尺寸

主窗口：

- 默认：`1200 x 800`。
- 最小：`900 x 600`。
- Bootstrap/Status 和 Panel 共用主窗口位置尺寸。
- 保存最后位置和尺寸。
- 若保存位置在断开的外接屏上，重置到当前屏幕居中。

Settings：

- 建议默认：`720 x 560`。
- 独立保存位置尺寸。

---

## 10. 菜单栏模型

### 10.1 菜单结构

V0 菜单栏结构：

```text
CliRelay ● 运行中
────────────────
打开管理面板
显示状态
设置
────────────────
复制 API Base URL
复制 OpenAI /v1 URL
────────────────
启动服务
停止服务
重新启动
────────────────
打开数据目录
打开日志目录
────────────────
退出 CliRelay Desktop
```

### 10.2 状态文案

第一行状态随服务变化：

- 停止。
- 启动中。
- 运行中。
- 不健康。
- 外部实例。
- 错误。

### 10.3 菜单动作规则

服务动作按状态启用或禁用。

| 状态 | 启动 | 停止 | 重新启动 |
|---|---:|---:|---:|
| Stopped | 启用 | 禁用 | 禁用 |
| Starting | 禁用 | 禁用 | 禁用 |
| Running owned | 禁用 | 启用 | 启用 |
| Unhealthy owned | 禁用 | 启用 | 启用 |
| Error | 启用 | 禁用 | 启用 |
| Stopping | 禁用 | 禁用 | 禁用 |
| External | 禁用 | 禁用 | 禁用 |

External 模式下复制地址可用，停止和重启禁用。

### 10.4 图标

菜单栏图标使用 macOS template image，适配浅色和深色菜单栏。状态用菜单标题文字表达，不做彩色状态图标。

点击菜单栏图标统一打开菜单，不区分左键和右键行为。

---

## 11. 服务生命周期

### 11.1 状态机

```text
Stopped
  └─ start -> Starting

Starting
  ├─ ready -> Running
  ├─ port occupied by external CliRelay -> External pending confirmation
  ├─ timeout -> Error
  └─ process exit -> Error

Running
  ├─ health failure x3 -> Unhealthy
  ├─ process exit -> Error
  └─ stop -> Stopping

Unhealthy
  ├─ health restored -> Running
  ├─ restart -> Stopping -> Starting
  └─ process exit -> Error

Stopping
  ├─ exited -> Stopped
  └─ timeout / force failed -> Error

External
  ├─ health lost -> Stopped
  └─ disconnect -> Stopped

Error
  ├─ restart -> Starting
  └─ user stop cleanup -> Stopped
```

### 11.2 启动流程

启动 owned Sidecar：

1. 确认单实例。
2. 初始化路径和日志。
3. 读取 settings。
4. 确保 `runtime/` 和 `state/` 存在。
5. 检查端口。
6. 若端口空闲，使用 App 内 Sidecar 启动。
7. 工作目录设为 `runtime/`。
8. 优先使用 `runtime/config.yaml`。
9. 只传经真实版本验证的必要 CLI/env。
10. 写入 `runtime-state.json`。
11. 采集 stdout/stderr 到 `clirelay.log`。
12. 等待 HTTP ready。
13. 等待 `/manage` ready。
14. 更新菜单栏。
15. 如果主窗口可见，切换到 Panel。

### 11.3 停止流程

停止 owned Sidecar：

1. 状态设为 Stopping。
2. 禁用重复服务动作。
3. macOS 上先发 SIGTERM。
4. 等待 5 秒。
5. 若未退出，只对确认归属的 PID 发 SIGKILL。
6. 再等待 2 秒。
7. 成功退出则进入 Stopped。
8. 停止失败则进入 Error。

V0 先终止 Sidecar 主进程。若真实 CliRelay 测试显示会留下子进程，再引入进程组或进程树管理。

### 11.4 退出 Desktop

用户点击“退出 CliRelay Desktop”：

- 如果是 owned Running/Unhealthy，必须先停止 Sidecar。
- 停止成功后退出 App。
- 停止失败时不静默退出，显示状态窗口。
- 状态窗口提供重试停止。
- 可以后续增加危险动作“强制退出 Desktop，可能留下服务”。

系统关机或注销：

- 尽力停止 Sidecar。
- 不承诺阻止系统关机。
- 下次启动靠 `runtime-state.json` 接管或提示残留。

### 11.5 崩溃恢复

Sidecar 异常退出：

- 状态进入 Error。
- 显示最近退出码。
- 显示错误摘要。
- 提供重新启动。
- 提供打开日志目录。
- 不无限自动重启。

Error 状态不提供停止服务，因为进程已经退出。

---

## 12. 健康检查与 ready 判定

### 12.1 启动 ready 超时

启动阶段：

- HTTP ready 超时：20 秒。
- `/manage` ready 超时：40 秒。
- 总启动窗口约 45 秒。

失败类型需要区分：

- Sidecar 无法执行。
- 端口被占用。
- HTTP 启动超时。
- 管理面板启动超时。
- Sidecar 启动后立即退出。
- 配置文件可能无效。

### 12.2 健康检查间隔

Running 状态下：

- 每 5 秒执行一次轻量检查。
- 单次请求 timeout 建议 1 秒。
- 连续 3 次失败才进入 Unhealthy。
- 不检查 provider 外部网络。
- 不要求 `/v1` 可用。

### 12.3 fallback 策略

V0 不要求 CliRelay 提供专用 `/health`。

健康检查 fallback：

1. TCP 可连接 `127.0.0.1:<port>`。
2. HTTP 根路径 `/` 或 `/manage` 有可识别响应。
3. `/manage` 或 `/manage/login` 可访问时判定面板 ready。

如果未来上游提供稳定健康端点，再优先使用。

### 12.4 Panel ready

Panel ready 接受：

- `/manage` 返回 200 HTML。
- `/manage` 301/302 到 `/manage/login`。
- `/manage/login` 返回 200 HTML。

不要求用户登录完成，不检查 provider 配置。

### 12.5 健康恢复

Unhealthy 恢复后：

- 状态自动切回 Running。
- 如果窗口在 Status，不自动切回 Panel。
- 用户点击“打开管理面板”后再切 Panel。

---

## 13. 端口冲突与 External

### 13.1 端口占用

启动前发现端口占用：

1. 探测是否能访问 CliRelay 管理页面。
2. 检查是否可能是本应用上次残留。
3. 如果是未知实例，不杀进程。
4. 显示用户选择。

用户选择：

- 连接现有服务。
- 更改端口。
- 取消。

### 13.2 External 确认

即使探测到端口上像 CliRelay，也必须用户确认后才进入 External。

External 选择不持久化。下次启动遇到端口占用时重新确认。

### 13.3 External 窗口行为

用户确认连接后可以切到 Panel，但窗口和菜单必须明确显示 External 状态。

External 限制：

- 不允许停止。
- 不允许重启。
- 退出 Desktop 不影响外部进程。
- 日志和版本信息可能不可用。

---

## 14. 残留进程与归属校验

### 14.1 runtime-state.json

每次成功启动 owned Sidecar 后写入：

```json
{
  "pid": 12345,
  "startedAt": "2026-06-12T00:00:00Z",
  "executablePath": "/Applications/CliRelay Desktop.app/Contents/...",
  "executableSha256": "<sha256>",
  "port": 8317,
  "desktopVersion": "0.0.1-preview.1",
  "launchId": "<uuid>"
}
```

### 14.2 启动时发现旧 PID

策略：

- PID 不存在：清理 stale runtime state。
- PID 存在但归属不匹配：忽略，按端口占用处理。
- PID 存在且归属匹配，服务健康：接管为 owned Running。
- PID 存在且归属匹配，但不健康：显示 Status，提供重启和停止。

不自动杀旧 PID。

### 14.3 归属证据

macOS 上至少使用四项证据：

- PID 存在。
- PID 启动时间匹配。
- 可执行路径匹配 App 内 Sidecar。
- Sidecar SHA-256 匹配。

只对确认归属的 PID 执行 SIGTERM 或 SIGKILL。

---

## 15. 安全模型

### 15.1 capability 隔离

Bootstrap/Status 和 Panel 必须 capability 隔离。

Panel 零 Tauri 权限。Panel 只能通过 HTTP 访问 CliRelay 自己暴露的能力。

如果 Tauri 不能在同一个 WebView 导航时动态切 capability，就不要真的让同一个 WebView 从 Shell 页面导航到 Panel。视觉上单窗口，安全上隔离。

### 15.2 Shell 命令白名单

Bootstrap/Status 和 Settings 只允许最小 command 白名单：

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

不包含：

- 任意 shell。
- 任意文件读写。
- 传入路径打开。
- 传入 PID kill。
- 安装更新。
- 导出诊断包。
- 读取原始日志。

### 15.3 无参数固定路径命令

以下命令不接受前端传入路径：

- `open_data_directory`
- `open_log_directory`

Rust 端根据 App 状态计算固定目录。

以下命令不接受前端传入 URL：

- `copy_endpoint`
- `copy_v1_endpoint`

Rust 端根据当前端口生成：

```text
http://127.0.0.1:<port>
http://127.0.0.1:<port>/v1
```

### 15.4 Settings patch

`update_desktop_settings` 只允许 patch 白名单字段，并在 Rust 端验证。

允许：

- `auto_start_app`
- `auto_start_service`
- `open_panel_on_start`
- `port`，仅 Stopped 时允许。
- `auto_check_new_versions`

不允许前端写：

- `first_run_completed`
- `schemaVersion`
- `channel`
- `dataDir`
- `runtime-state`

---

## 16. 导航策略

### 16.1 Panel 内允许

允许留在 Panel：

```text
http://127.0.0.1:<current-port>/...
http://localhost:<current-port>/...
```

### 16.2 Panel 内外部链接

外部 HTTPS 链接总是打开系统默认浏览器。

其他 localhost 端口也打开系统默认浏览器，不留在 Panel。

默认阻止：

- `file://`
- 非白名单自定义 scheme。
- 外部 HTTP。

### 16.3 更新 URL 白名单

检查新版本结果中的 release URL 和 download URL 必须通过白名单。

允许：

- 指定 GitHub repo 的 release URL。
- 未来官网域名。

不允许任意 URL。

---

## 17. Settings 设计

### 17.1 General

只保留三个设置：

- 登录时启动 CliRelay Desktop，默认 false。
- 启动 CliRelay Desktop 后自动启动服务，首次启动后 true。
- 启动时打开管理面板，首次启动后 true。

不显示“关闭窗口后继续运行”，V0 固定 true。

### 17.2 Service

Service 区显示：

- 当前服务状态。
- 端口编辑。
- 数据目录路径。
- 日志目录路径。
- Desktop 版本。
- CliRelay 版本。
- Sidecar SHA-256，可复制。

端口编辑只在服务 Stopped 时可用。Running 时禁用并提示停止服务后可修改。

### 17.3 Update

Update 区显示：

- 当前通道：Preview。
- 自动检查新版本开关，默认 false。
- 手动检查按钮。
- 最新版本摘要。
- 打开 GitHub Release 按钮。
- 最后检查时间。

不提供通道选择。

### 17.4 About

About 放在 Settings 内，不做独立窗口。

内容：

- App 名称。
- Desktop 版本。
- Channel。
- CliRelay 版本。
- Sidecar SHA-256。
- 上游项目链接。
- License。
- 非官方声明。

推荐声明：

```text
CliRelay Desktop is an independent, unofficial desktop companion for CliRelay.
It is not affiliated with or maintained by the CliRelay project authors.
```

---

## 18. 日志策略

### 18.1 文件

Desktop 日志与 CliRelay 日志分开：

```text
desktop.log
clirelay.log
```

轮转：

- 每个日志文件最大 10MB。
- 保留 5 个轮转文件。

示例：

```text
desktop.log
desktop.log.1
...
desktop.log.5

clirelay.log
clirelay.log.1
...
clirelay.log.5
```

### 18.2 desktop.log

记录：

- App 生命周期。
- 设置读取。
- Sidecar 启停。
- 端口检测。
- 健康检查。
- 状态转换。
- 更新检查结果。
- Release channel 信息。

启动参数摘要必须脱敏。

不要记录：

- 完整环境变量。
- API key。
- OAuth token。
- cookie。
- authorization header。
- provider 请求体。

### 18.3 clirelay.log

`clirelay.log` 保存 Sidecar 原始 stdout/stderr。

V0 不在 UI 中渲染 `clirelay.log`，不导出诊断包。文档和 Release 说明必须提醒用户：日志可能包含敏感信息，分享前应自行检查。

### 18.4 日志入口

菜单只提供“打开日志目录”，不直接打开某个日志文件。

---

## 19. macOS 系统集成

### 19.1 单实例

优先使用 Tauri single-instance 插件。

第二次启动时：

- 激活已有 App。
- 按 Dock 恢复规则显示主窗口。
- 不重复启动 Sidecar。

App 单实例不等于 Sidecar 归属。Sidecar 归属由 `runtime-state.json` 和进程证据判断。

### 19.2 开机启动

使用 Tauri autostart 插件。

拆分：

- 登录时启动 Desktop。
- Desktop 启动后自动启动服务。
- Desktop 启动时是否打开主窗口。

登录时启动默认 false，必须用户明确开启。

### 19.3 Dock

V0 保留 Dock 图标，不提供隐藏 Dock 偏好。

### 19.4 通知

V0 不做系统通知。

错误恢复通过主窗口和菜单栏完成。

---

## 20. UI 设计原则

### 20.1 风格

V0 Shell UI 保持 macOS 原生感：

- 工具化。
- 安静。
- 低装饰。
- 清晰状态。
- 明确按钮。
- 不做营销 hero。
- 不做大型插画。
- 不做 SaaS dashboard。

### 20.2 技术

前端：

- React。
- TypeScript。
- Vite。
- 轻量 CSS。
- 不引入大型组件库。
- 可少量使用 `lucide-react` 图标。

### 20.3 页面范围

V0 实际界面：

- 主窗口 Bootstrap/Status mode。
- 主窗口 Panel mode。
- Settings 窗口。
- 菜单栏。

删除独立页面：

- Status dashboard。
- Logs。
- Diagnostics。
- About。
- Onboarding。

---

## 21. Rust 模块建议

### 21.1 目录结构

V0 使用标准 Tauri 单应用结构，不做 monorepo。

```text
clirelay-desktop/
├── src/
│   ├── main.tsx
│   ├── pages/
│   ├── components/
│   ├── stores/
│   └── bridge/
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── bootstrap.rs
│   │   ├── commands.rs
│   │   ├── service/
│   │   │   ├── mod.rs
│   │   │   ├── manager.rs
│   │   │   ├── state.rs
│   │   │   ├── health.rs
│   │   │   ├── ownership.rs
│   │   │   └── logs.rs
│   │   ├── windows/
│   │   │   ├── main.rs
│   │   │   ├── panel.rs
│   │   │   └── settings.rs
│   │   ├── platform/
│   │   │   ├── mod.rs
│   │   │   └── macos.rs
│   │   ├── tray.rs
│   │   ├── paths.rs
│   │   ├── settings.rs
│   │   └── update_check.rs
│   ├── binaries/
│   │   └── clirelay-aarch64-apple-darwin
│   ├── capabilities/
│   │   ├── shell.json
│   │   ├── settings.json
│   │   └── panel.json
│   ├── resources/
│   │   ├── config.example.yaml
│   │   ├── panel/
│   │   │   ├── manage.html
│   │   │   └── assets/
│   │   └── licenses/
│   ├── icons/
│   ├── tauri.conf.json
│   └── Cargo.toml
├── scripts/
│   ├── fetch-upstream.ts
│   ├── verify-checksum.ts
│   ├── generate-latest-preview.ts
│   └── generate-notices.ts
├── tests/
│   ├── fixtures/
│   └── integration/
├── docs/
├── upstream-lock.json
├── THIRD_PARTY_NOTICES.md
├── LICENSE
└── README.md
```

### 21.2 PlatformIntegration

保留最小平台抽象，不提前写 Windows 空实现。

```rust
trait PlatformIntegration {
    fn app_data_dir(&self) -> PathBuf;
    fn log_dir(&self) -> PathBuf;
    fn reveal_in_file_manager(&self, path: &Path) -> Result<()>;
    fn terminate_owned_process(&self, process: &OwnedProcess) -> Result<()>;
}
```

接口命名不泄漏 Unix signal 或 Finder 专属概念。

### 21.3 核心数据模型

```rust
#[derive(Clone, Debug, Serialize)]
enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Unhealthy,
    External,
    Error,
}

#[derive(Clone, Debug, Serialize)]
struct ServiceSnapshot {
    status: ServiceStatus,
    pid: Option<u32>,
    port: u16,
    endpoint: String,
    panel_url: String,
    started_at: Option<DateTime<Utc>>,
    last_exit_code: Option<i32>,
    last_error: Option<String>,
    ownership: ProcessOwnership,
    clirelay_version: String,
    sidecar_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DesktopSettings {
    schema_version: u32,
    first_run_completed: bool,
    auto_start_app: bool,
    auto_start_service: bool,
    open_panel_on_start: bool,
    port: u16,
    auto_check_new_versions: bool,
    last_update_check_at: Option<DateTime<Utc>>,
}
```

### 21.4 Commands

V0 commands：

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

所有 command 在 Rust 端验证状态和参数。前端不传 PID、路径、可执行文件名或 URL。

---

## 22. CI/CD

### 22.1 PR CI

PR CI 不依赖真实 CliRelay Release。

建议执行：

- TypeScript lint。
- TypeScript typecheck。
- 前端测试。
- Rust fmt check。
- Rust clippy。
- Rust unit tests。
- 状态机表驱动测试。
- mock Sidecar 集成测试。
- 未签名 app build 可选。

### 22.2 Release CI

Preview Release CI：

```text
tag / manual dispatch
-> 下载 upstream-lock.json 指定的 CliRelay 和 codeProxy Release assets
-> 校验 SHA-256
-> 解包 Sidecar 和 panel 资源
-> 构建 Tauri app
-> 对 .app 和嵌入 Sidecar 做 Ad Hoc 签名
-> codesign --verify --deep --strict
-> 记录 spctl --assess 结果，但不作为通过条件
-> 打包 DMG
-> 挂载 DMG 并检查 .app
-> 执行最小 smoke
-> 生成 checksums.txt
-> 生成 build-manifest.json
-> 生成 latest-preview.json
-> 创建 GitHub prerelease
-> 上传资产
-> 更新 gh-pages/latest-preview.json
```

GitHub Actions 需要：

```yaml
permissions:
  contents: write
```

### 22.3 Release smoke

Release CI 最小真实产物 smoke：

- DMG 能挂载。
- `.app` bundle 存在。
- Sidecar 文件存在且可执行。
- `codesign --verify --deep --strict` 通过。
- `spctl --assess` 只记录结果。
- 可选启动 App 后拉起 Sidecar，在限定时间内监听端口并退出清理。

### 22.4 真实 CliRelay smoke

真实 CliRelay Release smoke 必选：

1. 从 `upstream-lock.json` 下载 asset 并校验 SHA-256。
2. 解包后 Sidecar 可执行。
3. 在临时 runtime 目录中用默认配置启动。
4. `127.0.0.1:<port>/manage` 或 `/manage/login` 在超时内 ready。
5. 停止后端口释放，Sidecar 无残留。

不测 OAuth、不测 provider、不测真实 API 代理。

---

## 23. 测试计划

### 23.1 单元测试

必须覆盖：

- 状态机转换。
- 设置序列化。
- 端口校验。
- 路径生成。
- 日志轮转。
- 日志脱敏。
- URL 白名单。
- release version 比较。
- 进程归属判断。

状态机必须写表驱动测试。

### 23.2 mock Sidecar 集成测试

V0 必选 8 个场景：

1. 延迟启动后 `/manage` ready。
2. 启动后立即退出。
3. 端口被未知进程占用。
4. `/manage` 超时但 HTTP 可达。
5. Running 后连续 3 次健康失败进入 Unhealthy。
6. Unhealthy 后健康恢复为 Running，但不自动切 Panel。
7. SIGTERM 正常退出。
8. SIGTERM 超时后 SIGKILL。

### 23.3 手动测试

V0 手动测试清单：

- 首次启动。
- 首次点击“启动 CliRelay”。
- 关闭主窗口后菜单栏仍可控制。
- 退出 Desktop 停止 owned Sidecar。
- External 端口冲突确认。
- Settings 修改端口。
- 检查新版本。
- 打开数据目录。
- 打开日志目录。
- OAuth 代表路径。
- `/manage` 主要页面加载。
- 路径含中文和空格。
- 深色和浅色模式。
- 无网络环境。
- 代理或受限网络环境。
- 休眠和唤醒。

### 23.4 macOS 版本

计划声明最低 macOS 13，但如果没有 macOS 13 runner 或设备，先作为手动阻断前检查，不放进 CI 硬门槛。

正式声明最低版本前，至少在一台 macOS 13 Apple Silicon 上跑安装和启动 smoke。

---

## 24. V0 验收标准

### 24.1 安装与运行

- 用户能从 GitHub prerelease 下载 DMG。
- DMG checksum 可核对。
- DMG 可挂载。
- App 可复制到 Applications。
- 用户按说明手动放行后可以启动。
- 不要求 Gatekeeper 无阻碍。
- 不要求 `spctl --assess` 通过。

### 24.2 Sidecar

- CliRelay Release asset 来自 `upstream-lock.json`。
- codeProxy Release asset 来自 `upstream-lock.json`。
- SHA-256 校验通过。
- Sidecar 能从 `runtime/` 启动。
- codeProxy panel 能复制到 `runtime/panel/`。
- `/manage` 或 `/manage/login` 可打开。
- Desktop 退出后 owned Sidecar 停止。

### 24.3 窗口与菜单栏

- 首次启动强制显示主窗口。
- 首次点击启动后切到 Panel。
- 关闭主窗口不停止服务。
- 菜单栏可启动、停止、重启服务。
- Settings 单实例。
- Panel 故障时回到 Status。

### 24.4 安全

- Panel 零 Tauri 权限。
- Shell command 最小白名单。
- 目录打开命令不接受路径参数。
- 复制地址命令不接受 URL 参数。
- 外部链接用系统浏览器打开。
- `file://` 默认阻止。

### 24.5 日志

- `desktop.log` 和 `clirelay.log` 分离。
- 日志轮转 10MB x 5。
- 菜单可以打开日志目录。
- UI 不渲染原始日志。

### 24.6 更新检查

- 自动检查新版本默认关闭。
- 手动检查可以请求 `latest-preview.json`。
- Release URL 通过白名单。
- 只打开下载页，不自动下载或安装。

---

## 25. 风险清单

| 风险 | 影响 | V0 应对 |
|---|---|---|
| Ad Hoc 未公证 | 用户首次运行被阻止 | Release 明确说明手动放行 |
| 上游 Release asset 缺失 | 无法发布 | CI 阻断，不 fallback 源码构建 |
| 运行时访问 GitHub REST API 失败 | `/manage` 面板不可用 | codeProxy panel-dist.zip 随 App 打包并复制到 runtime/panel |
| 上游替换 asset | 供应链风险 | SHA-256 不一致直接失败 |
| `/manage` 在 WKWebView 异常 | 管理页面不可用 | 技术验证和手动测试；必要时外部浏览器 fallback 后续评估 |
| OAuth 外链受限 | 登录失败 | 外部 HTTPS 用系统浏览器 |
| 端口被占用 | 无法启动 | 用户确认 External、改端口或取消 |
| Sidecar 残留 | 端口长期占用 | runtime-state、归属校验、接管或用户确认重启 |
| 配置被用户改坏 | 启动失败 | 不自动修复，显示日志和目录入口 |
| 日志包含敏感信息 | 用户分享风险 | UI 不显示日志，文档提醒分享前检查 |
| latest-preview.json 被篡改 | 误导下载 | HTTPS 固定 URL、URL 白名单、纯文本渲染 |
| Preview 到 Stable 数据不兼容 | 用户配置损坏 | Stable 首启前备份 |

---

## 26. 许可证与品牌

Desktop 仓库使用 MIT License。

仓库必须包含：

- Desktop `LICENSE`。
- `THIRD_PARTY_NOTICES.md`。
- CliRelay LICENSE 副本。
- codeProxy 上游链接和许可证信息。
- 上游项目链接。
- 依赖许可证汇总。

V0 使用独立图标，不复制上游 CliRelay Logo。

README 和 About 必须显著声明非官方关系：

```text
CliRelay Desktop is an independent, unofficial desktop companion for CliRelay.
It is not affiliated with or maintained by the CliRelay project authors.
```

不使用：

- Official。
- 官方版。
- 上游维护。
- 暗示授权的品牌表达。

---

## 27. 阶段计划

### 阶段 A：技术验证

交付：

- Tauri 2 + React + TypeScript 项目。
- 下载并锁定 CliRelay 和 codeProxy Release assets。
- Sidecar 能在 `runtime/` 中启动。
- codeProxy panel 能复制到 `runtime/panel/`。
- `/manage` 能在隔离 Panel 打开。
- App 退出能停止 Sidecar。

退出条件：

- 一台 Apple Silicon Mac 上重复启动、退出无残留。
- 已确认真实 CliRelay 配置路径、端口字段和工作目录行为。
- 已验证 `/manage` 与主要 OAuth 外链。

### 阶段 B：核心宿主

交付：

- 状态机。
- Service Manager。
- 健康检查。
- 日志采集和轮转。
- 端口冲突与 External。
- runtime-state 归属校验。

退出条件：

- 表驱动状态机测试通过。
- mock Sidecar 8 个必选场景通过。
- owned Sidecar 不误杀外部进程。

### 阶段 C：桌面体验

交付：

- 单主窗口视觉模型。
- Panel capability 隔离。
- Settings。
- 菜单栏。
- Dock 恢复规则。
- 开机启动设置。
- 轻量检查新版本。

退出条件：

- 首次启动、关闭窗口、菜单恢复、退出停止行为全部稳定。
- Panel 零权限测试通过。

### 阶段 D：Preview 发布

交付：

- Ad Hoc 签名。
- DMG。
- checksums。
- build-manifest。
- latest-preview。
- GitHub prerelease。
- gh-pages 更新索引。

退出条件：

- Release CI 下载上游 asset 并校验。
- DMG 挂载和 bundle smoke 通过。
- Release 页面包含未公证说明。

### 阶段 E：Public Stable 准备

后续条件：

- 获取 Apple Developer Program。
- Developer ID 签名。
- Apple notarization。
- `spctl` / Gatekeeper 验收。
- Stable channel。
- Stable `latest.json`。

---

## 28. 开发启动清单

### 立项

- [ ] 确定 Bundle ID。
- [ ] 确定 GitHub repo。
- [ ] 确定 GitHub Pages URL。
- [ ] 确定 MIT License。
- [ ] 写入非官方声明。
- [ ] 准备独立图标。

### 上游锁定

- [ ] 选择 CliRelay 目标 Release。
- [ ] 确认 macOS arm64 asset。
- [ ] 记录 asset URL。
- [ ] 计算 SHA-256。
- [ ] 写入 `upstream-lock.json`。
- [ ] 确认解包路径。

### 技术验证

- [ ] 创建 Tauri 2 + React + Vite 项目。
- [ ] 放置 Sidecar。
- [ ] 设置 `runtime/` 工作目录。
- [ ] 创建默认 `config.yaml`。
- [ ] 禁用上游 auto-update。
- [ ] 打开 `/manage`。
- [ ] 验证 OAuth 外链系统浏览器打开。

### 核心实现

- [ ] Service Manager。
- [ ] 状态机。
- [ ] 健康检查。
- [ ] 日志轮转。
- [ ] runtime-state。
- [ ] 残留接管。
- [ ] 端口冲突和 External。

### UI

- [ ] 主窗口 Bootstrap/Status。
- [ ] Panel 隔离 WebView。
- [ ] Shell 到 Panel 视觉过渡。
- [ ] Settings。
- [ ] 菜单栏。
- [ ] Dock 恢复。

### CI/CD

- [ ] PR CI。
- [ ] mock Sidecar fixture。
- [ ] Release CI。
- [ ] Ad Hoc 签名。
- [ ] DMG。
- [ ] build-manifest。
- [ ] latest-preview。
- [ ] gh-pages 更新。

---

## 29. 后续路线

### V0.x Preview 增强

- 更完整错误恢复。
- 可选系统通知。
- 可选 URL Scheme。
- 更完善 release notes 展示。
- 更完整手动测试矩阵。

### Public Stable

- Developer ID 签名。
- Apple notarization。
- Gatekeeper 无阻碍安装。
- Stable channel。
- Stable `latest.json`。

### Windows x64

远期路线：

- Windows Sidecar asset。
- WebView2 验证。
- 系统托盘适配。
- 隐藏控制台窗口。
- Windows 进程管理。
- 安装器和代码签名。

### Windows ARM64

在 Windows x64 稳定之后再评估：

- ARM64 Sidecar。
- ARM64 installer。
- 原生设备验证。

---

## 30. 最终建议

CliRelay Desktop V0 Preview 应保持极窄目标：

```text
macOS Apple Silicon Tauri App
+ 上游 CliRelay Release Sidecar
+ 原样 /manage Panel
+ 菜单栏生命周期管理
+ Ad Hoc 签名 GitHub prerelease
+ 轻量检查新版本
```

成功标准不是做出完整桌面产品，而是验证薄宿主架构是否可靠：不修改上游、不复制管理界面、不误杀外部进程、不破坏用户数据，并能通过自动化 Release CI 产出可追踪的 Preview DMG。

等拿到 Apple Developer Program 后，再把 Preview 的运行经验收敛为 Public Stable：Developer ID 签名、公证、Gatekeeper 验收和 Stable 通道。
