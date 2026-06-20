import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type {
  ComponentApplyResult,
  ComponentUpdatePreparationSnapshot,
  ComponentUpdateItem,
  DesktopLocale,
  DesktopSettings,
  ServiceSnapshot,
  ServiceStatus,
  UpdateCheckResult,
  UpdateStatus,
} from "../bridge/types";
import { getDesktopVersion, openExternalUrl } from "../bridge/commands";
import type {
  ComponentPreparedUpdateApplyOptions,
  SettingsDraft,
} from "../stores/settingsStore";
import { canEditServicePort, validateServicePort } from "../stores/settingsStore";
import { localeLabels, tForLocale, type MessageKey } from "../i18n/locales";
import { FieldRow } from "./FieldRow";

interface SettingsViewProps {
  settings: DesktopSettings | null;
  draft: SettingsDraft | null;
  serviceSnapshot: ServiceSnapshot | null;
  updateResult: UpdateCheckResult | null;
  installResult: ComponentApplyResult | null;
  componentPreparation: ComponentUpdatePreparationSnapshot | null;
  error: string | null;
  isBusy: boolean;
  isCheckingUpdates: boolean;
  isPreparingUpdates: boolean;
  isApplyingPreparedUpdate: boolean;
  onLoad?: () => void | Promise<void>;
  onDraftChange: (patch: Partial<SettingsDraft>) => void;
  onCheckUpdates: () => void | Promise<void>;
  onPrepareUpdates: () => void | Promise<void>;
  onApplyPreparedUpdate: (options: ComponentPreparedUpdateApplyOptions) => void | Promise<void>;
  onOpenDataDirectory: () => void | Promise<void>;
  onOpenLogDirectory: () => void | Promise<void>;
  initialSection?: SettingsSectionId;
}

const settingsAccent = "#1d4ed8";

type SettingsSectionId = "general" | "service" | "update" | "about";

const settingsSections: SettingsSectionId[] = ["general", "service", "update", "about"];

const serviceStatusLabels: Record<ServiceStatus, string> = {
  Stopped: "已停止",
  Starting: "启动中",
  Running: "运行中",
  Stopping: "停止中",
  Unhealthy: "异常",
  External: "外部占用",
  Error: "错误",
};

const serviceStatusLabelsEn: Record<ServiceStatus, string> = {
  Stopped: "Stopped",
  Starting: "Starting",
  Running: "Running",
  Stopping: "Stopping",
  Unhealthy: "Unhealthy",
  External: "External",
  Error: "Error",
};

const desktopReleaseFallbackUrl = "https://github.com/MartianC/CliRelay-Desktop/releases";

export function SettingsView(props: SettingsViewProps) {
  const {
    settings,
    draft,
    serviceSnapshot,
    updateResult,
    installResult,
    componentPreparation,
    error,
    isBusy,
    isCheckingUpdates,
    isPreparingUpdates,
    isApplyingPreparedUpdate,
    onDraftChange,
    onCheckUpdates,
    onPrepareUpdates,
    onApplyPreparedUpdate,
    onOpenDataDirectory,
    onOpenLogDirectory,
    initialSection = "general",
  } = props;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const status = serviceSnapshot?.status ?? "Stopped";
  const locale = draft?.locale ?? settings?.locale ?? "zh-CN";
  const t = (key: MessageKey) => tForLocale(locale, key);
  const [desktopVersion, setDesktopVersion] = useState(t("settings.readingVersion"));
  const canEditPort = canEditServicePort(status);
  const portValidation = draft ? validateServicePort(draft.portText) : null;
  const activeLabel = settingsSectionLabel(activeSection, t);
  const lastUpdateCheckAt = updateResult?.checkedAt ?? settings?.lastUpdateCheckAt;
  const desktopReleaseUrl = updateResult?.desktop.releaseUrl ?? desktopReleaseFallbackUrl;
  const preparationStatus = componentPreparation?.status ?? "Idle";
  const isPreparationReady = preparationStatus === "Ready";
  const isPreparing = preparationStatus === "Preparing" || isPreparingUpdates;
  const shouldShowComponentUpdateAction =
    updateResult?.upstream.action === "InstallInDesktop" ||
    preparationStatus === "Preparing" ||
    preparationStatus === "Ready" ||
    isApplyingPreparedUpdate;

  useEffect(() => {
    let isMounted = true;

    void getDesktopVersion()
      .then((version) => {
        if (isMounted) {
          setDesktopVersion(version);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDesktopVersion(t("settings.unknown"));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [locale]);

  return (
    <main
      className="settings-shell"
      style={{ "--settings-accent": settingsAccent } as CSSProperties}
    >
      {!settings || !draft ? (
        <section className="surface empty-state">{t("settings.loading")}</section>
      ) : (
        <div className="settings-layout">
          <aside className="settings-sidebar" aria-label={t("settings.navigation")}>
            <div className="settings-sidebar-title">CliRelay Desktop</div>
            <nav className="settings-nav">
              {settingsSections.map((section) => (
                <button
                  key={section}
                  type="button"
                  className="settings-nav-item"
                  aria-current={activeSection === section ? "page" : undefined}
                  onClick={() => setActiveSection(section)}
                >
                  <NavIcon id={section} />
                  <span>{settingsSectionLabel(section, t)}</span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="settings-content" aria-labelledby="settings-section-title">
            <header className="settings-content-header">
              <div>
                <p className="eyebrow">{activeLabel}</p>
                <h2 id="settings-section-title">{activeLabel}</h2>
              </div>
              {activeSection === "update" ? (
                <div className="settings-header-actions update-header-actions">
                  {shouldShowComponentUpdateAction ? (
                    <ComponentUpdateActionButton
                      disabled={isBusy}
                      isPreparing={isPreparing}
                      isApplying={isApplyingPreparedUpdate}
                      isReady={isPreparationReady}
                      labels={{
                        preparing: t("settings.preparing"),
                        restarting: t("settings.restarting"),
                        restart: t("update.restartOk"),
                        updateComponents: t("settings.updateComponents"),
                      }}
                      onPrepareUpdates={onPrepareUpdates}
                      onApplyPreparedUpdate={() => onApplyPreparedUpdate({ serviceStatus: status })}
                    />
                  ) : null}
                  <CheckUpdatesButton
                    disabled={isBusy}
                    isChecking={isCheckingUpdates}
                    checkingLabel={t("settings.checking")}
                    checkNowLabel={t("settings.checkNow")}
                    onCheckUpdates={onCheckUpdates}
                  />
                </div>
              ) : null}
            </header>

            {activeSection === "general" ? (
              <SettingsPanel title={t("settings.startup")}>
                <ToggleRow
                  label={t("settings.launchAtLogin")}
                  description={t("settings.launchAtLoginDescription")}
                  checked={draft.autoStartApp}
                  onChange={(autoStartApp) => onDraftChange({ autoStartApp })}
                />
                <ToggleRow
                  label={t("settings.silentStart")}
                  description={t("settings.silentStartDescription")}
                  checked={draft.silentStart}
                  onChange={(silentStart) => onDraftChange({ silentStart })}
                />
                <FieldRow label={t("settings.language")}>
                  <select
                    className="settings-select"
                    value={draft.locale}
                    onChange={(event) =>
                      onDraftChange({
                        locale: event.currentTarget.value as DesktopLocale,
                      })
                    }
                  >
                    <option value="zh-CN">{localeLabels["zh-CN"]}</option>
                    <option value="en">{localeLabels.en}</option>
                  </select>
                </FieldRow>
              </SettingsPanel>
            ) : null}

            {activeSection === "service" ? (
              <>
                <SettingsPanel title={t("settings.runningStatus")}>
                  <dl className="field-list compact">
                    <FieldRow label={t("settings.status")} value={serviceStatusLabel(status, locale)} />
                    <FieldRow label={t("settings.port")}>
                      <input
                        className="port-input"
                        value={draft.portText}
                        disabled={!canEditPort}
                        inputMode="numeric"
                        onChange={(event) => onDraftChange({ portText: event.currentTarget.value })}
                      />
                    </FieldRow>
                    <FieldRow label={t("settings.desktopVersion")} value={desktopVersion} mono />
                    <FieldRow label={t("settings.clirelayVersion")} value={serviceSnapshot?.clirelayVersion} mono />
                    {/* <FieldRow label="Sidecar SHA-256" value={serviceSnapshot?.sidecarSha256} mono /> */}
                  </dl>
                  {!canEditPort ? (
                    <p className="hint">{t("settings.portLockedHint")}</p>
                  ) : null}
                  {portValidation && !portValidation.ok ? (
                    <p className="inline-error">{portValidation.message}</p>
                  ) : null}
                </SettingsPanel>
                <div className="settings-actions">
                  <button type="button" className="secondary" onClick={() => void onOpenDataDirectory()}>
                    {t("settings.openDataDirectory")}
                  </button>
                  <button type="button" className="secondary" onClick={() => void onOpenLogDirectory()}>
                    {t("settings.openLogDirectory")}
                  </button>
                </div>
              </>
            ) : null}

            {activeSection === "update" ? (
              <>
                <section className="update-status-strip" aria-label="Update status">
                  <span>
                    {t("settings.lastChecked")}：<strong>{formatUpdateCheckTime(lastUpdateCheckAt, locale)}</strong>
                  </span>
                  <ToggleRow
                    label={t("settings.autoCheckDaily")}
                    checked={draft.autoCheckNewVersions}
                    onChange={(autoCheckNewVersions) => onDraftChange({ autoCheckNewVersions })}
                  />
                </section>

                <section className="update-block" aria-labelledby="upstream-title">
                  <div className="update-block-header">
                    <div>
                      <h3 id="upstream-title">{t("settings.upstreamComponents")}</h3>
                      <p>
                        {installResult?.message ??
                          componentPreparation?.message ??
                          updateResult?.upstream.message ??
                          t("settings.notChecked")}
                      </p>
                    </div>
                  </div>
                  <div className="component-update-table" role="table" aria-label={t("settings.upstreamComponents")}>
                    <div className="component-update-row component-update-head" role="row">
                      <span role="columnheader">{t("settings.component")}</span>
                      <span role="columnheader">{t("settings.status")}</span>
                      <span role="columnheader">{t("settings.currentVersion")}</span>
                      <span role="columnheader">{t("settings.latestVersion")}</span>
                      <span role="columnheader">{t("settings.releasePage")}</span>
                    </div>
                    <ComponentUpdateRow
                      name="CliRelay"
                      item={updateResult?.upstream.clirelay ?? null}
                      currentVersion={serviceSnapshot?.clirelayVersion ?? "unknown"}
                      releasePageLabel={t("settings.releasePage")}
                      statusLabel={(item) => componentUpdateStatusLabel(item, t)}
                    />
                    <ComponentUpdateRow
                      name="codeProxy"
                      item={updateResult?.upstream.codeProxy ?? null}
                      currentVersion={serviceSnapshot?.codeProxyVersion ?? "unknown"}
                      releasePageLabel={t("settings.releasePage")}
                      statusLabel={(item) => componentUpdateStatusLabel(item, t)}
                    />
                  </div>
                </section>

                <section className="update-block desktop-preview-block" aria-labelledby="desktop-preview-title">
                  <div className="update-block-header">
                    <div>
                      <h3 id="desktop-preview-title">{t("settings.desktopPreview")}</h3>
                      <p>{updateResult?.desktop.message ?? t("settings.notChecked")}</p>
                    </div>
                  </div>
                  <div className="desktop-preview-summary">
                    <div>
                      <span>{t("settings.currentVersion")}</span>
                      <strong>{desktopVersion}</strong>
                    </div>
                    <div>
                      <span>{t("settings.latestVersion")}</span>
                      <strong>{updateResult?.desktop.latestVersion ?? "—"}</strong>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label="打开 GitHub Release"
                      onClick={() => void openExternalUrl(desktopReleaseUrl)}
                    >
                      GitHub Release
                      <ExternalLinkIcon />
                    </button>
                  </div>
                </section>
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
                    <p>{t("settings.aboutDescription")}</p>
                  </div>
                </section>
                <SettingsPanel title={t("settings.product")}>
                  <dl className="field-list compact">
                    <FieldRow label={t("settings.app")} value="CliRelay Desktop" />
                    <FieldRow label={t("settings.desktopVersion")} value={desktopVersion} mono />
                    <FieldRow label={t("settings.channel")} value={t("settings.previewChannel")} />
                    <FieldRow label={t("settings.upstreamProjects")} value="CliRelay / codeProxy" />
                    <FieldRow label={t("settings.license")} value={t("settings.licenseValue")} />
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
  releasePageLabel: string;
  statusLabel: (item: ComponentUpdateItem | null) => string;
}

interface CheckUpdatesButtonProps {
  disabled: boolean;
  isChecking: boolean;
  checkingLabel: string;
  checkNowLabel: string;
  onCheckUpdates: () => void | Promise<void>;
}

interface ComponentUpdateActionButtonProps {
  disabled: boolean;
  isPreparing: boolean;
  isApplying: boolean;
  isReady: boolean;
  labels: {
    preparing: string;
    restarting: string;
    restart: string;
    updateComponents: string;
  };
  onPrepareUpdates: () => void | Promise<void>;
  onApplyPreparedUpdate: () => void | Promise<void>;
}

function CheckUpdatesButton({
  disabled,
  isChecking,
  checkingLabel,
  checkNowLabel,
  onCheckUpdates,
}: CheckUpdatesButtonProps) {
  return (
    <button
      type="button"
      className="secondary check-updates-button"
      disabled={disabled || isChecking}
      aria-busy={isChecking}
      onClick={() => void onCheckUpdates()}
    >
      {isChecking ? (
        <>
          <span className="button-spinner" aria-hidden="true" />
          <span>{checkingLabel}</span>
        </>
      ) : (
        checkNowLabel
      )}
    </button>
  );
}

function ComponentUpdateActionButton({
  disabled,
  isPreparing,
  isApplying,
  isReady,
  labels,
  onPrepareUpdates,
  onApplyPreparedUpdate,
}: ComponentUpdateActionButtonProps) {
  const busy = isPreparing || isApplying;
  const label = isApplying
    ? labels.restarting
    : isPreparing
      ? labels.preparing
      : isReady
        ? labels.restart
        : labels.updateComponents;

  return (
    <button
      type="button"
      className="component-update-action-button"
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={() => {
        if (isReady) {
          void onApplyPreparedUpdate();
          return;
        }
        void onPrepareUpdates();
      }}
    >
      {busy ? (
        <>
          <span className="button-spinner" aria-hidden="true" />
          <span>{label}</span>
        </>
      ) : (
        label
      )}
    </button>
  );
}

function ComponentUpdateRow({
  name,
  item,
  currentVersion,
  releasePageLabel,
  statusLabel,
}: ComponentUpdateRowProps) {
  const releaseLabel = item?.latestVersion ?? releasePageLabel;

  return (
    <div className="component-update-row" role="row">
      <strong role="cell">{name}</strong>
      <span role="cell">
        <UpdateStatusPill
          status={item?.status ?? "Unavailable"}
          label={statusLabel(item)}
        />
      </span>
      <code role="cell">{item?.currentVersion ?? currentVersion}</code>
      <code role="cell">{item?.latestVersion ?? "—"}</code>
      <span role="cell">
        {item?.releaseUrl ? (
          <button
            type="button"
            className="link-button external-link-button"
            aria-label={`打开 ${name} 发布页`}
            onClick={() => void openExternalUrl(item.releaseUrl as string)}
          >
            {releaseLabel}
            <ExternalLinkIcon />
          </button>
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

function componentUpdateStatusLabel(
  item: ComponentUpdateItem | null,
  t: (key: MessageKey) => string,
): string {
  if (item?.message) {
    return item.message;
  }

  return updateStatusLabel(item?.status ?? "Unavailable", t);
}

function updateStatusLabel(status: UpdateStatus, t: (key: MessageKey) => string): string {
  switch (status) {
    case "UpdateAvailable":
      return t("update.statusAvailable");
    case "UpToDate":
      return t("update.statusUpToDate");
    case "Error":
      return t("update.statusError");
    case "Unavailable":
      return t("update.statusUnavailable");
  }
}

function settingsSectionLabel(
  section: SettingsSectionId,
  t: (key: MessageKey) => string,
): string {
  switch (section) {
    case "general":
      return t("settings.general");
    case "service":
      return t("settings.service");
    case "update":
      return t("settings.update");
    case "about":
      return t("settings.about");
  }
}

function serviceStatusLabel(status: ServiceStatus, locale: DesktopLocale): string {
  return locale === "en" ? serviceStatusLabelsEn[status] : serviceStatusLabels[status];
}

export function formatUpdateCheckTime(
  value: string | null | undefined,
  locale = "zh-CN",
  timeZone?: string,
): string {
  if (!value) {
    return locale.startsWith("en") ? "Not checked" : "未检查";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return locale.startsWith("en") ? "Not checked" : "未检查";
  }

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
}

function ExternalLinkIcon() {
  return (
    <svg className="external-link-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="M13 11 19 5" />
      <path d="M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H10" />
    </svg>
  );
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
    <svg
      className="settings-nav-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-nav-icon={id}
    >
      {id === "general" ? (
        <>
          <path d="M4 7h6" />
          <path d="M14 7h6" />
          <circle cx="12" cy="7" r="2" />
          <path d="M4 17h10" />
          <path d="M18 17h2" />
          <circle cx="16" cy="17" r="2" />
        </>
      ) : null}
      {id === "service" ? (
        <>
          <rect x="4" y="5" width="16" height="6" rx="2" />
          <rect x="4" y="13" width="16" height="6" rx="2" />
          <path d="M8 8h.01" />
          <path d="M8 16h.01" />
        </>
      ) : null}
      {id === "update" ? (
        <>
          <path d="M20 6v5h-5" />
          <path d="M4 18v-5h5" />
          <path d="M18.4 10A7 7 0 0 0 6.1 7.4L4 9.5" />
          <path d="M5.6 14a7 7 0 0 0 12.3 2.6L20 14.5" />
        </>
      ) : null}
      {id === "about" ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </>
      ) : null}
    </svg>
  );
}
