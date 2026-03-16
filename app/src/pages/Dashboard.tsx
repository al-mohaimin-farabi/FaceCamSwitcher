import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import LogViewer from "../components/LogViewer";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import {
  setConfig, updateConfigField, setIsRunning, setWindowList, setBackendStatus, addLog, clearLogs
} from "../store/appSlice";
import {
  Activity,
  Play,
  Square,
  BarChart3,
  Zap,
  Camera,
  ScanSearch,
  Monitor,
  RefreshCw,
  Target,
} from "lucide-react";

interface WindowInfo {
  hwnd: number;
  title: string;
}


export default function Dashboard() {
  const dispatch = useDispatch();
  const {
    config,
    isRunning,
    logs,
    stats,
    previewData,
    windowList,
    backendOk,
    backendStatus
  } = useSelector((state: RootState) => state.app);

  const [isRefreshingWindows, setIsRefreshingWindows] = useState(false);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);

  useEffect(() => {
    if (!config) {
      loadConfig();
    }
    checkBackend();
    
    if (windowList.length === 0) handleRefreshWindows();
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<any>("load_config");
      dispatch(setConfig(cfg));
    } catch (e) {
      dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Failed to load config: ${e}` }));
    }
  };

  const checkBackend = async () => {
    try {
      const result = await invoke<{ success: boolean; message: string }>("check_backend");
      dispatch(setBackendStatus({ ok: result.success, message: result.message }));
    } catch {
      dispatch(setBackendStatus({ ok: false, message: "Backend unavailable" }));
    }
  };

  const handleStartStop = async () => {
    if (isRunning) {
      try {
        await invoke("stop_ocr");
        dispatch(setIsRunning(false));
      } catch (e) {
        dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Failed to stop OCR: ${e}` }));
      }
    } else {
      try {
        await invoke("start_ocr");
        dispatch(setIsRunning(true));
      } catch (e) {
        dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Failed to start OCR: ${e}` }));
      }
    }
  };

  const handleRefreshWindows = async () => {
    setIsRefreshingWindows(true);
    try {
      const windows = await invoke<WindowInfo[]>("list_windows");
      dispatch(setWindowList(windows));
    } catch (e) {
      dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Failed to list windows: ${e}` }));
    } finally {
      setIsRefreshingWindows(false);
    }
  };

  const handleSelectWindowRegion = async () => {
    setIsSelectingRegion(true);
    try {
      const hwnd = config?.input_source?.window_hwnd ?? 0;
      await invoke("open_window_region_selector", { hwnd });
      await loadConfig();
    } catch (e) {
      dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Region Selector Error: ${e}` }));
    } finally {
      setIsSelectingRegion(false);
    }
  };

  const updateConfigValue = async (path: string, value: any) => {
    if (!config) return;
    try {
      const cfg = await invoke<any>("load_config");
      const parts = path.split(".");
      let obj: any = cfg;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      await invoke("save_config", { config: cfg });
      await loadConfig();
    } catch (e) {
      dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Failed to update config: ${e}` }));
    }
  };

  const handleSelectWindow = async (hwnd: number, title: string) => {
    // Optimistic update
    dispatch(updateConfigField({ path: "input_source.type", value: "window" }));
    dispatch(updateConfigField({ path: "input_source.window_hwnd", value: hwnd }));
    dispatch(updateConfigField({ path: "input_source.window_title", value: title }));

    try {
      const cfg = await invoke<any>("load_config");
      cfg.input_source = { ...cfg.input_source, type: "window", window_hwnd: hwnd, window_title: title };
      await invoke("save_config", { config: cfg });
    } catch (e) {
      dispatch(addLog({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), level: "error", message: `Failed to save window: ${e}` }));
    }
  };

  const src = config?.input_source;

  return (
    <div style={{ display: "flex", height: "100%", padding: "16px", gap: "16px" }} className="animate-fade-in">

      {/* ── Left Panel ─────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>

        {/* System Status */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Activity size={14} className="icon" /> System Status
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className={`status-dot ${backendOk ? "online" : "error"}`} />
            <span style={{ fontSize: 12, color: backendOk ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
              {backendOk ? "Backend Ready" : "Backend Unavailable"}
            </span>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{backendStatus}</p>
        </div>

        {/* Input Source Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Monitor size={14} className="icon" /> Input Source
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                className="input"
                style={{ flex: 1, fontSize: 12 }}
                value={src?.window_hwnd ?? 0}
                onChange={(e) => {
                  const hwnd = parseInt(e.target.value) || 0;
                  const win = windowList.find((w) => w.hwnd === hwnd);
                  if (win) handleSelectWindow(win.hwnd, win.title);
                }}
              >
                <option value={0}>— Select a window —</option>
                {windowList.map((w) => (
                  <option key={w.hwnd} value={w.hwnd}>{w.title}</option>
                ))}
              </select>
              <button
                className="btn btn-accent"
                style={{ height: 36, padding: "0 10px", borderRadius: 8, flexShrink: 0 }}
                onClick={handleRefreshWindows}
                disabled={isRefreshingWindows}
                title="Refresh window list"
              >
                <RefreshCw size={13} className={isRefreshingWindows ? "animate-spin" : ""} />
              </button>
            </div>
            {src?.window_title ? (
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -2 }}>{src.window_title}</p>
            ) : (
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -2 }}>Click refresh then select a window</p>
            )}

            {/* Capture Region */}
            <div style={{ marginTop: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                Capture Region
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["left", "top", "width", "height"] as const).map((field) => (
                  <div className="input-group" key={field} style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: 10, textTransform: "capitalize" }}>{field === "left" ? "X Offset" : field === "top" ? "Y Offset" : field}</label>
                    <input
                      className="input"
                      type="number"
                      style={{ fontSize: 12, padding: "6px 10px" }}
                      value={src?.window_region?.[field] ?? 0}
                      onChange={(e) => updateConfigValue(`input_source.window_region.${field}`, parseInt(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              className="btn btn-accent"
              style={{ width: "100%", height: 34, borderRadius: 8, fontSize: 12, marginTop: 4 }}
              onClick={handleSelectWindowRegion}
              disabled={isSelectingRegion || !(src?.window_hwnd)}
            >
              {isSelectingRegion ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <><Target size={13} /> Select Region in Window</>
              )}
            </button>
          </div>
        </div>

        {/* Controls Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Zap size={14} className="icon" /> Controls
          </div>
          <button
            className={`btn ${isRunning ? "btn-danger" : "btn-success"}`}
            style={{ width: "100%", height: 48, fontSize: 14, fontWeight: 700 }}
            onClick={handleStartStop}
            disabled={!backendOk}
          >
            {isRunning ? (
              <><Square size={16} fill="currentColor" /> Stop Capture</>
            ) : (
              <><Play size={16} fill="currentColor" /> Start Capture</>
            )}
          </button>
          {isRunning && (
            <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "var(--green-bg)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", gap: 8 }} className="animate-fade-in">
              <span className="status-dot online" />
              <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>OCR Running</span>
            </div>
          )}
        </div>

        {/* Stats Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <BarChart3 size={14} className="icon" /> Session Stats
          </div>
          <div className="grid-3">
            {[
              { label: "Scans", value: stats.scans, color: "var(--accent)" },
              { label: "Detected", value: stats.detections, color: "var(--cyan)" },
              { label: "Matches", value: stats.matches, color: "var(--green)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="stat-card" style={{ padding: 10 }}>
                <div className="value" style={{ fontSize: 18, color }}>{value}</div>
                <div className="label">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right Panel ────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflow: "hidden" }}>

        {/* Preview Grid */}
        <div style={{ display: "flex", gap: 16, height: 180, flexShrink: 0 }}>
          <div className="glass-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="section-header" style={{ padding: "12px 16px", marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
              <Camera size={15} className="icon" style={{ marginTop: -2 }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>CAPTURE PREVIEW</span>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(0,0,0,0.15)" }}>
              {previewData?.image ? (
                <img src={`data:image/jpeg;base64,${previewData.image}`} alt="Capture"
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", border: "2px solid rgba(255,255,255,0.05)", borderRadius: 4 }} />
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Waiting for capture...</div>
              )}
            </div>
          </div>

          <div className="glass-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="section-header" style={{ padding: "12px 16px", marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
              <ScanSearch size={15} className="icon" style={{ marginTop: -2 }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>CURRENT DETECTION</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "12px 20px", overflow: "hidden" }}>
              {previewData?.detections && previewData.detections.length > 0 ? (
                previewData.detections.map((d, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: d.matched_name ? "var(--green)" : "var(--accent)" }}>
                      {d.matched_name || "NO MATCH"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
                      "{d.raw_text}" (Conf: {(d.confidence * 100).toFixed(0)}%, Fuzz: {d.match_score}%)
                    </div>
                  </div>
                ))
              ) : previewData ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No text detected in region</div>
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Waiting for capture...</div>
              )}
            </div>
          </div>
        </div>

        {/* Log Viewer */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <LogViewer logs={logs} onClear={() => dispatch(clearLogs())} />
        </div>
      </div>
    </div>
  );
}
