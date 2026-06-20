import { useState } from "react";
import { Tv, Plug, PlugZap, Send, Trash2, Server } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setSettings, clearVmixLog } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import type {
  AppSettings,
  ObserverVmixConfig,
  VmixSendMode,
} from "../lib/debugger/types";

const SEND_MODES: { value: VmixSendMode; label: string }[] = [
  { value: "uid", label: "Send UID" },
  { value: "name", label: "Send Name" },
  { value: "disabled", label: "Disabled" },
];

export default function VmixPanel() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const observers = useAppSelector((s) => s.observer.observers);
  const connected = useAppSelector((s) => s.observer.vmixConnected);
  const log = useAppSelector((s) => s.observer.vmixLog);

  const [ip, setIp] = useState("");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  if (!settings) return <div className="page">Loading…</div>;
  const vmix = settings.vmix;

  if (!seeded) {
    setIp(vmix.ip || "127.0.0.1");
    setPort(vmix.port ? String(vmix.port) : "8099");
    setSeeded(true);
  }

  const persist = async (next: AppSettings) => {
    dispatch(setSettings(next));
    await api.saveSettings(next);
  };

  const configFor = (observerId: string): ObserverVmixConfig =>
    vmix.observers.find((o) => o.observerId === observerId) ?? {
      observerId,
      sendMode: "disabled",
      sourceName: "",
      layer: 0,
    };

  const updateObserverCfg = async (
    observerId: string,
    patch: Partial<ObserverVmixConfig>,
  ) => {
    const existing = configFor(observerId);
    const merged = { ...existing, ...patch };
    const others = vmix.observers.filter((o) => o.observerId !== observerId);
    await persist({ ...settings, vmix: { ...vmix, observers: [...others, merged] } });
  };

  const connect = async () => {
    setError(null);
    const p = Number(port);
    if (!ip.trim()) return setError("Please enter a valid vMix IP address.");
    if (!p || p < 1 || p > 65535) return setError("Please enter a valid TCP port.");
    setBusy(true);
    try {
      await api.vmixConnect(ip.trim(), p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await api.vmixDisconnect(); } finally { setBusy(false); }
  };

  const test = async () => {
    setError(null);
    try { await api.vmixTest(); } catch (e) { setError(String(e)); }
  };

  return (
    <div className="page animate-fade-in">
      <div style={{ marginBottom: 22 }}>
        <div className="page-title">vMix Panel</div>
        <div className="page-subtitle">
          Send each observer's detected UID or Name to a vMix source/layer over TCP.
        </div>
      </div>

      {/* Connection */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="section-header" style={{ marginBottom: 0 }}><Server size={14} /> vMix Connection</div>
          <span className={`badge ${connected ? "badge-connected" : "badge-error"}`}>
            <span className="dot" /> {connected ? "Connected" : "Disconnected"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">vMix IP Address</label>
            <input className="input" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="127.0.0.1" disabled={connected} />
          </div>
          <div style={{ width: 140 }}>
            <label className="field-label">TCP Port</label>
            <input className="input" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="8099" disabled={connected} />
          </div>
          {connected ? (
            <button className="btn btn-danger" onClick={disconnect} disabled={busy}><Plug size={15} /> Disconnect</button>
          ) : (
            <button className="btn btn-success" onClick={connect} disabled={busy}>
              {busy ? <span className="spinner" /> : <PlugZap size={15} />} Connect
            </button>
          )}
          <button className="btn btn-ghost" onClick={test} disabled={!connected}><Send size={15} /> Test</button>
        </div>
        {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}>{error}</div>}
      </div>

      {/* Per-observer output */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 18 }}>
        <div className="section-header"><Tv size={14} /> Observer Output</div>
        {observers.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No observers configured.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.4fr 80px", gap: 10, fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", paddingBottom: 4 }}>
              <span>Observer</span><span>Data to send</span><span>Source name</span><span>Layer</span>
            </div>
            {observers.map((o) => {
              const cfg = configFor(o.id);
              const needsSource = cfg.sendMode !== "disabled";
              return (
                <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.4fr 80px", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" }}>{o.displayName}</div>
                  <select className="select" value={cfg.sendMode} onChange={(e) => updateObserverCfg(o.id, { sendMode: e.target.value as VmixSendMode })}>
                    {SEND_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input
                    className="input" placeholder="CAM FEED" value={cfg.sourceName}
                    disabled={!needsSource}
                    onChange={(e) => updateObserverCfg(o.id, { sourceName: e.target.value })}
                  />
                  <input
                    className="input" type="number" placeholder="0" value={cfg.layer}
                    disabled={!needsSource}
                    onChange={(e) => updateObserverCfg(o.id, { layer: Number(e.target.value) || 0 })}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
          On switch, the <b>Source</b> input's MultiView <b>Layer</b> is set to show the vMix input
          named by the detected UID/Name. So each player needs a vMix input named exactly after their
          UID (or name), and the Source is the container input (e.g. CAM FEED). Saved automatically.
        </div>
      </div>

      {/* Log */}
      <div className="glass-card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="section-header" style={{ marginBottom: 0 }}>Live Log ({log.length})</div>
          <button className="btn btn-ghost btn-sm" onClick={() => dispatch(clearVmixLog())}><Trash2 size={13} /> Clear</button>
        </div>
        <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
          {log.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 0" }}>No activity yet.</div>
          ) : (
            [...log].reverse().map((e, i) => (
              <div key={i} className={`log-entry ${e.level === "success" ? "success" : e.level}`}>
                <span className="time">{e.time}</span>
                <span className="msg">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
