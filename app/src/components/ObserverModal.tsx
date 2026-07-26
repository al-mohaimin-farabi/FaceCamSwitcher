import { useState } from "react";
import { X, Check } from "lucide-react";
import type { ObserverConfig } from "../lib/debugger/types";

export default function ObserverModal({
  initial,
  onClose,
  onSave,
}: {
  initial: ObserverConfig;
  onClose: () => void;
  onSave: (o: ObserverConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ObserverConfig>(initial);
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            Configure Observer
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
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
          <label className="field-label">
            Local Debugger Path (optional — defaults to global)
          </label>
          <input
            className="input"
            placeholder="Leave blank to use the global debugger folder"
            value={draft.localDebuggerPath ?? ""}
            onChange={(e) =>
              set({ localDebuggerPath: e.target.value || undefined })
            }
          />
        </div>

        <div className="field">
          <label className="field-label">
            Source Slot — which output this PC feeds
          </label>
          <select
            className="input"
            value={draft.sourceId || "01"}
            onChange={(e) => set({ sourceId: e.target.value })}
          >
            {["01", "02", "03"].map((id) => (
              <option key={id} value={id}>
                Source {id}
              </option>
            ))}
          </select>
        </div>

        <div
          className="field"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            <span className="slider" />
          </label>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Enabled
          </span>
        </div>

        {error && (
          <div
            style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>
            <X size={15} /> Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : <Check size={15} />} Save
            Changes
          </button>
        </div>
      </div>
    </div>
  );
}
