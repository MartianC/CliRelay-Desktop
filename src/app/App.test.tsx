import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  StartupShell,
  shouldCheckManagementSecret,
  shouldCheckRuntimeConfig,
  shouldAutoStartService,
  shouldHideShellAfterSilentStartup,
  shouldOpenPanelAfterStartup,
  shouldShowShellWindow,
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
    expect(html).toContain("startup-icon-image");
    expect(html).not.toContain("terminal-mark");
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

describe("startup gates", () => {
  test("主窗口加载 settings 后才检查 runtime config", () => {
    expect(
      shouldCheckRuntimeConfig({
        windowRole: "main",
        hasSettings: true,
        configGateState: "checking",
      }),
    ).toBe(true);
    expect(
      shouldCheckRuntimeConfig({
        windowRole: "main",
        hasSettings: false,
        configGateState: "checking",
      }),
    ).toBe(false);
  });

  test("runtime config ready 后才检查管理员密钥", () => {
    expect(
      shouldCheckManagementSecret({
        windowRole: "main",
        hasSettings: true,
        configGateState: "ready",
        secretGateState: "checking",
      }),
    ).toBe(true);
    expect(
      shouldCheckManagementSecret({
        windowRole: "main",
        hasSettings: true,
        configGateState: "missing",
        secretGateState: "checking",
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
        secretGateState: "configured",
      }),
    ).toBe(true);
  });

  test("管理密钥未配置时不提前消耗打开 Panel 请求", () => {
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Running",
        openPanelOnStart: true,
        secretGateState: "missing",
      }),
    ).toBe(false);
  });

  test("静默启动时不自动打开 Panel", () => {
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: false,
        panelOpening: false,
        snapshotStatus: "Running",
        openPanelOnStart: false,
        secretGateState: "configured",
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
        secretGateState: "configured",
      }),
    ).toBe(false);
    expect(
      shouldOpenPanelAfterStartup({
        panelOpened: false,
        panelOpening: true,
        snapshotStatus: "Running",
        openPanelOnStart: true,
        secretGateState: "configured",
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

describe("shouldShowShellWindow", () => {
  test("静默启动且门禁已完成时不显示启动窗口", () => {
    expect(
      shouldShowShellWindow({
        windowRole: "main",
        hasSettings: true,
        settingsError: null,
        openPanelOnStart: false,
        configGateState: "ready",
        secretGateState: "configured",
        snapshotStatus: "Starting",
        statusRequested: false,
        startupFailed: false,
      }),
    ).toBe(false);
  });

  test("普通启动需要显示启动窗口", () => {
    expect(
      shouldShowShellWindow({
        windowRole: "main",
        hasSettings: true,
        settingsError: null,
        openPanelOnStart: true,
        configGateState: "ready",
        secretGateState: "configured",
        snapshotStatus: "Starting",
        statusRequested: false,
        startupFailed: false,
      }),
    ).toBe(true);
  });

  test("静默启动遇到门禁或启动失败时仍显示窗口", () => {
    expect(
      shouldShowShellWindow({
        windowRole: "main",
        hasSettings: true,
        settingsError: null,
        openPanelOnStart: false,
        configGateState: "missing",
        secretGateState: "checking",
        snapshotStatus: "Stopped",
        statusRequested: false,
        startupFailed: false,
      }),
    ).toBe(true);

    expect(
      shouldShowShellWindow({
        windowRole: "main",
        hasSettings: true,
        settingsError: null,
        openPanelOnStart: false,
        configGateState: "ready",
        secretGateState: "configured",
        snapshotStatus: "Stopped",
        statusRequested: false,
        startupFailed: true,
      }),
    ).toBe(true);
  });
});
