// Sends resolved observer switches to vMix over TCP (via the Rust backend).
//
// Runs on the frontend so it covers BOTH local and remote observers uniformly.
// The TCP connection + per-observer config lookup live in Rust; this just
// forwards on change. De-duplicated so we only send when the value changes.

import { api } from "./api";
import type { ObserverUpdate } from "./types";

export class VmixDispatcher {
  private connected = false;
  private lastSig = new Map<string, string>();

  setConnected(connected: boolean) {
    this.connected = connected;
    if (!connected) this.lastSig.clear();
  }

  handle(update: ObserverUpdate) {
    if (!this.connected) return;
    const co = update.currentObserver;
    if (!co) return;
    if (!co.uid && !co.name) return;

    const sig = `${co.uid ?? ""}|${co.name ?? ""}`;
    if (this.lastSig.get(update.observerId) === sig) return;
    this.lastSig.set(update.observerId, sig);

    // Backend decides (per-observer mode) whether to actually send.
    api.vmixSendObserver(update.observerId, co).catch(() => {});
  }
}
