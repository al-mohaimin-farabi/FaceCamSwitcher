# Development & Release Guide

Covers local dev setup, the build command, and how to cut a GitHub Release for
this repo. Verified against the actual repo contents (`package.json`,
`tauri.conf.json`, `Cargo.toml`, git tags/branches) as of the `Single-PCOB`
branch — not just the README's description.

---

## Known gotchas (read this first)

- **`npm run build:backend` / `build:all` are dead scripts.** They shell out
  to PyInstaller for a `facecam_backend.spec` that doesn't exist anywhere in
  this repo, and `tauri.conf.json` has no `externalBin` referencing a backend
  exe. Leftover from the old ONNX/DirectML OCR era. On `Single-PCOB`,
  **`npm run tauri build` alone is the whole build** — running the backend
  scripts will just fail looking for a spec file that's gone.
- **Version lives in `src-tauri/tauri.conf.json`, not `app/package.json`.**
  `tauri.conf.json` and `Cargo.toml` are the source of truth (currently
  `0.2.0`) — that's what names the installer. `app/package.json`'s version
  field (currently `1.0.0`) is never read by the Tauri bundler; it's cosmetic
  only.
- **No CI is configured** — no `.github/workflows` in this repo. Releasing is
  fully manual today (see below).
- **Existing git tags aren't semver** (`EFFINITY-ECUBE-FACECAM-OCR`,
  `EFFINITY-FACECAM_LAN`, `EFFINITY-MULTI-REGION-OCR-FOR-MLBB`) — named per
  branch/feature, not per version. Use `vX.Y.Z` going forward so GitHub's
  auto-generated release notes (compare view, changelog since last tag)
  actually work.
- `gh` CLI is not installed by default — the web UI works with zero setup;
  install `gh` only if you want the CLI flow below.

---

## 1. Prerequisites

- **Node.js 24.x** — matches what the rest of the FaceCam monorepo
  standardizes on. (The README says "≥18"; that's the floor, not what's
  actually in use — there's no `.nvmrc` pinning it in this app, unlike
  client/server.)
- **Rust stable** via [rustup.rs](https://rustup.rs).
- **MSVC Build Tools (C++ workload)** — required to compile the Rust side on
  Windows:
  ```bash
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools"
  ```
- No Python, no ONNX, no DirectML — none of that applies to `Single-PCOB`.

## 2. First-time setup

```bash
cd app
npm install
```

## 3. Dev start command

```bash
npm run tauri dev
```

Runs `beforeDevCommand` (`npm run dev` → Vite on `localhost:5173`) and opens
the Tauri window pointed at it, with hot reload on the React side and
recompiles on Rust changes.

## 4. Build command

```bash
npm run tauri build
```

Pipeline (from `tauri.conf.json`):

1. `beforeBuildCommand`: `clean_builds.js` (kills any running `FaceCam.exe`,
   wipes old `.exe`/`.msi` from the bundle dir) → `npm run build`
   (`tsc -b && vite build`)
2. Rust release build (`cargo build --release`)
3. `beforeBundleCommand`: `post_build.js` copies the raw exe to the repo root
   as `FaceCam.exe` for quick local runs
4. NSIS bundling (only target configured — no MSI)

**Output installer:**
`app/src-tauri/target/release/bundle/nsis/FaceCam_<version>_x64-setup.exe`

## 5. Before tagging a release — bump the version

Two files, kept in sync:

- `app/src-tauri/tauri.conf.json` → `"version"` (this is what names the
  installer)
- `app/src-tauri/Cargo.toml` → `[package] version`

```bash
git add app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml
git commit -m "chore: bump version to 0.3.0"
```

## 6. Releasing to GitHub Releases (manual — no CI yet)

```bash
cd app
npm run tauri build
```

Then tag and push:

```bash
git tag v0.3.0
git push origin v0.3.0
```

**Option A — Web UI** (no extra install needed):
Repo → **Releases** → **Draft a new release** → pick tag `v0.3.0` → drag in
`FaceCam_0.3.0_x64-setup.exe` from the nsis bundle path above → publish. Since
the repo is private, the release inherits that visibility automatically.

**Option B — `gh` CLI** (install first: `winget install GitHub.cli`, then
`gh auth login`):

```bash
gh release create v0.3.0 \
  "src-tauri/target/release/bundle/nsis/FaceCam_0.3.0_x64-setup.exe" \
  --title "v0.3.0" \
  --notes "Release notes here"
```

---

## Future improvement (not set up yet)

A `.github/workflows/release.yml` using `tauri-apps/tauri-action` could build
and attach the installer automatically on a version-tag push, removing the
manual `npm run tauri build` + upload step entirely.
