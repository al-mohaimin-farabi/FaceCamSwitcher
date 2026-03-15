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
    url: string;
    method: string;
    headers: Record<string, string>;
    timeout: number;
    retry_count: number;
    retry_delay: number;
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
        state.stats = { scans: 0, detections: 0, matches: 0 };
        state.previewData = null;
      } else {
        state.previewData = null;
      }
    },
    addLog: (state, action: PayloadAction<LogEntry>) => {
      state.logs.push(action.payload);
      if (state.logs.length > 200) {
        state.logs.shift();
      }
    },
    clearLogs: (state) => {
      state.logs = [];
    },
    incrementScans: (state) => {
      state.stats.scans += 1;
    },
    incrementMatches: (state) => {
      state.stats.matches += 1;
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
  },
});

export const {
  setConfig,
  updateConfigField,
  setIsRunning,
  addLog,
  clearLogs,
  incrementScans,
  incrementMatches,
  setPreviewData,
  setWindowList,
  setCameraList,
  setBackendStatus,
} = appSlice.actions;

export default appSlice.reducer;
