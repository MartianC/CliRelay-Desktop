# Settings 窗口前端设计规范

本文档约束 CliRelay Desktop Settings 窗口的基础视觉规则，避免后续页面继续出现不一致的字号、分栏和操作位置。

## 布局

- Settings 窗口保持固定两栏结构，侧栏宽度固定为 184px。
- 内容区边距固定为 20px 22px 24px，页面之间不得单独放大内容边距。
- 内容区必须独立滚动，窗口高度不足时滚动条出现在右侧内容栏。
- 左侧导航只放品牌和导航项，不放连接状态、说明文字或页脚状态。

## 字号

- 页面标题使用现有 `.settings-content-header h2` 规则。
- 卡片标题使用 0.92rem，与 `.settings-section h3` 保持一致。
- 卡片正文说明使用 0.84rem 到 0.9rem，避免在工具窗口里使用营销页式大字号。
- 表格字段和版本号使用现有正文密度，版本号可使用等宽字体。

## 操作

- 每个 block 的主操作放在该 block 标题栏右侧。
- 外部网页跳转必须使用 `openExternalUrl` 交给系统浏览器打开，并显示外链图标；Settings capability 必须同时授予 `opener:allow-open-url` 和 `opener:allow-default-urls`，不要使用权限更宽的 `opener:default`。
- Settings 窗口文案默认使用中文；技术名词如 CliRelay、codeProxy、GitHub Release 可保留英文。
