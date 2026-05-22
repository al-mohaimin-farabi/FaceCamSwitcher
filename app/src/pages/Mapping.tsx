import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import { setConfig, setTeamCameraMap, type AppConfig } from "../store/appSlice";
import { Video, RefreshCw, Save, AlertCircle, CheckCircle2, Layers } from "lucide-react";

interface Message {
  text: string;
  type: "success" | "error";
}

/** Extract unique team tags from player names (prefix before first ".") */
function extractTeams(players: string[]): string[] {
  const tags = new Set<string>();
  for (const name of players) {
    const dot = name.indexOf(".");
    tags.add(dot > 0 ? name.substring(0, dot).toUpperCase() : name.toUpperCase());
  }
  return Array.from(tags).sort();
}

export default function Mapping() {
  const dispatch = useDispatch();
  const { config } = useSelector((state: RootState) => state.app);
  const [teams, setTeams] = useState<string[]>([]);
  const [localMap, setLocalMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (config?.team_camera_map) {
      setLocalMap({ ...config.team_camera_map });
    }
  }, [config?.team_camera_map]);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [players, cfg] = await Promise.all([
        invoke<string[]>("load_players"),
        invoke<AppConfig>("load_config"),
      ]);
      setTeams(extractTeams(players));
      dispatch(setConfig(cfg));
      setLocalMap({ ...(cfg.team_camera_map ?? {}) });
    } catch (e) {
      showMessage(`Failed to load: ${e}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      const newConfig: AppConfig = { ...config, team_camera_map: localMap };
      await invoke("save_config", { config: newConfig });
      dispatch(setConfig(newConfig));
      dispatch(setTeamCameraMap(localMap));
      showMessage(`Saved ${Object.values(localMap).filter(Boolean).length} mapping(s)`, "success");
    } catch (e) {
      showMessage(`Save failed: ${e}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAll = () => {
    if (!window.confirm("Clear all team camera mappings?")) return;
    setLocalMap({});
  };

  const mappedCount = teams.filter((t) => localMap[t]?.trim()).length;

  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Top Bar ──────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "-0.02em" }}>
            vMix Camera Mapping
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Link each team tag to a vMix camera input
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 700, color: "var(--green)" }}>
              {mappedCount} / {teams.length} mapped
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadAll}
            style={{ borderRadius: 10, display: "flex", alignItems: "center", gap: 6, padding: "0 12px" }}>
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Reload</span>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleClearAll}
            disabled={Object.keys(localMap).length === 0}
            style={{ borderRadius: 10, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Clear All</span>
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}
            style={{ height: 36, borderRadius: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
            Save Mappings
          </button>
        </div>
      </div>

      {/* ── Message Toast ──────────────── */}
      {message && (
        <div style={{
          padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          background: message.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: message.type === "success" ? "#22c55e" : "#ef4444",
          border: `1px solid ${message.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
        }}>
          {message.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {message.text}
        </div>
      )}

      {/* ── Info Banner ──────────────────── */}
      <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", display: "flex", alignItems: "center", gap: 10 }}>
        <Layers size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          When OCR detects a player like <strong style={{ color: "var(--text-secondary)" }}>RHK.BLADE</strong>, the app extracts the team tag <strong style={{ color: "var(--accent)" }}>RHK</strong> and sends the mapped camera input to vMix's <code style={{ color: "var(--accent)", fontSize: 11 }}>SetLayer</code> API. All players on the same team share one camera.
        </p>
      </div>

      {/* ── Mapping Table ─────────────── */}
      <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-header" style={{ marginBottom: 4 }}>
          <Video size={14} className="icon" /> Team Tag → Camera Input
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <RefreshCw size={24} className="animate-spin" style={{ color: "var(--accent)", margin: "0 auto" }} />
          </div>
        ) : teams.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", background: "rgba(255,255,255,0.02)", borderRadius: 12 }}>
            <Video size={32} style={{ color: "var(--text-muted)", margin: "0 auto", opacity: 0.3 }} />
            <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>
              No players loaded — add names in the Players tab first
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "140px 24px 1fr", gap: 10, padding: "0 12px", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Team Tag</span>
              <span />
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>vMix Camera Input</span>
            </div>

            {teams.map((team) => {
              const isMapped = Boolean(localMap[team]?.trim());
              return (
                <div key={team} style={{
                  display: "grid", gridTemplateColumns: "140px 24px 1fr", gap: 10, alignItems: "center",
                  padding: "10px 12px", borderRadius: 10,
                  background: isMapped ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.025)",
                  border: `1px solid ${isMapped ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
                }}>
                  {/* Team tag pill */}
                  <div style={{
                    fontSize: 13, fontWeight: 800, color: "var(--accent)",
                    fontFamily: '"Cascadia Code", monospace', letterSpacing: "0.04em",
                  }}>
                    {team}
                  </div>

                  {/* Arrow */}
                  <span style={{ fontSize: 16, fontWeight: 700, color: isMapped ? "var(--green)" : "var(--border)", textAlign: "center" }}>
                    →
                  </span>

                  {/* Camera input field */}
                  <input
                    type="text"
                    className="input"
                    placeholder="vMix input name (e.g. Camera 3)"
                    value={localMap[team] ?? ""}
                    onChange={(e) => setLocalMap((prev) => ({ ...prev, [team]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                    style={{ fontSize: 13, height: 36, padding: "0 12px" }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
