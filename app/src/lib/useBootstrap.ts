// App bootstrap: load settings, subscribe to backend events, start local
// watches, manage remote WebSocket connections, and forward switches to vMix.

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./debugger/api";
import { RemoteObserverManager } from "./debugger/remoteClient";
import { VmixDispatcher } from "./debugger/vmixDispatcher";
import type { ObserverUpdate, VmixStatus } from "./debugger/types";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  addVmixLog,
  applyObserverUpdate,
  setSettings,
  setVersion,
  setVmixConnected,
} from "../store/observerSlice";

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export function useBootstrap() {
  const dispatch = useAppDispatch();
  const remoteRef = useRef<RemoteObserverManager | null>(null);
  const vmixRef = useRef<VmixDispatcher>(new VmixDispatcher());
  const observers = useAppSelector((s) => s.observer.observers);
  const vmixConnected = useAppSelector((s) => s.observer.vmixConnected);

  // Keep remote WebSocket connections in sync as observers are added/edited.
  useEffect(() => {
    remoteRef.current?.sync(observers);
  }, [observers]);

  // The dispatcher only sends to vMix while connected.
  useEffect(() => {
    vmixRef.current.setConnected(vmixConnected);
  }, [vmixConnected]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const remote = new RemoteObserverManager((update: ObserverUpdate) => {
      dispatch(applyObserverUpdate(update));
      vmixRef.current.handle(update);
    });
    remoteRef.current = remote;

    (async () => {
      // 1. Backend event listeners.
      unlisteners.push(
        await listen<ObserverUpdate>("observer_update", (e) => {
          dispatch(applyObserverUpdate(e.payload));
          vmixRef.current.handle(e.payload);
        }),
      );
      unlisteners.push(
        await listen<{ level: string; message: string }>("vmix_log", (e) => {
          dispatch(
            addVmixLog({
              time: nowTime(),
              level: (e.payload.level as never) ?? "info",
              message: e.payload.message,
            }),
          );
        }),
      );
      unlisteners.push(
        await listen<VmixStatus>("vmix_status", (e) => {
          dispatch(setVmixConnected(e.payload.connected));
        }),
      );

      if (disposed) return;

      // 2. Load persisted settings + version + vMix status.
      try {
        const [settings, version, vmixStatus] = await Promise.all([
          api.loadSettings(),
          api.appVersion(),
          api.vmixGetStatus(),
        ]);
        dispatch(setSettings(settings));
        dispatch(setVersion(version));
        dispatch(setVmixConnected(vmixStatus.connected));

        // 3. Hydrate any existing runtime snapshots.
        const states = await api.getObserverStates();
        for (const s of states) dispatch(applyObserverUpdate(s));

        // 4. Start local watches and connect remote agents.
        await api.startAllObservers();
        remote.sync(settings.observers);
      } catch (err) {
        console.error("Bootstrap failed:", err);
      }
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
      remoteRef.current?.closeAll();
    };
  }, [dispatch]);

  return remoteRef;
}
