import { useEffect, useState } from "react";
import { X, RefreshCw, Plus, Radar, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../lib/debugger/api";
import type { DiscoveredAgent, ObserverConfig } from "../lib/debugger/types";

export default function ScanModal({
  existing,
  onClose,
  onAdd,
}: {
  existing: ObserverConfig[];
  onClose: () => void;
  onAdd: (o: ObserverConfig) => Promise<void>;
}) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<DiscoveredAgent[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const agents = await api.scanObservers(3000);
      setFound(agents);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdded = (a: DiscoveredAgent) =>
    added.has(a.agentId) || existing.some((o) => o.id === a.agentId);

  const add = async (a: DiscoveredAgent) => {
    const now = new Date().toISOString();
    const observer: ObserverConfig = {
      id: a.agentId,
      displayName: a.machineName || a.host,
      type: "remote_agent",
      enabled: true,
      remoteHost: a.host,
      remotePort: a.wsPort,
      authToken: a.token ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
    await onAdd(observer);
    setAdded((prev) => new Set(prev).add(a.agentId));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <Radar size={18} /> Scan for Observers
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="page-subtitle" style={{ marginBottom: 18 }}>
          Agents running on your network announce themselves automatically. No IP or token typing needed.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button className="btn btn-accent" onClick={scan} disabled={scanning}>
            {scanning ? <span className="spinner" /> : <RefreshCw size={15} />}
            {scanning ? "Scanning…" : "Rescan"}
          </button>
          {!scanning && <span className="page-subtitle" style={{ marginTop: 0 }}>{found.length} found</span>}
        </div>

        {error && (
          <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>
        )}

        {!scanning && found.length === 0 && !error && (
          <div className="empty-state" style={{ padding: 32 }}>
            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>No observers found</div>
            <div style={{ fontSize: 12.5 }}>
              Make sure the agent is running on the other PC (double-click <code>start-agent.bat</code>)
              and that both PCs are on the same network.
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {found.map((a) => {
            const done = isAdded(a);
            return (
              <div
                key={a.agentId}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 14px",
                  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{a.machineName || "Observer"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "Cascadia Code, monospace" }}>
                    {a.host}:{a.wsPort}
                    {!a.token && (
                      <span style={{ color: "var(--yellow)", marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={11} /> token required
                      </span>
                    )}
                  </div>
                </div>
                {done ? (
                  <span style={{ color: "#4ade80", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                    <CheckCircle2 size={16} /> Added
                  </span>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => add(a)}>
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
