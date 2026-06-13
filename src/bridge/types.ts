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
}

export interface DesktopSettingsPatch {
  autoStartApp?: boolean;
  autoStartService?: boolean;
  openPanelOnStart?: boolean;
  port?: number;
  autoCheckNewVersions?: boolean;
}

export interface UpdateCheckResult {
  status: "Unavailable" | "UpToDate" | "UpdateAvailable" | "Error";
  message: string;
  checkedAt: string;
  releaseUrl: string | null;
}

export interface CommandErrorPayload {
  code?: string;
  details?: unknown;
}
