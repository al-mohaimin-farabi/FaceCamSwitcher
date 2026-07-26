import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  AppSettings,
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
  networkSyncLog: NetworkSyncLogEntry[];
}

const initialState: ObserverState = {
  settings: null,
  observers: [],
  runtime: {},
  folderValidation: null,
  version: "—",
  loaded: false,
  networkSyncConnected: false,
  networkSyncLog: [],
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
    },
    addNetworkSyncLog: (state, action: PayloadAction<NetworkSyncLogEntry>) => {
      state.networkSyncLog.push(action.payload);
      if (state.networkSyncLog.length > 200) state.networkSyncLog.shift();
    },
    clearNetworkSyncLog: (state) => {
      state.networkSyncLog = [];
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
  addNetworkSyncLog,
  clearNetworkSyncLog,
} = observerSlice.actions;

export default observerSlice.reducer;
