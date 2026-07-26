import { useState } from "react";
import {
  Radio,
  FileText,
  Globe,
  Clock,
  Sparkles,
  MonitorDot,
  User,
  UserRound,
  Fingerprint,
  IdCard,
  Binary,
  FolderOpen,
  CirclePlay,
  CircleStop,
  Settings2,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setObservers, removeRuntime } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import type { ObserverConfig } from "../lib/debugger/types";
import StatusBadge from "../components/StatusBadge";
import ObserverModal from "../components/ObserverModal";
import DebuggerSource from "../components/DebuggerSource";
import { relativeTime, shortFile } from "../lib/format";

function InfoTile({
  icon,
  label,
  value,
  color,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  title?: string;
}) {
  return (
    <div
      className="glass-card"
      style={{
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${color}1f`,
          color,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-muted)",
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={title ?? value}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function DTile({
  icon,
  k,
  v,
  title,
  wide,
}: {
  icon: React.ReactNode;
  k: string;
  v: string;
  title?: string;
  wide?: boolean;
}) {
  return (
    <div className={`detail-tile${wide ? " wide" : ""}`}>
      <div className="dt-k">
        {icon} {k}
      </div>
      <div className={`dt-v${wide ? " one-line" : ""}`} title={title ?? v}>
        {v}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const dispatch = useAppDispatch();
  const observers = useAppSelector((s) => s.observer.observers);
  const runtime = useAppSelector((s) => s.observer.runtime);
  const teams = useAppSelector((s) => s.observer.settings?.teams ?? []);
  const syncOnline = useAppSelector((s) => s.observer.networkSyncConnected);
  const [editing, setEditing] = useState(false);

  // Single local observer model.
  const observer = observers[0];
  const rt = observer ? runtime[observer.id] : undefined;
  const co = rt?.currentObserver;
  const status = observer
    ? observer.enabled
      ? (rt?.status ?? "waiting")
      : "disabled"
    : "waiting";
  const isLive =
    !!co?.name && (status === "watching" || status === "connected");
  const isWatching = !!rt && rt.status !== "disabled";

  const refresh = async () => {
    const list = await api.listObservers();
    dispatch(setObservers(list));
  };

  const saveObserver = async (o: ObserverConfig) => {
    await api.upsertObserver(o);
    await refresh();
    if (o.enabled) await api.startObserver(o.id).catch(() => {});
  };

  const toggleEnabled = async (o: ObserverConfig) => {
    const updated = { ...o, enabled: !o.enabled };
    await api.upsertObserver(updated);
    await refresh();
    if (updated.enabled) await api.startObserver(o.id).catch(() => {});
    else {
      await api.stopObserver(o.id).catch(() => {});
      dispatch(removeRuntime(o.id));
    }
  };

  const startStop = async (o: ObserverConfig, start: boolean) => {
    if (start) await api.startObserver(o.id);
    else {
      await api.stopObserver(o.id);
      dispatch(removeRuntime(o.id));
    }
  };

  // Resolve detected UID against the Team Info roster for richer detail.
  const roster = (() => {
    const uid = co?.uid;
    if (!uid)
      return { team: null as string | null, playerName: null as string | null };
    for (const t of teams) {
      for (const p of t.players) {
        if (p.uid === uid)
          return { team: t.name || null, playerName: p.playerName || null };
      }
    }
    return { team: null as string | null, playerName: null as string | null };
  })();

  const displayName = roster.playerName ?? co?.name ?? null;

  return (
    <div className="page animate-fade-in">
      {/* ── Hero ───────────────────────────────────────── */}
      <div className="dash-hero" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
          }}
        >
          <div>
            <div className="dash-hero-title">Dashboard</div>
            <div className="dash-hero-sub">
              Live overview of the observer feed and debugger source.
            </div>
          </div>
          <span className={`live-pill ${isLive ? "" : "muted"}`}>
            <span className="dot" /> {isLive ? "On Air" : "Idle"}
          </span>
        </div>
      </div>

      {/* ── Live observer feed (single, magic hero) ────── */}
      {!observer ? (
        <div className="empty-state">
          No observer configured yet. Set up your source under Debugger Source.
        </div>
      ) : (
        <div
          className={`magic-card ${isLive ? "live" : ""}`}
          style={{ marginBottom: 16 }}
        >
          <div className="magic-card-inner">
            {/* Header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                marginBottom: 24,
              }}
            >
              <div
                className={isLive ? "animate-pulse-glow" : ""}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 17,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isLive
                    ? "linear-gradient(135deg, rgba(34,211,238,0.25), rgba(59,130,246,0.18))"
                    : "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(168,85,247,0.15))",
                  color: isLive ? "#67e8f9" : "#60a5fa",
                  border: "1px solid rgba(255,255,255,0.07)",
                  fontSize: 26,
                  fontWeight: 800,
                }}
              >
                {displayName ? <UserRound size={30} /> : <Radio size={28} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 17 }}>
                    {observer.displayName}
                  </span>
                  <StatusBadge status={status} />
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    color: "var(--text-muted)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginTop: 4,
                  }}
                >
                  <MonitorDot size={12} /> Local PC
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  flexShrink: 0,
                }}
              >
                <Clock size={13} color="var(--text-muted)" />{" "}
                {relativeTime(co?.updatedAt ?? rt?.lastHeartbeatAt)}
              </span>
            </div>

            {/* Current player headline */}
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 11.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: isLive ? "#22d3ee" : "var(--text-muted)",
                }}
              >
                <Sparkles size={13} />{" "}
                {isLive ? "Now Observing" : "Current Player"}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <span
                  className={`obs-headline ${isLive ? "shine" : ""}`}
                  style={
                    !isLive
                      ? {
                          color: displayName
                            ? "var(--text-primary)"
                            : "var(--text-muted)",
                        }
                      : undefined
                  }
                >
                  {displayName ?? "Waiting for switch…"}
                </span>
                {roster.team && (
                  <span className="feed-team" style={{ fontSize: 13 }}>
                    {roster.team}
                  </span>
                )}
              </div>
            </div>

            {/* Detail tiles */}
            <div className="detail-grid" style={{ marginTop: 24 }}>
              <DTile
                icon={<User size={12} />}
                k="Player Name"
                v={co?.name ?? "—"}
              />
              <DTile
                icon={<Fingerprint size={12} />}
                k="Player UID"
                v={co?.uid ?? "—"}
              />
              <DTile
                icon={<IdCard size={12} />}
                k="Player ID"
                v={co?.playerId ?? "—"}
              />
              <DTile
                icon={<Binary size={12} />}
                k="Raw Value"
                v={co?.rawObserverValue ?? "—"}
              />
              <DTile
                icon={<FolderOpen size={12} />}
                k="Source File"
                v={shortFile(co?.sourceFile)}
                title={co?.sourceFile ?? undefined}
                wide
              />
            </div>

            {rt?.lastMessage && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                  marginTop: 16,
                }}
              >
                {rt.lastMessage}
              </div>
            )}

            {/* Controls */}
            <div className="control-bar">
              <label className="switch" title="Enable / disable">
                <input
                  type="checkbox"
                  checked={observer.enabled}
                  onChange={() => toggleEnabled(observer)}
                />
                <span className="slider" />
              </label>
              <span
                className={`control-status ${observer.enabled ? "on" : ""}`}
              >
                <span className="led" />{" "}
                {observer.enabled ? "Enabled" : "Disabled"}
              </span>

              {observer.enabled &&
                (isWatching ? (
                  <button
                    className="btn btn-danger"
                    onClick={() => startStop(observer, false)}
                  >
                    <CircleStop size={15} /> Stop
                  </button>
                ) : (
                  <button
                    className="btn btn-success"
                    onClick={() => startStop(observer, true)}
                  >
                    <CirclePlay size={15} /> Start
                  </button>
                ))}

              <button
                className="btn btn-primary"
                style={{ marginLeft: "auto" }}
                onClick={() => setEditing(true)}
              >
                <Settings2 size={15} /> Configure
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Status tiles ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <InfoTile
          icon={<Globe size={17} />}
          label="Network Sync"
          value={syncOnline ? "Online" : "Offline"}
          color={syncOnline ? "#4ade80" : "#64748b"}
        />
        <InfoTile
          icon={<FileText size={17} />}
          label="Latest Debugger File"
          value={shortFile(co?.sourceFile) || "Waiting…"}
          title={co?.sourceFile ?? undefined}
          color="#c084fc"
        />
      </div>

      {/* ── Debugger source ────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <DebuggerSource />
      </div>

      {editing && observer && (
        <ObserverModal
          initial={observer}
          onClose={() => setEditing(false)}
          onSave={saveObserver}
        />
      )}
    </div>
  );
}
