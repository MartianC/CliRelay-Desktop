import { useSyncExternalStore } from "react";

import {
  checkForUpdates,
  getDesktopSettings,
  updateDesktopSettings,
} from "../bridge/commands";
import type {
  DesktopSettings,
  DesktopSettingsPatch,
  ServiceStatus,
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
  error: string | null;
  isBusy: boolean;
}

export interface SettingsCommands {
  getDesktopSettings: typeof getDesktopSettings;
  updateDesktopSettings: typeof updateDesktopSettings;
  checkForUpdates: typeof checkForUpdates;
}

export interface SettingsStore {
  getState(): SettingsStoreState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  setDraft(patch: Partial<SettingsDraft>): void;
  save(): Promise<void>;
  checkUpdates(): Promise<void>;
}

export type PortValidationResult =
  | { ok: true; port: number }
  | { ok: false; message: string };

const defaultState: SettingsStoreState = {
  settings: null,
  draft: null,
  updateResult: null,
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

  function emit(next: Partial<SettingsStoreState>) {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      emit({ isBusy: true, error: null });
      try {
        const settings = await commands.getDesktopSettings();
        emit({
          settings,
          draft: createPortDraft(settings),
          isBusy: false,
        });
      } catch (caught) {
        emit({ error: toErrorMessage(caught), isBusy: false });
      }
    },
    setDraft(patch) {
      if (!state.draft) {
        return;
      }
      emit({ draft: { ...state.draft, ...patch } });
    },
    async save() {
      if (!state.settings || !state.draft) {
        return;
      }

      emit({ isBusy: true, error: null });
      try {
        const updated = await commands.updateDesktopSettings(
          toSettingsPatch(state.settings, state.draft),
        );
        emit({
          settings: updated,
          draft: createPortDraft(updated),
          isBusy: false,
        });
      } catch (caught) {
        emit({ error: toErrorMessage(caught), isBusy: false });
      }
    },
    async checkUpdates() {
      emit({ isBusy: true, error: null });
      try {
        emit({
          updateResult: await commands.checkForUpdates(),
          isBusy: false,
        });
      } catch (caught) {
        emit({ error: toErrorMessage(caught), isBusy: false });
      }
    },
  };
}

export const settingsStore = createSettingsStore({
  getDesktopSettings,
  updateDesktopSettings,
  checkForUpdates,
});

export function useSettingsStore(): SettingsStoreState {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getState,
    settingsStore.getState,
  );
}
