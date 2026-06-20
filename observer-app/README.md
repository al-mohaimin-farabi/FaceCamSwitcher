# FaceCam Observer (desktop app)

A small, polished desktop app for **observer PCs**. Same dark UI as the main
FaceCam controller. The observer runs this app, picks their Free Fire debugger
folder, and the app streams normalized observer switches to the controller over
an authenticated WebSocket — and announces itself on the LAN for one-click
pairing.

This is the user-friendly replacement for the console `FaceCam-Observer.exe`
agent: no command line, the user **chooses the folder and the port** in the UI.

## What the observer sees / does

- **Current player** card — live name / UID / playerId as it switches.
- **Debugger Folder** — a **Browse…** button (native folder picker). Auto-detected
  on first run when possible.
- **Connection** — editable **Port to share**, a **display name**, the **pairing
  token** (copy / regenerate), and a toggle for including the token in the LAN
  announce.
- **Connect from the controller** — shows this PC's address(es) + how many
  controllers are connected.
- **Start / Stop** sharing. It auto-starts on launch.

Settings persist to `%APPDATA%\FaceCamObserver\config.json`.

## How the controller connects

- **Same network / ZeroTier:** controller → **Observers → Scan** → **Add**
  (host/port/token filled in automatically from the LAN announce).
- **Different network:** controller → **Add Observer** → Remote Agent, using the
  address shown in the app + the token.

## Develop / build

```bash
cd observer-app
npm install
npm run tauri dev          # run in dev
npm run tauri build        # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

Requires the same toolchain as the main app (Node 18+, Rust, MSVC Build Tools).

## Architecture

- **Rust** (`src-tauri/src`):
  - `debugger/` — shared engine (folder detection, file watcher, log parser).
  - `ws.rs` — WebSocket push server with token auth (tokio-tungstenite).
  - `lib.rs` — config persistence, watch→broadcast wiring, UDP discovery beacon,
    and the Tauri commands the UI calls.
- **React** (`src`) — single-screen UI matching the controller's design system.

The discovery beacon and WebSocket payloads are identical to the console agent,
so the controller treats both the same way.
