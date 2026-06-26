import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import appIconUrl from "../../src-tauri/icons/icon.png";

import {
  chooseRuntimeConfigFile,
  getManagementSecretStatus,
  getRuntimeConfigStatus,
  importRuntimeConfig,
  initializeDefaultRuntimeConfig,
  openDataDirectory,
  openLogDirectory,
  openSettings,
  quitDesktop,
  setManagementSecretKey,
} from "../bridge/commands";
import { ConfigImportDialog } from "../components/ConfigImportDialog";
import { SettingsView } from "../components/SettingsView";
import { ManagementSecretDialog } from "../components/ManagementSecretDialog";
import { StatusView } from "../components/StatusView";
import { serviceStore, shouldUseRecoveryView, useServiceStore } from "../stores/serviceStore";
import {
  settingsStore,
  shouldAutoCheckUpdates,
  useSettingsStore,
} from "../stores/settingsStore";
import type { ServiceStatus } from "../bridge/types";
import { useI18n } from "../i18n/I18nProvider";
import "../styles/app.css";

type WindowRole = "main" | "settings";
export type ConfigGateState = "checking" | "missing" | "ready" | "failed";
export type SecretGateState = "checking" | "missing" | "configured" | "failed";

function App() {
  const [windowRole, setWindowRole] = useState<WindowRole>("main");
  const [statusRequested, setStatusRequested] = useState(false);
  const [configGateState, setConfigGateState] = useState<ConfigGateState>("checking");
  const [configGateError, setConfigGateError] = useState<string | null>(null);
  const [isHandlingConfig, setIsHandlingConfig] = useState(false);
  const [secretGateState, setSecretGateState] = useState<SecretGateState>("checking");
  const [secretGateError, setSecretGateError] = useState<string | null>(null);
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const service = useServiceStore();
  const settings = useSettingsStore();
  const didRequestPanel = useRef(false);
  const didRequestAutoStart = useRef(false);
  const didRequestAutoUpdateCheck = useRef(false);
  const didHideShell = useRef(false);
  const didShowShell = useRef(false);

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
    if (
      !shouldCheckRuntimeConfig({
        windowRole,
        hasSettings: Boolean(settings.settings),
        configGateState,
      })
    ) {
      return;
    }

    let isCancelled = false;
    void getRuntimeConfigStatus()
      .then((status) => {
        if (!isCancelled) {
          setConfigGateState(status === "ready" ? "ready" : "missing");
          setConfigGateError(null);
        }
      })
      .catch((caught) => {
        if (!isCancelled) {
          setConfigGateState("failed");
          setConfigGateError(toDisplayError(caught));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [configGateState, settings.settings, windowRole]);

  useEffect(() => {
    if (
      !shouldCheckManagementSecret({
        windowRole,
        hasSettings: Boolean(settings.settings),
        configGateState,
        secretGateState,
      })
    ) {
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
  }, [configGateState, secretGateState, settings.settings, windowRole]);

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
      didShowShell.current ||
      !shouldShowShellWindow({
        windowRole,
        hasSettings: Boolean(settings.settings),
        settingsError: settings.error,
        openPanelOnStart: settings.settings?.openPanelOnStart ?? null,
        configGateState,
        secretGateState,
        snapshotStatus: service.snapshot?.status ?? null,
        statusRequested,
        startupFailed: Boolean(service.error),
      })
    ) {
      return;
    }

    didShowShell.current = true;
    void showShellWindow();
  }, [
    configGateState,
    secretGateState,
    service.error,
    service.snapshot?.status,
    settings.error,
    settings.settings,
    statusRequested,
    windowRole,
  ]);

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

  async function handleImportRuntimeConfig() {
    setIsHandlingConfig(true);
    setConfigGateError(null);
    try {
      const sourcePath = await chooseRuntimeConfigFile();
      if (!sourcePath) {
        return;
      }

      const status = await importRuntimeConfig(sourcePath);
      setConfigGateState(status === "ready" ? "ready" : "missing");
      setSecretGateState("checking");
    } catch (caught) {
      setConfigGateError(toDisplayError(caught));
      setConfigGateState("failed");
    } finally {
      setIsHandlingConfig(false);
    }
  }

  async function handleUseDefaultRuntimeConfig() {
    setIsHandlingConfig(true);
    setConfigGateError(null);
    try {
      const status = await initializeDefaultRuntimeConfig();
      setConfigGateState(status === "ready" ? "ready" : "missing");
      setSecretGateState("checking");
    } catch (caught) {
      setConfigGateError(toDisplayError(caught));
      setConfigGateState("failed");
    } finally {
      setIsHandlingConfig(false);
    }
  }

  function handleCancelRuntimeConfig() {
    void quitDesktop();
  }

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

  const configImportDialog =
    windowRole === "main" &&
    (configGateState === "missing" || configGateState === "failed") ? (
      <ConfigImportDialog
        error={configGateError}
        isBusy={isHandlingConfig}
        onImport={handleImportRuntimeConfig}
        onUseDefault={handleUseDefaultRuntimeConfig}
        onCancel={handleCancelRuntimeConfig}
      />
    ) : null;

  const managementSecretDialog =
    windowRole === "main" &&
    configGateState === "ready" &&
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
          onRestart={serviceStore.restart}
          onOpenLogDirectory={openLogDirectory}
          onChangePort={openSettings}
          locale={settings.settings?.locale ?? "zh-CN"}
        />
        {configImportDialog}
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
      {configImportDialog}
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
          <img className="startup-icon-image" src={appIconUrl} alt="" />
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

interface RuntimeConfigCheckInput {
  windowRole: WindowRole;
  hasSettings: boolean;
  configGateState: ConfigGateState;
}

export function shouldCheckRuntimeConfig({
  windowRole,
  hasSettings,
  configGateState,
}: RuntimeConfigCheckInput): boolean {
  return windowRole === "main" && hasSettings && configGateState === "checking";
}

interface ManagementSecretCheckInput {
  windowRole: WindowRole;
  hasSettings: boolean;
  configGateState: ConfigGateState;
  secretGateState: SecretGateState;
}

export function shouldCheckManagementSecret({
  windowRole,
  hasSettings,
  configGateState,
  secretGateState,
}: ManagementSecretCheckInput): boolean {
  return (
    windowRole === "main" &&
    hasSettings &&
    configGateState === "ready" &&
    secretGateState === "checking"
  );
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

export function shouldShowShellWindow(input: {
  windowRole: WindowRole;
  hasSettings: boolean;
  settingsError: string | null;
  openPanelOnStart: boolean | null;
  configGateState: ConfigGateState;
  secretGateState: SecretGateState;
  snapshotStatus: ServiceStatus | null;
  statusRequested: boolean;
  startupFailed: boolean;
}): boolean {
  if (input.windowRole !== "main") {
    return false;
  }

  if (input.statusRequested || input.startupFailed) {
    return true;
  }

  if (input.settingsError && !input.hasSettings) {
    return true;
  }

  if (input.configGateState === "missing" || input.configGateState === "failed") {
    return true;
  }

  if (
    input.configGateState === "ready" &&
    (input.secretGateState === "missing" || input.secretGateState === "failed")
  ) {
    return true;
  }

  if (
    input.snapshotStatus &&
    shouldUseRecoveryView(input.snapshotStatus)
  ) {
    return true;
  }

  if (!input.hasSettings || input.openPanelOnStart === null) {
    return false;
  }

  return input.openPanelOnStart;
}

async function showShellWindow(): Promise<void> {
  try {
    const window = getCurrentWindow();
    if (window.label === "main") {
      await window.show();
      await window.setFocus();
    }
  } catch {
    // 浏览器开发模式下没有 Tauri window runtime。
  }
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
