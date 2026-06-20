import { describe, expect, test, vi } from "vitest";

import {
  canEditServicePort,
  createPortDraft,
  createSettingsStore,
  shouldAutoCheckUpdates,
  toSettingsPatch,
  validateServicePort,
  type SettingsCommands,
} from "./settingsStore";
import type {
  ComponentUpdatePreparationSnapshot,
  DesktopSettings,
  UpdateCheckResult,
} from "../bridge/types";

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
  locale: "zh-CN",
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

  test("静默启动反向生成 openPanelOnStart patch", () => {
    const draft = createPortDraft({ ...loadedSettings, openPanelOnStart: true });
    draft.silentStart = true;

    expect(toSettingsPatch({ ...loadedSettings, openPanelOnStart: true }, draft)).toEqual({
      openPanelOnStart: false,
    });
  });

  test("locale 变化生成设置 patch", () => {
    const draft = createPortDraft({ ...loadedSettings, locale: "zh-CN" });
    draft.locale = "en";

    expect(toSettingsPatch({ ...loadedSettings, locale: "zh-CN" }, draft)).toEqual({
      locale: "en",
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
      ...testSettingsCommands({ updateDesktopSettings }),
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
      ...testSettingsCommands({ updateDesktopSettings }),
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
      ...testSettingsCommands({ updateDesktopSettings }),
    });

    await store.load();
    store.setDraft({ autoCheckNewVersions: true });
    expect(store.getState().isBusy).toBe(true);

    store.setDraft({ portText: "8" });
    expect(store.getState().draft?.portText).toBe("8");

    resolveUpdate();
    await vi.waitFor(() => {
      expect(store.getState().isBusy).toBe(false);
    });

    expect(store.getState().settings?.autoCheckNewVersions).toBe(true);
    expect(store.getState().draft?.autoCheckNewVersions).toBe(true);
    expect(store.getState().draft?.portText).toBe("8");
  });

  test("autoStartApp 变更后同步系统登录项", async () => {
    const setAutoStartAppEnabled = vi.fn(async () => undefined);
    const store = createSettingsStore({
      ...testSettingsCommands({
        getAutoStartAppEnabled: vi.fn(async () => false),
        setAutoStartAppEnabled,
      }),
    });

    await store.load();
    store.setDraft({ autoStartApp: true });

    await vi.waitFor(() => {
      expect(setAutoStartAppEnabled).toHaveBeenCalledWith(true);
    });
  });

  test("autoStartApp 系统调用失败时不保存 settings", async () => {
    const updateDesktopSettings = vi.fn();
    const store = createSettingsStore({
      ...testSettingsCommands({
        getAutoStartAppEnabled: vi.fn(async () => false),
        setAutoStartAppEnabled: vi.fn(async () => {
          throw new Error("permission denied");
        }),
        updateDesktopSettings,
      }),
    });

    await store.load();
    store.setDraft({ autoStartApp: true });

    await vi.waitFor(() => {
      expect(store.getState().error).toContain("登录时启动设置失败");
    });
    expect(updateDesktopSettings).not.toHaveBeenCalled();
    expect(store.getState().draft?.autoStartApp).toBe(false);
  });

  test("settings 保存失败时回滚系统登录项", async () => {
    const setAutoStartAppEnabled = vi.fn(async () => undefined);
    const store = createSettingsStore({
      ...testSettingsCommands({
        getAutoStartAppEnabled: vi.fn(async () => false),
        setAutoStartAppEnabled,
        updateDesktopSettings: vi.fn(async () => {
          throw new Error("settings write failed");
        }),
      }),
    });

    await store.load();
    store.setDraft({ autoStartApp: true });

    await vi.waitFor(() => {
      expect(store.getState().error).toContain("登录时启动设置失败");
    });
    expect(setAutoStartAppEnabled).toHaveBeenNthCalledWith(1, true);
    expect(setAutoStartAppEnabled).toHaveBeenNthCalledWith(2, false);
    expect(store.getState().draft?.autoStartApp).toBe(false);
  });

  test("加载设置时恢复上一次更新检查结果", async () => {
    const cachedResult = updateResult("Both");
    const store = createSettingsStore({
      ...testSettingsCommands({
        getDesktopSettings: vi.fn(async () => ({
        ...loadedSettings,
        lastUpdateCheckAt: cachedResult.checkedAt,
        lastUpdateCheckResult: cachedResult,
        })),
      }),
    });

    await store.load();

    expect(store.getState().updateResult).toEqual(cachedResult);
  });

  test("load 时恢复已准备好的组件更新状态", async () => {
    const store = createSettingsStore({
      ...testSettingsCommands({
        checkForUpdates: vi.fn(async () => updateResult("Both")),
        getComponentUpdatePreparation: vi.fn(async () => ({
        status: "Ready" as const,
        installScope: "Both" as const,
        message: "组件更新已准备好，点击重启完成替换",
        startedAt: "2026-06-18T10:00:00Z",
        finishedAt: "2026-06-18T10:01:00Z",
        error: null,
        })),
        confirmPreparedComponentUpdateRestart: vi.fn(async () => true),
      }),
    });

    await store.load();

    expect(store.getState().componentPreparation?.status).toBe("Ready");
    expect(store.getState().isPreparingUpdates).toBe(false);
  });

  test("点击更新组件直接启动后台准备但不弹确认也不应用组件更新", async () => {
    const prepareUpstreamComponentUpdates = vi.fn(async () => ({
      status: "Preparing" as const,
      installScope: "CliRelay" as const,
      message: "正在后台准备组件更新",
      startedAt: "2026-06-18T10:00:00Z",
      finishedAt: null,
      error: null,
    }));
    const applyPreparedComponentUpdates = vi.fn();
    const confirmPreparedComponentUpdateRestart = vi.fn(async () => true);
    const store = createSettingsStore({
      ...testSettingsCommands({
        checkForUpdates: vi.fn(async () => updateResult("CliRelay")),
        prepareUpstreamComponentUpdates,
        applyPreparedComponentUpdates,
        confirmPreparedComponentUpdateRestart,
      }),
    });

    await store.load();
    await store.checkUpdates();
    await store.prepareUpdates();

    expect(prepareUpstreamComponentUpdates).toHaveBeenCalledWith("CliRelay");
    expect(confirmPreparedComponentUpdateRestart).not.toHaveBeenCalled();
    expect(applyPreparedComponentUpdates).not.toHaveBeenCalled();
    expect(store.getState().componentPreparation?.status).toBe("Preparing");
    expect(store.getState().isPreparingUpdates).toBe(true);
  });

  test("重复点击更新组件时不重复启动后台准备", async () => {
    let resolvePreparation!: (value: ComponentUpdatePreparationSnapshot) => void;
    const prepareUpstreamComponentUpdates = vi.fn(
      () =>
        new Promise<ComponentUpdatePreparationSnapshot>((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    const store = createSettingsStore({
      ...testSettingsCommands({
        checkForUpdates: vi.fn(async () => updateResult("Both")),
        prepareUpstreamComponentUpdates,
        confirmPreparedComponentUpdateRestart: vi.fn(async () => true),
      }),
    });

    await store.load();
    await store.checkUpdates();

    const firstPrepare = store.prepareUpdates();
    const secondPrepare = store.prepareUpdates();

    expect(prepareUpstreamComponentUpdates).toHaveBeenCalledTimes(1);
    expect(store.getState().isPreparingUpdates).toBe(true);

    resolvePreparation({
      status: "Ready",
      installScope: "Both",
      message: "组件更新已准备好，点击重启完成替换",
      startedAt: "2026-06-18T10:00:00Z",
      finishedAt: "2026-06-18T10:01:00Z",
      error: null,
    });
    await firstPrepare;
    await secondPrepare;

    expect(store.getState().componentPreparation?.status).toBe("Ready");
    expect(store.getState().isPreparingUpdates).toBe(false);
  });

  test("用户取消重启确认时不应用已准备好的组件更新", async () => {
    const applyPreparedComponentUpdates = vi.fn();
    const store = createSettingsStore({
      ...testSettingsCommands({
        checkForUpdates: vi.fn(async () => updateResult("Both")),
        getComponentUpdatePreparation: vi.fn(async () => ({
        status: "Ready" as const,
        installScope: "Both" as const,
        message: "组件更新已准备好，点击重启完成替换",
        startedAt: "2026-06-18T10:00:00Z",
        finishedAt: "2026-06-18T10:01:00Z",
        error: null,
        })),
        applyPreparedComponentUpdates,
        confirmPreparedComponentUpdateRestart: vi.fn(async () => false),
      }),
    });

    await store.load();
    await store.applyPreparedUpdate({ serviceStatus: "Running" });

    expect(applyPreparedComponentUpdates).not.toHaveBeenCalled();
    expect(store.getState().isApplyingPreparedUpdate).toBe(false);
  });

  test("确认重启后应用已准备好的组件更新", async () => {
    const applyPreparedComponentUpdates = vi.fn(async () => ({
      status: "Applied" as const,
      message: "组件更新已应用，正在重启 Desktop",
      appliedScope: "Both" as const,
    }));
    const confirmPreparedComponentUpdateRestart = vi.fn(async () => true);
    const store = createSettingsStore({
      ...testSettingsCommands({
        checkForUpdates: vi.fn(async () => updateResult("Both")),
        getComponentUpdatePreparation: vi.fn(async () => ({
        status: "Ready" as const,
        installScope: "Both" as const,
        message: "组件更新已准备好，点击重启完成替换",
        startedAt: "2026-06-18T10:00:00Z",
        finishedAt: "2026-06-18T10:01:00Z",
        error: null,
        })),
        applyPreparedComponentUpdates,
        confirmPreparedComponentUpdateRestart,
      }),
    });

    await store.load();
    await store.applyPreparedUpdate({ serviceStatus: "Running" });

    expect(confirmPreparedComponentUpdateRestart).toHaveBeenCalledWith({
      installScope: "Both",
      serviceStatus: "Running",
      locale: "zh-CN",
    });
    expect(applyPreparedComponentUpdates).toHaveBeenCalledTimes(1);
    expect(store.getState().installResult?.status).toBe("Applied");
    expect(store.getState().componentPreparation).toBeNull();
  });
});

function testSettingsCommands(overrides: Partial<SettingsCommands> = {}): SettingsCommands {
  return {
    getDesktopSettings: vi.fn(async () => loadedSettings),
    updateDesktopSettings: vi.fn(async (patch) => ({ ...loadedSettings, ...patch })),
    checkForUpdates: vi.fn(),
    getComponentUpdatePreparation: vi.fn(async () => idlePreparation()),
    prepareUpstreamComponentUpdates: vi.fn(),
    applyPreparedComponentUpdates: vi.fn(),
    confirmPreparedComponentUpdateRestart: vi.fn(),
    getAutoStartAppEnabled: vi.fn(async () => loadedSettings.autoStartApp),
    setAutoStartAppEnabled: vi.fn(async () => undefined),
    ...overrides,
  };
}

function idlePreparation(): ComponentUpdatePreparationSnapshot {
  return {
    status: "Idle",
    installScope: "None",
    message: "",
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

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
