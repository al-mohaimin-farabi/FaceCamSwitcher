# Efinity FaceCam — PCOB Debugger Observer Utility

A polished, public-ready observer utility for Free Fire esports broadcasts. It
reads the Free Fire PC client's **PCOB debugger files**, parses observer/player
log lines into clean structured state, supports **multiple local observers**, and
pushes detected switches to a central server via **Network Sync**, all in a
professional dark broadcast UI.

Built with **Tauri v2** (Rust backend + React/TypeScript frontend).

---

## What it does

1. Detects the Free Fire debugger folder
   (`…\Free Fire_64_Data\Debugger`) by scanning **every drive**, with manual
   fallback.
2. Always watches the **latest** debugger file and switches automatically when
   the client rotates to a new one.
3. Parses lines like:
   ```txt
   [InitTrackingPlayer] 16777217 -> noth3llfire
   @UIHudPlayerRemainingInfoController OnSwitchObserver 14524251948
   ```
   into normalized state:
   ```json
   {
     "uid": null,
     "name": "noth3llfire",
     "playerId": "16777217",
     "rawObserverValue": "16777217",
     "sourceFile": "debugger_2026_06_20.log",
     "updatedAt": "2026-06-20T10:30:00.000Z"
   }
   ```
4. Streams live updates to the UI, manages a per-tournament **team roster**, and
   pushes the active player to a central server over **Network Sync** (Socket.io).

If a field cannot be confidently resolved from the logs it stays `null` — the
parser never guesses.

---

## Architecture

```
FaceCam/
├── app/
│   ├── src/                          # React frontend (display only)
│   │   ├── lib/debugger/
│   │   │   ├── types.ts              # Shared TS types (mirror Rust serde)
│   │   │   ├── api.ts                # Typed Tauri command wrappers
│   │   │   └── networkSync.ts        # Socket.io client → central server bridge
│   │   ├── lib/useBootstrap.ts       # App init: settings, events, watches
│   │   ├── store/observerSlice.ts    # Redux state (settings + runtime)
│   │   ├── pages/                    # Dashboard, TeamInfo, NetworkSync
│   │   └── components/               # StatusBadge, ObserverModal
│   │
│   └── src-tauri/src/
│       ├── debugger/
│       │   ├── detector.rs           # Folder detection + latest-file resolver
│       │   ├── watcher.rs            # notify-based folder watch + incremental read
│       │   ├── parser.rs             # Log-line → normalized state (extensible)
│       │   └── state.rs              # CurrentObserverState / ObserverUpdate
│       └── lib.rs                    # Settings, observer CRUD, teams, watch control
└── README.md
```

**Data-flow rules (enforced):** the backend owns filesystem access, the parser
owns raw log interpretation, the frontend only displays. UI never parses raw
debugger lines; events between backend and frontend are typed.

---

## Prerequisites

- **Node.js** ≥ 18
- **Rust** stable — install via [rustup.rs](https://rustup.rs)
- **MSVC Build Tools** (C++ workload) — required to compile the Rust backend on
  Windows. Install with:
  `winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools"`

No ONNX models or DirectML are needed anymore.

---

## Setup & Run

```bash
cd app
npm install
npm run tauri dev      # dev mode (Vite + Tauri window)
```

On first launch the app auto-detects the debugger folder and seeds a default
local observer ("This PC"). Use the **Debugger Source** panel on the Dashboard
(**Auto-detect** scans every drive, or **Browse…**) if detection needs help.

---

## Build & Package

```bash
cd app
npm run tauri build    # frontend bundle + release Rust build + NSIS installer
```

Installer output: `app/src-tauri/target/release/bundle/nsis/FaceCam_0.2.0_x64-setup.exe`

---

## Testing

| Suite | Command | Covers |
|-------|---------|--------|
| Rust unit + integration | `cd app/src-tauri && cargo test` | parser, detector, watcher, fixtures |
| Frontend typecheck/build | `cd app && npm run build` | TS types + bundle |

Sample fixtures live in `app/src-tauri/tests/fixtures/`.

---

## Tauri Commands (IPC surface)

| Command | Purpose |
|---------|---------|
| `load_settings` / `save_settings` | Persisted settings (observers, folder, UI prefs) |
| `detect_debugger_folder` | Auto-detect + candidate paths |
| `validate_debugger_folder` / `set_debugger_folder` | Validate / save folder |
| `list_observers` / `upsert_observer` / `delete_observer` | Observer CRUD |
| `start_observer` / `stop_observer` / `start_all_observers` / `stop_all_observers` | Watch control |
| `get_observer_states` | Runtime snapshot |
| `fetch_players_from_debugger` | Parse latest file → players (auto-build Team Info) |
| `app_version` | App version |

**Events:** `observer_update` → `ObserverUpdate { … }`.

### Team Info

**Team Info** is the per-tournament roster — teams of **4 main + 1 substitute**
(team name, player name, UID, player ID). **Fetch Players** auto-builds it from
the latest debugger file (grouped by squad), or add teams manually. The roster is
used to enrich the **Network Sync** payload with team/player names.

---

## Network Sync

The main app watches **local** debugger folders directly (Rust) and pushes every
detected observer switch to a central server in real time over **Socket.io**.
Configure it under the **Network Sync** section:

- **Network Sync Enabled** — auto-connects via Socket.io when observing starts.
- **API Base URL** (e.g. `https://facecamapi.ecube.gg`) — used by **Test
  Connection** and HTTP setup.
- **Socket.io URL** (e.g. `wss://facecamapi.ecube.gg`) — the realtime channel.
- **Tournament ID** and a masked **Secret Key** (sent in the Socket.io auth
  handshake; never written to the live log or diagnostics).
- **Connect / Disconnect / Test Connection** plus a scrollable **live log**.

On each switch (deduped per observer) the app emits an `observer:update` event
with `{ tournamentId, observerId, uid, name, playerId, team, playerName,
updatedAt }` — `team`/`playerName` resolved against the Team Info roster. The
server contract (event name + auth keys) is isolated in `PROTOCOL` inside
[`networkSync.ts`](app/src/lib/debugger/networkSync.ts) so it's easy to adjust.

---

## Notes

- Incremental reads only — the watcher remembers a byte offset and never
  re-reads whole files; it resets on rotation/truncation.
- Locked files (held by the game) are retried on the next tick without freezing
  the UI.
- Settings persist to `%APPDATA%\EfinityFaceCam\settings.json`.
