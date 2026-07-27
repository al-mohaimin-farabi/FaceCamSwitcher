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

// ── Derived lookups ───────────────────────────────────────────────────
// Built once per `dbPlayers` reference change (only changes via setDbPlayers,
// i.e. once per fetch — not per detection), not recomputed on every access.
let cachedIgnFor: DbPlayer[] | null = null;
let cachedIgnMap: Map<string, string> = new Map();

/** Lowercase ign -> database player id — fallback tier, tried only when uid
 *  isn't available or doesn't match (game display name and the database's
 *  registered name can drift; uid can't). Not filtered by isActive — the
 *  app has no reliable, real-time way to know if an admin just flipped that
 *  flag, so it resolves whoever matches and lets the server decide whether
 *  they're actually live (it checks real mediasoup producer state, which is
 *  always fresh — see ocr.handler.js's playerDetected handler). Filtering
 *  here on a stale cached flag would silently break a just-reactivated
 *  substitute until the next manual re-fetch — worse than the no-op it was
 *  meant to prevent. */
export function dbPlayerIdByIgn(players: DbPlayer[]): Map<string, string> {
  if (cachedIgnFor === players) return cachedIgnMap;
  cachedIgnMap = new Map(players.map((p) => [p.ign.toLowerCase(), p.id]));
  cachedIgnFor = players;
  return cachedIgnMap;
}

let cachedUidFor: DbPlayer[] | null = null;
let cachedUidMap: Map<string, string> = new Map();

/** uid -> database player id — primary match tier, for O(1) switch-time
 *  resolution. Exact, not fuzzy: a Free Fire uid is a stable identifier.
 *  Not filtered by isActive — see dbPlayerIdByIgn. */
export function dbPlayerIdByUid(players: DbPlayer[]): Map<string, string> {
  if (cachedUidFor === players) return cachedUidMap;
  cachedUidMap = new Map(
    players.filter((p) => p.uid).map((p) => [p.uid, p.id]),
  );
  cachedUidFor = players;
  return cachedUidMap;
}

/** Resolve a live detection (uid/name) to a database player id — uid first
 *  (exact, stable), name only as a fallback. Shared by switch-time matching
 *  (networkSync.ts's handle()) and the Dashboard's live display, so both
 *  always agree on the same resolution for the same detection. */
export function resolveDbPlayerId(
  co: { uid?: string | null; name?: string | null },
  players: DbPlayer[],
): { id: string | undefined; via: "uid" | "name" | null } {
  if (co.uid) {
    const id = dbPlayerIdByUid(players).get(co.uid);
    if (id) return { id, via: "uid" };
  }
  if (co.name) {
    const id = dbPlayerIdByIgn(players).get(co.name.toLowerCase());
    if (id) return { id, via: "name" };
  }
  return { id: undefined, via: null };
}
