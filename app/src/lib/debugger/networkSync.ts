// Network Sync transport.
//
// Connects this FaceCam instance to the FaceCam server's OCR bridge
// (server/src/media/ocr.handler.js) over Socket.io and relays detected
// observer switches in real time, resolved to database player ids.
//
// Auth: query-param handshake (?ocrKey=&tournamentId=&sourceId=), validated
// synchronously by the server on connect — the same path localized-input's
// Rust app uses, chosen there because it's more reliable than an ack-based
// event handshake. Events: ocrAuthSuccess / ocrAuthFailed / srcOcrConflict on
// the way in, playerDetected / noMatch on the way out.

import { io, type Socket } from "socket.io-client";
import type {
  AppSettings,
  NetworkSyncConfig,
  ObserverUpdate,
  Team,
} from "./types";
import { store } from "../../store/store";
import { api } from "./api";
import {
  addNetworkSyncLog,
  setNetworkSyncConnected,
  setNetworkSyncAuthenticated,
  setDbPlayers,
  resolveDbPlayerId,
} from "../../store/observerSlice";

/** How long to wait for ocrAuthSuccess before treating the connection as
 *  failed. The query-param auth path does nothing on a bad tournament id
 *  rather than emitting a rejection, so a hang here needs its own timeout —
 *  mirrors the 15s timeout localized-input's Rust side uses for the same
 *  reason. */
const AUTH_TIMEOUT_MS = 15_000;

type Resolved = { team: string | null; playerName: string | null };

/** Resolve a uid against the Team Info roster — log/display enrichment only,
 *  does not feed the network payload (that resolves by name against the
 *  database player cache, independent of whether the roster is complete). */
function resolveRoster(uid: string | null, teams: Team[]): Resolved {
  if (!uid) return { team: null, playerName: null };
  for (const t of teams) {
    for (const p of t.players) {
      if (p.uid === uid) {
        return {
          team: t.name || null,
          playerName: p.playerName || null,
        };
      }
    }
  }
  return { team: null, playerName: null };
}

/** Basic URL validation used by the page and before connecting. */
export function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    // Accept http(s) and ws(s).
    const u = new URL(value.trim());
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol);
  } catch {
    return false;
  }
}

/** Validate a config; returns an error string or null when OK. */
export function validateConfig(cfg: NetworkSyncConfig): string | null {
  if (!isValidUrl(cfg.socketUrl)) return "Socket.io URL is not a valid URL.";
  if (!isValidUrl(cfg.apiBaseUrl)) return "API Base URL is not a valid URL.";
  if (!cfg.tournamentId.trim()) return "Tournament ID is required.";
  if (!cfg.secretKey.trim()) return "Secret Key is required.";
  return null;
}

export function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export class NetworkSyncManager {
  private socket: Socket | null = null;
  private config: NetworkSyncConfig | null = null;
  private teams: Team[] = [];
  private lastSig = new Map<string, string>();
  private authTimer: ReturnType<typeof setTimeout> | null = null;

  private status(connected: boolean) {
    store.dispatch(setNetworkSyncConnected(connected));
  }

  private authenticated(value: boolean) {
    store.dispatch(setNetworkSyncAuthenticated(value));
  }

  private log(level: "info" | "success" | "error", message: string) {
    store.dispatch(addNetworkSyncLog({ time: nowTime(), level, message }));
  }

  private clearAuthTimer() {
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
  }

  /** Update the roster used to enrich log/display output. */
  setTeams(teams: Team[]) {
    this.teams = teams;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  get authenticatedNow(): boolean {
    return store.getState().observer.networkSyncAuthenticated;
  }

  /** Open the Socket.io connection for a given source slot. Validates config
   *  first. `sourceId` is always included — every real deployment is one
   *  observer PC permanently paired to one output slot. */
  connect(config: NetworkSyncConfig, sourceId: string): string | null {
    const err = validateConfig(config);
    if (err) {
      this.log("error", err);
      return err;
    }
    this.disconnect("Reconnecting — closing previous connection first");
    this.config = config;
    this.lastSig.clear();

    this.log("info", `Connecting to ${config.socketUrl} — Source ${sourceId}…`);
    const socket = io(config.socketUrl, {
      transports: ["websocket"],
      reconnection: true,
      query: {
        ocrKey: config.secretKey,
        tournamentId: config.tournamentId,
        sourceId,
      },
    });

    this.clearAuthTimer();
    this.authTimer = setTimeout(() => {
      if (!this.authenticatedNow) {
        this.log(
          "error",
          "Auth timed out — server did not respond within 15s. Check the secret key and tournament ID.",
        );
        this.disconnect("Connection closed — auth timeout");
      }
    }, AUTH_TIMEOUT_MS);

    socket.on("connect", () => {
      this.status(true);
      this.log("info", "Socket connected — waiting for authentication…");
    });
    socket.on("disconnect", (reason) => {
      this.status(false);
      this.log("info", `Disconnected: ${reason}`);
    });
    socket.on("connect_error", (e) => {
      this.status(false);
      // Never echo the secret; e.message is server-provided.
      const msg = e?.message ?? "connection error";
      const auth = /auth|unauthor|forbidden|token/i.test(msg);
      this.log(
        "error",
        auth ? `Auth failed: ${msg}` : `Connection error: ${msg}`,
      );
    });
    socket.on(
      "ocrAuthSuccess",
      (data: { isSourceMode: boolean; sourceId: string | null }) => {
        this.clearAuthTimer();
        this.authenticated(true);
        this.lastSig.clear();
        const mode = data.isSourceMode
          ? `source mode (Source ${data.sourceId})`
          : "global mode";
        this.log("success", `Authenticated — ${mode}`);

        // Replay the currently-known observer state, if any, once the
        // database roster is available. The debugger watcher only emits
        // observer_update on a NEW switch, never on a timer — so if a
        // switch already happened (or was already active) before this
        // connection finished authenticating, handle() dropped it silently
        // (correctly — auth wasn't confirmed yet) and nothing else would
        // ever resend it. Without this replay, the server (and therefore
        // the output page) could sit on the wrong player until the next
        // real in-game switch.
        // Reads the authoritative state from the Rust backend rather than
        // Redux: on Start the watcher runs on its own thread and has to read
        // and parse the whole debugger file, which takes noticeably longer
        // than the socket takes to authenticate on a LAN. Redux is therefore
        // still empty at this point (Stop cleared it), so a Redux-only replay
        // silently found nothing and gave up forever. Retries briefly to
        // cover exactly that window — whichever finishes first, the current
        // detection always gets sent.
        const replayCurrentState = async () => {
          const attemptDelaysMs = [0, 150, 400, 800, 1500, 2500];
          for (const delay of attemptDelaysMs) {
            if (delay) await new Promise((r) => setTimeout(r, delay));
            // Bail out if the connection dropped or a newer one replaced it.
            if (!this.socket?.connected || !this.authenticatedNow) return;
            // A real switch arriving on its own already sent it — nothing
            // left to replay.
            if (this.lastSig.size > 0) return;

            const observerId = store.getState().observer.observers[0]?.id;
            if (!observerId) continue;

            let states: ObserverUpdate[] = [];
            try {
              states = await api.getObserverStates();
            } catch {
              continue;
            }
            const rt = states.find((s) => s.observerId === observerId);
            if (rt?.currentObserver) {
              this.log("info", "Replaying current detection after connect");
              this.handle({
                ...rt,
                lastHeartbeatAt: rt.lastHeartbeatAt ?? nowTime(),
              });
              return;
            }
          }
          this.log(
            "info",
            "No detection to replay yet — waiting for the next observer switch",
          );
        };

        // Auto-fetch the database roster if it isn't cached yet, mirroring
        // localized-input's auto-fetch-on-start — one fetch per session,
        // not one per detection. This only feeds switch-time matching
        // (dbPlayers); Team Info's own roster is never built automatically —
        // that only ever happens via an explicit Fetch Players click on that
        // page. The replay above must wait for this to settle first — on a
        // fresh start dbPlayers is empty, and resolving the replay against
        // an empty cache would send a false noMatch for a player who
        // actually has a database match.
        if (store.getState().observer.dbPlayers.length === 0) {
          api
            .fetchPlayersFromServer()
            .then((players) => {
              store.dispatch(setDbPlayers(players));
              this.log(
                "success",
                `Auto-fetched ${players.length} players from database`,
              );
            })
            .catch((e) => {
              this.log(
                "error",
                `Database auto-fetch failed: ${String(e)} — use Fetch Players in Team Info`,
              );
            })
            .finally(replayCurrentState);
        } else {
          replayCurrentState();
        }
      },
    );
    socket.on("ocrAuthFailed", (data: { message?: string }) => {
      this.clearAuthTimer();
      this.authenticated(false);
      this.log("error", `Auth rejected: ${data?.message ?? "unknown reason"}`);
    });
    socket.on("srcOcrConflict", (data: { chanId: string }) => {
      // Non-blocking — the server always lets this connection take over the
      // slot. A single flash right after (re)connect is expected (a
      // just-stopped instance's socket hasn't timed out server-side yet); if
      // it recurs, a second live instance is genuinely on this slot.
      this.log(
        "error",
        `Another OCR app is already connected to ${data.chanId} — if this persists, check the other PC's slot.`,
      );
    });

    this.socket = socket;
    return null;
  }

  /** `reason` is logged only when there was actually a live socket to tear
   *  down — calling disconnect() when already disconnected stays silent, so
   *  the log isn't spammed on every redundant call. Every caller (explicit
   *  Stop, the manual test button, an auth timeout, connect()'s own
   *  tear-down-before-reconnect, app shutdown) passes its own reason so a
   *  drop is never a silent mystery in the Live Log. */
  disconnect(reason = "Disconnected") {
    this.clearAuthTimer();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.status(false);
      this.log("info", reason);
    }
  }

  /** Forward an observer switch to the server, resolved to a database player
   *  id (deduped by changed uid/name). Only sends once authenticated. */
  handle(update: ObserverUpdate) {
    // Every path below logs its outcome. A detection silently going nowhere
    // is the single hardest thing to diagnose during a live event — "nothing
    // in the log" must always mean "the watcher never saw a switch", never
    // "it saw one and quietly dropped it here".
    const co = update.currentObserver;
    const who = co ? (co.name ?? co.uid ?? "unknown") : null;

    if (!this.socket?.connected || !this.config) {
      if (who) this.log("info", `Detected ${who} — not sent (not connected)`);
      return;
    }
    if (!this.authenticatedNow) {
      this.log(
        "info",
        `Detected ${who ?? "a switch"} — not sent (waiting for authentication)`,
      );
      return;
    }
    if (!co) {
      this.log("info", "Observer cleared — nothing to send");
      return;
    }
    if (!co.uid && !co.name) {
      this.log(
        "error",
        "Switch detected but the debugger line had no uid or name — nothing to match on",
      );
      return;
    }

    const sig = `${co.uid ?? ""}|${co.name ?? ""}`;
    if (this.lastSig.get(update.observerId) === sig) {
      this.log("info", `${who} already sent — skipped (no change)`);
      return;
    }
    this.lastSig.set(update.observerId, sig);

    // Two-tier resolution: uid first (exact, can't drift), name only as a
    // fallback when uid is missing from this log line or isn't in the
    // roster — the game's display name and the database's registered name
    // are known to diverge, so name is never checked first.
    const dbPlayers = store.getState().observer.dbPlayers;
    const { id: dbId, via: viaTier } = resolveDbPlayerId(co, dbPlayers);
    const via = viaTier === "name" ? "name fallback" : viaTier;

    // Log-only enrichment (team/playerName), independent of the resolution above.
    const { team, playerName } = resolveRoster(co.uid, this.teams);

    if (dbId) {
      this.socket.emit("playerDetected", { playerId: dbId });
      this.log(
        "success",
        `Sent playerDetected ${co.name ?? co.uid} → ${dbId} (via ${via})${playerName ? ` — ${team ?? "—"}` : ""}`,
      );
    } else {
      this.socket.emit("noMatch", {});
      this.log(
        "info",
        `No database match for "${co.name ?? co.uid}" (uid: ${co.uid ?? "—"}) — sent noMatch. Run Fetch Players if this is a real player.`,
      );
    }
  }
}

/** Shared singleton used by both the bootstrap wiring and the Network Sync page. */
export const networkSync = new NetworkSyncManager();

/** Pull the active NetworkSyncConfig out of settings. */
export function configFromSettings(settings: AppSettings): NetworkSyncConfig {
  return settings.networkSync;
}
