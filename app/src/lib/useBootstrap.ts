// App bootstrap: load settings, subscribe to backend events, start local
// watches, and push detected observer switches to the central server via the
// Network Sync bridge.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./debugger/api";
import { networkSync } from "./debugger/networkSync";
import type { ObserverUpdate } from "./debugger/types";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  applyObserverUpdate,
  setSettings,
  setVersion,
} from "../store/observerSlice";

export function useBootstrap() {
  const dispatch = useAppDispatch();
  const teams = useAppSelector((s) => s.observer.settings?.teams);

  // Keep the roster used for payload enrichment up to date.
  useEffect(() => {
    networkSync.setTeams(teams ?? []);
  }, [teams]);

  // Network Sync connect/disconnect is NOT triggered here — it's tied to the
  // Dashboard Start/Stop button (see Dashboard.tsx's startStop/toggleEnabled),
  // same "one button = go live" lifecycle localized-input's start_ocr/stop_ocr
  // uses. Auto-connecting at app launch would let a dedicated broadcast PC
  // claim its source slot before the operator is actually ready to observe.

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    (async () => {
      // 1. Backend event listeners.
      unlisteners.push(
        await listen<ObserverUpdate>("observer_update", (e) => {
          dispatch(applyObserverUpdate(e.payload));
          networkSync.handle(e.payload);
        }),
      );

      if (disposed) return;

      // 2. Load persisted settings + version.
      try {
        const [settings, version] = await Promise.all([
          api.loadSettings(),
          api.appVersion(),
        ]);
        dispatch(setSettings(settings));
        dispatch(setVersion(version));
        networkSync.setTeams(settings.teams ?? []);

        // 3. Hydrate any existing runtime snapshots.
        const states = await api.getObserverStates();
        for (const s of states) dispatch(applyObserverUpdate(s));

        // 4. Start local watches.
        await api.startAllObservers();
      } catch (err) {
        console.error("Bootstrap failed:", err);
      }
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
      networkSync.disconnect();
    };
  }, [dispatch]);
}
