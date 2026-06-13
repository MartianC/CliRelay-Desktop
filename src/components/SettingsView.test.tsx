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
};

const draft: SettingsDraft = {
  autoStartApp: false,
  autoStartService: true,
  openPanelOnStart: true,
  portText: "8317",
  autoCheckNewVersions: false,
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
        error={null}
        isBusy={false}
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCheckUpdates={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("settings-layout");
    expect(html).toContain("settings-sidebar");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('style="--settings-accent:#1d4ed8"');
    expect(html).toContain("General");
    expect(html).toContain("Service");
    expect(html).toContain("Update");
    expect(html).toContain("About");
    expect(html).toContain("登录时启动 Desktop");
    expect(html).not.toContain("数据目录");
  });

  test("Service 页面保留运行态端口禁用提示", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        settings={settings}
        draft={draft}
        serviceSnapshot={snapshot}
        updateResult={null}
        error={null}
        isBusy={false}
        initialSection="service"
        onLoad={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCheckUpdates={vi.fn()}
        onOpenDataDirectory={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(html).toContain("Service");
    expect(html).toContain("数据目录");
    expect(html).toContain("disabled");
    expect(html).not.toContain("登录时启动 Desktop");
  });
});
