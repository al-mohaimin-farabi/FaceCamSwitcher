// Remote observer transport (spec §8.1, §12).
//
// Local observers are watched by the Rust backend. Remote observers run a
// lightweight companion agent (see /remote-agent) that watches that PC's
// debugger folder and pushes normalized updates over WebSocket. The main app
// connects out to each agent — there is no inbound server here, so there is no
// unauthenticated open port. Auth is a per-agent token.

import type {
  CurrentObserverState,
  ObserverConfig,
  ObserverStatus,
  ObserverUpdate,
} from "./types";

type UpdateHandler = (update: ObserverUpdate) => void;

const RECONNECT_DELAY_MS = 4000;
// Agents send a keepalive every ~5s; tolerate a few misses before flagging.
const HEARTBEAT_TIMEOUT_MS = 20000;

/** Validate an incoming remote payload before trusting it (spec §12). */
function isValidPayload(data: unknown): data is {
  observerId?: string;
  machineName?: string;
  currentObserver: CurrentObserverState | null;
  status: ObserverStatus;
} {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  const statusOk =
    typeof d.status === "string" &&
    ["connected", "watching", "waiting", "error", "disabled"].includes(d.status);
  const co = d.currentObserver;
  const coOk =
    co === null ||
    (typeof co === "object" &&
      co !== null &&
      "sourceFile" in co &&
      "updatedAt" in co);
  return statusOk && coOk;
}

class RemoteConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly config: ObserverConfig;
  private readonly onUpdate: UpdateHandler;

  constructor(config: ObserverConfig, onUpdate: UpdateHandler) {
    this.config = config;
    this.onUpdate = onUpdate;
  }

  private url(): string {
    const host = this.config.remoteHost ?? "127.0.0.1";
    const port = this.config.remotePort ?? 8787;
    const token = this.config.authToken
      ? `?token=${encodeURIComponent(this.config.authToken)}`
      : "";
    return `ws://${host}:${port}/observer${token}`;
  }

  private emit(status: ObserverStatus, currentObserver: CurrentObserverState | null, message?: string) {
    this.onUpdate({
      observerId: this.config.id,
      status,
      currentObserver,
      lastMessage: message,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  private resetHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.emit("error", null, "Remote observer heartbeat timed out");
    }, HEARTBEAT_TIMEOUT_MS);
  }

  connect() {
    this.closed = false;
    this.emit("waiting", null, `Connecting to ${this.config.remoteHost ?? "agent"}…`);
    try {
      this.ws = new WebSocket(this.url());
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.emit("watching", null, "Connected to remote agent");
      this.resetHeartbeat();
    };

    this.ws.onmessage = (ev) => {
      this.resetHeartbeat();
      try {
        const data = JSON.parse(ev.data as string);
        if (!isValidPayload(data)) {
          this.emit("error", null, "Received invalid payload from remote agent");
          return;
        }
        this.emit(data.status, data.currentObserver, data.machineName);
      } catch {
        this.emit("error", null, "Failed to parse remote payload");
      }
    };

    this.ws.onerror = () => {
      this.emit("error", null, "Remote connection error");
    };

    this.ws.onclose = () => {
      if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
      if (!this.closed) {
        this.emit("waiting", null, "Disconnected — retrying…");
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.closed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
  }
}

/** Manages WebSocket connections for all remote observers. */
export class RemoteObserverManager {
  private connections = new Map<string, RemoteConnection>();
  private readonly onUpdate: UpdateHandler;

  constructor(onUpdate: UpdateHandler) {
    this.onUpdate = onUpdate;
  }

  /** Reconcile the set of live connections with the configured observers. */
  sync(observers: ObserverConfig[]) {
    const remote = observers.filter(
      (o) => o.type === "remote_agent" || o.type === "cloud_relay",
    );
    const wanted = new Set(remote.filter((o) => o.enabled).map((o) => o.id));

    // Drop connections that are no longer wanted.
    for (const [id, conn] of this.connections) {
      if (!wanted.has(id)) {
        conn.close();
        this.connections.delete(id);
      }
    }

    // Open connections for newly-enabled remote observers.
    for (const cfg of remote) {
      if (cfg.enabled && !this.connections.has(cfg.id)) {
        const conn = new RemoteConnection(cfg, this.onUpdate);
        this.connections.set(cfg.id, conn);
        conn.connect();
      }
    }
  }

  closeAll() {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
  }
}
