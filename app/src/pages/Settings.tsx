import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Sliders, 
  Target, 
  Globe, 
  Maximize, 
  Save, 
  Info, 
  RefreshCw,
  X,
  Clock,
  Settings as SettingsIcon,
  CheckCircle2,
  AlertCircle,
  Database,
  Camera,
  Cpu
} from "lucide-react";

interface AppConfig {
  capture_region: {
    monitor_index: number;
    left: number;
    top: number;
    width: number;
    height: number;
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

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const cfg = await invoke<AppConfig>("load_config");
      setConfig(cfg);
    } catch (e) {
      showMessage(`Failed to load config: ${e}`, "error");
    } finally {
      setIsLoading(false);
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

  const handleSelectRegion = async () => {
    setIsSelectingRegion(true);
    try {
      await invoke("open_region_selector");
      loadConfig();
    } catch (e) {
      showMessage(`Selector Error: ${e}`, "error");
    } finally {
      setIsSelectingRegion(false);
    }
  };

  const updateConfig = (path: string, value: any) => {
    if (!config) return;
    const newConfig = JSON.parse(JSON.stringify(config));
    const parts = path.split(".");
    let obj: any = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    setConfig(newConfig);
  };

  if (isLoading || !config) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20 }}>
        <RefreshCw size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 500 }}>Architecting configuration...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 24 }} className="animate-fade-in">
      {/* ── Top Bar ─────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "-0.02em" }}>
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
                 background: message.type === "success" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                 border: `1px solid ${message.type === "success" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                 color: message.type === "success" ? "var(--green)" : "var(--red)",
                 fontSize: 12,
                 fontWeight: 600
               }}
               className="animate-fade-in"
             >
               {message.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
               {message.text}
             </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
            style={{ minWidth: 140, height: 40, borderRadius: "10px" }}
          >
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
        {/* ── Capture Region ──────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Maximize size={16} className="icon" /> Capture Surface
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="input-group">
              <label>Monitor</label>
              <input
                className="input"
                type="number"
                value={config.capture_region.monitor_index}
                onChange={(e) => updateConfig("capture_region.monitor_index", parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="input-group">
              <label>X Offset</label>
              <input
                className="input"
                type="number"
                value={config.capture_region.left}
                onChange={(e) => updateConfig("capture_region.left", parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="input-group">
              <label>Y Offset</label>
              <input
                className="input"
                type="number"
                value={config.capture_region.top}
                onChange={(e) => updateConfig("capture_region.top", parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="input-group">
              <label>Width</label>
              <input
                className="input"
                type="number"
                value={config.capture_region.width}
                onChange={(e) => updateConfig("capture_region.width", parseInt(e.target.value) || 100)}
              />
            </div>
            <div className="input-group">
              <label>Height</label>
              <input
                className="input"
                type="number"
                value={config.capture_region.height}
                onChange={(e) => updateConfig("capture_region.height", parseInt(e.target.value) || 50)}
              />
            </div>
          </div>

          <button
            className="btn btn-accent"
            style={{ width: "100%", height: 38, borderRadius: "8px" }}
            onClick={handleSelectRegion}
            disabled={isSelectingRegion}
          >
            {isSelectingRegion ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <>
                <Target size={14} /> Interactive Region Selection
              </>
            )}
          </button>
        </div>

        {/* ── OCR Parameters ────────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Cpu size={16} className="icon" /> OCR Intelligence
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>Engine Language</label>
              <select
                className="input"
                value={config.ocr.language}
                onChange={(e) => updateConfig("ocr.language", e.target.value)}
              >
                <option value="en">English (default)</option>
                <option value="ch">Chinese</option>
                <option value="japan">Japanese</option>
                <option value="korean">Korean</option>
              </select>
            </div>

            <div className="input-group">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label>Confidence Threshold</label>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>{(config.ocr.confidence_threshold * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={config.ocr.confidence_threshold}
                onChange={(e) => updateConfig("ocr.confidence_threshold", parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
            </div>

            <div className="input-group">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label>Fuzzy Match Sensitivity</label>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan)" }}>{config.ocr.fuzzy_match_threshold}%</span>
              </div>
              <input
                type="range"
                min="30"
                max="100"
                step="5"
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
              <div 
                className={`toggle ${config.ocr.use_gpu ? 'active' : ''}`} 
                onClick={() => updateConfig("ocr.use_gpu", !config.ocr.use_gpu)}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: config.ocr.use_gpu ? "var(--green)" : "rgba(255,255,255,0.1)",
                  position: "relative",
                  cursor: "pointer",
                  transition: "all 0.3s ease"
                }}
              >
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "white",
                  position: "absolute",
                  top: 3,
                  left: config.ocr.use_gpu ? 19 : 3,
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Network Configuration ─────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Globe size={16} className="icon" /> Network Sync
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>API Endpoint</label>
              <input
                className="input"
                type="text"
                value={config.server.url}
                onChange={(e) => updateConfig("server.url", e.target.value)}
                placeholder="https://api.example.com/data"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="input-group">
                <label>HTTP Method</label>
                <select
                  className="input"
                  value={config.server.method}
                  onChange={(e) => updateConfig("server.method", e.target.value)}
                >
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div className="input-group">
                <label>Timeout (s)</label>
                <input
                  className="input"
                  type="number"
                  value={config.server.timeout}
                  onChange={(e) => updateConfig("server.timeout", parseInt(e.target.value) || 2)}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="input-group">
                <label>Max Retries</label>
                <input
                  className="input"
                  type="number"
                  value={config.server.retry_count}
                  onChange={(e) => updateConfig("server.retry_count", parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="input-group">
                <label>Retry Delay (s)</label>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={config.server.retry_delay}
                  onChange={(e) => updateConfig("server.retry_delay", parseFloat(e.target.value) || 0.5)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Capture Lifecycle ────────── */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Camera size={16} className="icon" /> Data Capture
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="input-group">
              <label>Scan Interval (seconds)</label>
              <div style={{ position: "relative" }}>
                 <Clock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                 <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0.5"
                  value={config.capture.interval_seconds}
                  onChange={(e) => updateConfig("capture.interval_seconds", parseFloat(e.target.value) || 2)}
                  style={{ paddingLeft: 34 }}
                />
              </div>
            </div>

            <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Diagnostic Screenshots</span>
              <div 
                className={`toggle ${config.capture.save_debug_screenshots ? 'active' : ''}`} 
                onClick={() => updateConfig("capture.save_debug_screenshots", !config.capture.save_debug_screenshots)}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: config.capture.save_debug_screenshots ? "var(--accent)" : "rgba(255,255,255,0.1)",
                  position: "relative",
                  cursor: "pointer",
                  transition: "all 0.3s ease"
                }}
              >
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "white",
                  position: "absolute",
                  top: 3,
                  left: config.capture.save_debug_screenshots ? 19 : 3,
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                }} />
              </div>
            </div>

            {config.capture.save_debug_screenshots && (
              <div className="input-group animate-fade-in">
                <label>Storage Pathway</label>
                <input
                  className="input"
                  type="text"
                  value={config.capture.debug_screenshot_dir}
                  onChange={(e) => updateConfig("capture.debug_screenshot_dir", e.target.value)}
                />
              </div>
            )}
            
            <div style={{ marginTop: "auto", padding: 12, borderRadius: 10, background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.1)", display: "flex", gap: 10 }}>
               <Info size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
               <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                 Lowering the scan interval increases CPU usage. For most high-stakes matches, 2.0s is the optimal balance.
               </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
