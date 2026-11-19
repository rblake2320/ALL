# Afterlife Lease — Security model

Scope: the Windows desktop app (`electron/**`), the web build (`index.html` + Vite output), the save system
(`src/persistence/**`), and — since W-003 — the local economy (`src/economy/**`: Bones ledger, grants, age gate)
and the content-pack verifier (`src/packs/**`). First independent review: `docs/security/SECURITY_REVIEW_2026-11-05.md`. Every claim below names the code that implements it and the test that pins it; if you
change one, change the other. Owner: PLATFORM.

## 1. Threat model (single-player, offline)

There are (today) no accounts, no servers, no multiplayer, no telemetry, no auto-update and no network requests: the
CSP allows no remote origin at all (§3). That leaves a small set of realistic threats:

| # | Threat | In scope? | Defence |
|---|---|---|---|
| T1 | **A hostile save file** — someone shares an `.alsave` ("my 100-day household!") crafted to crash, hang, fill the disk, pollute prototypes or inject markup | **Yes — the main one** | §4: everything after the checksums treats the file as hostile |
| T2 | **A compromised renderer** — a bug in three.js / Chromium parsing, or script injection via data | **Yes** | §2: sandboxed renderer; the IPC bridge is the only door and it only opens onto the saves folder |
| T3 | **Navigation / pop-ups / downloads / device or permission prompts** abused from page content | Yes | §2 |
| T4 | **Other games on a shared web origin** (itch.io HTML5 serves many games from one origin) reading or wiping browser saves | Documented, not preventable | Browsers isolate by origin, not by game. Use Export for backups; desktop saves live in their own folder (docs/PLATFORM.md §9) |
| T5 | **The player editing their own save** (more money, maxed skills) | **Game state: allowed. Economy: no** | It is their game: household money/skills may be edited (§5: checksums are not tamper-proofing). But an edited or shared save must not mint Bones or re-earn grants (review H-1, fix W-106), and nothing local is ever trusted for paid Grave Gold (server-only) |
| T9 | **Economy abuse offline** — forged saves/ledgers to farm Bones; clock skew for dailies | **Yes, best-effort** | Local ledger is hash-chained but unkeyed, so it is tamper-*evident to us*, not tamper-*proof*; it is marked local-unverified and the future server never imports it (W-099). Grave Gold cannot be minted client-side |
| T10 | **Child-safety gates bypassed** — resetting the under-15 bracket, free-text names for under-15 | **Yes** | Age bracket fails closed to under-15 on missing/corrupt records (W-106). A full wipe of all site data equals a fresh install and cannot be detected offline; real enforcement (verified parental consent) needs accounts (W-096) |
| T11 | **Hostile content packs** | **Yes** | `src/packs/verify.ts`: strict schema, size/ratio caps, Ed25519 signature over the canonical manifest, publisher allowlist, fails closed. The game does not load third-party packs yet and the production key is not provisioned |
| T6 | A local attacker running as the same Windows user | No | They already own `%APPDATA%`, the install folder and the process. Nothing in a client can stop them |
| T7 | Supply chain (npm packages, the Electron binary) | Partly | Exact pinned versions + lockfile; zero runtime dependencies; `npm audit` (§7) |
| T8 | Installer privilege | Yes | Per-user NSIS install, `asInvoker`, `allowElevation: false` (§6) |

## 2. Desktop app (Electron)

Code: `electron/main.ts`, `electron/preload.ts`, `electron/ipcHandlers.ts`, `electron/storageKeys.ts`,
`electron/fileStore.ts`, `electron/appProtocol.ts`, `electron/csp.ts`. Tests: `tests/unit/electron/main.test.ts`
(against a mocked Electron API — the binary cannot run in the CI container), `ipc.test.ts`, `protocol.test.ts`,
`storageKeys.test.ts`, `fileStore.test.ts`, `preload.test.ts`, `shipSecurity.test.ts`.

**Renderer isolation.** `contextIsolation: true`, `sandbox: true` (plus `app.enableSandbox()` for every
renderer), `nodeIntegration`/`nodeIntegrationInWorker`/`nodeIntegrationInSubFrames: false`, `webSecurity: true`,
`allowRunningInsecureContent: false`, `webviewTag: false`, `experimentalFeatures: false`,
`navigateOnDragDrop: false`, devtools only in unpackaged runs. The preload may `require('electron')` only
(enforced at build time by `scripts/build-electron-main.mjs`) and exposes exactly `window.afterlifeNative`
(`NativeBridge`, `src/persistence/contracts.ts`).

**Content origin.** The game is served from the privileged `app://game/` scheme, never `file://`. Requests are
confined to `dist/`: percent-encoded traversal, backslashes, drive letters, NUL, `:` (NTFS alternate data
streams), Windows device names and dot-files are refused (`resolveAppRequest`). The `ELECTRON_RENDERER_URL` dev
server override is honoured only when unpackaged and only for loopback `http:`.

**Navigation and windows.** `will-navigate`, `will-redirect` and sub-frame navigation to anything but our own
origin are cancelled; `window.open` is denied; `<webview>` attachment is cancelled — for every `webContents`
(`web-contents-created`). External links therefore do nothing in the desktop build.

**Permissions.** The permission request AND check handlers grant exactly one permission,
`clipboard-sanitized-write` (the Diagnostics / crash screen "Copy" buttons), and only to our own origin.
Everything else is denied, including DOM fullscreen and pointer lock: fullscreen goes through the bridge
(`afterlifeNative.setFullscreen` → `BrowserWindow.setFullScreen`, and F11), which needs no web permission.
`setDevicePermissionHandler` refuses every HID/serial/USB device, `setDisplayMediaRequestHandler` refuses screen
capture, and `select-bluetooth-device` is cancelled (Electron would otherwise pick the first device found).

**Downloads.** Only `blob:` URLs of our own origin and `data:` URLs (save exports the page generates) are
allowed; the file name is sanitized (`safeDownloadName`: no path, no reserved device names, no control chars) and
the Save dialog opens in Documents. Anything else is cancelled.

**IPC.** Every handler first checks the sender: our main window's `webContents`, its top frame (never a
sub-frame), URL `app://game/…` (or the dev origin when unpackaged). Arguments are validated in main
(`ipcHandlers.ts`), never trusted from the preload: exact argument count, types, byte payloads only
(`Uint8Array`/`ArrayBuffer`/typed-array views — no strings or arrays), 64 MiB per value, 512 data files max and
2 GiB of data in total (`electron/fileStore.ts`; a write past it fails with `quota`).
Storage keys use the grammar `[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)*`, ≤ 120 chars, no Windows device name
(`CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9`, superscript-digit variants) in any segment — traversal (`..`,
`/`, `\`, drive letters, NUL, `:` streams) is impossible by construction, and the derived file name is checked
to stay inside the saves folder (belt and braces). Uppercase letters are escaped in file names so keys never
collide on case-insensitive NTFS. Errors cross IPC as `{ ok:false, code, message }` with absolute paths scrubbed
(user names live in them) and no stack traces. What compromised page script (e.g. injection via data) can do: read/write/delete
`*.dat` files in `%APPDATA%\Afterlife Lease\saves` within those limits, toggle fullscreen, open that folder in
Explorer, quit. It cannot read other files, start processes or reach the network (the CSP allows no remote origin).
A memory-corruption exploit of the renderer *process* is a different case: the CSP no longer applies and
containment rests on the Chromium sandbox (`sandbox: true`) and on running a patched Electron — which is why an
update channel is required before public release (review M-3).

**Single instance.** `app.requestSingleInstanceLock()` runs before anything touches the disk; a second launch
exits and focuses the first window. One process owns the saves folder.

**Crash paths.** Renderer crash → "Reload / Quit" dialog (3 crashes in 60 s → explain and quit); hang →
"Keep waiting / Reload"; `uncaughtException`/`unhandledRejection` in main are logged, never fatal. Saves on disk
are old-or-new consistent at every instant (§4 writes), so no crash can corrupt them. Closing the window waits
(bounded, 7 s) for the page's persistence layer to report idle (docs/PLATFORM.md §6). GAME's emergency save on a
fatal error uses `save(..., { autosave: true, waitForLock: true })` (src/game/saveFlow.ts).

**Fuses** (`electron/electron-builder.json`): `runAsNode` off, `enableNodeOptionsEnvironmentVariable` off,
`enableNodeCliInspectArguments` off, `onlyLoadAppFromAsar` on, `enableEmbeddedAsarIntegrityValidation` on,
`grantFileProtocolExtraPrivileges` off, `enableCookieEncryption` on. ASAR integrity makes a modified `app.asar`
refuse to load; like everything in §5 it stops casual tampering, not an attacker who can also patch the `.exe`.

## 3. Content-Security-Policy (desktop AND web)

One source of truth, `electron/csp.ts`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:;
object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'
```

* No `'unsafe-eval'`, no `'unsafe-inline'` scripts, no `'wasm-unsafe-eval'` (nothing ships WebAssembly; a test
  scans every shipped GLB for Draco/meshopt/KTX2 and fails if one appears), no remote origin anywhere.
  `style-src 'unsafe-inline'` is needed for Preact inline `style` attributes and cannot execute code.
  `blob:`/`data:` cover GLTFLoader's embedded textures and the save export download.
* **Desktop:** sent as a response header on every `app://` document (and injected into dev-server documents,
  replacing any policy they carry).
* **Web build:** `vite.config.ts` (`cspMetaPlugin`, build only — the dev server's HMR client is inline) writes
  `<meta http-equiv="Content-Security-Policy">` right after `<meta charset>` of the built `index.html`, with the
  same policy minus `frame-ancestors` (ignored in `<meta>`; framing is the host's call — itch.io embeds the game
  in an iframe). The desktop build therefore carries both header and meta; they are identical apart from
  `frame-ancestors`, so they never conflict. The source `index.html` deliberately has no CSP tag; a second one
  fails the build.
* **Shared-town test page** (`town.html`, docs/SHARED_TOWN.md): the same policy plus ONE extra `connect-src` origin,
  the town server named at build time by `VITE_TOWN_SERVER` (`townServerOrigin` in `vite.config.ts`; a malformed
  value stops the build). Built without that setting, the page has the game's policy and connects to nothing. The
  game's `index.html` never gets the extra origin. `tests/e2e/town.mjs` checks both pages' policies and that the
  town page cannot reach a second server.
* **Single-file build** (`npm run build:single`): `scripts/inline-build.mjs` inlines the bundle (and, with
  `--inline-assets`, a `fetch()` shim) as inline `<script>`s and adds each one's exact `'sha256-…'` to
  `script-src` as the very last step — those scripts and nothing else run.
* Verified in real Chromium (Playwright, headless Chrome, 2026-11-05): the production build and the single-file
  build boot to the main menu, and the production build through New Game into Create-a-Zombie (82 GLB/texture/
  audio resources loaded), with zero `securitypolicyviolation` events and zero console errors; the repo's e2e run
  against the CSP build also reported 0 console/page errors. Live play inside a household was not exercised
  under the policy (that part of the e2e flow was failing for unrelated UI reasons at the time).

## 4. Saves and imports (untrusted data)

Code: `src/persistence/loadPipeline.ts`, `sanitize.ts`, `envelope.ts`, `canonicalJson.ts`, `meta.ts`,
`gzip.ts`, `validation/**`, `saveManager.ts`; `electron/fileStore.ts`. Tests: `tests/unit/persistence/**`, in
particular `untrustedImport.test.ts` (re-sealed hostile files), `sanitize.test.ts`, `reservedKeys.test.ts`,
`validation.test.ts`, `crash.test.ts`; `tests/unit/electron/fileStore.test.ts`, `windowsQuirks.test.ts`.

Load order for a stored save or an imported file, every stage total (a failure is a typed result, never an
exception):

1. **Size**: > 64 MiB (`MAX_SAVE_BYTES`) → `invalid`, before decoding.
2. **gzip** (detected by magic bytes) is decompressed with the same 64 MiB output cap — a gzip bomb stops at the
   cap (`invalid`).
3. **Strict UTF-8** (invalid sequences are corruption; a leading BOM is accepted).
4. **JSON**: must start with `{`; nesting > 128 (`MAX_JSON_DEPTH`) is refused by a linear pre-scan before
   `JSON.parse` (no stack overflow at any depth). `1e999` parses to `Infinity`, which canonical JSON refuses, so
   such a file can never verify (`corrupt`).
5. **Checksums** (§5) over the raw parse.
6. **Prototype pollution**: keys `__proto__`, `constructor`, `prototype` (including `\u`-escaped spellings) are
   stripped from the whole tree right after verification, before anything copies or merges it; the structural
   validator drops them again from every map. Writers never store them.
7. **Header/meta** are coerced: names ≤ 64 chars with control and bidi-override characters stripped, ≤ 8 member
   names, numbers finite and clamped, timestamps ISO-8601 or replaced, slot id re-validated. **Thumbnails** must
   be `data:image/(png|jpeg|webp);base64,…` ≤ 64 KiB — `javascript:`, remote URLs, SVG (scriptable) and anything
   else become `null` with a warning.
8. **Migration** (pure, defensive) → **structural validation/repair** of every WorldState field (types, ranges,
   ids, references; broken entries dropped, broken top-level structures fatal) → the engine's `repairWorld`
   (exceptions contained) → validated again.
9. An import is then saved like any other save (verify-before-write, atomic write, backup rotation), so what
   lands on disk is canonical, re-verifiable data.

**Writes** (desktop, `electron/fileStore.ts`): exclusive-create temp file → write → `fsync` → `rename` over the
target (atomic on NTFS; retried ≤ ~2 s on Windows `EPERM`/`EACCES`/`EBUSY` from antivirus/indexer/sync tools; a
read-only attribute on our own file is cleared) → directory `fsync` on POSIX. The save manager keeps the previous
good save as `backup` and falls back to it automatically. Browser backends: one IndexedDB transaction with strict
durability, or one localStorage `setItem`.

## 5. What the checksums do — and do NOT do

Each save carries `payloadSha256 = SHA-256(canonicalJson(payload))` and `headerSha256` over every other field.

**They detect accidental damage:** bit rot, truncated or torn writes, a sync client merging two versions, an
antivirus "repair", a file mangled by an editor, a partial download. A mismatching primary falls back to the
backup instead of loading garbage.

**They are NOT tamper-proofing.** SHA-256 has no key: anyone can edit a save and recompute both hashes
(`untrustedImport.test.ts` does exactly that). A keyed MAC would not help either — the key would have to ship
inside the game, where anyone can read it. This is intentional and fine for a single-player game (T5): the
security goal is that **a hostile file cannot hurt the player**, not that the player cannot change their own
game. Everything in §4 after step 5 exists precisely because a re-sealed file passes the checksums.

Likewise: ASAR integrity (§2) and the SHA-256 asset manifests (`npm run verify:assets`) detect corrupted or
casually modified installs; they are not DRM and do not authenticate the publisher. Only Authenticode signing of
the installer (`CSC_LINK`/`CSC_KEY_PASSWORD`, not configured — builds are unsigned and SmartScreen warns) would
authenticate who built it.

## 6. Packaging (`electron/electron-builder.json`)

* `appId` `com.afterlifelease.game` (also the Windows AppUserModelID), product name "Afterlife Lease".
* NSIS, x64, **per-user** (`perMachine: false`, `allowElevation: false`, `requestedExecutionLevel: asInvoker`),
  assisted (`oneClick: false`), uninstall keeps saves (`deleteAppDataOnUninstall: false`).
* Artifact `AfterlifeLease-Setup-${version}-${arch}.exe` in `release/<version>/`.
* `asar: true`; files: `dist/**` (minus source maps), `electron/dist/**`, `package.json`. The libraries bundled by
  Vite into `dist/` (three, preact) are declared as `dependencies` so the production audit covers them; electron-builder
  would copy production `node_modules` on its own, so `files` starts with `!**/*`, which excludes every node-module
  file (inert for the app's own files) — no `node_modules` ships at all (`tests/unit/electron/packaging.w106.test.ts`
  checks it with electron-builder's own matchers).
* Icon: `electron/build/icon.ico` (16–256 px, generated by `node scripts/make-icon.mjs` from the favicon design;
  `--check` verifies it) for the exe, installer and uninstaller.
* **Auto-update: absent.** `publish: null`, no `electron-updater`; the app never phones home.

## 7. Dependencies and licences (checked 2026-11-05)

* `npm audit --omit=dev`: **0 vulnerabilities** (re-checked 2026-11-06; it now examines the bundled runtime
  libraries `three` 0.180.0 and `preact` 10.29.8).
* `npm audit` (dev tooling only, never shipped): `vitest` 3.2.7 / `tinypool` / `@vitest/mocker` advisories
  (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr, GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 — need an attacker who can
  reach a running Vitest server or pass worker options; fixed in vitest 5.x, a major upgrade) and
  `minimatch` ReDoS (GHSA-g3hv-75wg-m249) inside `electron-builder` (globs are ours). None of this code reaches
  players.
* Bundled into the game: `three` 0.180.0 (MIT), `preact` 10.29.8 (MIT). Shipped runtime: Electron 44.9.3 (MIT;
  electron-builder adds Electron's `LICENSE` and `LICENSES.chromium.html` next to the exe). Minification strips
  licence comments, so every build emits **`THIRD_PARTY_LICENSES.md`** next to `index.html` (Vite
  `build.license`) with the full notices; it ships in `dist/`, the single-file folder and `app.asar`.
  The human-curated overview (incl. build tools and Electron) is `THIRD_PARTY_NOTICES.md` at the repo root.
* Whole lockfile (all dev): MIT, ISC, BSD-2/3-Clause, Apache-2.0, BlueOak-1.0.0, 0BSD, CC0, Python-2.0
  (`argparse`), WTFPL variants (`sanitize-filename` & friends inside electron-builder). No GPL/LGPL/AGPL.

## 8. Verify

| What | Command (bash and PowerShell alike) |
|---|---|
| Platform + security unit tests | `npx vitest run tests/unit/persistence tests/unit/electron` |
| Typecheck (renderer + electron) | `npm run typecheck` |
| Production audit | `npm audit --omit=dev` |
| Icon up to date | `node scripts/make-icon.mjs --check` |
| Built page carries the CSP | `npm run build`, then look for `http-equiv="Content-Security-Policy"` in `dist/index.html` |

Not verifiable in the Linux build container: launching Electron itself (the binary download is blocked —
`main.ts` is tested against a mocked Electron API), the NSIS installer, and ASAR integrity enforcement at runtime.
Run `npm run dist:win` on Windows and start the installed game once before shipping.
