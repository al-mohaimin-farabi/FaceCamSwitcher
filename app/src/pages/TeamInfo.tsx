import { useMemo, useState } from "react";
import { Plus, Trash2, Copy, Check, Shield, DownloadCloud, ChevronDown, ChevronRight } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setSettings } from "../store/observerSlice";
import { api } from "../lib/debugger/api";
import type {
  AppSettings,
  FetchedPlayer,
  PlayerRole,
  Team,
  TeamPlayer,
} from "../lib/debugger/types";

const MAIN_COUNT = 4;
const TEAM_SIZE = 5; // 4 main + 1 substitute

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyPlayer(role: PlayerRole): TeamPlayer {
  return { id: rid("p"), playerName: "", uid: "", playerId: "", role };
}

function newTeam(): Team {
  const players: TeamPlayer[] = [];
  for (let i = 0; i < MAIN_COUNT; i++) players.push(emptyPlayer("main"));
  players.push(emptyPlayer("sub"));
  return { id: rid("t"), name: "", players };
}

function normalize(players: TeamPlayer[]): TeamPlayer[] {
  const out = [...players];
  while (out.filter((p) => p.role !== "sub").length < MAIN_COUNT) out.push(emptyPlayer("main"));
  if (!out.some((p) => p.role === "sub")) out.push(emptyPlayer("sub"));
  return out;
}

/** Build teams from fetched players: group by squad (playerId >> 24), then
 *  chunk each group into 4 main + 1 sub. Falls back to chunking everything by 5
 *  if the squad encoding isn't present. */
function buildTeams(players: FetchedPlayer[]): Team[] {
  const groups = new Map<number, FetchedPlayer[]>();
  for (const p of players) {
    const pid = parseInt(p.playerId, 10) || 0;
    const squad = pid > 0 ? Math.floor(pid / 0x1000000) : 0;
    if (!groups.has(squad)) groups.set(squad, []);
    groups.get(squad)!.push(p);
  }
  const mk = (src: FetchedPlayer | undefined, role: PlayerRole): TeamPlayer => ({
    id: rid("p"),
    playerName: src?.name ?? "",
    uid: src?.uid ?? "",
    playerId: src?.playerId ?? "",
    role,
  });

  const teams: Team[] = [];
  let teamNo = 1;
  for (const [, ps] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    ps.sort((a, b) => (parseInt(a.playerId, 10) || 0) - (parseInt(b.playerId, 10) || 0));
    for (let i = 0; i < ps.length; i += TEAM_SIZE) {
      const chunk = ps.slice(i, i + TEAM_SIZE);
      const slots: TeamPlayer[] = [];
      for (let j = 0; j < MAIN_COUNT; j++) slots.push(mk(chunk[j], "main"));
      slots.push(mk(chunk[MAIN_COUNT], "sub"));
      teams.push({ id: rid("t"), name: `Team ${teamNo++}`, players: slots });
    }
  }
  return teams;
}

export default function TeamInfo() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.observer.settings);
  const runtime = useAppSelector((s) => s.observer.runtime);
  const [copied, setCopied] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const teams = settings?.teams ?? [];

  const knownUids = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) for (const p of t.players) if (p.uid) set.add(p.uid);
    return set;
  }, [teams]);

  const detected = useMemo(() => {
    const out: { uid: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const rt of Object.values(runtime)) {
      const co = rt.currentObserver;
      if (!co?.uid || knownUids.has(co.uid) || seen.has(co.uid)) continue;
      seen.add(co.uid);
      out.push({ uid: co.uid, name: co.name ?? "" });
    }
    return out;
  }, [runtime, knownUids]);

  if (!settings) return <div className="page">Loading…</div>;

  const persist = async (next: AppSettings) => {
    dispatch(setSettings(next));
    await api.saveSettings(next);
  };
  const setTeams = (next: Team[]) => persist({ ...settings, teams: next });

  const addTeam = () => setTeams([...teams, newTeam()]);
  const removeTeam = (id: string) => setTeams(teams.filter((t) => t.id !== id));
  const updateTeam = (id: string, patch: Partial<Team>) =>
    setTeams(teams.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const updatePlayer = (teamId: string, playerId: string, patch: Partial<TeamPlayer>) =>
    setTeams(
      teams.map((t) =>
        t.id === teamId
          ? { ...t, players: t.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)) }
          : t,
      ),
    );

  const copyUid = async (uid: string) => {
    await navigator.clipboard.writeText(uid);
    setCopied(uid);
    setTimeout(() => setCopied((c) => (c === uid ? null : c)), 1200);
  };

  const fetchPlayers = async () => {
    setFetching(true);
    setStatus(null);
    try {
      const players = await api.fetchPlayersFromDebugger();
      if (players.length === 0) {
        setStatus("No players found in the latest debugger file yet. Start/observe a match first.");
        return;
      }
      if (teams.length > 0 && !confirm(`Replace the current teams with ${players.length} fetched players?`)) {
        return;
      }
      await setTeams(buildTeams(players));
      setStatus(`Fetched ${players.length} player(s) into teams.`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="page animate-fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div className="page-title">Team Info</div>
          <div className="page-subtitle">
            Per-tournament teams — 4 main + 1 substitute. Resolves detected UIDs to players for Network Sync.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" onClick={fetchPlayers} disabled={fetching}>
            {fetching ? <span className="spinner" /> : <DownloadCloud size={16} />} Fetch Players
          </button>
          <button className="btn btn-primary" onClick={addTeam}><Plus size={16} /> Add Team</button>
        </div>
      </div>

      {status && (
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14, paddingLeft: 2 }}>{status}</div>
      )}

      {detected.length > 0 && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 18 }}>
          <div className="section-header">Detected UIDs — not in any team (click to copy)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {detected.map((d) => (
              <button key={d.uid} className="btn btn-ghost btn-sm" onClick={() => copyUid(d.uid)}>
                {copied === d.uid ? <Check size={13} /> : <Copy size={13} />} {d.name || "player"}
                <span style={{ opacity: 0.6 }}>{d.uid}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>No teams yet</div>
          <div style={{ fontSize: 12.5 }}>Use <b>Fetch Players</b> to build teams from the latest debugger file, or add one manually.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-accent" onClick={fetchPlayers} disabled={fetching}><DownloadCloud size={16} /> Fetch Players</button>
            <button className="btn btn-ghost" onClick={addTeam}><Plus size={16} /> Add Team</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {teams.map((t) => {
            const players = normalize(t.players);
            const mains = players.filter((p) => p.role !== "sub").slice(0, MAIN_COUNT);
            const sub = players.find((p) => p.role === "sub")!;
            const isCollapsed = collapsed.has(t.id);
            const filled = players.filter((p) => p.playerName.trim() || p.uid.trim()).length;
            return (
              <div key={t.id} className="glass-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: isCollapsed ? 0 : 14 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "6px 8px" }}
                    onClick={() => toggleCollapse(t.id)}
                    title={isCollapsed ? "Expand" : "Collapse"}
                  >
                    {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  </button>
                  <Shield size={18} color="#60a5fa" />
                  <input
                    className="input"
                    style={{ maxWidth: 280, fontWeight: 700 }}
                    placeholder="Team name"
                    value={t.name}
                    onChange={(e) => updateTeam(t.id, { name: e.target.value })}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {isCollapsed ? `${filled}/${TEAM_SIZE} filled` : `${TEAM_SIZE} players`}
                  </span>
                  <button className="btn btn-danger btn-sm" style={{ marginLeft: "auto" }} onClick={() => removeTeam(t.id)}>
                    <Trash2 size={13} /> Delete Team
                  </button>
                </div>

                {!isCollapsed && (
                  <div style={{ display: "grid", gridTemplateColumns: "108px 1.4fr 1.3fr 1.1fr", gap: 8 }}>
                    {["", "Player Name", "UID", "Player ID"].map((h, i) => (
                      <div key={i} style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", paddingBottom: 2 }}>{h}</div>
                    ))}
                    {mains.map((p, i) => (
                      <PlayerRow key={p.id} label={`Player ${i + 1}`} p={p} onChange={(patch) => updatePlayer(t.id, p.id, patch)} />
                    ))}
                    <PlayerRow label="Substitute" accent p={sub} onChange={(patch) => updatePlayer(t.id, sub.id, patch)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  label, p, accent, onChange,
}: {
  label: string;
  p: TeamPlayer;
  accent?: boolean;
  onChange: (patch: Partial<TeamPlayer>) => void;
}) {
  const cell = (key: keyof TeamPlayer, placeholder: string) => (
    <input
      className="input"
      style={{ padding: "8px 10px", fontSize: 12.5 }}
      placeholder={placeholder}
      value={p[key] as string}
      onChange={(e) => onChange({ [key]: e.target.value } as Partial<TeamPlayer>)}
    />
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, color: accent ? "#facc15" : "var(--text-secondary)" }}>
        {label}
      </div>
      {cell("playerName", "Player name")}
      {cell("uid", "UID")}
      {cell("playerId", "Player ID")}
    </>
  );
}
