import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Users,
  UserPlus,
  Search,
  RefreshCw,
  X,
  FileText,
  Upload,
  UserCheck,
  Filter,
  Link,
  Save,
} from "lucide-react";

interface Message {
  text: string;
  type: "success" | "error";
}

export default function PlayerNames() {
  const [players, setPlayers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // API URL state — loaded from config, editable, saved back to config
  const [apiUrl, setApiUrl] = useState("");
  const [isSavingUrl, setIsSavingUrl] = useState(false);

  useEffect(() => {
    loadPlayers();
    loadApiUrl();
  }, []);

  const loadPlayers = async () => {
    setIsLoading(true);
    try {
      const names = await invoke<string[]>("load_players");
      setPlayers(names);
    } catch (e) {
      showMessage(`Failed to load players: ${e}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const loadApiUrl = async () => {
    try {
      const config = await invoke<any>("load_config");
      setApiUrl(config.server?.players_api_url ?? "");
    } catch {
      // silently ignore
    }
  };

  const handleSaveApiUrl = async () => {
    setIsSavingUrl(true);
    try {
      const cfg = await invoke<any>("load_config");
      cfg.server.players_api_url = apiUrl.trim();
      await invoke("save_config", { config: cfg });
      showMessage("API URL saved", "success");
    } catch (e) {
      showMessage(`Failed to save URL: ${e}`, "error");
    } finally {
      setIsSavingUrl(false);
    }
  };

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  const handleImportFromWebsite = async () => {
    const url = apiUrl.trim();
    if (!url) {
      showMessage("Enter an API URL first.", "error");
      return;
    }

    setIsImporting(true);
    try {
      showMessage(`Fetching from ${url}...`, "success");

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let names: string[] = [];

      if (Array.isArray(data)) {
        names = data.map((item: any) =>
          typeof item === "string" ? item : item.name ?? item.player_name ?? String(item)
        );
      } else if (data && Array.isArray(data.players)) {
        names = data.players.map((item: any) =>
          typeof item === "string" ? item : item.name ?? item.player_name ?? String(item)
        );
      } else if (data && Array.isArray(data.data)) {
        names = data.data.map((item: any) =>
          typeof item === "string" ? item : item.name ?? item.player_name ?? String(item)
        );
      } else {
        throw new Error("Unexpected response format. Expected an array or { players: [...] }.");
      }

      names = names.map((n) => String(n).trim()).filter(Boolean);

      if (names.length === 0) {
        throw new Error("No player names found in the response.");
      }

      const result = await invoke<{ success: boolean; message: string }>("save_players", {
        players: names,
      });

      if (result.success) {
        showMessage(`Imported ${names.length} player(s) successfully!`, "success");
        loadPlayers();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`${e}`, "error");
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddPlayer = async () => {
    const name = newPlayerName.trim();
    if (!name) return;
    setIsAdding(true);
    try {
      const result = await invoke<{ success: boolean; message: string }>("add_player", { name });
      if (result.success) {
        showMessage(result.message, "success");
        setNewPlayerName("");
        loadPlayers();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemovePlayer = async (name: string) => {
    try {
      const result = await invoke<{ success: boolean; message: string }>("remove_player", { name });
      if (result.success) {
        showMessage(result.message, "success");
        loadPlayers();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
  };

  const filteredPlayers = searchQuery
    ? players.filter((p) => p.toLowerCase().includes(searchQuery.toLowerCase()))
    : players;

  // Group by team prefix (e.g. "TEAM.PlayerName" → group "TEAM")
  const groupedPlayers: Record<string, string[]> = {};
  filteredPlayers.forEach((name) => {
    const dotIndex = name.indexOf(".");
    const team = dotIndex > 0 ? name.substring(0, dotIndex) : "INDIVIDUAL";
    if (!groupedPlayers[team]) groupedPlayers[team] = [];
    groupedPlayers[team].push(name);
  });

  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 20 }} className="animate-fade-in">

      {/* ── Top Bar ─────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-bright)", letterSpacing: "-0.02em" }}>
            Player Management
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Manage the player database used for OCR name matching
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={14} style={{ color: "var(--text-muted)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-bright)" }}>{players.length}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Total</span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={loadPlayers}
            style={{ borderRadius: "10px", display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}
            title="Reload from local file"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Reload</span>
          </button>
        </div>
      </div>

      {/* ── Main Layout ─────────────────────── */}
      <div style={{ display: "flex", gap: 20 }}>

        {/* Left: Player list */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="section-header" style={{ marginBottom: 0 }}>
                <Filter size={14} className="icon" /> Player Database
              </div>
              <div style={{ position: "relative", width: 220 }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input
                  type="text"
                  className="input"
                  placeholder="Search names..."
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
            ) : filteredPlayers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", background: "rgba(255,255,255,0.02)", borderRadius: 12 }}>
                <Users size={32} style={{ color: "var(--text-muted)", margin: "0 auto", opacity: 0.3 }} />
                <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>
                  {searchQuery ? "No matching players found" : "Database is empty"}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {Object.entries(groupedPlayers)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([team, names]) => (
                    <div key={team} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "rgba(0,0,0,0.1)" }}>
                      <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.05em" }}>{team}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{names.length} player{names.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {names.map((name) => (
                          <div key={name} className="player-badge">
                            <span>{name}</span>
                            <button className="remove-btn" onClick={() => handleRemovePlayer(name)}>
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Controls */}
        <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Message */}
          {message && (
            <div
              style={{
                padding: "12px 16px", borderRadius: 12,
                background: message.type === "success" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${message.type === "success" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: message.type === "success" ? "var(--green)" : "var(--red)",
                fontSize: 13, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 10
              }}
              className="animate-fade-in"
            >
              {message.type === "success" ? <UserCheck size={16} /> : <X size={16} />}
              {message.text}
            </div>
          )}

          {/* Add Single Player */}
          <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <UserPlus size={14} className="icon" /> Add Player
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                type="text"
                placeholder="e.g. TEAM.PlayerName"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPlayer()}
                style={{ flex: 1, fontSize: 12 }}
              />
              <button
                className="btn btn-success"
                style={{ height: 36, padding: "0 14px", borderRadius: 8, flexShrink: 0, fontWeight: 700, fontSize: 12 }}
                onClick={handleAddPlayer}
                disabled={isAdding || !newPlayerName.trim()}
              >
                {isAdding ? <RefreshCw size={13} className="animate-spin" /> : "Add"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Use format <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>TEAM.Name</span> to group players by team.
            </p>
          </div>

          {/* Import from API */}
          <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <Upload size={14} className="icon" /> Import from API
            </div>

            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Fetch player names from your website API. This replaces the local list entirely.
            </p>

            {/* Editable API URL */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
                <Link size={10} /> Players API URL
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input"
                  type="text"
                  placeholder="https://yoursite.com/api/players"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  style={{ flex: 1, fontSize: 11 }}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ height: 36, padding: "0 10px", borderRadius: 8, flexShrink: 0 }}
                  onClick={handleSaveApiUrl}
                  disabled={isSavingUrl}
                  title="Save URL to config"
                >
                  {isSavingUrl ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                </button>
              </div>
              <p style={{ fontSize: 10, color: "var(--text-muted)" }}>
                Response must be an array of strings, or <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>{"{ players: [...] }"}</span>
              </p>
            </div>

            <button
              className="btn btn-accent"
              style={{ width: "100%", height: 42, fontWeight: 700, fontSize: 13 }}
              onClick={handleImportFromWebsite}
              disabled={isImporting || !apiUrl.trim()}
            >
              {isImporting ? (
                <><RefreshCw size={15} className="animate-spin" /> Importing...</>
              ) : (
                <><FileText size={15} /> Import Players</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
