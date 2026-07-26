import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  AppSettings,
  DbPlayer,
  FolderValidation,
  NetworkSyncLogEntry,
  ObserverConfig,
  ObserverRuntimeState,
  ObserverUpdate,
} from "../lib/debugger/types";

interface ObserverState {
  settings: AppSettings | null;
  observers: ObserverConfig[];
  /** Live runtime state keyed by observer id. */
  runtime: Record<string, ObserverRuntimeState>;
  folderValidation: FolderValidation | null;
  version: string;
  loaded: boolean;
  networkSyncConnected: boolean;
  /** True only once the server has confirmed ocrAuthSuccess — distinct from
   *  networkSyncConnected so the UI can show "connected, not yet
   *  authenticated" instead of a misleading fully-connected state. */
  networkSyncAuthenticated: boolean;
  networkSyncLog: NetworkSyncLogEntry[];
  /** Tournament roster fetched from the FaceCam database — fetched once
   *  (via TeamInfo's Fetch Players), cached here for reuse instead of a
   *  network call per detection. */
  dbPlayers: DbPlayer[];
}

const initialState: ObserverState = {
  settings: null,
  observers: [],
  runtime: {},
  folderValidation: null,
  version: "—",
  loaded: false,
  networkSyncConnected: false,
  networkSyncAuthenticated: false,
  networkSyncLog: [],
  dbPlayers: [],
};

export const observerSlice = createSlice({
  name: "observer",
  initialState,
  reducers: {
    setSettings: (state, action: PayloadAction<AppSettings>) => {
      state.settings = action.payload;
      state.observers = action.payload.observers;
      state.loaded = true;
    },
    setObservers: (state, action: PayloadAction<ObserverConfig[]>) => {
      state.observers = action.payload;
      if (state.settings) state.settings.observers = action.payload;
    },
    applyObserverUpdate: (state, action: PayloadAction<ObserverUpdate>) => {
      const u = action.payload;
      state.runtime[u.observerId] = {
        observerId: u.observerId,
        status: u.status,
        currentObserver: u.currentObserver,
        lastMessage: u.lastMessage,
        lastHeartbeatAt: u.lastHeartbeatAt,
      };
    },
    removeRuntime: (state, action: PayloadAction<string>) => {
      delete state.runtime[action.payload];
    },
    setFolderValidation: (
      state,
      action: PayloadAction<FolderValidation | null>,
    ) => {
      state.folderValidation = action.payload;
    },
    setVersion: (state, action: PayloadAction<string>) => {
      state.version = action.payload;
    },
    setNetworkSyncConnected: (state, action: PayloadAction<boolean>) => {
      state.networkSyncConnected = action.payload;
      // Cascade: can't be authenticated while disconnected — one source of
      // truth invariant, mirrors localized-input's setWsConnected reducer.
      if (!action.payload) state.networkSyncAuthenticated = false;
    },
    setNetworkSyncAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.networkSyncAuthenticated = action.payload;
    },
    addNetworkSyncLog: (state, action: PayloadAction<NetworkSyncLogEntry>) => {
      state.networkSyncLog.push(action.payload);
      if (state.networkSyncLog.length > 200) state.networkSyncLog.shift();
    },
    clearNetworkSyncLog: (state) => {
      state.networkSyncLog = [];
    },
    setDbPlayers: (state, action: PayloadAction<DbPlayer[]>) => {
      state.dbPlayers = action.payload;
    },
  },
});

export const {
  setSettings,
  setObservers,
  applyObserverUpdate,
  removeRuntime,
  setFolderValidation,
  setVersion,
  setNetworkSyncConnected,
  setNetworkSyncAuthenticated,
  addNetworkSyncLog,
  clearNetworkSyncLog,
  setDbPlayers,
} = observerSlice.actions;

export default observerSlice.reducer;

// ── Derived lookup ────────────────────────────────────────────────────
// Built once per `dbPlayers` reference change (only changes via setDbPlayers,
// i.e. once per fetch — not per detection), not recomputed on every access.
let cachedFor: DbPlayer[] | null = null;
let cachedMap: Map<string, string> = new Map();

/** Lowercase ign -> database player id, for O(1) switch-time resolution. */
export function dbPlayerIdByIgn(players: DbPlayer[]): Map<string, string> {
  if (cachedFor === players) return cachedMap;
  cachedMap = new Map(players.map((p) => [p.ign.toLowerCase(), p.id]));
  cachedFor = players;
  return cachedMap;
}
