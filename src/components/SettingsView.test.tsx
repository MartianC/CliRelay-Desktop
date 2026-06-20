import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { DesktopSettings, ServiceSnapshot } from "../bridge/types";
import type { SettingsDraft } from "../stores/settingsStore";
import { SettingsView } from "./SettingsView";

const settings: DesktopSettings = {
  schemaVersion: 1,
  firstRunCompleted: true,
  autoStartApp: false,
  autoStartService: true,
  openPanelOnStart: true,
  port: 8317,
  autoCheckNewVersions: false,
  lastUpdateCheckAt: null,
  lastUpdateCheckResult: null,
  locale: "zh-CN",
};

const draft: SettingsDraft = {
  autoStartApp: false,
  silentStart: false,
  portText: "8317",
  autoCheckNewVersions: false,
  locale: "zh-CN",
};

const snapshot: ServiceSnapshot = {
  status: "Running",
  pid: 4321,
  port: 8317,
  endpoint: "http://127.0.0.1:8317",
  panelUrl: "http://127.0.0.1:8317/manage",
  startedAt: "2026-06-13T12:00:00Z",
  lastExitCode: null,
  lastError: null,
  ownership: "Owned",
  clirelayVersion: "0.4.0",
  codeProxyVersion: "0.4.0",
  sidecarSha256: "abc123",
};

describe("SettingsView", () => {
  test("使用两栏导航并默认显示 General 页面", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={null}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={false}
        isApplyingPreparedUpdate={false}
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("settings-layout");
    expect(html).not.toContain("surface settings-layout");
    expect(html).toContain("settings-sidebar");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('style="--settings-accent:#1d4ed8"');
    expect(html).toContain("通用");
    expect(html).toContain("服务");
    expect(html).toContain("更新");
    expect(html).toContain("关于");
    expect(html).toContain('data-nav-icon="general"');
    expect(html).toContain('data-nav-icon="service"');
    expect(html).toContain('data-nav-icon="update"');
    expect(html).toContain('data-nav-icon="about"');
    expect(html).toContain("登录时启动 Desktop");
    expect(html).toContain("静默启动");
    expect(html).toContain("语言");
    expect(html).toContain("中文");
    expect(html).toContain("English");
    expect(html).toContain("settings-select-row");
    expect(html).toContain("切换 Desktop 与管理面板语言");
    expect(html).not.toContain("启动后自动启动服务");
    expect(html).not.toContain("启动时打开管理面板");
    expect(html).toContain('class="toggle-control"');
    expect(html).not.toContain("保存");
    expect(html).not.toContain("数据目录");
    expect(html).not.toContain("Connected");
  });

  test("英文 locale 渲染通用页英文文案", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={{ ...settings, locale: "en" }}
        draft={{ ...draft, locale: "en" }}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={null}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={false}
        isApplyingPreparedUpdate={false}
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("General");
    expect(html).toContain("Silent start");
  });

  test("Service 页面保留运行态端口禁用提示", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={null}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={false}
        isApplyingPreparedUpdate={false}
        initialSection="service"
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("服务");
    expect(html).toContain("数据目录");
    expect(html).toContain("disabled");
    expect(html).not.toContain("登录时启动 Desktop");
  });

  test("Settings 页面不再静态渲染硬编码 Desktop 版本", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={null}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={false}
        isApplyingPreparedUpdate={false}
        initialSection="about"
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).not.toContain("0.0.1-preview.1");
    expect(html).toContain("正在读取版本");
    expect(html).toContain("app-icon-image");
    expect(html).toContain("/Untitled-macOS-Dark-1024@1x.png");
    expect(html).not.toContain("terminal-mark");
  });

  test("准备中时更新按钮显示 spinner 和准备中文案", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={{
          status: "Preparing",
          installScope: "Both",
          message: "正在后台准备组件更新",
          startedAt: "2026-06-18T10:00:00Z",
          finishedAt: null,
          error: null,
        }}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={true}
        isApplyingPreparedUpdate={false}
        initialSection="update"
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("准备中...");
    expect(html).toContain("button-spinner");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(">更新组件</button>");
  });

  test("准备完成时更新按钮显示重启", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={{
          status: "Ready",
          installScope: "Both",
          message: "组件更新已准备好，点击重启完成替换",
          startedAt: "2026-06-18T10:00:00Z",
          finishedAt: "2026-06-18T10:01:00Z",
          error: null,
        }}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={false}
        isApplyingPreparedUpdate={false}
        initialSection="update"
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain(">重启</button>");
    expect(html).not.toContain(">更新组件</button>");
  });

  test("应用中时更新按钮显示重启中文案", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        installResult={null}
        componentPreparation={{
          status: "Ready",
          installScope: "Both",
          message: "组件更新已准备好，点击重启完成替换",
          startedAt: "2026-06-18T10:00:00Z",
          finishedAt: "2026-06-18T10:01:00Z",
          error: null,
        }}
        error={null}
        isBusy={false}
        isCheckingUpdates={false}
        isPreparingUpdates={false}
        isApplyingPreparedUpdate={true}
        initialSection="update"
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPrepareUpdates={vi.fn()}
        onApplyPreparedUpdate={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("重启中...");
    expect(html).toContain("button-spinner");
    expect(html).not.toContain(">重启</button>");
  });
});
