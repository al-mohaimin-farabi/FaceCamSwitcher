// Network Sync transport (spec §4).
//
// Connects this FaceCam instance to the central server over Socket.io and
// pushes detected observer switches in real time. Replaces the old per-PC
// remote/peer model with a single central bridge.
//
// The exact Socket.io event names and auth shape must match the
// `facecamapi.ecube.gg` server. They are isolated in PROTOCOL below so they are
// trivial to adjust in one place if the server contract changes.

import { io, type Socket } from "socket.io-client";
import type {
  AppSettings,
  NetworkSyncConfig,
  ObserverUpdate,
  Team,
} from "./types";
import { store } from "../../store/store";
import {
  addNetworkSyncLog,
  setNetworkSyncConnected,
} from "../../store/observerSlice";

/** Server contract — adjust here if the server protocol differs. */
export const PROTOCOL = {
  /** Event emitted for each observer switch. */
  observerUpdateEvent: "observer:update",
  /** Auth handshake keys. */
  authTokenKey: "token" as const,
  authTournamentKey: "tournamentId" as const,
};

type Resolved = { team: string | null; playerName: string | null };

/** Resolve a uid against the Team Info roster (spec §4.4). */
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

  private status(connected: boolean) {
    store.dispatch(setNetworkSyncConnected(connected));
  }

  private log(level: "info" | "success" | "error", message: string) {
    store.dispatch(addNetworkSyncLog({ time: nowTime(), level, message }));
  }

  /** Update the roster used to enrich payloads. */
  setTeams(teams: Team[]) {
    this.teams = teams;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** Open the Socket.io connection. Validates config first. */
  connect(config: NetworkSyncConfig): string | null {
    const err = validateConfig(config);
    if (err) {
      this.log("error", err);
      return err;
    }
    this.disconnect();
    this.config = config;
    this.lastSig.clear();

    this.log("info", `Connecting to ${config.socketUrl}…`);
    const socket = io(config.socketUrl, {
      transports: ["websocket"],
      reconnection: true,
      auth: {
        [PROTOCOL.authTokenKey]: config.secretKey,
        [PROTOCOL.authTournamentKey]: config.tournamentId,
      },
    });

    socket.on("connect", () => {
      this.status(true);
      this.log("success", "Connected to server.");
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

    this.socket = socket;
    return null;
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.status(false);
    }
  }

  /** Forward an observer switch to the server (deduped by changed value). */
  handle(update: ObserverUpdate) {
    if (!this.socket?.connected || !this.config) return;
    const co = update.currentObserver;
    if (!co) return;
    if (!co.uid && !co.name) return;

    const sig = `${co.uid ?? ""}|${co.name ?? ""}`;
    if (this.lastSig.get(update.observerId) === sig) return;
    this.lastSig.set(update.observerId, sig);

    const { team, playerName } = resolveRoster(co.uid, this.teams);
    const payload = {
      tournamentId: this.config.tournamentId,
      observerId: update.observerId,
      uid: co.uid,
      name: co.name,
      playerId: co.playerId,
      team,
      playerName,
      updatedAt: co.updatedAt,
    };

    this.socket.emit(PROTOCOL.observerUpdateEvent, payload);
    // Log UID/name only — never the secret.
    this.log("success", `Sent ${co.uid ?? "—"} (${co.name ?? "—"})`);
  }
}

/** Shared singleton used by both the bootstrap wiring and the Network Sync page. */
export const networkSync = new NetworkSyncManager();

/** Test reachability/auth against the HTTP API (spec §4.3). */
export async function testConnection(cfg: NetworkSyncConfig): Promise<string> {
  const err = validateConfig(cfg);
  if (err) throw new Error(err);
  const base = cfg.apiBaseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/health`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.secretKey}` },
  });
  if (!res.ok) {
    throw new Error(`Server responded ${res.status} ${res.statusText}`);
  }
  return `Server reachable (HTTP ${res.status}).`;
}

/** Pull the active NetworkSyncConfig out of settings. */
export function configFromSettings(settings: AppSettings): NetworkSyncConfig {
  return settings.networkSync;
}
