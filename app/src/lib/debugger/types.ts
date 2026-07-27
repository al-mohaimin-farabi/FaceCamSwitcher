// Shared types for the PCOB debugger observer system.
// These mirror the Rust serde models (camelCase on the wire).

export type CurrentObserverState = {
  uid: string | null;
  name: string | null;
  playerId: string | null;
  rawObserverValue?: string;
  sourceFile: string;
  updatedAt: string;
};

export type ObserverConnectionType = "local";

export type ObserverConfig = {
  id: string;
  displayName: string;
  type: ObserverConnectionType;
  enabled: boolean;
  localDebuggerPath?: string;
  /** Which vMix output slot ("01"/"02"/"03") this PC's detections report into. */
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

export type ObserverStatus =
  "connected" | "watching" | "waiting" | "error" | "disabled";

export type ObserverRuntimeState = {
  observerId: string;
  status: ObserverStatus;
  currentObserver: CurrentObserverState | null;
  lastMessage?: string;
  lastHeartbeatAt?: string;
};

/** Event payload emitted by the Rust backend on `observer_update`. */
export type ObserverUpdate = {
  observerId: string;
  status: ObserverStatus;
  currentObserver: CurrentObserverState | null;
  lastMessage?: string;
  lastHeartbeatAt: string;
};

export type PlayerRole = "main" | "sub";

export type TeamPlayer = {
  id: string;
  playerName: string;
  uid: string;
  playerId: string;
  role: PlayerRole;
  /** Resolved database player id (matched by name) — QA visibility only,
   *  not used for switch-time resolution. */
  dbPlayerId?: string;
};

/** A player as recorded in the FaceCam tournament database — the single
 *  source Team Info's roster is built from (uid resolves live switches,
 *  teamId/teamName group players into the tournament's real teams). */
export type DbPlayer = {
  id: string;
  ign: string;
  uid: string;
  /** False for a registered substitute — no stream key, can never actually
   *  go live on the output page regardless of whether they're detected. */
  isActive: boolean;
  playerNumber?: number | null;
  teamId: string;
  teamName: string;
};

export type Team = {
  id: string;
  name: string;
  players: TeamPlayer[];
};

export type NetworkSyncConfig = {
  apiBaseUrl: string;
  socketUrl: string;
  tournamentId: string;
  secretKey: string;
};

export type NetworkSyncLogEntry = {
  time: string;
  level: "info" | "success" | "error";
  message: string;
};

export type AppSettings = {
  debuggerFolder?: string;
  observers: ObserverConfig[];
  networkSync: NetworkSyncConfig;
  teams: Team[];
};

export type FolderValidation = {
  path: string;
  exists: boolean;
  readable: boolean;
  hasLogFiles: boolean;
  valid: boolean;
  fileCount: number;
};

export type DetectionResult = {
  detected: string | null;
  candidates: string[];
};

export const CONNECTION_TYPE_LABELS: Record<ObserverConnectionType, string> = {
  local: "Local PC",
};

export const STATUS_LABELS: Record<ObserverStatus, string> = {
  connected: "Connected",
  watching: "Watching",
  waiting: "Waiting",
  error: "Error",
  disabled: "Disabled",
};
