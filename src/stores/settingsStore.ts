import { useSyncExternalStore } from "react";

import {
  checkForUpdates,
  getDesktopSettings,
  installUpstreamComponentUpdates,
  updateDesktopSettings,
} from "../bridge/commands";
import type {
  ComponentInstallResult,
  DesktopSettings,
  DesktopSettingsPatch,
  ServiceStatus,
  UpstreamInstallScope,
  UpdateCheckResult,
} from "../bridge/types";
import { toErrorMessage } from "./serviceStore";

export interface SettingsDraft {
  autoStartApp: boolean;
  autoStartService: boolean;
  openPanelOnStart: boolean;
  portText: string;
  autoCheckNewVersions: boolean;
}

export interface SettingsStoreState {
  settings: DesktopSettings | null;
  draft: SettingsDraft | null;
  updateResult: UpdateCheckResult | null;
  installResult: ComponentInstallResult | null;
  error: string | null;
  isBusy: boolean;
}

export interface SettingsCommands {
  getDesktopSettings: typeof getDesktopSettings;
  updateDesktopSettings: typeof updateDesktopSettings;
  checkForUpdates: typeof checkForUpdates;
  installUpstreamComponentUpdates: typeof installUpstreamComponentUpdates;
}

export interface SettingsStore {
  getState(): SettingsStoreState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  setDraft(patch: Partial<SettingsDraft>): void;
  checkUpdates(): Promise<void>;
  installUpdates(restartAfterInstall: boolean): Promise<void>;
}

export type PortValidationResult =
  | { ok: true; port: number }
  | { ok: false; message: string };

const defaultState: SettingsStoreState = {
  settings: null,
  draft: null,
  updateResult: null,
  installResult: null,
  error: null,
  isBusy: false,
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
    autoStartService: settings.autoStartService,
    openPanelOnStart: settings.openPanelOnStart,
    portText: String(settings.port),
    autoCheckNewVersions: settings.autoCheckNewVersions,
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
  if (draft.autoStartService !== current.autoStartService) {
    patch.autoStartService = draft.autoStartService;
  }
  if (draft.openPanelOnStart !== current.openPanelOnStart) {
    patch.openPanelOnStart = draft.openPanelOnStart;
  }
  if (draft.autoCheckNewVersions !== current.autoCheckNewVersions) {
    patch.autoCheckNewVersions = draft.autoCheckNewVersions;
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
    try {
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
      if (version < appliedSaveVersion) {
        endBusy();
        return;
      }

      endBusy({ error: toErrorMessage(caught) });
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
        const settings = await commands.getDesktopSettings();
        draftVersion += 1;
        appliedSaveVersion = draftVersion;
        endBusy({
          settings,
          draft: createPortDraft(settings),
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
      beginBusy();
      try {
        const updateResult = await commands.checkForUpdates();
        endBusy({
          updateResult,
          settings: state.settings
            ? { ...state.settings, lastUpdateCheckAt: updateResult.checkedAt }
            : state.settings,
          installResult: null,
        });
      } catch (caught) {
        endBusy({ error: toErrorMessage(caught) });
      }
    },
    async installUpdates(restartAfterInstall) {
      const scope = state.updateResult?.upstream.installScope ?? "None";
      if (!canInstallScope(scope)) {
        emit({ error: "没有可安装的上游组件更新" });
        return;
      }

      beginBusy();
      try {
        endBusy({
          installResult: await commands.installUpstreamComponentUpdates(
            scope,
            restartAfterInstall,
          ),
        });
      } catch (caught) {
        endBusy({ error: toErrorMessage(caught) });
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
  installUpstreamComponentUpdates,
});

export function useSettingsStore(): SettingsStoreState {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getState,
    settingsStore.getState,
  );
}
