import { useSyncExternalStore } from "react";

import {
  getServiceSnapshot,
  openPanel,
  restartService,
  startService,
  stopService,
} from "../bridge/commands";
import type { ServiceSnapshot, ServiceStatus } from "../bridge/types";

export interface ServiceCommands {
  getServiceSnapshot: typeof getServiceSnapshot;
  startService: typeof startService;
  stopService: typeof stopService;
  restartService: typeof restartService;
  openPanel: typeof openPanel;
}

export interface ServiceStoreState {
  snapshot: ServiceSnapshot | null;
  error: string | null;
  isBusy: boolean;
  panelOpening: boolean;
  panelOpened: boolean;
}

export interface ServiceStore {
  getState(): ServiceStoreState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  openPanel(): Promise<void>;
}

const defaultState: ServiceStoreState = {
  snapshot: null,
  error: null,
  isBusy: false,
  panelOpening: false,
  panelOpened: false,
};

export function shouldUseRecoveryView(status: ServiceStatus): boolean {
  return ["Stopped", "Stopping", "Unhealthy", "External", "Error"].includes(status);
}

export function createServiceStore(commands: ServiceCommands): ServiceStore {
  let state = defaultState;
  const listeners = new Set<() => void>();

  function emit(next: Partial<ServiceStoreState>) {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener();
    }
  }

  async function runSnapshotCommand(
    command: () => Promise<ServiceSnapshot>,
  ): Promise<void> {
    emit({ isBusy: true, error: null });
    try {
      emit({ snapshot: await command(), isBusy: false });
    } catch (caught) {
      emit({ error: toErrorMessage(caught), isBusy: false });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh() {
      return runSnapshotCommand(commands.getServiceSnapshot);
    },
    start() {
      return runSnapshotCommand(commands.startService);
    },
    stop() {
      return runSnapshotCommand(commands.stopService);
    },
    restart() {
      return runSnapshotCommand(commands.restartService);
    },
    async openPanel() {
      emit({ panelOpening: true, error: null });
      try {
        await commands.openPanel();
        emit({ panelOpening: false, panelOpened: true });
      } catch (caught) {
        emit({
          panelOpening: false,
          panelOpened: false,
          error: toErrorMessage(caught),
        });
      }
    },
  };
}

export const serviceStore = createServiceStore({
  getServiceSnapshot,
  startService,
  stopService,
  restartService,
  openPanel,
});

export function useServiceStore(): ServiceStoreState {
  return useSyncExternalStore(
    serviceStore.subscribe,
    serviceStore.getState,
    serviceStore.getState,
  );
}

export function toErrorMessage(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message;
  }

  if (typeof caught === "string") {
    return caught;
  }

  if (caught && typeof caught === "object" && "code" in caught) {
    return String((caught as { code: unknown }).code);
  }

  return "未知错误";
}
