# L7 — The Necropolis (shared, growing town)

Level id `necropolis` · unlock: **late game, day 30 or finishing two capstones out of `story_rr_regular`,
`story_by_legend`, `story_mh_gala`, `story_un_ledger`** · build order 6th (W-020).

This is the level that grows. It is made of **blueprints**: lots saved, shared and rebuilt. Its parts are:
- a town square;
- a gallery;
- a ring of empty plots that fills in;
- **Creator Kit + MCP server** (Phase 3);
- the **online shared town** (Phase 4).

Everything in this doc works **offline first**. Online is an additive layer behind the Phase 4 server, and no
offline feature waits on it. Shared conventions are in [README.md](README.md).

## 1. Fantasy & tone
Beyond the hills, the founders planned a grand Necropolis: a "city of the dead" with boulevards and plazas. They ran
out of money after the square. Now the town council (three very old zombies and a ledger) hands out plots to anyone
with a plan. Every house the player designs can become a **blueprint**. Every blueprint can be built on a Necropolis
plot, and every built plot brings new townies who move in. The square gets busier and the gallery fills with
dioramas. Online, the plots fill with other players' houses (moderated, signed). The fantasy is civic pride: you are
building the town.

## 2. Map & lots
`LevelDef`: `{ id:'necropolis', name:'The Necropolis', blurb:'A city of the dead, built by the living-impaired.',
environment:'env_necropolis', townies: 0 /* grows: §5 */, unlock:{kind:'day', value:30}, content:['necropolis','blueprints','creatorKit'] }`.

| id | kind | name | templateId | w×d | buildable | map | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `necropolis:square` | community | Necropolis Square | `necropolis_square` | 30×30 | default | 860,540 | `park` | always | — | level | `amb_necropolis` / `mus_necropolis` |
| `necropolis:gallery` | community | Gallery of the Undying | `necropolis_gallery` | 30×30 | default | 900,520 | `museum` | 09–22 | — | level | `amb_mausoleum_hall` / `mus_necropolis_gallery` |
| `necropolis:plot_01` … `plot_06` (initial) | residential (blueprint plot) | Plot 1…6, Founders' Ring | `necropolis_plot` | 30×30 | default | ring around (880,560), r = 60 | — | — | 3,000 each (land only) | level | `amb_necropolis` |
| `necropolis:plot_07` … `plot_48` (grow) | residential | further rings | `necropolis_plot` | 30×30 | default | rings r = 120, 180, 240 | — | — | 3,000 + 500 × ring | growth rule §4.2 | — |

- Plot ids are stable and pre-declared (48 slots) so saves never invent lot ids. Growth only flips them
  "available". The map shows the next ring as faint survey stakes.
- Travel from Mildew Lane is capped at 45 min; within the Necropolis 15–25 min.

## 3. Community lots (validated: 0 errors, all slots reachable)

### 3.1 Necropolis Square (`necropolis_square`) — 23 objects
A paved plaza around the founders' statue:
- six benches, two fountains;
- the **Founders' Wall** (lists every household that built a plot);
- a performance stage, four weekend market stalls and a **blueprint kiosk**.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z02   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z03   . . : W W W W W W : : : : : : : : : : : P P P P P : : : . .
z04   . . : : : : : : : : : : : : : : : : : : P P P P P : : : . .
z05   . . : : : : : : : : : : : : : : : : : : P P P P P : : : . .
z06   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z07   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z08   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z09   . . : : : : : : : : : : : B B B B : : : : : : : : : : : . .
z10   . . : L : : : : : : : : : : : : : : : : : : : : : : L : . .
z11   . . : : : : : : : : : : : S S S S : : : : : : : : : : : . .
z12   . . : : : : : : : : B : : S S S S : B : : : : : : : : : . .
z13   . . : : : : U U : : B : : S S S S : B : : : U U : : : : . .
z14   . . : : : : U U : : : : : S S S S : : : : : U U : : : : . .
z15   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z16   . . : L : : : : : : : : : B B B B : : : : : : : : : L : . .
z17   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z18   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z19   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z20   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z21   . . : : M M : : M M : : : : : : : : : : M M : : M M : : . .
z22   . . : : : : : : : : : : : K K : : : : : : : : : : : : : . .
z23   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z24   . . : : : : : : : : : : : : : : : n : : : : : : : : : : . .
z25   . . T : : : : : : : : : : : : : : : : : : : : : : : : T . .
z26   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z27   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| S | statue_founders (4×4) | B | bench_iron | U | fountain_murky |
| W | wall_founders (6×1) | P | stage_square (5×3) | M | stall_weekend |
| K | kiosk_blueprint | L | lantern_post | T | tree_gnarled |
| `:` | `floor_cobble` plaza (validated as flagstone) | | | | |

### 3.2 Gallery of the Undying (`necropolis_gallery`) — 23 objects
An atrium with statues and benches. Off it are:
- a **Blueprint Hall** of three dioramas (live miniature renders of blueprints) and a kiosk;
- a **Painting Hall** with four frames that sell the household's paintings at 120 %;
- a **Photo Studio** with a photo booth and printer (Mirror Cam / photo mode, W-028).
```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7   (x; tens: 00000000111111111122222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . . . .
z04   . . . . . . . . . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . . . . . . . . . .
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z06   .|p p p p p p p p p p|p P p p P p p P p p P p p p|.
       +                   +                           +
z07   .|p D D p D D p D D p|p p p p p p p p p p p p p p|.
       +                   +                           +
z08   .|p D D p D D p D D p|p p p p p p p p p p p p p p|.
       +                   +                           +
z09   .|p p p p p p p p p p|p p p p p p p p p p p p p p|.
       +                   +                           +
z10   .|p p p p p p p p p p|p p Q Q p p p p p p p p p p|.
       +                   +                           +
z11   .|p p K K p p p p p p|p p p p p p p p p p p p p p|.
       +                   +                           +
z12   .|p p p p p p p p p p|p p p p p p p p p p p p p p|.
       +-+-+-+-+-+-+-+D+-+-+-+-+-+-+-+D+-+-+-+-+-+-+-+-+
z13   . . . . . .|m m m m m m m m m m m m m m|c c c c c|.
                 +                           +         +
z14   . . . . . .|m S m m m m m m m m m m S m|c c O O c|.
                 +                           +         +
z15   . . . . . .|m m m m m m m m m m m m m m|c c O O c|.
                 +                           +         +
z16   . . . . . .|m m m m m m m m m m m m m m|c c c c c|.
                 +                           +         +
z17   . . . . . .|m m m m m B B m B B m m m mDc c c c c|.
                 +                           +         +
z18   . . . . . .|m m m m m m m m m m m m m m|c c c c R|.
                 +                           +         +
z19   . . . . . .|m n m m m m m m m m m m m m|c c c c c|.
                 +                           +         +
z20   . . . . . .|m m m m m m m m m m m m m m|c c c c c|.
                 +-+-+W+-+-+-+D+D+-+-+-+W+-+-+-+-+-+-+-+
z21   . . . . . . . . . . . . : : . . . . . . . . . . . .
z22   . . . . . . . . . . . . : : . . . . . . . . . . . .
z23   . . . . . . . . . . . . : : . . . . . . . . . . . .
z24   . . . . . . . . . . . . : : . . . . . . . . . . . .
z25   . . . . . . . . . . . . : : . . . . . . . . . . . .
z26   . . . . . . . . . . . . : : . . . . . . . . . . . .
z27   . . . . . . . . . . . . : : . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| D | diorama_blueprint (2×2) | K | kiosk_blueprint | P | wall_painting_frame (L5) |
| Q | counter_reception | S | statue_marble (L5) | O | booth_photo |
| R | printer_photo | | | | |

- **NPCs:** gallerist **Vesper Quill** (body `streamer`; "everything is content") and the council clerk **Mr.
  Ledgerworth** (body `business`) at the square on weekdays 10–16.

### 3.3 Blueprint plot (`necropolis_plot`)
An empty 28×26 buildable plot with a mailbox and a survey marker (`marker_plot`: "Build here: import a blueprint or
build by hand").
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z02   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z04   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z06   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z07   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z08   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z10   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z11   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z12   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z13   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z14   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z15   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z16   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z17   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z18   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z19   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z20   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z21   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z22   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z23   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z24   . . . . . . . . . . . . . . K . . . . . . . . . . . . . . .
z25   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z26   . . . . . . . . . . . . . . . X . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```

## 4. Signature systems

### 4.1 Blueprints (offline, Phase 2–3)
- **Export** (`necro_saveBlueprint`, Build mode → "Save as Blueprint"). This writes a **Blueprint** from the current
  lot:

```ts
interface BlueprintV1 {
  format: 'afterlife-blueprint'; version: 1;
  id: string;            // sha256 of the canonical body (content address)
  name: string; author: string /* profile display name or 'Anonymous' */; createdAt: string;
  buildable: { x0; z0; x1; z1 };             // must fit the target plot
  walls: Record<EdgeKey, { paint: [string, string] }>;
  floors: (string | null)[];                 // 900
  objects: { defId: string; placement: ObjectPlacement; tint: string | null }[];   // placed objects only
  below?: { rock: string; walls; floors; objects };                                 // L6 basement (optional)
  stats: { objectCount; wallCount; priceTotal; tiers: Record<'free'|'bones'|'premium'|'sponsor', number> };
}
```

- **Never** exported: agents, money, relationships, items (meals, dishes, limbs, curios), object data/conditions,
  household names, any text not from a curated list (the blueprint name is chosen from word lists for under-15
  profiles, MONETIZATION §1 "no free-text UGC" for under-15).
- **Budgets:** ≤ 200 KB JSON, ≤ 240 objects (level 0) + 80 (level −1). Canonical JSON (sorted keys) → SHA-256 id.
- **Import / build** on an empty plot (`necro_buildBlueprint`, at the kiosk or the plot marker):
  1. **validation:** schema → buildable fits → every object passes checkPlace / checkWallItem / checkOpening in order
     → every slot reachable. This is the same harness used to validate these docs. A failure lists each problem and
     builds nothing;
  2. **entitlements:** items whose tier the profile has not unlocked are listed with "Swap for a free equivalent"
     (a curated `freeEquivalent` map per def, e.g. sofa_velvet → sofa_moldy) or "Skip";
  3. **cost:** walls $15/segment + floors at style price + objects at sim price, × **0.9** ("blueprint discount":
     builders' bulk rate). Charged once with an idempotency key `<lotId>:<blueprintId>:build`;
  4. **construction time:** instant (on arrival), or "Build over a day" for half the discount (flavour).
- **Library:** the game ships **12 curated blueprints**:
  - the 10 residential templates from L1–L5 (as blueprints, so players can build a Mansard Manor in the Necropolis);
  - 2 originals: "The Lighthouse Crypt" and "Tiny Coffin House".

  Player blueprints live in the profile (`profile/blueprints/*.json`, crash-safe ProfileStore), not in a world, so
  they carry across saves.

### 4.2 The growing map (offline rule; online in §4.4)
- The town starts with **6 available plots** (Founders' Ring). When **5 of the available plots are occupied** (by the
  household, by blueprint builds the household commissions, or by council builds), the next ring of 6 opens: rings
  of 6, 12, 12, 12 for 48 in all.
- **Council builds (offline life):** each game Monday at 06:00 the council builds one shipped-library blueprint on
  a free available plot (seeded choice), and a new townie household of 1–3 moves in (seeded names, traits and
  bodies). That keeps the town growing for solo players. The cap is 1 per week, and none once 36 plots are filled
  (the last 12 are reserved for the player and online).
- **Commissioned builds:** the household can pay to build one of its own blueprints on any free plot
  (`necro_commissionBuild`, the import cost of §4.1). A seeded townie household rents it and pays the household
  **rent: $40 per game day** per commissioned plot (cap 5 plots).
  - This is the first passive income in the game. Payback is about 2–3 months of game time for a $3,000 plot plus a
    ~$6,000 house, so it is slow by design.
  - **PROPOSED GDD CHANGE §6:** a rent income line, issued Mondays like bills.
- **Townies:** every occupied plot adds its household to the townie roster.
  - The simulated cap per lot is unchanged (8).
  - Townie records total ≤ **150** across the town. Beyond that, the oldest council households "move away" (data
    pruned, deterministic) to keep saves ≤ 2 MB (DESIGN_WORLD_LEVELS §1).
  - **Each plot's snapshot** is the blueprint id + deltas only. It is never a full LotState until the household
    first enters it, which keeps the 48 plots ≈ 48 × 200 B.

### 4.3 Creator Kit + MCP server (Phase 3)
- **Creator mode** (desktop/dev, MONETIZATION §5): unsigned local packs are allowed only in Creator mode, clearly
  labelled, and never in shared towns.
- **Creator Kit contents:**
  - the blueprint editor (Build mode + Dig mode + a "validate" panel);
  - **the validator harness as a CLI** (`npx afterlife-validate <blueprint.json>`), the same checks as §4.1;
  - a pack builder that writes `pack.json` + the asset hashes for objects, brand skins, quests and lots;
  - docs.
- **MCP server** (`afterlife-mcp`, local stdio, Phase 3). Tools (names provisional; JSON in/out; no network access):

| Tool | Does |
|---|---|
| `catalog_list` | defs, footprints, slots, tiers |
| `blueprint_validate` | the harness: per-object errors and reachability |
| `blueprint_create` | from a structured room/object list, like the scripts used to write these docs |
| `blueprint_preview` | headless render of the top-down plan, as ASCII like these docs or PNG (desktop) |
| `pack_build` / `pack_verify` | build and check content packs |
| `quest_validate` | objective kinds and ids exist |

  The MCP server never touches saves, wallets or GG. It reads the shipped content and writes files in the
  creator's workspace.
- **IP & safety:** Creator content is reviewed against `docs/IP_NOTES.md` before signing. No real brands. E10+.

### 4.4 Online shared town (Phase 4)
- Signed-in players can **publish** a blueprint. It goes through server validation (the same harness) and
  moderation (automated name and word-list checks, human review queue), then gets signed.
- Each player's Necropolis then fills its online plots (the reserved last 12, plus any ring the player opts in) with
  **other players' published blueprints**, picked by the server (featured, friends, new), each with a seeded townie
  household.
- **Visiting** another player's real household: not in v1 (no live multiplayer). The plots are their houses, lived
  in by local townies.
- **Ratings:** a "Doff Hat" like button. The most-doffed blueprints are featured weekly in the gallery dioramas.
- **Creator payouts** (Phase 4, MONETIZATION §8): only for premium marketplace blueprints. Earned GG is tracked
  separately. Free sharing stays free.
- **Under-15** profiles cannot publish, can only browse curated/featured sets, and see no author free text.

## 5. Townies & NPCs
- **Townies:** grown (§4.2): 1–3 per occupied plot, ≤ 150 total. Bodies are drawn from all 25 cast bodies + procedural.
- **Square arrivals:**

| Hours | 07–10 | 10–14 | 14–18 | 18–22 | 22–02 | 02–07 |
|---|---|---|---|---|---|---|
| Weight | 0.4 | 0.6 | 0.7 | 0.6 | 0.2 | 0.05 |

  Weekend market ×1.5.
- **NPCs:** Vesper Quill (gallery, 09–22), Mr. Ledgerworth (council clerk, square, weekdays 10–16: blueprint and
  plot questions, the rent ledger).

## 6. Objects (L7)
| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `statue_founders` | The Founders (Unfinished) | — | 4×4 | monument | admire (any side) | home_readEpitaph-style `necro_readPlaque`, `hills_admireStatue` | Three robed founders on a plinth, the fourth spot empty (the player's household portrait appears there after `story_np_founder`) | 5,800 |
| `wall_founders` | Founders' Wall | — | 6×1 | monument | f0–f5 | `necro_readWall` (lists households; fun +8/h) | Long granite wall with engraved names (dynamic text decal from household names: curated font) | 2,400 |
| `stage_square` | Square Stage | — | 5×3 | stage | perform | town_performStandUp (any night ≥ 3 audience), `necro_buskMusic` | Wooden bandstand with bunting | 3,600 |
| `stall_weekend` | Weekend Market Stall | — | 2×1 | stall | buy, staff | `necro_browseStall` (seeded weekly stock: 4 catalogue items at 85 %, delivered home), town_buyBouquet | Striped awning stall, crates | 1,600 |
| `kiosk_blueprint` | Blueprint Kiosk | — | 2×1 | kiosk | f0, f1 | necro_browseBlueprints, necro_buildBlueprint, necro_commissionBuild | Brass-and-glass kiosk with a glowing screen (`screen`) and a tiny model house on top | 1,800 |
| `diorama_blueprint` | Blueprint Diorama | — | 2×2 | exhibit | f0, f1 | `necro_viewDiorama` (fun +12/h; opens the blueprint's card) | Glass box with a **live miniature render** of a blueprint (renderer: ¼-scale instanced lot, ≤ 8,000 tris budget per diorama, LOD to an impostor beyond 12 m) | 800 + render |
| `booth_photo` | Photo Booth | — | 2×2 | photo | f0, f1 | `necro_photoBooth` (W-028 photo mode; fun +10, prints `item_photo` decor) | Curtained booth with a flash bulb (`bulb`) | 2,000 |
| `printer_photo` | Photo Printer | — | 1×1 | photo | front | prints photos | Boxy printer with a dangling strip | 600 |
| `marker_plot` | Survey Marker | — | 1×1 | plot | front | necro_buildBlueprint (plot), necro_buyPlot | Wooden stake with a red flag and a tag | 300 |
| `item_photo` | Photo Strip | item → wall decor | wall item | decor | look | home_admirePortrait | A 4-frame photo strip of the zombies (render-to-texture; stored as a camera preset, not an image) | 200 |

**Floor style:** `floor_cobble` (P-W4).

**Totals:** 10 new objects + 1 floor style. Most "new content" in L7 is blueprints, which by construction reuse the
whole catalogue.

**Reused:** bench_iron, fountain_murky, lantern_post, tree_gnarled, statue_marble, wall_painting_frame,
counter_reception, mailbox_crooked, board_notice.

## 7. Interactions (L7)
| id | Target | Effects | Dur. | Requires | Autonomy ad | Anim | Moodlet |
|---|---|---|---|---|---|---|---|
| `necro_saveBlueprint` | (Build mode) | writes a BlueprintV1 to the profile | — | own lot | — | — | — |
| `necro_browseBlueprints` | kiosk | opens the library (shipped / mine / online); fun +6/h | 10 | — | fun 3 | `admire` | — |
| `necro_buildBlueprint` | kiosk / marker_plot | import on the household's own empty plot (§4.1) | 5 | valid; funds | not autonomous | `talk` | `newFoundations` +8 |
| `necro_commissionBuild` | kiosk | build on a free plot as a rental (§4.2) | 5 | ≤ 5 rentals | not autonomous | `talk` | — |
| `necro_buyPlot` | marker_plot | buys the land (3,000 + 500 × ring) for moving or rental | 3 | available | not autonomous | `talk` | — |
| `necro_readWall` | wall_founders | fun +8/h | 10 | — | fun 3 | `read` | `civicPride` +5 when the household's name is on it |
| `necro_readPlaque` | statue_founders | fun +30/h | 5 | — | fun 4 | `read` | — |
| `necro_buskMusic` | stage_square | creativity xp 25/h, fun +12/h; tips $3/h per 2 audience | 30 | — | fun 6; artistic +3, partyAnimal +2 | `dance` (proposed `playGuitar`) | — |
| `necro_browseStall` | stall_weekend | seeded weekly stock: 4 catalogue items at 85 %, delivered home | 10 | Sat/Sun 09–17 | fun 2 | `admire` | — |
| `necro_viewDiorama` | diorama_blueprint | fun +12/h | 10 | — | fun 4 | `admire` | — |
| `necro_photoBooth` | booth_photo | fun +10, social +4 per extra zombie inside (≤ 4); prints an `item_photo` | 5 | W-028 for the photo; otherwise the strip uses a fixed pose preset | fun 6, adBonus 3 | `cheer` | `sayCheese` +4 |
| `necro_sellPaintingGallery` | wall_painting_frame (gallery) | sells a carried painting at **120 %** | 3 | carrying a painting | adBonus 4 when carrying | `talk` | `paintingSold` (exists) |
| `necro_collectRent` | mailbox (auto) | rent for commissioned plots, Mondays (issued like bills, idempotent) | — | ≥ 1 rental | — | — | `landlord` +4 |

**Totals:** 13 new interactions.

### New moodlets
| id | Label | Mood | Duration |
|---|---|---|---|
| `newFoundations` | New Foundations | +8 | 1,440 min |
| `civicPride` | Civic Pride | +5 | 480 min |
| `sayCheese` | Say Cheese(cloth) | +4 | 180 min |
| `landlord` | Landlord of the Dead | +4 | 480 min |

**Totals:** 4 new moodlets.

## 8. Quests
New stat keys: `blueprintsSaved`, `blueprintsBuilt`, `plotsCommissioned`, `rentCollected`, `dioramasViewed`.

**Story chain "Build the Necropolis"** (total **720 Bones** + 3 cosmetics):

| id | Title | Steps | Bones |
|---|---|---|---|
| `story_np_arrive` | A City Unfinished | `visitLot necropolis` → read the Founders' plaque | 60 |
| `story_np_blueprint` | Plans of the Dead | save a blueprint of the home (`stat blueprintsSaved 1`) | 80 |
| `story_np_gallery` | On Display | view 3 dioramas → sell a painting in the gallery | 80 |
| `story_np_plot` | Breaking Ground | buy a plot **or** commission a build | 120 |
| `story_np_landlord` | Landlord of the Dead | collect rent twice | 100 |
| `story_np_founder` | The Fourth Founder | have 12 plots occupied in the town | 280 + `cosmetic:frame_founder` + `cosmetic:title_founder` + the household portrait on the statue |

**Repeatables:**

| id | Title | Objective | Bones | Cooldown |
|---|---|---|---|---|
| `n_np_busk` | Busker | busk twice | 20 | 2 d |
| `n_np_photos` | Photo Op | 2 photo booth strips | 15 | 2 d |
| `n_np_market` | Weekend Bargains | buy from a weekend stall | 20 | 7 d |
| `n_np_architect` | Architect | save a new blueprint (a distinct id) | 30 | 5 d |
| `n_np_featured` | Featured! | (Phase 4) a published blueprint gets 10 Doffs | 60 | 14 d |

**Daily:**

| id | Task | Bones |
|---|---|---|
| `d_np_visit` | visit the Necropolis | 8 |
| `d_np_diorama` | view a diorama | 6 |
| `d_np_busk` | busk | 8 |

## 9. Events
| Event | When | What |
|---|---|---|
| **Weekend Market** | Sat/Sun 09:00–17:00, square | stalls open; townies ×1.5 |
| **Founding Day** | every 30 game days | parade FX around the square; the council announces the next ring ("New plots surveyed!"); free cake platter (12 servings) |
| **Ribbon Cutting** | whenever a plot is built | the next morning a small crowd gathers at that plot (townies ×2 there for 2 h); the household's builds get `newFoundations` |
| **Seasonal (W-034)** | Halloween | "Parade of Houses": dioramas show Halloween skins |
| **Seasonal (W-034)** | winter | ice rink overlay on the square (rug-layer object `rink_seasonal`, skate = dance numbers) |
| **Seasonal (W-034)** | spring | the gallery's "Best Blueprint" (offline: the household's most-built blueprint by count; online: most Doffs) |

## 10. Music & ambience
- **`mus_necropolis`** (original): a civic brass-band motif (synth tuba, cornets) at a slow 4/4 at 88 BPM, with
  tolling-bell accents. It modulates up a step each time a ring opens (a cumulative "the town grows" feel; max 4
  steps).
- **`mus_necropolis_gallery`:** minimal piano + strings.
- **`amb_necropolis`:** a busy plaza murmur that **scales with occupied plots** (crowd gain 0.2 → 1.0), fountains,
  pigeons (L1), distant hammering when a build is pending, the clock-tower chime each hour.
- **New SFX:** `ribbonSnip`, `crowdCheer`, `kioskBeep`, `shutterClick`, `hammering`.

## 11. Environment (`env_necropolis`)
| Key | Day | Dusk | Night |
|---|---|---|---|
| Sky | bright overcast `#b0b4b8` | violet `#8c7aa8` | `#1a1830`, the clock tower lit |
| Accents | — | — | `#ffb35a` lamps |

- **Ground:** cobble plaza `#6d6a64`, marble `#e8e0c8`, avenues lined with poplars.
- **Skyline dressing grows with the plots:** unbuilt plots show survey stakes and scaffold (`env_scaffold`, 2,000
  tris); built plots far away show their blueprint as a **low-LOD impostor** (renderer: auto-generated from the
  blueprint walls and roof, ≤ 1,500 tris each, ≤ 48 impostors, 1–2 draw calls each with merging).

## 12. Store tie-ins
- **Free:** the Creator Kit, blueprint saving, the shipped library.
- **Premium blueprint packs** (GG bundles of curated blueprints + their themed objects, not directly priced
  expansions):
  - "Gothic Row" (4 blueprints + 6 objects) 1,600 GG;
  - "Seaside Crypts" 1,600 GG;
  - "Tiny Tombs" (8 micro-houses) 1,200 GG.

  The contents and sum of parts are shown. **No randomness.** Buying a blueprint pack does not grant its objects for
  free in the sim: building still costs household $, per MONETIZATION §1.
- **Season Lease tie-in** (Phase 3): each season adds a featured blueprint to the free track.
- **Marketplace** (Phase 4): premium player blueprints with creator payouts (MONETIZATION §8). Under-15 cannot buy
  without parental consent, and teen caps apply.
- **Sponsor:** a Volt-Hearse charging bay on the square (dressing with a brand slot), and AdSurface billboards (2) on
  the square, house brands only.

## 13. Acceptance criteria
1. BlueprintV1:
   - export is canonical and deterministic (the same lot gives the same id);
   - import validation rejects every malformed or adversarial input (schema, out-of-buildable, overlapping, illegal
     defs, oversized, forged tiers) with a clear list and **no partial build**;
   - a successful import charges once.
2. The 12 shipped blueprints all validate and build on a plot. They are byte-identical to their template sources.
3. Growth: ring opening, council builds (1/week, seeded), townie cap 150 with deterministic pruning, plot snapshots
   ≤ 200 B until entered.
4. Rent is paid Mondays and is idempotent across reload/replay.
5. **Perf** (busiest view: the square at the weekend with 36 plots built):
   - agents ≤ 18;
   - objects ≤ 30;
   - impostors ≤ 48 (merged into ≤ 12 draw calls);
   - draw calls ≈ 80 + 180 + 12 + 40 ≈ **312 ≤ 650**.

   Gallery: 3 dioramas × ≤ 8,000 tris with LOD; ≤ 420 draw calls. World save with 48 plots ≤ 2 MB (asserted).
6. MCP/Creator Kit (Phase 3): the CLI validator gives the same verdicts as in-game on a 200-case corpus.
7. Online (Phase 4): server-side validation parity; moderation queue; under-15 restrictions.

## 14. Tests
| Test | Kind | Asserts |
|---|---|---|
| `blueprint.export.test.ts` | unit | canonical JSON, id stability, excluded fields (no agents, items, money, free text) |
| `blueprint.import.test.ts` | unit, adversarial | 50+ malformed/forged cases rejected with no state change; entitlement swap/skip; cost × 0.9 charged once |
| `blueprint.library.test.ts` | unit | 12 shipped blueprints validate; template ↔ blueprint round trip |
| `necropolis.growth.test.ts` | unit | rings, council cadence, pruning determinism, save size with 48 plots |
| `rent.test.ts` | unit | Monday issue, cap 5, idempotency |
| `travel.necropolis.test.ts` | integration | round trip; entering a never-entered plot builds from its blueprint deterministically |
| `mcp.validate.test.ts` (Phase 3) | integration | the CLI and the in-game validator agree |
| `necropolis.spec` | e2e | the square at 36 plots, impostor skyline, gallery dioramas; draw calls logged |

## 15. Open questions
1. Rent income (a PROPOSED GDD §6 change) is the first passive income. OK at $40/day/plot with a cap of 5?
2. The blueprint discount ×0.9: keep, or drop to avoid "build via blueprint" being always better than by hand?
3. Do the MCP server tool names match what the lead plans for the Creator Kit (W-020)?
4. Diorama live renders: the renderer must support a second, scaled lot instance. Is that acceptable, or should they
   be static impostor snapshots?

## 16. References
- The garden-cemetery-as-civic-park idea that inspires the Necropolis as a public space:
  https://en.wikipedia.org/wiki/Rural_cemetery · https://www.tclf.org/mount-auburn-cemetery-ma
- Downtown anchors and evening activity, applied to the square's weekend market and stage:
  https://ced.sog.unc.edu/key-elements-of-successful-downtowns/
