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

  // Neither the local debugger watcher nor Network Sync is auto-started here
  // — both are tied to the Dashboard Start/Stop button (see Dashboard.tsx's
  // startStop), same "one button = go live" lifecycle localized-input's
  // start_ocr/stop_ocr uses. Auto-starting the watcher at launch would
  // immediately re-tail whatever debugger log is already on disk — e.g. a
  // finished match from a previous session — and surface its last line as
  // "current" with a live timestamp, before the operator has done anything.
  // The app should open idle every time.

  // Block Ctrl+R — WebView2 maps it to a full page reload by default, which
  // would drop the live Network Sync connection and local watcher mid-show.
  // There's no Tauri config toggle for this; intercepting the key event is
  // the standard way to disable a browser-native accelerator in a WebView.
  useEffect(() => {
    const blockReload = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "r") e.preventDefault();
    };
    window.addEventListener("keydown", blockReload);
    return () => window.removeEventListener("keydown", blockReload);
  }, []);

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

        // 3. Hydrate any existing runtime snapshots — only relevant if the
        // Rust backend is still alive from before this webview mounted
        // (e.g. a dev-mode webview reload while genuinely observing), since
        // stop_observer/stop_all_observers clear this on Stop and a full
        // app relaunch always starts with an empty backend runtime map.
        const states = await api.getObserverStates();
        for (const s of states) dispatch(applyObserverUpdate(s));
      } catch (err) {
        console.error("Bootstrap failed:", err);
      }
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
      networkSync.disconnect("App closing");
    };
  }, [dispatch]);
}
