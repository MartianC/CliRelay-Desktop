import { invoke } from "@tauri-apps/api/core";

import type {
  ComponentInstallResult,
  ComponentUpdateItem,
  DesktopUpdateItem,
  DesktopSettings,
  DesktopSettingsPatch,
  ProcessOwnership,
  ServiceSnapshot,
  ServiceStatus,
  UpstreamInstallScope,
  UpstreamUpdateBlock,
  UpdateCheckResult,
  UpdateStatus,
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

interface RawDesktopUpdateItem {
  subject: "Desktop";
  status: UpdateStatus;
  current_version: string;
  latest_version: string | null;
  message: string;
  release_url: string | null;
  action: DesktopUpdateItem["action"];
  release_notes_summary?: string[];
}

interface RawComponentUpdateItem {
  subject: "CliRelay" | "codeProxy";
  status: UpdateStatus;
  current_version: string;
  latest_version: string | null;
  message: string;
  release_url: string | null;
  asset_name: string | null;
  asset_sha256: string | null;
}

interface RawUpstreamUpdateBlock {
  status: UpdateStatus;
  message: string;
  clirelay: RawComponentUpdateItem;
  code_proxy: RawComponentUpdateItem;
  install_scope: UpstreamInstallScope;
  action: UpstreamUpdateBlock["action"];
}

interface RawUpdateCheckResult {
  status: UpdateStatus;
  message: string;
  checked_at: string;
  desktop: RawDesktopUpdateItem;
  upstream: RawUpstreamUpdateBlock;
}

interface RawComponentInstallResult {
  status: ComponentInstallResult["status"];
  message: string;
  installed_scope: UpstreamInstallScope;
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
  return toUpdateCheckResult(await invoke<RawUpdateCheckResult>("check_for_updates"));
}

export async function installUpstreamComponentUpdates(
  installScope: UpstreamInstallScope,
  restartAfterInstall: boolean,
): Promise<ComponentInstallResult> {
  return toComponentInstallResult(
    await invoke<RawComponentInstallResult>("install_upstream_component_updates", {
      installScope,
      restartAfterInstall,
    }),
  );
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

function toUpdateCheckResult(raw: RawUpdateCheckResult): UpdateCheckResult {
  return {
    status: raw.status,
    message: raw.message,
    checkedAt: raw.checked_at,
    desktop: toDesktopUpdateItem(raw.desktop),
    upstream: toUpstreamUpdateBlock(raw.upstream),
  };
}

function toDesktopUpdateItem(raw: RawDesktopUpdateItem): DesktopUpdateItem {
  return {
    subject: raw.subject,
    status: raw.status,
    currentVersion: raw.current_version,
    latestVersion: raw.latest_version,
    message: raw.message,
    releaseUrl: raw.release_url,
    action: raw.action,
    releaseNotesSummary: raw.release_notes_summary ?? [],
  };
}

function toComponentUpdateItem(raw: RawComponentUpdateItem): ComponentUpdateItem {
  return {
    subject: raw.subject,
    status: raw.status,
    currentVersion: raw.current_version,
    latestVersion: raw.latest_version,
    message: raw.message,
    releaseUrl: raw.release_url,
    assetName: raw.asset_name,
    assetSha256: raw.asset_sha256,
  };
}

function toUpstreamUpdateBlock(raw: RawUpstreamUpdateBlock): UpstreamUpdateBlock {
  return {
    status: raw.status,
    message: raw.message,
    clirelay: toComponentUpdateItem(raw.clirelay),
    codeProxy: toComponentUpdateItem(raw.code_proxy),
    installScope: raw.install_scope,
    action: raw.action,
  };
}

function toComponentInstallResult(
  raw: RawComponentInstallResult,
): ComponentInstallResult {
  return {
    status: raw.status,
    message: raw.message,
    installedScope: raw.installed_scope,
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
