import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import LogViewer from "../components/LogViewer";
import { 
  Activity, 
  Layout, 
  Play, 
  Square, 
  BarChart3, 
  Crosshair, 
  Target, 
  Zap,
  Maximize,
  Camera,
  ScanSearch
} from "lucide-react";

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

interface ConfigData {
  capture_region: {
    monitor_index: number;
    left: number;
    top: number;
    width: number;
    height: number;
  };
  ocr: {
    confidence_threshold: number;
    fuzzy_match_threshold: number;
  };
  capture: {
    interval_seconds: number;
  };
}

interface PreviewData {
  image: string;
  detections: {
    raw_text: string;
    matched_name: string | null;
    confidence: number;
    match_score: number;
  }[];
}

export default function Dashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [backendStatus, setBackendStatus] = useState<string>("Checking...");
  const [backendOk, setBackendOk] = useState(false);
  const [stats, setStats] = useState({ scans: 0, detections: 0, matches: 0 });
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  // Load config and check backend on mount
  useEffect(() => {
    loadConfig();
    checkBackend();

    // Listen for log events from Tauri backend
    const unlistenLog = listen<{ level: string; message: string }>("log", (event) => {
      if (event.payload.level === "preview") {
        try {
          setPreviewData(JSON.parse(event.payload.message));
        } catch (e) {
          console.error("Preview parse error", e);
        }
        return;
      }

      const now = new Date();
      const time = now.toLocaleTimeString("en-US", { hour12: false });
      addLog({ time, level: event.payload.level, message: event.payload.message });

      // Track stats from log messages
      if (event.payload.message.includes("detected") || event.payload.message.includes("OCR")) {
        setStats((prev) => ({ ...prev, scans: prev.scans + 1 }));
      }
      if (event.payload.message.includes("→") && event.payload.message.includes("match")) {
        setStats((prev) => ({ ...prev, matches: prev.matches + 1 }));
      }
    });

    const unlistenStop = listen("ocr_stopped", () => {
      setIsRunning(false);
      setPreviewData(null);
    });

    const unlistenRegion = listen("region_updated", () => {
      loadConfig();
      addLog({
        time: new Date().toLocaleTimeString("en-US", { hour12: false }),
        level: "success",
        message: "Region updated successfully!",
      });
    });

    return () => {
      unlistenLog.then((fn) => fn());
      unlistenStop.then((fn) => fn());
      unlistenRegion.then((fn) => fn());
    };
  }, []);

  const addLog = (entry: LogEntry) => {
    setLogs((prev) => [...prev.slice(-200), entry]); // Keep last 200
  };

  const loadConfig = async () => {
    try {
      const cfg = await invoke<ConfigData>("load_config");
      setConfig(cfg);
    } catch (e) {
      addLog({
        time: new Date().toLocaleTimeString("en-US", { hour12: false }),
        level: "error",
        message: `Failed to load config: ${e}`,
      });
    }
  };

  const checkBackend = async () => {
    try {
      const result = await invoke<{ success: boolean; message: string }>("check_backend");
      setBackendStatus(result.message);
      setBackendOk(result.success);
    } catch (e) {
      setBackendStatus("Backend unavailable");
      setBackendOk(false);
    }
  };

  const handleStartStop = async () => {
    if (isRunning) {
      try {
        await invoke("stop_ocr");
        setIsRunning(false);
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "error",
          message: `Failed to stop OCR: ${e}`,
        });
      }
    } else {
      try {
        await invoke("start_ocr");
        setIsRunning(true);
        setStats({ scans: 0, detections: 0, matches: 0 });
        setPreviewData(null);
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "error",
          message: `Failed to start OCR: ${e}`,
        });
      }
    }
  };

  const handleSelectRegion = async () => {
    setIsSelectingRegion(true);
    try {
      await invoke("open_region_selector");
    } catch (e) {
      addLog({
        time: new Date().toLocaleTimeString("en-US", { hour12: false }),
        level: "error",
        message: `Region selector error: ${e}`,
      });
    } finally {
      setIsSelectingRegion(false);
    }
  };

  const region = config?.capture_region;

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        padding: "16px",
        gap: "16px",
      }}
      className="animate-fade-in"
    >
      {/* ── Left Panel ─────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Status Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Activity size={14} className="icon" /> System Status
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className={`status-dot ${backendOk ? "online" : "error"}`} />
            <span
              style={{
                fontSize: 12,
                color: backendOk ? "var(--green)" : "var(--red)",
                fontWeight: 600,
              }}
            >
              {backendOk ? "Backend Ready" : "Backend Unavailable"}
            </span>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {backendStatus}
          </p>
        </div>

        {/* Region Info Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Maximize size={14} className="icon" /> Capture Region
          </div>
          {region ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="grid-2">
                <div className="stat-card" style={{ padding: 10 }}>
                  <div className="value" style={{ fontSize: 16 }}>
                    {region.monitor_index}
                  </div>
                  <div className="label">Monitor</div>
                </div>
                <div className="stat-card" style={{ padding: 10 }}>
                  <div className="value" style={{ fontSize: 16 }}>
                    {region.width}×{region.height}
                  </div>
                  <div className="label">Size</div>
                </div>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontFamily: '"JetBrains Mono", monospace',
                  textAlign: "center",
                }}
              >
                Position: ({region.left}, {region.top})
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>
              No region configured
            </p>
          )}
            <button
              className="btn btn-accent"
              style={{ width: "100%", marginTop: 10 }}
              onClick={handleSelectRegion}
              disabled={isSelectingRegion}
            >
              {isSelectingRegion ? (
                <>
                  <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                  Selecting...
                </>
              ) : (
                <>
                  <Maximize size={14} /> Select Region
                </>
              )}
            </button>
    </div>

    {/* Controls Card */}
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Zap size={14} className="icon" /> Controls
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              className={`btn ${isRunning ? "btn-danger" : "btn-success"}`}
              style={{ width: "100%", height: 48, fontSize: 14, fontWeight: 700 }}
              onClick={handleStartStop}
              disabled={!backendOk}
            >
              {isRunning ? (
                <>
                  <Square size={16} fill="currentColor" /> Stop Capture
                </>
              ) : (
                <>
                  <Play size={16} fill="currentColor" /> Start Capture
                </>
              )}
            </button>
          </div>

          {isRunning && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--green-bg)",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
              className="animate-fade-in"
            >
              <span className="status-dot online" />
              <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
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
            <div className="stat-card" style={{ padding: 10 }}>
              <div className="value" style={{ fontSize: 18, color: "var(--accent)" }}>
                {stats.scans}
              </div>
              <div className="label">Scans</div>
            </div>
            <div className="stat-card" style={{ padding: 10 }}>
              <div className="value" style={{ fontSize: 18, color: "var(--cyan)" }}>
                {stats.detections}
              </div>
              <div className="label">Detected</div>
            </div>
            <div className="stat-card" style={{ padding: 10 }}>
              <div className="value" style={{ fontSize: 18, color: "var(--green)" }}>
                {stats.matches}
              </div>
              <div className="label">Matches</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Preview & Logs ────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflow: "hidden" }}>
        
        {/* Preview Grid (top half) */}
        <div style={{ display: "flex", gap: 16, height: 180, flexShrink: 0 }}>
          {/* Capture Box */}
          <div className="glass-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="section-header" style={{ padding: "12px 16px", marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
              <Camera size={15} className="icon" style={{ marginTop: -2 }} /> 
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>CAPTURE PREVIEW</span>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(0,0,0,0.15)" }}>
              {previewData?.image ? (
                <img 
                  src={`data:image/png;base64,${previewData.image}`} 
                  alt="Capture" 
                  style={{ 
                    maxWidth: "100%", 
                    maxHeight: "100%", 
                    objectFit: "contain", 
                    border: "2px solid rgba(255,255,255,0.05)", 
                    borderRadius: 4 
                  }} 
                />
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Waiting for capture...</div>
              )}
            </div>
          </div>

          {/* Detection Box */}
          <div className="glass-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="section-header" style={{ padding: "12px 16px", marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
              <ScanSearch size={15} className="icon" style={{ marginTop: -2 }} /> 
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>CURRENT DETECTION</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "12px 20px", overflow: "hidden" }}>
              {previewData?.detections && previewData.detections.length > 0 ? (
                previewData.detections.map((d, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, animation: "fadeIn 0.2s ease-out" }}>
                     <div style={{ 
                        fontSize: 22, 
                        fontWeight: 800, 
                        color: d.matched_name ? "var(--green)" : "var(--accent)" 
                      }}>
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

        {/* Log Viewer (bottom half) */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <LogViewer logs={logs} onClear={() => setLogs([])} />
        </div>
      </div>
    </div>
  );
}
