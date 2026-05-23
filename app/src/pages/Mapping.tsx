import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSelector, useDispatch } from "react-redux";
import { type RootState } from "../store/store";
import { setConfig, setTeamCameraMap, type AppConfig } from "../store/appSlice";
import {
  Video,
  RefreshCw,
  Save,
  AlertCircle,
  CheckCircle2,
  Layers,
  Plus,
  X,
  Trash2,
} from "lucide-react";

interface Message {
  text: string;
  type: "success" | "error";
}

export default function Mapping() {
  const dispatch = useDispatch();
  const { config } = useSelector((state: RootState) => state.app);

  // Local state — rows are { tag, camera } pairs
  const [rows, setRows] = useState<{ tag: string; camera: string }[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newCamera, setNewCamera] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [tags, cfg] = await Promise.all([
        invoke<string[]>("load_team_tags"),
        invoke<AppConfig>("load_config"),
      ]);
      dispatch(setConfig(cfg));
      const map = cfg.team_camera_map ?? {};

      // Build rows: all existing tags + any extra keys in map not yet in tags
      const tagSet = new Set(tags.map((t) => t.toUpperCase()));
      const extraKeys = Object.keys(map).filter(
        (k) => !tagSet.has(k.toUpperCase()),
      );
      const allTags = [...tags, ...extraKeys];

      setRows(allTags.map((tag) => ({ tag, camera: map[tag] ?? "" })));
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

  // Add a brand-new row (adds team tag to Team Tag.txt + adds to local rows)
  const handleAddRow = async () => {
    const tag = newTag.trim().toUpperCase();
    const camera = newCamera.trim();
    if (!tag) return;

    // Check duplicate
    if (rows.some((r) => r.tag.toUpperCase() === tag)) {
      showMessage(`'${tag}' already exists in the mapping`, "error");
      return;
    }

    try {
      // Register in Team Tag.txt so the fuzzy matcher knows about it
      await invoke("add_team_tag", { tag });
      setRows((prev) => [...prev, { tag, camera }]);
      setNewTag("");
      setNewCamera("");
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
  };

  // Remove a row (removes from Team Tag.txt + removes from local map)
  const handleRemoveRow = async (tag: string) => {
    try {
      await invoke("remove_team_tag", { tag });
      setRows((prev) => prev.filter((r) => r.tag !== tag));
    } catch (e) {
      showMessage(`Error: ${e}`, "error");
    }
  };

  const handleCameraChange = (tag: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.tag === tag ? { ...r, camera: value } : r)),
    );
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      // Build map from current rows (skip blank camera entries)
      const newMap: Record<string, string> = {};
      for (const { tag, camera } of rows) {
        if (camera.trim()) newMap[tag] = camera.trim();
      }
      const newConfig: AppConfig = { ...config, team_camera_map: newMap };
      await invoke("save_config", { config: newConfig });
      dispatch(setConfig(newConfig));
      dispatch(setTeamCameraMap(newMap));
      const mapped = Object.keys(newMap).length;
      showMessage(
        `Saved — ${mapped} / ${rows.length} team(s) mapped`,
        "success",
      );
    } catch (e) {
      showMessage(`Save failed: ${e}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAll = () => {
    if (
      !window.confirm(
        "Clear all camera mappings (teams stay, camera inputs are cleared)?",
      )
    )
      return;
    setRows((prev) => prev.map((r) => ({ ...r, camera: "" })));
  };

  const mappedCount = rows.filter((r) => r.camera.trim()).length;

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
      {/* ── Top Bar ──────────────────────── */}
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
            vMix Camera Mapping
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Map each team tag to a vMix camera input. Add custom entries inline.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "5px 12px",
              borderRadius: 8,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              fontSize: 12,
              fontWeight: 700,
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--green)" }}>{mappedCount} mapped</span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span style={{ color: "var(--text-muted)" }}>
              {rows.length - mappedCount} unmapped
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={loadAll}
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
            disabled={rows.every((r) => !r.camera.trim())}
            style={{
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              color: "#ef4444",
              borderColor: "rgba(239,68,68,0.3)",
            }}
          >
            <Trash2 size={13} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Clear Cameras</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              height: 36,
              borderRadius: 10,
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isSaving ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}
            Save Mappings
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
            display: "flex",
            alignItems: "center",
            gap: 8,
            background:
              message.type === "success"
                ? "rgba(34,197,94,0.15)"
                : "rgba(239,68,68,0.15)",
            color: message.type === "success" ? "#22c55e" : "#ef4444",
            border: `1px solid ${message.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}
        >
          {message.type === "success" ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          {message.text}
        </div>
      )}

      {/* ── Info Banner ──────────────────── */}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          background: "rgba(59,130,246,0.06)",
          border: "1px solid rgba(59,130,246,0.15)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Layers size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <p
          style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          OCR reads the screen text and fuzzy-matches it against your team tags
          (e.g. <strong style={{ color: "var(--accent)" }}>RHK</strong>). Enter
          the exact vMix input name on the right (e.g.{" "}
          <strong style={{ color: "var(--text-secondary)" }}>Camera 3</strong>).
          Use{" "}
          <strong style={{ color: "var(--text-secondary)" }}>Add Custom</strong>{" "}
          to add a new team+camera pair without switching to the Teams tab.
        </p>
      </div>

      {/* ── Add Custom Row ─────────────── */}
      <div className="glass-card" style={{ padding: 18 }}>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <Plus size={14} className="icon" /> Add Custom Mapping
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 20px 1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            className="input"
            type="text"
            placeholder="Team tag (e.g. RHK)"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddRow();
            }}
            style={{ fontSize: 13 }}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            →
          </span>
          <input
            className="input"
            type="text"
            placeholder="vMix input name (e.g. Camera 1)"
            value={newCamera}
            onChange={(e) => setNewCamera(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddRow();
            }}
            style={{ fontSize: 13 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAddRow}
            disabled={!newTag.trim()}
            style={{
              height: 38,
              padding: "0 18px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {/* ── Mapping Table ─────────────── */}
      <div
        className="glass-card"
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
        }}
      >
        <div className="section-header" style={{ marginBottom: 4 }}>
          <Video size={14} className="icon" /> Team Tag → Camera Input
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <RefreshCw
              size={24}
              className="animate-spin"
              style={{ color: "var(--accent)", margin: "0 auto" }}
            />
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
            }}
          >
            <Video
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
              No teams yet — use the Add Custom form above or add teams in the
              Teams tab
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Column headers */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "160px 24px 1fr 36px",
                gap: 10,
                padding: "0 10px",
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Team Tag
              </span>
              <span />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                vMix Camera Input
              </span>
              <span />
            </div>

            {rows.map(({ tag, camera }) => {
              const isMapped = Boolean(camera.trim());
              return (
                <div
                  key={tag}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "160px 24px 1fr 36px",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: isMapped
                      ? "rgba(34,197,94,0.05)"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isMapped ? "rgba(34,197,94,0.18)" : "var(--border)"}`,
                  }}
                >
                  {/* Tag */}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: "var(--accent)",
                      fontFamily: '"Cascadia Code", monospace',
                      letterSpacing: "0.04em",
                    }}
                  >
                    {tag}
                  </span>

                  {/* Arrow */}
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: isMapped ? "var(--green)" : "var(--border)",
                      textAlign: "center",
                    }}
                  >
                    →
                  </span>

                  {/* Camera input */}
                  <input
                    type="text"
                    className="input"
                    placeholder="vMix input name (e.g. Camera 1)"
                    value={camera}
                    onChange={(e) => handleCameraChange(tag, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                    }}
                    style={{ fontSize: 13, height: 34, padding: "0 12px" }}
                  />

                  {/* Remove */}
                  <button
                    onClick={() => handleRemoveRow(tag)}
                    title="Remove team"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      background: "rgba(239,68,68,0.08)",
                      color: "#ef4444",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
