import { describe, expect, test, vi } from "vitest";

import {
  canEditServicePort,
  createPortDraft,
  createSettingsStore,
  toSettingsPatch,
  validateServicePort,
} from "./settingsStore";
import type { DesktopSettings } from "../bridge/types";

const loadedSettings: DesktopSettings = {
  schemaVersion: 1,
  firstRunCompleted: true,
  autoStartApp: false,
  autoStartService: true,
  openPanelOnStart: true,
  port: 8317,
  autoCheckNewVersions: false,
  lastUpdateCheckAt: null,
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

  test("draft 变更后立即保存有效设置", async () => {
    const updateDesktopSettings = vi.fn(async (patch) => ({
      ...loadedSettings,
      ...patch,
    }));
    const store = createSettingsStore({
      getDesktopSettings: vi.fn(async () => loadedSettings),
      updateDesktopSettings,
      checkForUpdates: vi.fn(),
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
});
