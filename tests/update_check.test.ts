import { invoke } from "@tauri-apps/api/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  checkForUpdates,
  installUpstreamComponentUpdates,
} from "../src/bridge/commands";
import type { DesktopSettings, ServiceSnapshot } from "../src/bridge/types";
import { formatUpdateCheckTime, SettingsView } from "../src/components/SettingsView";
import {
  createSettingsStore,
  type SettingsDraft,
} from "../src/stores/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("Task15 update bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("把 Rust 嵌套更新检查结果映射为前端 camelCase 类型", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "UpdateAvailable",
      message: "发现可用更新",
      checked_at: "2026-06-15T00:00:00Z",
      desktop: {
        subject: "Desktop",
        status: "UpdateAvailable",
        current_version: "0.0.1-preview.1",
        latest_version: "0.0.1-preview.2",
        message: "<b>纯文本</b>",
        release_url:
          "https://github.com/MartianC/CliRelay-Desktop/releases/tag/v0.0.1-preview.2",
        action: "OpenRelease",
        release_notes_summary: ["<b>只作为文本</b>"],
      },
      upstream: {
        status: "UpdateAvailable",
        message: "CliRelay 和 codeProxy 有更新",
        action: "InstallInDesktop",
        install_scope: "Both",
        clirelay: {
          subject: "CliRelay",
          status: "UpdateAvailable",
          current_version: "v0.4.0",
          latest_version: "v0.4.1",
          message: "CliRelay 可更新",
          release_url: "https://github.com/kittors/CliRelay/releases/tag/v0.4.1",
          asset_name: "CliRelay_0.4.1_darwin_arm64.tar.gz",
          asset_sha256: "a".repeat(64),
        },
        code_proxy: {
          subject: "codeProxy",
          status: "UpdateAvailable",
          current_version: "v0.4.0",
          latest_version: "v0.4.1",
          message: "codeProxy 可更新",
          release_url: "https://github.com/kittors/codeProxy/releases/tag/v0.4.1",
          asset_name: "panel-dist.zip",
          asset_sha256: "b".repeat(64),
        },
      },
    });

    await expect(checkForUpdates()).resolves.toMatchObject({
      status: "UpdateAvailable",
      checkedAt: "2026-06-15T00:00:00Z",
      desktop: {
        action: "OpenRelease",
        releaseNotesSummary: ["<b>只作为文本</b>"],
      },
      upstream: {
        action: "InstallInDesktop",
        installScope: "Both",
        codeProxy: {
          assetName: "panel-dist.zip",
        },
      },
    });
  });

  test("安装上游组件时只发送 scope 和重启确认", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "Success",
      message: "已更新上游组件",
      installed_scope: "CliRelay",
    });

    await installUpstreamComponentUpdates("CliRelay", true);

    expect(invokeMock).toHaveBeenCalledWith("install_upstream_component_updates", {
      installScope: "CliRelay",
      restartAfterInstall: true,
    });
  });
});

describe("Task15 settings store", () => {
  test("更新检查后可根据 installScope 调用安装命令", async () => {
    const installUpstreamComponentUpdates = vi.fn(async () => ({
      status: "Success" as const,
      message: "已更新",
      installedScope: "CliRelay" as const,
    }));
    const store = createSettingsStore({
      getDesktopSettings: vi.fn(async () => settings),
      updateDesktopSettings: vi.fn(),
      checkForUpdates: vi.fn(async () => updateResult("CliRelay")),
      installUpstreamComponentUpdates,
    });

    await store.load();
    await store.checkUpdates();
    await store.installUpdates(true);

    expect(installUpstreamComponentUpdates).toHaveBeenCalledWith("CliRelay", true);
    expect(store.getState().installResult?.message).toBe("已更新");
  });
});

describe("Task15 SettingsView update section", () => {
  test("按中文设计规范渲染状态条、上游组件表格和 Desktop 摘要", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsView, {
        settings: {
          ...settings,
          lastUpdateCheckAt: "2026-06-15T09:15:36.253908Z",
        },
        draft,
        serviceSnapshot: snapshot,
        updateResult: updateResult("Both"),
        installResult: null,
        error: null,
        isBusy: false,
        initialSection: "update",
        onDraftChange: vi.fn(),
        onCheckUpdates: vi.fn(),
        onInstallUpdates: vi.fn(),
        onOpenDataDirectory: vi.fn(),
        onOpenLogDirectory: vi.fn(),
      }),
    );

    expect(html).toContain("上次检查");
    expect(html).toContain("2026");
    expect(html).not.toContain("2026-06-15T09:15:36.253908Z");
    expect(html).toContain("每日自动检查");
    expect(html).toContain("上游组件");
    expect(html).toContain("组件");
    expect(html).toContain("状态");
    expect(html).toContain("当前版本");
    expect(html).toContain("最新版本");
    expect(html).toContain("发布页");
    expect(html).toContain("CliRelay");
    expect(html).toContain("codeProxy");
    expect(html).toContain("更新组件");
    expect(html).toContain("立即检查");
    expect(html).toContain("桌面预览版");
    expect(html).toContain("打开 GitHub Release");
    expect(html).toContain("external-link-icon");
    expect(html).not.toContain("Last checked");
    expect(html).not.toContain("Auto check daily");
    expect(html).not.toContain("Upstream components");
    expect(html).not.toContain("Desktop Preview");
    expect(html).not.toContain("CliRelay_0.4.1_darwin_arm64.tar.gz");
    expect(html).not.toContain("panel-dist.zip");
    expect(html).not.toContain("SHA-256");
    expect(html).not.toContain("只作为文本");
    expect(html).not.toContain("Release notes");
    expect(html).not.toContain("Install Desktop");
  });

  test("未检查时 Desktop 的立即检查按钮位于 Desktop block 内，不再渲染底部独立操作块", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsView, {
        settings,
        draft,
        serviceSnapshot: snapshot,
        updateResult: null,
        installResult: null,
        error: null,
        isBusy: false,
        initialSection: "update",
        onDraftChange: vi.fn(),
        onCheckUpdates: vi.fn(),
        onInstallUpdates: vi.fn(),
        onOpenDataDirectory: vi.fn(),
        onOpenLogDirectory: vi.fn(),
      }),
    );

    expect(html.match(/立即检查/g)).toHaveLength(2);
    expect(html).toContain("desktop-preview-block");
    expect(html).not.toContain("settings-actions");
  });

  test("上次检查时间格式化为可读本地格式", () => {
    const formatted = formatUpdateCheckTime(
      "2026-06-15T09:15:36.253908Z",
      "zh-CN",
      "UTC",
    );

    expect(formatted).toMatch(/2026.*06.*15.*09.*15.*36/);
    expect(formatted).not.toContain("T");
    expect(formatUpdateCheckTime(null)).toBe("未检查");
  });
});

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
};

const draft: SettingsDraft = {
  autoStartApp: false,
  autoStartService: true,
  openPanelOnStart: true,
  portText: "8317",
  autoCheckNewVersions: false,
};

const snapshot: ServiceSnapshot = {
  status: "Stopped",
  pid: null,
  port: 8317,
  endpoint: "http://127.0.0.1:8317",
  panelUrl: "http://127.0.0.1:8317/manage",
  startedAt: null,
  lastExitCode: null,
  lastError: null,
  ownership: "Unknown",
  clirelayVersion: "v0.4.0",
  codeProxyVersion: "v0.4.0",
  sidecarSha256: "abc123",
};

function updateResult(installScope: "None" | "CliRelay" | "codeProxy" | "Both") {
  return {
    status: installScope === "None" ? "UpToDate" : "UpdateAvailable",
    message: installScope === "None" ? "已是最新" : "发现上游组件更新",
    checkedAt: "2026-06-15T00:00:00Z",
    desktop: {
      subject: "Desktop" as const,
      status: "UpdateAvailable" as const,
      currentVersion: "0.0.1-preview.1",
      latestVersion: "0.0.1-preview.2",
      message: "<b>纯文本</b>",
      releaseUrl:
        "https://github.com/MartianC/CliRelay-Desktop/releases/tag/v0.0.1-preview.2",
      action: "OpenRelease" as const,
      releaseNotesSummary: ["<b>只作为文本</b>"],
    },
    upstream: {
      status: installScope === "None" ? "UpToDate" as const : "UpdateAvailable" as const,
      message: installScope === "None" ? "上游组件已是最新" : "可安装上游组件更新",
      action: installScope === "None" ? "Check" as const : "InstallInDesktop" as const,
      installScope,
      clirelay: {
        subject: "CliRelay" as const,
        status:
          installScope === "CliRelay" || installScope === "Both"
            ? "UpdateAvailable" as const
            : "UpToDate" as const,
        currentVersion: "v0.4.0",
        latestVersion: "v0.4.1",
        message: "CliRelay 可更新",
        releaseUrl: "https://github.com/kittors/CliRelay/releases/tag/v0.4.1",
        assetName: "CliRelay_0.4.1_darwin_arm64.tar.gz",
        assetSha256: "a".repeat(64),
      },
      codeProxy: {
        subject: "codeProxy" as const,
        status:
          installScope === "codeProxy" || installScope === "Both"
            ? "UpdateAvailable" as const
            : "UpToDate" as const,
        currentVersion: "v0.4.0",
        latestVersion: "v0.4.1",
        message: "codeProxy 可更新",
        releaseUrl: "https://github.com/kittors/codeProxy/releases/tag/v0.4.1",
        assetName: "panel-dist.zip",
        assetSha256: "b".repeat(64),
      },
    },
  };
}
