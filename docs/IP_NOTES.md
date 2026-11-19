# Afterlife Lease — IP Notes

Working notes on originality, trademarks and disclosure. These are not legal advice. Have counsel confirm before
any public release or filing.

## 1. Originality

* **Code.** All code in `src/`, `electron/`, `scripts/`, `tools/` and `tests/` was written for this project. The only
  third-party code in the shipped game is the open-source libraries listed in
  [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md): `three` and `preact` (MIT), Vite's preload helper (MIT), and
  the Electron runtime (MIT, with Chromium notices) in the desktop build.
* **3D assets.** The objects, the environment, the classic zombie character, its rig and all animations in
  `public/assets/models/` are generated **procedurally** by our own Python scripts in `tools/blender/` running in
  headless Blender. No asset-store packs, scans or downloaded models are used. Two sets of character bodies are
  **not** procedural: the 25 cast bodies come from the owner's own earlier game (D-004), and the five premium bodies
  (W-152) were made with generative AI services (Meshy for concept images, Tripo for the models and the rig) and then
  processed by our scripts (per-body tool, version, prompt and task ids: `tools/blender/cast/premium/PROVENANCE.md`, D-084); the Rot Row jukebox (`levels/rotrow/jukebox_ghoul.glb`) is adapted from a Meshy model.
  **Open before any public release:** counsel's reading of those services' terms
  (commercial use, ownership of output, disclosure), and the AI-content disclosure the stores ask for (W-095). `public/assets/manifest.*.json` records
  each file's SHA-256, and `tests/unit/models/pipeline.test.ts` can rebuild the GLBs and compare them with the
  committed ones (needs `BLENDER_PYTHON`). Blender's GPL does not cover its output, and `bpy` is not shipped (see
  THIRD_PARTY_NOTICES §3).
* **Audio.** There are no sample files. Every sound effect, the zombie "Groanish" voice, the music and the ambience
  are synthesised at runtime (`src/audio/`).
* **Fonts / images.** No third-party font or image files are shipped. The UI uses system fonts and our own inline
  SVG icons (`src/ui/icons.tsx`, `src/ui/hud/parts/icons.tsx`).
* **Text.** All names, careers, traits, townies, events and UI copy are original (`src/sim/content/**`,
  `src/i18n/en.ts`).

## 2. Trademarks and trade dress

The genre (domestic life sim) and its general mechanics (needs, autonomy, build/buy) are not protectable, but a
specific franchise's names and look are. Rules (also in `docs/GDD.md`):

* Never use **"Sims"**, "The Sims", "Simlish", "Maxis", "EA" or any other franchise name in the game, store pages,
  marketing, file names or metadata. "sim" is fine as a generic short form of *simulation*: the code uses `sim.*`
  identifiers, and copyable diagnostics text says "Sim faults". Do not use it as a product name or in marketing copy.
* **No trade dress:** no green diamond (plumbob) or any gem/marker floating over characters, no gibberish language
  modelled on Simlish (ours is "Groanish", generated from our own phoneme rules), and no copied UI layout, icon set,
  colour scheme, sounds or logo.
* A scan of `src/`, `electron/` and `index.html` at the time of writing found no "Sims", "Plumbob", "Simlish" or
  "Maxis" strings. Only generic `sim` identifiers turned up. Repeat it before each release:

  ```powershell
  Select-String -Path src\*, electron\*, index.html -Pattern 'plumbob|simlish|\bThe Sims\b|\bSims\b|Maxis' -Recurse
  ```

  (`Select-String -Recurse` needs PowerShell 7. On Windows PowerShell 5.1, pipe `Get-ChildItem -Recurse` into
  `Select-String`.)

* "Afterlife Lease" is a **working title**. Clear it before you rely on it: trademark search (USPTO / EUIPO /
  national offices), Steam/itch.io and app-store name search, domain. `electron/electron-builder.json` sets
  `legalTrademarks: "Afterlife Lease"` in the Windows file metadata.

## 3. Ownership and licensing

* `LICENSE` is the MIT licence: Copyright (c) 2026 rblake2320 and the Afterlife Lease contributors. The files it does
  not cover are listed in `CREDITS.md`. `package.json` has `"license": "MIT"` and `"private": true`, so it cannot be
  published to npm by accident.
* `electron/electron-builder.json` writes `"copyright": "Copyright (c) 2026 Afterlife Lease Developers"` into the
  installer and executable metadata. Align it with the LICENSE owner, or the legal entity that will publish, before
  release (owner: PLATFORM).
* Contributions arrive by pull request under the MIT licence (CONTRIBUTING.md).

## 4. Public disclosure

* The repository is public since 2026-11-19; the owner cleared the patent check first (community gate G1).
* CI artifacts (the Windows installer) expire after 14 days (`retention-days: 14` in `.github/workflows/ci.yml`).
