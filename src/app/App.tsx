import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import { copyEndpoint, openDataDirectory, openLogDirectory, openSettings } from "../bridge/commands";
import { SettingsView } from "../components/SettingsView";
import { StatusView } from "../components/StatusView";
import { serviceStore, shouldUseRecoveryView, useServiceStore } from "../stores/serviceStore";
import { settingsStore, useSettingsStore } from "../stores/settingsStore";
import "../styles/app.css";

type WindowRole = "main" | "settings";

function App() {
  const [windowRole, setWindowRole] = useState<WindowRole>("main");
  const [statusRequested, setStatusRequested] = useState(false);
  const service = useServiceStore();
  const settings = useSettingsStore();
  const didRequestPanel = useRef(false);

  useEffect(() => {
    try {
      if (getCurrentWindow().label === "settings") {
        setWindowRole("settings");
      }
    } catch {
      setWindowRole("main");
    }
  }, []);

  useEffect(() => {
    void serviceStore.refresh();
    void settingsStore.load();

    const timer = window.setInterval(() => {
      void serviceStore.refresh();
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      windowRole !== "main" ||
      statusRequested ||
      didRequestPanel.current ||
      service.panelOpening ||
      service.panelOpened ||
      service.snapshot?.status !== "Running" ||
      settings.settings?.openPanelOnStart === false
    ) {
      return;
    }

    didRequestPanel.current = true;
    void serviceStore.openPanel().then(() => {
      void hideShellWindow();
    });
  }, [
    service.panelOpened,
    service.panelOpening,
    service.snapshot?.status,
    settings.settings?.openPanelOnStart,
    statusRequested,
    windowRole,
  ]);

  if (windowRole === "settings") {
    return (
      <SettingsView
        settings={settings.settings}
        draft={settings.draft}
        serviceSnapshot={service.snapshot}
        updateResult={settings.updateResult}
        error={settings.error}
        isBusy={settings.isBusy}
        onDraftChange={settingsStore.setDraft}
        onSave={settingsStore.save}
        onCheckUpdates={settingsStore.checkUpdates}
        onOpenDataDirectory={openDataDirectory}
        onOpenLogDirectory={openLogDirectory}
      />
    );
  }

  if (
    statusRequested ||
    (service.snapshot && shouldUseRecoveryView(service.snapshot.status))
  ) {
    return (
      <StatusView
        snapshot={service.snapshot}
        error={service.error}
        isBusy={service.isBusy || service.panelOpening}
        onRefresh={serviceStore.refresh}
        onOpenPanel={serviceStore.openPanel}
        onStart={serviceStore.start}
        onStop={serviceStore.stop}
        onRestart={serviceStore.restart}
        onOpenDataDirectory={openDataDirectory}
        onOpenLogDirectory={openLogDirectory}
        onCopyEndpoint={copyEndpoint}
        onChangePort={openSettings}
        onCancelExternal={() => setStatusRequested(false)}
      />
    );
  }

  return (
    <StartupShell
      status={service.snapshot?.status ?? "Starting"}
      endpoint={service.snapshot?.endpoint ?? `http://127.0.0.1:${settings.settings?.port ?? 8317}`}
      panelOpening={service.panelOpening}
      panelOpened={service.panelOpened}
      error={service.error}
      isBusy={service.isBusy}
      onOpenStatus={() => setStatusRequested(true)}
      onStart={serviceStore.start}
      onOpenSettings={openSettings}
    />
  );
}

interface StartupShellProps {
  status: string;
  endpoint: string;
  panelOpening: boolean;
  panelOpened: boolean;
  error: string | null;
  isBusy: boolean;
  onOpenStatus: () => void;
  onStart: () => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
}

function StartupShell({
  status,
  endpoint,
  panelOpening,
  panelOpened,
  error,
  isBusy,
  onOpenStatus,
  onStart,
  onOpenSettings,
}: StartupShellProps) {
  const steps = [
    ["准备运行目录", true],
    ["启动 CliRelay", status !== "Stopped"],
    ["等待 /manage", status === "Running" || panelOpening || panelOpened],
    ["打开 Panel", panelOpening || panelOpened],
  ] as const;

  return (
    <main className="app-shell startup-shell">
      <section className="startup-card">
        <div className="startup-top">
          <div>
            <p className="eyebrow">CliRelay Desktop</p>
            <h1>正在打开管理面板</h1>
            <p className="muted">
              Desktop 负责本机服务生命周期；管理界面来自 CliRelay 的 /manage。
            </p>
          </div>
          <span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>
        </div>

        <div className="progress-track">
          <span style={{ width: panelOpened ? "100%" : panelOpening ? "86%" : "48%" }} />
        </div>

        <ol className="startup-steps">
          {steps.map(([label, done]) => (
            <li key={label} className={done ? "done" : undefined}>
              <span />
              {label}
            </li>
          ))}
        </ol>

        <div className="startup-footer">
          <div>
            <span className="label">API Base URL</span>
            <strong className="mono">{endpoint}</strong>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void onStart()} disabled={isBusy}>
              启动 CliRelay
            </button>
            <button type="button" className="secondary" onClick={onOpenStatus}>
              打开状态
            </button>
            <button type="button" className="ghost" onClick={() => void onOpenSettings()}>
              设置
            </button>
          </div>
        </div>

        {panelOpened ? (
          <div className="panel-placeholder">
            <div className="panel-sidebar" />
            <div className="panel-content">
              <span>Panel 已在零权限 WebView 中打开</span>
              <strong>/manage</strong>
            </div>
          </div>
        ) : null}

        {error ? <p className="inline-error">{error}</p> : null}
      </section>
    </main>
  );
}

async function hideShellWindow(): Promise<void> {
  try {
    const window = getCurrentWindow();
    if (window.label === "main") {
      await window.hide();
    }
  } catch {
    // 浏览器开发模式下没有 Tauri window runtime。
  }
}

export default App;
