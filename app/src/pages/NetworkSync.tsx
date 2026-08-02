import { useEffect, useState } from "react";
import { Radio, Send, Trash2, Globe } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  setSettings,
  clearNetworkSyncLog,
  addNetworkSyncLog,
} from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import { nowTime } from "../lib/debugger/networkSync";
import type { AppSettings, NetworkSyncConfig } from "../lib/debugger/types";

export default function NetworkSync() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const observers = useAppSelector((s) => s.observer.observers);
  const log = useAppSelector((s) => s.observer.networkSyncLog);

  const [busy, setBusy] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  const cfg = settings?.networkSync;
  const sourceId = observers[0]?.sourceId || "01";

  // Ping /api/health every 15s so this page has a passive read on server
  // reachability without ever touching the real connection — that stays
  // entirely owned by Dashboard's Start/Stop.
  useEffect(() => {
    if (!cfg?.apiBaseUrl) {
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
  }, [cfg?.apiBaseUrl]);

  if (!settings || !cfg) return <div className="page">Loading…</div>;

  const persist = async (patch: Partial<NetworkSyncConfig>) => {
    const next: AppSettings = {
      ...settings,
      networkSync: { ...cfg, ...patch },
    };
    dispatch(setSettings(next));
    await api.saveSettings(next);
  };

  // Reachability only — never opens a real OCR session or claims the
  // source slot. Going live is Dashboard's Start button, exclusively.
  // Result goes to the shared Live Log, same as every other status event on
  // this page, rather than a separate inline message nothing else reads.
  const test = async () => {
    setBusy(true);
    try {
      const result = await api.checkServerHealth();
      dispatch(
        addNetworkSyncLog({
          time: nowTime(),
          level: result.success ? "success" : "error",
          message: result.success
            ? `Test Connection: ${result.message}`
            : `Test Connection failed: ${result.message}`,
        }),
      );
    } catch (e) {
      dispatch(
        addNetworkSyncLog({
          time: nowTime(),
          level: "error",
          message: `Test Connection failed: ${String(e instanceof Error ? e.message : e)}`,
        }),
      );
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
            Configure the connection Dashboard uses to push detected switches to
            the FaceCam server (Source {sourceId}). Going live happens there,
            not here.
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
        </div>
      </div>

      {/* Configuration */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 18 }}>
        <div className="section-header">
          <Globe size={14} /> Server Connection
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
          <button className="btn btn-ghost" onClick={test} disabled={busy}>
            {busy ? <span className="spinner" /> : <Send size={15} />} Test
            Connection
          </button>
        </div>
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
