# Contract requests — PLATFORM

All items are implemented with local adapters; nothing here blocks other modules.

## 1. Envelope: add optional `headerSha256` (additive)
`src/persistence/contracts.ts` documents the envelope fields. PLATFORM writes one more field,
`headerSha256 = SHA-256(canonicalJson(all envelope fields except payload and headerSha256))`, so corruption
of header fields (meta, timestamps, name, schemaVersion) is detected too, not only payload corruption.
Readers accept envelopes without it (with a warning). **Request:** mention `headerSha256` in the contract's
envelope comment.

## 2. `repairWorld` in the factory table
PLATFORM calls the engine's semantic repair after structural validation, through a lazy
`import.meta.glob('../sim/index.ts')` (no hard dependency). `src/sim/index.ts` already exports
`repairWorld(state: WorldState): string[]` (in place, returns warnings). The hook also accepts
`{ world, warnings }` or a returned `WorldState`. **Request:** add
`repairWorld(state: WorldState): string[]` to the `src/sim/index.ts` row in docs/CONTRACTS.md so the signature
is pinned. (`createSimulation` repairs again; both are idempotent.)

## 3. Dependencies / package.json (PLATFORM-owned) — FYI
* Added devDependencies (authorized by the PLATFORM brief, ≥ 2 weeks old at install time, resolved with
  `npm install --before=2026-10-22`): `electron@44.9.3`, `electron-builder@26.18.0`.
* `overrides.electron["@types/node"] = "$@types/node"` keeps a single `@types/node@22.20.5` (electron asks for
  ^24, which would load two conflicting Node typings).
* `three@0.180.0` and `preact@10.29.8` moved from `dependencies` to `devDependencies` with **unchanged pins**:
  Vite bundles them, and electron-builder packs every production dependency's `node_modules` into the
  installer (~30 MB of unused three.js sources otherwise).
* `"main": "electron/dist/main.js"` (Electron entry); scripts added: `electron:build-main`, `electron:dev`,
  `electron:start`, `dist:win`, `verify:assets`, `test:platform`; `build:single` now runs
  `scripts/inline-build.mjs` (Vite `--mode single`).

## 4. Build-time version constant — FYI for GAME
`__AFTERLIFE_VERSION__` (package.json `version`) is defined in vite.config.ts and vitest.config.ts and declared in
`src/persistence/env.d.ts`; `GAME_VERSION` is exported from `src/persistence/index.ts`. `src/game/version.ts`
can switch to it instead of a hand-maintained constant.

## 5. Slot ids are case-insensitive — FYI for GAME / UI
Slot ids are canonicalized to lowercase (`SaveSlotInfo.slotId` is always lowercase) because desktop saves are
files on case-insensitive file systems. Windows device names are refused everywhere (GAME's `isValidSlotId`
already matches).

## 6. Desktop quit semantics — FYI for GAME
Closing the window (X / Alt+F4) hides it, dispatches a synthetic `beforeunload` in the page and waits until
storage IPC is quiet (400 ms, max 6 s) before exiting — GAME's existing `beforeunload` best-effort autosave is
exactly what is needed. `beforeunload` may therefore run twice (synthetic + real); both are best-effort and the
second one finds nothing dirty. `afterlifeNative.quit()` exits immediately.

## 7. Thumbnails — FYI for RENDER / GAME
`SaveMeta.thumbnail` must be a `data:image/(png|jpeg|webp);base64,…` URL of at most 64 KB; anything else is
stored as `null` (the load menu renders it in `<img>`, so other schemes are refused).


---
**RESOLVED by integration lead:** #1 headerSha256 documented in src/persistence/contracts.ts. #2 repairWorld signature pinned in docs/CONTRACTS.md factory table. #3–#7 accepted and recorded under "Resolved contract decisions" #7.

## 8. Quit flush now uses an explicit idle signal — FYI for GAME (no contract change)
Decision #7 says the Electron close "waits for storage IPC to go quiet". That heuristic lost the final save when a
big save spent > 400 ms computing (hash/gzip/verify) between two storage calls. The desktop shell now dispatches
`beforeunload` and then awaits `globalThis.__afterlifeLeasePersistence.whenIdle({ quietMs: 500, timeoutMs: 5000 })`
(installed by `createSaveManager` / `createProfileStore`; every persistence call counts from call to settle). GAME's
existing behaviour is exactly right; the only requirement is unchanged in spirit: start the quit save (call
`saves.save`) within ~500 ms of `beforeunload` (today it starts within microseconds), and keep handlers idempotent.
Pages without the hook fall back to the old IPC-quiet rule; hard cap 7 s.

## 9. Reserved keys are never persisted — FYI for SIM-ENGINE / GAME (no contract change)
Object keys `__proto__`, `constructor`, `prototype` anywhere in a WorldState or a profile value are left out of the
save (console warning names the path) and dropped on load. Before this fix such a key made the save refuse to write
("self-check failed") forever, and a profile record unreadable. Do not use these as map keys (flags, counters, data).
