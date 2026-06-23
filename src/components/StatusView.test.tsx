import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { ServiceSnapshot } from "../bridge/types";
import { StatusView } from "./StatusView";

const snapshot: ServiceSnapshot = {
  status: "External",
  pid: 4321,
  port: 8317,
  endpoint: "http://127.0.0.1:8317",
  panelUrl: "http://127.0.0.1:8317/manage",
  startedAt: null,
  lastExitCode: null,
  lastError: "端口已被 CliRelay 类服务占用",
  ownership: "External",
  clirelayVersion: "0.4.0",
  codeProxyVersion: "0.4.0",
  sidecarSha256: "abc123",
};

describe("StatusView", () => {
  test("按简洁恢复弹窗渲染问题、建议操作和折叠诊断详情", () => {
    const html = renderToStaticMarkup(
      <StatusView
        snapshot={snapshot}
        error={null}
        isBusy={false}
        onRefresh={vi.fn()}
        onOpenPanel={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogDirectory={vi.fn()}
        onChangePort={vi.fn()}
      />,
    );

    expect(html).toContain("菜单 / Dock / 恢复状态");
    expect(html).toContain("运行状态");
    expect(html).toContain("CliRelay 无法启动");
    expect(html).toContain("端口 8317 已被占用");
    expect(html).toContain("建议操作");
    expect(html).toContain("诊断详情");
    expect(html).toContain("展开详情");
    expect(html).toContain("打开日志目录");
    expect(html).toContain("连接现有");
    expect(html).toContain("改端口");
    expect(html).toContain("重试");
    expect(html).not.toContain("Panel URL");
    expect(html).not.toContain("打开管理面板");
    expect(html).not.toContain("停止");
    expect(html).not.toContain("复制 API Base URL");
    expect(html).not.toContain("取消");
    expect(html).toContain("settings-shell");
    expect(html).toContain("settings-content");
    expect(html).toContain("settings-section");
    expect(html).not.toContain("recovery-shell");
  });
});
