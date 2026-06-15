import { useState, type CSSProperties, type ReactNode } from "react";

import type {
  ComponentInstallResult,
  ComponentUpdateItem,
  DesktopSettings,
  ServiceSnapshot,
  UpdateCheckResult,
} from "../bridge/types";
import type { SettingsDraft } from "../stores/settingsStore";
import { canEditServicePort, validateServicePort } from "../stores/settingsStore";
import { FieldRow } from "./FieldRow";

interface SettingsViewProps {
  settings: DesktopSettings | null;
  draft: SettingsDraft | null;
  serviceSnapshot: ServiceSnapshot | null;
  updateResult: UpdateCheckResult | null;
  installResult: ComponentInstallResult | null;
  error: string | null;
  isBusy: boolean;
  onLoad?: () => void | Promise<void>;
  onDraftChange: (patch: Partial<SettingsDraft>) => void;
  onCheckUpdates: () => void | Promise<void>;
  onInstallUpdates: (restartAfterInstall: boolean) => void | Promise<void>;
  onOpenDataDirectory: () => void | Promise<void>;
  onOpenLogDirectory: () => void | Promise<void>;
  initialSection?: SettingsSectionId;
}

const desktopVersion = "0.0.1-preview.1";
const settingsAccent = "#1d4ed8";

type SettingsSectionId = "general" | "service" | "update" | "about";

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "General" },
  { id: "service", label: "Service" },
  { id: "update", label: "Update" },
  { id: "about", label: "About" },
];

export function SettingsView(props: SettingsViewProps) {
  const {
    settings,
    draft,
    serviceSnapshot,
    updateResult,
    installResult,
    error,
    isBusy,
    onDraftChange,
    onCheckUpdates,
    onInstallUpdates,
    onOpenDataDirectory,
    onOpenLogDirectory,
    initialSection = "general",
  } = props;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const status = serviceSnapshot?.status ?? "Stopped";
  const canEditPort = canEditServicePort(status);
  const portValidation = draft ? validateServicePort(draft.portText) : null;
  const activeLabel = settingsSections.find((section) => section.id === activeSection)?.label ?? "General";

  return (
    <main
      className="settings-shell"
      style={{ "--settings-accent": settingsAccent } as CSSProperties}
    >
      {!settings || !draft ? (
        <section className="surface empty-state">正在读取设置…</section>
      ) : (
        <div className="settings-layout">
          <aside className="settings-sidebar" aria-label="Settings navigation">
            <div className="settings-sidebar-title">CliRelay</div>
            <nav className="settings-nav">
              {settingsSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="settings-nav-item"
                  aria-current={activeSection === section.id ? "page" : undefined}
                  onClick={() => setActiveSection(section.id)}
                >
                  <NavIcon id={section.id} />
                  <span>{section.label}</span>
                </button>
              ))}
            </nav>
            <div className="settings-sidebar-status">
              <span />
              Connected
            </div>
          </aside>

          <section className="settings-content" aria-labelledby="settings-section-title">
            <header className="settings-content-header">
              <div>
                <p className="eyebrow">{activeLabel}</p>
                <h2 id="settings-section-title">{activeLabel}</h2>
              </div>
            </header>

            {activeSection === "general" ? (
              <SettingsPanel title="Startup">
                <ToggleRow
                  label="登录时启动 Desktop"
                  description="Launch CliRelay Desktop when you log in"
                  checked={draft.autoStartApp}
                  onChange={(autoStartApp) => onDraftChange({ autoStartApp })}
                />
                <ToggleRow
                  label="启动后自动启动服务"
                  description="Start CliRelay service when the app opens"
                  checked={draft.autoStartService}
                  onChange={(autoStartService) => onDraftChange({ autoStartService })}
                />
                <ToggleRow
                  label="启动时打开管理面板"
                  description="Automatically open panel when ready"
                  checked={draft.openPanelOnStart}
                  onChange={(openPanelOnStart) => onDraftChange({ openPanelOnStart })}
                />
              </SettingsPanel>
            ) : null}

            {activeSection === "service" ? (
              <>
                <SettingsPanel title="Runtime">
                  <dl className="field-list compact">
                    <FieldRow label="状态" value={status} />
                    <FieldRow label="端口">
                      <input
                        className="port-input"
                        value={draft.portText}
                        disabled={!canEditPort}
                        inputMode="numeric"
                        onChange={(event) => onDraftChange({ portText: event.currentTarget.value })}
                      />
                    </FieldRow>
                    <FieldRow label="Desktop 版本" value={desktopVersion} mono />
                    <FieldRow label="CliRelay 版本" value={serviceSnapshot?.clirelayVersion} mono />
                    <FieldRow label="Sidecar SHA-256" value={serviceSnapshot?.sidecarSha256} mono />
                  </dl>
                  {!canEditPort ? (
                    <p className="hint">Running / Starting / Unhealthy / External 状态下端口不可编辑。</p>
                  ) : null}
                  {portValidation && !portValidation.ok ? (
                    <p className="inline-error">{portValidation.message}</p>
                  ) : null}
                </SettingsPanel>
                <div className="settings-actions">
                  <button type="button" className="secondary" onClick={() => void onOpenDataDirectory()}>
                    打开数据目录
                  </button>
                  <button type="button" className="secondary" onClick={() => void onOpenLogDirectory()}>
                    打开日志目录
                  </button>
                </div>
              </>
            ) : null}

            {activeSection === "update" ? (
              <>
                <section className="update-status-strip" aria-label="Update status">
                  <span>
                    Last checked: <strong>{settings.lastUpdateCheckAt ?? "—"}</strong>
                  </span>
                  <ToggleRow
                    label="Auto check daily"
                    checked={draft.autoCheckNewVersions}
                    onChange={(autoCheckNewVersions) => onDraftChange({ autoCheckNewVersions })}
                  />
                </section>

                <section className="update-block" aria-labelledby="upstream-title">
                  <div className="update-block-header">
                    <div>
                      <h3 id="upstream-title">Upstream components</h3>
                      <p>{installResult?.message ?? updateResult?.upstream.message ?? "Not checked yet"}</p>
                    </div>
                    <div className="update-header-actions">
                      {updateResult?.upstream.action === "InstallInDesktop" ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void onInstallUpdates(true)}
                        >
                          Update components
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary"
                        disabled={isBusy}
                        onClick={() => void onCheckUpdates()}
                      >
                        Check now
                      </button>
                    </div>
                  </div>
                  <div className="component-update-table" role="table" aria-label="Upstream components">
                    <div className="component-update-row component-update-head" role="row">
                      <span role="columnheader">Component</span>
                      <span role="columnheader">Status</span>
                      <span role="columnheader">Current</span>
                      <span role="columnheader">Latest</span>
                      <span role="columnheader">Release</span>
                    </div>
                    <ComponentUpdateRow
                      name="CliRelay"
                      item={updateResult?.upstream.clirelay ?? null}
                      currentVersion={serviceSnapshot?.clirelayVersion ?? "unknown"}
                    />
                    <ComponentUpdateRow
                      name="codeProxy"
                      item={updateResult?.upstream.codeProxy ?? null}
                      currentVersion={serviceSnapshot?.codeProxyVersion ?? "unknown"}
                    />
                  </div>
                </section>

                <section className="update-block desktop-preview-block" aria-labelledby="desktop-preview-title">
                  <div className="update-block-header">
                    <div>
                      <h3 id="desktop-preview-title">Desktop Preview</h3>
                      <p>{updateResult?.desktop.message ?? "Not checked yet"}</p>
                    </div>
                  </div>
                  <div className="desktop-preview-summary">
                    <div>
                      <span>Current</span>
                      <strong>{desktopVersion}</strong>
                    </div>
                    <div>
                      <span>Latest</span>
                      <strong>{updateResult?.desktop.latestVersion ?? "—"}</strong>
                    </div>
                    <a
                      className="button secondary"
                      href={updateResult?.desktop.releaseUrl ?? "https://github.com/MartianC/CliRelay-Desktop/releases"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open GitHub Release
                    </a>
                  </div>
                </section>

                {!updateResult ? (
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={isBusy}
                      onClick={() => void onCheckUpdates()}
                    >
                      Check now
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeSection === "about" ? (
              <>
                <section className="settings-about-card">
                  <div className="startup-app-icon" aria-hidden="true">
                    <span className="terminal-mark">&gt;_</span>
                    <span className="icon-status-dot status-running" />
                  </div>
                  <div>
                    <h3>CliRelay Desktop</h3>
                    <p>CliRelay Desktop 是独立的非官方桌面伴侣。</p>
                  </div>
                </section>
                <SettingsPanel title="Product">
                  <dl className="field-list compact">
                    <FieldRow label="App" value="CliRelay Desktop" />
                    <FieldRow label="版本" value={desktopVersion} mono />
                    <FieldRow label="Channel" value="Preview" />
                    <FieldRow label="上游项目" value="CliRelay / codeProxy" />
                    <FieldRow label="License" value="见 THIRD_PARTY_NOTICES.md" />
                  </dl>
                </SettingsPanel>
              </>
            ) : null}
          </section>
        </div>
      )}

      {error ? <p className="inline-error">{error}</p> : null}
    </main>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface ComponentUpdateRowProps {
  name: string;
  item: ComponentUpdateItem | null;
  currentVersion: string;
}

function ComponentUpdateRow({
  name,
  item,
  currentVersion,
}: ComponentUpdateRowProps) {
  return (
    <div className="component-update-row" role="row">
      <strong role="cell">{name}</strong>
      <span role="cell">
        <UpdateStatusPill status={item?.status ?? "Unavailable"} label={item?.message ?? "Not checked"} />
      </span>
      <code role="cell">{item?.currentVersion ?? currentVersion}</code>
      <code role="cell">{item?.latestVersion ?? "—"}</code>
      <span role="cell">
        {item?.releaseUrl ? (
          <a href={item.releaseUrl} target="_blank" rel="noreferrer">
            {item.latestVersion ?? "Release"}
          </a>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}

function UpdateStatusPill({
  status,
  label,
}: {
  status: ComponentUpdateItem["status"];
  label: string;
}) {
  return <span className={`update-status-pill status-${status.toLowerCase()}`}>{label}</span>;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        className="toggle-input"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="toggle-control" aria-hidden="true" />
    </label>
  );
}

interface SettingsPanelProps {
  title: string;
  children: ReactNode;
}

function SettingsPanel({ title, children }: SettingsPanelProps) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function NavIcon({ id }: { id: SettingsSectionId }) {
  return (
    <svg className="settings-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {id === "general" ? (
        <>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
        </>
      ) : null}
      {id === "service" ? (
        <>
          <rect x="5" y="4" width="14" height="5" rx="1.5" />
          <rect x="5" y="15" width="14" height="5" rx="1.5" />
          <path d="M8 9v6M16 9v6M8 6.5h.01M8 17.5h.01" />
        </>
      ) : null}
      {id === "update" ? (
        <>
          <path d="M6 15.5a5 5 0 0 1 8.7-4.5A3.8 3.8 0 0 1 20 14.5c0 2-1.6 3.5-3.6 3.5H7.4A3.4 3.4 0 0 1 6 11.5" />
          <path d="M12 7v7M9.5 11.5 12 14l2.5-2.5" />
        </>
      ) : null}
      {id === "about" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 10.5v5M12 7.5h.01" />
        </>
      ) : null}
    </svg>
  );
}
