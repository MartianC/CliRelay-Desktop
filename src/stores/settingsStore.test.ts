import { describe, expect, test } from "vitest";

import {
  canEditServicePort,
  createPortDraft,
  toSettingsPatch,
  validateServicePort,
} from "./settingsStore";

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
    const current = {
      schemaVersion: 1,
      firstRunCompleted: true,
      autoStartApp: false,
      autoStartService: true,
      openPanelOnStart: true,
      port: 8317,
      autoCheckNewVersions: false,
      lastUpdateCheckAt: null,
    };

    const draft = createPortDraft(current);
    draft.autoStartApp = true;
    draft.portText = "8320";

    expect(toSettingsPatch(current, draft)).toEqual({
      autoStartApp: true,
      port: 8320,
    });
  });
});
