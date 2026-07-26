import { useEffect, useState } from "react";
import {
  Radio,
  PlugZap,
  Plug,
  Send,
  Trash2,
  Globe,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setSettings, clearNetworkSyncLog } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import { networkSync, validateConfig } from "../lib/debugger/networkSync";
import type { AppSettings, NetworkSyncConfig } from "../lib/debugger/types";

export default function NetworkSync() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const connected = useAppSelector((s) => s.observer.networkSyncConnected);
  const authenticated = useAppSelector(
    (s) => s.observer.networkSyncAuthenticated,
  );
  const observers = useAppSelector((s) => s.observer.observers);
  const log = useAppSelector((s) => s.observer.networkSyncLog);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  const cfg = settings?.networkSync;
  const sourceId = observers[0]?.sourceId || "01";

  // Ping /api/health every 15s while enabled — same cadence localized-input's
  // Settings.tsx uses, via Rust reqwest so there's no CORS question.
  useEffect(() => {
    if (!cfg?.enabled || !cfg.apiBaseUrl) {
      setServerOnline(null);
      return;
    }
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const result = await api.checkServerHealth();
        if (!cancelled) setServerOnline(result.success);
      } catch {
        if (!cancelled) setServerOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cfg?.enabled, cfg?.apiBaseUrl]);

  if (!settings || !cfg) return <div className="page">Loading…</div>;

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
      networkSync.connect(cfg, sourceId);
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
      const result = await api.checkServerHealth();
      if (result.success) setTestMsg(result.message);
      else setError(result.message);
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
            Push detected observer switches to the FaceCam server in real time
            (Source {sourceId}).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {serverOnline !== null && (
            <span
              className={`badge ${serverOnline ? "badge-connected" : "badge-error"}`}
              title="Tournament server /api/health"
            >
              <span className="dot" /> Server{" "}
              {serverOnline ? "Online" : "Offline"}
            </span>
          )}
          <span
            className={`badge ${authenticated ? "badge-connected" : connected ? "badge-waiting" : "badge-error"}`}
          >
            <span className="dot" />{" "}
            {authenticated
              ? "Authenticated"
              : connected
                ? "Connecting…"
                : "Offline"}
          </span>
        </div>
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
              Connects via Socket.io when you press Start on the Dashboard — not
              on app launch, so this PC doesn't claim Source {sourceId}
              before you're ready to observe.
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
              Connect (manual test)
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
