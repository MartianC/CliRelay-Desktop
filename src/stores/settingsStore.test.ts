import { describe, expect, test, vi } from "vitest";

import {
  canEditServicePort,
  createPortDraft,
  createSettingsStore,
  shouldAutoCheckUpdates,
  toSettingsPatch,
  validateServicePort,
} from "./settingsStore";
import type { DesktopSettings, UpdateCheckResult } from "../bridge/types";

const loadedSettings: DesktopSettings = {
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

describe("settings store helpers", () => {
  test("只允许在 Stopped 状态编辑端口", () => {
    expect(canEditServicePort("Stopped")).toBe(true);
    expect(canEditServicePort("Running")).toBe(false);
    expect(canEditServicePort("Starting")).toBe(false);
    expect(canEditServicePort("Unhealthy")).toBe(false);
    expect(canEditServicePort("External")).toBe(false);
  });

  test("端口必须是 1024 到 65535 的整数", () => {
    expect(validateServicePort("1024")).toEqual({ ok: true, port: 1024 });
    expect(validateServicePort("65535")).toEqual({ ok: true, port: 65535 });
    expect(validateServicePort("1023")).toEqual({
      ok: false,
      message: "端口必须在 1024-65535 范围内",
    });
    expect(validateServicePort("65536")).toEqual({
      ok: false,
      message: "端口必须在 1024-65535 范围内",
    });
    expect(validateServicePort("8317.5")).toEqual({
      ok: false,
      message: "端口必须是整数",
    });
  });

  test("只为变化过的设置生成 patch", () => {
    const draft = createPortDraft(loadedSettings);
    draft.autoStartApp = true;
    draft.portText = "8320";

    expect(toSettingsPatch(loadedSettings, draft)).toEqual({
      autoStartApp: true,
      port: 8320,
    });
  });

  test("自动检查开启后每天最多触发一次", () => {
    const now = new Date("2026-06-15T12:00:00Z");

    expect(
      shouldAutoCheckUpdates(
        { ...loadedSettings, autoCheckNewVersions: false, lastUpdateCheckAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      shouldAutoCheckUpdates(
        { ...loadedSettings, autoCheckNewVersions: true, lastUpdateCheckAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      shouldAutoCheckUpdates(
        {
          ...loadedSettings,
          autoCheckNewVersions: true,
          lastUpdateCheckAt: "2026-06-15T00:00:00Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldAutoCheckUpdates(
        {
          ...loadedSettings,
          autoCheckNewVersions: true,
          lastUpdateCheckAt: "2026-06-14T11:59:59Z",
        },
        now,
      ),
    ).toBe(true);
  });

  test("draft 变更后立即保存有效设置", async () => {
    const updateDesktopSettings = vi.fn(async (patch) => ({
      ...loadedSettings,
      ...patch,
    }));
    const store = createSettingsStore({
      getDesktopSettings: vi.fn(async () => loadedSettings),
      updateDesktopSettings,
      checkForUpdates: vi.fn(),
      installUpstreamComponentUpdates: vi.fn(),
    });

    await store.load();
    store.setDraft({ autoStartApp: true });
    await vi.waitFor(() => {
      expect(updateDesktopSettings).toHaveBeenCalledWith({ autoStartApp: true });
    });

    expect(store.getState().settings?.autoStartApp).toBe(true);
    expect(store.getState().draft?.autoStartApp).toBe(true);
  });

  test("draft 端口无效时只更新输入草稿，不保存", async () => {
    const updateDesktopSettings = vi.fn(async (patch) => ({
      ...loadedSettings,
      ...patch,
    }));
    const store = createSettingsStore({
      getDesktopSettings: vi.fn(async () => loadedSettings),
      updateDesktopSettings,
      checkForUpdates: vi.fn(),
      installUpstreamComponentUpdates: vi.fn(),
    });

    await store.load();
    store.setDraft({ portText: "8" });

    expect(store.getState().draft?.portText).toBe("8");
    expect(updateDesktopSettings).not.toHaveBeenCalled();
  });

  test("后续无效草稿不会取消正在保存的有效设置", async () => {
    let resolveUpdate: () => void = () => {
      throw new Error("update promise 尚未创建");
    };
    const updateDesktopSettings = vi.fn(
      (patch) =>
        new Promise<DesktopSettings>((resolve) => {
          resolveUpdate = () => resolve({ ...loadedSettings, ...patch });
        }),
    );
    const store = createSettingsStore({
      getDesktopSettings: vi.fn(async () => loadedSettings),
      updateDesktopSettings,
      checkForUpdates: vi.fn(),
      installUpstreamComponentUpdates: vi.fn(),
    });

    await store.load();
    store.setDraft({ autoStartApp: true });
    expect(store.getState().isBusy).toBe(true);

    store.setDraft({ portText: "8" });
    expect(store.getState().draft?.portText).toBe("8");

    resolveUpdate();
    await vi.waitFor(() => {
      expect(store.getState().isBusy).toBe(false);
    });

    expect(store.getState().settings?.autoStartApp).toBe(true);
    expect(store.getState().draft?.autoStartApp).toBe(true);
    expect(store.getState().draft?.portText).toBe("8");
  });

  test("加载设置时恢复上一次更新检查结果", async () => {
    const cachedResult = updateResult("Both");
    const store = createSettingsStore({
      getDesktopSettings: vi.fn(async () => ({
        ...loadedSettings,
        lastUpdateCheckAt: cachedResult.checkedAt,
        lastUpdateCheckResult: cachedResult,
      })),
      updateDesktopSettings: vi.fn(),
      checkForUpdates: vi.fn(),
      installUpstreamComponentUpdates: vi.fn(),
    });

    await store.load();

    expect(store.getState().updateResult).toEqual(cachedResult);
  });
});

function updateResult(installScope: "None" | "CliRelay" | "codeProxy" | "Both"): UpdateCheckResult {
  return {
    status: installScope === "None" ? "UpToDate" : "UpdateAvailable",
    message: installScope === "None" ? "已是最新" : "发现上游组件更新",
    checkedAt: "2026-06-15T00:00:00Z",
    desktop: {
      subject: "Desktop",
      status: "UpToDate",
      currentVersion: "0.0.1-preview.1",
      latestVersion: "0.0.1-preview.1",
      message: "桌面预览版已是最新",
      releaseUrl: "https://github.com/MartianC/CliRelay-Desktop/releases/tag/v0.0.1-preview.1",
      action: "None",
      releaseNotesSummary: [],
    },
    upstream: {
      status: installScope === "None" ? "UpToDate" : "UpdateAvailable",
      message: installScope === "None" ? "上游组件已是最新" : "可安装上游组件更新",
      action: installScope === "None" ? "Check" : "InstallInDesktop",
      installScope,
      clirelay: {
        subject: "CliRelay",
        status:
          installScope === "CliRelay" || installScope === "Both"
            ? "UpdateAvailable"
            : "UpToDate",
        currentVersion: "v0.4.0",
        latestVersion: "v0.4.1",
        message: "CliRelay 可更新",
        releaseUrl: "https://github.com/kittors/CliRelay/releases/tag/v0.4.1",
        assetName: "CliRelay_0.4.1_darwin_arm64.tar.gz",
        assetSha256: "a".repeat(64),
      },
      codeProxy: {
        subject: "codeProxy",
        status:
          installScope === "codeProxy" || installScope === "Both"
            ? "UpdateAvailable"
            : "UpToDate",
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
