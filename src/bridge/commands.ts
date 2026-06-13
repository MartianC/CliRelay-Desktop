import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopSettings,
  DesktopSettingsPatch,
  ProcessOwnership,
  ServiceSnapshot,
  ServiceStatus,
  UpdateCheckResult,
} from "./types";

interface RawServiceSnapshot {
  status: ServiceStatus;
  pid: number | null;
  port: number;
  endpoint: string;
  panel_url: string;
  started_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
  ownership: ProcessOwnership;
  clirelay_version: string;
  code_proxy_version?: string;
  sidecar_sha256: string;
}

interface RawDesktopSettings {
  schema_version: number;
  first_run_completed: boolean;
  auto_start_app: boolean;
  auto_start_service: boolean;
  open_panel_on_start: boolean;
  port: number;
  auto_check_new_versions: boolean;
  last_update_check_at: string | null;
}

interface RawUpdateCheckResult {
  status?: UpdateCheckResult["status"];
  message?: string;
  checked_at?: string;
  release_url?: string | null;
}

export async function getServiceSnapshot(): Promise<ServiceSnapshot> {
  return toServiceSnapshot(await invoke<RawServiceSnapshot>("get_service_snapshot"));
}

export async function startService(): Promise<ServiceSnapshot> {
  return toServiceSnapshot(await invoke<RawServiceSnapshot>("start_service"));
}

export async function stopService(): Promise<ServiceSnapshot> {
  return toServiceSnapshot(await invoke<RawServiceSnapshot>("stop_service"));
}

export async function restartService(): Promise<ServiceSnapshot> {
  return toServiceSnapshot(await invoke<RawServiceSnapshot>("restart_service"));
}

export async function openPanel(): Promise<void> {
  await invoke<string>("open_panel");
}

export async function openSettings(): Promise<void> {
  await invoke("open_settings");
}

export async function openLogDirectory(): Promise<void> {
  await invoke("open_log_directory");
}

export async function openDataDirectory(): Promise<void> {
  await invoke("open_data_directory");
}

export async function copyEndpoint(): Promise<void> {
  const endpoint = await invoke<string>("copy_endpoint");
  await writeClipboard(endpoint);
}

export async function copyV1Endpoint(): Promise<void> {
  const endpoint = await invoke<string>("copy_v1_endpoint");
  await writeClipboard(endpoint);
}

export async function getDesktopSettings(): Promise<DesktopSettings> {
  return toDesktopSettings(await invoke<RawDesktopSettings>("get_desktop_settings"));
}

export async function updateDesktopSettings(
  patch: DesktopSettingsPatch,
): Promise<DesktopSettings> {
  return toDesktopSettings(
    await invoke<RawDesktopSettings>("update_desktop_settings", {
      patch: toRawSettingsPatch(patch),
    }),
  );
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const result = await invoke<RawUpdateCheckResult | null>("check_for_updates");

  return {
    status: result?.status ?? "Unavailable",
    message: result?.message ?? "Preview 更新检查尚未接入",
    checkedAt: result?.checked_at ?? new Date().toISOString(),
    releaseUrl: result?.release_url ?? null,
  };
}

function toServiceSnapshot(raw: RawServiceSnapshot): ServiceSnapshot {
  return {
    status: raw.status,
    pid: raw.pid,
    port: raw.port,
    endpoint: raw.endpoint,
    panelUrl: raw.panel_url,
    startedAt: raw.started_at,
    lastExitCode: raw.last_exit_code,
    lastError: raw.last_error,
    ownership: raw.ownership,
    clirelayVersion: raw.clirelay_version,
    codeProxyVersion: raw.code_proxy_version ?? "unknown",
    sidecarSha256: raw.sidecar_sha256,
  };
}

function toDesktopSettings(raw: RawDesktopSettings): DesktopSettings {
  return {
    schemaVersion: raw.schema_version,
    firstRunCompleted: raw.first_run_completed,
    autoStartApp: raw.auto_start_app,
    autoStartService: raw.auto_start_service,
    openPanelOnStart: raw.open_panel_on_start,
    port: raw.port,
    autoCheckNewVersions: raw.auto_check_new_versions,
    lastUpdateCheckAt: raw.last_update_check_at,
  };
}

function toRawSettingsPatch(
  patch: DesktopSettingsPatch,
): Partial<RawDesktopSettings> {
  const raw: Partial<RawDesktopSettings> = {};

  if (patch.autoStartApp !== undefined) {
    raw.auto_start_app = patch.autoStartApp;
  }
  if (patch.autoStartService !== undefined) {
    raw.auto_start_service = patch.autoStartService;
  }
  if (patch.openPanelOnStart !== undefined) {
    raw.open_panel_on_start = patch.openPanelOnStart;
  }
  if (patch.port !== undefined) {
    raw.port = patch.port;
  }
  if (patch.autoCheckNewVersions !== undefined) {
    raw.auto_check_new_versions = patch.autoCheckNewVersions;
  }

  return raw;
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
}
