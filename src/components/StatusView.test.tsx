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
  test("显示恢复入口、状态字段和 External 选择", () => {
    const html = renderToStaticMarkup(
      <StatusView
        snapshot={snapshot}
        error={null}
        isBusy={false}
        onRefresh={vi.fn()}
        onOpenPanel={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
        onCopyEndpoint={vi.fn()}
        onChangePort={vi.fn()}
        onCancelExternal={vi.fn()}
      />,
    );

    expect(html).toContain("菜单 / Dock / 恢复状态");
    expect(html).toContain("当前状态");
    expect(html).toContain("Panel URL");
    expect(html).toContain("打开日志目录");
    expect(html).toContain("连接现有服务");
    expect(html).toContain("更改端口");
    expect(html).toContain("取消");
  });
});
