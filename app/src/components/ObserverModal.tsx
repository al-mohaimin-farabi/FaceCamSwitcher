import { useState } from "react";
import { X } from "lucide-react";
import type { ObserverConfig, ObserverConnectionType } from "../lib/debugger/types";
import { CONNECTION_TYPE_LABELS } from "../lib/debugger/types";

const TYPES: ObserverConnectionType[] = [
  "local",
  "network_share",
  "remote_agent",
  "cloud_relay",
];

function emptyObserver(): ObserverConfig {
  const now = new Date().toISOString();
  return {
    id: `obs-${Math.random().toString(36).slice(2, 9)}`,
    displayName: "",
    type: "local",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export default function ObserverModal({
  initial,
  onClose,
  onSave,
}: {
  initial: ObserverConfig | null;
  onClose: () => void;
  onSave: (o: ObserverConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ObserverConfig>(initial ?? emptyObserver());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<ObserverConfig>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft.displayName.trim()) {
      setError("Display name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, displayName: draft.displayName.trim() });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const isRemote = draft.type === "remote_agent" || draft.type === "cloud_relay";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {initial ? "Edit Observer" : "Add Observer"}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="field">
          <label className="field-label">Display Name</label>
          <input
            className="input"
            placeholder="e.g. Observer PC 01"
            value={draft.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
          />
        </div>

        <div className="field">
          <label className="field-label">Connection Type</label>
          <select
            className="select"
            value={draft.type}
            onChange={(e) => set({ type: e.target.value as ObserverConnectionType })}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{CONNECTION_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {draft.type === "local" && (
          <div className="field">
            <label className="field-label">Local Debugger Path (optional — defaults to global)</label>
            <input
              className="input"
              placeholder="Leave blank to use the global debugger folder"
              value={draft.localDebuggerPath ?? ""}
              onChange={(e) => set({ localDebuggerPath: e.target.value || undefined })}
            />
          </div>
        )}

        {draft.type === "network_share" && (
          <div className="field">
            <label className="field-label">Network Share Path</label>
            <input
              className="input"
              placeholder="\\\\Observer-PC-01\\Debugger"
              value={draft.networkSharePath ?? ""}
              onChange={(e) => set({ networkSharePath: e.target.value || undefined })}
            />
          </div>
        )}

        {isRemote && (
          <>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="field" style={{ flex: 2 }}>
                <label className="field-label">Remote Host / IP</label>
                <input
                  className="input"
                  placeholder="192.168.1.25"
                  value={draft.remoteHost ?? ""}
                  onChange={(e) => set({ remoteHost: e.target.value || undefined })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">Port</label>
                <input
                  className="input"
                  type="number"
                  placeholder="8787"
                  value={draft.remotePort ?? ""}
                  onChange={(e) => set({ remotePort: Number(e.target.value) || undefined })}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Auth / Pairing Token</label>
              <input
                className="input"
                placeholder="Token configured on the remote agent"
                value={draft.authToken ?? ""}
                onChange={(e) => set({ authToken: e.target.value || undefined })}
              />
            </div>
          </>
        )}

        <div className="field" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label className="switch">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span className="slider" />
          </label>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Enabled</span>
        </div>

        {error && (
          <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : initial ? "Save Changes" : "Add Observer"}
          </button>
        </div>
      </div>
    </div>
  );
}
