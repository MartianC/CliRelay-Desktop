import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  getDesktopVersion,
  getDesktopSettings,
  getServiceSnapshot,
  openExternalUrl,
  updateDesktopSettings,
} from "./commands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const getVersionMock = vi.mocked(getVersion);
const openUrlMock = vi.mocked(openUrl);

describe("desktop command bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getVersionMock.mockReset();
    openUrlMock.mockReset();
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
      last_update_check_result: {
        status: "UpToDate",
        message: "已是最新",
        checked_at: "2026-06-13T12:00:00Z",
        desktop: {
          subject: "Desktop",
          status: "UpToDate",
          current_version: "0.0.1-preview.1",
          latest_version: "0.0.1-preview.1",
          message: "桌面预览版已是最新",
          release_url:
            "https://github.com/MartianC/CliRelay-Desktop/releases/tag/v0.0.1-preview.1",
          action: "None",
          release_notes_summary: [],
        },
        upstream: {
          status: "UpToDate",
          message: "上游组件已是最新",
          clirelay: {
            subject: "CliRelay",
            status: "UpToDate",
            current_version: "v0.4.0",
            latest_version: "v0.4.0",
            message: "CliRelay 已是最新",
            release_url: "https://github.com/kittors/CliRelay/releases/tag/v0.4.0",
            asset_name: null,
            asset_sha256: null,
          },
          code_proxy: {
            subject: "codeProxy",
            status: "UpToDate",
            current_version: "v0.4.0",
            latest_version: "v0.4.0",
            message: "codeProxy 已是最新",
            release_url: "https://github.com/kittors/codeProxy/releases/tag/v0.4.0",
            asset_name: null,
            asset_sha256: null,
          },
          install_scope: "None",
          action: "Check",
        },
      },
    });

    const result = await getDesktopSettings();

    expect(result).toMatchObject({
      schemaVersion: 1,
      firstRunCompleted: false,
      autoStartApp: true,
      autoStartService: true,
      openPanelOnStart: false,
      port: 8318,
      autoCheckNewVersions: true,
      lastUpdateCheckAt: "2026-06-13T12:00:00Z",
      lastUpdateCheckResult: {
        checkedAt: "2026-06-13T12:00:00Z",
        upstream: {
          codeProxy: {
            releaseUrl: "https://github.com/kittors/codeProxy/releases/tag/v0.4.0",
          },
        },
      },
    });
    expect(result).not.toHaveProperty("last_update_check_result");
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

  test("外部网页通过 Tauri opener 交给系统浏览器打开", async () => {
    await openExternalUrl("https://github.com/MartianC/CliRelay-Desktop/releases");

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/MartianC/CliRelay-Desktop/releases",
    );
  });

  test("读取 Desktop 版本时使用 Tauri App metadata", async () => {
    getVersionMock.mockResolvedValueOnce("0.0.2-preview.3");

    await expect(getDesktopVersion()).resolves.toBe("0.0.2-preview.3");
    expect(getVersionMock).toHaveBeenCalledTimes(1);
  });
});
