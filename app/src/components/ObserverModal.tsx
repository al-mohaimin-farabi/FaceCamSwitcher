import { useState } from "react";
import { X, Check } from "lucide-react";
import type { ObserverConfig } from "../lib/debugger/types";

export default function ObserverModal({
  initial,
  onClose,
  onSave,
  sourceSlotLocked,
}: {
  initial: ObserverConfig;
  onClose: () => void;
  onSave: (o: ObserverConfig) => Promise<void>;
  /** True while this observer is actively running — the slot is this PC's
   *  identity for the live session, so it can't change mid-run. Stop first. */
  sourceSlotLocked?: boolean;
}) {
  const [draft, setDraft] = useState<ObserverConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<ObserverConfig>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
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
          <label className="field-label">
            Source Slot — which output this PC feeds
          </label>
          <select
            className="input"
            value={draft.sourceId || "01"}
            disabled={sourceSlotLocked}
            onChange={(e) => set({ sourceId: e.target.value })}
          >
            {["01", "02", "03"].map((id) => (
              <option key={id} value={id}>
                Source {id}
              </option>
            ))}
          </select>
          {sourceSlotLocked && (
            <p
              style={{
                fontSize: 11.5,
                color: "var(--text-muted)",
                marginTop: 6,
              }}
            >
              Stop observing to change the slot.
            </p>
          )}
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
