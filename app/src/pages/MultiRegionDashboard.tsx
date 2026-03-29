import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import LogViewer from "../components/LogViewer";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import {
  setConfig,
  updateConfigField,
  setMrRunning,
  setWindowList,
  setCameraList,
  setBackendStatus,
  addMrLog,
  clearMrLogs,
  type AppConfig,
  type OcrRegion,
} from "../store/appSlice";
import {
  Activity,
  Play,
  Square,
  Zap,
  Camera,
  ScanSearch,
  Monitor,
  RefreshCw,
  Target,
  Video,
  Plus,
  Trash2,
  Layers,
  AlertCircle,
  BarChart3,
} from "lucide-react";

// JSON key name validation: must be non-empty, no spaces, valid identifier-like
function isValidRegionName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

const SANITIZATION_OPTIONS = [
  { value: "none",   label: "Raw" },
  { value: "num2",   label: "Integer ×2  (00)" },
  { value: "num4k",  label: "Integer ×4 / K  (9999)" },
  { value: "mmss",   label: "Duration MM:SS  (02:04)" },
  { value: "text",   label: "Text" },
] as const;

export default function MultiRegionDashboard() {
  const dispatch = useDispatch();
  const {
    config,
    mrRunning,
    mrLogs,
    mrPreviewData,
    windowList,
    cameraList,
    backendOk,
    backendStatus,
  } = useSelector((state: RootState) => state.app);

  const [isRefreshingWindows, setIsRefreshingWindows] = useState(false);
  const [isRefreshingCameras, setIsRefreshingCameras] = useState(false);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);

  // New region form
  const [newRegionName, setNewRegionName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

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
      const cfg = await invoke<AppConfig>("load_config");
      dispatch(setConfig(cfg));
    } catch (e) {
      dispatch(
        addMrLog({
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
    if (mrRunning) {
      try {
        await invoke("stop_multi_region_ocr");
        dispatch(setMrRunning(false));
      } catch (e) {
        dispatch(
          addMrLog({
            time: now(),
            level: "error",
            message: `Failed to stop: ${e}`,
          }),
        );
      }
    } else {
      // Save config first to make sure regions are persisted
      if (config) {
        try {
          await invoke("save_config", { config });
        } catch {}
      }
      try {
        await invoke("start_multi_region_ocr");
        dispatch(setMrRunning(true));
      } catch (e) {
        dispatch(
          addMrLog({
            time: now(),
            level: "error",
            message: `Failed to start: ${e}`,
          }),
        );
      }
    }
  };

  const handleRefreshWindows = async () => {
    setIsRefreshingWindows(true);
    try {
      const windows =
        await invoke<{ hwnd: number; title: string }[]>("list_windows");
      dispatch(setWindowList(windows));
    } catch (e) {
      dispatch(
        addMrLog({
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
      const cameras =
        await invoke<{ index: number; name: string }[]>("list_cameras");
      dispatch(setCameraList(cameras));
    } catch (e) {
      dispatch(
        addMrLog({
          time: now(),
          level: "error",
          message: `Failed to list cameras: ${e}`,
        }),
      );
    } finally {
      setIsRefreshingCameras(false);
    }
  };

  const handleSelectWindow = async (hwnd: number, title: string) => {
    dispatch(updateConfigField({ path: "input_source.type", value: "window" }));
    dispatch(
      updateConfigField({ path: "input_source.window_hwnd", value: hwnd }),
    );
    dispatch(
      updateConfigField({
        path: "input_source.window_title",
        value: title,
      }),
    );
    try {
      const cfg = await invoke<any>("load_config");
      cfg.input_source = {
        ...cfg.input_source,
        type: "window",
        window_hwnd: hwnd,
        window_title: title,
      };
      await invoke("save_config", { config: cfg });
      await loadConfig();
    } catch (e) {
      dispatch(
        addMrLog({
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
      cfg.input_source = {
        ...cfg.input_source,
        type: "camera",
        camera_index: cameraIndex,
      };
      await invoke("save_config", { config: cfg });
      await loadConfig();
    } catch (e) {
      dispatch(
        addMrLog({
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
    } catch {}
  };

  // ── Region Management ──────────────────────────────

  const regions = config?.multi_region?.regions ?? [];

  const saveRegions = async (newRegions: OcrRegion[]) => {
    dispatch(
      updateConfigField({ path: "multi_region.regions", value: newRegions }),
    );
    try {
      const cfg = await invoke<any>("load_config");
      cfg.multi_region = { regions: newRegions };
      await invoke("save_config", { config: cfg });
    } catch {}
  };

  const handleAddRegion = () => {
    const name = newRegionName.trim();
    if (!name) {
      setNameError("Name is required");
      return;
    }
    if (!isValidRegionName(name)) {
      setNameError("Must start with letter/_, only letters, digits, _");
      return;
    }
    if (regions.some((r) => r.name === name)) {
      setNameError("Region name already exists");
      return;
    }
    setNameError(null);
    const newRegion: OcrRegion = {
      name,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      sanitization_type: "none",
    };
    saveRegions([...regions, newRegion]);
    setNewRegionName("");
  };

  const handleRemoveRegion = (name: string) => {
    saveRegions(regions.filter((r) => r.name !== name));
  };

  const handleSanitizationChange = (regionName: string, sanType: string) => {
    saveRegions(regions.map((r) =>
      r.name === regionName ? { ...r, sanitization_type: sanType } : r
    ));
  };

  const [selectingRegionName, setSelectingRegionName] = useState<string | null>(
    null,
  );

  const handleSelectRegion = async (regionName: string) => {
    setSelectingRegionName(regionName);
    try {
      await invoke("open_mr_region_selector", { regionName });
      // Config will reload via the "region-saved" event listener
    } catch (e) {
      dispatch(
        addMrLog({
          time: now(),
          level: "error",
          message: `Region selector error: ${e}`,
        }),
      );
    } finally {
      setSelectingRegionName(null);
    }
  };

  const src = config?.input_source;
  const canStart = backendOk && regions.length > 0;

  // Filter logs to exclude mr_preview level
  const filteredLogs = mrLogs.filter((l) => l.level !== "mr_preview");

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        padding: "16px",
        gap: "16px",
      }}>
      {/* ── Left Panel ─────────────────────────── */}
      <div
        style={{
          width: 340,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "auto",
        }}>
        {/* System Status */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Activity size={14} className="icon" /> System Status
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}>
            <span className={`status-dot ${backendOk ? "online" : "error"}`} />
            <span
              style={{
                fontSize: 12,
                color: backendOk ? "var(--green)" : "var(--red)",
                fontWeight: 600,
              }}>
              {backendOk ? "Backend Ready" : "Backend Unavailable"}
            </span>
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}>
            {backendStatus}
          </p>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 8,
              background: "rgba(6,182,212,0.08)",
              border: "1px solid rgba(6,182,212,0.2)",
              width: "fit-content",
            }}>
            <Layers size={12} style={{ color: "var(--cyan)" }} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--cyan)",
              }}>
              Multi-Region Mode
            </span>
          </div>
        </div>

        {/* Stats Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <BarChart3 size={14} className="icon" /> Session Stats
          </div>
          <div className="grid-3">
            {[
              { label: "Regions", value: regions.length, color: "var(--accent)" },
              { label: "Configured", value: regions.filter((r) => r.width > 0).length, color: "var(--cyan)" },
              { label: "Changes", value: mrLogs.filter((l) => l.level === "success").length, color: "var(--green)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="stat-card" style={{ padding: 10 }}>
                <div className="value" style={{ fontSize: 18, color }}>{value}</div>
                <div className="label">{label}</div>
              </div>
            ))}
          </div>
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
            }}>
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
              }}>
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
              }}>
              <Video size={11} /> Virtual Camera
            </button>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}>
            {srcType === "window" ? (
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
                    }}>
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
                    title="Refresh window list">
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
                    }}>
                    {src.window_title}
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: -2,
                    }}>
                    Click refresh then select a window
                  </p>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    className="input"
                    style={{ flex: 1, fontSize: 12 }}
                    value={src?.camera_index ?? 0}
                    onChange={(e) => {
                      const idx = parseInt(e.target.value);
                      handleSelectCamera(idx);
                    }}>
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
                    title="Refresh camera list">
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
                    }}>
                    Start your virtual camera (OBS/vMix) then click refresh
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: -2,
                    }}>
                    Virtual cameras (OBS, vMix) appear here when running
                  </p>
                )}
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
            className={`btn ${mrRunning ? "btn-danger" : "btn-success"}`}
            style={{
              width: "100%",
              height: 48,
              fontSize: 14,
              fontWeight: 700,
            }}
            onClick={handleStartStop}
            disabled={!canStart}
            title={
              !backendOk
                ? "Backend is unavailable"
                : regions.length === 0
                  ? "Add at least one region first"
                  : ""
            }>
            {mrRunning ? (
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
          {mrRunning && (
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
              }}>
              <span className="status-dot online" />
              <span
                style={{
                  fontSize: 12,
                  color: "var(--green)",
                  fontWeight: 600,
                }}>
                Multi-Region OCR Running
              </span>
            </div>
          )}
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
        }}>
        {/* Preview + Current Detection */}
        <div
          style={{
            display: "flex",
            gap: 16,
            height: 180,
            flexShrink: 0,
          }}>
          {/* Capture Preview */}
          <div
            className="glass-card"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
            <div
              className="section-header"
              style={{
                padding: "12px 16px",
                marginBottom: 0,
                borderBottom: "1px solid var(--border)",
              }}>
              <Camera size={15} className="icon" style={{ marginTop: -2 }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}>
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
              }}>
              {mrPreviewData?.image ? (
                <img
                  src={`data:image/jpeg;base64,${mrPreviewData.image}`}
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
                  {mrRunning
                    ? "Waiting for frame..."
                    : "Start capture to see preview"}
                </div>
              )}
            </div>
          </div>

          {/* Current Detection */}
          <div
            className="glass-card "
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
            <div
              className="section-header"
              style={{
                padding: "12px 16px",
                marginBottom: 0,
                borderBottom: "1px solid var(--border)",
              }}>
              <ScanSearch
                size={15}
                className="icon"
                style={{ marginTop: -2 }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}>
                CURRENT DETECTION
              </span>
            </div>
            <div
              className=" "
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                padding: "16px 16px",
                overflow: "auto",
                gap: 4,
              }}>
              {mrPreviewData?.regions && mrPreviewData.regions.length > 0 ? (
                mrPreviewData.regions.map((r, idx) => (
                  <div
                    className=""
                    key={r.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                    }}>
                    <span>{idx + 1}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--cyan)",
                        minWidth: 80,
                        fontFamily: '"Cascadia Code", "Consolas", monospace',
                      }}>
                      {r.name}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: r.changed ? 800 : 500,
                        color: r.changed
                          ? "var(--green)"
                          : r.value
                            ? "var(--text-bright)"
                            : "var(--text-muted)",
                      }}>
                      {r.value || "—"}
                    </span>
                  </div>
                ))
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-muted)",
                    fontSize: 12,
                  }}>
                  {mrRunning ? "Processing..." : "Waiting for capture..."}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Region Manager */}
        <div
          className="glass-card"
          style={{
            padding: 16,
            flexShrink: 0,
          }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <Target size={14} className="icon" /> OCR Regions
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 8px",
                  borderRadius: 10,
                  background: "rgba(6,182,212,0.1)",
                  color: "var(--cyan)",
                  fontWeight: 700,
                  marginLeft: 4,
                }}>
                {regions.length}
              </span>
            </div>
          </div>

          {/* Add Region Form */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: regions.length > 0 ? 12 : 0,
            }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                className="input"
                type="text"
                placeholder="region_name (e.g. player_hp)"
                value={newRegionName}
                onChange={(e) => {
                  setNewRegionName(e.target.value);
                  setNameError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAddRegion()}
                style={{
                  width: "100%",
                  fontSize: 12,
                  height: 34,
                  borderColor: nameError ? "rgba(239,68,68,0.5)" : undefined,
                }}
                disabled={mrRunning}
              />
              {nameError && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    fontSize: 10,
                    color: "#ef4444",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}>
                  <AlertCircle size={10} />
                  {nameError}
                </div>
              )}
            </div>
            <button
              className="btn btn-accent"
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
              }}
              onClick={handleAddRegion}
              disabled={mrRunning}>
              <Plus size={13} /> Add
            </button>
          </div>

          {/* Region List */}
          {regions.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 160,
                overflow: "auto",
              }}>
              {regions.map((region, index) => {
                const hasCoords = region.width > 0 && region.height > 0;
                return (
                  <div
                    key={region.name}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--border)",
                    }}>
                    {/* Row 1: index · name · coords · select · delete */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="text-[12px]">{index + 1}</div>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--cyan)",
                          minWidth: 80,
                          fontFamily: '"Cascadia Code", "Consolas", monospace',
                        }}>
                        {region.name}
                      </span>
                      {hasCoords ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            fontFamily: '"Cascadia Code", "Consolas", monospace',
                            flex: 1,
                          }}>
                          ({region.left}, {region.top}) {region.width}x{region.height}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--yellow)", flex: 1 }}>
                          Not set
                        </span>
                      )}
                      <button
                        className="btn btn-accent"
                        onClick={() => handleSelectRegion(region.name)}
                        disabled={mrRunning || selectingRegionName === region.name}
                        style={{
                          height: 28,
                          padding: "0 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          flexShrink: 0,
                        }}>
                        {selectingRegionName === region.name ? (
                          <RefreshCw size={11} className="animate-spin" />
                        ) : (
                          <Target size={11} />
                        )}
                        {hasCoords ? "Reselect" : "Select"}
                      </button>
                      <button
                        onClick={() => handleRemoveRegion(region.name)}
                        disabled={mrRunning}
                        style={{
                          background: "rgba(239,68,68,0.1)",
                          border: "1px solid rgba(239,68,68,0.2)",
                          borderRadius: 6,
                          padding: 4,
                          cursor: mrRunning ? "not-allowed" : "pointer",
                          color: "#ef4444",
                          display: "flex",
                          alignItems: "center",
                          opacity: mrRunning ? 0.4 : 1,
                          flexShrink: 0,
                        }}
                        title="Remove region">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {/* Row 2: sanitization type */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 88 }}>
                        Sanitize
                      </span>
                      <select
                        className="input"
                        value={region.sanitization_type || "none"}
                        disabled={mrRunning}
                        onChange={(e) => handleSanitizationChange(region.name, e.target.value)}
                        style={{ fontSize: 11, height: 24, flex: 1, padding: "0 6px" }}>
                        {SANITIZATION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {regions.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "16px 0",
                color: "var(--text-muted)",
                fontSize: 12,
              }}>
              No regions defined. Add a region to get started.
            </div>
          )}
        </div>

        {/* Log Viewer */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}>
          <LogViewer
            logs={filteredLogs}
            onClear={() => dispatch(clearMrLogs())}
          />
        </div>
      </div>
    </div>
  );
}
