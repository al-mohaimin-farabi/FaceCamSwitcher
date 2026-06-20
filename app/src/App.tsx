import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Radio,
  FolderCog,
  Tv,
  IdCard,
  Settings as SettingsIcon,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Observers from "./pages/Observers";
import LiveFeed from "./pages/LiveFeed";
import Sources from "./pages/Sources";
import TeamInfo from "./pages/TeamInfo";
import VmixPanel from "./pages/VmixPanel";
import AppSettingsPage from "./pages/AppSettingsPage";
import { useBootstrap } from "./lib/useBootstrap";
import { useAppSelector } from "./store/hooks";

type Page = "dashboard" | "observers" | "live" | "sources" | "teams" | "vmix" | "settings";

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> },
  { id: "observers", label: "Observers", icon: <Users size={17} /> },
  { id: "live", label: "Live Feed", icon: <Radio size={17} /> },
  { id: "sources", label: "Debugger Source", icon: <FolderCog size={17} /> },
  { id: "teams", label: "Team Info", icon: <IdCard size={17} /> },
  { id: "vmix", label: "vMix Panel", icon: <Tv size={17} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={17} /> },
];

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  useBootstrap();
  const version = useAppSelector((s) => s.observer.version);

  return (
    <div className="app-shell gradient-bg">
      {/* ── Sidebar ─────────────────────────────── */}
      <aside className="sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 8px 18px" }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: 11, background: "#080B14",
              border: "1px solid rgba(255,255,255,0.08)", display: "flex",
              alignItems: "center", justifyContent: "center", overflow: "hidden",
            }}
          >
            <img src="/logo.svg" alt="Logo" style={{ width: 24, height: 24 }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, background: "linear-gradient(135deg,#60a5fa,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>
              FaceCam
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 500 }}>PCOB Observer</div>
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => setPage(n.id)}
            >
              <span className="nav-icon" style={{ display: "flex" }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: "auto", padding: "12px 10px 4px", fontSize: 11, color: "var(--text-muted)" }}>
          v{version} · by themisuwu
        </div>
      </aside>

      {/* ── Content ─────────────────────────────── */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {page === "dashboard" && <Dashboard />}
        {page === "observers" && <Observers />}
        {page === "live" && <LiveFeed />}
        {page === "sources" && <Sources />}
        {page === "teams" && <TeamInfo />}
        {page === "vmix" && <VmixPanel />}
        {page === "settings" && <AppSettingsPage />}
      </main>
    </div>
  );
}

export default App;
