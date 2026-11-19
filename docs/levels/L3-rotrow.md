# L3 — Downtown Rot Row (community + small residential)

Level id `rotrow` · unlock: **day 3, or earlier by finishing `story_getJob`** (P-W1) · build order 2nd (W-016).
Downtown is where the dead go to shop, sweat, study, work, dance and get their stitches done. It turns the free-food
safety net (pantry) and the skill objects of the home lot (gym, library, lab) into **venues**. It is the first level
where opening hours, entry fees and NPC staff matter. Shared conventions are in [README.md](README.md).

## 1. Fantasy & tone
One long brick street of crooked three-storey shopfronts. There are gas-lamp-style street lights that buzz, a tram
bell nobody has heard ring in years, neon signs missing letters ("GRIMM'S G M"), and a juice-and-tonic nightclub
where the dance floor lights up whatever your limb count is.

Rot Row has the hustle of a small-town Main Street run by people who are in no hurry at all:
- the **Brain Bank** pantry hands out meal boxes with no questions;
- the **Market** buys your grave goods;
- **Grimm's Gym** has a coach who spots you so your arm stays on;
- the **library** shushes groaning;
- **Necro-Tech** is a start-up with a nap pod;
- **The Rigor Room** opens at eight;
- the **Shear Terror** salon can make anyone look almost alive.

E10+ note: the club serves **non-alcoholic** tonics and slushies (stated in-game on the bar menu). The nightlife
fantasy is music, dancing, stand-up and gossip.

## 2. Neighbourhood map

`LevelDef`: `{ id:'rotrow', name:'Downtown Rot Row', blurb:'Shops, sweat, study and a dance floor that never judges.',
environment:'env_rotrow', townies: 16, unlock:{kind:'day', value:3}, content:['rotrow','venues'] }`.
The 16 downtown townies are seeded from `(seed,'rotrow')` and are separate from Wormwood's 24. Total town population
at L3 is 40 townies.

The street layout puts the anchors (market, pantry) at the ends and the evening venues together, which follows the
small-downtown planning advice in the References: two destination anchors that draw people from outside, plus an
evening cluster.

| id | kind | name | templateId | w×d | buildable | map | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `rotrow:brain_bank` | community | Brain Bank Food Pantry | `rotrow_pantry` | 30×30 | [1,29)×[1,27) | 530,300 | `pantry` | 10–18 | — | level | `amb_rotrow` / `mus_rotrow` |
| `rotrow:market` | community | Rot Row Market | `rotrow_market` | 30×30 | default | 560,300 | `market` | 08–22 | — | level | `amb_rotrow` / `mus_rotrow` |
| `rotrow:gym` | community | Grimm's Gym | `rotrow_gym` | 30×30 | default | 590,300 | `gym` | 06–23 | — | level | `amb_rotrow_indoor` / `mus_rotrow_gym` |
| `rotrow:library` | community | Dusty Tomes Library | `rotrow_library` | 30×30 | default | 620,300 | `library` | 09–21 | — | level | `amb_rotrow_quiet` / `mus_rotrow_library` |
| `rotrow:necrotech` | workplace | Necro-Tech Campus | `rotrow_necrotech` | 30×30 | default | 530,360 | `office` | 08–20 | — | level | `amb_rotrow_indoor` / `mus_rotrow` |
| `rotrow:rigor_room` | community | The Rigor Room | `rotrow_club` | 30×30 | default | 560,360 | `nightclub` | 20–03 | — | level | `amb_rotrow_club` / `mus_rotrow_club` |
| `rotrow:salon` | community | Shear Terror Salon | `rotrow_salon` | 30×30 | default | 590,360 | `salon` | 10–20 | — | level | `amb_rotrow_indoor` / `mus_rotrow` |
| `rotrow:walkup_2a` | residential | Walk-Up 2A, Rot Row | `rotrow_walkup` | 30×30 | **[8,22)×[9,24)** | 620,360 | — | — | 12,000 | level | `amb_rotrow` / `mus_rotrow` |
| `rotrow:loft` | residential | Market Street Loft | `rotrow_loft` | 30×30 | **[6,24)×[4,24)** | 640,330 | — | — | 16,000 | level | `amb_rotrow` / `mus_rotrow` |

- **New-game funds** (README §3 and L1's $26,000 rule): Walk-Up 2A $14,000; Loft $10,000. The apartments trade
  build space for cash.
- **"The Rigor Room"** replaces the working name "Club Thriller" (P-W12).
- **Necro-Tech Campus** is a `workplace` lot. Necro-Tech careerists can visit on or off shift (the career itself
  stays a rabbit hole, GDD §10). Anyone can visit the lobby.

```
Rot Row tab (map units)
  (530,300) Brain Bank   (560,300) Market    (590,300) Grimm's Gym   (620,300) Library
  ════════════════════════ Rot Row (tram line) ═══════════════════════════════  (640,330) Loft
  (530,360) Necro-Tech   (560,360) Rigor Room (590,360) Salon        (620,360) Walk-Up 2A
```
Travel from Mildew Lane is 36–40 min; between downtown lots 15–18 min.

## 3. Lots
Every plan below was validated with the real spatial code: every object placed through checkPlace / checkWallItem /
checkOpening, no blocked slots, every slot reachable from both sidewalk entries. Object codes are listed per plan.
Lowercase letters are floor styles. New object ids are defined in §4. All storefront fronts face the street (+Z).
Each lot's curb gets a `spot_parking` (vehicles, W-031) and an `env_streetlamp`; neighbouring buildings are `env_shopfront_*`
dressing (§11).

### 3.1 Brain Bank Food Pantry (`rotrow_pantry`) — 25 objects, 0 errors
```
      4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5   (x; tens: 0000001111111111222222)
z04   . . . . . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . . . . . .
             +-+-+-+-+-+-+-+
z06   . . . .|w c w c w c w|. . . . . . . . . . .
             +             +
z07   . . . .|w w w w w w w|. . . . . . . . . . .
             +             +
z08   . . . .|w w w w w w w|. . . . . . . . . . .
             +             +
z09   . . . .|w w w w w w w|. . . . . . . . . . .
             +-+-+D+-+-+-+-+-+-+-+-+-+-+-+
z10   . . . .|R k k k k k k k S S S S S S|. . . .
             +                           +
z11   . . . .|k k k k k k k k k k k k k k|. . . .
             +                           +
z12   . . . .|k k k k k Q Q Q k k k k k k|. . . .
             +                           +
z13   . . . .|k k k k k k k k k k k k k n|. . . .
             +                           +
z14   . . . .|k k k k k k k k k k k k k k|. . . .
             +                           +
z15   . . . .Wk k k k k k k k k k k k k kW. . . .
             +                           +
z16   . . . .|k h k k h k k k k k h k k k|. . . .
             +                           +
z17   . . . .|k T k k T k k k k k T k k k|. . . .
             +                           +
z18   . . . .|k h k k h k k k k k h k k k|. . . .
             +                           +
z19   . . . .|k k k k k k k k k k k k d k|. . . .
             +                           +
z20   . . . .|k k k k k k k k k k k k k f|. . . .
             +-+-+W+-+-+-+-+D+-+-+-+W+-+-+
z21   . . . . . . . . . . . : . . . . . . . . . .
z22   . . . . . . . . . . . : . . . . . . . . . .
z23   . . . . . . . . . . . : . . . . . . . . . .
z24   . . . . . . . . . . . : . . . . . . . . . .
z25   . . . . . . . . . . . : . . . . . . . . . .
z26   . . . . . . . . . . . : . . . . . . . . . .
z27   . . . . . . . . . . . : . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `k` | hall (moss checker) | `w` | storeroom | Q | counter_pantry (staff behind) |
| S | shelf_pantry | T | table_rickety | h | chair_creaky |
| d | bin_donation | n | board_notice | c | crate_supplies |
| R | trash_lidded | f | plant_deadfern | | |

- **Doors:** front h:15:21, store h:10:10.
- **NPC:** volunteer coordinator **Dot Marrow** (body `granny`), 10–18, behind the counter.

### 3.2 Rot Row Market (`rotrow_market`) — 21 objects
```
      3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6   (x; tens: 000000011111111112222222)
z04   . . . . . . . . . . . . . . . . . . . . . . . .
         +-+-+-+-+-+-+-+
z05   . .|w c c w w w w|. . . . . . . . . . . . . . .
         +             +
z06   . .|w w w w w w w|. . . . . . . . . . . . . . .
         +             +
z07   . .|w w w w w w w|. . . . . . . . . . . . . . .
         +-+-+-+D+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z08   . .|k k k k k k k k k k k k W W k k k k k P|. .
         +                                       +
z09   . .|k k k k k k k k k k k k k k k k k k k k|. .
         +                                       +
z10   . .|k k k k k k k k k k k k k k k k k k k k|. .
         +                                       +
z11   . .|k G G G k k G G G k k k k k k k Q Q k k|. .
         +                                       +
z12   . .|k k k k k k k k k k k X X X k k k k k k|. .
         +                                       +
z13   . .|k k k k k k k k k k k X X X k k k k k k|. .
         +                                       +
z14   . .|k k k k k k k k k k k k k k k k k k k k|. .
         +                                       +
z15   . .|k G G G k k G G G k k k k k k k F F k k|. .
         +                                       +
z16   . .|k k k k k k k k k k k k k k k k k k k k|. .
         +                                       +
z17   . .|k k k k k k k k k k k k k k k k k k k k|. .
         +                                       +
z18   . .|k k k k k k k k k k k k k K K k k k k k|. .
         +                                       +
z19   . .|k n k k k k k k k k k k k k k k k k k k|. .
         +                                       +
z20   . .|k k k k k k k k k k k k k k k k k k k R|. .
         +-+-+W+-+-+-+W+-+-+D+D+-+-+-+W+-+-+-+W+-+
z21   . . . . . . . . . . . : : . . . . . . . . . . .
z22   . . . . . . . . . . . : : . . . . . . . . . . .
z23   . . . . . . . . . . . : : . . . . . . . . . . .
z24   . . . . . . . . . . . : : . . . . . . . . . . .
z25   . . . . . . . . . . . : : . . . . . . . . . . .
z26   . . . . . . . . . . . : : . . . . . . . . . . .
z27   . . . . . . . . . . . : : . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| G | shelf_grocery (×4, two aisles) | K | counter_checkout | Q | counter_curio |
| F | stall_fish | W | stall_flowers | X | display_showroom (3×2) |
| P | fridge_rotpop (sponsor) | c | crates | | |

- **Doors:** double front doors h:14:21 + h:15:21; back h:8:8.
- **NPCs:** curio dealer **Mr. Pallor** (body `business`) at Q; cashier **Gus** (body `cone`) at K.

### 3.3 Grimm's Gym (`rotrow_gym`) — 25 objects
```
      4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5   (x; tens: 0000001111111111222222)
z02   . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . .
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z04   . .|H H t t t t t t|t t ~ ~ ~ t t t I t|. .
         +               +                   +
z05   . .|t t t t t t t t|t t ~ ~ ~ t t t t t|. .
         +               +                   +
z06   . .|t t t t b b t t|t t t t t t t t t t|. .
         +               +                   +
z07   . .|t t t t t t t t|t t t t t t t t t t|. .
         +               +                   +
z08   . .|t t t t t t t t|t t t t t t t t t t|. .
         +-+-+-+-+D+-+-+-+-+-+-+-+-+D+-+-+-+-+
z09   . .|g g g g g g g g g g g g g g g g g g|. .
         +                                   +
z10   . .|g Y Y g Y Y g Y Y g g M g M g M g g|. .
         +                                   +
z11   . .|g g g g g g g g g g g M g M g M g g|. .
         +                                   +
z12   . .|g g g g g g g g g g g g g g g g g P|. .
         +                                   +
z13   . .|g g g g g g g g g g g g g g g g g g|. .
         +                                   +
z14   . .|g g g g g g g g g g g g g g g g g g|. .
         +                                   +
z15   . .|g g B g g B g g g g g m m g g g g g|. .
         +                                   +
z16   . .|g g g g g g g g g g g m m g g g g g|. .
         +                                   +
z17   . .|g g g g g g g g g g g g g g g g g g|. .
         +                                   +
z18   . .|g g g g g g g g g g g g g g K K g g|. .
         +                                   +
z19   . .|g n g g g g g g g g g g g g g g g g|. .
         +                                   +
z20   . .|g g g g g g g g g g g g g g g g g g|. .
         +-+-+W+-+-+-+W+-+D+D+-+-+W+-+-+-+W+-+
z21   . . . . . . . . . . : : . . . . . . . . . .
z22   . . . . . . . . . . : : . . . . . . . . . .
z23   . . . . . . . . . . : : . . . . . . . . . .
z24   . . . . . . . . . . : : . . . . . . . . . .
z25   . . . . . . . . . . : : . . . . . . . . . .
z26   . . . . . . . . . . : : . . . . . . . . . .
z27   . . . . . . . . . . : : . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `g` | gym floor | `t` | tile | Y | gym_limb (exists ×3) |
| M | treadmill_rattle (×3) | B | bag_punching | m | mat_stretch (rug) |
| K | counter_reception | H | shower_drizzle (locker room) | b | bench_locker |
| ~ | pool_plunge (3×2, plunge room) | I | mirror_cracked | P | fridge_rotpop |

- **NPC:** **Coach Brawnstein** (body `strongman`), 08–20.

### 3.4 Dusty Tomes Library (`rotrow_library`) — 35 objects
```
      3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6   (x; tens: 000000011111111112222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . .
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z04   . .|r r r L r r r s s r|a a a a a a a a s s|. .
         +                   +                   +
z05   . .|r A r r A r r r r r|a D a D a a a a a a|. .
         +                   +                   +
z06   . .|r r r r r r r r r r|a D a D a a a a a a|. .
         +                   +                   +
z07   . .|r r r r r r r r r r|a a a a a a a a a a|. .
         +                   +                   +
z08   . .|r r r r r r r r r r|a a a a a a a a a a|. .
         +-+-+-+-+D+-+-+-+-+-+-+-+-+-+-+D+-+-+-+-+
z09   . .|p p p p p p p p p p p p p p p p p p p p|. .
         +                                       +
z10   . .|p S S S p S S S p p p p p S S S p S S S|. .
         +                                       +
z11   . .|p p p p p p p p p p p p p p p p p p p p|. .
         +                                       +
z12   . .|p p p p p p p p p p p p p p p p p p p p|. .
         +                                       +
z13   . .|p S S S p S S S p p p p p S S S p S S S|. .
         +                                       +
z14   . .|p p p p p p p p p p p p p p p p p p p p|. .
         +                                       +
z15   . .|p p p p p p p p h h h p p p p p p p p p|. .
         +                                       +
z16   . .|p p p p p p p p T T T p p p p p p p p p|. .
         +                                       +
z17   . .|p p p p p p p p h h h p p p p p p C p p|. .
         +                                       +
z18   . .|p p p p p p p p p p p p p p K K p p p p|. .
         +                                       +
z19   . .|p n p p p p p p p p p p p p p p p p p p|. .
         +                                       +
z20   . .|p p p p p p p p p p p p p p p p p p p p|. .
         +-+-+W+-+-+-+W+-+-+D+D+-+-+-+W+-+-+-+W+-+
z21   . . . . . . . . . . . : : . . . . . . . . . . .
z22   . . . . . . . . . . . : : . . . . . . . . . . .
z23   . . . . . . . . . . . : : . . . . . . . . . . .
z24   . . . . . . . . . . . : : . . . . . . . . . . .
z25   . . . . . . . . . . . : : . . . . . . . . . . .
z26   . . . . . . . . . . . : : . . . . . . . . . . .
z27   . . . . . . . . . . . : : . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `p` | parquet hall | `r` | reading room | `a` | archive |
| S | shelf_library (3×1, ×8) | T | table_reading (3×1) + 6 chairs | K | counter_loan |
| C | catalog_cards | A | armchair | s | shelf_moldering (exists) |
| D | desk_hauntedpc (public PCs, sponsor Necro-Tech skin) | | | | |

- **NPC:** librarian **Miss Quietus** (body `nurse`), 09–21.

### 3.5 Necro-Tech Campus (`rotrow_necrotech`, workplace) — 22 objects
```
      6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3   (x; tens: 000011111111112222)
z04   . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . .
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z06   . .|t t t t t t t|o D o D o D o|. .
         +             +             +
z07   . .|t B B t B B t|o D o D o D o|. .
         +             +             +
z08   . .|t t t t t t t|o o o o o o o|. .
         +             +             +
z09   . .|t t t t t t t|o o o o o o o|. .
         +             +             +
z10   . .|t t t t t t t|o o o o o N N|. .
         +             +             +
z11   . .|V t t t t t t|o o o o o N N|. .
         +             +             +
z12   . .|V t t t t t t|o o o o o o o|. .
         +             +             +
z13   . .|t t t t t t t|o o o o o o o|. .
         +-+-+-+D+-+-+-+-+-+-+D+-+-+-+
z14   . .|m m m m m m m m m m m m m m|. .
         +                           +
z15   . .|m n m m m m m m m m m m m f|. .
         +                           +
z16   . .|m m m m m m K K m m m m m m|. .
         +                           +
z17   . .|m m m m m m m m m m m m m m|. .
         +                           +
z18   . .|m m m m m m m m m m m m m e|. .
         +                           +
z19   . .|m O O m m m m m m m m m m m|. .
         +                           +
z20   . .|m m m m m m m m m m m m m m|. .
         +-+W+-+-+W+-+D+D+-+-+W+-+-+W+
z21   . . . . . . . . : : . . . . . . . .
z22   . . . . . . . . : : . . . . . . . .
z23   . . . . . . . . : : . . . . . . . .
z24   . . . . . . . . : : . . . . . . . .
z25   . . . . . . . . : : . . . . . . . .
z26   . . . . . . . . : : . . . . . . . .
z27   . . . . . . . . : : . . . . . . . .
z28   = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `m` | marble lobby | `t` | lab | `o` | open office |
| K | counter_reception | B | bench_lab | V | server_rack (decor, glow) |
| D | desk_hauntedpc (hot desks) | N | pod_nap | e | espresso (Coffin Coffee) |

- **NPC:** receptionist **Byte** (body `business`), 08–20 weekdays.

### 3.6 The Rigor Room (`rotrow_club`, nightclub) — 18 objects
```
      3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6   (x; tens: 000000011111111112222222)
z01   . . . . . . . . . . . . . . . . . . . . . . . .
z02   . . . . . . . . . . . . . . . . . . . . . . . .
         +-+-+-+-+-+-+-+-+           +-+-+-+-+-+-+
z03   . .|l l l l l l l l|. . . . . .|b b b b b b|. .
         +               +           +           +
z04   . .|l O O l O O l P|. . . . . .|b S S S b b|. .
         +               +           +           +
z05   . .|l l l l l l l l|. . . . . .|b S S S b b|. .
         +               +           +           +
z06   . .|l l l l l l l l|. . . . . .|b b b b b b|. .
         +-+-+-+-+D+-+-+-+-+-+-+-+-+-+-+-+-+D+-+-+
z07   . .|c c c c c c c c c c c c c c c c c c c c|. .
         +                                       +
z08   . .|c c c c c Z c c J J c c Z c c c c c c c|. .
         +                                       +
z09   . .|c c c c c c c c c c c c c c c c c c c c|. .
         +                                       +
z10   . .|c c c c c x x x x x x x x c c c c c c c|. .
         +                                       +
z11   . .|c c c c c x x x x x x x x c c c c c c c|. .
         +                                       +
z12   . .|c c c c c x x x x x x x x c c Q c c c c|. .
         +                                       +
z13   . .|c c c c c x x x x x x x x c c Q c c c c|. .
         +                                       +
z14   . .|c c c c c x x x x x x x x c c Q c c c c|. .
         +                                       +
z15   . .|L c c c c x x x x x x x x c c Q c c c c|. .
         +                                       +
z16   . .|c c c c c c c c c c c c c c c c c c c c|. .
         +                                       +
z17   . .|c T c c T c c c c c c c c c c c c c c c|. .
         +                                       +
z18   . .|c v v c v v c c c c c c c c c c c c c c|. .
         +                                       +
z19   . .|c c c c c c c c c c c n c c c c c c c L|. .
         +                                       +
z20   . .|c c c c c c c c c c c c c c c c c c c c|. .
         +-+-+-+-+-+-+-+-+-+D+-+-+-+-+-+-+-+-+-+-+
z21   . . . . . . . . . . . : : . . . . . . . . . . .
z22   . . . . . . . . . . . : : . . . . . . . . . . .
z23   . . . . . . . . . . . : : . . . . . . . . . . .
z24   . . . . . . . . . . . : : . . . . . . . . . . .
z25   . . . . . . . . . . . : : . . . . . . . . . . .
z26   . . . . . . . . . . . : : . . . . . . . . . . .
z27   . . . . . . . . . . . : : . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| `x` | **dance floor** (new floor style `floor_dance_lit`, emissive tiles that pulse with the music; validated with black marble) | J | booth_dj | Z | stereo_boombox speakers (exists) |
| Q | bar_counter (4 front places) | S | stage_small (backstage room) | v | booth_velvet + table |
| `l` | lounge (sofas, Rot-Pop fridge) | | | | |

- **NPCs:** **DJ Embalm-o** (body `mascot`) and bartender **Velma Vex** (body `shield`), 20–03.

### 3.7 Shear Terror Salon (`rotrow_salon`) — 20 objects
```
      6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3   (x; tens: 000011111111112222)
z04   . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . .
         +-+-+-+-+           +-+-+-+-+
z06   . .|c w w w|. . . . . .|t t t s|. .
         +       +           +       +
z07   . .|w w w w|. . . . . .|t t t t|. .
         +       +           +       +
z08   . .|w w w w|. . . . . .|t t t t|. .
         +       +           +       +
z09   . .|w w w w|. . . . . .|t t t t|. .
         +-+-+D+-+-+-+-+-+-+-+-+-+D+-+
z10   . .|k I k I k I k k k k k k k k|. .
         +                           +
z11   . .|k k k k k k k k k E k k k k|. .
         +                           +
z12   . .|k C k C k C k k k E k k H k|. .
         +                           +
z13   . .|k k k k k k k k k k k k k k|. .
         +                           +
z14   . .|k k k k k k k k k k k k H k|. .
         +                           +
z15   . .|k k k k k k k k k k k k k k|. .
         +                           +
z16   . .|k k k k k k k k k k k k k k|. .
         +                           +
z17   . .|k k k k k k k k k K K k k k|. .
         +                           +
z18   . .|k O O u k k k k k k k k k k|. .
         +                           +
z19   . .|k k k k k k k k k k k k k f|. .
         +-+-+W+-+-+-+D+-+-+-+W+-+-+-+
z20   . . . . . . . . : : . . . . . . . .
z21   . . . . . . . . : : . . . . . . . .
z22   . . . . . . . . : : . . . . . . . .
z23   . . . . . . . . : : . . . . . . . .
z24   . . . . . . . . : : . . . . . . . .
z25   . . . . . . . . : : . . . . . . . .
z26   . . . . . . . . : : . . . . . . . .
z27   . . . . . . . . : : . . . . . . . .
z28   = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| C | chair_salon (sit + stylist slot) | I | mirror_cracked facing each chair | E | station_waxpreserve (1×2 lie) |
| H | dryer_hood | K | counter_reception | `t` | WC (sink) |

- **NPC:** stylist **Ferdinand Shears** (body `ringmaster`), 10–20.

### 3.8 NEW residential — Walk-Up 2A, Rot Row (`rotrow_walkup`) — 30 objects, buildable [8,22)×[9,24)
A one-bedroom apartment with brick walls and a nook office. It has a Chill-Rest, TV + bookshelf + PC (three fun
sources) and a full kitchen. Walls outside the buildable rectangle are neighbouring buildings (`env_brick_block`
dressing).
```
      7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2   (x; tens: 0001111111111222)
z08   . . . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . . . .
         +-+-+-+W+-+-+-+-+-+-+-+-+
z10   . .|C c P b b|H S M|K n n D|. .
         +         +     +       +
z11   . .|C b P b b|t t t|n n n D|. .
         +         +     +       +
z12   . .|b b b b b|t t t|n n n n|. .
         +         +     +       +
z13   . .|b b b b b|t t t|n n n n|. .
         +-+-+D+-+-+-+D+-+-+-+D+-+
z14   . .|l V l l l l l l l l l l|. .
         +                       +
z15   . .|l l l l l l l l l l l F|. .
         +                       +
z16   . .|l r r l l l l h l l l G|. .
         +                       +
z17   . .|l r r l l l l T l l l NW. .
         +                       +
z18   . .|l O O l l l l h l l l S|. .
         +                       +
z19   . .|L l l l R l l l l l l l|. .
         +-+W+-+-+W+-+D+-+-+W+-+-+
z20   . . . . . . . . : . . . . . . .
z21   . . . . . . . . : . . . . . . .
z22   . . . . . . . . : . X . . . . .
z23   . . . . . . . . : . . . . . . .
z24   . . . . . . . . : . . . . . . .
z25   . . . . . . . . : . . . . . . .
z26   . . . . . . . . : . . . . . . .
z27   . . . . . . . . : . . . . . . .
z28   = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . .
```
Codes as L1 §3.3, plus D = desk_hauntedpc, r = rug_rag. Front door `door_crypt` h:15:20.

### 3.9 NEW residential — Market Street Loft (`rotrow_loft`) — 32 objects, buildable [6,24)×[4,24)
One big open-plan brick loft with seven gothic windows, an easel corner, a stereo, an ice-bath bathroom and a dining
table for four. It suits the creative household.
```
      5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4   (x; tens: 00000111111111122222)
z03   . . . . . . . . . . . . . . . . . . . .
z04   . . . . . . . . . . . . . . . . . . . .
         +-+-+-+-+
z05   . .|H I I M|. . . . . . . . . . . . . .
         +       +
z06   . .|t t t t|. . . . . . . . . . . . . .
         +       +
z07   . .|t t t t|. . . . . . . . . . . . . .
         +       +
z08   . .|t t t t|. . . . . . . . . . . . . .
         +-+-+D+-+-+-+-+-+-+-+-+-+-+-+-+-+
z09   . .|p p p p K p Z p p p p p C c P p|. .
         +                               +
z10   . .|p p p p p p p p p p p p C p P p|. .
         +                               +
z11   . .|p p p p p p p p p E p p p p p pW. .
         +                               +
z12   . .|p p p p p p p p p p p p p p p p|. .
         +                               +
z13   . .|V p r r O p p p p p p p p p p p|. .
         +                               +
z14   . .|p p r r O p p p p p p p p p p FW. .
         +                               +
z15   . .|p p p p p p p p p p h h p p p G|. .
         +                               +
z16   . .|p p p p p p p p p p T T p p p N|. .
         +                               +
z17   . .|p p p p p p p p p p h h p p p SW. .
         +                               +
z18   . .|p p p p p p p p p p p p p p p R|. .
         +-+W+-+-+W+-+-+D+-+-+-+W+-+-+W+-+
z19   . . . . . . . . . : : . . . . . . . . .
z20   . . . . . . . . . : : . . . . . . . . .
z21   . . . . . . . . . : : . . . . . . . . .
z22   . . . . . . . . . : : X . . . . . . . .
z23   . . . . . . . . . : : . . . . . . . . .
z24   . . . . . . . . . : : . . . . . . . . .
z25   . . . . . . . . . : : . . . . . . . . .
z26   . . . . . . . . . : : . . . . . . . . .
z27   . . . . . . . . . : : . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . .
```
Codes as L1 §3.3, plus E = easel_morbid, Z = stereo_boombox, I = tub_icebath, T = table_wake.

**LOT_TEMPLATE_INFO additions:**
- `rotrow_walkup`: "Walk-Up 2A — small, central, cheap. The neighbours' walls are thin and they groan in their sleep."
  startingFunds 14,000.
- `rotrow_loft`: "Market Street Loft — exposed brick, big windows, room for art and parties." startingFunds 10,000.

**Balance:** scenarios A and B on both apartments (A-W, B-W, A-L, B-L). An apartment household is closer to venues,
because downtown travel is 15–18 min instead of 36–40.

## 4. New objects (L3)

Venue objects are not buyable unless a tier is given. Every buyable item has a `Paint` material.

| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `counter_pantry` | Pantry Counter | — | 3×1 | counter, pantry | serve (front), staff (back) | town_pantryMealBox, town_volunteer | Long wooden counter with stacked meal boxes ("BRAIN BANK — TAKE ONE, LEAVE A SMILE") | 1,800 |
| `shelf_pantry` | Pantry Shelving | — | 3×1 | shelf | f0–f2 | town_volunteer (restock part) | Metal shelving with cans, jars, a dented tin of "Brain Bran" | 2,200 |
| `bin_donation` | Donation Bin | — | 1×1 | donate | front | town_donateFunds | Big wooden bin with a slot, painted heart with stitches | 600 |
| `crate_supplies` | Supply Crate | — | 1×1 | crate | use | town_volunteer (stocking), dressing | Slatted crate stencilled "PERISHABLE (UNLIKE US)" | 400 |
| `shelf_grocery` | Grocery Aisle | — | 3×1 | shelf, grocery | f0–f2 | town_buyGroceries, town_browseShelves | Double-sided shelf unit with produce crates, brain loaves, jerky; brand slot endcap (Brain Bran) | 2,800 |
| `counter_checkout` | Checkout Counter | — | 2×1 | counter | pay, staff | (part of buy flows) | Counter with an old brass till that dings | 1,500 |
| `counter_curio` | Curio Exchange Counter | — | 2×1 | counter, curio | trade, staff | town_sellCurios | Glass-top counter full of oddities, a loupe, scales | 1,900 |
| `stall_fish` | Fishmonger's Stall | — | 2×1 | stall, fish | buy, staff | town_buyFish, town_sellCurios (fish) | Ice bed with three fish of the day (species tints), chalkboard prices | 1,600 |
| `stall_flowers` | Flower Stall | — | 2×1 | stall | buy | town_buyBouquet | Buckets of black tulips, wilted roses, lilies | 1,700 |
| `display_showroom` | Furniture Showroom Corner | — | 3×2 | showroom | f0–f2 | town_browseShowroom | A tiny staged room: armchair, lamp, rug on a platform with a "DELIVERY TO ANY TOMB" sign | 3,500 |
| `fridge_rotpop` | Rot-Pop Drinks Fridge | **sponsor** `rot_pop_fridge` (home version free $350) | 1×1 | vending | front | town_buySoda, town_buyJerky | Glass-door drinks fridge, glowing logo (brand slot) | 1,200 |
| `treadmill_rattle` | Rattling Treadmill | bones 350 · $650 | 1×2 | exercise, fitness | run | town_treadmill | Old treadmill with duct-taped handrails and a sparking console (`screen`) | 1,800 |
| `bag_punching` | Punching Bag | free · $180 | 1×1 | exercise | hit (any side) | town_punchBag | Patched leather bag on a chain from a ceiling bracket stand | 900 |
| `mat_stretch` | Stretching Mat | free · $40 | 2×2 rug | exercise | stretch | town_stretch | Faded purple mat, rolled corner | 200 |
| `counter_reception` | Reception Desk | — | 2×1 | counter | desk, staff | town_buyMembership, town_personalTraining, town_jobInterview, town_makeover booking | Curved desk with a bell, sign-in ledger | 1,500 |
| `bench_locker` | Locker-Room Bench | free · $120 | 2×1 | seat | s0, s1 | home_sit | Wooden bench, lockers behind (dressing) | 700 |
| `pool_plunge` | Formaldehyde Plunge Pool | — | 3×2 | bath, preserve | p0, p1 (bath) | town_plunge | Tiled sunken pool, green-blue cold water (`water`, `frost`) | 2,600 |
| `shelf_library` | Library Stacks | — | 3×1 | shelf, book | f0–f2 | town_browseStacks (→ read), town_study | Tall dark bookcase, rolling ladder on one | 3,000 |
| `table_reading` | Reading Table | free · $300 | 3×1 | table | — (chairs around) | town_study (via chairs) | Long oak table with green banker's lamps (`bulb`) | 1,600 |
| `catalog_cards` | Card Catalogue | — | 1×1 | catalog | front | town_checkOutBook | Tall drawer cabinet with brass pulls | 800 |
| `counter_loan` | Loan Desk | — | 2×1 | counter | loan, staff | town_checkOutBook, town_storyTime (librarian) | Desk with date stamps, a "SHHH" sign | 1,400 |
| `bench_lab` | Lab Bench | — | 2×1 | lab | f0, f1 | town_useLab | Steel bench with bubbling flasks (emissive green), a brain in a jar (labelled "Gary") | 2,400 |
| `server_rack` | Server Rack | — | 1×1 | decor | — | — | Tall rack with blinking LEDs (`glow`) | 900 |
| `pod_nap` | Necro-Nap Pod | bones 400 · $1,400 | 1×2 | bed, nap | lie | town_napPod | Coffin-shaped sleek pod with a sliding lid (`door`), soft blue light | 2,200 |
| `booth_dj` | DJ Booth | bones 500 · $1,800 | 2×1 | music, dj | spin | town_djSpin, town_clubDance (radius 5) | Booth built from a stack of coffins, turntables, a skull mirror ball above (`glow`) | 2,800 |
| `bar_counter` | Tonic Bar | — | 4×1 | bar | f0–f3, staff | town_orderDrink | Polished bar with bottles of coloured tonics (no alcohol), stools as part of the mesh | 3,200 |
| `stage_small` | Open-Mic Stage | — | 3×2 | stage | perform | town_performStandUp | Low wooden stage, a microphone stand, a moth-eaten curtain | 2,200 |
| `booth_velvet` | Velvet Booth | — | 2×1 | seat | s0, s1 | home_sit (+ socials) | Curved crimson booth, button-tufted | 1,600 |
| `chair_salon` | Salon Chair | — | 1×1 | seat, salon | sit, stylist | town_makeover, town_nailRestore, town_stitchTouchUp | Chrome-and-leather barber chair with pump lever | 1,500 |
| `station_waxpreserve` | Wax & Preserve Table | — | 1×2 | spa, preserve | lie, work | town_waxPreserve | Padded spa table, warm wax pot (`glow`), towel stack | 1,800 |
| `dryer_hood` | Hood Dryer | free · $260 (decor/seat) | 1×1 | seat, salon | sit | town_dryerGossip | Retro bonnet hair dryer chair | 1,400 |

**Floor style:** `floor_dance_lit` (P-W4): checker tiles with an emissive pulse driven by the music beat.

**Totals:** 31 new objects + 1 floor style.

**Reused:** gym_limb, desk_hauntedpc (Necro-Tech sponsor skin), shower_drizzle, mirror_cracked, armchair_tattered,
shelf_moldering, sofa_moldy, table_rickety, table_urnstand, chair_creaky, stereo_boombox, espresso_embalmer,
plant_carnivorous, plant_deadfern, lamp_skull, trash_lidded, sink_rusty, door_crypt, window_gothic, plus every
residential object in the apartments and the shared `board_notice`.

## 5. New interactions (L3)

Venue rules:
- outside opening hours the venue interactions are unavailable ("Closed. Opens at 10:00."), and the lot sends
  visitors home at closing (README §3);
- **fees** are charged once per visit with an idempotency key `<lotId>:<agentId>:<day>:fee`:

| Fee | Price |
|---|---|
| Gym day pass | $5 |
| Gym membership | $60 per 7 days |
| Rigor Room cover, Fri/Sat after 22:00 | $10 |
| Everything else | free entry |

| id | Venue / target | Effects | Dur. | Requires | Autonomy ad | Anim | Moodlet |
|---|---|---|---|---|---|---|---|
| `town_pantryMealBox` | counter_pantry | a full meal: hunger +45 (quality 2), eaten at a table; or "Take Away" → `item_mealbox` (1 serving, spoils 48 h, can go in a fridge) | 10 queue + eat | 1 per zombie per day | hunger 45; **free-food gated** | `talk` then `sitEat` | `charityCase` −3 (4 h), unless volunteered in the last 7 days |
| `town_volunteer` | counter_pantry (staff) / crates | social +8/h, fun +4/h, energy −4/h, charisma xp 10/h; stat `volunteerHours` | 120 | 10–16, ≤ 1/day | social 6, fun 3, adBonus 3; cheerful +3, socialButterfly +3 | `talk` / `pickup` | `goodDeed` +8 (24 h) |
| `town_donateFunds` | bin_donation | cost $10; stat `donations` | 2 | funds ≥ 10 | adBonus 2 when funds > $2,000; cheerful +2 | `pickup` | `goodDeed` |
| `town_buyGroceries` | shelf_grocery | cost $40 → household `groceryCredit` +$44 (10 % bulk saving; home cooking charges spend credit first; max credit $200) | 5 | — | adBonus 4 when the fridge has no leftovers and funds ≥ $100 | `pickup` | — |
| `town_browseShelves` | shelf_grocery | fun +6/h | 15 | — | fun 2 | `admire` | — |
| `town_sellCurios` | counter_curio / stall_fish | sells every carried curio and fish at **110 %** instantly (Ezra friend ≥ 35: 115 %) | 3 | carrying ≥ 1 | adBonus 5 when carrying | `talk` | `luckyFind`-style `goodSale` +4 |
| `town_buyFish` | stall_fish | buys one of 3 fish-of-the-day (seeded, shown) at 1.5 × value | 3 | funds | not autonomous | `pickup` | — |
| `town_buyBouquet` | stall_flowers | cost $8 → carried `item_bouquet` | 2 | — | romantic targets nearby: adBonus 2 | `pickup` | — |
| `town_giveBouquet` | agent (social, Romantic/Friendly) | base 0.85; friendship +5/−1, romance +6/−2; consumes the bouquet | 5 | carrying a bouquet | hopelessRomantic +4 | `hug` | `flowersReceived` +6 to target |
| `town_browseShowroom` | display_showroom | opens the Buy catalogue in delivery mode: items arrive in the home lot inventory at **95 %** price, next 09:00 | 5 | — | not autonomous | `admire` | — |
| `town_treadmill` | treadmill_rattle | fitness xp 45/h, energy −10/h, hygiene −8/h, fun +2/h; `exercise` (preservation decay ×1.5, limb loss ×1.5 per GDD §4) | 45 | day pass / membership | fun 2, adBonus 3; ambitious +2, lazy −4 | `walk` (in place) | `pumpedUp` (exists) |
| `town_punchBag` | bag_punching | fitness xp 35/h, fun +10/h; exercise | 30 | pass | fun 6; hothead +6, grumpy +3 | proposed `punch` (fallback `angry`) | `ventedSteam` +6 (Hothead: also clears Furious) |
| `town_stretch` | mat_stretch | fitness xp 15/h, fun +6/h | 20 | — | fun 3; clumsy +3 | `stretch` | `limberedUp` +3: **limb-loss chance ×0.5 for 6 h** |
| `town_plunge` | pool_plunge | preservation +12, hygiene +40, fun +8 (bracing) | 20 | pass | preservation 12, hygiene 30; free-ish ($5 pass ≈ $0.42/pt) | `bath` | `coldSoak` (exists) |
| `town_personalTraining` | coach NPC | cost $25; fitness xp ×1.5 on the next workout (60 min) and **limb loss ×0 during it** (spotter) | 60 | coach on shift | not autonomous | as workout | `pumpedUp` |
| `town_buyMembership` | counter_reception (gym) | cost $60 → 7 days of free entry | 2 | — | not autonomous | `talk` | — |
| `town_browseStacks` | shelf_library | the shipped read (fun +11/h, logic xp 25/h, stops at fun 98; Bookworm fun ×2) | 60 | open hours | as home_read | `read` | — |
| `town_study` | table_reading (chair) | pick a subject: logic 30/h · mortuary 35/h · cooking 20/h · digging/fishing 25/h (P-W2 manuals); fun +2/h; stopWhen energy < 20 | 60 | open | adBonus 3 when a promotion needs the skill (career requirement unmet); ambitious +3, bookworm +4 | `sitRead` | `studious` +4 (Bookworm +8) |
| `town_checkOutBook` | catalog_cards / counter_loan | carry `item_libraryBook` (subject chosen) for 3 days; at home "Read Library Book" = town_study rates; late fee $2/day, auto-returned on the next library visit | 3 | ≤ 1 per zombie | not autonomous | `pickup` | — |
| `town_storyTime` | counter_loan (event) | fun +10/h, social +6/h; joinable | 60 | Sat 11:00–12:00 | fun 8, social 5 | `listen` | — |
| `town_networkCoworkers` | lobby (any coworker townie) | social +8; **job performance +3 (Necro-Tech careerists, once per day)**; other careers +1 | 20 | on the Necro-Tech lot | social 6, adBonus 3; ambitious +4 | `talk` | — |
| `town_useLab` | bench_lab | logic xp 30/h, fun +6/h | 60 | — | fun 4, adBonus 3; ambitious +2 | `cook` (stirring) | — |
| `town_napPod` | pod_nap | energy +15/h (×0.5 preservation decay like a coffin) | 30–60 | Necro-Tech careerists free, others $5 | energy 10 | `sleep` | `wellRested` (exists, if ≥ 60 min) |
| `town_jobInterview` | counter_reception (Necro-Tech) | joins the Necro-Tech track at L1 with performance +20; if W-027 exists, success needs Passing ≥ 40, else charisma ≥ 1 | 30 | no Necro-Tech job; weekdays | not autonomous | `sitTalk` | `nailedIt` +8 / `interviewJitters` −4 |
| `town_clubDance` | booth_dj (radius 5, dance-floor tiles) | the shipped dance numbers: fun +18/h (Party Animal ×1.5), energy −6/h, hygiene −4/h, fitness xp 20/h; social +4/h with ≥ 3 dancers; joinable | 45 | open | fun 26, adBonus 3 (as home_dance) | `dance` | `nightOnTheTown` +6 after 2 h on the lot |
| `town_djSpin` | booth_dj | creativity xp 30/h, fun +16/h; tips $5/h while ≥ 4 dancers | 60 | creativity ≥ 2, or the DJ NPC is on break (22:30–23:00) | fun 10; partyAnimal +3, artistic +3 | proposed `djScratch` (fallback `dance`) | — |
| `town_orderDrink` | bar_counter | menu: **Fizzy Embalming Tonic** $6 (fun +8, social +4) · **Grave Mist Spritz** $8 (preservation +4, max 1 per 2 h) · **Brain-Freeze Slushie** $5 (hunger +12, fun +4). All non-alcoholic | 5 | open | fun 6; paid food | `standEat` | — |
| `town_performStandUp` | stage_small | charisma xp 30/h; success `0.35 + 0.05·charisma` (+0.10 Cheerful): audience friendship +3 each, `killedIt` +10 / `bombed` −6 but fun +5 | 20 | Thursday open mic 21–23, or any night with ≥ 3 audience | not autonomous (player stage moment) | `talk` + `laugh` from the audience | — |
| `town_makeover` | chair_salon | cost $40; opens the appearance editor (hair, makeup, clothes; CAZ rules); Passing +10 for 3 days (W-027) | 60 | — | not autonomous | `sit` | `lookingGood` (exists) |
| `town_waxPreserve` | station_waxpreserve | cost $40: preservation **+25**, hygiene +50 (**$1.60/pt**, below the spray's $1.88) | 45 | ≤ 1 per day | preservation 25, hygiene 40; vain +6 | `beEmbalmed` | `spaDay` +8 (6 h) |
| `town_stitchTouchUp` | chair_salon | cost $25; neat stitches cosmetic; Passing +5 (W-027) | 20 | — | not autonomous | `sit` | `lookingGood` |
| `town_nailRestore` | chair_salon | cost $15; Passing +3 | 15 | — | vain +3 | `sit` | `lookingGood` |
| `town_dryerGossip` | dryer_hood | fun +8/h, social +6/h; 30 % reveals one trait of a random met townie | 30 | — | fun 4, social 4; socialButterfly +3 | `sitTalk` | — |

**Shared:** town_readBoard, town_buySoda, town_buyJerky (on `fridge_rotpop`).

**Reused:** home_workout (gym_limb), home_read, home_browseWeb / home_payBillsOnline / home_program (library and office
PCs), home_shower, home_admireDecay (gym mirror), home_sit, home_brewEspresso, all socials.

**Totals:** 33 new interactions (+ the `town_requestSong` event variant in §8).

**PROPOSED GDD CHANGE P-W15 — grocery credit.** `groceryCredit` (household integer $) is spent before funds on
cooking charges (GDD §5). The bulk saving is 10 %. It never expires. It is idempotent (charged at purchase, consumed by
the existing cook charge keys).

### New moodlets (L3)
| id | Label | Mood | Duration |
|---|---|---|---|
| `charityCase` | Charity Case | −3 | 240 min |
| `goodSale` | Good Sale | +4 | 180 min |
| `flowersReceived` | Flowers! | +6 | 480 min |
| `ventedSteam` | Vented Some Steam | +6 | 180 min |
| `limberedUp` | Limbered Up (limb loss ×0.5) | +3 | 360 min |
| `studious` | Studious (Bookworm +8) | +4 | 240 min |
| `nailedIt` | Nailed the Interview | +8 | 720 min |
| `interviewJitters` | Interview Jitters | −4 | 240 min |
| `nightOnTheTown` | Night on the Town | +6 | 360 min |
| `killedIt` | Killed It (Comedically) | +10 | 480 min |
| `bombed` | Bombed (Comedically) | −6 | 240 min |
| `spaDay` | Spa Day | +8 | 360 min |

`goodDeed` comes from L2.

**Totals:** 12 new moodlets.

## 6. Townies & NPCs
- **Downtown pool:** 16 townies, seeded from `(seed,'rotrow')`, with occupations flavoured to downtown: shop clerk,
  barista, courier, coder, student, busker, retiree. Cast bodies that fit: business, streamer, gamer, pizza, jogger,
  civilian, clown, cone, screamer, sneezer, thief (comic pickpocket flavour only; no stealing mechanic), tourist,
  nurse, granny, walker, hardhat. Wormwood townies also visit downtown at half weight.
- **Arrival weights** per venue (per hour; ≤ 8 simulated townies per lot):

| Venue | 06–09 | 09–12 | 12–15 | 15–18 | 18–21 | 21–24 | 00–03 |
|---|---|---|---|---|---|---|---|
| Pantry | — | 0.5 | 0.6 | 0.4 | — | — | — |
| Market | 0.2 | 0.5 | 0.7 | 0.7 | 0.5 | 0.1 | — |
| Gym | 0.6 | 0.3 | 0.4 | 0.6 | 0.7 | 0.3 | — |
| Library | — | 0.3 | 0.4 | 0.5 | 0.4 | — | — |
| Necro-Tech | 0.4 | 0.6 | 0.6 | 0.4 | 0.2 | — | — |
| Rigor Room | — | — | — | — | 0.3 | 0.8 (Fri/Sat 1.0) | 0.6 |
| Salon | — | 0.4 | 0.5 | 0.5 | 0.3 | — | — |

- **Venue NPCs** (role npc; fixed names; never more than 2 on a lot):

| NPC | Venue | Body | Shift | Note |
|---|---|---|---|---|
| Dot Marrow | Pantry | granny | 10–18 | hands out boxes; friendship ≥ 35 → `charityCase` never applies |
| Mr. Pallor | Market (curio) | business | 08–22 | appraises with a loupe; comments on each curio |
| Gus | Market (till) | cone | 08–22 | — |
| Coach Brawnstein | Gym | strongman | 08–20 | personal training |
| Miss Quietus | Library | nurse | 09–21 | **shushes** any groan or social at volume (comedic: −2 friendship, the target lowers its voice) |
| Byte | Necro-Tech | business | 08–20 weekdays | interviews |
| DJ Embalm-o | Rigor Room | mascot | 20–03 | break 22:30–23:00 |
| Velma Vex | Rigor Room | shield | 20–03 | bartender |
| Ferdinand Shears | Salon | ringmaster | 10–20 | — |

## 7. Quests

New stat keys: `volunteerHours`, `donations`, `curiosSoldMarket`, `workoutsAtGym`, `studyHours`, `booksReturned`,
`danceSessionsClub`, `standUpSets`, `makeovers`.

**Story chain "Downtown Debut"** (requires the level unlocked; total **610 Bones** + 2 cosmetics):

| id | Title | Steps | Bones | Requires |
|---|---|---|---|---|
| `story_rr_arrive` | Bright Lights, Dim Town | `visitLot rotrow` → read a Rot Row notice board | 40 | — |
| `story_rr_market` | Market Day | sell at the curio counter (`[town_sellCurios] 1`) → buy groceries (`[town_buyGroceries] 1`) | 60 | story_rr_arrive |
| `story_rr_gym` | No Pain, No Limbs Lost | work out twice at Grimm's (`interaction tags [exercise] 2, match {lotId:'rotrow:gym'}`) → take a plunge | 60 | story_rr_arrive |
| `story_rr_library` | Quiet, Please | study once (`[town_study] 1`) → check out a book | 60 | story_rr_arrive |
| `story_rr_pantry` | Neighbours Helping Neighbours | volunteer a shift (`[town_volunteer] 1`) | 80 + `cosmetic:apron_brainBank` | story_rr_arrive |
| `story_rr_salon` | Looking Alive | a makeover or a wax & preserve (`[town_makeover, town_waxPreserve] 1`) | 60 | story_rr_arrive |
| `story_rr_nightOut` | A Night at the Rigor Room | dance twice at the club (`[town_clubDance] 2`) → order a drink | 100 | story_rr_salon |
| `story_rr_regular` | Downtown Regular | make 2 new friends (`friends 2`) | 150 + `cosmetic:frame_neon`; **grants `bayou` early** (P-W1) | story_rr_market, story_rr_nightOut |

**Repeatables:**

| id | Title | Objective | Bones | Cooldown |
|---|---|---|---|---|
| `n_rr_lifter` | Regular Lifter | 3 gym workouts | 20 | 2 d |
| `n_rr_studyGroup` | Study Group | study twice | 20 | 2 d |
| `n_rr_volunteer` | Shift at the Bank | volunteer once | 30 | 3 d |
| `n_rr_dancer` | Floor Filler | dance twice at the club | 25 | 2 d |
| `n_rr_openMic` | Open Mic Night | perform a set | 40 | 7 d |
| `n_rr_trader` | Curio Trader | sell 3 curios/fish at the market | 30 | 3 d |
| `n_rr_bookReturn` | On Time for Once | return a book without a late fee | 15 | 3 d |
| `n_rr_spa` | Spa Day | wax & preserve once | 20 | 3 d |
| `n_rr_networker` | Networker | network at Necro-Tech twice | 30 | 4 d |

**Daily:**

| id | Task | Bones |
|---|---|---|
| `d_rr_visit` | visit downtown | 8 |
| `d_rr_workout` | gym workout | 8 |
| `d_rr_study` | study | 8 |
| `d_rr_dance` | dance at the club | 8 |
| `d_rr_volunteer` | volunteer | 12 |
| `d_rr_sell` | sell at the market | 8 |

## 8. Level events
| Event | When | What |
|---|---|---|
| **Thursday Open Mic** | Thu 21:00–23:00, Rigor Room | townie audience ×1.5; stand-up available |
| **Rigor Mortis Ball** | Fri/Sat 22:00–03:00 | cover $10; townie arrivals ×1.3; dance-floor social bonus +2/h; the DJ takes requests (`town_requestSong`, a variant of djSpin's social: fun +4) |
| **Story Time** | Sat 11:00–12:00, library | `town_storyTime` |
| **Necro-Tech Hackathon** | every 2nd Saturday 10:00–18:00, campus | home_program / town_useLab logic xp ×1.5. At 18:00 the top household contributor by logic xp earned on the lot (seeded tie-break) wins **$150 + job performance +10** (one award per world per hackathon, idempotent) |
| **Monday Food Drive** | Mon 10:00–18:00, pantry | donations count ×2 toward quests; `goodDeed` lasts 48 h |
| **Seasonal (W-034)** | winter | "Lights on Rot Row": string-light dressing; salon `town_makeover` gets festive outfits |
| **Seasonal (W-034)** | Halloween | "Costume Crawl": visit 4 venues in one night → `costumeCrawler` +10 and 60 Bones (`n_rr_crawl`, once a year) |
| **Seasonal (W-034)** | summer | "Sidewalk Sale": market groceries 20 % off (credit +$48 per $40) |

## 9. Music & ambience brief
- **`mus_rotrow`:** noir swing, ~92 BPM; a walking upright-bass patch, brushed snare, a muted-trumpet lead synth, and
  a clarinet answer phrase. Night version: slower, a solo piano bar.
- **`mus_rotrow_gym`:** live mood driven by percussion (kettlebell clanks as rhythm), 120 BPM.
- **`mus_rotrow_library`:** sparse celesta and harp, 60 BPM, very quiet. The music ducks under the shush.
- **`mus_rotrow_club`:** party mood, original electro-swing at 118 BPM with a chopped brass hook; a fill every
  16 bars; the beat drives the `floor_dance_lit` pulse.
- **`amb_rotrow`:** street murmur (low walla in Groanish), a tram bell once per game hour, neon buzz near signs,
  pigeons, distant hearse horns (`carpoolHonk` pitched); rain on awnings when W-034 rain is on.
- **`amb_rotrow_indoor`:** HVAC hum, footsteps on tile.
- **`amb_rotrow_quiet`:** clock tick, page turns.
- **`amb_rotrow_club`:** muffled crowd plus the bass bleeding through the walls when outside.
- **New SFX:** `tramBell`, `neonBuzz`, `tillDing`, `shush`, `bagThump`, `treadmillWhirr`, `crowdLaugh`, `crowdGroan`,
  `djScratch`, `hairDryer`.

## 10. Environment look (`env_rotrow`)
| Key | Day | Dusk | Night |
|---|---|---|---|
| Sky | smoggy amber-grey `#a39a8a` | `#8a6f78` | `#1b1626` |
| Fog | `#8a857a`, near 25 m / far 90 m | — | `#24202e` |
| Accents | — | — | neon magenta `#c25a8a`, teal `#55d6be`, candle `#ffb35a` (bloom) |

- **Ground:** wet cobble street `floor_cobble` look `#4a4a52` / `#3a3a42` (P-W4); brick sidewalks `#6e4a3e`;
  puddle reflections on High quality only.
- **Dressing:** `env_shopfront_a` (2-storey brick shop, awning, 4,500 tris), `env_shopfront_b` (narrow café,
  3,500), `env_brick_block` (4-storey apartment silhouette, 3,000), `env_tram_stop` (shelter with an `AdSurface`
  busStop slot, 1,800), `env_neon_sign` (instanced, emissive, 300). These are new `ENV_MODELS`.

## 11. Store tie-ins
- **Premium themed set "Neon Noir"** (1,600 GG; sum of parts 1,900 GG):

| Item | GG |
|---|---|
| `sign_neonCustom` (wall; player-chosen word from a curated list) | 300 |
| `booth_velvet` home version | 300 |
| `ball_mirrorSkull` (ceiling-hung light) | 250 |
| `jukebox_ghoul` (plays the club music at home: fun +10/h listen) | 400 |
| `lamp_bankerGreen` | 150 |
| `rug_checkerboard` | 150 |
| `stool_barChrome` | 150 |
| `poster_gigTattered` (wall) | 200 |

- **Bones unlocks:**

| Item | Bones |
|---|---|
| treadmill_rattle | 350 |
| pod_nap | 400 |
| booth_dj | 500 |

- **Sponsor placements** (house brands):

| Brand | Placement |
|---|---|
| Rot-Pop | drinks fridges in the market, gym and club |
| Brain Bran | cereal endcap brand slot on a grocery shelf |
| Necro-Tech | PC skins on the campus and library desks (existing `necro_tech_pc`) |
| Coffin Coffee | campus espresso |
| Crypt-Kicks | sneaker wall display in the gym (`display_cryptkicks`, dressing with a brand slot) |

  `AdSurface` slots: the tram-stop panel and one rooftop billboard (house brands only; never shown to under-15
  profiles with personalisation, and never personalised for anyone).

## 12. Acceptance criteria
1. All 9 templates build deterministically and pass the placement/reachability checks shown above. The apartments
   respect their reduced `buildable` in Build mode: nothing can be placed outside it.
2. Hours: every venue interaction is unavailable outside hours. The household is warned 30 min before closing and
   sent home at close. A lot open past midnight (Rigor Room 20–03) works across the day boundary.
3. Fees are charged exactly once per visit/day (reload, replay and travel round trips never double-charge).
   Membership covers 7 × 24 game hours.
4. The pantry gives one meal box per zombie per day, gated for autonomy. `charityCase` is suppressed after
   volunteering or with Dot at friendship ≥ 35.
5. Curio/fish sales at 110 % pay instantly with idempotency keys. Grocery credit is spent before funds and never goes
   negative.
6. Job interview: with W-027, Passing gates success; without it, charisma does. Joining Necro-Tech this way matches
   `phone_findJob` except for the +20 performance.
7. **Perf** (busiest view: Rigor Room on Friday, 8 household + 8 townies + 2 NPC dancing):
   - simulated agents ≤ 18;
   - objects ≤ 40;
   - draw calls ≈ 120 (objects) + 180 (agents) + 40 (dressing/neon) + 10 (post) ≈ **350 ≤ 650**;
   - snapshots ≤ 12 KB per venue and ≤ 50 KB per apartment.
8. Balance:
   - the sweep is unchanged;
   - the new scenarios (A/B on both apartments) pass;
   - scenario **F2** (broke household with the pantry and graveyard unlocked) passes the F targets with ≥ 1 meal box
     per zombie per day;
   - the gym's `limberedUp` and personal training reduce limb loss without driving the B-scenario limb count below
     the grim/normal/relaxed ordering.

## 13. Tests
| Test | Kind | Asserts |
|---|---|---|
| `templates.rotrow.test.ts` | unit | 9 templates: validity, reachability, counts, buildable rects |
| `venues.hours.test.ts` | unit, adversarial | hours across midnight, warning and eviction, interactions refused when closed (incl. forged commands) |
| `venues.fees.test.ts` | unit, adversarial | day pass, membership, cover: exactly once per key across save/load, replay and journal recovery |
| `pantry.test.ts` | unit | 1 box/zombie/day; take-away spoilage; charityCase rules; free-food gate |
| `market.test.ts` | unit | 110 % sales; fish-of-the-day purity; grocery credit spend order; showroom delivery at 09:00 at 95 % |
| `gym.test.ts` | unit | limberedUp limb-loss multiplier; training limb loss ×0; plunge numbers |
| `library.test.ts` | unit | study rates per subject; book loan, late fees, auto-return |
| `club.test.ts` | unit | dance rates match home_dance; stand-up success formula; tips; non-alcoholic menu ids only |
| `salon.test.ts` | unit | makeover opens the appearance editor with CAZ rules; wax & preserve $1.60/pt cap (≤ spray $/pt) |
| `necrotech.test.ts` | unit | networking once/day; interview gating; hackathon single award |
| `travel.rotrow.test.ts` | integration | home → market → gym → home equals reference; save/load mid-route; catch-up |
| balance A-W/B-W/A-L/B-L/F2 | balance | targets above |
| `rotrow.spec` | e2e | map tab, venue screenshots day/night, Friday club draw calls logged |

## 14. Open questions
1. Weekly schedules: venues are open daily because `LotDef.hours` has no weekday field. Should a `days?: number[]`
   field be added (library closed Mondays, office weekdays only)? The office lobby currently opens daily.
2. Grocery credit (P-W15) touches the cooking charge path in `home/food`. Acceptable, or should the market only sell
   ready meals?
3. The DJ booth and the nap pod as Bones items at home: their numbers are copied from the venue versions. Is that
   OK for home balance (the nap pod is effectively a bed)?

## 15. References
- Downtown anchors and the evening economy: https://ced.sog.unc.edu/key-elements-of-successful-downtowns/ ·
  https://www.sog.unc.edu/blogs/community-and-economic-development-ced/student-corner-key-elements-successful-downtowns
- Evening hours and coordinated business hours raising downtown activity:
  https://www.canr.msu.edu/news/parking_meters_and_evening_hours_can_increase_downtown_retail_shopping ·
  https://public.websites.umich.edu/~econdev/royaloak/index.html
- Typical small-downtown remaining mix (restaurants, salons, taverns) and creative building reuse:
  https://economicdevelopment.extension.wisc.edu/articles/creative-uses-for-downtown-buildings-in-small-towns/
