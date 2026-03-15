import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Users, 
  UserPlus, 
  Search, 
  RefreshCw, 
  X, 
  Trash2, 
  FileText, 
  Upload,
  UserCheck,
  Filter
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

  useEffect(() => {
    loadPlayers();
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

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleImportFromWebsite = async () => {
    setIsImporting(true);
    try {
      // 1. Load config to get the website server URL
      const config = await invoke<any>("load_config");
      const serverUrl = config.server?.url;
      
      if (!serverUrl) {
        throw new Error("Server URL not configured in Settings.");
      }

      // 2. Determine the players endpoint
      // We assume the website has a /api/players endpoint relative to the base
      const baseUrl = serverUrl.includes("/api/") 
        ? serverUrl.split("/api/")[0] 
        : serverUrl.substring(0, serverUrl.lastIndexOf("/"));
      
      const playersUrl = `${baseUrl}/api/players`;
      
      showMessage(`Fetching from ${playersUrl}...`, "success");

      // 3. Fetch players from website
      const response = await fetch(playersUrl);
      if (!response.ok) {
        throw new Error(`Website error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let names: string[] = [];
      
      if (Array.isArray(data)) {
        names = data;
      } else if (data && Array.isArray(data.players)) {
        names = data.players;
      } else {
        throw new Error("Invalid response format from server (expected array).");
      }

      if (names.length === 0) {
        throw new Error("No players found on the server.");
      }

      // 4. Save to local database
      const result = await invoke<{ success: boolean; message: string }>("save_players", {
        players: names,
      });

      if (result.success) {
        showMessage(`Successfully imported ${names.length} players from website!`, "success");
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

  const handleRemovePlayer = async (name: string) => {
    try {
      const result = await invoke<{ success: boolean; message: string }>("remove_player", {
        name,
      });
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

  // Group players by team prefix
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
            Control the player database used for high-precision OCR matching
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={14} className="text-secondary" />
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
            <span style={{ fontSize: 11, fontWeight: 600 }}>Reload from file</span>
          </button>
        </div>
      </div>

      {/* ── Action Rows ─────────────────────── */}
      <div style={{ display: "flex", gap: 20 }}>
        {/* Left Column: List */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="section-header" style={{ marginBottom: 0 }}>
                <Filter size={14} className="icon" /> Database Filter
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
                <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>Loading database...</p>
              </div>
            ) : filteredPlayers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", background: "rgba(255,255,255,0.02)", borderRadius: 12 }}>
                <Users size={32} style={{ color: "var(--text-dim)", margin: "0 auto", opacity: 0.3 }} />
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
                         <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{names.length} Player{names.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {names.map((name) => (
                          <div key={name} className="player-badge" style={{ animation: "fade-in 0.3s ease-out" }}>
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

        {/* Right Column: Controls */}
        <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Message Area */}
          {message && (
            <div 
              style={{ 
                padding: "12px 16px", 
                borderRadius: 12, 
                background: message.type === "success" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                border: `1px solid ${message.type === "success" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                color: message.type === "success" ? "var(--green)" : "var(--red)",
                fontSize: 13,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
              className="animate-fade-in"
            >
              {message.type === "success" ? <UserCheck size={16} /> : <X size={16} />}
              {message.text}
            </div>
          )}

          {/* Import Section */}
          <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="section-header" style={{ marginBottom: 0 }}>
              <Upload size={14} className="icon" /> Website Sync
            </div>
            
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Sync your local player database with the official FaceCam website server. 
              This will overwrite your local list with the latest roster.
            </p>

            <div style={{ padding: 16, background: "rgba(0,0,0,0.2)", borderRadius: 12, border: "1px dashed var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Users size={14} className="text-secondary" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)" }}>Cloud Database</span>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-dim)" }}>
                Imports from: <span style={{ color: "var(--accent)" }}>/api/players</span>
              </p>
            </div>

            <button 
              className="btn btn-accent" 
              style={{ width: "100%", height: 48, marginTop: 8 }} 
              onClick={handleImportFromWebsite}
              disabled={isImporting || isLoading}
            >
              {isImporting ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <FileText size={18} />
              )}
              <span style={{ marginLeft: 8 }}>Import from Website</span>
            </button>
            
            {isImporting && (
              <p style={{ fontSize: 11, color: "var(--accent)", textAlign: "center", animation: "pulse 2s infinite" }}>
                Connecting to server...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
