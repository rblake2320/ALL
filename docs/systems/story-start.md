# W-113 Story start: the derelict claim and Act 1 "The Condemned Shack"

Status: **built v1** (2026-11-06). Decision: **D-060**. Sources: owner direction (verbatim below), GDD §6 (bills,
funds), §15 (build/buy, instant build with exact undo), DESIGN_PROGRESSION §5 (named NPCs), MONETIZATION §2 (story
chain, Bones), housing-progression.md §1 (home level 1–10) and §2 (opt-in, D-031), BALANCE.md (survival targets),
D-019 (new systems ON for new games, OFF for old saves).

> Owner: "This starting look is off. A new game should have a zombie and then a place it can claim as a home that is
> mostly bare. It will have to build it up maybe a couple things in there. We have to have a story that builds."

## 1. Player fantasy

*"I dragged myself out of a shallow grave and found a shack nobody wanted. The mailbox was full of CONDEMNED notices.
I slept in a busted coffin, bought a fridge with my last dollars, put up a shower, patched the walls and hung a fern.
The neighbours stopped bringing torches. Then I paid my first bill on time and the shack was mine. Next: renovate."*

A new game starts with **one zombie and a place to claim**, not a furnished house. The first hour is a short,
darkly comic story (E10+, original) whose beats are the core loop — rest, eat, wash, build, decorate, socialise, pay
— and each beat leaves the home a little more built-up. The furnished cottage stays as a sandbox option.

## 2. New Game lots

| order | id | name | start | funds | who it is for |
|---|---|---|---|---|---|
| 1 (default) | `derelict` | The Condemned Shack on Mildew Lane | story (Act 1) | **$2,500** | everyone; the recommended first game |
| 2 | `starter` | Fixer-Upper on Mildew Lane — tag **"Move-in ready (sandbox)"** | classic chain | $6,500 | players who want to skip straight to the sandbox; **all e2e suites and balance scenarios A–D use it** |
| 3 | `empty` | Empty Plot | classic chain | $22,000 | builders |

+$500 per extra household member applies to every lot (GDD §6). `createNewWorld` without a `lotTemplate` still builds
`starter` (the engine default is unchanged); the *New Game screen and the initial CAZ state* default to `derelict`.
The derelict start is exempt from D-047 equalisation (the shack is claimed, not bought — D-060).

## 3. The derelict lot (`src/sim/spatial/templates/index.ts`, `derelict()`)

```
      x:  11    12    13    14    15 | 16    17    18
 z=13    CFN   .     .     .     .   |  .     .     .
 z=14    CFN   .     .     .     .   |  .     .    SNK      main room (x 11..15, worn planks, rotten patch)
 z=15    .     .     .    TBL    .   |  .     .     .       back room (x 16..18, packed dirt)
 z=16  W .     .     .    CHR    .   D  .     .     .
 z=17    .     ~     ~     .     .   |  .     .     .
 z=18    .     .     .     .     .   |  .     .     .
 z=19 ──────────── D (front door h:13:19) ─────── W (h:17:19) ──
 z=19..26 dirt path at x = 13; mailbox (14,26); one dead tree (5,21)
```

- **Shell:** exterior walls, ONE interior partition (x = 16) with one doorway, one front door, two grimy windows.
- **Floors:** worn planks with a rotten (packed-dirt) patch in the main room; bare dirt in the back room; a dirt path.
- **Inside (4 objects):** `coffin_pine` (the busted coffin), `table_rickety`, one `chair_creaky`, `sink_rusty`.
- **Outside:** `mailbox_crooked`, one `tree_gnarled`.
- **Deliberately missing:** fridge, stove, microwave, shower/tub, decor, lights. The player buys them.
- Total 10 objects (4 of them doors/windows); every object passes placement checks and every slot is reachable from
  both sidewalk entry points.

### Day-1 essentials and funds

| essential | cheapest catalog option | price |
|---|---|---|
| food storage + preservative spray | `fridge_humming` | $450 |
| hot food | `microwave_nuke` / `stove_greasefire` | $150 / $400 |
| washing | `shower_drizzle` | $350 |
| **total** | | **$950 – $1,200** |

$2,500 covers the essentials with ~$1,300 left for groceries, the first bill and the Act 1 builds (4 wall segments,
3 pieces of furniture, a decoration ≈ $400), and is far below the ~$9,000 of furniture in the starter cottage — so
the player has to choose what to build next and needs the job the story unlocks after the first meal.

## 4. Act 1 — eight beats (`src/sim/content/quests/act1.ts`, text in `src/i18n/en.ts` `story.act1.*`)

A strict line; each beat requires the previous one and starts the moment it is complete.

| # | id | title | narrative line (short) | steps (objective kinds) | Bones | replaces |
|---|---|---|---|---|---|---|
| 1 | `act1_claim` | Squatter's Rights | the mailbox is stuffed with CONDEMNED notices — practically a lease | check the mailbox (`interaction ids home_checkMail`) | 20 | — |
| 2 | `act1_rest` | A Coffin of One's Own | a busted pine coffin: one hinge, zero complaints | sleep in a coffin (`interaction tags sleep, targetTags coffin`) | 20 | — |
| 3 | `act1_hunger` | The Hunger | no fridge, no stove — buy them, eat something hot | own a fridge · own a stove or microwave (`own`, hold 15 min) · eat a hot meal (`interaction tags eat, targetTags meal/microwave` — not cold jerky) | 40 | `story_firstMeal` |
| 4 | `act1_scrub` | Grave Dirt | you smell like a freshly dug flowerbed | own a shower · take a shower · restore Freshness (`preserve`) | 40 | `story_freshen` |
| 5 | `act1_patch` | Patch the Place | the wind and the raccoons whistle through the walls | build 4 wall segments (**new `walls` kind**, hold 15 min) · place 3 new pieces of furniture (`own fresh`, tags seat/surface/table/light/decor/bed) | 50 | — |
| 6 | `act1_curb` | Curb Appeal | make one room nice enough that the rats wipe their feet | place a new decoration · a room at environment ≥ 4 for 60 min | 50 | `story_decorate` |
| 7 | `act1_neighbour` | Knock, Knock | say hello before the neighbours say it with torches | be friendly twice (`interaction tags friendly`) | 40 | — |
| 8 | `act1_lease` | Paid in Full (Mostly) | pay a bill on time and the shack is legally yours | pay a bill on time (`billsOnTime`) | 80 | `story_bills` |

Total 340 Bones. The **Rise** beat is the intro card (§5), not a quest.

**After Act 1:** the classic chain continues unchanged. `story_getJob` starts as soon as `act1_hunger` is done (it
requires `story_firstMeal`, which Act 1 supersedes), `story_makeFriend` / `story_firstRepair` after `act1_scrub`,
`story_embalming` / `story_party` after `act1_curb`; neighbourhood quests that require a superseded quest unlock the
same way. Completing `act1_lease` is the hook for **Renovation level 2** (housing-progression.md §5): when W-042 lands,
its first renovation project is offered once `completions.act1_lease ≥ 1` (classic worlds: once `story_bills` is).

## 5. Intro moment (`src/game/storyIntro.ts`)

On entering a **brand-new** derelict world (not loaded from a save, `tick < 1 game hour`):
- the camera frames the zombie and the shack (midpoint of the first member and the house centre, distance 24);
- a narrative card "Rise and Squat" (2–3 sentences, `story.intro.*`) is shown through the existing hint callout
  (`game.hint`, id `story:intro`, eyebrow "Act 1 · The Condemned Shack", one "Let's go" button);
- it is **not a tutorial tip**: it shows with tips off, never turns tips off when skipped, and holds the tutorial
  tips back while it is up;
- it never blocks input (a callout, not a modal), Esc or the button skip it, it hides by itself after 45 s, and a
  loaded save never shows it again.

## 6. Rules

1. **New games only (D-019).** The arc is chosen once, at world creation, from the lot template:
   `WorldState.flags.storyArc = 'act1'` for `derelict`, absent otherwise. Old saves (and starter/empty worlds) carry no
   flag and run the classic chain byte-identically; nothing is migrated, nothing is added to an old save.
2. **Arc quests (`QuestDef.arc`)** are offered only in worlds whose `flags.storyArc` equals their arc.
   **`QuestDef.supersedes`** lists classic quests an arc quest replaces: in that arc they are never offered, and a
   prerequisite on them is met once the arc quest is complete. The validator rejects a supersede without an arc, of an
   arc quest, of an unknown quest, two arc quests superseding the same quest, and an arc quest requiring a quest from
   outside its arc.
3. **Order.** Steps within a quest run in order; Act 1 quests are chained by `requires`. Doing a later beat's action
   early never completes that beat early — but since W-116 (D-061) it is **credited the moment the beat's step
   starts** ("Already done — nice", §9.3): the arc log counts qualifying actions since this world's Act 1 began, and
   `own fresh` / `walls` steps count what was built since the arc began (their hold still runs from the step start).
4. **New objective kind `walls`** (STATE, hold kind): at least `count` more wall segments than when the step started,
   held `holdMin` game minutes (default 15). Build mode pauses time, so walls built and undone in one session never
   count; walls removed before the hold resets it.
5. **Rewards** are Bones only. Quests never move household funds (the quests system's isolation guarantee); the money
   side of the story is the player's own spending. Every Act 1 quest is one-off: the profile ledger keys it
   `profile:act1_<beat>:1`, so a replay, a reload, a second world or a copied save never pays twice (grantPolicy.ts).
6. **Determinism (D-012).** No new RNG draws; the arc and offers derive from world data only. The quests system still
   writes only `state.quests`.
7. **Story count.** `QuestsView.story.total` counts the chain this world runs (Act 1 + the classic quests it does not
   replace = 14 in an Act 1 world, 10 in a classic world).

## 7. Acceptance tests

| area | test file | proves |
|---|---|---|
| template | `tests/unit/spatial/derelict.test.ts` | 2 indoor rooms, one interior partition, doors reachable, all slots reachable from both entry points, object count ≤ 12, a sleep object, no kitchen appliance / shower, mailbox + one tree outside, fresh data per call, identical across seeds |
| economy | `tests/unit/balance/storyStart.test.ts` | funds ≥ day-1 essentials and < the starter cottage's furniture; 1- and 2-zombie households on several seeds survive 3 days with the essentials bought (no crumble, no game over, funds ≥ 0, no faults) |
| story | `tests/unit/quests/act1.real.test.ts` | every beat completes from real sim events in order; early actions never complete later beats; save/reload mid-arc gives the identical stream; replay/reload/second world never double-pays (ledger keys); classic worlds and old saves unchanged byte-for-byte; validator rejects bad arcs; `walls` kind semantics |
| game | `tests/unit/game/storyStart.test.ts` | CAZ default lot = derelict and first; intro card only on a new derelict world, skippable without disabling tips, auto-hides, never on load |
| UI | `tests/unit/ui-shell/storyStartLots.test.ts` | New Game lists derelict first and preselected; CSS keeps tags/names inside the card at phone widths; Playwright screenshots at 390×844 / 844×390 (`dev/out/w113/`) |
| e2e | `tests/e2e/flow.mjs` | checks derelict is first + default, then picks `starter` explicitly for the furnished-house flow |

## 8. Not in v1 (follow-ups)

(See §9 for the W-116 playtest fixes.)

- A **named landlord NPC** for "Knock, Knock" (DESIGN_PROGRESSION §5, W-061): today any neighbour/housemate counts.
- The Renovation level 2 project itself (W-042 not built yet): only the hook (`act1_lease` completion) exists.
- Act 2+ arcs (the same `arc` / `supersedes` mechanism takes them).

## 9. W-116 opening polish (owner playtest, desktop) — D-061..D-063, D-065

| # | finding | fix | where | proof |
|---|---|---|---|---|
| 1 | the first objective (mailbox) was hidden behind the agent panel | a pure helper maps the running step → its object (`src/shared/storyTarget.ts`: mailbox, coffin, cooker, shower, fridge, mailbox for the bill; buy/build/chat/room steps → none); the renderer floats a bobbing gold arrow + ring over it (`src/render/overlays/questMarker.ts`, live mode); quest rows (desktop panel + phone overlay) offer **Show me**; on entry and on every new targeted step the camera pans so the target and marker sit in the free spot nearest the centre that covers no `[data-hud-region]` panel (`src/shared/framing.ts` pickFramePoint + solveFocus, `src/ui/hud/overlay/StoryGuide.tsx`, renderer `frameAt` solved against the camera's goal pose) | ui / render | `tests/unit/shared/storyFraming.test.ts`, `tests/e2e/openingPolish.mjs` (1280×720 + 390×844) |
| 2 | the quest says CONDEMNED letters, the box said "empty" | while Act 1 runs the mailbox reads the CONDEMNED letter (`story.act1.claim.letter`), later an empty box still holds notices until the lease beat is paid; classic worlds unchanged; same RNG draws | `src/sim/systems/home/economy/mail.ts` | `tests/unit/quests/storyMail.real.test.ts` |
| 3 | slept in the coffin before the mailbox → the coffin step stayed 0/1 | arc credit (D-061): `state.quests.arcLog` counts qualifying events per arc step since the arc began; a starting step is credited (consumed once), `walls`/`own.fresh` baselines move to the arc start, `billsOnTime` counts from the arc start; toast + quest row say "Already done — nice" | `src/sim/systems/quests/system.ts` | `tests/unit/quests/act1Credit.real.test.ts` (+ updated `act1.real.test.ts`) |
| 4 | placement stayed active; a second click bought another chair | one click = one item (D-062); Shift+click / Shift+Enter / touch "Place another" keep placing; placement bar with name, price, hint, Done. Build tools unchanged | `src/game/input/buy.ts`, `src/ui/hud/buy/PlacementBar.tsx` | `tests/unit/game/input.test.ts`, `keyboardPlacement.test.ts`, e2e flow / placement / a11y |
| 5 | Irene ordered a $35 pizza on her own | household "Autonomous purchases" (D-063): Off / Daily cap ($50 default on new derelict worlds) / Unlimited (old saves, starter, empty) — autonomy never exceeds what is left today; player orders never blocked | `src/shared/autoBuy.ts`, engine autonomy + `ctx.spend`, household ledger | `tests/unit/home/autoPurchases.real.test.ts` |

Save compatibility (D-019): `arcLog` and `ObjectiveProgress.credited` are optional (absent on old saves, kept absent by
the persistence schema); the autonomous-purchase flag is only written on new derelict worlds or when the player
changes it; an Act 1 save written before W-116 loads byte-identically and starts its arc log at its next interaction.
