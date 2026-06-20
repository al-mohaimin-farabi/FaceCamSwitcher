import { Users, Wifi, WifiOff, Crosshair, FileText, Activity } from "lucide-react";
import { useAppSelector } from "../store/hooks";
import StatusBadge from "../components/StatusBadge";
import { relativeTime, shortFile } from "../lib/format";
import type { ObserverStatus } from "../lib/debugger/types";

function StatCard({
  value,
  label,
  icon,
  color,
}: {
  value: number | string;
  label: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `${color}22`, color }}>
        {icon}
      </div>
      <div className="stat-value" style={{ color }}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const observers = useAppSelector((s) => s.observer.observers);
  const runtime = useAppSelector((s) => s.observer.runtime);

  const enabled = observers.filter((o) => o.enabled);
  const statusOf = (id: string): ObserverStatus =>
    runtime[id]?.status ?? "waiting";

  const connected = enabled.filter((o) =>
    ["connected", "watching"].includes(statusOf(o.id)),
  ).length;
  const errored = enabled.filter((o) => statusOf(o.id) === "error").length;
  const activePlayers = enabled.filter(
    (o) => runtime[o.id]?.currentObserver?.name,
  ).length;

  const latestFile = Object.values(runtime)
    .map((r) => r.currentObserver?.sourceFile)
    .find(Boolean);

  const health =
    errored > 0 ? "Degraded" : connected === enabled.length && enabled.length > 0 ? "Healthy" : "Idle";
  const healthColor = errored > 0 ? "#f87171" : health === "Healthy" ? "#4ade80" : "#facc15";

  return (
    <div className="page animate-fade-in">
      <div style={{ marginBottom: 22 }}>
        <div className="page-title">Dashboard</div>
        <div className="page-subtitle">
          Live overview of every observer feed and the debugger source health.
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <StatCard value={observers.length} label="Total Observers" icon={<Users size={18} />} color="#60a5fa" />
        <StatCard value={connected} label="Connected" icon={<Wifi size={18} />} color="#4ade80" />
        <StatCard value={enabled.length - connected} label="Disconnected" icon={<WifiOff size={18} />} color="#facc15" />
        <StatCard value={activePlayers} label="Active Switches" icon={<Crosshair size={18} />} color="#a78bfa" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, marginBottom: 24 }}>
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <Activity size={14} /> System Health
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="stat-value" style={{ fontSize: 26, color: healthColor }}>
              {health}
            </span>
            <span className="page-subtitle" style={{ marginTop: 0 }}>
              {connected}/{enabled.length} feeds live · {errored} error(s)
            </span>
          </div>
        </div>
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="section-header">
            <FileText size={14} /> Latest Debugger File
          </div>
          <div className="v" style={{ fontFamily: "Cascadia Code, Consolas, monospace", fontSize: 13, color: "var(--text-primary)" }}>
            {shortFile(latestFile) || "Waiting…"}
          </div>
        </div>
      </div>

      <div className="section-header">
        <Users size={14} /> Observer Feeds
      </div>
      {observers.length === 0 ? (
        <div className="empty-state">No observers configured yet. Add one in Observer Management.</div>
      ) : (
        <div className="observer-grid">
          {observers.map((o) => {
            const rt = runtime[o.id];
            const co = rt?.currentObserver;
            return (
              <div key={o.id} className={`observer-card ${o.enabled ? "" : "disabled"}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{o.displayName}</div>
                  <StatusBadge status={o.enabled ? statusOf(o.id) : "disabled"} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div className="kv"><span className="k">Player</span><span className="v">{co?.name ?? "—"}</span></div>
                  <div className="kv"><span className="k">Player ID</span><span className="v">{co?.playerId ?? "—"}</span></div>
                  <div className="kv"><span className="k">Raw value</span><span className="v">{co?.rawObserverValue ?? "—"}</span></div>
                  <div className="kv"><span className="k">Updated</span><span className="v">{relativeTime(co?.updatedAt)}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
