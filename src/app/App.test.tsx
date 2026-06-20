import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  StartupShell,
  shouldAutoStartService,
  shouldHideShellAfterSilentStartup,
  shouldOpenPanelAfterStartup,
} from "./App";

describe("StartupShell", () => {
  test("正常启动时只显示启动进度，不显示状态入口", () => {
    const html = renderToStaticMarkup(
      <StartupShell
        status="Starting"
        panelOpening={false}
        panelOpened={false}
        isBusy={false}
        startupFailed={false}
        onOpenStatus={vi.fn()}
      />,
    );

    expect(html).toContain("CliRelay Desktop");
    expect(html).toContain("启动服务中");
    expect(html).toContain("准备运行环境");
    expect(html).toContain("启动 CliRelay");
    expect(html).toContain("等待 /manage");
    expect(html).toContain("打开 Panel");
    expect(html).toContain("第 2 / 4 步");
    expect(html).not.toContain("打开状态");
    expect(html).toContain("startup-content");
    expect(html).toContain("startup-app-icon");
    expect(html).not.toContain("startup-window-titlebar");
    expect(html).not.toContain("traffic-lights");
  });

  test("启动失败时才显示状态入口", () => {
    const html = renderToStaticMarkup(
      <StartupShell
        status="Stopped"
        panelOpening={false}
        panelOpened={false}
        isBusy={false}
        startupFailed={true}
        onOpenStatus={vi.fn()}
      />,
    );

    expect(html).toContain("启动失败");
    expect(html).toContain("打开状态");
  });
});

describe("shouldAutoStartService", () => {
  test("主窗口看到 Stopped 快照后自动请求启动", () => {
    expect(
      shouldAutoStartService({
        hasAttemptedAutoStart: false,
        isBusy: false,
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Stopped",
        statusRequested: false,
        windowRole: "main",
        secretGateState: "configured",
      }),
    ).toBe(true);
  });

  test("密钥门禁未完成时不自动启动服务", () => {
    expect(
      shouldAutoStartService({
        hasAttemptedAutoStart: false,
        isBusy: false,
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Stopped",
        statusRequested: false,
        windowRole: "main",
        secretGateState: "checking",
      }),
    ).toBe(false);
  });

  test("非 Stopped 或已经尝试启动时不重复自动启动", () => {
    expect(
      shouldAutoStartService({
        hasAttemptedAutoStart: true,
        isBusy: false,
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Stopped",
        statusRequested: false,
        windowRole: "main",
        secretGateState: "configured",
      }),
    ).toBe(false);
    expect(
      shouldAutoStartService({
        hasAttemptedAutoStart: false,
        isBusy: false,
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Starting",
        statusRequested: false,
        windowRole: "main",
        secretGateState: "configured",
      }),
    ).toBe(false);
  });
});

describe("shouldOpenPanelAfterStartup", () => {
  test("服务进入 Running 后自动进入 Panel", () => {
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Running",
        openPanelOnStart: true,
      }),
    ).toBe(true);
  });

  test("静默启动时不自动打开 Panel", () => {
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Running",
        openPanelOnStart: false,
      }),
    ).toBe(false);
  });

  test("Panel 已经打开或正在打开时不重复触发", () => {
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: true,
        panelOpening: false,
        snapshotStatus: "Running",
        openPanelOnStart: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: false,
        panelOpening: true,
        snapshotStatus: "Running",
        openPanelOnStart: true,
      }),
    ).toBe(false);
  });
});

describe("shouldHideShellAfterSilentStartup", () => {
  test("静默启动服务就绪后隐藏 shell", () => {
    expect(
      shouldHideShellAfterSilentStartup({
        hasHiddenShell: false,
        openPanelOnStart: false,
        snapshotStatus: "Running",
        windowRole: "main",
        statusRequested: false,
      }),
    ).toBe(true);
  });
});
