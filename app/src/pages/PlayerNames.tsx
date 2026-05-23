import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Users,
  Search,
  RefreshCw,
  X,
  Filter,
  Pencil,
  Check,
  Trash2,
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
  const [editingPlayer, setEditingPlayer] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadPlayers();
  }, []);

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  const handleRenamePlayer = async (oldName: string) => {
    const newName = editValue.trim();
    if (!newName || newName.toUpperCase() === oldName.toUpperCase()) {
      setEditingPlayer(null);
      return;
    }
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "rename_player",
        { oldName, newName },
      );
      if (result.success) {
        showMessage(result.message, "success");
        loadPlayers();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
    setEditingPlayer(null);
  };

  const handleClearAll = async () => {
    if (players.length === 0) return;
    const confirmed = window.confirm(
      `Remove all ${players.length} players from the database?\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "save_players",
        { players: [] },
      );
      if (result.success) {
        showMessage("All players cleared", "success");
        loadPlayers();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
  };

  const handleRemovePlayer = async (name: string) => {
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "remove_player",
        { name },
      );
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
    <div
      style={{
        padding: 24,
        height: "100%",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* ── Top Bar ─────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "var(--text-bright)",
              letterSpacing: "-0.02em",
            }}
          >
            Player Management
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Manage the player database used for OCR name matching
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "6px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Users size={14} style={{ color: "var(--text-muted)" }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-bright)",
              }}
            >
              {players.length}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Total
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={loadPlayers}
            style={{
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
            }}
            title="Reload from local file"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Reload</span>
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleClearAll}
            disabled={players.length === 0}
            style={{
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
              color: players.length === 0 ? undefined : "#ef4444",
              borderColor:
                players.length === 0 ? undefined : "rgba(239,68,68,0.3)",
            }}
            title="Remove all players from the database"
          >
            <Trash2 size={14} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Clear All</span>
          </button>
        </div>
      </div>

      {/* ── Message toast ─────────────────────── */}
      {message && (
        <div
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            background:
              message.type === "success"
                ? "rgba(34,197,94,0.15)"
                : "rgba(239,68,68,0.15)",
            color: message.type === "success" ? "#22c55e" : "#ef4444",
            border: `1px solid ${message.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}
        >
          {message.text}
        </div>
      )}

      {/* ── Player List ─────────────────────── */}
      <div
        className="glass-card"
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div className="section-header" style={{ marginBottom: 0 }}>
            <Filter size={14} className="icon" /> Player Database
          </div>
          <div style={{ position: "relative", width: 220 }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
            <input
              type="text"
              className="input"
              placeholder="Search names..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                paddingLeft: 34,
                height: 36,
                fontSize: 12,
              }}
            />
          </div>
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <RefreshCw
              size={24}
              className="animate-spin"
              style={{ color: "var(--accent)", margin: "0 auto" }}
            />
            <p
              style={{
                marginTop: 12,
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              Loading...
            </p>
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
            }}
          >
            <Users
              size={32}
              style={{
                color: "var(--text-muted)",
                margin: "0 auto",
                opacity: 0.3,
              }}
            />
            <p
              style={{
                marginTop: 12,
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              {searchQuery ? "No matching players found" : "Database is empty"}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.entries(groupedPlayers)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([team, names]) => (
                <div
                  key={team}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "rgba(0,0,0,0.1)",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--accent)",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {team}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {names.length} player{names.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {names.map((name) => (
                      <div key={name} className="player-badge group">
                        {editingPlayer === name ? (
                          <>
                            <input
                              autoFocus
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenamePlayer(name);
                                if (e.key === "Escape") setEditingPlayer(null);
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                color: "var(--text-bright)",
                                fontSize: "inherit",
                                fontFamily: "inherit",
                                width: Math.max(60, editValue.length * 8),
                                padding: 0,
                              }}
                            />
                            <button
                              className="remove-btn"
                              onClick={() => handleRenamePlayer(name)}
                              style={{
                                color: "#22c55e",
                                background: "rgba(34,197,94,0.15)",
                              }}
                              title="Save"
                            >
                              <Check size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span>{name}</span>
                            <button
                              className="remove-btn"
                              onClick={() => {
                                setEditingPlayer(name);
                                setEditValue(name);
                              }}
                              style={{
                                color: "#94a3b8",
                                background: "rgba(148,163,184,0.15)",
                              }}
                              title="Edit"
                            >
                              <Pencil size={10} />
                            </button>
                            <button
                              className="remove-btn"
                              onClick={() => handleRemovePlayer(name)}
                            >
                              <X size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
