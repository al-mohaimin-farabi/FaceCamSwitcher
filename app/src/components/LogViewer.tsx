import { useEffect, useRef } from "react";

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export default function LogViewer({ logs, onClear }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "success":
        return "✓";
      case "error":
        return "✗";
      case "warning":
        return "⚠";
      default:
        return "›";
    }
  };

  return (
    <div
      className="glass-card"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
      {/* ── Header ────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}>
        <div className="section-header" style={{ marginBottom: 0 }}>
          <span className="icon">📋</span> Live Log
          <span
            style={{
              fontSize: 10,
              padding: "1px 8px",
              borderRadius: 10,
              background: "var(--accent-glow)",
              color: "var(--accent)",
              fontWeight: 700,
              marginLeft: 4,
            }}>
            {logs.length}
          </span>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClear}>
          🗑 Clear
        </button>
      </div>

      {/* ── Log Entries ───────────── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 12px",
        }}>
        {logs.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: 40,
              color: "var(--text-muted)",
              fontSize: 13,
            }}>
            <span
              style={{
                fontSize: 28,
                display: "block",
                marginBottom: 8,
                opacity: 0.4,
              }}>
              📋
            </span>
            No log entries yet
            <p style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
              Start capture to see live OCR results
            </p>
          </div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={`log-entry ${entry.level}`}>
              <span className="time">{entry.time}</span>
              <span
                style={{
                  fontSize: 11,
                  width: 14,
                  textAlign: "center",
                  flexShrink: 0,
                }}>
                {getLevelIcon(entry.level)}
              </span>
              <span className="msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
