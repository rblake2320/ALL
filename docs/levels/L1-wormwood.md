# L1 — Wormwood Heights (starter neighbourhood)

Level id `wormwood` · unlock: start · status: **shipped** (two residential lots, 24 townies, five careers, quests).
This doc records what exists, read from the code, and adds **two new residential templates** and **a corner park**
(DESIGN_WORLD_LEVELS §2). Shared conventions are in [README.md](README.md).

## 1. Fantasy & tone
Mildew Lane is the first street a freshly risen household can afford. Crooked Victorian cottages lean on each other
like tired mourners, hedges grow at angles, the streetlamps flicker on their own schedule, and the neighbours are
friendly in a slow, shuffling way. The tone is cosy macabre (ART_DIRECTION): mundane suburban life with the volume
turned down to a groan. The street is a place to learn the basics, from bills and dinner to Freshness and friends,
before the bigger levels open up. The new corner park gives the street a commons: somewhere to sit, chase pigeons
that always escape, play bone chess with a retired hustler and toss a coin in a fountain that may grant wishes.

## 2. Neighbourhood map

`LevelDef`: `{ id: 'wormwood', name: 'Wormwood Heights', blurb: 'Crooked cottages, cheap rent, mildew included.',
environment: 'env_wormwood', townies: 24, unlock: {kind:'none'}, content: ['home','people','quests','park'] }`.

| id | kind | name | templateId | w×d | buildable | map (x,z) | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `wormwood:townhouse` | residential | Narrow Townhouse, 2 Mildew Lane | `wormwood_townhouse` (**new**) | 30×30 | [1,29)×[1,27) | 190,470 | — | — | 22,000 | none | `amb_wormwood` / `mus_wormwood` |
| `wormwood:starter` | residential | Fixer-Upper on Mildew Lane | `starter` (exists) | 30×30 | [1,29)×[1,27) | 220,470 | — | — | 19,500 | none | `amb_wormwood` / `mus_wormwood` |
| `wormwood:empty` | residential | Empty Plot | `empty` (exists) | 30×30 | [1,29)×[1,27) | 250,470 | — | — | 4,000 | none | `amb_wormwood` / `mus_wormwood` |
| `wormwood:bungalow` | residential | Sagging Bungalow, 13 Mildew Lane | `wormwood_bungalow` (**new**) | 30×30 | [1,29)×[1,27) | 280,470 | — | — | 16,500 | none | `amb_wormwood` / `mus_wormwood` |
| `wormwood:corner_park` | community | Mildew Lane Corner Park | `wormwood_park` (**new**) | 30×30 | [1,29)×[1,27) | 310,440 | `park` | always | — | none | `amb_park` / `mus_wormwood_park` |

The lot ids `wormwood:starter` and `wormwood:empty` are fixed by the framework migration (`homeLotId:'wormwood:<template>'`).
**Price** = land $4,000 + furnished house value. Each template's new-game `startingFunds` is chosen so that funds plus
price is **$26,000** for every lot, so no choice is strictly richer, only differently furnished:

| Lot | startingFunds | price |
|---|---|---|
| Empty Plot | $22,000 | $4,000 |
| Fixer-Upper | $6,500 | $19,500 |
| Bungalow | $9,500 | $16,500 |
| Townhouse | $4,000 | $22,000 |

GDD §6's +$500 per member beyond the first still applies.

```
Neighbourhood map, Wormwood tab (map units; north up = -z)
   (180)          (220)          (250)          (280)          (310)
     [Townhouse]    [Fixer-Upper]  [Empty Plot]   [Bungalow]    (440) [Corner Park]
  ── Mildew Lane (street, z≈480) ──────────────────────────────────────────┐
                                                                    to Old Graveyard (420,400) →
```

## 3. Lots

### 3.1 Fixer-Upper on Mildew Lane (`starter`, exists)
An 11-wide cottage (x 9..19) with a bathroom bump-out at z 9 and four rooms. From `src/sim/spatial/templates/index.ts`:

| Room | rect (x0,z0)-(x1,z1) excl. | floor | wall |
|---|---|---|---|
| bedroom | (9,10)-(16,14) | floor_planks_dark | wall_damask_midnight |
| bathroom | (16,9)-(20,14) | floor_tile_morgue | wall_stripes_mint |
| living | (9,14)-(15,19) | floor_planks_worn | wall_stripes_plum |
| kitchen | (15,14)-(20,19) | floor_checker_bw | wall_tile_morgue |

Contents:
- **Openings.** Doors `door_splintered`: front h:14:19, bedroom h:13:14, kitchen v:15:16, bathroom h:17:14.
  Windows `window_grimy`: h:11:19, v:9:16, h:17:19, v:20:17, h:11:10, v:9:12, h:18:9.
- **Living.** tv_crt (11,14), sofa_moldy (10,18) r2, armchair_tattered (14,15) r1, rug_rag (11,16), table_coffinlid
  (9,16), lamp_skull (9,14), shelf_moldering (12,14), painting_greatgrand on v:9:15.
- **Kitchen.** fridge_humming (19,14) r1, stove_greasefire (19,15), counter_butcher (19,16) and (19,18), sink_rusty
  (19,17), trash_lidded (15,14), table_wake (16,16), 4× chair_creaky.
- **Bedroom.** coffin_pine (10,10), coffin_chillrest (12,10), candelabra_drippy (11,10), plant_deadfern (15,10),
  sconce_candle on h:10:14.
- **Bathroom.** mirror_cracked (16,9), shower_drizzle (19,9).
- **Yard.** mailbox (15,26), lantern_post (13,25), plot_budget (5,12) with headstone_decor (5,10), tree_gnarled
  (4,21) and (24,11), flagstone path x 14, z 19..26.

The balance pass added the Chill-Rest and the bookshelf (BALANCE §5.3, §5.5). **Rule for every new residential
template:** at least one freshness source that does not depend on the fridge (a Chill-Rest or better), and at least
two fun sources. Without them, the unattended A-scenario targets fail.

### 3.2 Empty Plot (`empty`, exists)
mailbox_crooked (15,26), tree_gnarled (6,21). Nothing else.

### 3.3 NEW — Sagging Bungalow, 13 Mildew Lane (`wormwood_bungalow`)
A wide, low single-storey house with a sagging plank porch: five rooms, partly furnished. The **empty study** is the
hook: the household has $9,500 to make it theirs. Validated with the real spatial code: 42 objects, 0 placement
errors, every slot reachable from both sidewalk entries.

```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6   (x; tens: 0000000011111111112222222)
z07   . . . . . . . . . . . . . . . . . . . . . . . . .
z08   . Z . . . . . . . . . . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . . . . . . . . . . . . .
z10   . . . . . . . . . . . . . . . . . . . . . . Q . .
               +-+-+W+-+-+-+-+-+-+-+W+-+-+
z11   . . . . .|C c P b b|M S H|l l l l l|. . . . . . .
               +         +     +         +
z12   . . . . .|C b P b b|t t t|l l l l lW. . . . Y . .
               +         +     +         +
z13   . . . . .Wb b b b b|t t t|l l l l l|. . . . Y . .
               +         +     +         +
z14   . . . . .|b b b b f|t t t|l l l l l|. . . . . . .
               +-+-+D+-+-+-+D+-+-+-+D+-+-+
z15   . . . . .|L V l l K l l|R k k k k F|. . . . . . .
               +             +           +
z16   . . . . .|l l l l l l l|k k h k k N|. . . . . . .
               +             +           +
z17   . . . . .|l l l A l l lDk k T k k GW. . . . . . .
               +             +           +
z18   . . . . .|l O O l l l l|k k h k k S|. . . . . . .
               +             +           +
z19   . . . . .|l l l l l l l|k k k k k k|. . . . . . .
               +-+W+-+D+-+W+-+-+-+W+-+W+-+
z20   . . . . . . p p p p E E p p p p . . . . . . . . .
z21   . . . . . . p p p p p p p p p p . . . . . . . . .
z22   . . . . . . . . : : . . . . . . . . . . . . . Z .
z23   . . . . . . . . : : . . . . . . . . . . . . . . .
z24   . . . . . . . . : : . . . . . . . . . . . . . . .
z25   . . . . . . . J : : . . . . . . . . . . . . . . .
z26   . . . . . . . . : : X . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . .
```
Legend:

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `b` | bedroom carpet | `t` | bath tile | `l` | living/study planks |
| `k` | kitchen moss checker | `p` | porch planks | `:` | flagstone path |
| C | coffin_chillrest | P | coffin_pine | c | candelabra_drippy |
| f | plant_deadfern | M | mirror_cracked | S | sink_rusty |
| H | shower_drizzle | V | tv_crt | O | sofa_moldy |
| K | shelf_moldering | L | lamp_skull | A | armchair_tattered (r3, faces +X toward the TV row) |
| F | fridge_humming | N | counter_butcher | G | stove_greasefire |
| R | trash_lidded | T | table_rickety | h | chair_creaky |
| E | pew_salvaged (porch) | X | mailbox | J | lantern_post |
| Y | plot_budget | Q | headstone_decor | Z | tree_gnarled |

| Room | rect excl. | floor | wall |
|---|---|---|---|
| bedroom | (7,11)-(12,15) | floor_carpet_plum | wall_floral_faded |
| bathroom | (12,11)-(15,15) | floor_tile_morgue | wall_tile_morgue |
| study (empty) | (15,11)-(20,15) | floor_planks_worn | wall_plaster_bone |
| living | (7,15)-(14,20) | floor_planks_worn | wall_plaster_moss |
| kitchen | (14,15)-(20,20) | floor_checker_moss | wall_stripes_mint |

- **Floor fills.** porch `floor_planks_dark` (8,20)-(18,22); path `floor_stone_crypt` (10,22)-(12,27).
- **Openings.**
  - Doors `door_splintered`: front h:10:20, living→bedroom h:9:15, living→bath h:13:15, kitchen→study h:17:15,
    living→kitchen v:14:17.
  - Windows `window_grimy`: h:8:20, h:12:20, h:16:20, h:18:20, v:7:13, h:9:11, h:17:11, v:20:12, v:20:17.
- **Objects** (defId x,z,rot):
  - bedroom: coffin_chillrest 7,11,0 · candelabra_drippy 8,11 · coffin_pine 9,11,0 · plant_deadfern 11,14;
  - bath: mirror_cracked 12,11 · sink_rusty 13,11 · shower_drizzle 14,11;
  - living: tv_crt 8,15,0 · sofa_moldy 8,18,2 · shelf_moldering 11,15 · lamp_skull 7,15 · armchair_tattered 10,17,3;
  - kitchen: fridge_humming 19,15,1 · counter_butcher 19,16,1 · stove_greasefire 19,17,1 · sink_rusty 19,18,1 ·
    trash_lidded 14,15 · table_rickety 16,17 · chair_creaky 16,16,0 and 16,18,2;
  - painting_greatgrand on v:14:16 side 0 (living side);
  - porch: pew_salvaged 12,20,0;
  - yard: mailbox_crooked 12,26 · lantern_post 9,25 · plot_budget 24,12 · headstone_decor 24,10 · tree_gnarled 3,8
    and 25,22.
- **LOT_TEMPLATE_INFO:** `{ id:'wormwood_bungalow', name:'Sagging Bungalow', description:'A wide, low bungalow with a
  porch that sags like a sigh. Two of the five rooms still need furniture, and the bank has left you a little extra to
  buy it.', startingFunds: 9500 }`.
- **Balance check:** the bungalow has a Chill-Rest and two fun sources (TV and bookshelf). It also has a **second sink
  in the bathroom** (wash hands without crossing the house) and only a 2-seat table, so Family Dinner happens less
  than in the starter. That is deliberate, and the study is where a bigger table can go.

### 3.4 NEW — Narrow Townhouse, 2 Mildew Lane (`wormwood_townhouse`)
A tall, narrow gothic townhouse (in the spirit of `env_house_c`), single storey until multi-floor lands. It is fully
furnished and the only starter lot with an **Ice Bath**. The crypt-style front door and gothic windows make it the
"posh" start with little cash ($4,000). Validated: 45 objects, 0 errors, all slots reachable.

```
      4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5   (x; tens: 0000001111111111222222)
z05   . . . . . . . . . . . . . . . . . . . . . .
                   +-+-+W+-+-+W+-+
z06   . . . . . . .|C c P b|I I H|. . . . . . . .
                   +       +     +
z07   . . . . . . .|C b P b|t t t|. . . . . . . .
                   +       +     +
z08   . . . . . . .|b b b b|t t tW. . . . . . . .
                   +       +     +
z09   . . . . . . .|b b b b|t t t|. . . . . . . .
                   +       +     +
z10   . Z . . . . .|b b b f|t t M|. . . . Q . . .
                   +-+D+-+-+-+D+-+
z11   . . . . . . .|R k k k k k F|. . . . . . . .
                   +             +
z12   . . . . . . .|k k h h k k G|. . . . Y . . .
                   +             +
z13   . . . . . . .Wk k T T k k N|. . . . Y . . .
                   +             +
z14   . . . . . . .|k k h h k k S|. . . . . . . .
                   +             +
z15   . . . . . . .|k k k k k k kD: : : : . . . .
                   +-+-+D+-+-+-+-+
z16   . . . . . . .|u V p p p K p|. . . . . . . .
                   +             +
z17   . . . . . . .|p r r p p p p|. . . . . . . .
                   +             +
z18   . . . . . . .Wp r r p A p pW. . . . . . . .
                   +             +
z19   . . . . . . .|O O p p p p p|. . . . . . . .
                   +             +
z20   . . . . . . .|p p p p p p L|. . . . . . . .
                   +-+W+-+D+-+W+-+
z21   . . . . . . . . . . : . . . . . . . . . . .
z22   . . . . . . . . . . : . . . . . . . . . Z .
z23   . . . . . . . . . . : . . . . . . . . . . .
z24   . . . . . . . . . . : . . . . . . . . . . .
z25   . . . . . . . . . J : . . . . . . . . . . .
z26   . . . . . . . . . . : X . . . . . . . . . .
z27   . . . . . . . . . . : . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . .
```
Legend: codes as in §3.3, plus `p` parquet, `k` checker, I = tub_icebath, T = table_wake, r = rug_rag, u =
table_urnstand. The front door (`h:14:21`) is a `door_crypt`.

| Room | rect excl. | floor | wall |
|---|---|---|---|
| bedroom | (11,6)-(15,11) | floor_planks_dark | wall_damask_crimson |
| bathroom | (15,6)-(18,11) | floor_tile_morgue | wall_stripes_mint |
| kitchen/dining | (11,11)-(18,16) | floor_checker_bw | wall_tile_morgue |
| parlour | (11,16)-(18,21) | floor_parquet | wall_damask_midnight |

- **Floor fills.** front path (14,21)-(15,28); side path (18,15)-(22,16) from the back door.
- **Openings.**
  - Doors: `door_crypt` h:14:21 (front); `door_splintered` h:13:16 (parlour→kitchen), h:12:11 (kitchen→bedroom),
    h:16:11 (kitchen→bath), v:18:15 (back door).
  - Windows: `window_gothic` h:12:21, h:16:21, v:11:18, v:18:18; `window_grimy` v:11:13, h:13:6, h:16:6, v:18:8.
- **Objects:**
  - bedroom: coffin_chillrest 11,6 · candelabra 12,6 · coffin_pine 13,6 · plant_deadfern 14,10;
  - bath: tub_icebath 15,6,0 · shower 17,6 · mirror_cracked 17,10,1;
  - kitchen: fridge 17,11,1 · stove_greasefire 17,12,1 · counter_butcher 17,13,1 · sink 17,14,1 · trash 11,11 ·
    table_wake 13,13 · 4× chair_creaky (13,12) (14,12) r0, (13,14) (14,14) r2;
  - parlour: tv_crt 12,16 · rug_rag 12,17 · sofa_moldy 11,19,2 · armchair_tattered 15,18,3 · shelf_moldering 16,16 ·
    lamp_skull 17,20 · table_urnstand 11,16;
  - walls: painting_greatgrand v:11:17 side 1; sconce_candle h:14:11 side 0;
  - yard: mailbox 15,26 · lantern_post 13,25 · plot_budget 22,12 · headstone_decor 22,10 · tree_gnarled 5,10 and 24,22.
- **LOT_TEMPLATE_INFO:** `{ id:'wormwood_townhouse', name:'Narrow Townhouse', description:'Tall, thin and terribly
  proper: crypt door, gothic windows, an ice bath and a dining table for four. Every room is furnished, so the budget
  is thin.', startingFunds: 4000 }`.
- **Balance check:** $4,000 is $2,500 less than the starter, but the Ice Bath (+22 Freshness / 45 min, power)
  and Chill-Rest give two fridge-independent freshness sources. The higher lot value raises bills by about
  $13/bill (0.005 × $2,500). Scenario **B-T** (§13) must show funds trending up after day 7 with one entry-level wage.
  If it does not, raise startingFunds to $5,000 and price to $21,000.

### 3.5 NEW — Mildew Lane Corner Park (`wormwood_park`, community, venue `park`, always open)
A small square park on the corner: a cracked fountain at the crossing of two gravel paths, four iron benches, a
wilted gazebo, a bone-chess table, a creaky swing set, a picnic table, a pigeon-spattered statue of the town founder,
mushroom patches under the trees and a notice board by the gate. Validated: 29 objects, 0 errors, every slot reachable.

```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z02   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . : : . . . . . . . . . . T . . .
z04   . . . . G G G . . f f . . . : : . . . f f . . . . . . . . .
z05   . . . . G G G . . . . . . . : : . . . . . C C C . . . . . .
z06   . . . . G G G . . . . . . . : : . . . . . . . . . . . . . .
z07   . . . . . : . . . . . . . . : : . . . . . . . . . . . . . .
z08   . . . . . : . . . . . . . . : : . . . V . . . . . T . . . .
z09   . . . . . : . . . . . . . . : : . . . . . . . . . . m . . .
z10   . . . . . : . . . . . . L . B B . L . . . . . . . . . . . .
z11   . . T . . : . . . . . . : : : : : : . . . . . . . . . . . .
z12   . . . . . : . . . . . . : : : : : : . . . . . . . . . . . .
z13   . . : : : : : : : : : B : : U U : : B : : : : : : : : : . .
z14   . . : : : : : : : : : B : : U U : : B : : : : : : : : : . .
z15   . . . d d . . . . . . . : : : : : : . . . R . . . . . . . .
z16   . . . d d . . . . . . . : : : : : : . . . . . . . . . . . .
z17   . . . d d . . . . . . . L . B B . L . . . . . . . . . . . .
z18   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z19   . . . . . P P . . . . . . . : : . . . . . . . . . . . . . .
z20   . . . . . P P . . . . . . . : : . . . . . . S S . . . . . .
z21   . . . . . P P . . . . . . . : : . . . . . . . . . . . . . .
z22   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z23   . . T . . . . . . . . . . . : : . . . . . . . . . . . . . .
z24   . . . m . . . . T . . . . . : : . . . . . . . . . . . . . .
z25   . . . . . . . . . m . . . . : : . . . . . . . . . . . . . .
z26   . . . . . . . . . . . . . R : : . n . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Legend:

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `:` | `path_gravel` | `d` | packed dirt (forage bed under the gazebo trees) | U | fountain_murky (2×2) |
| B | bench_iron | G | gazebo_wilted (3×3) | C | table_bonechess (exists) |
| S | swing_creaky | P | picnic_table (2×3) | m | mushroom_patch |
| V | statue_pigeon | n | board_notice | R | trash_lidded |
| L | lantern_post | T | tree_gnarled | f | plant_deadfern |

The validation pass used `floor_stone_crypt` in place of `path_gravel` until P-W4 adds that floor pattern.

- **Floor fills.** gravel N–S (14,2)-(16,28), E–W (2,13)-(28,15), fountain ring (12,11)-(18,17), gazebo spur
  (5,7)-(6,13); dirt (3,15)-(5,18).
- **Objects:**
  - fountain_murky 14,13;
  - bench_iron 11,13,r3 (faces +X) · 18,13,r1 (faces −X) · 14,10,r0 · 14,17,r2;
  - gazebo_wilted 4,4 · table_bonechess 21,5 · swing_creaky 22,20 · picnic_table 5,19 · statue_pigeon 19,8;
  - mushroom_patch 3,24 · 9,25 · 26,9;
  - board_notice 17,26 · trash_lidded 13,26 · 21,15;
  - lantern_post 12,10 · 17,10 · 12,17 · 17,17;
  - tree_gnarled 2,23 · 8,24 · 25,8 · 26,3 · 2,11 · plant_deadfern 9,4 · 10,4 · 19,4 · 20,4.
- **Dressing** (non-simulated): `env_bush` hedge along x = 0 and z = 0, `env_streetlamp` ×2 on the sidewalk,
  `env_house_b` and `env_house_c` across the street.
- **Snapshot:** ~3 KB (29 objects).

## 4. New objects (L1)

Shared ones (`board_notice`, `path_gravel`) are in README §8. All are outdoorOnly.

| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `bench_iron` | Wrought-Iron Park Bench | free · $160 (also buyable for yards) | 2×1 | seat, bench | sit0, sit1 (like `pew_salvaged`) | home_sit, park_peopleWatch, home_nap (Lazy only, ×0.5 comfort) | Curly iron armrests, three warped wooden slats, one slat missing; a brass plaque "IN MEMORY OF SOMEONE". `Paint` = slats | 1,800 |
| `fountain_murky` | Murky Wishing Fountain | bones 300 · $1,200 | 2×2 | fountain, decor | use (any side, faceObject) | park_tossCoin, home_admireRug-style "Admire Fountain" (`park_admireFountain`) | Two-tier stone basin, green water (`water` node, animated), a stone fish spouting a sad trickle, coins on the bottom. Env +3 outdoors | 3,200 |
| `gazebo_wilted` | Wilted Gazebo | premium 450 GG · $2,400 | 3×3 | shelter, seat | sit0..sit3 rails (approach outside, pose inside) | home_sit, park_peopleWatch, (W-034) shelter from rain | Hexagonal wooden gazebo, drooping shingled roof, ivy, peeling white paint. `Paint` = posts | 5,500 |
| `swing_creaky` | Creaky Swing Set | free · $350 | 2×1 | swing, play | swing0, swing1 (sit) | park_swing | A-frame of rusted pipe, two chain swings with plank seats; one chain longer. `Paint` = frame | 1,400 |
| `picnic_table` | Rotten Picnic Table | free · $220 | 2×3 | seat, table, diningTable | n0, n1, s0, s1 (sit); 2 surfaces | eating (existing `home_haveServing` prefers tables), home_wipeDown, park_peopleWatch | Weathered plank table with attached benches, initials carved ("R.I.P. + D.O.A."). 2 `SurfaceSpec`s at TABLE_HEIGHT | 2,000 |
| `mushroom_patch` | Mushroom Patch | not buyable (spawn point) | 1×1, layer rug, passable | forage | use (any side) | park_forage | Cluster of 1–3 pale toadstools (data `count` 0–3 drives visible caps; 0 = bare dirt ring) | 300 |
| `statue_pigeon` | Statue of Founder Ezekiel Wormwood | not buyable | 1×1 | statue, pigeons | use (any side) | park_chasePigeons, park_feedPigeons, home_readEpitaph-style "Read Plaque" (`park_readPlaque`) | A pompous founder on a plinth, holding a scroll; pigeon flock (6 instanced birds, animated, flee on chase). Pigeons are FX, not agents | 2,600 (+6×120 birds) |

**Totals:** 7 new objects (5 buyable; 2 spawn/dressing) + 2 shared (`board_notice`, `path_gravel`).

**Reused (exists):** table_bonechess, trash_lidded, lantern_post, tree_gnarled, plant_deadfern, and every object in
§3.3/§3.4 (all in `src/shared/catalog.ts`).

## 5. New interactions (L1)

| id | Target | Effects | Duration | Requires | Autonomy ad | Anim | Moodlet |
|---|---|---|---|---|---|---|---|
| `park_tossCoin` | fountain_murky | cost $1; fun +4 (instant); 1 % chance the coin "comes back": +$1 and `luckyPenny` | 2 min | funds ≥ 1 | fun 4, adBonus 2; cheerful +3, hopelessRomantic +4 | `pickup` | `wishfulThinking` +4, 4 h |
| `park_admireFountain` | fountain_murky | fun +10/h | 10 min | — | fun 2 | `admire` | — |
| `park_swing` | swing_creaky | fun +14/h, social +3/h if the other swing is in use, stopWhen fun ≥ 98; preservation decay ×1.5 (like dancing) | 30 min | — | fun 10, adBonus 3; partyAnimal +3, lazy −2 | proposed `swing` (fallback `sit`) | `swungHigh` +4, 2 h |
| `park_peopleWatch` | bench_iron, gazebo, picnic_table | fun +8/h, social +4/h; every 10 min a 25 % chance a walking townie becomes "met" (introduce) | 20 min | — | fun 3, social 3, adBonus 2; loner +2 | `sit` | — |
| `park_chasePigeons` | statue_pigeon | fun +10 over the run, energy −2, hunger +3 (crumbs: free-food gated, README §4); the pigeons **always** escape | 10 min | pigeons present 06:00–19:00, not raining | fun 6, adBonus 3; partyAnimal +3, clumsy +2, neatFreak −2 | proposed `chase` → fallback `feral` | `comedicFailure` +5, 3 h |
| `park_feedPigeons` | statue_pigeon | cost $2; fun +12/h | 10 min | pigeons present | fun 3, adBonus 2; cheerful +3, grumpy −3 | `pickup` then `idle` | `pigeonPal` +3, 3 h |
| `park_forage` | mushroom_patch | hunger +8 per mushroom eaten (1 per run); digging xp 10/run (P-W2); salvage: none | 5 min | patch `count` ≥ 1 (spawns 0–3 per patch at 06:00, seeded by (seed, lotId, day)) | hunger 8; free-food gated | `clean` (crouch; proposed `dig`) | 10 %: `questionableMeal` (exists) |
| `park_readPlaque` | statue_pigeon | fun +30/h | 5 min | — | fun 4 | `read` | — |
| `town_readBoard` | board_notice (shared) | fun +2; opens the level's quest/event list in the UI | 2 min | — | fun 1 (rarely autonomous) | `read` | — |

**Reused:** home_sit, home_nap, home_playChess (bone chess), home_haveServing on the picnic table, home_wipeDown,
home_emptyTrash, home_rummageTrash (the park bins are a free-food source too).

**Totals:** 9 new interactions (8 park + `town_readBoard`, which every level shares).

### New moodlets
| id | Label | Mood | Duration | Note |
|---|---|---|---|---|
| `wishfulThinking` | Wishful Thinking | +4 | 240 min | max 1 stack |
| `luckyPenny` | Lucky Penny | +6 | 360 min | — |
| `swungHigh` | Swung Up High | +4 | 120 min | — |
| `comedicFailure` | Nearly Had It | +5 | 180 min | shared with L2 stray chasing; Grumpy gets −3 instead ("Humiliated") |
| `pigeonPal` | Pigeon Pal | +3 | 180 min | — |

## 6. Townies & NPCs
- **24 townies** (`TOWNIE_COUNT`, generated from the world seed with random appearance, 3 traits and occupation
  flavour). They are the pool for Wormwood **and** for the graveyard (L2 has no pool of its own). Cast-body townies
  (W-002) use `townieBodies(seed, 24)`. Bodies that fit Mildew Lane: walker, granny, civilian, business, jogger,
  tourist, pizza, gamer.
- **Park arrivals** (weights per game hour, drawn hourly, stay 1–3 h, ≤ 8 on the lot):

| Hours | 06–09 | 09–12 | 12–15 | 15–19 | 19–22 | 22–06 |
|---|---|---|---|---|---|---|
| Weight | 0.30 (joggers) | 0.45 | 0.60 | 0.70 | 0.40 | 0.05 |

- **NPC — Park Warden Hollis Moss** (body `hardhat`, role npc, shift 08:00–18:00). Empties the bins at 12:00 and
  17:00, wipes the picnic table, refills the mushroom patches visually (it is cosmetic: spawns are seeded), shoos
  nobody, and likes Neat Freaks (+5 friendship on the first chat).
- **Regular — "Knight-Takes-Bishop" Bertram** (a seeded townie flagged `parkRegular`): sits at the bone-chess table
  14:00–18:00 on 4 of 7 days and accepts chess challenges (charisma-free). Losing to him is the repeatable
  `n_ww_chessHustle`.

## 7. Quests

Objective kinds are the shipped ones (`src/sim/contracts.ts`) plus `visitLot` (P-W6). New stat keys: `coinsTossed`,
`pigeonsChased`, `mushroomsForaged`.

**Story bridge "Out and About"** (teaches travel; starts after `story_firstMeal`; total 210 Bones):

| id | Title | Steps (objective) | Bones | Requires |
|---|---|---|---|---|
| `story_ww_park` | Fresh(ish) Air | visit the Corner Park (`visitLot wormwood:corner_park`) → toss a coin (`interaction ids [park_tossCoin] 1`) | 40 | story_firstMeal |
| `story_ww_pigeons` | Pigeon Diplomacy | chase pigeons once (`interaction [park_chasePigeons] 1`) → feed them once (`[park_feedPigeons] 1`) | 50 | story_ww_park |
| `story_ww_overTheFence` | Over the Fence | read the park notice board (`[town_readBoard] 1`) → visit the Old Graveyard (`visitLot graveyard:old_graveyard`) | 120 + `cosmetic:frame_ivy` | story_ww_pigeons |

`story_ww_overTheFence` hands over to the L2 chain (L2 §8).

**Repeatables** (2 offered per morning, as shipped):

| id | Title | Objective | Bones | Cooldown |
|---|---|---|---|---|
| `n_ww_chessHustle` | Hustled by Bertram | play chess at the park twice (`interaction tags [chess] 2`, on lot `wormwood:corner_park`; uses `match: {lotId}`) | 20 | 2 d |
| `n_ww_swingSet` | Higher! | swing twice | 15 | 2 d |
| `n_ww_forager` | Toadstool Tuesday | forage 3 mushrooms | 20 | 2 d |
| `n_ww_parkLife` | Park Life | spend time people-watching 3 times | 15 | 2 d |

**Daily-task pool additions** (fresh-activity kinds only): `d_ww_coin` toss a coin (6), `d_ww_pigeons` chase
pigeons (6), `d_ww_forage` forage a mushroom (8), `d_ww_visitPark` visit the park (8).

## 8. Level events
| Event | When | What |
|---|---|---|
| **Sunday Swap Meet** | Sundays 10:00–14:00 at the park | NPC "Rummage Rita" (body `granny`) sets up a 2×1 `stall_swapmeet` (dressing object) and offers 4 seeded used objects from the free catalogue at 70 % of price (they arrive in the household inventory, which is the same as buying). Deterministic from (seed, week). |
| **Moonlit Picnic** | full-moon nights (every 7th day), 20:00–23:00 | Townie arrival weight ×2 at the park; anyone eating at the picnic table gets `moonlitPicnic` +6 (3 h); the fountain glows (bulb node). |
| Existing GDD §13 events | — | fly swarm, mail, fridge breaks, power flicker at full moon, raven, grave-robber 03:00, smell complaints, lottery. All unchanged. |
| **Seasonal (W-034)** | autumn | leaf piles on lawns (`park_kickLeaves` fun +12/h, 5 min, once per pile) |
| **Seasonal (W-034)** | Halloween | trick-or-treaters ring doorbells 18:00–21:00 (Give Candy $2 → friendship +4) |
| **Seasonal (W-034)** | winter | the fountain freezes (park_tossCoin → "Slide a Coin", same numbers) |

## 9. Music & ambience brief
- `mus_wormwood`: the existing live/night/build moods, unchanged. Mildew Lane is the "home" theme, with a warm
  detuned piano and a slow waltz pulse.
- `mus_wormwood_park` (new variant): the same motif on a music-box timbre with pizzicato low strings; brighter by
  day, celesta at night.
- `amb_wormwood`: the existing day and night beds.
- `amb_park`: day = distant crows, pigeon coos (one-shots every 6–14 s), the fountain trickle loop (spatialised at
  14,13), the swing creak while in use, and a far-off ice-cream-truck chime (detuned, very quiet, once per game hour);
  night = crickets, fountain, the owl.
- New SFX ids to add to `SFX_IDS` (lead-owned): `fountainTrickle`, `coinPlop`, `pigeonFlap`, `swingCreak`.

## 10. Environment look (`env_wormwood`, exists per ART_DIRECTION)
| Key | Day | Dusk | Night |
|---|---|---|---|
| Sky / fog | warm grey overcast, fog `#9aa39a` | lilac `#8c7a9e` to orange `#c98a5a` | deep blue-plum `#1d1726`, big pale moon |
| Ground / street | moss grass `#6f8f5e`, cracked sidewalk, dark road with faded lines | — | — |

Full-moon nights tint everything slightly green. The park uses the same environment with a denser tree line and no
neighbour house behind it (view to the graveyard fence at the north edge).

## 11. Store tie-ins
- **Themed premium set "Sunday in the Park"** (1,350 GG; sum of parts 1,550 GG shown):
  - gazebo_wilted (450);
  - fountain_murky as a GG alternative to its Bones price (300);
  - a premium `bench_iron` skin "Memorial Brass" (200);
  - `lamp_park_globe` (150, a new small decor lamp);
  - `planter_urn` (150);
  - `birdbath_skull` (150);
  - `kite_tattered` (wall decor, 150).
- **Bones items:** fountain_murky (300); the swing and bench stay free.
- **Sponsor:** a Rot-Pop vending machine (`vending_rotpop`, the L2 Grave-Cola machine's sibling skin, README §5) by
  the park gate. "Buy a Rot-Pop": $2, fun +3, hunger +4. That is **paid** food, so with funds ≥ $12 it disables
  free-food scoring on this lot.

## 12. Acceptance criteria
1. `createLotTemplate('wormwood_bungalow' | 'wormwood_townhouse' | 'wormwood_park')` returns fresh, JSON-safe data;
   every object passes checkPlace/checkWallItem/checkOpening with no blocked slots and every slot is reachable from
   both sidewalk entries (extend `tests/unit/spatial/templates.test.ts`).
2. Room counts: bungalow 5 indoor rooms (20/12/20/35/30 tiles), townhouse 4 (20/15/35/35), park 0.
3. `LOT_TEMPLATE_INFO` lists four residential templates; New Game shows all four with funds and descriptions.
4. Balance (`npm run balance`, plus new scenarios **A-B** = A on the bungalow, **A-T** = A on the townhouse,
   **B-T** = B on the townhouse) meets GDD §18 on 5/5 seeds. The new scenarios join the sweep.
5. Park: interactions obey hours/pigeon presence; free-food gate verified (funds $50 + reachable vending →
   park_forage never autonomously picked; funds $5 → picked when Appetite < 55).
6. Perf: the park's busiest view ≤ 250 draw calls (29 objects + ≤ 18 agents + dressing); the residential lots like
   the starter (≤ 400).
7. Snapshot sizes: park ≤ 10 KB, bungalow/townhouse ≤ 60 KB.

## 13. Tests
| Test | Kind | Asserts |
|---|---|---|
| templates.l1.test.ts | unit | shape, validity, reachability, room counts, required objects per template (counts in §3) |
| park.interactions.test.ts | unit | tossCoin charges $1 once (idempotency key), luckyPenny refund deterministic per seed; swing stops at 98; chasePigeons never "catches"; forage count decrements and respawns at 06:00 identically after save/load |
| park.townies.test.ts | unit | arrival schedule depends only on (seed, lotId, day); never more than 8 townies; warden shift |
| travel.wormwood.test.ts | integration | starter → park → starter round trip identical to a reference run; save/load mid-trip; catch-up idempotent |
| balance A-B, A-T, B-T | balance | GDD §18 targets |
| e2e park.spec | e2e | the map pin opens the park; the camera bounds and cutaway work on a wall-less lot; screenshot set (day, dusk, night, full moon) |

## 14. Open questions
1. Price/startingFunds rule ($26,000 net worth for every lot): OK, or keep prices independent of funds?
2. Should the bungalow and townhouse be offered at New Game, or only by moving later (moving needs a "Move
   Household" flow the framework does not specify)?
3. Is `gazebo_wilted` as the premium piece OK, or should a free gazebo exist and the premium be a skin?

## 15. References
Real-world reference only (README §12). Park layout logic, with a central water feature at the crossing of two
axial paths and benches facing it, follows the common neighbourhood-square pattern also used in rural-cemetery
"garden" design: https://en.wikipedia.org/wiki/Rural_cemetery
