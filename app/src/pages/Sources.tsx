import { useState } from "react";
import { FolderSearch, FolderOpen, CheckCircle2, XCircle, Wand2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setFolderValidation, setSettings } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import type { FolderValidation } from "../lib/debugger/types";

export default function Sources() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const validation = useAppSelector((s) => s.observer.folderValidation);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const folder = settings?.debuggerFolder;

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
      // Still show validation detail for the failed path.
      try {
        dispatch(setFolderValidation(await api.validateDebuggerFolder(path)));
      } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  };

  const autoDetect = async () => {
    setBusy(true);
    setMsg(null);
    const res = await api.detectDebuggerFolder();
    setCandidates(res.candidates);
    if (res.detected) {
      await applyFolder(res.detected);
    } else {
      setMsg("Auto-detection failed. Pick the folder manually below.");
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Free Fire Debugger folder" });
    if (typeof selected === "string") await applyFolder(selected);
  };

  return (
    <div className="page animate-fade-in">
      <div style={{ marginBottom: 22 }}>
        <div className="page-title">Debugger Source</div>
        <div className="page-subtitle">
          The app reads the latest file from <code>User Folder\Free Fire_64_Data\Debugger</code>.
        </div>
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 18 }}>
        <div className="section-header"><FolderOpen size={14} /> Current Folder</div>
        <div style={{ fontFamily: "Cascadia Code, Consolas, monospace", fontSize: 13, color: folder ? "var(--text-primary)" : "var(--text-muted)", wordBreak: "break-all", marginBottom: 14 }}>
          {folder ?? "No debugger folder configured yet."}
        </div>

        {validation && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, marginBottom: 14 }}>
            <Flag ok={validation.exists} label="Exists" />
            <Flag ok={validation.readable} label="Readable" />
            <Flag ok={validation.hasLogFiles} label={`${validation.fileCount} log file(s)`} />
            <Flag ok={validation.valid} label="Valid" />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={autoDetect} disabled={busy}>
            {busy ? <span className="spinner" /> : <Wand2 size={15} />} Auto-detect
          </button>
          <button className="btn btn-ghost" onClick={pickFolder} disabled={busy}>
            <FolderSearch size={15} /> Browse…
          </button>
        </div>
        {msg && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-secondary)" }}>{msg}</div>}
      </div>

      {candidates.length > 0 && (
        <div className="glass-card" style={{ padding: 20 }}>
          <div className="section-header"><FolderSearch size={14} /> Probed Locations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((c) => (
              <button
                key={c}
                className="btn btn-ghost"
                style={{ justifyContent: "flex-start", fontFamily: "Cascadia Code, monospace", fontSize: 12 }}
                onClick={() => applyFolder(c)}
              >
                {c}
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: ok ? "#4ade80" : "#f87171" }}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {label}
    </span>
  );
}
