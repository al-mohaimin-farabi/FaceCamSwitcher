import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import {
  setConfig,
  updateConfigField,
  setFetchedPlayerCount,
  setWsConnected,
  type AppConfig,
} from "../store/appSlice";
import {
  Sliders,
  Globe,
  Save,
  Info,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Camera,
  Cpu,
  Key,
  Wifi,
  WifiOff,
  Users,
  Download,
  Hash,
} from "lucide-react";

export default function Settings() {
  const dispatch = useDispatch();
  const { config, fetchedPlayerCount, wsConnected } = useSelector((state: RootState) => state.app);
  const [isLoadingProps, setIsLoadingProps] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingPlayers, setIsFetchingPlayers] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    if (!config) {
      loadConfig();
    }
  }, []);

  // Listen for WebSocket status events from the Rust backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ connected: boolean }>("ws_status", (event) => {
      dispatch(setWsConnected(event.payload.connected));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => { unlisten?.(); };
  }, [dispatch]);

  const loadConfig = async () => {
    setIsLoadingProps(true);
    try {
      const cfg = await invoke<AppConfig>("load_config");
      dispatch(setConfig(cfg));
    } catch (e) {
      showMessage(`Failed to load config: ${e}`, "error");
    } finally {
      setIsLoadingProps(false);
    }
  };

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      await invoke("save_config", { config });
      showMessage("Configuration synchronized successfully", "success");
    } catch (e) {
      showMessage(`Save Error: ${e}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const updateConfig = (path: string, value: any) => {
    dispatch(updateConfigField({ path, value }));
  };

  const handleFetchPlayers = async () => {
    setIsFetchingPlayers(true);
    try {
      const players = await invoke<{ id: string; ign: string }[]>("fetch_players_from_server");
      dispatch(setFetchedPlayerCount(players.length));
      showMessage(`Loaded ${players.length} players from server`, "success");
    } catch (e) {
      showMessage(`Fetch failed: ${e}`, "error");
    } finally {
      setIsFetchingPlayers(false);
    }
  };

  if (isLoadingProps || !config) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 20,
        }}>
        <RefreshCw
          size={32}
          className="animate-spin"
          style={{ color: "var(--accent)" }}
        />
        <p
          style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 500 }}>
          Architecting configuration...
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 24,
        height: "100%",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
      >
      {/* ── Top Bar ─────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "var(--text-bright)",
              letterSpacing: "-0.02em",
            }}>
            Application Settings
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Tweak OCR engine parameters and server communication protocols
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {message && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 16px",
                borderRadius: "10px",
                background:
                  message.type === "success"
                    ? "rgba(34, 197, 94, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                border: `1px solid ${message.type === "success" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                color:
                  message.type === "success" ? "var(--green)" : "var(--red)",
                fontSize: 12,
                fontWeight: 600,
              }}
              >
              {message.type === "success" ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {message.text}
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
            style={{ minWidth: 140, height: 40, borderRadius: "10px" }}>
            {isSaving ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <>
                <Save size={16} /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* ── OCR Parameters ────────────── */}
        <div
          className="glass-card"
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Cpu size={16} className="icon" /> OCR Intelligence
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>Engine Language</label>
              <select
                className="input"
                value={config.ocr.language}
                onChange={(e) => updateConfig("ocr.language", e.target.value)}>
                <option value="en">English (default)</option>
                <option value="ch">Chinese</option>
                <option value="japan">Japanese</option>
                <option value="korean">Korean</option>
              </select>
            </div>

            <div className="input-group">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                <label>Confidence Threshold</label>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--accent)",
                  }}>
                  {(config.ocr.confidence_threshold * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={config.ocr.confidence_threshold}
                onChange={(e) =>
                  updateConfig(
                    "ocr.confidence_threshold",
                    parseFloat(e.target.value),
                  )
                }
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
            </div>

            <div className="input-group">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                <label>Fuzzy Match Sensitivity</label>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--cyan)",
                  }}>
                  {config.ocr.fuzzy_match_threshold}%
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="100"
                step="5"
                value={config.ocr.fuzzy_match_threshold}
                onChange={(e) =>
                  updateConfig(
                    "ocr.fuzzy_match_threshold",
                    parseInt(e.target.value),
                  )
                }
                style={{ width: "100%", accentColor: "var(--cyan)" }}
              />
            </div>

            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Sliders size={14} style={{ color: "var(--text-muted)" }} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text-secondary)",
                  }}>
                  Hardware Acceleration
                </span>
              </div>
              <div
                className={`toggle ${config.ocr.use_gpu ? "active" : ""}`}
                onClick={() => updateConfig("ocr.use_gpu", !config.ocr.use_gpu)}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: config.ocr.use_gpu
                    ? "var(--green)"
                    : "rgba(255,255,255,0.1)",
                  position: "relative",
                  cursor: "pointer",
                  // transition: "all 0.3s ease",
                }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "white",
                    position: "absolute",
                    top: 3,
                    left: config.ocr.use_gpu ? 19 : 3,
                    // transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Network Configuration ─────────── */}
        <div
          className="glass-card"
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}>
          {/* Header + WS status badge */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <Globe size={16} className="icon" /> Network Sync
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                background: wsConnected
                  ? "rgba(34,197,94,0.1)"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${wsConnected ? "rgba(34,197,94,0.3)" : "var(--border)"}`,
                color: wsConnected ? "var(--green)" : "var(--text-muted)",
              }}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {wsConnected ? "WS Connected" : "WS Offline"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Enable/disable toggle */}
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: config.server.enabled
                  ? "rgba(34,197,94,0.06)"
                  : "rgba(255,255,255,0.03)",
                border: `1px solid ${config.server.enabled ? "rgba(34,197,94,0.25)" : "var(--border)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
              <div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: config.server.enabled
                      ? "var(--green)"
                      : "var(--text-secondary)",
                  }}>
                  OCR Bridge Enabled
                </span>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {config.server.enabled
                    ? "Connects to server via WebSocket on OCR start"
                    : "Disabled — OCR runs locally only"}
                </p>
              </div>
              <div
                onClick={() => updateConfig("server.enabled", !config.server.enabled)}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: config.server.enabled ? "var(--green)" : "rgba(255,255,255,0.1)",
                  position: "relative",
                  cursor: "pointer",
                }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "white",
                    position: "absolute",
                    top: 3,
                    left: config.server.enabled ? 19 : 3,
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                opacity: config.server.enabled ? 1 : 0.45,
                pointerEvents: config.server.enabled ? "auto" : "none",
              }}>
              {/* API Base URL */}
              <div className="input-group">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Globe size={12} style={{ color: "var(--text-muted)" }} />
                  API Base URL
                </label>
                <input
                  className="input"
                  type="text"
                  value={config.server.api_url}
                  onChange={(e) => updateConfig("server.api_url", e.target.value)}
                  placeholder={import.meta.env.VITE_API_URL || "https://api.example.com"}
                />
              </div>

              {/* WebSocket URL */}
              <div className="input-group">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Wifi size={12} style={{ color: "var(--text-muted)" }} />
                  WebSocket URL
                </label>
                <input
                  className="input"
                  type="text"
                  value={config.server.ws_url}
                  onChange={(e) => updateConfig("server.ws_url", e.target.value)}
                  placeholder={import.meta.env.VITE_WS_URL || "wss://api.example.com"}
                />
              </div>

              {/* Tournament ID */}
              <div className="input-group">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Hash size={12} style={{ color: "var(--text-muted)" }} />
                  Tournament ID
                </label>
                <input
                  className="input"
                  type="text"
                  value={config.server.tournament_id}
                  onChange={(e) => updateConfig("server.tournament_id", e.target.value)}
                  placeholder="e.g. clx1abc23def456"
                />
              </div>

              {/* Secret Key */}
              <div className="input-group">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Key size={12} style={{ color: "var(--text-muted)" }} />
                  Secret Key
                </label>
                <input
                  className="input"
                  type="password"
                  value={config.server.secret_key}
                  onChange={(e) => updateConfig("server.secret_key", e.target.value)}
                  placeholder="64-character OCR secret"
                />
              </div>

              {/* Fetch Players button + count badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleFetchPlayers}
                  disabled={
                    isFetchingPlayers ||
                    !config.server.tournament_id ||
                    !config.server.secret_key ||
                    !config.server.api_url
                  }
                  style={{ height: 36, borderRadius: 8, fontSize: 12 }}>
                  {isFetchingPlayers ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  Fetch Players
                </button>
                {fetchedPlayerCount > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 10px",
                      borderRadius: 8,
                      background: "rgba(59,130,246,0.08)",
                      border: "1px solid rgba(59,130,246,0.2)",
                      color: "var(--accent)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                    <Users size={12} />
                    {fetchedPlayerCount} players loaded
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Capture Lifecycle ────────── */}
        <div
          className="glass-card"
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Camera size={16} className="icon" /> Data Capture
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>Scan Interval (seconds)</label>
              <div style={{ position: "relative" }}>
                <Clock
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0.5"
                  value={config.capture.interval_seconds}
                  onChange={(e) =>
                    updateConfig(
                      "capture.interval_seconds",
                      parseFloat(e.target.value) || 2,
                    )
                  }
                  style={{ paddingLeft: 34 }}
                />
              </div>
            </div>

            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                }}>
                Diagnostic Screenshots
              </span>
              <div
                className={`toggle ${config.capture.save_debug_screenshots ? "active" : ""}`}
                onClick={() =>
                  updateConfig(
                    "capture.save_debug_screenshots",
                    !config.capture.save_debug_screenshots,
                  )
                }
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: config.capture.save_debug_screenshots
                    ? "var(--accent)"
                    : "rgba(255,255,255,0.1)",
                  position: "relative",
                  cursor: "pointer",
                  // transition: "all 0.3s ease",
                }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "white",
                    position: "absolute",
                    top: 3,
                    left: config.capture.save_debug_screenshots ? 19 : 3,
                    // transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            </div>

            {config.capture.save_debug_screenshots && (
              <div className="input-group">
                <label>Storage Pathway</label>
                <input
                  className="input"
                  type="text"
                  value={config.capture.debug_screenshot_dir}
                  onChange={(e) =>
                    updateConfig("capture.debug_screenshot_dir", e.target.value)
                  }
                />
              </div>
            )}

            <div
              style={{
                marginTop: "auto",
                padding: 12,
                borderRadius: 10,
                background: "rgba(59, 130, 246, 0.04)",
                border: "1px solid rgba(59, 130, 246, 0.1)",
                display: "flex",
                gap: 10,
              }}>
              <Info
                size={16}
                style={{ color: "var(--accent)", flexShrink: 0 }}
              />
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}>
                Lowering the scan interval increases CPU usage. For most
                high-stakes matches, 2.0s is the optimal balance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
