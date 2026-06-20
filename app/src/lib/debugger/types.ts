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

export type ObserverConnectionType =
  | "local"
  | "network_share"
  | "remote_agent"
  | "cloud_relay";

export type ObserverConfig = {
  id: string;
  displayName: string;
  type: ObserverConnectionType;
  enabled: boolean;
  localDebuggerPath?: string;
  networkSharePath?: string;
  remoteHost?: string;
  remotePort?: number;
  authToken?: string;
  createdAt: string;
  updatedAt: string;
};

export type ObserverStatus =
  | "connected"
  | "watching"
  | "waiting"
  | "error"
  | "disabled";

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

export type UiPreferences = {
  animations: boolean;
  compactCards: boolean;
};

export type VmixSendMode = "uid" | "name" | "disabled";

export type ObserverVmixConfig = {
  observerId: string;
  sendMode: VmixSendMode;
  sourceName: string;
  layer: number;
};

export type VmixConfig = {
  ip: string;
  port: number;
  observers: ObserverVmixConfig[];
};

export type VmixStatus = {
  connected: boolean;
  ip: string;
  port: number;
};

export type VmixLogEntry = {
  time: string;
  level: "info" | "success" | "error";
  message: string;
};

export type PlayerRole = "main" | "sub";

export type TeamPlayer = {
  id: string;
  playerName: string;
  uid: string;
  playerId: string;
  role: PlayerRole;
};

export type FetchedPlayer = {
  uid: string;
  name: string;
  playerId: string;
};

export type Team = {
  id: string;
  name: string;
  players: TeamPlayer[];
};

export type AppSettings = {
  debuggerFolder?: string;
  observers: ObserverConfig[];
  lastSelectedObserver?: string;
  debugLogging: boolean;
  ui: UiPreferences;
  vmix: VmixConfig;
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

export type DiscoveredAgent = {
  agentId: string;
  machineName: string;
  host: string;
  wsPort: number;
  token: string | null;
  status: string | null;
};

export const CONNECTION_TYPE_LABELS: Record<ObserverConnectionType, string> = {
  local: "Local PC",
  network_share: "Network Share",
  remote_agent: "Remote Agent",
  cloud_relay: "Cloud Relay",
};

export const STATUS_LABELS: Record<ObserverStatus, string> = {
  connected: "Connected",
  watching: "Watching",
  waiting: "Waiting",
  error: "Error",
  disabled: "Disabled",
};
