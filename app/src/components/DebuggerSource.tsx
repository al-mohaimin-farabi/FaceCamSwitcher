import { useState } from "react";
import {
  FolderSearch,
  FolderOpen,
  FolderCheck,
  FolderX,
  CheckCircle2,
  XCircle,
  Wand2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setFolderValidation, setSettings } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import type { FolderValidation } from "../lib/debugger/types";

export default function DebuggerSource() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const validation = useAppSelector((s) => s.observer.folderValidation);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const folder = settings?.debuggerFolder;
  const folderParts = folder ? folder.split(/[\\/]/).filter(Boolean) : [];
  const folderLeaf = folderParts.length
    ? folderParts[folderParts.length - 1]
    : null;

  const applyFolder = async (path: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const v: FolderValidation = await api.setDebuggerFolder(path);
      dispatch(setFolderValidation(v));
      const fresh = await api.loadSettings();
      dispatch(setSettings(fresh));
      await api.startAllObservers().catch(() => {});
      setMsg("Debugger folder saved and validated.");
    } catch (e) {
      setMsg(String(e));
      try {
        dispatch(setFolderValidation(await api.validateDebuggerFolder(path)));
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  };

  const autoDetect = async () => {
    setBusy(true);
    setMsg("Scanning all drives for the Free Fire debugger folder…");
    const res = await api.detectDebuggerFolder();
    setCandidates(res.candidates);
    if (res.detected) {
      await applyFolder(res.detected);
    } else {
      setMsg(
        "No debugger folder found on any drive. Pick it manually with Browse…",
      );
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Free Fire Debugger folder",
    });
    if (typeof selected === "string") await applyFolder(selected);
  };

  return (
    <div className="glass-card" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <div className="section-header" style={{ marginBottom: 0 }}>
          <FolderOpen size={14} /> Debugger Source
        </div>
      </div>
      <div
        style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}
      >
        Reads the latest file from <code>…\Free Fire_64_Data\Debugger</code> —
        auto-detect scans every drive.
      </div>

      <div className={`src-path ${folder ? "active" : ""}`}>
        <div className="src-path-ico">
          {folder ? <FolderCheck size={20} /> : <FolderX size={20} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="src-path-label">
            {folder ? "Selected folder" : "No folder selected"}
          </div>
          {folder ? (
            <>
              <div className="src-path-leaf">{folderLeaf}</div>
              <div className="src-path-dir" title={folder}>
                {folder}
              </div>
            </>
          ) : (
            <div
              className="src-path-dir"
              style={{ color: "var(--text-muted)" }}
            >
              Auto-detect or browse to pick the debugger folder.
            </div>
          )}
        </div>
      </div>

      {validation && (
        <div className="src-flags">
          <Flag ok={validation.exists} label="Exists" />
          <Flag ok={validation.readable} label="Readable" />
          <Flag
            ok={validation.hasLogFiles}
            label={`${validation.fileCount} log file${validation.fileCount === 1 ? "" : "s"}`}
          />
          <Flag ok={validation.valid} label="Valid" />
        </div>
      )}

      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}
      >
        <button
          className="btn btn-primary"
          onClick={autoDetect}
          disabled={busy}
        >
          {busy ? <span className="spinner" /> : <Wand2 size={15} />}{" "}
          Auto-detect
        </button>
        <button className="btn btn-ghost" onClick={pickFolder} disabled={busy}>
          <FolderSearch size={15} /> Browse…
        </button>
      </div>
      {msg && (
        <div
          style={{
            marginTop: 12,
            fontSize: 12.5,
            color: "var(--text-secondary)",
          }}
        >
          {msg}
        </div>
      )}

      {candidates.length > 0 && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="section-header">
            <FolderSearch size={14} /> Found Locations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((c) => (
              <button
                key={c}
                className="btn btn-ghost"
                style={{
                  justifyContent: "flex-start",
                  fontFamily: "Cascadia Code, monospace",
                  fontSize: 12,
                }}
                onClick={() => applyFolder(c)}
              >
                <FolderOpen size={14} style={{ flexShrink: 0 }} />{" "}
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`src-flag ${ok ? "ok" : "bad"}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {label}
    </span>
  );
}
