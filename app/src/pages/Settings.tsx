import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import {
  setConfig,
  updateConfigField,
  setVmixTestResult,
  type AppConfig,
} from "../store/appSlice";
import {
  Sliders,
  Save,
  Info,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Camera,
  Cpu,
  Wifi,
  WifiOff,
  Plus,
  X,
  Zap,
} from "lucide-react";

export default function Settings() {
  const dispatch = useDispatch();
  const { config, vmixTestResult } = useSelector((state: RootState) => state.app);
  const [isLoadingProps, setIsLoadingProps] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingVmix, setIsTestingVmix] = useState(false);
  const [newSource, setNewSource] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!config) loadConfig();
  }, []);

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
      showMessage("Configuration saved successfully", "success");
    } catch (e) {
      showMessage(`Save Error: ${e}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const updateConfig = (path: string, value: any) => {
    dispatch(updateConfigField({ path, value }));
  };

  const handleTestVmix = async () => {
    if (!config) return;
    // Save first so test uses current IP/port
    try { await invoke("save_config", { config }); } catch { /* ignore */ }
    setIsTestingVmix(true);
    try {
      const result = await invoke<{ success: boolean; message: string }>("test_vmix_connection");
      dispatch(setVmixTestResult({ ok: result.success, message: result.message }));
    } catch (e) {
      dispatch(setVmixTestResult({ ok: false, message: String(e) }));
    } finally {
      setIsTestingVmix(false);
    }
  };

  const handleAddSource = () => {
    const trimmed = newSource.trim();
    if (!trimmed || !config) return;
    const sources = config.vmix.target_sources ?? [];
    if (sources.includes(trimmed)) return;
    updateConfig("vmix.target_sources", [...sources, trimmed]);
    setNewSource("");
  };

  const handleRemoveSource = (source: string) => {
    if (!config) return;
    updateConfig("vmix.target_sources", config.vmix.target_sources.filter(s => s !== source));
  };

  if (isLoadingProps || !config) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20 }}>
        <RefreshCw size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 500 }}>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Top Bar ─────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "-0.02em" }}>
            Application Settings
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Configure OCR engine and vMix Web Controller integration
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {message && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderRadius: "10px",
              background: message.type === "success" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
              border: `1px solid ${message.type === "success" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
              color: message.type === "success" ? "var(--green)" : "var(--red)", fontSize: 12, fontWeight: 600,
            }}>
              {message.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {message.text}
            </div>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}
            style={{ minWidth: 140, height: 40, borderRadius: "10px" }}>
            {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <><Save size={16} /> Save Changes</>}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

        {/* ── OCR Parameters ─────────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Cpu size={16} className="icon" /> OCR Intelligence
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>Engine Language</label>
              <select className="input" value={config.ocr.language}
                onChange={(e) => updateConfig("ocr.language", e.target.value)}>
                <option value="en">English (default)</option>
                <option value="ch">Chinese</option>
                <option value="japan">Japanese</option>
                <option value="korean">Korean</option>
              </select>
            </div>
            <div className="input-group">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label>Confidence Threshold</label>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
                  {(config.ocr.confidence_threshold * 100).toFixed(0)}%
                </span>
              </div>
              <input type="range" min="0.1" max="1.0" step="0.05"
                value={config.ocr.confidence_threshold}
                onChange={(e) => updateConfig("ocr.confidence_threshold", parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
            </div>
            <div className="input-group">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label>Fuzzy Match Sensitivity</label>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan)" }}>
                  {config.ocr.fuzzy_match_threshold}%
                </span>
              </div>
              <input type="range" min="30" max="100" step="5"
                value={config.ocr.fuzzy_match_threshold}
                onChange={(e) => updateConfig("ocr.fuzzy_match_threshold", parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "var(--cyan)" }}
              />
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Sliders size={14} style={{ color: "var(--text-muted)" }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Hardware Acceleration</span>
              </div>
              <div onClick={() => updateConfig("ocr.use_gpu", !config.ocr.use_gpu)}
                style={{ width: 36, height: 20, borderRadius: 10, background: config.ocr.use_gpu ? "var(--green)" : "rgba(255,255,255,0.1)", position: "relative", cursor: "pointer" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: config.ocr.use_gpu ? 19 : 3 }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── vMix Controller ─────────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <Zap size={16} className="icon" /> vMix Controller
            </div>
            {vmixTestResult !== null && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: vmixTestResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${vmixTestResult.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.2)"}`,
                color: vmixTestResult.ok ? "var(--green)" : "#ef4444",
              }}>
                {vmixTestResult.ok ? <Wifi size={12} /> : <WifiOff size={12} />}
                {vmixTestResult.ok ? "Connected" : "Unreachable"}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* IP + Port */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>vMix IP Address</label>
                <input className="input" type="text" placeholder="192.168.1.100"
                  value={config.vmix?.ip ?? ""}
                  onChange={(e) => updateConfig("vmix.ip", e.target.value)}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0, width: 90 }}>
                <label>Port</label>
                <input className="input" type="number" placeholder="8088"
                  value={config.vmix?.port ?? 8088}
                  onChange={(e) => updateConfig("vmix.port", parseInt(e.target.value) || 8088)}
                />
              </div>
            </div>

            {/* Layer */}
            <div className="input-group">
              <label>Target Layer Number</label>
              <input className="input" type="number" min="1" max="10"
                value={config.vmix?.layer ?? 7}
                onChange={(e) => updateConfig("vmix.layer", parseInt(e.target.value) || 7)}
              />
            </div>

            {/* Debounce + Clear Timeout */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Clock size={11} style={{ color: "var(--text-muted)" }} /> Debounce (ms)
                </label>
                <input className="input" type="number" min="200" step="100"
                  value={config.vmix?.debounce_ms ?? 1500}
                  onChange={(e) => updateConfig("vmix.debounce_ms", parseInt(e.target.value) || 1500)}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Clock size={11} style={{ color: "var(--text-muted)" }} /> Clear Timeout (ms)
                </label>
                <input className="input" type="number" min="1000" step="500"
                  value={config.vmix?.clear_timeout_ms ?? 5000}
                  onChange={(e) => updateConfig("vmix.clear_timeout_ms", parseInt(e.target.value) || 5000)}
                />
              </div>
            </div>

            {/* Target Sources */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                Target Sources
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, minHeight: 32 }}>
                {(config.vmix?.target_sources ?? []).length === 0 ? (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>No sources — add the vMix input names below</span>
                ) : (
                  (config.vmix?.target_sources ?? []).map((src) => (
                    <div key={src} style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8,
                      background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)",
                      fontSize: 12, fontWeight: 600, color: "var(--accent)",
                    }}>
                      {src}
                      <button onClick={() => handleRemoveSource(src)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex", alignItems: "center", opacity: 0.7 }}>
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" type="text" placeholder='e.g. "Gameplay" or "OB 1"'
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSource(); }}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button className="btn btn-accent" onClick={handleAddSource}
                  style={{ height: 36, padding: "0 12px", borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <Plus size={13} /> Add
                </button>
              </div>
            </div>

            {/* Test Connection */}
            <button className="btn btn-primary" onClick={handleTestVmix} disabled={isTestingVmix}
              style={{ height: 36, borderRadius: 8, fontSize: 12, width: "100%" }}>
              {isTestingVmix ? <RefreshCw size={13} className="animate-spin" /> : <Wifi size={13} />}
              Test vMix Connection
            </button>

            {vmixTestResult && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 8,
                background: vmixTestResult.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${vmixTestResult.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.2)"}`,
                fontSize: 11, fontWeight: 500, color: vmixTestResult.ok ? "var(--green)" : "#ef4444", lineHeight: 1.4,
              }}>
                {vmixTestResult.ok ? <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />}
                {vmixTestResult.message}
              </div>
            )}
          </div>
        </div>

        {/* ── Data Capture ─────────────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Camera size={16} className="icon" /> Data Capture
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>Scan Interval (seconds)</label>
              <div style={{ position: "relative" }}>
                <Clock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" type="number" step="0.1" min="0.1"
                  value={config.capture.interval_seconds}
                  onChange={(e) => updateConfig("capture.interval_seconds", parseFloat(e.target.value) || 0.1)}
                  style={{ paddingLeft: 34 }}
                />
              </div>
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Diagnostic Screenshots</span>
              <div onClick={() => updateConfig("capture.save_debug_screenshots", !config.capture.save_debug_screenshots)}
                style={{ width: 36, height: 20, borderRadius: 10, background: config.capture.save_debug_screenshots ? "var(--accent)" : "rgba(255,255,255,0.1)", position: "relative", cursor: "pointer" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: config.capture.save_debug_screenshots ? 19 : 3 }} />
              </div>
            </div>
            {config.capture.save_debug_screenshots && (
              <div className="input-group">
                <label>Storage Pathway</label>
                <input className="input" type="text"
                  value={config.capture.debug_screenshot_dir}
                  onChange={(e) => updateConfig("capture.debug_screenshot_dir", e.target.value)}
                />
              </div>
            )}
            <div style={{ marginTop: "auto", padding: 12, borderRadius: 10, background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.1)", display: "flex", gap: 10 }}>
              <Info size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                Debounce and clear-timeout are in milliseconds. Debounce prevents vMix spam when OCR text flickers. Clear-timeout sends SetLayer→None after the region goes blank.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
