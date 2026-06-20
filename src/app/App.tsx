import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import {
  copyEndpoint,
  getManagementSecretStatus,
  openDataDirectory,
  openLogDirectory,
  openSettings,
  quitDesktop,
  setManagementSecretKey,
} from "../bridge/commands";
import { SettingsView } from "../components/SettingsView";
import { ManagementSecretDialog } from "../components/ManagementSecretDialog";
import { StatusView } from "../components/StatusView";
import { serviceStore, shouldUseRecoveryView, useServiceStore } from "../stores/serviceStore";
import {
  settingsStore,
  shouldAutoCheckUpdates,
  useSettingsStore,
} from "../stores/settingsStore";
import { useI18n } from "../i18n/I18nProvider";
import "../styles/app.css";

type WindowRole = "main" | "settings";
export type SecretGateState = "checking" | "missing" | "configured" | "failed";

function App() {
  const [windowRole, setWindowRole] = useState<WindowRole>("main");
  const [statusRequested, setStatusRequested] = useState(false);
  const [secretGateState, setSecretGateState] = useState<SecretGateState>("checking");
  const [secretGateError, setSecretGateError] = useState<string | null>(null);
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const service = useServiceStore();
  const settings = useSettingsStore();
  const didRequestPanel = useRef(false);
  const didRequestAutoStart = useRef(false);
  const didRequestAutoUpdateCheck = useRef(false);
  const didHideShell = useRef(false);

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
    if (windowRole !== "main" || !settings.settings || secretGateState !== "checking") {
      return;
    }

    let isCancelled = false;
    void getManagementSecretStatus()
      .then((status) => {
        if (!isCancelled) {
          setSecretGateState(status === "configured" ? "configured" : "missing");
          setSecretGateError(null);
        }
      })
      .catch((caught) => {
        if (!isCancelled) {
          setSecretGateState("failed");
          setSecretGateError(toDisplayError(caught));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [secretGateState, settings.settings, windowRole]);

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
      didRequestAutoUpdateCheck.current ||
      !settings.settings ||
      !shouldAutoCheckUpdates(settings.settings)
    ) {
      return;
    }

    didRequestAutoUpdateCheck.current = true;
    const timer = window.setTimeout(() => {
      void settingsStore.checkUpdates();
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [settings.settings]);

  useEffect(() => {
    if (
      windowRole !== "settings" ||
      settings.componentPreparation?.status !== "Preparing"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void settingsStore.refreshComponentPreparation();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [settings.componentPreparation?.status, windowRole]);

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
        secretGateState,
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
    secretGateState,
  ]);

  useEffect(() => {
    if (
      windowRole !== "main" ||
      statusRequested ||
      didRequestPanel.current ||
      !settings.settings ||
      !shouldOpenPanelAfterStartup({
        panelOpened: service.panelOpened,
        panelOpening: service.panelOpening,
        snapshotStatus: service.snapshot?.status ?? null,
        openPanelOnStart: settings.settings.openPanelOnStart,
        secretGateState,
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
    settings.settings,
    secretGateState,
    statusRequested,
    windowRole,
  ]);

  useEffect(() => {
    if (
      !settings.settings ||
      !shouldHideShellAfterSilentStartup({
        hasHiddenShell: didHideShell.current,
        openPanelOnStart: settings.settings.openPanelOnStart,
        snapshotStatus: service.snapshot?.status ?? null,
        windowRole,
        statusRequested,
      })
    ) {
      return;
    }

    didHideShell.current = true;
    void hideShellWindow();
  }, [service.snapshot?.status, settings.settings, statusRequested, windowRole]);

  async function handleSubmitManagementSecret(secretKey: string) {
    setIsSavingSecret(true);
    setSecretGateError(null);
    try {
      const status = await setManagementSecretKey(secretKey);
      setSecretGateState(status === "configured" ? "configured" : "missing");
    } catch (caught) {
      setSecretGateError(toDisplayError(caught));
      setSecretGateState("missing");
    } finally {
      setIsSavingSecret(false);
    }
  }

  function handleCancelManagementSecret() {
    void quitDesktop();
  }

  const managementSecretDialog =
    windowRole === "main" &&
    (secretGateState === "missing" || secretGateState === "failed") ? (
      <ManagementSecretDialog
        error={secretGateError}
        isSaving={isSavingSecret}
        onSubmit={handleSubmitManagementSecret}
        onCancel={handleCancelManagementSecret}
      />
    ) : null;

  if (windowRole === "settings") {
    return (
      <SettingsView
        settings={settings.settings}
        draft={settings.draft}
        serviceSnapshot={service.snapshot}
        updateResult={settings.updateResult}
        installResult={settings.installResult}
        componentPreparation={settings.componentPreparation}
        error={settings.error}
        isBusy={settings.isBusy}
        isCheckingUpdates={settings.isCheckingUpdates}
        isPreparingUpdates={settings.isPreparingUpdates}
        isApplyingPreparedUpdate={settings.isApplyingPreparedUpdate}
        onDraftChange={settingsStore.setDraft}
        onCheckUpdates={settingsStore.checkUpdates}
        onPrepareUpdates={settingsStore.prepareUpdates}
        onApplyPreparedUpdate={settingsStore.applyPreparedUpdate}
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
      <>
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
          locale={settings.settings?.locale ?? "zh-CN"}
        />
        {managementSecretDialog}
      </>
    );
  }

  return (
    <>
      <StartupShell
        status={service.snapshot?.status ?? "Starting"}
        panelOpening={service.panelOpening}
        panelOpened={service.panelOpened}
        isBusy={service.isBusy}
        startupFailed={Boolean(service.error)}
        onOpenStatus={() => setStatusRequested(true)}
      />
      {managementSecretDialog}
    </>
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
  const { t } = useI18n();
  const steps = [
    t("startup.prepareEnvironment"),
    t("startup.startCliRelay"),
    t("startup.waitManage"),
    t("startup.openPanel"),
  ] as const;
  const currentStep = getStartupStep(status, panelOpening, panelOpened, startupFailed);
  const progress = `${Math.max(18, currentStep * 25)}%`;
  const statusText =
    startupFailed
      ? t("startup.failed")
      : panelOpening || panelOpened
        ? t("startup.switchingPanel")
        : t("startup.startingService");

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
                {t("startup.openStatus")}
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
  secretGateState: SecretGateState;
}

export function shouldAutoStartService({
  hasAttemptedAutoStart,
  isBusy,
  panelOpened,
  panelOpening,
  snapshotStatus,
  statusRequested,
  windowRole,
  secretGateState,
}: AutoStartInput): boolean {
  return (
    windowRole === "main" &&
    secretGateState === "configured" &&
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
  openPanelOnStart: boolean;
  secretGateState: SecretGateState;
}

export function shouldOpenPanelAfterStartup({
  panelOpened,
  panelOpening,
  snapshotStatus,
  openPanelOnStart,
  secretGateState,
}: OpenPanelAfterStartupInput): boolean {
  return (
    secretGateState === "configured" &&
    openPanelOnStart &&
    !panelOpening &&
    !panelOpened &&
    snapshotStatus === "Running"
  );
}

export function shouldHideShellAfterSilentStartup(input: {
  hasHiddenShell: boolean;
  openPanelOnStart: boolean;
  snapshotStatus: string | null;
  windowRole: WindowRole;
  statusRequested: boolean;
}): boolean {
  return (
    input.windowRole === "main" &&
    !input.statusRequested &&
    !input.hasHiddenShell &&
    !input.openPanelOnStart &&
    input.snapshotStatus === "Running"
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

function toDisplayError(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message;
  }

  if (typeof caught === "string") {
    return caught;
  }

  return "操作失败";
}

export default App;
