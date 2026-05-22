import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import { setConfig, setPlayerCameraMap, type AppConfig } from "../store/appSlice";
import { Video, Search, RefreshCw, Save, AlertCircle, CheckCircle2, Layers } from "lucide-react";

interface Message {
  text: string;
  type: "success" | "error";
}

export default function Mapping() {
  const dispatch = useDispatch();
  const { config } = useSelector((state: RootState) => state.app);
  const [players, setPlayers] = useState<string[]>([]);
  const [localMap, setLocalMap] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  // Sync localMap when config.player_camera_map changes externally
  useEffect(() => {
    if (config?.player_camera_map) {
      setLocalMap({ ...config.player_camera_map });
    }
  }, [config?.player_camera_map]);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [names, cfg] = await Promise.all([
        invoke<string[]>("load_players"),
        invoke<AppConfig>("load_config"),
      ]);
      setPlayers(names);
      dispatch(setConfig(cfg));
      setLocalMap({ ...(cfg.player_camera_map ?? {}) });
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
      const newConfig: AppConfig = { ...config, player_camera_map: localMap };
      await invoke("save_config", { config: newConfig });
      dispatch(setConfig(newConfig));
      dispatch(setPlayerCameraMap(localMap));
      showMessage(`Saved ${Object.keys(localMap).length} mapping(s)`, "success");
    } catch (e) {
      showMessage(`Save failed: ${e}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleMapChange = (player: string, value: string) => {
    setLocalMap((prev) => ({ ...prev, [player]: value }));
  };

  const handleClearMapping = (player: string) => {
    setLocalMap((prev) => {
      const next = { ...prev };
      delete next[player];
      return next;
    });
  };

  const handleClearAll = () => {
    if (!window.confirm("Clear all camera mappings?")) return;
    setLocalMap({});
  };

  const filteredPlayers = searchQuery
    ? players.filter((p) => p.toLowerCase().includes(searchQuery.toLowerCase()))
    : players;

  const mappedCount = players.filter((p) => localMap[p]?.trim()).length;
  const unmappedCount = players.length - mappedCount;

  // Group by team prefix
  const grouped: Record<string, string[]> = {};
  filteredPlayers.forEach((name) => {
    const dotIndex = name.indexOf(".");
    const team = dotIndex > 0 ? name.substring(0, dotIndex) : "INDIVIDUAL";
    if (!grouped[team]) grouped[team] = [];
    grouped[team].push(name);
  });

  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Top Bar ──────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "-0.02em" }}>
            vMix Camera Mapping
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Link each matched player name to a vMix camera input name
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Stats badges */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "var(--green)" }}>
              {mappedCount} mapped
            </div>
            {unmappedCount > 0 && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>
                {unmappedCount} unmapped
              </div>
            )}
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
          Type the exact vMix input name (e.g. <strong style={{ color: "var(--text-secondary)" }}>Camera 3</strong> or <strong style={{ color: "var(--text-secondary)" }}>NDI Feed 1</strong>) next to each player. This name is sent directly to vMix's <code style={{ color: "var(--accent)", fontSize: 11 }}>SetLayer</code> API. Leave blank to skip that player.
        </p>
      </div>

      {/* ── Mapping Table ─────────────── */}
      <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Video size={14} className="icon" /> Player → Camera Input
          </div>
          <div style={{ position: "relative", width: 220 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input type="text" className="input" placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: "100%", paddingLeft: 34, height: 36, fontSize: 12 }}
            />
          </div>
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <RefreshCw size={24} className="animate-spin" style={{ color: "var(--accent)", margin: "0 auto" }} />
            <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>
          </div>
        ) : players.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", background: "rgba(255,255,255,0.02)", borderRadius: 12 }}>
            <Video size={32} style={{ color: "var(--text-muted)", margin: "0 auto", opacity: 0.3 }} />
            <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>
              No players loaded — add names in the Players tab first
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([team, names]) => (
                <div key={team} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "rgba(0,0,0,0.1)" }}>
                  <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.05em" }}>{team}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{names.filter(n => localMap[n]?.trim()).length}/{names.length} mapped</span>
                  </div>
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {names.map((name) => {
                      const isMapped = Boolean(localMap[name]?.trim());
                      return (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: isMapped ? "rgba(34,197,94,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${isMapped ? "rgba(34,197,94,0.15)" : "var(--border)"}` }}>
                          {/* Player name */}
                          <div style={{ flex: "0 0 180px", fontSize: 12, fontWeight: 600, color: isMapped ? "var(--text-bright)" : "var(--text-muted)", fontFamily: '"Cascadia Code", monospace' }}>
                            {name}
                          </div>
                          {/* Arrow */}
                          <span style={{ color: isMapped ? "var(--green)" : "var(--border)", fontSize: 14, fontWeight: 700 }}>→</span>
                          {/* Camera input field */}
                          <input
                            type="text"
                            className="input"
                            placeholder="vMix input name (e.g. Camera 1)"
                            value={localMap[name] ?? ""}
                            onChange={(e) => handleMapChange(name, e.target.value)}
                            style={{ flex: 1, fontSize: 12, height: 32, padding: "0 10px", background: "var(--bg-input)" }}
                          />
                          {/* Clear button */}
                          {localMap[name] && (
                            <button
                              onClick={() => handleClearMapping(name)}
                              title="Clear mapping"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", alignItems: "center" }}>
                              <RefreshCw size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
