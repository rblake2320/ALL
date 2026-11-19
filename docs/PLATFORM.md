# Afterlife Lease — Platform (persistence, desktop app, build tooling)

Owner: PLATFORM. Code: `src/persistence/**`, `electron/**`, `scripts/**`. Tests: `tests/unit/persistence/**`,
`tests/unit/electron/**`. Contract: `src/persistence/contracts.ts` (not edited here — see
`docs/contract-requests/platform.md`).

---

## 1. Using it (for GAME)

```ts
import { createSaveManager, createProfileStore, GAME_VERSION } from './persistence';

const saves = await createSaveManager();   // probes electron > indexeddb > localstorage > memory
const profile = createProfileStore();      // same backend family, keys 'profile:<key>'
```

| Call | Behaviour |
|---|---|
| `save(slotId, name, world, meta, { autosave?, playMinutes?, waitForLock? })` | Never rejects. `{ ok:false, code }` with `quota` (storage full), `busy` (file locked / another tab), `io`, `invalid` (bad slot id, non-JSON world, world fails validation, slot holds a NEWER game's save). The world is snapshotted **synchronously** at call time. `waitForLock: true` makes an autosave-flagged save wait (≤ 30 s) for another window's lock instead of failing `busy` (GAME's crash/emergency save). |
| `load(slotId)` | Never rejects. `not_found` / `corrupt` / `future_version` / `invalid` / `io`. `warnings[]` lists every repair; `info.recoveredFromBackup` when the previous save had to be used. |
| `listSlots()` | Newest first. **Rejects** if storage cannot be listed at all (so the UI can say so instead of showing "no saves"). Damaged slots are listed as "Damaged save (id)" so they can be deleted. |
| `remove(slotId)` | Idempotent; rejects only on storage errors. |
| `exportSlot(slotId)` | `{ filename: 'afterlife-<household>-day<N>.alsave', data }` — pretty JSON, self-verifying (checksums inside). Falls back to the backup if the primary is damaged. |
| `importFile(bytes, slotId?)` | Verifies, migrates, validates, repairs, then saves into `slotId` or a new `import-YYYYMMDD-HHMMSS[-N]` slot. Accepts gzip or JSON, CRLF and a UTF-8 BOM (files edited in Notepad). A fresh slot is reserved in-process and written **create-only** under the cross-window lock, so two imports in the same second — in one tab or two — always land in two slots. With an explicit `slotId` the import takes its place in that slot's queue at call time (never coalesced with, or reordered against, saves of that slot). |
| `latest()` | Newest **loadable** slot ("Continue"); slots whose copies are all damaged are listed (deletable) but never offered. |
| `profile.load(key, fallback)` | Never rejects; returns data merged over `fallback` (see §7). |
| `profile.save(key, value)` | Coalesced per key; rejects on storage errors / unserializable values / values nested deeper than the decoder accepts (checked BEFORE writing — the stored record is never replaced by an unreadable one). |

Slot ids: `/^[a-z0-9_-]{1,40}$/i`, **case-insensitive** (canonicalized to lowercase — Windows and macOS file
systems are case-insensitive), Windows device names (`con`, `nul`, `com1`, `lpt1`, …) refused. Autosave slot:
`autosave` (also `autosave-N`).

`GAME_VERSION` = package.json `version`, injected by Vite/Vitest `define` (`__AFTERLIFE_VERSION__`).

## 2. Save format

Envelope (one JSON object; on storage usually gzip-compressed, detected by magic bytes on read):

```jsonc
{
  "createdAt": "2026-11-01T10:00:00.000Z", "format": "afterlife-lease-save", "formatVersion": 1,
  "gameVersion": "1.0.0", "meta": { "householdName": "...", "memberNames": [], "day": 5, "timeLabel": "...",
  "funds": 1500, "lotValue": 23000, "thumbnail": null }, "name": "...", "payloadSha256": "<hex>",
  "playMinutes": 42, "savedAt": "...", "schemaVersion": 1, "slotId": "slot1",
  "headerSha256": "<hex>",
  "payload": { /* WorldState (src/sim/types.ts) */ }
}
```

* `payloadSha256 = SHA-256(canonicalJson(payload))` — canonical JSON = sorted keys, no whitespace, refuses
  NaN/Infinity/undefined/functions/cycles/class instances, so the hash is formatting-independent.
* `headerSha256 = SHA-256(canonicalJson(all fields except payload & headerSha256))` — an additive extension:
  it covers `payloadSha256`, so **every** bit of the file is verified. Files without it load with a warning.
* Checksums detect corruption; they are **not** tamper-proofing (a client cannot keep a secret).
* Limits: 64 MiB per file (also after decompression — gzip bombs are refused), JSON nesting ≤ 128.
* **Reserved keys** `__proto__` / `constructor` / `prototype` (prototype-pollution vectors) are never stored and
  never loaded. Writers leave them out (`canonicalJson` `dropKeys`, with a console warning naming each path) —
  otherwise the checksum would cover data the loader drops, making the save permanently unloadable (and the
  self-check refused every save of such a world). Readers verify the checksums over the RAW parse (exactly what is
  stored; JSON.parse never runs the `__proto__` setter) and strip the keys right after, before anything copies or
  merges the data — so a file from any producer loads (minus those keys, with a warning) and injected bytes are
  corruption like any other modification. The structural validator also drops them from every map/extra field
  (defence in depth for callers that bypass the parser) and keeps forward-compatible extras named like
  `Object.prototype` members (`toString`, …).
* Strict UTF-8: invalid byte sequences are corruption, never "almost right" text.
* SHA-256 uses WebCrypto; a tested pure-JS fallback covers insecure contexts (game served over plain http).

## 3. Where saves live

| Platform | Location |
|---|---|
| Windows desktop | `%APPDATA%\Afterlife Lease\saves\` (e.g. `C:\Users\<you>\AppData\Roaming\Afterlife Lease\saves`) |
| macOS desktop | `~/Library/Application Support/Afterlife Lease/saves/` |
| Linux desktop | `~/.config/Afterlife Lease/saves/` |
| Browser | IndexedDB database `afterlife-lease`, store `kv` (fallback: localStorage keys `afterlife-lease:*`) |

Desktop file names are derived from keys: `slot:autosave:primary` → `slot.autosave.primary.dat`; uppercase
letters are escaped (`profile:tutorialStage` → `profile.tutorial~stage.dat`) so keys never collide on
case-insensitive disks. Per slot: `.primary.dat` (current), `.backup.dat` (previous good save),
`.meta.dat` (listing cache). Uninstalling keeps saves (`deleteAppDataOnUninstall: false`). Dev runs
(`npm run electron:dev`) use the same folder. Logs: `%APPDATA%\Afterlife Lease\logs\main.log` (rotated, 1 MB × 3).
Window placement: `%APPDATA%\Afterlife Lease\window-state.json`.

## 4. Crash safety (how a save is written)

1. `canonicalJson(world)` synchronously (later sim mutation cannot leak in).
2. Build envelope → encode (gzip when `CompressionStream` exists).
3. **Verify the exact bytes** by running them through the full load pipeline (decode, checksums, structural
   validation). A failure writes nothing.
4. Read the current primary; if it is **loadable** rotate it to `backup` (a damaged primary is never rotated over
   a good backup; a primary written by a *newer* game version is never overwritten → `invalid`).
5. Write primary — every backend write is atomic (IndexedDB: one `readwrite` transaction with
   `durability: 'strict'`; localStorage: one `setItem`; desktop: temp file + fsync + rename + dir fsync).
6. Read back and byte-compare.
7. Write the meta record (a cache; if this fails the save still succeeded and listing self-heals).

`tests/unit/persistence/crash.test.ts` kills the backend at **every** operation of a save, in three modes
(before applying, after applying, torn half-write), restarts, and asserts the old or the new world loads —
never neither. Desktop writes (`electron/fileStore.ts`) are tested the same way at the file level.

Concurrency: saves to one slot are serialized; while one runs, further saves **coalesce** into a single
pending save of the latest world (every caller gets its result). Coalescing keeps the **strongest lock policy**
(a manual save folded together with a later autosave still waits for the lock) and the last known play time;
imports are never coalesced. Every operation takes its place in the slot's queue at call time. A global
per-backend lock serializes all slots; **Web Locks** serialize multiple browser tabs — an autosave
(`{ autosave: true }` or an `autosave*` slot) uses `ifAvailable` and returns `busy` at once if another window holds
the lock (the caller retries), a manual save waits up to 30 s — and so does an autosave-flagged save passed
`{ waitForLock: true }` (the crash/emergency save: still listed as an autosave, but it may be the only copy of the
session, so it must not give up just because another tab is mid-save). Listing-record (meta) refreshes done by `load()` /
`listSlots()` are a cache: they use `ifAvailable` and are skipped while another window saves, so loading and listing
never block on another tab. On desktop `app.requestSingleInstanceLock()` makes one process own the saves folder (a
second launch focuses the first window).

## 5. Loading and recovery

`primary` → (checksum/parse/validation failure) → `backup` with `recoveredFromBackup: true` and a warning →
otherwise the primary's error code. `future_version` stops immediately (an old build never "downgrades" a
newer save). After checksums: migrate (`src/persistence/migrations.ts`) → structural validation/repair
(`src/persistence/validation/`, every WorldState field typed and ranged; leaves repaired with defaults,
broken collection entries dropped, broken top-level structures fatal; record keys vs ids, relationship keys,
household members and `nextId` re-checked) → the engine's `repairWorld` (loaded lazily from `src/sim/index.ts`;
a throwing or garbage-returning repair is contained and reported as a warning).

Adding a schema version: bump `SAVE_SCHEMA_VERSION` (contract) and append
`{ from: N, to: N + 1, migrate(p) { ... } }` to `MIGRATIONS`. Migrations must be **pure** (they may be
dry-run on a throwaway copy) and defensive. Re-saving stores the migrated world, so no step runs twice.

## 6. Desktop app (electron/)

* Window 1600×900 (clamped to the display), min 1280×720, dark background, shown on `ready-to-show`,
  placement restored (validated against current monitors). **F11** toggles fullscreen. Menu removed when
  packaged; F12/devtools only in dev. `backgroundThrottling: false` (the game may keep simulating while
  unfocused, per its "pause when unfocused" setting).
* Security: `contextIsolation`, `sandbox`, no Node in the renderer, `webSecurity`; content served from the
  privileged `app://game/` protocol (not `file://`: real origin, `fetch()` works for GLBs, CSP applies);
  CSP: scripts `'self'` only — no `'unsafe-eval'`, and no `'wasm-unsafe-eval'` because nothing ships WebAssembly
  (a test scans every shipped GLB for Draco/meshopt/KTX2 extensions; enable `buildCsp({ allowWasm: true })` in
  `electron/main.ts` only when an asset needs a decoder); the same policy ships as a `<meta>` tag in the built
  `index.html` for the web build (docs/SECURITY.md §3); navigation, redirects, `window.open`, `<webview>`,
  Bluetooth pickers, HID/serial/USB devices, screen capture and every permission except clipboard-write
  (DOM fullscreen and pointer lock included — fullscreen goes through the bridge) blocked; downloads limited to
  page-generated blob/data URLs (save export) with an `.alsave` Save dialog; fuses disable `RunAsNode`,
  `NODE_OPTIONS`, inspector flags and file:// privileges and enable embedded ASAR integrity validation. Full threat
  model: docs/SECURITY.md.
* IPC: only from our own top frame (`app://game`), every argument validated (key grammar, Windows device names,
  traversal, 64 MiB cap, 512 files max); replies are `{ok,value}|{ok:false,code,message}` and the preload
  turns failures into `Error('[code] message')`.
* Crashes: renderer crash → dialog "Reload / Quit" (3 crashes in 60 s → explain and quit); hang → "Keep
  waiting / Reload" (dismissed automatically when it recovers); everything logged. Renderer console
  warnings/errors are copied to the log at most 200 per 10 s (an error loop cannot flood the disk; a
  "N message(s) suppressed" line marks the gap).
* **Closing the window** (X, Alt+F4): the window hides immediately; `PAGE_FLUSH_SCRIPT` runs in the page: it fires
  the `beforeunload` handlers (GAME autosaves there) and then awaits the persistence layer's **own idle signal**
  (`globalThis.__afterlifeLeasePersistence.whenIdle`, installed by `createSaveManager` / `createProfileStore`,
  `src/persistence/activity.ts`). Every save/profile write is counted from call to settle — hashing, gzip and
  verification included — and the page reports idle after 500 ms without activity (measured from the request, so a
  save the game starts a moment later is still awaited), or `timeout` after 5 s. Inferring "done" from storage IPC
  silence was wrong: a big save spends long stretches computing between two storage calls. Pages without the hook
  fall back to "storage IPC quiet for 400 ms". Hard cap 7 s (hung renderer). `afterlifeNative.quit()` exits
  immediately (the game already saved).
* Saves folder on Windows: a save file carrying the **read-only attribute** (restored by a backup tool, copied from
  read-only media) made every overwrite/delete fail with EPERM forever (reported as "locked"). The store now
  recognises it on the first EPERM/EACCES (mode without the write bit), clears the attribute on its own data file
  and retries at once; genuine locks keep the 2 s backoff; POSIX modes are never changed. Reads return a tight copy
  (never a view into Node's shared buffer pool) before data crosses IPC. Stale `window-state.json.tmp-*` files from
  an interrupted placement write are removed at start-up.

## 7. ProfileStore semantics

Records `profile:<key>` (+ rotated `profile:<key>:bak`), checksummed. `load(key, fallback)`: damaged primary →
backup → fallback. When `fallback` is a plain object the stored value is merged **over** it recursively:
missing keys (a setting added in a newer version) come from `fallback`, values whose type differs from
`fallback`'s (corrupted/tampered) are replaced, unknown keys are kept. `undefined` properties are omitted on save;
reserved keys are left out (a settings map with a `constructor` key used to make the WHOLE record unreadable, so
every setting silently reset on each launch); every record is decoded again before it is written (self-check).

## 8. Commands

| Task | bash | PowerShell |
|---|---|---|
| Install (no Electron binary, CI/containers) | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` | `$env:ELECTRON_SKIP_BINARY_DOWNLOAD=1; npm ci` |
| Install (desktop dev / release machine) | `npm ci` | `npm ci` |
| Typecheck (renderer + electron) | `npm run typecheck` | same |
| Platform tests | `npx vitest run tests/unit/persistence tests/unit/electron` | same |
| All tests | `npm test` | same |
| Web build → `dist/` | `npm run build` | same |
| Single-file build → `dist-single/` | `npm run build:single` (add `-- --inline-assets` to embed assets < 12 MB) | same |
| Verify assets (SHA-256 manifests) | `npm run verify:assets` / `node scripts/verify-assets.mjs --root dist/assets` | same |
| Real-browser persistence check (Chromium: IndexedDB, Web Locks across 2 tabs, gzip, WebCrypto, reload, recovery) | `node dev/platform.e2e.cjs` (Vite on port 5181) | same |
| Compile Electron main/preload | `npm run electron:build-main` | same |
| Regenerate / check the desktop icon (`electron/build/icon.ico`) | `node scripts/make-icon.mjs` / `node scripts/make-icon.mjs --check` | same |
| Production dependency audit | `npm audit --omit=dev` | same |
| Desktop dev (Vite + Electron) | `npm run electron:dev` | `powershell -ExecutionPolicy Bypass -File scripts\dev-electron.ps1` |
| Run built desktop app | `npm run electron:start` | same |
| Windows installer | `npm run dist:win` (on Windows) | `powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1` |

`scripts/build-windows.ps1` (PowerShell 5.1/7): checks Node ≥ 22.12 / npm ≥ 10 → `npm ci` → typecheck →
tests → asset verification → web build → verification of `dist/assets` → Electron build → electron-builder
(NSIS x64, per-user) → prints `release\<version>\AfterlifeLease-Setup-<version>-x64.exe` and its SHA-256
(also written next to it as `.sha256`). Flags: `-SkipInstall`, `-SkipTests`. Each step judges success by the
native exit code with `$ErrorActionPreference` relaxed to `Continue` for that call only — under a redirected host
(CI agent, ISE, `2>&1`) Windows PowerShell 5.1 turns every stderr line (`npm warn ...`) into an ErrorRecord and
`Stop` would abort a healthy build. The previous `release\<version>` folder is deleted with retries (Defender /
a still-running old installer briefly lock files). The Node CLIs (`verify-assets.mjs`, `inline-build.mjs`,
`build-electron-main.mjs`) set `process.exitCode` instead of calling `process.exit()`, so long reports piped into
CI logs or `--json` consumers are never truncated.

Single-file build: `vite build --mode single` (one JS chunk, one CSS, imported assets inlined) → JS/CSS inlined
into `dist-single/index.html` (escaped against `</script>`/`<!--`). The output folder is deleted and rebuilt, so
`--out` must provably be ours: the default `dist-single/`, a new/empty folder, or one with the
`.afterlife-single-build` marker of an earlier run — drive roots, the home folder, the project or its ancestors, the
input build (or anything containing it / inside it) and non-empty foreign folders are refused before anything is
touched. Public assets are copied alongside
(`dist-single/assets/…`, referenced relatively). With `--inline-assets` (and assets < `--max-inline-mb`, default
12) GLB/textures/audio are embedded as base64 behind a `fetch()` shim and `index.html` is the whole game.
Limitation: only `fetch()` loads are served from the embedded table (three.js loaders use fetch).

## 9. Troubleshooting

* **"The save file is locked by another program"** (code `busy`): antivirus (Windows Defender real-time
  scanning), backup or sync tools (OneDrive/Dropbox if the profile folder is synced) briefly lock files. Writes
  already retry for ~2 s with backoff; if it persists, add an exclusion for `%APPDATA%\Afterlife Lease`, pause
  the sync tool, or check *Controlled folder access* in Windows Security. Old saves are never damaged by a
  failed write. (Read-only save files are fixed automatically — see §6.)
* **"Not enough storage space to save"** (code `quota`): desktop — the drive holding `%APPDATA%` is full (or the
  512-file guard tripped: delete old saves). Browser — site storage quota (localStorage ≈ 5 MB; IndexedDB a
  share of free disk). Delete old slots or export them; the previous save remains intact. Browsers may evict
  site data under pressure; the game requests persistent storage after the first save (Firefox may ask).
* **Corrupted save**: the game loads the previous save automatically and says so. If both copies are damaged the
  slot is listed as "Damaged save (…)" and can be deleted. Exported `.alsave` files are self-verifying; a file
  edited by hand fails its checksum (`corrupt`) by design.
* **"This slot holds a save from a newer version"**: update the game; the older build will not overwrite it.
* **Game does not start / second window does nothing**: only one instance may run (protects the saves
  folder); launching again focuses the existing window. Check Task Manager for a hung `Afterlife Lease.exe`.
* **Logs**: `%APPDATA%\Afterlife Lease\logs\main.log` (renderer warnings/errors are copied there too).
* **Window off-screen after unplugging a monitor**: placement is re-validated on start; deleting
  `window-state.json` resets it.
* **Private browsing / sandboxed iframe**: storage may be unavailable → in-memory saves (lost on close);
  `saves.backend.durable === false` lets the UI warn.
* **Web builds on shared hosts (itch.io HTML5)**: every game on the host shares one browser origin, so saves live in
  that origin's IndexedDB next to other games' data; "clear site data" (or another game wiping the origin) deletes
  them. Use **Export** for backups; the desktop build keeps saves in its own folder.
* **Desktop build saved into the browser profile instead of the saves folder**: only if the saves folder stayed
  unavailable through three probe attempts at start-up (a transient lock is retried) — the log says
  "saves folder unavailable"; fix the folder permissions and restart.
* **Electron binary download blocked** (proxies): install with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for builds and
  tests; `npm run electron:dev` needs the binary (`node node_modules/electron/install.js` after fixing access).
  electron-builder downloads the Windows Electron zip separately (cache: `%LOCALAPPDATA%\electron\Cache`).
* **SmartScreen warning**: the installer is unsigned unless `CSC_LINK`/`CSC_KEY_PASSWORD` are provided.

## 10. Not verifiable in the Linux build container

Running Electron itself (binary download blocked — `main.ts` runs against a mocked Electron API, and the page-side
flush script is executed in a VM context), building the NSIS installer (needs the win32 Electron zip; best done on
Windows), executing the PowerShell scripts (no `pwsh` here — they are statically checked: ASCII, CRLF, strict
mode, bracket balance, exit-code handling, the stderr-tolerant `Invoke-Step`, the retrying release-folder delete),
and real Windows file-system semantics (EPERM/EACCES/EBUSY locks and the read-only attribute are emulated by an
injected fs; Node's `fs.chmod(0o666)` clearing FILE_ATTRIBUTE_READONLY is documented Node behaviour, not exercised
here). Browser storage IS verified for real in Chromium (`node dev/platform.e2e.cjs`: IndexedDB with strict
durability, Web Locks across two tabs, CompressionStream, WebCrypto, reload durability, recovery from a corrupted
primary, the quit hook, and a real engine world round-tripping byte-identically). Firefox/Safari storage quirks
are not. The electron-builder config is validated with electron-builder's own schema validator in the test suite.
