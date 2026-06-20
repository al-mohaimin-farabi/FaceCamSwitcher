import { useState } from "react";
import { Plus, Pencil, Trash2, Play, Square, Radar } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setObservers, removeRuntime } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import { CONNECTION_TYPE_LABELS, type ObserverConfig } from "../lib/debugger/types";
import StatusBadge from "../components/StatusBadge";
import ObserverModal from "../components/ObserverModal";
import ScanModal from "../components/ScanModal";
import { relativeTime } from "../lib/format";

export default function Observers() {
  const dispatch = useAppDispatch();
  const observers = useAppSelector((s) => s.observer.observers);
  const runtime = useAppSelector((s) => s.observer.runtime);
  const [modal, setModal] = useState<{ open: boolean; edit: ObserverConfig | null }>({
    open: false,
    edit: null,
  });
  const [scanOpen, setScanOpen] = useState(false);

  const refresh = async () => {
    const list = await api.listObservers();
    dispatch(setObservers(list));
  };

  const saveObserver = async (o: ObserverConfig) => {
    await api.upsertObserver(o);
    await refresh();
    if (o.enabled) await api.startObserver(o.id).catch(() => {});
  };

  const remove = async (o: ObserverConfig) => {
    if (!confirm(`Delete observer "${o.displayName}"?`)) return;
    await api.deleteObserver(o.id);
    dispatch(removeRuntime(o.id));
    await refresh();
  };

  const toggleEnabled = async (o: ObserverConfig) => {
    const updated = { ...o, enabled: !o.enabled };
    await api.upsertObserver(updated);
    await refresh();
    if (updated.enabled) await api.startObserver(o.id).catch(() => {});
    else {
      await api.stopObserver(o.id).catch(() => {});
      dispatch(removeRuntime(o.id));
    }
  };

  const startStop = async (o: ObserverConfig, start: boolean) => {
    if (start) await api.startObserver(o.id);
    else {
      await api.stopObserver(o.id);
      dispatch(removeRuntime(o.id));
    }
  };

  return (
    <div className="page animate-fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div className="page-title">Observer Management</div>
          <div className="page-subtitle">Add, configure and control every observer source.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setScanOpen(true)}>
            <Radar size={16} /> Scan
          </button>
          <button className="btn btn-primary" onClick={() => setModal({ open: true, edit: null })}>
            <Plus size={16} /> Add Observer
          </button>
        </div>
      </div>

      {observers.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>No observers yet</div>
          <div>Add your first observer to start reading debugger data.</div>
          <button className="btn btn-accent" onClick={() => setModal({ open: true, edit: null })}>
            <Plus size={16} /> Add Observer
          </button>
        </div>
      ) : (
        <div className="observer-grid">
          {observers.map((o) => {
            const rt = runtime[o.id];
            const co = rt?.currentObserver;
            const isWatching = !!rt && rt.status !== "disabled";
            return (
              <div key={o.id} className={`observer-card ${o.enabled ? "" : "disabled"}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{o.displayName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                      {CONNECTION_TYPE_LABELS[o.type]}
                    </div>
                  </div>
                  <StatusBadge status={o.enabled ? rt?.status ?? "waiting" : "disabled"} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div className="kv"><span className="k">UID</span><span className="v">{co?.uid ?? "—"}</span></div>
                  <div className="kv"><span className="k">Player</span><span className="v">{co?.name ?? "—"}</span></div>
                  <div className="kv"><span className="k">Player ID</span><span className="v">{co?.playerId ?? "—"}</span></div>
                  <div className="kv"><span className="k">Last update</span><span className="v">{relativeTime(co?.updatedAt ?? rt?.lastHeartbeatAt)}</span></div>
                  {rt?.lastMessage && (
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" }}>{rt.lastMessage}</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <label className="switch" title="Enable / disable">
                    <input type="checkbox" checked={o.enabled} onChange={() => toggleEnabled(o)} />
                    <span className="slider" />
                  </label>
                  {(o.type === "local" || o.type === "network_share") && o.enabled && (
                    isWatching ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => startStop(o, false)}><Square size={13} /> Stop</button>
                    ) : (
                      <button className="btn btn-success btn-sm" onClick={() => startStop(o, true)}><Play size={13} /> Start</button>
                    )
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ open: true, edit: o })}><Pencil size={13} /></button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(o)}><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal.open && (
        <ObserverModal
          initial={modal.edit}
          onClose={() => setModal({ open: false, edit: null })}
          onSave={saveObserver}
        />
      )}

      {scanOpen && (
        <ScanModal
          existing={observers}
          onClose={() => setScanOpen(false)}
          onAdd={saveObserver}
        />
      )}
    </div>
  );
}
