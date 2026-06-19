export type ServiceStatus =
  | "Stopped"
  | "Starting"
  | "Running"
  | "Stopping"
  | "Unhealthy"
  | "External"
  | "Error";

export type ProcessOwnership = "Owned" | "External" | "Stale" | "Unknown";

export interface ServiceSnapshot {
  status: ServiceStatus;
  pid: number | null;
  port: number;
  endpoint: string;
  panelUrl: string;
  startedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  ownership: ProcessOwnership;
  clirelayVersion: string;
  codeProxyVersion: string;
  sidecarSha256: string;
}

export interface DesktopSettings {
  schemaVersion: number;
  firstRunCompleted: boolean;
  autoStartApp: boolean;
  autoStartService: boolean;
  openPanelOnStart: boolean;
  port: number;
  autoCheckNewVersions: boolean;
  lastUpdateCheckAt: string | null;
  lastUpdateCheckResult: UpdateCheckResult | null;
}

export interface DesktopSettingsPatch {
  autoStartApp?: boolean;
  autoStartService?: boolean;
  openPanelOnStart?: boolean;
  port?: number;
  autoCheckNewVersions?: boolean;
}

export type UpdateSubject = "Desktop" | "CliRelay" | "codeProxy";
export type DesktopUpdateAction = "OpenRelease" | "None";
export type UpstreamUpdateAction = "Check" | "InstallInDesktop" | "None";
export type UpdateStatus = "Unavailable" | "UpToDate" | "UpdateAvailable" | "Error";
export type UpstreamInstallScope = "None" | "CliRelay" | "codeProxy" | "Both";

export interface DesktopUpdateItem {
  subject: "Desktop";
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  message: string;
  releaseUrl: string | null;
  action: DesktopUpdateAction;
  releaseNotesSummary: string[];
}

export interface ComponentUpdateItem {
  subject: "CliRelay" | "codeProxy";
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  message: string;
  releaseUrl: string | null;
  assetName: string | null;
  assetSha256: string | null;
}

export interface UpstreamUpdateBlock {
  status: UpdateStatus;
  message: string;
  clirelay: ComponentUpdateItem;
  codeProxy: ComponentUpdateItem;
  installScope: UpstreamInstallScope;
  action: UpstreamUpdateAction;
}

export interface UpdateCheckResult {
  status: UpdateStatus;
  message: string;
  checkedAt: string;
  desktop: DesktopUpdateItem;
  upstream: UpstreamUpdateBlock;
}

export type ComponentPreparationStatus = "Idle" | "Preparing" | "Ready" | "Failed";

export interface ComponentUpdatePreparationSnapshot {
  status: ComponentPreparationStatus;
  installScope: UpstreamInstallScope;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ComponentApplyResult {
  status: "Applied" | "NoPreparedUpdate";
  message: string;
  appliedScope: UpstreamInstallScope;
}

export interface CommandErrorPayload {
  code?: string;
  details?: unknown;
}
