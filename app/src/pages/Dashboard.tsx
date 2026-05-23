import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import LogViewer from "../components/LogViewer";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import {
  setConfig,
  updateConfigField,
  setIsRunning,
  setWindowList,
  setCameraList,
  setBackendStatus,
  addLog,
  clearLogs,
  clearDetectionEvents,
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
  Video,
  RotateCcw,
  Layers,
} from "lucide-react";

interface WindowInfo {
  hwnd: number;
  title: string;
}

interface CameraInfo {
  index: number;
  name: string;
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
    cameraList,
    backendOk,
    backendStatus,
    lastVmixAction,
    vmixTestResult,
    detectionEvents,
  } = useSelector((state: RootState) => state.app);

  const [isRefreshingWindows, setIsRefreshingWindows] = useState(false);
  const [isRefreshingCameras, setIsRefreshingCameras] = useState(false);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);

  // "window" or "camera"
  const srcType = config?.input_source?.type ?? "window";

  useEffect(() => {
    const tasks: Promise<any>[] = [checkBackend()];
    if (!config) tasks.push(loadConfig());
    if (windowList.length === 0) tasks.push(handleRefreshWindows());
    if (cameraList.length === 0) tasks.push(handleRefreshCameras());
    Promise.all(tasks);

    const unlisten = listen("region-saved", () => {
      loadConfig();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<any>("load_config");
      dispatch(setConfig(cfg));
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to load config: ${e}`,
        }),
      );
    }
  };

  const checkBackend = async () => {
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "check_backend",
      );
      dispatch(
        setBackendStatus({ ok: result.success, message: result.message }),
      );
    } catch {
      dispatch(setBackendStatus({ ok: false, message: "Backend unavailable" }));
    }
  };

  const now = () => new Date().toLocaleTimeString("en-US", { hour12: false });

  const handleStartStop = async () => {
    if (isRunning) {
      try {
        await invoke("stop_ocr");
        dispatch(setIsRunning(false));
      } catch (e) {
        dispatch(
          addLog({
            time: now(),
            level: "error",
            message: `Failed to stop OCR: ${e}`,
          }),
        );
      }
    } else {
      try {
        await invoke("start_ocr");
        dispatch(setIsRunning(true));
      } catch (e) {
        dispatch(
          addLog({
            time: now(),
            level: "error",
            message: `Failed to start OCR: ${e}`,
          }),
        );
      }
    }
  };

  const handleRefreshWindows = async () => {
    setIsRefreshingWindows(true);
    try {
      const windows = await invoke<WindowInfo[]>("list_windows");
      dispatch(setWindowList(windows));
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to list windows: ${e}`,
        }),
      );
    } finally {
      setIsRefreshingWindows(false);
    }
  };

  const handleRefreshCameras = async () => {
    setIsRefreshingCameras(true);
    try {
      const cameras = await invoke<CameraInfo[]>("list_cameras");
      dispatch(setCameraList(cameras));
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to list cameras: ${e}`,
        }),
      );
    } finally {
      setIsRefreshingCameras(false);
    }
  };

  const handleSelectWindowRegion = async () => {
    setIsSelectingRegion(true);
    try {
      const hwnd = config?.input_source?.window_hwnd ?? 0;
      await invoke("open_window_region_selector", { hwnd });
      await loadConfig();
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Region Selector Error: ${e}`,
        }),
      );
    } finally {
      setIsSelectingRegion(false);
    }
  };

  const handleSelectCameraRegion = async () => {
    setIsSelectingRegion(true);
    try {
      const cameraIndex = config?.input_source?.camera_index ?? 0;
      await invoke("open_camera_region_selector", { cameraIndex });
      await loadConfig();
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Camera Region Selector Error: ${e}`,
        }),
      );
    } finally {
      setIsSelectingRegion(false);
    }
  };

  // Debounced config save — waits 500ms after last keystroke before doing IPC
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateConfigValue = useCallback(
    (path: string, value: any) => {
      if (!config) return;
      // Optimistically update Redux immediately (UI feels instant)
      dispatch(updateConfigField({ path, value }));
      // Debounce the actual disk save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          const cfg = await invoke<any>("load_config");
          const parts = path.split(".");
          let obj: any = cfg;
          for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
          }
          obj[parts[parts.length - 1]] = value;
          await invoke("save_config", { config: cfg });
        } catch (e) {
          dispatch(
            addLog({
              time: now(),
              level: "error",
              message: `Failed to update config: ${e}`,
            }),
          );
        }
      }, 500);
    },
    [config, dispatch],
  );

  const handleResetRegion = async () => {
    const blank = { left: 0, top: 0, width: 0, height: 0 };
    try {
      const cfg = await invoke<any>("load_config");
      cfg.input_source.window_region = blank;
      await invoke("save_config", { config: cfg });
      await loadConfig();
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to reset region: ${e}`,
        }),
      );
    }
  };

  const handleSelectWindow = async (hwnd: number, title: string) => {
    dispatch(updateConfigField({ path: "input_source.type", value: "window" }));
    dispatch(
      updateConfigField({ path: "input_source.window_hwnd", value: hwnd }),
    );
    dispatch(
      updateConfigField({ path: "input_source.window_title", value: title }),
    );
    try {
      const cfg = await invoke<any>("load_config");
      // Auto-restore saved region for this window title if one exists
      const savedRegion = cfg.saved_regions?.[title];
      cfg.input_source = {
        ...cfg.input_source,
        type: "window",
        window_hwnd: hwnd,
        window_title: title,
        ...(savedRegion ? { window_region: savedRegion } : {}),
      };
      await invoke("save_config", { config: cfg });
      await loadConfig();
      if (savedRegion) {
        dispatch(
          addLog({
            time: now(),
            level: "success",
            message: `Auto-restored saved region for "${title}"`,
          }),
        );
      }
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to save window: ${e}`,
        }),
      );
    }
  };

  const handleSelectCamera = async (cameraIndex: number) => {
    dispatch(updateConfigField({ path: "input_source.type", value: "camera" }));
    dispatch(
      updateConfigField({
        path: "input_source.camera_index",
        value: cameraIndex,
      }),
    );
    try {
      const cfg = await invoke<any>("load_config");
      const cameraKey = `__camera_${cameraIndex}__`;
      const savedRegion = cfg.saved_regions?.[cameraKey];
      cfg.input_source = {
        ...cfg.input_source,
        type: "camera",
        camera_index: cameraIndex,
        ...(savedRegion ? { window_region: savedRegion } : {}),
      };
      await invoke("save_config", { config: cfg });
      await loadConfig();
      if (savedRegion) {
        dispatch(
          addLog({
            time: now(),
            level: "success",
            message: `Auto-restored saved region for camera ${cameraIndex}`,
          }),
        );
      }
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to save camera: ${e}`,
        }),
      );
    }
  };

  const handleSwitchSourceType = async (type: "window" | "camera") => {
    dispatch(updateConfigField({ path: "input_source.type", value: type }));
    try {
      const cfg = await invoke<any>("load_config");
      cfg.input_source = { ...cfg.input_source, type };
      await invoke("save_config", { config: cfg });
    } catch (e) {
      dispatch(
        addLog({
          time: now(),
          level: "error",
          message: `Failed to switch source type: ${e}`,
        }),
      );
    }
  };

  const src = config?.input_source;

  // Start button requires OCR engine + (for camera mode) a camera selection
  const canStart =
    backendOk &&
    (srcType === "window"
      ? true
      : src?.camera_index !== undefined && cameraList.length > 0);

  return (
    <div
      style={{ display: "flex", height: "100%", padding: "16px", gap: "16px" }}
    >
      {/* ── Left Panel ─────────────────────────── */}
      <div
        style={{
          width: 340,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* System Status */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Activity size={14} className="icon" /> System Status
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* OCR Engine */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className={`status-dot ${backendOk ? "online" : "error"}`}
              />
              <span
                style={{
                  fontSize: 12,
                  color: backendOk ? "var(--green)" : "var(--red)",
                  fontWeight: 600,
                }}
              >
                {backendOk ? "OCR Engine Ready" : "OCR Engine Unavailable"}
              </span>
            </div>
            {/* vMix connection (from last test) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className={`status-dot ${vmixTestResult === null ? "offline" : vmixTestResult.ok ? "online" : "error"}`}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color:
                    vmixTestResult === null
                      ? "var(--text-muted)"
                      : vmixTestResult.ok
                        ? "var(--green)"
                        : "var(--red)",
                }}
              >
                {vmixTestResult === null
                  ? "vMix — Not Tested"
                  : vmixTestResult.ok
                    ? "vMix Connected"
                    : "vMix Unreachable"}
              </span>
            </div>
            {/* Last vMix action */}
            {lastVmixAction && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Layers
                  size={11}
                  style={{ color: "var(--accent)", flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontFamily: '"Cascadia Code", monospace',
                  }}
                >
                  {lastVmixAction.cleared
                    ? `Layer ${lastVmixAction.layer} cleared`
                    : `${lastVmixAction.player} → ${lastVmixAction.camera} (L${lastVmixAction.layer})`}
                </span>
              </div>
            )}
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.5,
              marginTop: 8,
            }}
          >
            {backendStatus}
          </p>
        </div>

        {/* Input Source Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Monitor size={14} className="icon" /> Input Source
          </div>

          {/* Source type toggle */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 12,
              padding: 3,
              background: "var(--bg-input)",
              borderRadius: 10,
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => handleSwitchSourceType("window")}
              style={{
                flex: 1,
                height: 30,
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                background:
                  srcType === "window" ? "var(--accent)" : "transparent",
                color: srcType === "window" ? "#fff" : "var(--text-muted)",
              }}
            >
              <Monitor size={11} /> Window
            </button>
            <button
              onClick={() => handleSwitchSourceType("camera")}
              style={{
                flex: 1,
                height: 30,
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                background:
                  srcType === "camera" ? "var(--cyan)" : "transparent",
                color: srcType === "camera" ? "#fff" : "var(--text-muted)",
              }}
            >
              <Video size={11} /> Virtual Camera
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {srcType === "window" ? (
              /* ── Window mode ── */
              <>
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
                      <option key={w.hwnd} value={w.hwnd}>
                        {w.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-accent"
                    style={{
                      height: 36,
                      padding: "0 10px",
                      borderRadius: 8,
                      flexShrink: 0,
                    }}
                    onClick={handleRefreshWindows}
                    disabled={isRefreshingWindows}
                    title="Refresh window list"
                  >
                    <RefreshCw
                      size={13}
                      className={isRefreshingWindows ? "animate-spin" : ""}
                    />
                  </button>
                </div>
                {src?.window_title ? (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: -2,
                    }}
                  >
                    {src.window_title}
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: -2,
                    }}
                  >
                    Click refresh then select a window
                  </p>
                )}

                {/* Capture Region */}
                <div style={{ marginTop: 6 }}>
                  <label
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Capture Region
                  </label>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    {(["left", "top", "width", "height"] as const).map(
                      (field) => (
                        <div
                          className="input-group"
                          key={field}
                          style={{ marginBottom: 0 }}
                        >
                          <label
                            style={{
                              fontSize: 10,
                              textTransform: "capitalize",
                            }}
                          >
                            {field === "left"
                              ? "X Offset"
                              : field === "top"
                                ? "Y Offset"
                                : field}
                          </label>
                          <input
                            className="input"
                            type="number"
                            style={{ fontSize: 12, padding: "6px 10px" }}
                            value={src?.window_region?.[field] ?? 0}
                            onChange={(e) =>
                              updateConfigValue(
                                `input_source.window_region.${field}`,
                                parseInt(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button
                    className="btn btn-accent"
                    style={{
                      flex: 1,
                      height: 34,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    onClick={handleSelectWindowRegion}
                    disabled={isSelectingRegion || !src?.window_hwnd}
                  >
                    {isSelectingRegion ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <>
                        <Target size={13} /> Select Region
                      </>
                    )}
                  </button>
                  <button
                    className="btn"
                    title="Reset region (capture full window)"
                    style={{
                      height: 34,
                      padding: "0 10px",
                      borderRadius: 8,
                      background: "var(--bg-input)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                    }}
                    onClick={handleResetRegion}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </>
            ) : (
              /* ── Virtual Camera mode ── */
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    className="input"
                    style={{ flex: 1, fontSize: 12 }}
                    value={src?.camera_index ?? 0}
                    onChange={(e) => {
                      const idx = parseInt(e.target.value);
                      handleSelectCamera(idx);
                    }}
                  >
                    {cameraList.length === 0 ? (
                      <option value={0}>— No cameras found —</option>
                    ) : (
                      cameraList.map((c) => (
                        <option key={c.index} value={c.index}>
                          {c.name} (index {c.index})
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    className="btn btn-accent"
                    style={{
                      height: 36,
                      padding: "0 10px",
                      borderRadius: 8,
                      flexShrink: 0,
                    }}
                    onClick={handleRefreshCameras}
                    disabled={isRefreshingCameras}
                    title="Refresh camera list"
                  >
                    <RefreshCw
                      size={13}
                      className={isRefreshingCameras ? "animate-spin" : ""}
                    />
                  </button>
                </div>

                {cameraList.length === 0 ? (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--yellow)",
                      marginTop: -2,
                    }}
                  >
                    Start your virtual camera (OBS/vMix) then click refresh
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: -2,
                    }}
                  >
                    Virtual cameras (OBS, vMix) appear here when running
                  </p>
                )}

                {/* Capture Region */}
                <div style={{ marginTop: 6 }}>
                  <label
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Capture Region
                  </label>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    {(["left", "top", "width", "height"] as const).map(
                      (field) => (
                        <div
                          className="input-group"
                          key={field}
                          style={{ marginBottom: 0 }}
                        >
                          <label
                            style={{
                              fontSize: 10,
                              textTransform: "capitalize",
                            }}
                          >
                            {field === "left"
                              ? "X Offset"
                              : field === "top"
                                ? "Y Offset"
                                : field}
                          </label>
                          <input
                            className="input"
                            type="number"
                            style={{ fontSize: 12, padding: "6px 10px" }}
                            value={src?.window_region?.[field] ?? 0}
                            onChange={(e) =>
                              updateConfigValue(
                                `input_source.window_region.${field}`,
                                parseInt(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button
                    className="btn"
                    style={{
                      flex: 1,
                      height: 34,
                      borderRadius: 8,
                      fontSize: 12,
                      background: "var(--cyan)",
                      color: "#fff",
                      border: "none",
                      cursor:
                        cameraList.length === 0 || isSelectingRegion
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        cameraList.length === 0 || isSelectingRegion ? 0.5 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      fontWeight: 600,
                    }}
                    onClick={handleSelectCameraRegion}
                    disabled={isSelectingRegion || cameraList.length === 0}
                  >
                    {isSelectingRegion ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <>
                        <Target size={13} /> Select Region
                      </>
                    )}
                  </button>
                  <button
                    className="btn"
                    title="Reset region (capture full camera)"
                    style={{
                      height: 34,
                      padding: "0 10px",
                      borderRadius: 8,
                      background: "var(--bg-input)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                    }}
                    onClick={handleResetRegion}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </>
            )}
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
            disabled={!canStart}
            title={
              !backendOk
                ? "Backend is unavailable — check that FaceCam_Backend.exe exists"
                : !canStart
                  ? "Select a camera first"
                  : ""
            }
          >
            {isRunning ? (
              <>
                <Square size={16} fill="currentColor" /> Stop Capture
              </>
            ) : !backendOk ? (
              <>
                <Play size={16} fill="currentColor" /> Backend Unavailable
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" /> Start Capture
              </>
            )}
          </button>
          {isRunning && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--green-bg)",
                border: "1px solid rgba(34,197,94,0.2)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span className="status-dot online" />
              <span
                style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}
              >
                OCR Running
              </span>
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
              {
                label: "Detected",
                value: stats.detections,
                color: "var(--cyan)",
              },
              { label: "Matches", value: stats.matches, color: "var(--green)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="stat-card" style={{ padding: 10 }}>
                <div className="value" style={{ fontSize: 18, color }}>
                  {value}
                </div>
                <div className="label">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right Panel ────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "hidden",
        }}
      >
        {/* Preview Grid */}
        <div style={{ display: "flex", gap: 16, height: 180, flexShrink: 0 }}>
          <div
            className="glass-card"
            style={{ flex: 1, display: "flex", flexDirection: "column" }}
          >
            <div
              className="section-header"
              style={{
                padding: "12px 16px",
                marginBottom: 0,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <Camera size={15} className="icon" style={{ marginTop: -2 }} />
              <span
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}
              >
                CAPTURE PREVIEW
              </span>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 12,
                background: "rgba(0,0,0,0.15)",
              }}
            >
              {previewData?.image ? (
                <img
                  src={`data:image/jpeg;base64,${previewData.image}`}
                  alt="Capture"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    border: "2px solid rgba(255,255,255,0.05)",
                    borderRadius: 4,
                  }}
                />
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {isRunning
                    ? "Waiting for frame..."
                    : "Start capture to see preview"}
                </div>
              )}
            </div>
          </div>

          <div
            className="glass-card"
            style={{ flex: 1, display: "flex", flexDirection: "column" }}
          >
            <div
              className="section-header"
              style={{
                padding: "12px 16px",
                marginBottom: 0,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <ScanSearch
                size={15}
                className="icon"
                style={{ marginTop: -2 }}
              />
              <span
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}
              >
                CURRENT DETECTION
              </span>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: "12px 20px",
                overflow: "hidden",
              }}
            >
              {previewData?.detections && previewData.detections.length > 0 ? (
                previewData.detections.map((d, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: d.matched_name
                          ? "var(--green)"
                          : "var(--accent)",
                      }}
                    >
                      {d.matched_name || "NO MATCH"}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontFamily: '"Cascadia Code", "Consolas", monospace',
                      }}
                    >
                      "{d.raw_text}" (Conf: {(d.confidence * 100).toFixed(0)}%,
                      Fuzz: {d.match_score}%)
                    </div>
                  </div>
                ))
              ) : previewData ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  No text detected in region
                </div>
              ) : (
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                    textAlign: "center",
                  }}
                >
                  {isRunning ? "Processing..." : "Waiting for capture..."}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detection Feed */}
        <div className="glass-card" style={{ flexShrink: 0 }}>
          <div
            className="section-header"
            style={{
              padding: "10px 16px",
              marginBottom: 0,
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={14} className="icon" />
              <span
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}
              >
                DETECTION FEED
              </span>
            </span>
            {detectionEvents.length > 0 && (
              <button
                onClick={() => dispatch(clearDetectionEvents())}
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div
            style={{
              maxHeight: 160,
              overflowY: "auto",
              padding: "6px 0",
            }}
          >
            {detectionEvents.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                No detections yet
              </div>
            ) : (
              detectionEvents.map((ev, i) => (
                <div
                  key={i}
                  style={{
                    padding: "4px 16px",
                    fontSize: 11,
                    fontFamily: '"Cascadia Code", "Consolas", monospace',
                    color: ev.cleared ? "var(--text-muted)" : "var(--green)",
                    borderBottom:
                      i < detectionEvents.length - 1
                        ? "1px solid rgba(255,255,255,0.04)"
                        : "none",
                  }}
                >
                  [{ev.time}]{" "}
                  {ev.cleared
                    ? `Layer ${ev.layer} cleared`
                    : `${ev.player} → ${ev.camera} (L${ev.layer})`}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Log Viewer */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <LogViewer logs={logs} onClear={() => dispatch(clearLogs())} />
        </div>
      </div>
    </div>
  );
}
