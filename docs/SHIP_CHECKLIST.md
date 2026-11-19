# Afterlife Lease — Ship Checklist

Release steps for the **Windows NSIS installer** and the **web builds** (`dist/` and the single-file
`dist-single/`). All commands are PowerShell, run from the repository root on Windows 10/11 with Node ≥ 22.12.

---

## 0. Before you start

- [ ] Working tree clean, on the commit you intend to ship (`git status`, `git log -1`).
- [ ] **IP gate:** read [IP_NOTES.md](IP_NOTES.md). Publishing a build, a store page, benchmarks or making the repo
      public is a **public disclosure**: confirm any provisional patent filing is done *before* that.
- [ ] `THIRD_PARTY_NOTICES.md` is still accurate: no new runtime dependency in `package.json` (only `three` and
      `preact` are bundled).

## 1. Version

The version has **one source**: `package.json` → `"version"`.

- `vite.config.ts` / `vitest.config.ts` inject it as `__AFTERLIFE_VERSION__`. It becomes `GAME_VERSION`
  (`src/persistence/version.ts`, re-exported by `src/game/version.ts`), which is stored in every save envelope
  (`gameVersion`) and shown in the UI and diagnostics.
- electron-builder uses it for the output folder `release\<version>\` and the file name
  `AfterlifeLease-Setup-<version>-x64.exe`.

Steps:

- [ ] Choose the version (SemVer: patch = fixes only; minor = content/features with compatible saves; major = breaking).
- [ ] Bump it without creating a git tag yet:

  ```powershell
  npm version 1.0.1 --no-git-tag-version
  ```

- [ ] If the **save schema** changed: bump `SAVE_SCHEMA_VERSION` (`src/sim/types.ts`, integration lead) and append a
      migration to `MIGRATIONS` in `src/persistence/migrations.ts`. Older builds refuse newer saves
      (`future_version`), which is intended.
- [ ] Add a `CHANGELOG.md` entry for the version (date, Added / Changed / Fixed).

## 2. Verify

- [ ] Full pipeline, from a clean install:

  ```powershell
  npm ci
  npm run typecheck          # 0 errors
  npm test                   # 0 failed
  npm run verify:assets      # every manifest entry matches its SHA-256
  npm run e2e                # browser E2E on the production build (Playwright + Chromium)
  ```

- [ ] Optional but recommended before a content release: `npm run balance` (full sweep, slow).
- [ ] CI is green on the commit (`.github/workflows/ci.yml`: Windows + Ubuntu matrix, plus e2e when present).

## 3. Windows installer (NSIS x64, per-user)

One command does install → typecheck → tests → asset verification → web build → `dist\assets` verification →
Electron main build → electron-builder → SHA-256:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

Or step by step:

```powershell
npm run dist:win           # = build + electron:build-main + electron-builder --win nsis --x64 --publish never
Get-FileHash "release\$((Get-Content package.json | ConvertFrom-Json).version)\*.exe" -Algorithm SHA256
```

- [ ] Output: `release\<version>\AfterlifeLease-Setup-<version>-x64.exe` (+ `.sha256` from the script).
- [ ] Installer settings (`electron/electron-builder.json`): assisted (not one-click), per-user, no elevation,
      install directory selectable, desktop + Start-menu shortcuts, **app data kept on uninstall**, `asar`, fuses
      (`runAsNode` off, `NODE_OPTIONS` and inspector flags off, cookie encryption on, load only from asar).
- [ ] The CI Windows job builds the same installer and uploads it as the `afterlife-lease-windows-installer`
      artifact. Use it as a cross-check, or ship it after the smoke test below.

### Code signing

Unsigned installers trigger Windows SmartScreen ("Windows protected your PC"). electron-builder signs automatically
when a certificate is provided through the environment:

```powershell
$env:CSC_LINK = "C:\secure\afterlife-codesign.pfx"   # or a base64 / https URL to the .pfx
$env:CSC_KEY_PASSWORD = "<password>"                 # never commit this; use a secret store
npm run dist:win
```

- Buy an OV or EV code-signing certificate in the publisher's legal name. EV builds SmartScreen reputation at once;
  OV builds it over downloads.
- In CI: store the `.pfx` (base64) and password as GitHub **secrets**, and pass them as `CSC_LINK` /
  `CSC_KEY_PASSWORD` only to the Windows packaging step. The current workflow sets
  `CSC_IDENTITY_AUTO_DISCOVERY=false` and has no signing secrets, so CI builds are **unsigned**.
- Verify: `Get-AuthenticodeSignature "release\<version>\AfterlifeLease-Setup-<version>-x64.exe"` → `Valid`.
- [ ] Signed (or the release is explicitly labelled unsigned).

## 4. Web builds

```powershell
npm run build                                  # dist\  (relative base './': any static host or sub-path)
node scripts/verify-assets.mjs --root dist/assets
npm run build:single                           # dist-single\index.html + dist-single\assets\  (zip the folder)
npm run build:single -- --inline-assets        # index.html alone is the game when assets total < 12 MB
```

- [ ] `npm run preview` → http://localhost:4173 loads and plays.
- [ ] Single-file: open `dist-single\index.html` from a local web server (or itch.io HTML5 upload) and play.
- [ ] Shared hosts (itch.io): saves live in the host origin's IndexedDB. Tell players to use **Export** for backups
      (PLATFORM.md §9).

## 5. Smoke checklist (on a clean Windows machine or VM)

Install:

- [ ] Installer runs without admin rights. SmartScreen shows the publisher when signed. The install directory can
      be changed. Shortcuts are created and the game starts after finishing.

Boot and menus:

- [ ] Boot splash → main menu with the live demo world. No error splash, no console errors in
      `%APPDATA%\Afterlife Lease\logs\main.log`.
- [ ] Settings: change quality, volumes, UI scale; restart; the settings persist.

New game:

- [ ] Choose a lot and difficulty, create 1–4 zombies in Create-a-Zombie, enter the game.
- [ ] Hotkeys from the README controls table: speeds `1`–`4`, pause `Space`, modes `F1`/`F2`/`F3`, camera
      `Q`/`E`/`WASD`, wall view `C`, Help `F10`, fullscreen `F11`.
- [ ] Live: click a zombie, run an interaction, watch the needs move. Buy: place, rotate (`R`), sell, undo/redo.
      Build: walls, a room, a door, paint, floor.
- [ ] Audio plays after the first click: music, SFX, zombie voices. Muting works when unfocused (the setting).

Saves:

- [ ] Quick save (`F5`), quit to menu, **Continue** restores the same state.
- [ ] Autosave appears after the configured interval. Closing the window with X saves (Continue works after restart).
- [ ] Export a save (`.alsave` dialog defaults to Documents), delete the slot, import it back.
- [ ] Saves are in `%APPDATA%\Afterlife Lease\saves\`.

Robustness:

- [ ] A second launch focuses the running window instead of starting a new one.
- [ ] Unplug or move monitors → the window is placed on a visible display on the next start.
- [ ] Uninstall via Settings → Apps: the game is removed and saves remain.

Web:

- [ ] The same checks in Chromium-based browsers and Firefox for `dist\` and `dist-single\`. Saves survive a reload.

## 6. Publish

- [ ] Tag the commit: `git tag v<version>; git push origin v<version>` (lead only).
- [ ] Attach the installer + `.sha256` (and a zipped `dist-single\`) to the release or store upload.
- [ ] Keep the exact build artifacts and `package-lock.json` of the shipped commit.
