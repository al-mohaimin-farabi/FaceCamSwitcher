import { useState } from "react";
import { Radio, PlugZap, Plug, Send, Trash2, Globe } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setSettings, clearNetworkSyncLog } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import {
  networkSync,
  testConnection,
  validateConfig,
} from "../lib/debugger/networkSync";
import type { AppSettings, NetworkSyncConfig } from "../lib/debugger/types";

export default function NetworkSync() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const connected = useAppSelector((s) => s.observer.networkSyncConnected);
  const log = useAppSelector((s) => s.observer.networkSyncLog);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  if (!settings) return <div className="page">Loading…</div>;
  const cfg = settings.networkSync;

  const persist = async (patch: Partial<NetworkSyncConfig>) => {
    const next: AppSettings = {
      ...settings,
      networkSync: { ...cfg, ...patch },
    };
    dispatch(setSettings(next));
    await api.saveSettings(next);
  };

  const connect = async () => {
    setError(null);
    const err = validateConfig(cfg);
    if (err) return setError(err);
    setBusy(true);
    try {
      networkSync.connect(cfg);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    networkSync.disconnect();
  };

  const test = async () => {
    setError(null);
    setTestMsg(null);
    setBusy(true);
    try {
      const msg = await testConnection(cfg);
      setTestMsg(msg);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page animate-fade-in">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 22,
        }}
      >
        <div>
          <div className="page-title">Network Sync</div>
          <div className="page-subtitle">
            Push detected observer data to the central server in real time.
          </div>
        </div>
        <span
          className={`badge ${connected ? "badge-connected" : "badge-error"}`}
        >
          <span className="dot" /> {connected ? "Online" : "Offline"}
        </span>
      </div>

      {/* Enable + configuration */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 18 }}>
        <div className="section-header">
          <Globe size={14} /> Server Connection
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 0 14px",
            borderBottom: "1px solid var(--border)",
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              Network Sync Enabled
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}
            >
              Connects to the server via Socket.io when observing starts.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => persist({ enabled: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="field">
          <label className="field-label">API Base URL</label>
          <input
            className="input"
            placeholder="https://facecamapi.ecube.gg"
            value={cfg.apiBaseUrl}
            onChange={(e) => persist({ apiBaseUrl: e.target.value })}
          />
        </div>

        <div className="field">
          <label className="field-label">Socket.io URL</label>
          <input
            className="input"
            placeholder="wss://facecamapi.ecube.gg"
            value={cfg.socketUrl}
            onChange={(e) => persist({ socketUrl: e.target.value })}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label">Tournament ID</label>
            <input
              className="input"
              placeholder="clx1abc23def456"
              value={cfg.tournamentId}
              onChange={(e) => persist({ tournamentId: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label">Secret Key</label>
            <input
              className="input"
              type="password"
              placeholder="64-character secret"
              value={cfg.secretKey}
              onChange={(e) => persist({ secretKey: e.target.value })}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          {connected ? (
            <button
              className="btn btn-danger"
              onClick={disconnect}
              disabled={busy}
            >
              <Plug size={15} /> Disconnect
            </button>
          ) : (
            <button
              className="btn btn-success"
              onClick={connect}
              disabled={busy}
            >
              {busy ? <span className="spinner" /> : <PlugZap size={15} />}{" "}
              Connect
            </button>
          )}
          <button className="btn btn-ghost" onClick={test} disabled={busy}>
            <Send size={15} /> Test Connection
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}>
            {error}
          </div>
        )}
        {testMsg && (
          <div style={{ color: "var(--green)", fontSize: 12.5, marginTop: 12 }}>
            {testMsg}
          </div>
        )}
      </div>

      {/* Live log */}
      <div className="glass-card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Radio size={14} /> Live Log ({log.length})
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dispatch(clearNetworkSyncLog())}
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {log.length === 0 ? (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--text-muted)",
                padding: "8px 0",
              }}
            >
              No activity yet.
            </div>
          ) : (
            [...log].reverse().map((e, i) => (
              <div
                key={i}
                className={`log-entry ${e.level === "success" ? "success" : e.level}`}
              >
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
