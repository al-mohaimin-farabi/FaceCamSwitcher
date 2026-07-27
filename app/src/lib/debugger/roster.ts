// Builds Team Info's Team[] shape directly from the tournament database
// roster (replaces the old local-debugger-log-based build — the database
// already has real team names/grouping and the registered uid, no need to
// wait for a live match or guess squads from session-relative ids).

import type { DbPlayer, Team, TeamPlayer } from "./types";

const MAIN_COUNT = 4;

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toTeamPlayer(p: DbPlayer, role: TeamPlayer["role"]): TeamPlayer {
  return {
    id: rid("p"),
    playerName: p.ign,
    uid: p.uid,
    // "Player ID" shows the database id here — Free Fire's own internal
    // numeric id has no database equivalent and isn't useful to display.
    playerId: p.id,
    role,
    dbPlayerId: p.id,
  };
}

/** Group the database roster by team. Active players fill the 4 main slots;
 *  a substitute (isActive: false) fills the sub slot — included for roster
 *  visibility, but note it can never actually be switched to on the output
 *  page, since substitutes have no stream key in the database at all.
 *  Team Info's own `normalize()` still pads any still-missing slots at
 *  render time, same as it already does for manually-built teams.
 *
 *  Players with no `teamId` (bad/incomplete data) are dropped rather than
 *  silently grouped together under one fake "team" — that previously made
 *  an entire roster collapse into a single bogus 4-player team. */
export function buildTeamsFromDb(players: DbPlayer[]): Team[] {
  const groups = new Map<string, DbPlayer[]>();
  for (const p of players) {
    if (!p.teamId) continue;
    if (!groups.has(p.teamId)) groups.set(p.teamId, []);
    groups.get(p.teamId)!.push(p);
  }

  const teams: Team[] = [];
  for (const [teamId, ps] of groups) {
    const mains = ps.filter((p) => p.isActive).slice(0, MAIN_COUNT);
    const subs = ps.filter((p) => !p.isActive);
    const players: TeamPlayer[] = [
      ...mains.map((p) => toTeamPlayer(p, "main")),
      ...subs.map((p) => toTeamPlayer(p, "sub")),
    ];
    teams.push({ id: teamId, name: ps[0]?.teamName || "Team", players });
  }
  return teams;
}
