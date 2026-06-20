# Efinity FaceCam — PCOB Debugger Observer Utility

A polished, public-ready observer utility for Free Fire esports broadcasts. It
reads the Free Fire PC client's **PCOB debugger files**, parses observer/player
log lines into clean structured state, supports **multiple observers** (local and
remote), and presents everything in a professional dark broadcast UI.

Built with **Tauri v2** (Rust backend + React/TypeScript frontend).

---

## What it does

1. Detects the Free Fire debugger folder
   (`User Folder\Free Fire_64_Data\Debugger`), with manual fallback.
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
4. Streams live updates to the UI, supports 10+ observers via the companion
   **Observer app**, manages a per-tournament **team roster**, and routes the
   active player to **vMix** over TCP.

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
│   │   │   ├── remoteClient.ts       # WebSocket client for remote observers
│   │   │   └── vmixDispatcher.ts     # Forwards switches to vMix on change
│   │   ├── lib/useBootstrap.ts       # App init: settings, events, watches
│   │   ├── store/observerSlice.ts    # Redux state (settings + runtime)
│   │   ├── pages/                    # Dashboard, Observers, LiveFeed, Sources,
│   │   │                             #   TeamInfo, VmixPanel, AppSettings
│   │   └── components/               # StatusBadge, ObserverModal, ScanModal
│   │
│   └── src-tauri/src/
│       ├── debugger/
│       │   ├── detector.rs           # Folder detection + latest-file resolver
│       │   ├── watcher.rs            # notify-based folder watch + incremental read
│       │   ├── parser.rs             # Log-line → normalized state (extensible)
│       │   └── state.rs              # CurrentObserverState / ObserverUpdate
│       ├── vmix.rs                   # vMix TCP command builder + sender
│       └── lib.rs                    # Settings, observer CRUD, teams, vMix, watch control
│
├── observer-app/                     # Standalone GUI app for observer PCs
│   ├── src/                          #   single-screen React UI (folder/port/token/log)
│   └── src-tauri/src/
│       ├── debugger/                 #   shared engine (detector/watcher/parser/state)
│       ├── ws.rs                     #   token-auth WebSocket push server (tokio-tungstenite)
│       └── lib.rs                    #   config, watch→broadcast, UDP beacon, commands
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
local observer ("This PC"). Use **Debugger Source → Auto-detect** or **Browse…**
if detection needs help.

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
| Rust unit + integration | `cd app/src-tauri && cargo test` | parser, detector, watcher, vMix, fixtures |
| Frontend typecheck/build | `cd app && npm run build` | TS types + bundle |
| Observer app | `cd observer-app/src-tauri && cargo test` | WebSocket server + shared engine |

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
| `scan_observers` | LAN discovery of remote observer agents |
| `vmix_connect` / `vmix_disconnect` / `vmix_get_status` | vMix TCP connection |
| `vmix_test` | Send a test command to vMix |
| `vmix_send_observer` | Send an observer's UID/Name to vMix |
| `app_version` | App version |

**Events:** `observer_update` → `ObserverUpdate { … }`; `vmix_status` → `{ connected, ip, port }`; `vmix_log` → `{ level, message }`.

### Team Info & vMix Panel (TCP output)

**Team Info** is the per-tournament roster — teams of **4 main + 1 substitute**
(team name, player name, UID, player ID). **Fetch Players** auto-builds it from
the latest debugger file (grouped by squad), or add teams manually.

The **vMix Panel** sends each observer's detected **UID** or **Name** to vMix
over TCP. Configure the vMix **IP + TCP port** (default `127.0.0.1:8099`),
connect/disconnect/test, and set a per-observer mapping: **Send UID / Send Name /
Disabled**, plus a **Source Name** (the MultiView container input) and **Layer**.
On each switch the active player's input is routed onto that layer via
`SetMultiViewOverlay` and logged. A **safety net** verifies the target input
exists in vMix (cached input list) and logs a clear error if it doesn't. The
command builder ([`vmix.rs`](app/src-tauri/src/vmix.rs)) is isolated so the exact
vMix command can be tuned without touching the UI or observer logic.

---

## Multi-Observer & Remote PCs

The main app watches **local** folders directly (Rust). For other observer PCs,
run the **FaceCam Observer desktop app** ([`observer-app/`](observer-app/README.md))
— a small GUI where the observer picks their debugger folder and the port, sees
the live player, and gets a copy/regenerate token. It watches the debugger folder
and pushes normalized updates to the controller over an authenticated WebSocket,
and announces itself on the LAN.

**Zero-config pairing:** install/run the Observer app on the observer PC — it
auto-generates a token and announces itself on the LAN. In the controller, go to
**Observers → Scan** and click **Add** on the discovered PC (host/port/token
filled in automatically). Manual add (host + port + token) is also available.

Connection types supported in the data model: `local`, `network_share`,
`remote_agent`, `cloud_relay`. The **Observer app** (`remote_agent`) is the
recommended path for 10+ PCs — token-secured, heartbeat/health built in, and no
Windows-share permission pain.

---

## Observer App (`observer-app/`)

A small standalone Tauri desktop app installed on **each remote observer PC**. It
reuses the exact same debugger engine as the controller, watches that machine's
debugger folder, and streams normalized updates to the controller over an
authenticated WebSocket. See [`observer-app/README.md`](observer-app/README.md).

**The operator just runs it** — a single window lets them:

- **Pick the debugger folder** (native picker; auto-detected on first run)
- **Set the port to share** (default `8787`)
- See the **live current player** (name / UID / playerId)
- **Copy / regenerate** the pairing token, and toggle LAN announce
- **Start / Stop** sharing (auto-starts on launch)

Settings persist to `%APPDATA%\FaceCamObserver\config.json`.

**Build & run**

```bash
cd observer-app
npm install
npm run tauri dev          # develop
npm run tauri build        # NSIS installer → src-tauri/target/release/bundle/nsis/
```

**How it connects**

- It broadcasts a UDP discovery beacon on the LAN. In the controller, use
  **Observers → Scan → Add** — host, port and token fill in automatically.
- Across different networks (no broadcast), **Add Observer** manually with the
  PC's IP/ZeroTier address + port + token.
- Transport is **push-only and token-authenticated** (`ws://host:port/observer?token=…`);
  bad tokens are rejected during the WebSocket handshake. It sends a keepalive
  every ~5s so idle connections don't drop.

**Internals**

| File | Role |
|------|------|
| `src-tauri/src/debugger/` | Shared engine — folder detection, file watcher, log parser |
| `src-tauri/src/ws.rs` | WebSocket push server with token auth (tokio-tungstenite) |
| `src-tauri/src/lib.rs` | Config persistence, watch→broadcast wiring, UDP beacon, commands |
| `src/App.tsx` | Single-screen UI matching the controller's design system |

The discovery beacon and WebSocket payloads are **identical** to what the
controller expects, so Scan/Add work the same regardless of which observer
machine is running it.

---

## Notes

- Incremental reads only — the watcher remembers a byte offset and never
  re-reads whole files; it resets on rotation/truncation.
- Locked files (held by the game) are retried on the next tick without freezing
  the UI.
- Settings persist to `%APPDATA%\EfinityFaceCam\settings.json`.
