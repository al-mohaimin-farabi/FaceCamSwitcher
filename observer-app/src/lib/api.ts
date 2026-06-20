import { invoke } from "@tauri-apps/api/core";

export type CurrentObserverState = {
  uid: string | null;
  name: string | null;
  playerId: string | null;
  rawObserverValue?: string;
  sourceFile: string;
  updatedAt: string;
};

export type ObserverStatus =
  | "connected"
  | "watching"
  | "waiting"
  | "error"
  | "disabled";

export type StatusSnapshot = {
  running: boolean;
  folder: string | null;
  port: number;
  discoveryPort: number;
  token: string;
  machineName: string;
  agentId: string;
  broadcastToken: boolean;
  status: ObserverStatus;
  lastMessage: string | null;
  currentObserver: CurrentObserverState | null;
  clientCount: number;
};

export type FolderValidation = {
  path: string;
  exists: boolean;
  readable: boolean;
  hasLogFiles: boolean;
  valid: boolean;
  fileCount: number;
};

type CommandResult = { success: boolean; message: string };

export const api = {
  getStatus: () => invoke<StatusSnapshot>("get_status"),
  validateFolder: (path: string) => invoke<FolderValidation>("validate_folder", { path }),
  setFolder: (path: string) => invoke<FolderValidation>("set_folder", { path }),
  setPort: (port: number) => invoke<CommandResult>("set_port", { port }),
  setMachineName: (name: string) => invoke<CommandResult>("set_machine_name", { name }),
  setBroadcastToken: (enabled: boolean) => invoke<CommandResult>("set_broadcast_token", { enabled }),
  regenerateToken: () => invoke<string>("regenerate_token"),
  startSharing: () => invoke<CommandResult>("start_sharing"),
  stopSharing: () => invoke<CommandResult>("stop_sharing"),
  listLocalIps: () => invoke<string[]>("list_local_ips"),
};
