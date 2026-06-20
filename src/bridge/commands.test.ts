import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  applyPreparedComponentUpdates,
  confirmPreparedComponentUpdateRestart,
  getDesktopVersion,
  getComponentUpdatePreparation,
  getDesktopSettings,
  getManagementSecretStatus,
  getServiceSnapshot,
  openExternalUrl,
  prepareUpstreamComponentUpdates,
  quitDesktop,
  setManagementSecretKey,
  updateDesktopSettings,
} from "./commands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const getVersionMock = vi.mocked(getVersion);
const confirmMock = vi.mocked(confirm);
const openUrlMock = vi.mocked(openUrl);

describe("desktop command bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getVersionMock.mockReset();
    confirmMock.mockReset();
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
      locale: "en",
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
      locale: "en",
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
      locale: "zh-CN",
    });

    await updateDesktopSettings({
      autoStartService: true,
      openPanelOnStart: true,
      port: 8320,
      locale: "en",
    });

    expect(invokeMock).toHaveBeenCalledWith("update_desktop_settings", {
      patch: {
        auto_start_service: true,
        open_panel_on_start: true,
        port: 8320,
        locale: "en",
      },
    });
  });

  test("管理密钥命令映射 Rust 参数", async () => {
    invokeMock.mockResolvedValueOnce("missing").mockResolvedValueOnce("configured");

    await expect(getManagementSecretStatus()).resolves.toBe("missing");
    await expect(setManagementSecretKey("  abc  ")).resolves.toBe("configured");
    await quitDesktop();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_management_secret_status");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "set_management_secret_key", {
      secretKey: "  abc  ",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "quit_desktop");
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

  test("组件重启确认框说明确认后才停止服务替换组件", async () => {
    confirmMock.mockResolvedValueOnce(true);

    await expect(
      confirmPreparedComponentUpdateRestart({
        installScope: "Both",
        serviceStatus: "Running",
        locale: "zh-CN",
      }),
    ).resolves.toBe(true);

    expect(confirmMock).toHaveBeenCalledWith(
      [
        "CliRelay 和 codeProxy 更新已准备好。",
        "确认重启后会停止相关服务、替换已准备好的组件，并重启 Desktop 应用。",
        "当前 CliRelay 服务正在运行，重启前会先停止服务。",
        "现在重启并应用更新吗？",
      ].join("\n"),
      {
        title: "确认重启并应用更新",
        kind: "warning",
        okLabel: "重启",
        cancelLabel: "取消",
      },
    );
  });

  test("codeProxy-only 重启确认不提示停止 CliRelay 服务", async () => {
    confirmMock.mockResolvedValueOnce(true);

    await confirmPreparedComponentUpdateRestart({
      installScope: "codeProxy",
      serviceStatus: "Running",
      locale: "zh-CN",
    });

    expect(confirmMock).toHaveBeenCalledWith(
      [
        "codeProxy 更新已准备好。",
        "确认重启后会停止相关服务、替换已准备好的组件，并重启 Desktop 应用。",
        "现在重启并应用更新吗？",
      ].join("\n"),
      {
        title: "确认重启并应用更新",
        kind: "info",
        okLabel: "重启",
        cancelLabel: "取消",
      },
    );
  });

  test("准备、查询和应用组件更新命令映射 Rust 参数", async () => {
    invokeMock
      .mockResolvedValueOnce({
        status: "Preparing",
        install_scope: "CliRelay",
        message: "正在后台准备组件更新",
        started_at: "2026-06-18T10:00:00Z",
        finished_at: null,
        error: null,
      })
      .mockResolvedValueOnce({
        status: "Ready",
        install_scope: "CliRelay",
        message: "组件更新已准备好，点击重启完成替换",
        started_at: "2026-06-18T10:00:00Z",
        finished_at: "2026-06-18T10:01:00Z",
        error: null,
      })
      .mockResolvedValueOnce({
        status: "Applied",
        message: "组件更新已应用，正在重启 Desktop",
        applied_scope: "CliRelay",
      });

    await expect(prepareUpstreamComponentUpdates("CliRelay")).resolves.toMatchObject({
      status: "Preparing",
      installScope: "CliRelay",
      startedAt: "2026-06-18T10:00:00Z",
    });
    await expect(getComponentUpdatePreparation()).resolves.toMatchObject({
      status: "Ready",
      installScope: "CliRelay",
      finishedAt: "2026-06-18T10:01:00Z",
    });
    await expect(applyPreparedComponentUpdates()).resolves.toMatchObject({
      status: "Applied",
      appliedScope: "CliRelay",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "prepare_upstream_component_updates",
      { installScope: "CliRelay" },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_component_update_preparation");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "apply_prepared_component_updates");
  });
});
