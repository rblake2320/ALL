# Contract requests — economy / quests (SIM side)

Owner of this file's changes: quests agent (src/sim/systems/quests/**, src/sim/content/quests/**, tests/unit/quests/**).
`src/shared/economy.ts` is **unchanged** (QuestRewardGrant is used as-is). All changes below are ADDITIVE.

## Q1. `WorldState.quests?: QuestsState` (src/sim/types.ts) — DONE (additive, optional)
Types `QuestsState`, `QuestInstanceState`, `ObjectiveProgress`, `QuestGrantRecord`. Optional so every existing
WorldState literal/fixture compiles and pre-quests saves load with zero warnings (the system creates it on init).
Persistence: `src/persistence/validation/questsSchema.ts` + one entry in `worldShape`; `validateWorld` now skips an
`undefined` field result instead of writing `key: undefined` (canonical JSON rejects undefined) — one-line change in
`src/persistence/validation/index.ts`. SAVE_SCHEMA_VERSION unchanged (no migration needed).

## Q2. Engine seams (src/sim/contracts.ts + src/sim/engine) — DONE (additive)
- `SimSystem.onEvent?(ctx, e)` — synchronous observer of every `ctx.emit` (FIFO queue for nested emits, bounded cascade,
  fault barrier). Implemented in engine/context.ts; documented in engine README §12.
- `SimEvent` `interactionCompleted {uid, agentId, interactionId, targetId, source, household, params}` emitted by
  `finishRun(complete)` (engine/runner.ts). Consumers that switch on event type ignore it (default branches).
- `SimEvent` `questStarted | questProgress | questCompleted` (questCompleted carries `grant: QuestRewardGrant`).
- `Command {type:'quest'; action:'abandon'|'pin'|'unpin'; questId}` → `sys('quests').command`.
- `SimulationAPI.quests?(): QuestsView | null` → `sys('quests').view`; `QuestsApi` {view, grants, command}.
- Content types `ObjectiveDef`, `QuestDef`, `QuestStepDef`, `QuestRewardDef`, `QuestView`, `QuestStepView`, `QuestsView`.
- `allSystems()` (src/sim/index.ts) appends `questSystems` LAST.

## Q3. Grant-id wording — PLEASE UPDATE docs/MONETIZATION.md §2
Spec text says `<saveId>:<questId>:<instance>`. The sim has no save-slot id; implemented as
`<worldId>:<questId>:<instance>` where `worldId` (QuestsState.worldId) is derived once from the world itself and stored.
Effect vs. a slot id: copies of a save share grant ids (copy-a-save farming pays nothing twice) and replaying/reloading
always maps to the same id. Requested doc edit: "`<worldId>:<questId>:<instance>` (worldId = state.quests.worldId)".

## Q4. Game layer (fyi, binding for GAME/economy)
- Convert `questCompleted.grant` into a ledger grant keyed by `grantId`; on every load also reconcile with
  `sys('quests').grants()` / `state.quests.grants` (a grant recorded in a save whose event was lost to a crash).
- Daily tasks: reuse `src/sim/systems/quests/objectives.ts` + `DAILY_TASK_POOL` + `pickDailyTasks` (already consumed by
  src/economy/daily.ts). Feed drained events to `observeObjectiveEvent` and call `evaluateObjectiveState` periodically.
- HUD: `sim.quests()` view (active quests with steps/progress/reward, story progress, recent grants, pinned id).

---

# Contract requests — ECONOMY / GAME side (Bones ledger, store, packs, sponsor skins)

Owner module: ECONOMY — `src/economy/**`, `src/packs/**`, `src/ui/store/**`, `scripts/build-pack.mjs`,
`dev/economy.*`, tests in `tests/unit/{economy,packs,ui-store}/**`. Spec: `docs/MONETIZATION.md` (source of truth).
Everything below is implemented unless marked **OPEN** (needs another module's owner).

## E1 — `src/shared/economy.ts` (additive only)
- `SkuKind` gains `'subscription'` (Afterlife+, §8).
- `StoreSku.priceUsdCents` is documented for GG packs **and** the few directly priced offers (Starter Pack, Afterlife+);
  it is never set together with `priceGG` (asserted by tests).
- New optional `StoreSku` fields: `bonusGG` (pack bonus, informational), `firstPurchaseDouble` (§8 "first-purchase
  double"), `oncePerAccount` (Starter Pack).
No existing field changed meaning; `LedgerEntry`, `WalletView`, `CatalogEntry`, `BrandSkin`, `AdSurfaceCreative`,
`QuestRewardGrant` are used exactly as declared.

## E2 — GameController / KEYMAP (`src/game/contracts.ts`, additive)
- `GameController.economy?: EconomyFacade | null` (`src/economy/facade.ts`). The UI talks to the economy only through
  it. `createGameController(deps)` accepts `deps.economy` (created in `src/main.tsx` via `createEconomy()`).
- `DialogId` gains `'store'` (pausing, like the other system dialogs; `src/game/gameplay.ts` lists updated).
- `KEYMAP.store = ['KeyG']` — controller-owned, follows the ownership rule above KEYMAP (ignored when
  `defaultPrevented`, in editable targets or inside menus/dialogs); handled in `runAction` (opens the store in game).
  Help/Settings list it (KeyMapTable 'general' group, `keys.store`).
- `startPlacing(defId)` (also the eyedropper copy) refuses catalogue-locked items: a Bones-tier item opens the store
  focused on it; a premium item plays the error sound (it is hidden in Buy mode anyway).
- Frame hooks (`src/game/frame.ts`): `economy.onSimEvents(sim, drainedEvents)` for the PLAYED world only (never the
  menu demo) and `economy.onFrame(sim)`; both behind `c.guard`. The economy only reads the world — the sim stays
  byte-deterministic (asserted: a world stepped with and without the economy serialises identically).

## E3 — **OPEN (UI-SHELL/CAZ owner)**: cast-body entitlements in Create-a-Zombie
Body tiers are declared (`src/economy/catalog.ts`: bosses + clown = Bones, Goldie = premium) but
`BODY_UNLOCKS_LIVE = false`: until the CAZ body picker enforces entitlements every body stays usable and the store's
Bodies tab shows "Coming soon" instead of selling something the player can already use (FTC: no deceptive offers).
Request: in `src/ui/shell/screens/caz/CazBodyPicker.tsx` lock bodies with
`game.economy?.isUsable('body:<id>') === false` (show the lock + "Unlock in store" → `economy.focusStore('bodies',
'body:<id>')` + `openDialog('store')`), and refuse them in `startGame` validation; then flip `BODY_UNLOCKS_LIVE`.

## E4 — **OPEN (RENDER owner)**: brand-slot rendering hook
Pure resolver: `brandSkinFor(objectDefId): BrandSkin | null` (`src/economy/brands.ts`, re-exported from
`src/economy/index.ts`). Requested renderer behaviour:
1. When building an object instance (and the `env_hearse` env model), call `brandSkinFor(defId)`.
2. `livery.Paint` → swap the `Paint` slot to an immutable cached material variant (decision #23 — never mutate);
   other livery keys (`trim`) map to optional `Brand_<key>` material slots when the model has them.
3. `decals.logo` → texture (path relative to the pack root; built-in house brands ship it in the `house-brands` pack)
   on an optional `brand_logo` plane node; absent node = no decal.
4. Kill switch: `setBrandsEnabled(false)` / `setBrandSkinDisabled(id)` must take effect on the next lot rebuild
   (subscribe or poll a version counter — ECONOMY will add `brandsVersion()` on request).
5. Ad surfaces (`adCreativesFor(surface, bracket)`): TV screen (`tv_crt` 'screen' node), billboard/bus stop/magazine
   when those props exist. House-brand creatives only; never personalised.

## E5 — **OPEN (owner decision)**: GG ladder observations (MONETIZATION.md §8)
- §1 says GG real-money equivalents use the cheapest pack's rate (Pocket Change, 0.99 ¢/GG). Implemented exactly.
  Note: **Handful ($4.99 / 500 GG = 0.998 ¢/GG) is worse per GG than Pocket Change**, so a larger pack is the worse
  deal — consider $4.95 or 505 GG.
- §8 says Season Lease (950 GG) is "bought exactly by the $9.99 pack" — that pack holds 1,100 GG (150 left over).
  The store offers an exact top-up (`exactTopUp`) wherever the balance is short; consider 1,100 GG for the season or a
  950 GG pack.
- "72 h after first launch" for the Starter Pack is implemented as *always available, once per account* (no countdown
  or time pressure is shown — §6 "no FOMO"). Confirm.

## E6 — Ledger persistence design (deviation note)
§2 says the ledger is "written with the existing atomic/crash-safe ProfileStore". The ledger uses the same storage
backend and the ProfileStore's rotate-to-backup + checksum + self-check pattern, but under its own keys
(`economy:ledger:primary|backup|quarantine`) because recovery must inspect BOTH copies and verify the hash chain
(`ProfileStore.load` returns one merged value and cannot report which copy it used). The high-water mark
(`economy-ledger-hwm`) IS a ProfileStore record, written after the ledger, so truncation is detected. Cross-window
safety: every append re-reads storage under `Mutex` + Web Locks (`afterlife-lease:economy-ledger`) and BroadcastChannel
refreshes other windows. GG never enters the local ledger (rejected as tampering).

## E7 — Quests integration (coordinated with the sim quests system)
- Grants: `questCompleted.grant` (QuestRewardGrant) → ledger key = `grantId`. Reconciliation: every
  `QuestsState.grants` record of a loaded world is re-requested once per world (duplicates refused), so a crash between
  completion and the ledger write never loses a reward.
- Achievements: milestone / promotion / skill-level grants keyed by `QuestsState.worldId` (fallback `w<seed>`).
- Daily tasks use the sim's `DAILY_TASK_POOL`, `pickDailyTasks` and objective evaluator on the drained event stream +
  1 Hz state evaluation (`src/economy/daily.ts`); the weekly-challenge pool is game-side and passes the sim's daily
  validator (except the reward band).
- Worlds with `flags.cheated` earn no Bones.

## E8 — Phase 4 seams
`GGWallet` (`src/economy/wallet.ts`): `ServerWallet` stub (signed out, every GG/real-money purchase →
"Sign in to buy (coming soon)"); `DevWallet` only behind `import.meta.env.DEV`, absent from production bundles
(`tests/unit/economy/bundle.test.ts` builds and scans the bundle). Teen spend tracking (`spentThisMonthCents`) is
server-reported in Phase 4 (0 offline). Rewarded ads: policy only (`rewardedAdAllowed`), no SDK.

## E9 — Content packs
`pack.json` schema + verifier + all-or-nothing registry in `src/packs/**`. `scripts/build-pack.mjs` builds the signed
first-party `house-brands` pack into `dist-packs/` (gitignored). The key is always explicit: without `--key` or `--dev`
the script refuses to sign (security review L-8). Dev signing key (`--dev`): generated on first run into
`.keys/dev-publisher.ed25519.json` (gitignored); `vite dev` trusts it with `VITE_DEV_PACK_PUBKEY`. Production key:
`PRODUCTION_PUBLISHER_KEYS` in `src/packs/keys.ts` is a placeholder (ignored) until the release key exists; sign with
`--key <path>` from the signing environment. **OPEN (GAME)**: the game does not auto-load packs yet (no pack source
in Phase 2); `verifyPack` + `PackRegistry` are ready for a loader. Content kinds other than `brandSkins` are refused
(never half-loaded) until their registries exist.

## E10 — Shared-file touches (all additive, re-read immediately before editing)
`src/game/{contracts,controller,core,frame,gameplay}.ts`, `src/main.tsx`, `src/ui/App.tsx` (`<StoreLayer/>`),
`src/ui/shell/screens/MainMenu.tsx` (Store item), `src/ui/shell/KeyMapTable.tsx`, `src/i18n/en.ts`
(`keys.store`, `menu.store*`), `src/ui/hud/buy/BuyCatalog.tsx` (premium hidden, Bones lock chip),
`tests/unit/game/{contract.conformance,controller}.test.ts` (member/keymap inventories), `.gitignore` (`.keys/`).

---

# Review R-series — independent adversarial review of the economy foundation (2026-11-05)

Each item was reproduced first (failing assertion), then fixed at the root; regressions in
`tests/unit/economy/review.test.ts`.

## R1 — FIXED: a transient storage READ error wiped the Bones ledger
`LedgerStore.readLocked` turned a throwing `backend.read` into "record missing" → state `corrupt`, empty chain → the
next `append` wrote a fresh one-entry chain over the player's history and lowered the high-water mark to match, so the
following load reported `ok` (repro: 5 entries / 500 Bones → 1 entry / 1 Bone, silently). Fix: read errors propagate;
`load()` reports the new status **`unavailable`** (WalletView.ledgerOk = false; analytics `ledger_issue`), `append()`
fails `io` (the grant queue retries), `writeLocked` never overwrites a primary it could not read, and a damaged primary
is written to `economy:ledger:quarantine` before being replaced. The service re-tries a load every 5 s while
`unavailable`. `LedgerStatus` gained `'unavailable'` (economy-internal type; additive).

## R2 — FIXED: the story finale cosmetic could never be granted (two entitlement grammars)
`story_party` rewarded `cosmetic:frame_boneGilded`; the sim validator allowed `[a-zA-Z0-9_.-]`, the ledger only
`[a-z0-9_]`, so the economy silently dropped it. Fix: ONE grammar, `ENTITLEMENT_ID_RE` in `src/shared/economy.ts`
(additive export), used by the ledger (`ENTITLEMENT_RE` is now an alias) and grants; the sim validator now requires
`cosmetic:[a-z0-9_]{1,64}` (a subset). Content renamed to `cosmetic:frame_bone_gilded` (pre-ship; no save carries it).

## R3 — FIXED: an edited save / ledger could unlock Grave-Gold-only content and mint Bones
Reconciliation trusted `state.quests.grants` (save data) for amounts (≤1000 each, 256 records → 51,000 Bones in the
repro) and entitlements (`rug_funeral`, a premium item, became usable). Fix:
- `reconcileGrants(world)` (src/economy/grants.ts, pure): a record must name a shipped quest, carry exactly
  `<worldId>:<questId>:<instance>`, instance 1 for one-off quests / ≤ one per cooldown since day 0 for repeatables, and
  is paid the quest **definition's** reward.
- `src/economy/entitlements.ts`: `isServerOnlyEntitlement` = contents sold only for GG / real money (premium items and
  bodies, GG bundles, boosts, season, subscriptions). `planAppend` refuses them (`serverOnly`); the wallet view ignores
  them even in a hand-edited, re-hashed chain. (Local data can always be edited; this only stops the client build from
  granting what only the server may grant — MONETIZATION.md §1.)

## R4 — VERIFIED (no change): pre-economy saves load with zero warnings
SaveManager + engine repair hook on a world without `quests`: `warnings = []`, no logger output, key stays absent,
nothing reconciled.

## R5 — FIXED (a11y): `aria-label` on generic `<span>`s (HUD Bones counter, Buy-mode lock chip) is ignored by most
screen readers; replaced by `aria-hidden` visuals + `.u-sr-only` text.

## R6 — DOC: MONETIZATION.md §2/§3 updated to match code (lead please confirm)
§2 grant id `<worldId>:…` (was `<saveId>`, Q3), reconciliation pays definition rewards, ledger persistence wording (E6),
server-only entitlements; §3 SkuKind `subscription` + `priceUsdCents` for Starter Pack / Afterlife+ (E1 — §8 already
prices them in real money, so §3 contradicted §8). `QuestRewardGrant.grantId` comment in src/shared/economy.ts updated.
**Still OPEN for the lead / owner:** docs/CONTRACTS.md has no economy/quests section (lead-owned); E5 ladder decisions.

## R7 — FIXED: "exact top-up" (§8) was claimed in E5 but never shown
`exactTopUp()` existed with no caller. The store card of every GG-priced SKU now shows the exact shortfall and its
real-money cost whenever a GG balance is known and short (signed-in / DevWallet; signed-out builds have no balance).

## Reviewed, not real / accepted (no change)
- Paid randomness: none (no random contents, odds or re-rolls; daily-task picks are free and seeded per install/day).
- Under-13: `realMoneyBlock` runs before the wallet (dev and server), `rewardedAdAllowed` false, analytics records
  nothing; Bones unlocks stay available (spec). GG prices: every one goes through `ggLabel()` (asserted in ui-store).
- DevWallet: absent from the production bundle (bundle.test.ts). Packs: schema → hashes → Ed25519 → content rules,
  all-or-nothing; zip limits / traversal / nested archives covered by packs tests; no bypass found.
- Clock-forward daily farming and local-file editing: inherent to an offline client (spec §2 "detects corruption
  only"); the server ledger is the authority in Phase 4.
- worldId collisions across new games: seed is a fresh 32-bit random per new game + household hash; not reachable.

## Deferred (owner / other modules)
- E5 ladder questions (Handful per-GG rate; Season Lease 950 vs 1,100 pack; Starter Pack 72 h wording).
- Teens never age into 'adult' locally (moving older needs the Phase 4 account flow) — confirm intended.
- Achievement grants (milestone/promotion/skill) dropped after 5 failed I/O retries are not re-derivable (quest
  grants are, via the world record). Low risk; needs a world-side achievement record (SIM) to close.
- Starter Pack lists the Goldie body while body unlocks are off (E3); unbuyable until Phase 4 anyway.
