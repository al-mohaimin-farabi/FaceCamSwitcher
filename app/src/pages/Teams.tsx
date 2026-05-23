import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Shield,
  Plus,
  X,
  RefreshCw,
  Trash2,
  Search,
  Pencil,
  Check,
} from "lucide-react";

interface Message {
  text: string;
  type: "success" | "error";
}

export default function Teams() {
  const [teams, setTeams] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    setIsLoading(true);
    try {
      const tags = await invoke<string[]>("load_team_tags");
      setTeams(tags);
    } catch (e) {
      showMessage(`Failed to load teams: ${e}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAdd = async () => {
    const trimmed = newTag.trim().toUpperCase();
    if (!trimmed) return;
    setIsAdding(true);
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "add_team_tag",
        { tag: trimmed },
      );
      if (result.success) {
        setNewTag("");
        showMessage(result.message, "success");
        loadTeams();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    } finally {
      setIsAdding(false);
      inputRef.current?.focus();
    }
  };

  const handleRemove = async (tag: string) => {
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "remove_team_tag",
        { tag },
      );
      if (result.success) {
        showMessage(result.message, "success");
        loadTeams();
      } else {
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
  };

  const handleRename = async (oldTag: string) => {
    const trimmed = editValue.trim().toUpperCase();
    if (!trimmed || trimmed === oldTag) {
      setEditingTag(null);
      return;
    }
    try {
      // Remove old, add new
      await invoke("remove_team_tag", { tag: oldTag });
      const result = await invoke<{ success: boolean; message: string }>(
        "add_team_tag",
        { tag: trimmed },
      );
      if (result.success) {
        showMessage(`Renamed '${oldTag}' → '${trimmed}'`, "success");
        loadTeams();
      } else {
        // Restore old if add failed
        await invoke("add_team_tag", { tag: oldTag });
        showMessage(result.message, "error");
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
    setEditingTag(null);
  };

  const handleClearAll = async () => {
    if (
      !window.confirm(
        `Remove all ${teams.length} teams? This cannot be undone.`,
      )
    )
      return;
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "save_team_tags",
        { tags: [] },
      );
      if (result.success) {
        showMessage("All teams cleared", "success");
        loadTeams();
      }
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
  };

  const filtered = searchQuery
    ? teams.filter((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
    : teams;

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
            Team Management
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Add the team tags that appear on screen — OCR will fuzzy-match
            against these
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "6px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Shield size={13} style={{ color: "var(--text-muted)" }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-bright)",
              }}
            >
              {teams.length}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Teams
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={loadTeams}
            style={{
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
            }}
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Reload</span>
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleClearAll}
            disabled={teams.length === 0}
            style={{
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              color: teams.length === 0 ? undefined : "#ef4444",
              borderColor:
                teams.length === 0 ? undefined : "rgba(239,68,68,0.3)",
            }}
          >
            <Trash2 size={13} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Clear All</span>
          </button>
        </div>
      </div>

      {/* ── Message Toast ──────────────── */}
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

      {/* ── Add Team ─────────────────────── */}
      <div className="glass-card" style={{ padding: 18 }}>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <Plus size={14} className="icon" /> Add Team
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            className="input"
            type="text"
            placeholder="Enter team tag or name (e.g. RHK or Red Hawks)"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            style={{ flex: 1, fontSize: 13 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={isAdding || !newTag.trim()}
            style={{
              height: 38,
              padding: "0 20px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isAdding ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Add
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Type the exact text that appears on screen — or close to it. The fuzzy
          matcher handles minor OCR errors automatically.
        </p>
      </div>

      {/* ── Team List ────────────────────── */}
      <div
        className="glass-card"
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          flex: 1,
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
            <Shield size={14} className="icon" /> Team Database
          </div>
          <div style={{ position: "relative", width: 220 }}>
            <Search
              size={13}
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
              placeholder="Search teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                paddingLeft: 34,
                height: 34,
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
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
            }}
          >
            <Shield
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
              {searchQuery
                ? "No matching teams"
                : "No teams yet — add one above"}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {filtered.map((tag) => (
              <div
                key={tag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px 6px 14px",
                  borderRadius: 10,
                  background: "rgba(96,165,250,0.08)",
                  border: "1px solid rgba(96,165,250,0.2)",
                }}
              >
                {editingTag === tag ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(tag);
                        if (e.key === "Escape") setEditingTag(null);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: "var(--text-bright)",
                        fontSize: 13,
                        fontWeight: 700,
                        fontFamily: '"Cascadia Code", monospace',
                        width: Math.max(60, editValue.length * 9),
                      }}
                    />
                    <button
                      onClick={() => handleRename(tag)}
                      style={{
                        background: "rgba(34,197,94,0.15)",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: "#22c55e",
                        padding: "2px 6px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Check size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--accent)",
                        fontFamily: '"Cascadia Code", monospace',
                        letterSpacing: "0.03em",
                      }}
                    >
                      {tag}
                    </span>
                    <button
                      onClick={() => {
                        setEditingTag(tag);
                        setEditValue(tag);
                      }}
                      title="Rename"
                      style={{
                        background: "rgba(148,163,184,0.12)",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        padding: "2px 5px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={() => handleRemove(tag)}
                      title="Remove"
                      style={{
                        background: "rgba(239,68,68,0.1)",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: "#ef4444",
                        padding: "2px 5px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
