import type {
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
  error: string | null;
  isBusy: boolean;
  onLoad?: () => void | Promise<void>;
  onDraftChange: (patch: Partial<SettingsDraft>) => void;
  onSave: () => void | Promise<void>;
  onCheckUpdates: () => void | Promise<void>;
  onOpenDataDirectory: () => void | Promise<void>;
  onOpenLogDirectory: () => void | Promise<void>;
}

const desktopVersion = "0.0.1-preview.1";

export function SettingsView(props: SettingsViewProps) {
  const {
    settings,
    draft,
    serviceSnapshot,
    updateResult,
    error,
    isBusy,
    onDraftChange,
    onSave,
    onCheckUpdates,
    onOpenDataDirectory,
    onOpenLogDirectory,
  } = props;
  const status = serviceSnapshot?.status ?? "Stopped";
  const canEditPort = canEditServicePort(status);
  const portValidation = draft ? validateServicePort(draft.portText) : null;
  const canSave = Boolean(draft && portValidation?.ok && !isBusy);

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>CliRelay Desktop</h1>
        </div>
        <button type="button" onClick={() => void onSave()} disabled={!canSave}>
          保存
        </button>
      </header>

      {!settings || !draft ? (
        <section className="surface empty-state">正在读取设置…</section>
      ) : (
        <div className="settings-grid">
          <section className="surface settings-section">
            <h2>General</h2>
            <ToggleRow
              label="登录时启动 Desktop"
              checked={draft.autoStartApp}
              onChange={(autoStartApp) => onDraftChange({ autoStartApp })}
            />
            <ToggleRow
              label="启动后自动启动服务"
              checked={draft.autoStartService}
              onChange={(autoStartService) => onDraftChange({ autoStartService })}
            />
            <ToggleRow
              label="启动时打开管理面板"
              checked={draft.openPanelOnStart}
              onChange={(openPanelOnStart) => onDraftChange({ openPanelOnStart })}
            />
          </section>

          <section className="surface settings-section">
            <h2>Service</h2>
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
              <FieldRow label="数据目录">
                <button type="button" className="link-button" onClick={() => void onOpenDataDirectory()}>
                  打开数据目录
                </button>
              </FieldRow>
              <FieldRow label="日志目录">
                <button type="button" className="link-button" onClick={() => void onOpenLogDirectory()}>
                  打开日志目录
                </button>
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
          </section>

          <section className="surface settings-section">
            <h2>Update</h2>
            <dl className="field-list compact">
              <FieldRow label="通道" value="Preview" />
              <FieldRow label="最后检查" value={settings.lastUpdateCheckAt ?? "—"} mono />
              <FieldRow label="最新结果" value={updateResult?.message ?? "尚未检查"} />
            </dl>
            <ToggleRow
              label="自动检查新版本"
              checked={draft.autoCheckNewVersions}
              onChange={(autoCheckNewVersions) => onDraftChange({ autoCheckNewVersions })}
            />
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => void onCheckUpdates()}>
                手动检查
              </button>
              <a
                className="button ghost"
                href="https://github.com/MartianC/CliRelay-Desktop/releases"
                target="_blank"
                rel="noreferrer"
              >
                GitHub Release
              </a>
            </div>
          </section>

          <section className="surface settings-section">
            <h2>About</h2>
            <dl className="field-list compact">
              <FieldRow label="App" value="CliRelay Desktop" />
              <FieldRow label="版本" value={desktopVersion} mono />
              <FieldRow label="Channel" value="Preview" />
              <FieldRow label="上游项目" value="CliRelay / codeProxy" />
              <FieldRow label="License" value="见 THIRD_PARTY_NOTICES.md" />
            </dl>
            <p className="notice">CliRelay Desktop 是独立的非官方桌面伴侣。</p>
          </section>
        </div>
      )}

      {error ? <p className="inline-error">{error}</p> : null}
    </main>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
