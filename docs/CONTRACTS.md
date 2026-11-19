# Build Contracts & Ownership (read this first)

Project: **Afterlife Lease** — TypeScript + Three.js + Preact + Vite; assets from headless Blender (`bpy` 5.2.3 at
`/home/user/.venvs/blender/bin/python`); ships as web build (itch.io/Steam via Electron).

## Source-of-truth files (owned by the integration lead — DO NOT EDIT; request changes instead)
- `src/shared/dimensions.ts` — physical conventions, rotation math
- `src/shared/appearance.ts` — appearance, limbs, animation state names, expressions, carry items
- `src/shared/catalog.ts` — physical object specs: ids, footprints, slots, surfaces, lights, dynamic parts, model notes
- `src/shared/styles.ts` — wall/floor styles
- `src/shared/audioIds.ts` — SFX ids, voice emotions, music moods
- `src/sim/types.ts` — WorldState (save format)
- `src/sim/contracts.ts` — engine/spatial/content/systems seams + SimulationAPI
- `src/sim/rng.ts`, `src/sim/time.ts`
- `src/render/contracts.ts`, `src/audio/contracts.ts`, `src/persistence/contracts.ts`, `src/game/contracts.ts`
- `docs/GDD.md` (design numbers), `docs/ART_DIRECTION.md`

If a contract is wrong or missing something you need: write `docs/contract-requests/<your-module>.md` describing the change,
then work around it locally (adapter/shim inside your own files) so you are not blocked. Never silently diverge.

## Module ownership (each agent writes ONLY inside its paths + its tests)
| Module | Paths |
|---|---|
| SIM-SPATIAL | `src/sim/spatial/**`, `tests/unit/spatial/**` |
| SIM-ENGINE | `src/sim/engine/**`, `src/sim/index.ts`, `tests/unit/engine/**` |
| SIM-HOME | `src/sim/content/home/**`, `src/sim/systems/home/**`, `tests/unit/home/**` |
| SIM-PEOPLE | `src/sim/content/people/**`, `src/sim/systems/people/**`, `tests/unit/people/**` |
| RENDER | `src/render/**` except `contracts.ts`, `src/render/models/**`, `src/render/characters/**`; `tests/unit/render/**` |
| ASSETS-OBJECTS | `tools/blender/objects/**`, `tools/blender/common/**`, `public/assets/models/objects/**`, `src/render/models/**` |
| ASSETS-CHARACTERS | `tools/blender/characters/**`, `public/assets/models/characters/**`, `src/render/characters/**` |
| AUDIO | `src/audio/**` except `contracts.ts`; `tests/unit/audio/**` |
| UI-SHELL | `src/ui/shell/**`, `src/ui/theme/**`, `src/ui/common/**`, `src/ui/icons.tsx`, `src/ui/hooks.ts`, `src/ui/App.tsx`, `src/i18n/**` |
| UI-HUD | `src/ui/hud/**` |
| PLATFORM | `src/persistence/**` except `contracts.ts`; `electron/**`; `scripts/**`; `tests/unit/persistence/**`, `tests/unit/electron/**` |
| GAME | `src/game/**` except `contracts.ts`; `src/main.tsx`; `index.html`; `tests/unit/game/**` |

`package.json` / `vite.config.ts` / `tsconfig.json` are PLATFORM-owned (others: contract request). Each module also owns `dev/<module>.*`.
Preemption: the preexisting entries in `package.json` (three 0.180.0, preact 10.29.8, vite 7.3.7, vitest 3.2.7, typescript 5.9.3) are pinned — do not upgrade.

Also source-of-truth: `src/sim/vocabulary.ts` (engine-guaranteed effect/requirement/interaction/behaviour ids + priorities).

## Factory entry points (exact names — everyone codes against these)
| File | Export |
|---|---|
| `src/sim/index.ts` (SIM-ENGINE) | `createNewWorld(opts: NewGameOptions): WorldState` · `createSimulation(state: WorldState): SimulationAPI` · `loadContent(): ContentRegistry` · `LOT_TEMPLATES: LotTemplate[]` · `repairWorld(state: WorldState): string[]` (in place, idempotent, returns warnings) |
| `src/sim/spatial/index.ts` (SIM-SPATIAL) | `createSpatial(getState: () => WorldState, content: ContentRegistry): SpatialAPI` · `createBuildService(ctx: SimContext): BuildService` · `createLotTemplate(id: 'starter'\|'empty'): { lot: LotState; objects: { defId: string; placement: ObjectPlacement; tint?: string \| null }[] }` · `LOT_TEMPLATE_INFO: LotTemplate[]` · edge helpers `edgeKey, parseEdge, edgeBetween, edgeSides, rectEdges, wallLocalToWorld` |
| `src/sim/content/home/index.ts` (SIM-HOME) | `homeContent: ContentModule` |
| `src/sim/systems/home/index.ts` (SIM-HOME) | `homeSystems: SimSystem[]` |
| `src/sim/content/people/index.ts` (SIM-PEOPLE) | `peopleContent: ContentModule` |
| `src/sim/systems/people/index.ts` (SIM-PEOPLE) | `peopleSystems: SimSystem[]` |
| `src/render/index.ts` (RENDER) | `createRenderer(deps: { models: ModelLibrary; characters: CharacterFactory }): RendererAPI` |
| `src/render/models/index.ts` (ASSETS-OBJECTS) | `createModelLibrary(opts: { baseUrl: string }): ModelLibrary` |
| `src/render/characters/index.ts` (ASSETS-CHARACTERS) | `createCharacterFactory(opts: { baseUrl: string }): CharacterFactory` |
| `src/audio/index.ts` (AUDIO) | `createAudio(): AudioAPI` |
| `src/persistence/index.ts` (PLATFORM) | `createSaveManager(): Promise<SaveManager>` · `createProfileStore(): ProfileStore` |
| `src/ui/App.tsx` (UI-SHELL) | `App(props: { game: GameController })` |
| `src/ui/hooks.ts` (UI-SHELL) | `GameContext`, `useGame(): GameController` (re-renders on controller notifications) |
| `src/ui/hud/Hud.tsx` (UI-HUD) | `Hud()` — mounted by App on the 'game' screen; also renders HUD dialogs: phone, careers, invite, rewards, household |
| `src/game/controller.ts` (GAME) | `createGameController(deps: { renderer: RendererAPI; audio: AudioAPI; saves: SaveManager; profile: ProfileStore }): GameController` |

Spatial helper conventions (resolved from docs/contract-requests/sim-spatial.md): `wallLocalToWorld(edge, side, px, pz)` returns the world point
plus `facing` = yaw of the wall item's front (inward normal) — use directly as `rotation.y`; its frame is a 1×1 footprint on the mounted tile
(rotation h1→0, h0→2, v1→3, v0→1). `openingFrame(edge)` returns the edge midpoint + yaw putting local +X along the edge and local +Z toward
side 1 (`h` → 0, `v` → π/2). Invalid keys → NaN coordinates (never throw). `BuildService` costs are signed (refund < 0).

Base URL for assets: `import.meta.env.BASE_URL + 'assets/'` (works on file://, http, sub-paths).
Dev harness pages live under `dev/<module>.html` (owned by that module) and are served by `npx vite` (port 5173 is GAME's; use `npx vite --port <unique> --strictPort`: RENDER 5174, ASSETS-OBJECTS 5175, ASSETS-CHARACTERS 5176, UI-SHELL 5177, UI-HUD 5178, AUDIO 5179).
Playwright + Chromium are preinstalled: `require('playwright')` works from any directory; `chromium.launch()` needs no options (add `args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']` for WebGL).

## Resolved contract decisions (binding — implement these)
1. **System api binding** (from sim-home R1): `ctx.sys(id)` returns a per-simulation wrapper; every call becomes
   `api[method](...callerArgs, ctx)` with the invoking simulation's SimContext appended LAST. SIM-ENGINE implements the
   wrapper (cache one wrapper per system per engine); SIM-HOME / SIM-PEOPLE api functions take that trailing `ctx` and
   must not rely on module-level "current ctx" state (remove heuristics like ctxRegistry once the engine binds ctx;
   keep them only as a fallback when the trailing arg is absent).
2. **Preservation trend split** (sim-home C1): `sys('decay').preservationPerHour(agentId)` = home-owned per-hour change;
   the engine adds the active stage's needsPerHour on top for NeedView.trend.
3. **Coffins halt decay** (sim-home C2): `ObjectDef.params.sleepDecayMult` = 0 for all coffins (pine/chill-rest/cryo,
   powered or not), 0.5 for the normal bed, burial plot, floor and sofa naps. Refrigerated/cryo add restore on top.
4. **Vain mood** belongs to SIM-PEOPLE moodModifiers; `freshAsADaisy` (home) is the general freshness ≥ 90 moodlet.
5. **Self-consuming runs** (sim-home C4): behaviours that remove their own target defer the removal to `end()`.
6. Spatial clarifications in docs/contract-requests/sim-spatial.md items 1–8 are binding (now documented in contracts.ts).
8. **SkillDefs are ENGINE-owned** (sim-people R1 → option a): SIM-PEOPLE must not register skills (delete the
   REGISTER_PEOPLE_SKILLS switch and the unused PEOPLE_SKILLS export, or have the engine adopt its flavour text).
9. **Load determinism** (sim-people C5): repairWorld must be a true no-op on a healthy world — it may bump
   lot.version/wallVersion/floorVersion or touch path caches ONLY when it actually changed lot structure. Contract:
   `serialize(createSimulation(JSON.parse(JSON.stringify(world))))` deep-equals `serialize(world)` for any healthy world,
   and stepping both N ticks yields identical states (save → load → continue is deterministic).
10. **Preservation at work** (sim-people C2): HOME's decay system ticks `atWork` zombies' preservation; careers applies
   only the GDD §10 away rates for the other needs. Carpool hint: `state.flags['people:carpool:until']` (tick) — RENDER
   may idle `env_hearse` at the first entry point while it is > state.tick.
11. **Phone params** (sim-people C4): phone_inviteOver {townieId}; phone_throwParty {guests?: 'a12,a15'}; phone_findJob
   {careerId}; others none. Menu children: invite → townies; findJob → careers; others `children: []`.
12. **Non-adjacent socials** (sim-people C7): a social may use `{kind:'tileNear'}` (e.g. social_waveOver) and then runs
   without engine_respond; the social behaviour handles the target's reaction.
13. **KNOWN BALANCE ISSUE for phase 2** (sim-people C6): under full autonomy with no player input, zombies crumble around
   day 5–7. To be tuned in the integration balance pass (preservation autonomy weighting / critical self-preservation
   override / decay rates / starter-home restorer) — do not hack around it inside individual modules now.
   **RESOLVED (balance pass)** — no crumbles in 14 unattended days (5/5 seeds, normal; 10/10 independent seeds
   1001–1010 after the review round; 30/30 on seeds 1001–1010, 2001–2010 and 3001–3010 after review round 2, which
   added Chill Out and the engine's daily cap on non-essential picks); see docs/BALANCE.md, GDD §18.
14. **RENDER directives from asset/audio requests**: (a) keep ModelLibrary's per-mesh `castShadow` flags (it already
   disables shadows on glass/water/flames/glows/screens) — only force `castShadow=false` for rugs; (b) set a dim PMREM
   `RoomEnvironment` as `scene.environment` (≈0.35 day / 0.12 night) so metals don't render black; (c) call
   `rig.setMoveSpeed(actualTilesPerSec / 1.3)`; the rig auto-substitutes limp/crawl and mirrors right-handed clips when
   limbs are missing — the renderer just passes agent.anim; (d) pass `inUse: true` for doors while an agent walks
   through to swing the leaf; (e) decorative candles on table_wake / tv_seance are `userData.alwaysOn` (no light spec);
   (f) manifests are per-module: `manifest.objects.json` + `manifest.characters.json` (no combined file); (g) the
   carpool hearse hint in decision #10.
15. **Characters**: sit anchor = seat contact (pelvis bone origin) at SEAT_HEIGHT; eye meshes `Eyes_<style>`; triangle
   budget 14k total (≈4k visible). **Audio**: setGameSpeed takes the Speed index; optional `stats()` + `moon` ambience
   flag added to AudioAPI; `createAudio(options?)` accepts test/dev options.
7. **Platform** (docs/contract-requests/platform.md): envelope `headerSha256` (optional) is part of the format; slot ids
   are lowercase; SaveMeta.thumbnail is a data:image (png|jpeg|webp) URL ≤ 64 KB else null; `__AFTERLIFE_VERSION__` /
   `GAME_VERSION` (from src/persistence/index.ts) is the single version source — GAME should use it; Electron window
   close dispatches a synthetic `beforeunload` and waits for storage IPC to go quiet, so `beforeunload` handlers must
   be idempotent (may run twice).

## Content registration
- SIM-HOME exports `homeContent: ContentModule` from `src/sim/content/home/index.ts` and `homeSystems: SimSystem[]` from `src/sim/systems/home/index.ts`.
- SIM-PEOPLE exports `peopleContent: ContentModule` from `src/sim/content/people/index.ts` and `peopleSystems: SimSystem[]` from `src/sim/systems/people/index.ts`.
- SIM-ENGINE's `src/sim/index.ts` imports both and exports `createNewWorld(opts)`, `createSimulation(state)`, `loadContent()`.
- Interaction ID prefixes: home `home_*` (object interactions), people `social_*`, `phone_*`, `career_*`, `visit_*`; engine generic `engine_*` (e.g. `engine_goHere`, `engine_idle_*`).
- Moodlet / trait / effect / requirement / behaviour ids must be globally unique; prefix-free names are fine but check with `rg`.
- Effect & requirement vocabulary: engine provides the generic set listed in `src/sim/engine/README.md` (SIM-ENGINE writes it early);
  domain modules register their own via `SimSystem.effects/requirements/behaviors`. A content file may only reference ids that
  some module registers — the engine's content validator (`validateContent`) fails tests on unknown ids.

## Engineering rules (all agents)
- TypeScript strict; no `any` leaks across module boundaries; no `Math.random()`/`Date.now()` in `src/sim/**` (use ctx.rng / tick).
- Simulation must be deterministic, JSON-serializable, and fault-contained (a throwing system/interaction is logged and aborted, never crashes the tick).
- No new npm dependencies without a contract request. Allowed: `three` (incl. `three/examples/jsm/*`), `preact`, `preact/hooks`.
- Every module ships tests (vitest) including **adversarial** cases (bad inputs, NaN, missing ids, interleavings) — not just happy paths.
- Verify with: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E '^src/(your/path)'` (others' files may be mid-edit — ignore their errors),
  and `npx vitest run tests/unit/<your-dir>`.
- Keep files < ~900 lines; split by concern.
16. **UI-HUD ↔ GAME** (docs/contract-requests/ui-hud.md): GameController gained `ultraAllowed`, `rotateCamera(dir)`,
   `focusObject(id)`, `buyReward(agentId, rewardId)`, `renameHousehold(name)`, `markNotificationsRead()`, and
   `BuyState.hoverObjectId` — GAME implements them; the HUD switches its local shims to them (the UI must not call
   sim.dispatch directly). Toasts: HUD owns visible lifetime; controller TTL is a ≥ 60 s safety net. Hotkey ownership
   rule documented above KEYMAP. Hint anchors: `[data-hint-anchor~="<token>"]` (list in ui-hud.md H7). HUD strings
   live in src/ui/hud/strings.ts under the `hud.` prefix (registered via the shell's registerStrings). UI-SHELL: give
   `.ui-icon` `max-width: none` by default (H11). BillsView.outstanding/overdue are DOLLAR amounts.
17. **UI-SHELL ↔ GAME/ENGINE** (docs/contract-requests/ui-shell.md): GameController gained `appVersion`, `content`
   (ContentRegistry loaded at boot), `validateCazDetailed()`, `dialogOptions` + `openDialog(d, opts?)`; `version` is a
   change counter. `NewMemberSpec.voiceSeed?` → SIM-ENGINE's createNewWorld must honour it (AgentState.voiceSeed);
   GAME passes the same seed the CAZ preview used. GAME seeds `reduceMotion` from `prefers-reduced-motion` on first run
   (no saved profile). Controller key handler early-returns on `e.defaultPrevented`. Shell-relied behaviours in
   ui-shell.md ("Behaviour the shell relies on") are binding for GAME.
18. **SIM-ENGINE** (docs/contract-requests/sim-engine.md): `SimContext.failRun(agent, reason)` added (systems use it
   to fail a run with a player-facing reason; `interrupt` stays a graceful cancel). `SimulationAPI.repairWarnings`
   added (GAME shows a "save was repaired" toast when non-empty). `ActiveInteraction.data` keys starting with `_` are
   engine-reserved. SkillDefs: ENGINE-owned (decision #8). DecayApi.preservationPerHour? (decision #2).
19. **GAME** (docs/contract-requests/game.md): GameController gained `lotTemplates`, `gameOverReason`, `boot(canvas)`,
   `dispose()`; validateCazDetailed field union adds 'household' | 'appearance'. RENDER: `setPixelRatio(ratio)` added;
   `pickGrid` fx/fz are ABSOLUTE world coordinates; zoom/panWorld units documented. PLATFORM: autosaves must not block
   on the cross-window lock — use Web Locks `ifAvailable` (caller retries with backoff) for autosave, ≤ 30 s wait for
   manual saves; Electron BrowserWindow `webPreferences.backgroundThrottling = false`. Notification kinds (so the
   controller's merge-dedupe yields one toast + one sound): skill level-ups → 'skill', promotions/firing/job changes →
   'career', aspiration milestones → 'good', relationship milestones → 'romance' or 'social'. All §2 [fyi] semantics
   in game.md are binding for UI modules (screen flow, auto-pause holds, '__game_select' menu entry, phone vocabulary,
   hint anchors, quit safety, slot naming).
20. **RENDER** (docs/contract-requests/render.md): snapshot() = JPEG ≤ 64 KB; `SimulationAPI.decayLevel?(agentId)`
   (engine delegates to sys('decay')); `BuildOverlay.hoverEdge?`; rotateCamera(+1) = clockwise from above;
   `ModelLibrary.release?(instance)`; ASSETS-OBJECTS must not mutate materials at runtime outside dynamic-part nodes and
   'Paint' slots (renderer statically batches everything else per object); lamps-on window = lighting lamp factor ≥ 0.5.
21. **SIM-SPATIAL hardening addendum** (sim-spatial.md H1–H6) is binding: removeObject reasons are player-facing
   sentences; interrupt() of a run-phase agent is deferred via 'exit' and keeps the reservation until it ends; build
   ops keep still-bound reservations and drop stale ones; BuildService refuses re-entrant apply/undo/redo.
   ENGINE POLICY: runs already gracefully cancelled (in 'exit' phase) must NOT raise "couldn't…" failure notifications
   when their object is removed — only runs still routing/waiting/running do.
22. **UI-SHELL hardening** (ui-shell.md H1–H5): GameController gained `lastSavedAt` + `lastSaveFailed`; `lastSaveLabel`
   is a complete phrase (show verbatim). saveGame accepts UI-minted fresh slot ids for "New save" (default slot =
   quick-save). Toasts: HUD hosts them on 'game', the shell on every other screen. GAME must emit
   validateCazDetailed fields 'household' (lot/difficulty/member count) and 'appearance' (corrupt look) per #19.
23. **Static batching invariants** (render.md #9–#11, binding): the renderer batches per object (root batch incl.
   `Paint`/double-sided/static-glow meshes; per-node sub-batches for `door`/`flag`/`pump`/`water`/`frost`/`serving_N`
   and per-child `speaker`/`broken` groups; one glass batch) and merges floor/loose root batches into 8×8-tile lot
   chunks. ASSETS-OBJECTS MUST: animate those nodes only via transform/visibility; never mutate or swap materials of
   meshes under them; keep recolourable slots named exactly `Paint` and SWAP (never mutate) their materials (immutable
   cached variants). Never-batched: `screen`/`glow`/`bulb`/`flame`/`canvas` subtrees, textured/alpha-tested/skinned/
   morph meshes. ASSETS-CHARACTERS: rigs must not assume `root.visible` stays true between update() calls (renderer
   frustum-hides whole rigs). Doors: `inUse` while a zombie is within 0.45 tiles of the door centre or moving within 1.0.
