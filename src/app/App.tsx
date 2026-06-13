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
  const didRequestAutoStart = useRef(false);

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
      !shouldAutoStartService({
        hasAttemptedAutoStart: didRequestAutoStart.current,
        isBusy: service.isBusy,
        panelOpened: service.panelOpened,
        panelOpening: service.panelOpening,
        snapshotStatus: service.snapshot?.status ?? null,
        statusRequested,
        windowRole,
      })
    ) {
      return;
    }

    didRequestAutoStart.current = true;
    void serviceStore.start();
  }, [
    service.isBusy,
    service.panelOpened,
    service.panelOpening,
    service.snapshot?.status,
    statusRequested,
    windowRole,
  ]);

  useEffect(() => {
    if (
      windowRole !== "main" ||
      statusRequested ||
      didRequestPanel.current ||
      !shouldOpenPanelAfterStartup({
        panelOpened: service.panelOpened,
        panelOpening: service.panelOpening,
        snapshotStatus: service.snapshot?.status ?? null,
      })
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
      panelOpening={service.panelOpening}
      panelOpened={service.panelOpened}
      isBusy={service.isBusy}
      startupFailed={Boolean(service.error)}
      onOpenStatus={() => setStatusRequested(true)}
    />
  );
}

interface StartupShellProps {
  status: string;
  panelOpening: boolean;
  panelOpened: boolean;
  isBusy: boolean;
  startupFailed: boolean;
  onOpenStatus: () => void;
}

export function StartupShell({
  status,
  panelOpening,
  panelOpened,
  isBusy,
  startupFailed,
  onOpenStatus,
}: StartupShellProps) {
  const steps = [
    "准备运行环境",
    "启动 CliRelay",
    "等待 /manage",
    "打开 Panel",
  ] as const;
  const currentStep = getStartupStep(status, panelOpening, panelOpened, startupFailed);
  const progress = `${Math.max(18, currentStep * 25)}%`;
  const statusText =
    startupFailed
      ? "启动失败"
      : panelOpening || panelOpened
        ? "正在切换到 Panel"
        : "启动服务中";

  return (
    <main className="app-shell startup-shell">
      <section className="startup-content">
        <div className="startup-app-icon" aria-hidden="true">
          <span className="terminal-mark">&gt;_</span>
          <span className={`icon-status-dot status-${status.toLowerCase()}`} />
        </div>

        <h1>CliRelay Desktop</h1>
        <p className="startup-status-text">{statusText}</p>

        <ol className="startup-steps">
          {steps.map((label, index) => {
            const stepNumber = index + 1;
            const state =
              stepNumber < currentStep
                ? "done"
                : stepNumber === currentStep
                  ? "active"
                  : "pending";

            return (
              <li key={label} className={state}>
                <span />
                {label}
              </li>
            );
          })}
        </ol>

        <div className="progress-track">
          <span style={{ width: progress }} />
        </div>

        <div className="startup-step-count">第 {currentStep} / 4 步</div>

        <div className="startup-footer">
          <div className="button-row">
            {startupFailed ? (
              <button
                type="button"
                className="secondary"
                disabled={isBusy}
                onClick={onOpenStatus}
              >
                打开状态
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function getStartupStep(
  status: string,
  panelOpening: boolean,
  panelOpened: boolean,
  startupFailed: boolean,
): number {
  if (startupFailed) {
    return 2;
  }

  if (panelOpening || panelOpened) {
    return 4;
  }

  if (status === "Running") {
    return 3;
  }

  if (status === "Starting") {
    return 2;
  }

  return 1;
}

interface AutoStartInput {
  hasAttemptedAutoStart: boolean;
  isBusy: boolean;
  panelOpened: boolean;
  panelOpening: boolean;
  snapshotStatus: string | null;
  statusRequested: boolean;
  windowRole: WindowRole;
}

export function shouldAutoStartService({
  hasAttemptedAutoStart,
  isBusy,
  panelOpened,
  panelOpening,
  snapshotStatus,
  statusRequested,
  windowRole,
}: AutoStartInput): boolean {
  return (
    windowRole === "main" &&
    !statusRequested &&
    !hasAttemptedAutoStart &&
    !isBusy &&
    !panelOpening &&
    !panelOpened &&
    snapshotStatus === "Stopped"
  );
}

interface OpenPanelAfterStartupInput {
  panelOpened: boolean;
  panelOpening: boolean;
  snapshotStatus: string | null;
}

export function shouldOpenPanelAfterStartup({
  panelOpened,
  panelOpening,
  snapshotStatus,
}: OpenPanelAfterStartupInput): boolean {
  return !panelOpening && !panelOpened && snapshotStatus === "Running";
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
