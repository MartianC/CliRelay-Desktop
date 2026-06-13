import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  getDesktopSettings,
  getServiceSnapshot,
  updateDesktopSettings,
} from "./commands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("desktop command bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("把 Rust service snapshot 映射为前端 camelCase 类型", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "Running",
      pid: 1234,
      port: 8317,
      endpoint: "http://127.0.0.1:8317",
      panel_url: "http://127.0.0.1:8317/manage",
      started_at: "2026-06-13T12:00:00Z",
      last_exit_code: null,
      last_error: null,
      ownership: "Owned",
      clirelay_version: "0.4.0",
      sidecar_sha256: "abc123",
    });

    await expect(getServiceSnapshot()).resolves.toEqual({
      status: "Running",
      pid: 1234,
      port: 8317,
      endpoint: "http://127.0.0.1:8317",
      panelUrl: "http://127.0.0.1:8317/manage",
      startedAt: "2026-06-13T12:00:00Z",
      lastExitCode: null,
      lastError: null,
      ownership: "Owned",
      clirelayVersion: "0.4.0",
      codeProxyVersion: "unknown",
      sidecarSha256: "abc123",
    });
    expect(invokeMock).toHaveBeenCalledWith("get_service_snapshot");
  });

  test("读取 Desktop settings 时隐藏 Rust snake_case 字段", async () => {
    invokeMock.mockResolvedValueOnce({
      schema_version: 1,
      first_run_completed: false,
      auto_start_app: true,
      auto_start_service: true,
      open_panel_on_start: false,
      port: 8318,
      auto_check_new_versions: true,
      last_update_check_at: "2026-06-13T12:00:00Z",
    });

    await expect(getDesktopSettings()).resolves.toEqual({
      schemaVersion: 1,
      firstRunCompleted: false,
      autoStartApp: true,
      autoStartService: true,
      openPanelOnStart: false,
      port: 8318,
      autoCheckNewVersions: true,
      lastUpdateCheckAt: "2026-06-13T12:00:00Z",
    });
  });

  test("更新 Desktop settings 时只发送 Rust 白名单 patch 字段", async () => {
    invokeMock.mockResolvedValueOnce({
      schema_version: 1,
      first_run_completed: false,
      auto_start_app: false,
      auto_start_service: true,
      open_panel_on_start: true,
      port: 8320,
      auto_check_new_versions: false,
      last_update_check_at: null,
    });

    await updateDesktopSettings({
      autoStartService: true,
      openPanelOnStart: true,
      port: 8320,
    });

    expect(invokeMock).toHaveBeenCalledWith("update_desktop_settings", {
      patch: {
        auto_start_service: true,
        open_panel_on_start: true,
        port: 8320,
      },
    });
  });
});
