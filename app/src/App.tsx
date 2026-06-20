import { useState } from "react";
import {
  LayoutDashboard,
  Globe,
  IdCard,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import TeamInfo from "./pages/TeamInfo";
import NetworkSync from "./pages/NetworkSync";
import { useBootstrap } from "./lib/useBootstrap";
import { useAppSelector } from "./store/hooks";

type Page = "dashboard" | "teams" | "networksync";

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> },
  { id: "teams", label: "Team Info", icon: <IdCard size={17} /> },
  { id: "networksync", label: "Network Sync", icon: <Globe size={17} /> },
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
        {page === "teams" && <TeamInfo />}
        {page === "networksync" && <NetworkSync />}
      </main>
    </div>
  );
}

export default App;
