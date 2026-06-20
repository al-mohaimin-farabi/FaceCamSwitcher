import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  AppSettings,
  FolderValidation,
  ObserverConfig,
  ObserverRuntimeState,
  ObserverUpdate,
  VmixLogEntry,
} from "../lib/debugger/types";

interface ObserverState {
  settings: AppSettings | null;
  observers: ObserverConfig[];
  /** Live runtime state keyed by observer id. */
  runtime: Record<string, ObserverRuntimeState>;
  folderValidation: FolderValidation | null;
  version: string;
  loaded: boolean;
  vmixConnected: boolean;
  vmixLog: VmixLogEntry[];
}

const initialState: ObserverState = {
  settings: null,
  observers: [],
  runtime: {},
  folderValidation: null,
  version: "—",
  loaded: false,
  vmixConnected: false,
  vmixLog: [],
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
    setFolderValidation: (state, action: PayloadAction<FolderValidation | null>) => {
      state.folderValidation = action.payload;
    },
    setVersion: (state, action: PayloadAction<string>) => {
      state.version = action.payload;
    },
    setVmixConnected: (state, action: PayloadAction<boolean>) => {
      state.vmixConnected = action.payload;
    },
    addVmixLog: (state, action: PayloadAction<VmixLogEntry>) => {
      state.vmixLog.push(action.payload);
      if (state.vmixLog.length > 200) state.vmixLog.shift();
    },
    clearVmixLog: (state) => {
      state.vmixLog = [];
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
  setVmixConnected,
  addVmixLog,
  clearVmixLog,
} = observerSlice.actions;

export default observerSlice.reducer;
