import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen, FolderSearch, RefreshCw, Copy, Check, Play, Square,
  Radio, Wifi, KeyRound, Server, MonitorSmartphone,
} from "lucide-react";
import { api, type StatusSnapshot, type ObserverStatus } from "./lib/api";

const STATUS_LABEL: Record<ObserverStatus, string> = {
  connected: "Connected", watching: "Watching", waiting: "Waiting",
  error: "Error", disabled: "Stopped",
};

function Badge({ status }: { status: ObserverStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" /> {STATUS_LABEL[status]}
    </span>
  );
}

export default function App() {
  const [s, setS] = useState<StatusSnapshot | null>(null);
  const [ips, setIps] = useState<string[]>([]);
  const [portDraft, setPortDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    const un = listen<StatusSnapshot>("status", (e) => setS(e.payload));
    (async () => {
      const [snap, localIps] = await Promise.all([api.getStatus(), api.listLocalIps()]);
      setS(snap);
      setIps(localIps);
    })();
    return () => { un.then((f) => f()); };
  }, []);

  // Seed editable drafts once.
  useEffect(() => {
    if (s && !initialized.current) {
      initialized.current = true;
      setPortDraft(String(s.port));
      setNameDraft(s.machineName);
    }
  }, [s]);

  if (!s) {
    return <div className="gradient-bg" style={{ height: "100vh", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>Loading…</div>;
  }

  const co = s.currentObserver;

  const browse = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Select your Free Fire debugger folder" });
    if (typeof picked === "string") {
      try { await api.setFolder(picked); } catch (e) { alert(String(e)); }
    }
  };

  const savePort = async () => {
    const p = Number(portDraft);
    if (!p) return;
    try { await api.setPort(p); } catch (e) { alert(String(e)); }
  };

  const saveName = async () => {
    if (nameDraft.trim()) await api.setMachineName(nameDraft.trim());
  };

  const copyToken = async () => {
    await navigator.clipboard.writeText(s.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const toggleRun = async () => {
    setBusy(true);
    try { s.running ? await api.stopSharing() : await api.startSharing(); }
    finally { setBusy(false); }
  };

  return (
    <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: "#080B14", border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <img src="/logo.svg" alt="" style={{ width: 26, height: 26 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, background: "linear-gradient(135deg,#60a5fa,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>
            FaceCam Observer
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.machineName} · streams this PC to the controller</div>
        </div>
        <Badge status={s.status} />
      </header>

      <main style={{ flex: 1, overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 680, width: "100%", margin: "0 auto" }}>
        {/* Live status */}
        <div className="glass-card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(168,85,247,0.15))", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Radio size={22} color="#60a5fa" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Current player</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: co?.name ? "var(--text-primary)" : "var(--text-muted)" }}>
              {co?.name ?? (s.running ? "Waiting for switch…" : "Stopped")}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 12, color: "var(--text-secondary)" }}>
              <span>UID: <b style={{ color: "var(--text-primary)" }}>{co?.uid ?? "—"}</b></span>
              <span>Player ID: <b style={{ color: "var(--text-primary)" }}>{co?.playerId ?? "—"}</b></span>
            </div>
          </div>
          <button className={`btn ${s.running ? "btn-danger" : "btn-success"}`} onClick={toggleRun} disabled={busy} style={{ flexShrink: 0 }}>
            {busy ? <span className="spinner" /> : s.running ? <Square size={15} /> : <Play size={15} />}
            {s.running ? "Stop" : "Start"}
          </button>
        </div>

        {s.lastMessage && (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: -6, paddingLeft: 4 }}>{s.lastMessage}</div>
        )}

        {/* Debugger folder */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div className="section-header"><FolderOpen size={14} /> Debugger Folder</div>
          <div style={{ fontFamily: "Cascadia Code, Consolas, monospace", fontSize: 12.5, color: s.folder ? "var(--text-primary)" : "var(--text-muted)", wordBreak: "break-all", marginBottom: 12 }}>
            {s.folder ?? "No folder selected — click Browse to choose your Free Fire debugger folder."}
          </div>
          <button className="btn btn-primary" onClick={browse}><FolderSearch size={15} /> Browse…</button>
        </div>

        {/* Connection */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div className="section-header"><Server size={14} /> Connection</div>

          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Display name</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} />
              </div>
            </div>
            <div style={{ width: 130 }}>
              <label className="field-label">Port to share</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" type="number" value={portDraft} onChange={(e) => setPortDraft(e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={savePort}>Set</button>
              </div>
            </div>
          </div>

          <label className="field-label">Pairing token</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input className="input" readOnly value={s.token} style={{ fontFamily: "Cascadia Code, monospace", fontSize: 12 }} />
            <button className="btn btn-ghost btn-sm" onClick={copyToken} title="Copy">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => api.regenerateToken()} title="Generate a new token"><RefreshCw size={14} /></button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <KeyRound size={14} color="var(--text-muted)" />
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>Include token in LAN announce (one-click Scan pairing)</span>
            <label className="switch">
              <input type="checkbox" checked={s.broadcastToken} onChange={(e) => api.setBroadcastToken(e.target.checked)} />
              <span className="slider" />
            </label>
          </div>
        </div>

        {/* How to connect */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div className="section-header"><MonitorSmartphone size={14} /> Connect from the controller</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span><b>This PC's address</b> (same network / ZeroTier)</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#4ade80" }}>
                <Wifi size={13} /> {s.clientCount} controller(s) connected
              </span>
            </div>
            <div style={{ fontFamily: "Cascadia Code, monospace", color: "var(--text-primary)", marginTop: 6 }}>
              {ips.length ? ips.map((ip) => `${ip}:${s.port}`).join("  ·  ") : `…:${s.port}`}
            </div>
            <div style={{ marginTop: 10, color: "var(--text-muted)" }}>
              Same LAN: open the controller → <b>Observers → Scan</b> → Add.<br />
              Different network: <b>Add Observer</b> manually with the address above + the token.
            </div>
          </div>
        </div>
      </main>

      <footer style={{ padding: "8px 20px", borderTop: "1px solid var(--border)", background: "var(--bg-secondary)", fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
        <span>FaceCam Observer v0.2 · id {s.agentId}</span>
        <span>{s.running ? "Sharing active" : "Idle"}</span>
      </footer>
    </div>
  );
}
