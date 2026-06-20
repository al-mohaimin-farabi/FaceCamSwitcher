import { Radio } from "lucide-react";
import { useAppSelector } from "../store/hooks";
import StatusBadge from "../components/StatusBadge";
import { relativeTime, shortFile } from "../lib/format";

export default function LiveFeed() {
  const observers = useAppSelector((s) => s.observer.observers);
  const runtime = useAppSelector((s) => s.observer.runtime);
  const enabled = observers.filter((o) => o.enabled);

  return (
    <div className="page animate-fade-in">
      <div style={{ marginBottom: 22 }}>
        <div className="page-title">Live Observer Feed</div>
        <div className="page-subtitle">Real-time switched player per observer, as it updates.</div>
      </div>

      {enabled.length === 0 ? (
        <div className="empty-state">No enabled observers. Enable one in Observer Management.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {enabled.map((o) => {
            const rt = runtime[o.id];
            const co = rt?.currentObserver;
            return (
              <div key={o.id} className="glass-card" style={{ padding: 22, display: "flex", alignItems: "center", gap: 24 }}>
                <div
                  style={{
                    width: 54, height: 54, borderRadius: 14, flexShrink: 0,
                    background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(168,85,247,0.15))",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Radio size={24} color="#60a5fa" />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>{o.displayName}</span>
                    <StatusBadge status={rt?.status ?? "waiting"} />
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: co?.name ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {co?.name ?? "Waiting for switch…"}
                  </div>
                  <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
                    <span>UID: <b style={{ color: "var(--text-primary)" }}>{co?.uid ?? "—"}</b></span>
                    <span>Player ID: <b style={{ color: "var(--text-primary)" }}>{co?.playerId ?? "—"}</b></span>
                    <span>Raw: <b style={{ color: "var(--text-primary)" }}>{co?.rawObserverValue ?? "—"}</b></span>
                  </div>
                </div>

                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{shortFile(co?.sourceFile)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{relativeTime(co?.updatedAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
