import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface LogEntry {
  time: string;
  level: string;
  message: string;
}

export interface WindowInfo {
  hwnd: number;
  title: string;
}

export interface CameraInfo {
  index: number;
  name: string;
}


export interface AppConfig {
  saved_regions: Record<string, { left: number; top: number; width: number; height: number }>;
  input_source: {
    type: "window" | "camera";
    window_hwnd: number;
    window_title: string;
    window_region: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    camera_index: number;
  };
  server: {
    enabled: boolean;
    url: string;        // legacy field — kept for backward compat
    api_url: string;    // base URL for GET /api/ocr/tournament/:id
    ws_url: string;     // WebSocket URL for OCR bridge
    tournament_id: string;
    secret_key: string;
    source_mode: boolean;  // if true, routes events to a source slot channel
    source_id: string;     // e.g. "01", "02", "03"
  };
  ocr: {
    language: string;
    confidence_threshold: number;
    fuzzy_match_threshold: number;
    use_gpu: boolean;
  };
  capture: {
    interval_seconds: number;
    save_debug_screenshots: boolean;
    debug_screenshot_dir: string;
  };
}

export interface PreviewData {
  image: string;
  detections: {
    raw_text: string;
    matched_name: string | null;
    confidence: number;
    match_score: number;
  }[];
}

interface AppState {
  config: AppConfig | null;
  isRunning: boolean;
  logs: LogEntry[];
  stats: {
    scans: number;
    detections: number;
    matches: number;
  };
  previewData: PreviewData | null;
  windowList: WindowInfo[];
  cameraList: CameraInfo[];
  backendOk: boolean;
  backendStatus: string;
  fetchedPlayerCount: number;
  wsConnected: boolean;
  ocrAuthenticated: boolean;
}

const initialState: AppState = {
  config: null,
  isRunning: false,
  logs: [],
  stats: { scans: 0, detections: 0, matches: 0 },
  previewData: null,
  windowList: [],
  cameraList: [],
  backendOk: false,
  backendStatus: "Checking...",
  fetchedPlayerCount: 0,
  wsConnected: false,
  ocrAuthenticated: false,
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setConfig: (state, action: PayloadAction<AppConfig | null>) => {
      state.config = action.payload;
    },
    updateConfigField: (state, action: PayloadAction<{ path: string; value: any }>) => {
      if (!state.config) return;
      const parts = action.payload.path.split(".");
      let obj: any = state.config;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = action.payload.value;
    },
    setIsRunning: (state, action: PayloadAction<boolean>) => {
      state.isRunning = action.payload;
      if (action.payload) {
        // Reset stats on start, but keep last preview until first new frame arrives
        state.stats = { scans: 0, detections: 0, matches: 0 };
      }
      // Do NOT clear previewData on stop — keep last captured frame visible
    },
    addLog: (state, action: PayloadAction<LogEntry>) => {
      state.logs.push(action.payload);
      if (state.logs.length > 50) {
        state.logs.shift();
      }
    },
    clearLogs: (state) => {
      state.logs = [];
    },
    incrementScans: (state) => {
      state.stats.scans += 1;
    },
    incrementDetections: (state, action: PayloadAction<number>) => {
      state.stats.detections += action.payload;
    },
    incrementMatches: (state, action: PayloadAction<number>) => {
      state.stats.matches += action.payload;
    },
    setPreviewData: (state, action: PayloadAction<PreviewData | null>) => {
      state.previewData = action.payload;
    },
    setWindowList: (state, action: PayloadAction<WindowInfo[]>) => {
      state.windowList = action.payload;
    },
    setCameraList: (state, action: PayloadAction<CameraInfo[]>) => {
      state.cameraList = action.payload;
    },
    setBackendStatus: (state, action: PayloadAction<{ ok: boolean; message: string }>) => {
      state.backendOk = action.payload.ok;
      state.backendStatus = action.payload.message;
    },
    setFetchedPlayerCount: (state, action: PayloadAction<number>) => {
      state.fetchedPlayerCount = action.payload;
    },
    setWsConnected: (state, action: PayloadAction<boolean>) => {
      state.wsConnected = action.payload;
      if (!action.payload) state.ocrAuthenticated = false;
    },
    setOcrAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.ocrAuthenticated = action.payload;
    },
  },
});

export const {
  setConfig,
  updateConfigField,
  setIsRunning,
  addLog,
  clearLogs,
  incrementScans,
  incrementDetections,
  incrementMatches,
  setPreviewData,
  setWindowList,
  setCameraList,
  setBackendStatus,
  setFetchedPlayerCount,
  setWsConnected,
  setOcrAuthenticated,
} = appSlice.actions;

export default appSlice.reducer;
