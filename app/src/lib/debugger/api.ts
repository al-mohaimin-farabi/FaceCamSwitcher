// Typed wrappers around the Tauri command surface. The frontend never touches
// the filesystem or parses raw log lines directly (spec §9.3) — it only calls
// these commands and listens for `observer_update` events.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  DetectionResult,
  FetchedPlayer,
  FolderValidation,
  ObserverConfig,
  ObserverUpdate,
} from "./types";

type CommandResult = { success: boolean; message: string };

export const api = {
  loadSettings: () => invoke<AppSettings>("load_settings"),
  saveSettings: (settings: AppSettings) =>
    invoke<CommandResult>("save_settings", { settings }),

  detectDebuggerFolder: () => invoke<DetectionResult>("detect_debugger_folder"),
  validateDebuggerFolder: (path: string) =>
    invoke<FolderValidation>("validate_debugger_folder", { path }),
  setDebuggerFolder: (path: string) =>
    invoke<FolderValidation>("set_debugger_folder", { path }),

  listObservers: () => invoke<ObserverConfig[]>("list_observers"),
  upsertObserver: (observer: ObserverConfig) =>
    invoke<ObserverConfig>("upsert_observer", { observer }),
  deleteObserver: (id: string) =>
    invoke<CommandResult>("delete_observer", { id }),

  startObserver: (id: string) => invoke<CommandResult>("start_observer", { id }),
  stopObserver: (id: string) => invoke<CommandResult>("stop_observer", { id }),
  startAllObservers: () => invoke<CommandResult>("start_all_observers"),
  stopAllObservers: () => invoke<CommandResult>("stop_all_observers"),

  getObserverStates: () => invoke<ObserverUpdate[]>("get_observer_states"),

  appVersion: () => invoke<string>("app_version"),
  fetchPlayersFromDebugger: () =>
    invoke<FetchedPlayer[]>("fetch_players_from_debugger"),
};
