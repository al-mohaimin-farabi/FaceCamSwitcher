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
  dbPlayerIdByIgn,
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

function nowTime() {
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
    this.disconnect();
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
        this.disconnect();
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

        // Auto-fetch the database roster if it isn't cached yet, mirroring
        // localized-input's auto-fetch-on-start — one fetch per session,
        // not one per detection. A manual refetch stays available via
        // TeamInfo's Fetch Players button.
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
            });
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

  disconnect() {
    this.clearAuthTimer();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.status(false);
    }
  }

  /** Forward an observer switch to the server, resolved to a database player
   *  id (deduped by changed uid/name). Only sends once authenticated. */
  handle(update: ObserverUpdate) {
    if (!this.socket?.connected || !this.config) return;
    if (!this.authenticatedNow) return;
    const co = update.currentObserver;
    if (!co) return;
    if (!co.uid && !co.name) return;

    const sig = `${co.uid ?? ""}|${co.name ?? ""}`;
    if (this.lastSig.get(update.observerId) === sig) return;
    this.lastSig.set(update.observerId, sig);

    const dbPlayers = store.getState().observer.dbPlayers;
    const dbId = co.name
      ? dbPlayerIdByIgn(dbPlayers).get(co.name.toLowerCase())
      : undefined;

    // Log-only enrichment (team/playerName), independent of the resolution above.
    const { team, playerName } = resolveRoster(co.uid, this.teams);

    if (dbId) {
      this.socket.emit("playerDetected", { playerId: dbId });
      this.log(
        "success",
        `Sent playerDetected ${co.name} → ${dbId}${playerName ? ` (${team ?? "—"})` : ""}`,
      );
    } else {
      this.socket.emit("noMatch");
      this.log(
        "info",
        `No database match for "${co.name ?? co.uid}" — sent noMatch. Run Fetch Players if this is a real player.`,
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
