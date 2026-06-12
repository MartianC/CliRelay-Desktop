# CliRelay Desktop

CliRelay Desktop is an independent, unofficial desktop companion for CliRelay.
It is not affiliated with or maintained by the CliRelay project authors.

V0 Preview is ad-hoc signed and not notarized by Apple. It is intended for technical preview testing on macOS Apple Silicon.

V0 Preview bundles locked upstream release assets for CliRelay and codeProxy. codeProxy is included so the management panel can load from local packaged resources instead of relying on runtime GitHub REST API downloads.

## 中文说明

CliRelay Desktop 是 CliRelay 的非官方桌面宿主，用于在 macOS Apple Silicon 上验证本地 Sidecar 生命周期管理、菜单栏控制和 Preview 发布链路。

V0 Preview 使用 Ad Hoc 签名，未经过 Apple 公证。首次启动时 macOS 可能阻止运行，请只在信任本项目且校验下载文件完整后安装和测试。

V0 Preview 会打包已锁定版本的 CliRelay 和 codeProxy Release 资产。codeProxy 随包内置后，管理面板优先从本地资源加载，避免运行时依赖 GitHub REST API 下载导致失败。
