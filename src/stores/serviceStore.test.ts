import { describe, expect, test, vi } from "vitest";

import type { ServiceSnapshot } from "../bridge/types";
import { createServiceStore, shouldUseRecoveryView } from "./serviceStore";

const stoppedSnapshot: ServiceSnapshot = {
  status: "Stopped",
  pid: null,
  port: 8317,
  endpoint: "http://127.0.0.1:8317",
  panelUrl: "http://127.0.0.1:8317/manage",
  startedAt: null,
  lastExitCode: null,
  lastError: null,
  ownership: "Unknown",
  clirelayVersion: "0.4.0",
  codeProxyVersion: "0.4.0",
  sidecarSha256: "abc123",
};

describe("service store", () => {
  test("refresh 会写入 snapshot 并清空旧错误", async () => {
    const store = createServiceStore({
      getServiceSnapshot: vi.fn().mockResolvedValue(stoppedSnapshot),
      startService: vi.fn(),
      stopService: vi.fn(),
      restartService: vi.fn(),
      openPanel: vi.fn(),
    });

    await store.refresh();

    expect(store.getState()).toMatchObject({
      snapshot: stoppedSnapshot,
      error: null,
      isBusy: false,
    });
  });

  test("命令失败时保留短错误并停止 busy 状态", async () => {
    const store = createServiceStore({
      getServiceSnapshot: vi.fn().mockRejectedValue(new Error("boom")),
      startService: vi.fn(),
      stopService: vi.fn(),
      restartService: vi.fn(),
      openPanel: vi.fn(),
    });

    await store.refresh();

    expect(store.getState()).toMatchObject({
      snapshot: null,
      error: "boom",
      isBusy: false,
    });
  });

  test("只有非 Running 状态默认进入恢复状态页", () => {
    expect(shouldUseRecoveryView("Running")).toBe(false);
    expect(shouldUseRecoveryView("Stopped")).toBe(true);
    expect(shouldUseRecoveryView("Unhealthy")).toBe(true);
    expect(shouldUseRecoveryView("Error")).toBe(true);
    expect(shouldUseRecoveryView("External")).toBe(true);
  });
});
