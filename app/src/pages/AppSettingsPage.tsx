import { useState } from "react";
import { Save } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setSettings } from "../store/observerSlice";
import { api } from "../lib/debugger/api";

export default function AppSettingsPage() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const version = useAppSelector((s) => s.observer.version);
  const [saved, setSaved] = useState(false);

  if (!settings) return <div className="page">Loading…</div>;

  const update = async (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    dispatch(setSettings(next));
    await api.saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="page animate-fade-in">
      <div style={{ marginBottom: 22 }}>
        <div className="page-title">App Settings</div>
        <div className="page-subtitle">Preferences and persistence.</div>
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 18 }}>
        <div className="section-header">Interface</div>
        <Row label="Smooth animations" desc="Subtle transitions across the UI.">
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.ui.animations}
              onChange={(e) => update({ ui: { ...settings.ui, animations: e.target.checked } })}
            />
            <span className="slider" />
          </label>
        </Row>
        <Row label="Compact cards" desc="Denser observer cards.">
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.ui.compactCards}
              onChange={(e) => update({ ui: { ...settings.ui, compactCards: e.target.checked } })}
            />
            <span className="slider" />
          </label>
        </Row>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-muted)", fontSize: 12.5 }}>
        <Save size={14} /> {saved ? "Saved" : "Changes save automatically"} · FaceCam v{version}
      </div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{desc}</div>
      </div>
      {children}
    </div>
  );
}
