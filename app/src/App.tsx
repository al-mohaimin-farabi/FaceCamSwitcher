import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import PlayerNames from "./pages/PlayerNames";
import Settings from "./pages/Settings";
import Mapping from "./pages/Mapping";
import { LayoutDashboard, Users, Settings as SettingsIcon, Video } from "lucide-react";
import { useDispatch } from "react-redux";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  addLog,
  incrementScans,
  incrementDetections,
  incrementMatches,
  setPreviewData,
  setIsRunning,
  setLastVmixAction,
  type PreviewData,
  type VmixAction,
} from "./store/appSlice";

type Page = "dashboard" | "players" | "mapping" | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const dispatch = useDispatch();

  useEffect(() => {
    const unlistenLog = listen<{ level: string; message: string }>(
      "log",
      (event) => {
        if (event.payload.level === "preview") {
          try {
            const data: PreviewData = JSON.parse(event.payload.message);
            dispatch(setPreviewData(data));
            dispatch(incrementScans());
            if (data.detections && data.detections.length > 0) {
              dispatch(incrementDetections(data.detections.length));
              const matchCount = data.detections.filter((d) => d.matched_name).length;
              if (matchCount > 0) dispatch(incrementMatches(matchCount));
            }
          } catch (err) {
            console.log(err);
          }
          return;
        }
        const time = new Date().toLocaleTimeString("en-US", { hour12: false });
        dispatch(addLog({ time, level: event.payload.level, message: event.payload.message }));
      },
    );

    const unlistenStop = listen("ocr_stopped", () => {
      dispatch(setIsRunning(false));
    });

    // Listen for vMix action events from the Rust loop
    const unlistenVmix = listen<VmixAction>("vmix_action", (e) => {
      dispatch(setLastVmixAction(e.payload));
    });

    invoke<boolean>("is_ocr_running")
      .then((running) => dispatch(setIsRunning(running)))
      .catch(() => { /* first launch / older binary — ignore */ });

    const blockReload = (e: KeyboardEvent) => {
      const isReload =
        e.key === "F5" ||
        ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"));
      if (isReload) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", blockReload, { capture: true });

    return () => {
      unlistenLog.then((fn) => fn());
      unlistenStop.then((fn) => fn());
      unlistenVmix.then((fn) => fn());
      window.removeEventListener("keydown", blockReload, { capture: true });
    };
  }, [dispatch]);

  return (
    <div className="gradient-bg" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Header ──────────────────────────────── */}
      <header style={{
        display: "flex", alignItems: "center", padding: "12px 24px",
        background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)",
        gap: "14px", position: "relative", zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: "#080B14",
            border: "1px solid rgba(255, 255, 255, 0.08)", display: "flex",
            alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)", overflow: "hidden",
          }}>
            <img src="/logo.svg" alt="Logo" style={{ width: 28, height: 28 }} />
          </div>
          <div>
            <h1 style={{
              fontSize: 18, fontWeight: 800,
              background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              letterSpacing: "-0.02em", lineHeight: 1.2,
            }}>
              Efinity FaceCam
            </h1>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="tab-bar" style={{ marginLeft: "auto", padding: "4px" }}>
          {([
            { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
            { id: "players",   label: "Players",   icon: <Users size={16} /> },
            { id: "mapping",   label: "Mapping",   icon: <Video size={16} /> },
            { id: "settings",  label: "Settings",  icon: <SettingsIcon size={16} /> },
          ] as { id: Page; label: string; icon: React.ReactNode }[]).map(({ id, label, icon }) => (
            <button
              key={id}
              className={`tab-item ${currentPage === id ? "active" : ""}`}
              onClick={() => setCurrentPage(id)}
              style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ── Page Content ────────────────────────── */}
      <main style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {currentPage === "dashboard" && <Dashboard />}
        {currentPage === "players"   && <PlayerNames />}
        {currentPage === "mapping"   && <Mapping />}
        {currentPage === "settings"  && <Settings />}
      </main>

      {/* ── Footer ──────────────────────────────── */}
      <footer style={{
        padding: "6px 20px", background: "var(--bg-secondary)",
        borderTop: "1px solid var(--border)", display: "flex",
        justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
          Efinity FaceCam v2.0 • vMix Integration • Developed by themisuwu
        </span>
      </footer>
    </div>
  );
}

export default App;
