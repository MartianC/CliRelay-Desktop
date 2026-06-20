import { useSyncExternalStore } from "react";

import {
  applyPreparedComponentUpdates,
  checkForUpdates,
  confirmPreparedComponentUpdateRestart,
  getAutoStartAppEnabled,
  getDesktopSettings,
  getComponentUpdatePreparation,
  prepareUpstreamComponentUpdates,
  setAutoStartAppEnabled,
  updateDesktopSettings,
} from "../bridge/commands";
import type {
  ComponentApplyResult,
  ComponentUpdatePreparationSnapshot,
  DesktopLocale,
  DesktopSettings,
  DesktopSettingsPatch,
  ServiceStatus,
  UpstreamInstallScope,
  UpdateCheckResult,
} from "../bridge/types";
import { toErrorMessage } from "./serviceStore";

export interface SettingsDraft {
  autoStartApp: boolean;
  silentStart: boolean;
  portText: string;
  autoCheckNewVersions: boolean;
  locale: DesktopLocale;
}

export interface SettingsStoreState {
  settings: DesktopSettings | null;
  draft: SettingsDraft | null;
  updateResult: UpdateCheckResult | null;
  installResult: ComponentApplyResult | null;
  componentPreparation: ComponentUpdatePreparationSnapshot | null;
  error: string | null;
  isBusy: boolean;
  isCheckingUpdates: boolean;
  isPreparingUpdates: boolean;
  isApplyingPreparedUpdate: boolean;
}

export interface ComponentPreparedUpdateApplyOptions {
  serviceStatus: ServiceStatus;
}

export interface SettingsCommands {
  getDesktopSettings: typeof getDesktopSettings;
  updateDesktopSettings: typeof updateDesktopSettings;
  checkForUpdates: typeof checkForUpdates;
  getComponentUpdatePreparation: typeof getComponentUpdatePreparation;
  prepareUpstreamComponentUpdates: typeof prepareUpstreamComponentUpdates;
  applyPreparedComponentUpdates: typeof applyPreparedComponentUpdates;
  confirmPreparedComponentUpdateRestart: typeof confirmPreparedComponentUpdateRestart;
  getAutoStartAppEnabled: typeof getAutoStartAppEnabled;
  setAutoStartAppEnabled: typeof setAutoStartAppEnabled;
}

export interface SettingsStore {
  getState(): SettingsStoreState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  setDraft(patch: Partial<SettingsDraft>): void;
  checkUpdates(): Promise<void>;
  prepareUpdates(): Promise<void>;
  refreshComponentPreparation(): Promise<void>;
  applyPreparedUpdate(options: ComponentPreparedUpdateApplyOptions): Promise<void>;
}

export type PortValidationResult =
  | { ok: true; port: number }
  | { ok: false; message: string };

const defaultState: SettingsStoreState = {
  settings: null,
  draft: null,
  updateResult: null,
  installResult: null,
  componentPreparation: null,
  error: null,
  isBusy: false,
  isCheckingUpdates: false,
  isPreparingUpdates: false,
  isApplyingPreparedUpdate: false,
};

export function canEditServicePort(status: ServiceStatus): boolean {
  return status === "Stopped";
}

export function validateServicePort(value: string): PortValidationResult {
  const trimmed = value.trim();
  const port = Number(trimmed);

  if (!trimmed || !Number.isInteger(port)) {
    return { ok: false, message: "端口必须是整数" };
  }

  if (port < 1024 || port > 65535) {
    return { ok: false, message: "端口必须在 1024-65535 范围内" };
  }

  return { ok: true, port };
}

export function createPortDraft(settings: DesktopSettings): SettingsDraft {
  return {
    autoStartApp: settings.autoStartApp,
    silentStart: !settings.openPanelOnStart,
    portText: String(settings.port),
    autoCheckNewVersions: settings.autoCheckNewVersions,
    locale: settings.locale,
  };
}

export function shouldAutoCheckUpdates(
  settings: DesktopSettings,
  now = new Date(),
): boolean {
  if (!settings.autoCheckNewVersions) {
    return false;
  }

  if (!settings.lastUpdateCheckAt) {
    return true;
  }

  const lastCheckedAt = new Date(settings.lastUpdateCheckAt);
  if (Number.isNaN(lastCheckedAt.getTime())) {
    return true;
  }

  return now.getTime() - lastCheckedAt.getTime() >= 24 * 60 * 60 * 1000;
}

export function toSettingsPatch(
  current: DesktopSettings,
  draft: SettingsDraft,
): DesktopSettingsPatch {
  const patch: DesktopSettingsPatch = {};
  const port = validateServicePort(draft.portText);

  if (!port.ok) {
    throw new Error(port.message);
  }

  if (draft.autoStartApp !== current.autoStartApp) {
    patch.autoStartApp = draft.autoStartApp;
  }
  const openPanelOnStart = !draft.silentStart;
  if (openPanelOnStart !== current.openPanelOnStart) {
    patch.openPanelOnStart = openPanelOnStart;
  }
  if (draft.autoCheckNewVersions !== current.autoCheckNewVersions) {
    patch.autoCheckNewVersions = draft.autoCheckNewVersions;
  }
  if (draft.locale !== current.locale) {
    patch.locale = draft.locale;
  }
  if (port.port !== current.port) {
    patch.port = port.port;
  }

  return patch;
}

export function createSettingsStore(commands: SettingsCommands): SettingsStore {
  let state = defaultState;
  const listeners = new Set<() => void>();
  let busyCount = 0;
  let draftVersion = 0;
  let appliedSaveVersion = 0;

  function emit(next: Partial<SettingsStoreState>) {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener();
    }
  }

  function beginBusy() {
    busyCount += 1;
    emit({ isBusy: true, error: null });
  }

  function endBusy(next: Partial<SettingsStoreState> = {}) {
    busyCount = Math.max(0, busyCount - 1);
    emit({ ...next, isBusy: busyCount > 0 });
  }

  async function persistDraft(draft: SettingsDraft, version: number) {
    if (!state.settings) {
      return;
    }

    let patch: DesktopSettingsPatch;
    try {
      patch = toSettingsPatch(state.settings, draft);
    } catch {
      return;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    beginBusy();
    const previousSettings = state.settings;
    const previousAutoStartApp = previousSettings.autoStartApp;
    let systemAutoStartChanged = false;
    try {
      if (patch.autoStartApp !== undefined) {
        await commands.setAutoStartAppEnabled(patch.autoStartApp);
        systemAutoStartChanged = true;
      }

      const updated = await commands.updateDesktopSettings(patch);
      if (version < appliedSaveVersion) {
        endBusy();
        return;
      }

      appliedSaveVersion = version;
      endBusy({
        settings: updated,
        draft: version === draftVersion ? createPortDraft(updated) : state.draft,
      });
    } catch (caught) {
      if (patch.autoStartApp !== undefined && systemAutoStartChanged) {
        try {
          await commands.setAutoStartAppEnabled(previousAutoStartApp);
        } catch {
          // 这里保留原始保存错误；下一次加载会重新以系统登录项状态校准。
        }
      }

      if (version < appliedSaveVersion) {
        endBusy();
        return;
      }

      endBusy({
        error:
          patch.autoStartApp !== undefined
            ? "登录时启动设置失败，请检查系统权限。"
            : toErrorMessage(caught),
        draft: createPortDraft(previousSettings),
      });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      beginBusy();
      try {
        const rawSettings = await commands.getDesktopSettings();
        let settings = rawSettings;
        let loadError: string | null = null;

        try {
          const systemAutoStartApp = await commands.getAutoStartAppEnabled();
          if (systemAutoStartApp !== rawSettings.autoStartApp) {
            settings = await commands.updateDesktopSettings({
              autoStartApp: systemAutoStartApp,
            });
          }
        } catch {
          loadError = "登录时启动状态读取失败，请检查系统权限。";
        }

        const componentPreparation = await commands.getComponentUpdatePreparation();
        draftVersion += 1;
        appliedSaveVersion = draftVersion;
        endBusy({
          settings,
          draft: createPortDraft(settings),
          updateResult: settings.lastUpdateCheckResult,
          installResult: null,
          componentPreparation,
          error: loadError,
          isPreparingUpdates: componentPreparation.status === "Preparing",
          isApplyingPreparedUpdate: false,
        });
      } catch (caught) {
        endBusy({ error: toErrorMessage(caught) });
      }
    },
    setDraft(patch) {
      if (!state.draft) {
        return;
      }

      const draft = { ...state.draft, ...patch };
      draftVersion += 1;
      const version = draftVersion;
      emit({ draft });
      void persistDraft(draft, version);
    },
    async checkUpdates() {
      if (state.isCheckingUpdates) {
        return;
      }

      beginBusy();
      emit({ isCheckingUpdates: true });
      try {
        const updateResult = await commands.checkForUpdates();
        endBusy({
          updateResult,
          settings: state.settings
            ? {
                ...state.settings,
                lastUpdateCheckAt: updateResult.checkedAt,
                lastUpdateCheckResult: updateResult,
              }
            : state.settings,
          installResult: null,
          componentPreparation: null,
          isCheckingUpdates: false,
        });
      } catch (caught) {
        endBusy({
          error: toErrorMessage(caught),
          isCheckingUpdates: false,
        });
      }
    },
    async prepareUpdates() {
      const scope = state.updateResult?.upstream.installScope ?? "None";
      if (!canInstallScope(scope)) {
        emit({ error: "没有可准备的上游组件更新" });
        return;
      }

      if (state.isPreparingUpdates || state.isApplyingPreparedUpdate) {
        return;
      }

      emit({ isPreparingUpdates: true, error: null });
      try {
        const componentPreparation = await commands.prepareUpstreamComponentUpdates(scope);
        emit({
          componentPreparation,
          isPreparingUpdates: componentPreparation.status === "Preparing",
          installResult: null,
        });
      } catch (caught) {
        emit({
          error: toErrorMessage(caught),
          isPreparingUpdates: false,
        });
      }
    },
    async refreshComponentPreparation() {
      try {
        const componentPreparation = await commands.getComponentUpdatePreparation();
        emit({
          componentPreparation,
          isPreparingUpdates: componentPreparation.status === "Preparing",
        });
      } catch (caught) {
        emit({ error: toErrorMessage(caught), isPreparingUpdates: false });
      }
    },
    async applyPreparedUpdate(options) {
      if (state.isApplyingPreparedUpdate) {
        return;
      }

      if (state.componentPreparation?.status !== "Ready") {
        emit({ error: "没有已准备好的组件更新" });
        return;
      }

      const confirmed = await commands.confirmPreparedComponentUpdateRestart({
        installScope: state.componentPreparation.installScope,
        serviceStatus: options.serviceStatus,
        locale: state.settings?.locale ?? "zh-CN",
      });
      if (!confirmed) {
        emit({ isApplyingPreparedUpdate: false });
        return;
      }

      emit({ isApplyingPreparedUpdate: true, error: null });
      try {
        const installResult = await commands.applyPreparedComponentUpdates();
        emit({
          installResult,
          isApplyingPreparedUpdate: false,
          componentPreparation: null,
          isPreparingUpdates: false,
        });
      } catch (caught) {
        emit({
          error: toErrorMessage(caught),
          isApplyingPreparedUpdate: false,
        });
      }
    },
  };
}

function canInstallScope(scope: UpstreamInstallScope): boolean {
  return scope === "CliRelay" || scope === "codeProxy" || scope === "Both";
}

export const settingsStore = createSettingsStore({
  getDesktopSettings,
  updateDesktopSettings,
  checkForUpdates,
  getComponentUpdatePreparation,
  prepareUpstreamComponentUpdates,
  applyPreparedComponentUpdates,
  confirmPreparedComponentUpdateRestart,
  getAutoStartAppEnabled,
  setAutoStartAppEnabled,
});

export function useSettingsStore(): SettingsStoreState {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getState,
    settingsStore.getState,
  );
}
