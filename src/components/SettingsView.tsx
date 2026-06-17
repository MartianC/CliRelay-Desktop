import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type {
  ComponentInstallResult,
  ComponentUpdateItem,
  DesktopSettings,
  ServiceSnapshot,
  ServiceStatus,
  UpdateCheckResult,
  UpdateStatus,
} from "../bridge/types";
import { getDesktopVersion, openExternalUrl } from "../bridge/commands";
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

const settingsAccent = "#1d4ed8";

type SettingsSectionId = "general" | "service" | "update" | "about";

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "通用" },
  { id: "service", label: "服务" },
  { id: "update", label: "更新" },
  { id: "about", label: "关于" },
];

const serviceStatusLabels: Record<ServiceStatus, string> = {
  Stopped: "已停止",
  Starting: "启动中",
  Running: "运行中",
  Stopping: "停止中",
  Unhealthy: "异常",
  External: "外部占用",
  Error: "错误",
};

const desktopReleaseFallbackUrl = "https://github.com/MartianC/CliRelay-Desktop/releases";

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
  const [desktopVersion, setDesktopVersion] = useState("正在读取版本");
  const status = serviceSnapshot?.status ?? "Stopped";
  const canEditPort = canEditServicePort(status);
  const portValidation = draft ? validateServicePort(draft.portText) : null;
  const activeLabel = settingsSections.find((section) => section.id === activeSection)?.label ?? "通用";
  const lastUpdateCheckAt = updateResult?.checkedAt ?? settings?.lastUpdateCheckAt;
  const desktopReleaseUrl = updateResult?.desktop.releaseUrl ?? desktopReleaseFallbackUrl;

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
          setDesktopVersion("未知");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main
      className="settings-shell"
      style={{ "--settings-accent": settingsAccent } as CSSProperties}
    >
      {!settings || !draft ? (
        <section className="surface empty-state">正在读取设置…</section>
      ) : (
        <div className="settings-layout">
          <aside className="settings-sidebar" aria-label="设置导航">
            <div className="settings-sidebar-title">CliRelay Desktop</div>
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
          </aside>

          <section className="settings-content" aria-labelledby="settings-section-title">
            <header className="settings-content-header">
              <div>
                <p className="eyebrow">{activeLabel}</p>
                <h2 id="settings-section-title">{activeLabel}</h2>
              </div>
            </header>

            {activeSection === "general" ? (
              <SettingsPanel title="启动">
                <ToggleRow
                  label="登录时启动 Desktop"
                  description="登录系统后自动启动 CliRelay Desktop"
                  checked={draft.autoStartApp}
                  onChange={(autoStartApp) => onDraftChange({ autoStartApp })}
                />
                <ToggleRow
                  label="启动后自动启动服务"
                  description="打开应用后自动启动 CliRelay 服务"
                  checked={draft.autoStartService}
                  onChange={(autoStartService) => onDraftChange({ autoStartService })}
                />
                <ToggleRow
                  label="启动时打开管理面板"
                  description="服务就绪后自动打开管理面板"
                  checked={draft.openPanelOnStart}
                  onChange={(openPanelOnStart) => onDraftChange({ openPanelOnStart })}
                />
              </SettingsPanel>
            ) : null}

            {activeSection === "service" ? (
              <>
                <SettingsPanel title="运行状态">
                  <dl className="field-list compact">
                    <FieldRow label="状态" value={serviceStatusLabels[status]} />
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
                    {/* <FieldRow label="Sidecar SHA-256" value={serviceSnapshot?.sidecarSha256} mono /> */}
                  </dl>
                  {!canEditPort ? (
                    <p className="hint">运行中、启动中、异常或外部占用状态下端口不可编辑。</p>
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
                    上次检查：<strong>{formatUpdateCheckTime(lastUpdateCheckAt)}</strong>
                  </span>
                  <ToggleRow
                    label="每日自动检查"
                    checked={draft.autoCheckNewVersions}
                    onChange={(autoCheckNewVersions) => onDraftChange({ autoCheckNewVersions })}
                  />
                </section>

                <section className="update-block" aria-labelledby="upstream-title">
                  <div className="update-block-header">
                    <div>
                      <h3 id="upstream-title">上游组件</h3>
                      <p>{installResult?.message ?? updateResult?.upstream.message ?? "尚未检查"}</p>
                    </div>
                    <div className="update-header-actions">
                      {updateResult?.upstream.action === "InstallInDesktop" ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void onInstallUpdates(true)}
                        >
                          更新组件
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary"
                        disabled={isBusy}
                        onClick={() => void onCheckUpdates()}
                      >
                        立即检查
                      </button>
                    </div>
                  </div>
                  <div className="component-update-table" role="table" aria-label="上游组件">
                    <div className="component-update-row component-update-head" role="row">
                      <span role="columnheader">组件</span>
                      <span role="columnheader">状态</span>
                      <span role="columnheader">当前版本</span>
                      <span role="columnheader">最新版本</span>
                      <span role="columnheader">发布页</span>
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
                      <h3 id="desktop-preview-title">桌面预览版</h3>
                      <p>{updateResult?.desktop.message ?? "尚未检查"}</p>
                    </div>
                    <div className="update-header-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={isBusy}
                        onClick={() => void onCheckUpdates()}
                      >
                        立即检查
                      </button>
                    </div>
                  </div>
                  <div className="desktop-preview-summary">
                    <div>
                      <span>当前版本</span>
                      <strong>{desktopVersion}</strong>
                    </div>
                    <div>
                      <span>最新版本</span>
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
                    <p>CliRelay Desktop 是独立的非官方桌面伴侣。</p>
                  </div>
                </section>
                <SettingsPanel title="产品">
                  <dl className="field-list compact">
                    <FieldRow label="应用" value="CliRelay Desktop" />
                    <FieldRow label="版本" value={desktopVersion} mono />
                    <FieldRow label="渠道" value="预览版" />
                    <FieldRow label="上游项目" value="CliRelay / codeProxy" />
                    <FieldRow label="许可证" value="见 THIRD_PARTY_NOTICES.md" />
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
  const releaseLabel = item?.latestVersion ?? "发布页";

  return (
    <div className="component-update-row" role="row">
      <strong role="cell">{name}</strong>
      <span role="cell">
        <UpdateStatusPill
          status={item?.status ?? "Unavailable"}
          label={componentUpdateStatusLabel(item)}
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

function componentUpdateStatusLabel(item: ComponentUpdateItem | null): string {
  if (item?.message) {
    return item.message;
  }

  return updateStatusLabel(item?.status ?? "Unavailable");
}

function updateStatusLabel(status: UpdateStatus): string {
  switch (status) {
    case "UpdateAvailable":
      return "有可用更新";
    case "UpToDate":
      return "已是最新";
    case "Error":
      return "检查失败";
    case "Unavailable":
      return "未检查";
  }
}

export function formatUpdateCheckTime(
  value: string | null | undefined,
  locale = "zh-CN",
  timeZone?: string,
): string {
  if (!value) {
    return "未检查";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未检查";
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
