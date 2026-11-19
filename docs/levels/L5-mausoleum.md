# L5 — Mausoleum Hills (upscale neighbourhood)

Level id `mausoleum` · unlock: **reputation ≥ 50 (P-W9), or household funds first reaching $60,000** (the funds
path is a P-W1 trigger) · build order 4th (W-018). This level brings wealth goals: three mansion templates, a
high-end catalogue, the **Old Money (Very Old)** aspiration (P-W10), **galas**, and three prestige venues (museum,
country club, funeral parlour). Shared conventions are in [README.md](README.md).

## 1. Fantasy & tone
Up the hill, behind wrought-iron gates, the town's oldest families have been dead the longest and are proud of it.
The mansions here:
- **Mansard Manor** is Second Empire, with a mansard roof, dormers, iron cresting and a tower (References);
- **Ravenspire Hall** is a cruciform gothic pile with its own chapel;
- **the Glass Mausoleum** is a cool modernist crypt-house with reflecting pools.

The **Hilltop Museum** wants your grave goods. The **Country Crypt Club** wants your membership fee and, if Look Alive
(W-027) exists, for you to *pass* as living. The **Fancy Funeral Parlour** hosts the best wakes in town. The comedy
is snobbery in decline: everybody is very posh and slightly mouldy.

## 2. Neighbourhood map
`LevelDef`: `{ id:'mausoleum', name:'Mausoleum Hills', blurb:'Old money, older residents.', environment:'env_mausoleum',
townies: 12, unlock:{kind:'reputation', value:50}, content:['mausoleum','highEnd','gala','oldMoney'] }`.
12 old-money townies, seeded from `(seed,'mausoleum')`.

| id | kind | name | templateId | w×d | buildable | map | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `mausoleum:museum` | community | Hilltop Museum | `mausoleum_museum` | 30×30 | default | 680,150 | `museum` | 09–19 (first Friday to 23) | — | level | `amb_mausoleum_hall` / `mus_mausoleum` |
| `mausoleum:crypt_club` | community | Country Crypt Club | `mausoleum_club` | 30×30 | default | 720,130 | `park` (club grounds) | 08–23 | — | level + membership | `amb_mausoleum` / `mus_mausoleum_club` |
| `mausoleum:funeral_parlor` | community | Lacquer & Sons Fancy Funeral Parlour | `mausoleum_parlor` | 30×30 | default | 640,170 | `clinic` (closest kind; PROPOSED: add `parlor` to `VenueKind`) | 09–21 | — | level | `amb_mausoleum_hall` / `mus_mausoleum_parlor` |
| `mausoleum:mansard_manor` | residential | Mansard Manor | `mausoleum_mansard` | 30×30 | default | 610,120 | — | — | 68,000 | level | `amb_mausoleum` / `mus_mausoleum` |
| `mausoleum:ravenspire` | residential | Ravenspire Hall | `mausoleum_ravenspire` | 30×30 | default | 660,110 | — | — | 82,000 | level | `amb_mausoleum` / `mus_mausoleum` |
| `mausoleum:glass_mausoleum` | residential | The Glass Mausoleum | `mausoleum_glass` | 30×30 | default | 750,180 | — | — | 95,000 | level | `amb_mausoleum` / `mus_mausoleum` |

- Mansions are **move-in only**, not New Game options. They need the "Move Household" flow (open question, L1 §14).
- Bills follow GDD §6. At a lot value of ~$80k a bill is ≈ **$470** (3 zombies), twice a week. That is the intended
  wealth sink: a mansion needs L4–L5 wages.
- Travel from Mildew Lane is capped at 45 min; within the hills 15–20 min.

```
Hills tab
   (610,120) Mansard Manor   (660,110) Ravenspire Hall      (720,130) Country Crypt Club
               (640,170) Funeral Parlour     (680,150) Hilltop Museum       (750,180) Glass Mausoleum
   ── Gloam Drive (gated, winding) ──────────────────────────────────────────────────
```

## 3. Lots (all validated: 0 placement errors, every slot reachable)

### 3.1 Mansard Manor (`mausoleum_mansard`) — 72 objects
Ten rooms on a symmetrical plan (a Second Empire hallmark):
- front row: parlour · foyer · dining;
- middle row: library · gallery hall with billiards · kitchen;
- back row: master suite · bath · second bedroom · conservatory with telescope.

Reflecting pools flank the front walk. The mansard roof, dormers and cresting are a render-side roof kit
(`roof_mansard`, §5).
```
      3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6   (x; tens: 000000011111111112222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . .
           +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+W+-+-+
z04   . . .|Z c C b b W|I I H|C b C b|f : : : f|. . .
           +           +     +       +         +
z05   . . .|Z b C b b b|t t t|C b C b|: : : E :|. . .
           +           +     +       +         +
z06   . . .Wb b b b b b|t t t|b b b b|: : : : :W. . .
           +           +     +       +         +
z07   . . .|b b b b b b|t t M|b b b b|: : : : :|. . .
           +           +     +       +         +
z08   . . .|b b b b b b|t t t|b b b b|: : : : :|. . .
           +-+-+D+-+-+-+-+D+-+-+D+-+-+-+-+D+-+-+
z09   . . .|K K l K K l|f f f f f f|k n k k k R|. . .
           +           +           +           +
z10   . . .|l l l l l l|f f f f f f|k k k k k N|. . .
           +           +           +           +
z11   . . .Wl l l l l lDf f Y Y Y fDk k k k k n|. . .
           +           +           +           +
z12   . . .|l A l l l l|f f Y Y Y f|k k k k k s|. . .
           +           +           +           +
z13   . . .|L l l l l l|f f f f f f|k r k k k k|. . .
           +-+-+-+-+-+-+-+-+-+D+-+-+-+-+-+-+-+-+
z14   . . .|d G G G F F|S f f f f S|d d d d d d|. . .
           +           +           +           +
z15   . . .|d d d d d d|f f f f f f|d h h h h d|. . .
           +           +           +           +
z16   . . .Wd u u u d d|f f f f f f|d T T T T dW. . .
           +           +           +           +
z17   . . .|d u u u d dDf u u u f fDd T T T T d|. . .
           +           +           +           +
z18   . . .|d d d d d d|f u u u f f|d h h h h d|. . .
           +           +           +           +
z19   . . .Wd O O O d A|f f f f f f|d d d d d QW. . .
           +           +           +           +
z20   . . .|d d d d d d|c f f f f c|d d d d d d|. . .
           +-+-+W+-+W+-+-+-+D+D+-+-+-+-+W+-+W+-+
z21   . . . . . . . . . . . : : . . . . . . . . . . .
z22   . . . . . . . . . . . : : . . . . . . . . . . .
z23   . ~ ~ ~ ~ . . . . . . : : . . . . ~ ~ ~ ~ . . .
z24   . ~ ~ ~ ~ . . . . . . : : . . . . ~ ~ ~ ~ . . .
z25   . . . . . . . . . . J : : . J . . . . . . . . .
z26   . . . . . . . . . . . : : X . . . . . . . . . .
z27   . . . . . . . . . . . : : . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| G | organ_pipe | F | fireplace_grand | O | sofa_velvet |
| u | rug_funeral | S | statue_marble | T | table_banquet (8 chairs h = chair_ribcage) |
| Q | gramophone_brass | K | bookshelf_grand | Y | table_billiards |
| R | fridge_cryo | N | stove_necrochef | n | counter_slab |
| Z | sarcophagus_cryo | C | coffin_chillrest | W | armoire_gilded |
| I | tub_icebath | E | telescope_brass | ~ | pool_reflecting |

Floor letters:

| Code | Floor | Code | Floor | Code | Floor |
|---|---|---|---|---|---|
| `d` | parquet (parlour, dining) | `f` | black marble (foyer, hall) | `l` | library carpet |
| `k` | kitchen checker | `b` | bedroom carpet | `t` | bath tile |
| `:` | conservatory flagstone / path | | | | |

### 3.2 Ravenspire Hall (`mausoleum_ravenspire`) — 57 objects
A cruciform gothic plan:
- a **great hall** (banquet table for 8, fireplace, statues);
- a west wing (Séance TV, velvet sofa, bookshelf);
- an east wing kitchen with a breakfast table;
- a north **chapel** (organ, pews) between two stone crypt-bedrooms (sarcophagus + Chill-Rests).

Two garden statues stand by the gate.
```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7   (x; tens: 00000000111111111122222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . . . .
z04   . . . . . . . . . . . . . . . . . . . . . . . . . .
                         +-+-+-+W+-+-+
z05   . . . . . . . . . .|c G G G c c|. . . . . . . . . .
             +-+-+W+-+-+-+           +-+-+-+-+W+-+
z06   . . . .|Z b C M b W|c c c c c c|C b P b b H|. . . .
             +           +           +           +
z07   . . . .|Z b C b b b|c c c c c c|C b P b b b|. . . .
             +           +           +           +
z08   . . . .|b b b b b b|c c c c c c|b b b b b b|. . . .
             +           +           +           +
z09   . . . .|b b b b b b|E E c c E E|b b b b b b|. . . .
             +           +           +           +
z10   . . . .|I I b b b b|c c c c c c|b b b b b e|. . . .
             +           +           +           +
z11   . . . .|b b b b b b|c c c c c c|b b b b b b|. . . .
       +-+-+-+-+-+-+-+D+-+-+-+-+D+-+-+-+-+D+-+-+-+-+-+-+
z12   .|Q V V w K K|: : : : : : : : : : : :|k k k k k R|.
       +           +                       +           +
z13   .|w w w w w w|F : : : : : : : : : : S|k k h h k N|.
       +           +                       +           +
z14   .|w w w w w w|F : : : h h h h : : : :|k k t t k n|.
       +           +                       +           +
z15   .Ww w w w w wD: : : : T T T T : : : :Dk k k k k sW.
       +           +                       +           +
z16   .|w O O O w w|: : : : T T T T : : : :|k k k k k k|.
       +           +                       +           +
z17   .|w w w w w w|: : : : h h h h : : : :|k r k k k k|.
       +-+-+-+-+-+-+                       +-+-+-+-+-+-+
z18   . . . . . . .|: : : : : : : : : : : :|. . . . . . .
                   +                       +
z19   . . . . . . .|: c : : : : : : : : : c|. . . . . . .
                   +-+-+W+-+-+-+D+-+-+-+W+-+
z20   . . . . . . . . . . . . : : . . . . . . . . . . . .
z21   . . . . . . . . . . . . : : . . . . . . . . . . . .
z22   . . y . . . . . . . . . : : . . . . . . . . . y . .
z23   . . . . . . S . . . . . : : . . . . . . S . . . . .
z24   . . . . . . . . . . . J : : . . . . . . . . . . . .
z25   . . . . . . . . . . . . : : . . . . . . . . . . . .
z26   . . . . . . . . . . . . : : X . . . . . . . . . . .
z27   . . . . . . . . . . . . : : . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Codes as §3.1, plus V = tv_seance (exists), E = pew_salvaged, e = telescope_brass, P = coffin_pine, y = tree_gnarled.

### 3.3 The Glass Mausoleum (`mausoleum_glass`) — 47 objects
A long, low modernist house with a wall of windows: an open living room with a sunken fireplace and billiards, a
kitchen-diner, a two-sarcophagus suite, a **spa** (ice bath + embalming station) and a study. Two reflecting pools
sit out front.
```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7   (x; tens: 00000000111111111122222222)
z04   . . . . . . . . . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . . . . . . . . . .
z06   . . . . . . . . . . . . . . . . . . . . . . . . . .
           +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z07   . . .|Z b Z b b b b W|I I M t t H|D s K K s s|. . .
           +               +           +           +
z08   . . .|Z b Z b b b b b|t t t t t t|D s s s s s|. . .
           +               +           +           +
z09   . . .Wb b b b b b b b|t t t t t t|s s s s s sW. . .
           +               +           +           +
z10   . . .|b b b b b b b b|t t t B B t|s s s s s s|. . .
           +               +           +           +
z11   . . .Wb b b b b b b b|t t t t t t|s s s s s eW. . .
           +               +           +           +
z12   . . .|b b b b b b b b|t t t t t t|s s s s s s|. . .
           +-+-+-+-+D+-+-+-+-+-+-+D+-+-+-+-+-+D+-+-+
z13   . . .|m m m m m m m m m m m m m Q|r t t t t R|. . .
           +                           +           +
z14   . . .|m m O O O m m m m m m m m m|t t t t t N|. . .
           +                           +           +
z15   . . .|m m m m m m m m m Y Y Y m m|t t t t t n|. . .
           +                           +           +
z16   . . .|F m u u m m m m m Y Y Y m m|t t t t t s|. . .
           +                           +           +
z17   . . .|F m m m m m m m m m m m m mDt h h h h t|. . .
           +                           +           +
z18   . . .|m m O O O m m m m m m m m m|t T T T T t|. . .
           +                           +           +
z19   . . .|m m m m m m m m m m m m m m|t T T T T t|. . .
           +                           +           +
z20   . . .|m m m m m m m m S m m m m m|t t t t t t|. . .
           +-+W+-+W+-+-+-+D+-+-+W+-+W+-+-+-+W+-+W+-+
z21   . . . . . . . . . : : . . . . . . . . . . . . . . .
z22   . . . . . . . . . : : . . . . . . . . . . . . . . .
z23   . y . . . . . . . : : . . ~ ~ ~ ~ . ~ ~ ~ ~ . . . .
z24   . . . . . . . . . : : . . ~ ~ ~ ~ . ~ ~ ~ ~ . . . .
z25   . . . . . . . . J : : . . . . . . . . . . . . . . .
z26   . . . . . . . . . : : X . . . . . . . . . . . . . .
z27   . . . . . . . . . : : . . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Codes as §3.1, plus B = station_embalming, D = desk_hauntedpc, u = table_coffinlid.

**Balance rule:** every mansion has ≥ 2 refrigerated sleepers and ≥ 3 fun sources. **Scenario B-M** (B on a mansion
with an L4 Mortuary wage, 3 zombies) targets funds flat or rising. **Scenario B-M1** (L1 wage) is expected to fall,
and its test asserts that, so the wealth sink is real.

### 3.4 Hilltop Museum (`mausoleum_museum`) — 34 objects
A rotunda with the town's famous skeleton display ("The Gloam Mammoth", a stitched-together prehistoric
mostly-elephant), a ticket and donation desk, three galleries with **curio cases** (they fill with the household's
donations) and painting frames (they show lent paintings).
```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7   (x; tens: 00000000111111111122222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . . . .
                     +-+-+-+-+-+-+-+-+-+-+
z04   . . . . . . . .|g S g C C g C C S g|. . . . . . . .
                     +                   +
z05   . . . . . . . .|g g g g g g g g g g|. . . . . . . .
                     +                   +
z06   . . . . . . . .|g g g g g g g g g g|. . . . . . . .
                     +                   +
z07   . . . . . . . .|g g g g g g g g g g|. . . . . . . .
       +-+-+-+-+-+-+-+                   +-+-+-+-+-+-+-+
z08   .|g g g g g g g|g g g g e g g g g g|g g g g g g g|.
       +             +                   +             +
z09   .|C g g g g g g|g g g g g g g g g g|g g g g g g C|.
       +             +                   +             +
z10   .|C g g g g P g|g g g g g g g g g g|g P g g g g C|.
       +             +                   +             +
z11   .|g g g g g g g|g g g g g g g g g g|g g g g g g g|.
       +             +-+-+-+-+-+D+-+-+-+-+             +
z12   .|C g g g g g g|m m m m m m m m m m|g g g g g g C|.
       +             +                   +             +
z13   .|C g g g g g g|m m m m m m m m m m|g g g g g g C|.
       +             +                   +             +
z14   .|g g g g g P g|m m m X X X X m m m|g P g g g g g|.
       +             +                   +             +
z15   .|C g g g g g g|m m m X X X X m m m|g g g g g g C|.
       +             +                   +             +
z16   .|C g g g g g gDm m m X X X X m m mDg g g g g g C|.
       +             +                   +             +
z17   .|g g g g g g g|m B m m m m m m m B|g g g g g g g|.
       +             +                   +             +
z18   .|C g g g g P g|m B m m m m m m m B|g P g g g g C|.
       +             +                   +             +
z19   .|C g g g g g g|m m m Q Q Q m m m m|g g g g g g C|.
       +             +                   +             +
z20   .|g g g g g g g|m m m m m m m m m m|g g g g g g g|.
       +-+-+-+-+-+-+-+-+-+W+-+D+D+-+-+W+-+-+-+-+-+-+-+-+
z21   . . . . . . . . . . . . : : . . . . . . . . . . . .
z22   . . . . . . . . . . . . : : . . . . . . . . . . . .
z23   . . . . . . . . . . . . : : . . . . . . . . . . . .
z24   . . y . . . . . . . . . : : . n . . . . . . . y . .
z25   . . . . . . . . . . . J : : . . . . . . . . . . . .
z26   . . . . . . . . . . . . : : . . . . . . . . . . . .
z27   . . . . . . . . . . . . : : . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| X | skeleton_display (4×3) | Q | counter_museum | C | case_curio (2×1, 4 curio surfaces) |
| P | wall_painting_frame (floor-standing gallery frame) | S | statue_marble | e | telescope_brass (observatory corner) |

- **NPCs:** curator **Prof. Ignatius Bramblewick** (body `boss`), docent **Wren** (body `nurse`), 09–19.

### 3.5 Country Crypt Club (`mausoleum_club`) — 31 objects
A clubhouse (reception, lounge with billiards and fireplace, tea room), with an **8×6 croquet lawn** and a **6×5
putting green** out back, benches and pools.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z02   . . c c c c c c c c . . . . . . . . . . g g g g g g . . . .
z03   . . c c c c c c c c . . . . . . . . . . g g g g g g . . . .
z04   . . c c c c c c c c . . B B . . B B . . g g g g g g . . . .
z05   . . c c c c c c c c . . . . . . . . . . g g g g g g . . . .
z06   . . c c c c c c c c . . . . . . . . . . g g g g g g . . . .
z07   . . c c c c c c c c . . . . . . . . . . . . . . . . . . . .
z08   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . J . . . J . . . . . . . . . . . .
z10   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
                     +-+-+-+-+D+-+-+-+D+-+-+-+-+-+
z11   . . . . . . . .|t t t t t t t|l l l F F l l|. . . . . . . .
                     +             +             +
z12   . . . . . . . .|h T h h T h t|l l l l l l l|. . . . . . . .
                     +             +             +
z13   . . . . . . . .|t t t t t t t|l A l l l A l|. . . . . . . .
                     +             +             +
z14   . . . . . . . .|t t t t t t t|l l l l l l l|. . . . . . . .
                     +-+-+-+D+-+-+-+-+-+-+D+-+-+-+
z15   . . . . . . . .|S p p p p p p p p p p p p S|. . . . . . . .
                     +                           +
z16   . . . . . . . .|p p p p p p p p p Y Y Y p p|. . . . . . . .
                     +                           +
z17   . . . . . . . .|p p p p p p p p p Y Y Y p p|. . . . . . . .
                     +                           +
z18   . . . . . . . .|p p p p p p K K p p p p p p|. . . . . . . .
                     +                           +
z19   . . . . . . . .|p p p p p p p p p p p p p p|. . . . . . . .
                     +                           +
z20   . . . . . . . .|p O O O p p p p p p O O O p|. . . . . . . .
                     +                           +
z21   . . . . . . . .|p p p p p p p p p p p p p p|. . . . . . . .
                     +-+-+W+-+-+-+D+D+-+-+-+-+W+-+
z22   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z23   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z24   . . . ~ ~ ~ ~ . . . . . . . : : . . . . . . . ~ ~ ~ ~ . . .
z25   . . . ~ ~ ~ ~ . . . . . . . : : . . . . . . . ~ ~ ~ ~ . . .
z26   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Codes: `c` lawn_croquet (rug-layer lawn object), `g` green_putting, T table_tea (with chair_ribcage pairs),
K counter_reception, Y table_billiards.

- **NPCs:** steward **Hollingsworth** (body `business`), club pro **Biff Mallet** (body `jogger`).

### 3.6 Lacquer & Sons Fancy Funeral Parlour (`mausoleum_parlor`) — 34 objects
A crimson viewing hall with 12 pews, an organ and a viewing dais. Behind it are a professional **embalming suite**
(two stations + a stitching table), a florist room and the director's office. A parked hearse sits out front
(dressing).
```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7   (x; tens: 00000000111111111122222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . . . .
z04   . . . . . . . . . . . . . . . . . . . . . . . . . .
z05   . . . . . . . . . . . . . . . . . . . . . . . . . .
             +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z06   . . . .|k t t t t t t s|f f f f f|o o o D o|. . . .
             +               +         +         +
z07   . . . .|t B B t B B t t|f W W f f|o o o D o|. . . .
             +               +         +         +
z08   . . . .|t t t t t t t t|f f f f f|o o o o o|. . . .
             +               +         +         +
z09   . . . .|t t t t t t t t|f f f f f|o K K o o|. . . .
             +               +         +         +
z10   . . . .|t t t t t t t t|f f f f f|o o o o o|. . . .
             +               +         +         +
z11   . . . .|t t t t t t t t|f f f f f|o o o o o|. . . .
             +-+-+-+-+D+-+-+-+-+-+D+-+-+-+-+D+-+-+
z12   . . . .|v G G G v v v v v v v v v v v v v v|. . . .
             +                                   +
z13   . . . .|v v v v v v v c V V V c v v v v v v|. . . .
             +                                   +
z14   . . . .|v v v v v v v v V V V v v v v v v v|. . . .
             +                                   +
z15   . . . .|v v E E v E E v v v v v E E v E E v|. . . .
             +                                   +
z16   . . . .|v v v v v v v v v v v v v v v v v v|. . . .
             +                                   +
z17   . . . .|v v E E v E E v v v v v E E v E E v|. . . .
             +                                   +
z18   . . . .|v v v v v v v v v v v v v v v v v v|. . . .
             +                                   +
z19   . . . .|v v E E v E E v v v v v E E v E E v|. . . .
             +                                   +
z20   . . . .|v v v v v v v v v v v v v v v v v v|. . . .
             +-+-+-+W+-+-+-+-+D+D+-+-+-+-+W+-+-+-+
z21   . . . . . . . . . . . . : : . . . . . . . . . . . .
z22   . . . . . . . . . . . . : : . . . . . . . . . . . .
z23   . . . . . . . . . . . . : : . . . . H H H H H . . .
z24   . . . . . . . . . . . . : : . n . . H H H H H . . .
z25   . . . . . . . . . . . J : : . . . . . . . . . . . .
z26   . . . . . . . . . . . . : : . . . . . . . . . . . .
z27   . . . . . . . . . . . . : : . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Codes: E pew_salvaged, G organ_pipe, V dais_viewing, B station_embalming, s table_stitchnmend, W stall_flowers (L3),
K counter_reception, H `env_hearse` dressing.

- **NPCs:** director **Mrs. Cerise Lacquer** (body `bride`), organist **Mr. Dirge** (body `walker`).

## 4. Signature systems

### 4.1 Reputation (PROPOSED P-W9, GDD new §19)
A derived town stat (0–100), computed (never stored) from world state, so it is always consistent across
save/load:
```
rep = min(100,
      3 × (household↔townie friendships ≥ 35)
    + 8 × (Legendary Parties/Galas in the last 30 game days)
    + min(30, donated curio points: common 1, uncommon 2, rare 4)
    + 5 × (highest career level in the household)
    + 5 × (Country Crypt Club member) )
```

| Rep | Effect |
|---|---|
| ≥ 40 | Crypt Club entry without Passing |
| ≥ 50 | level unlock |
| ≥ 70 | "Museum Patron" title (cosmetic) |
| ≥ 85 | townie drop-in chance ×1.5 |

UI: a laurel meter on the household panel.

### 4.2 Museum donations & loans
- `hills_donateCurio` gives a carried curio to the museum. It appears in a case, persists in the museum snapshot,
  and adds reputation points (above). It pays **no $ and no Bones directly**: Bones come from the quests that count
  donations (MONETIZATION §2 — Bones only from quests/tasks/achievements).
- **Sets:** completing a donated set (all Graveyard Curios / Bayou Finds / Catacomb Relics) adds a "Hall of …" plaque.
  The quest `n_mh_hall` pays 120 Bones once per set.
- `hills_lendPainting` lends a household painting for 7 days: reputation +2 while shown. The painting comes back with
  +30 % sale value ("museum provenance").

### 4.3 Galas (party variant)
- `phone_throwGala` (new phone option) is allowed when the household lot value ≥ $40,000 **or** a hall is rented
  (`hills_rentHall`: parlour $400 / club ballroom $600 for 5 h).
- Up to **8 guests** (GDD §11 parties allow 6). A caterer is optional: $300 for a `platter_catered` with 12 servings,
  hunger 20, quality 5.
- **Score** = the shipped party score, plus:

| Condition | Bonus |
|---|---|
| every household member in formal dress (armoire) | +10 |
| catered | +10 |
| organ/gramophone music on | +5 |
| venue room env ≥ 6 | +5 |
| average guest Passing ≥ 60 (W-027) | +5 |

- **Result:** ≥ 75 → `legendaryGala` +15 (counts as 2 Legendary Parties for reputation); ≤ 30 → the existing
  `lamePartyMood`-style −10 ("Social Disgrace").

### 4.4 Old Money (Very Old) aspiration (PROPOSED P-W10, GDD §12)
Milestones award aspiration points (not Bones):

| Milestone | Points |
|---|---|
| own a home with lot value ≥ $60,000 | 300 |
| host a gala scoring ≥ 70 | 500 |
| donate 10 curios to the museum | 700 |
| household funds + lot value ≥ $150,000 | 1,200 |

### 4.5 Look Alive at the club (W-027)
Entry to the Crypt Club needs **membership** ($500 per 7 days, `hills_joinClub`) **and** either Passing ≥ 60 (if
W-027 has landed) or reputation ≥ 40.

A public slip on the club lot (limb drop, a groan bubble at a member) costs Passing −5 and plays a comedic "monocle
drop" reaction. Three slips in a day get a polite "Perhaps another day, sir/madam" eviction to the gate (no fee
refund). Without W-027, the slip rule is off.

## 5. New objects (L5)
| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `organ_pipe` | Pipe Organ of Lament | bones 900 · $6,500 | 3×1, indoor | music, instrument | play | hills_playOrgan | Carved gothic organ case with tin pipes (`speaker`), candle sconces | 5,800 |
| `fireplace_grand` | Grand Marble Fireplace | bones 500 · $3,200 | 2×1, indoor | warm, decor | warm | hills_warmFireplace | White-veined marble mantel, iron grate fire (`flame`), clock on top | 3,500 |
| `bookshelf_grand` | Grand Library Shelf | bones 450 · $2,400 | 2×1 | book | f0, f1 | home_read (+ logic 30/h instead of 25) | Floor-to-ceiling walnut shelves with a brass rail | 3,200 |
| `table_banquet` | Banquet Table for Eight | premium 600 GG · $3,800 | 4×2 | table, diningTable | — (chairs) + 6 surfaces | eating, gala platters | Long carved table, candelabra centrepiece in the mesh | 3,800 |
| `statue_marble` | Pensive Ancestor Statue | premium 300 GG · $2,000 | 1×1 | decor, statue | admire (any side) | home_admirePortrait-style `hills_admireStatue` (fun +12/h, 10 min) | Marble figure in a toga holding its own head thoughtfully | 2,800 |
| `gramophone_brass` | Brass Gramophone | bones 380 · $1,400 | 1×1 | music | front | home_listenMusic, home_dance (radius 4), party music | Horn gramophone (`speaker`), spinning record | 1,600 |
| `table_billiards` | Bone-Ivory Billiards Table | bones 700 · $4,500 | 3×2 | game | play (any side) | hills_playBilliards | Green-felt table with carved bone legs, skull-shaped balls (no real ivory: "bone-ivory" resin) | 3,600 |
| `armoire_gilded` | Gilded Armoire | bones 300 · $1,800 | 1×1 | wardrobe | front | hills_changeOutfit | Tall gilt wardrobe with a mirror door | 2,000 |
| `telescope_brass` | Brass Telescope | bones 350 · $1,600 | 1×1 | hobby | look | hills_stargaze | Tripod brass telescope, star chart pinned to it | 1,800 |
| `pool_reflecting` | Reflecting Pool | premium 450 GG · $5,000 | 4×2, outdoor | decor, water | look | hills_admirePool (fun +10/h) | Black stone basin, still mirror water (`water`), lily corner | 1,400 |
| `skeleton_display` | The Gloam Mammoth | — | 4×3 | exhibit | admire | hills_admireExhibit, hills_museumTour start | A huge stitched skeleton on an iron armature, brass plaque | 6,000 |
| `counter_museum` | Ticket & Donation Desk | — | 3×1 | counter | desk, staff | hills_donateCurio, hills_lendPainting, hills_museumTour | Mahogany desk, brochure rack, donation box | 1,800 |
| `case_curio` | Museum Display Case | — | 2×1 | exhibit, display | f0, f1 | hills_admireExhibit | Glass vitrine (`Glass`) with 4 curio surfaces, brass label | 1,400 |
| `wall_painting_frame` | Gallery Frame Stand | — | 1×1 | exhibit | admire | hills_admireExhibit | Heavy gilt frame on a stand; shows a lent painting (`canvas`) or a stock portrait | 900 |
| `lawn_croquet` | Croquet Lawn | — | 8×6 rug, passable | sport | play (edge) | hills_playCroquet | Striped lawn, hoops, a peg, mallets in a stand | 2,000 |
| `green_putting` | Putting Green | — | 6×5 rug, passable | sport | putt (edge) | hills_putt | Rolling green with a flag (`flag`) and three holes | 1,800 |
| `table_tea` | Tea Table | free · $380 | 1×1 | table | — | hills_highTea (with chairs) | Lace-cloth round table, a cake stand | 1,200 |
| `dais_viewing` | Viewing Dais | — | 3×2 | parlor | f0–f2 | hills_attendFuneral (event), grave_payRespects | Draped dais with flower sprays (no coffin contents visible: lid closed, E10+) | 2,400 |
| `platter_catered` | Catered Platter | item | 1×1 item | food | grab | home_haveServing (12 servings, q5, hunger 20) | Silver platter of tiny brain canapés | 600 |
| `roof_mansard` (render kit) | Mansard Roof Kit | — | per house | — | — | — | Mansard roof, dormers, iron cresting, tower cap (render-only roof for the Mansard template; feeds W-030's roof pieces) | 6,000 |

**Totals:** 19 new objects + 1 roof kit.

**Reused:** sofa_velvet, chair_ribcage, rug_funeral, fridge_cryo, stove_necrochef, counter_slab, sarcophagus_cryo,
coffin_chillrest, tub_icebath, station_embalming, table_stitchnmend, tv_seance, pew_salvaged, painting_greatgrand,
plant_carnivorous, desk_hauntedpc, table_coffinlid, lantern_post, tree_gnarled, bench_iron, stall_flowers (L3),
counter_reception (L3), shelf_curio (README), env_hearse.

## 6. New interactions (L5)
| id | Target | Effects | Dur. | Requires | Autonomy ad | Anim | Moodlet |
|---|---|---|---|---|---|---|---|
| `hills_playOrgan` | organ_pipe | creativity xp 35/h, fun +14/h (Artistic ×1.5); counts as party music | 45 | — | fun 10, adBonus 3; artistic +4 | `sitComputer` (proposed `playKeys`) | `dramaticChord` +5 |
| `hills_warmFireplace` | fireplace_grand | fun +6/h, social +4/h; joinable | 30 | — | fun 4, social 3 | `idle` | `cosyCampfire` |
| `hills_playBilliards` | table_billiards | logic xp 20/h, fun +18/h; joinable 2 (social +6/h) | 45 | — | fun 12, adBonus 3 | `exercise` (proposed `cue`) | — |
| `hills_changeOutfit` | armoire_gilded | toggles **formal dress** (gala bonus, Passing +5 while formal) | 3 | — | not autonomous | `pickup` | `dressedToKill` +5 |
| `hills_stargaze` | telescope_brass | night: fun +12/h, logic xp 20/h (full moon `moonGazer` +6); day: "Spy on the Neighbours" fun +10/h + 25 % gossip reveal | 30 | — | fun 8; nightOwl +3, bookworm +2 | `admire` | `moonGazer` |
| `hills_admireStatue` / `hills_admirePool` / `hills_admireExhibit` | statue / pool / exhibits | fun +12 / +10 / +12 per hour | 10 | — | fun 3 | `admire` | — |
| `hills_donateCurio` | counter_museum | curio → case; reputation points | 3 | carrying a curio | not autonomous | `talk` | `generousSoul` +6 |
| `hills_lendPainting` | counter_museum | lends a carried painting for 7 days | 3 | carrying an item_painting | not autonomous | `talk` | — |
| `hills_museumTour` | docent (event, joinable ≤ 6) | fun +12/h, logic xp 15/h, social +4/h | 45 | museum hours | fun 8, adBonus 3; bookworm +3 | `listen` | — |
| `hills_livingHistoryTour` | docent | as the tour + reputation +3 once per week; **requires Rot Stage Legendary (W-033)**, otherwise hidden | 45 | — | — | `talk` | `livingHistory` +8 |
| `hills_joinClub` | counter_reception (club) | $500 → 7 days of membership | 3 | §4.5 gate | not autonomous | `talk` | — |
| `hills_playCroquet` | lawn_croquet | fitness xp 15/h, fun +16/h, social +4/h; joinable 4 | 45 | member | fun 10, adBonus 3 | proposed `swingMallet` (fallback `exercise`) | — |
| `hills_putt` | green_putting | fitness xp 10/h, fun +14/h | 30 | member | fun 8 | fallback `exercise` | — |
| `hills_highTea` | table_tea (chair) | cost $12; hunger +25, fun +8, social +6 | 30 | member | hunger 25, social 6 | `sitEat` | `veryProper` +4 |
| `hills_schmooze` | any club member townie (social, Friendly) | friendship +6/−3; **job performance +3 (Politics careerists, once/day)**, +1 other careers | 15 | member | social 8; ambitious +4, socialButterfly +3 | `sitTalk`/`talk` | — |
| `hills_rentHall` | counter_reception (parlour/club) | $400 / $600 → 5 h venue booking for a gala at a chosen time (next 7 days) | 5 | — | not autonomous | `talk` | — |
| `phone_throwGala` | phone | §4.3 | — | lot value ≥ $40k or a booking | not autonomous | `phone` | `legendaryGala` +15 / `socialDisgrace` −10 |
| `hills_premiumEmbalming` | station_embalming (parlour, NPC-performed) | cost $120; preservation **+70**, vitality +2 (once per 7 days) — $1.71/pt | 60 | parlour hours | preservation 70 (only below 40); vain +4 | `beEmbalmed` | `pleasantlyPickled` (exists) |
| `hills_consultMortician` | parlour stations (with the director) | mortuary xp 40/h; **Mortuary careerists performance +3 (once/day)** | 60 | — | adBonus 3 when a mortuary promotion needs skill | `embalm` | — |
| `hills_attendFuneral` | dais_viewing (event) | social +8/h, `touchingService` +4; townie friendships +2 each attendee | 30 | Wednesday service (§9) | social 6; squeamish −3 | `mourn` | `touchingService` |
| `hills_arrangeFlowers` | stall_flowers (florist room) | creativity xp 20/h, fun +8/h; makes a free `item_bouquet` | 30 | — | fun 4; artistic +3 | `stitch` | — |

**Totals:** 23 new interactions (the three admire variants count as 3; `phone_throwGala` included). Reused: home_read, home_listenMusic,
home_dance, home_admirePortrait, home_sit, eating, socials.

### New moodlets
| id | Label | Mood | Duration |
|---|---|---|---|
| `dramaticChord` | Dramatic Chord | +5 | 180 min |
| `dressedToKill` | Dressed to Kill | +5 | while formal |
| `moonGazer` | Moon Gazer | +6 | 240 min |
| `generousSoul` | Generous Soul | +6 | 720 min |
| `livingHistory` | Living History | +8 | 720 min |
| `veryProper` | Very Proper | +4 | 180 min |
| `legendaryGala` | Legendary Gala | +15 | 1,440 min |
| `socialDisgrace` | Social Disgrace | −10 | 720 min |
| `touchingService` | Touching Service | +4 | 240 min |
| `monocleDrop` | Caused a Scene (Passing slip) | −4 | 240 min |

**Totals:** 10 new moodlets.

## 7. Townies & NPCs
- **Old-money pool:** 12 townies. Bodies that fit: gold, business, bride, ringmaster, fortune, granny, boss, mascot
  (eccentric heir), tourist (visiting cousins). Occupation flavour: heir, collector, retired judge, opera patron.
- **Arrival weights:**

| Venue | 08–12 | 12–17 | 17–21 | 21–23 |
|---|---|---|---|---|
| Museum | 0.4 | 0.6 | 0.3 (first Friday 0.8) | (first Friday 0.6) |
| Club | 0.5 | 0.6 | 0.5 | 0.3 |
| Parlour | 0.2 | 0.3 (Wed 15:00 service 1.0) | 0.2 | — |

- **NPCs** (≤ 2 per lot):

| NPC | Venue | Body |
|---|---|---|
| Prof. Ignatius Bramblewick (curator) | museum | boss |
| Wren (docent) | museum | nurse |
| Hollingsworth (steward) | club | business |
| Biff Mallet (pro) | club | jogger |
| Mrs. Cerise Lacquer (director; performs premium embalming) | parlour | bride |
| Mr. Dirge (organist; plays at services) | parlour | walker |

## 8. Quests
New stat keys: `curiosDonated`, `paintingsLent`, `galasThrown`, `galaBestScore`, `croquetGames`, `servicesAttended`.
**PROPOSED P-W6c:** objective kind `lotValue {atLeast}` (read only).

**Story chain "Old Money (Very Old)"** (total **700 Bones** + 2 cosmetics):

| id | Title | Steps | Bones | Requires |
|---|---|---|---|---|
| `story_mh_arrive` | Up the Hill | `visitLot mausoleum` → admire an exhibit | 60 | — |
| `story_mh_donor` | Patron of the Arts | donate 3 curios (`stat curiosDonated 3`) | 80 | story_mh_arrive |
| `story_mh_member` | Members Only | join the Country Crypt Club (`[hills_joinClub] 1`) | 100 | story_mh_arrive |
| `story_mh_tee` | Mallets at Dawn | play croquet → take high tea | 60 | story_mh_member |
| `story_mh_sendoff` | A Proper Send-Off | attend a Wednesday service, or have a premium embalming | 80 | story_mh_arrive |
| `story_mh_move` | Room at the Top | own a home worth ≥ $60,000 (`lotValue 60000`) | 120 | story_mh_arrive |
| `story_mh_gala` | The Gloam Gala | throw a gala scoring ≥ 70 | 200 + `cosmetic:frame_gilded` + `cosmetic:title_patron` | story_mh_member |

**Repeatables:**

| id | Title | Objective | Bones | Cooldown |
|---|---|---|---|---|
| `n_mh_donor` | Curator's Wish List | donate 2 curios | 30 | 3 d |
| `n_mh_hall` | Hall of … | complete a donated set | 120 | once per set |
| `n_mh_croquet` | Lawn Season | 2 croquet games | 20 | 2 d |
| `n_mh_schmooze` | Schmoozer | schmooze 3 times | 25 | 2 d |
| `n_mh_organ` | Toccata and Rot | play the organ twice | 20 | 2 d |
| `n_mh_stars` | Starry, Starry Night | stargaze at night twice | 20 | 2 d |
| `n_mh_gala` | Season of Galas | throw a gala | 50 | 7 d |
| `n_mh_lend` | On Loan | lend a painting | 30 | 7 d |

**Daily:**

| id | Task | Bones |
|---|---|---|
| `d_mh_visit` | visit the hills | 8 |
| `d_mh_tea` | high tea | 8 |
| `d_mh_exhibit` | admire an exhibit | 6 |
| `d_mh_billiards` | play billiards | 8 |

## 9. Level events
| Event | When | What |
|---|---|---|
| **First Friday at the Museum** | first Friday of each game month, 19:00–23:00 | exhibits glow (emissive cases); townies ×2; `hills_museumTour` joinable ×2 size; the gramophone plays; `museumNight` +5 |
| **Sunday Croquet Tournament** | Sundays 10:00–13:00 at the club | entrants' scores = `fitness + charisma/2 + seeded roll`; the winner gets a `trophy_croquet` decor object (sim item, env +3, sellable $50), once per week per world |
| **Wednesday Service** | Wed 15:00–15:45 at the parlour | an NPC-led memorial for "the late Mr. Somebody" (seeded original names): organ music, townies attend; `hills_attendFuneral` |
| **Funeral Procession** | Wed 16:00 | a hearse procession drives the hills streets (render: 3 `env_hearse` + walking townies along the street), purely visual |
| **Midwinter Ball** (W-034 winter) | club ballroom | a gala hosted by the club; any member household may attend: party score bonus for formal dress |
| **Garden Party** (W-034 spring) | club lawn | croquet + tea at half price |
| **Haunted Heritage Week** (W-034 Halloween) | museum | the skeleton "comes alive" (animated FX), and tours give double logic xp |

## 10. Music & ambience
- **`mus_mausoleum`** (original): chamber strings (synth quartet), harpsichord, a 3/4 minuet at ~84 BPM; night: solo
  piano nocturne.
- **`mus_mausoleum_club`:** light jazz-waltz with brushes.
- **`mus_mausoleum_parlor`:** an original organ chorale, slow, in a major key: dignified, not sad.
- **Gala:** a party mood rendered as a Viennese-style waltz (original).
- **`amb_mausoleum`:** distant church bells (different pitch from L2), wind in poplars, fountain trickles, croquet
  "tock", a peacock-ish call (comedic).
- **`amb_mausoleum_hall`:** echoing footsteps on marble, hushed murmur.
- **New SFX:** `organChord`, `billiardClack`, `croquetTock`, `teaCupClink`, `gramophoneCrackle`, `monocleDrop`,
  `marbleFootstep`.

## 11. Environment look (`env_mausoleum`)
| Key | Day | Dusk | Night |
|---|---|---|---|
| Sky | clear blue-grey `#9fb0c0` (the clearest sky in the game) | gold `#d9b46a` → rose `#b98a8a` | indigo `#1a1a33` |
| Fog | light, far 120 m | — | — |
| Accents | — | — | lit mansion windows `#ffb35a`, gilt `#c9a24a` (subtle bloom) |

- **Ground:** manicured lawn `#7a9a5e` (P-W4 `grass_lawn`), white gravel drives `#cfc6b0`, marble `#e8e0c8`.
- **Dressing:** `env_mansion_a/b` neighbour mansions (≤ 6,000 tris), clipped `env_topiary` (instanced, 600), iron
  gates, poplar rows.

## 12. Store tie-ins
- **Premium themed set "Gilded Afterlife"** (1,800 GG; sum of parts 2,250 GG):

| Item | GG |
|---|---|
| table_banquet | 600 |
| statue_marble | 300 |
| pool_reflecting | 450 |
| `chandelier_candle` (standing chandelier, 1×1) | 300 |
| `rug_gilded` | 200 |
| `vase_urnGilded` | 150 |
| `portrait_largeOval` | 150 |
| `clock_grandfather` | 300 |

- **Mega bundle "Hilltop Estate"** (2,800 GG): the set + organ_pipe + table_billiards skins + the Mansard roof skin
  for Quick Build (W-030).
- **Bones unlocks:**

| Item | Bones |
|---|---|
| organ_pipe | 900 |
| table_billiards | 700 |
| fireplace_grand | 500 |
| bookshelf_grand | 450 |
| gramophone_brass | 380 |
| telescope_brass | 350 |
| armoire_gilded | 300 |

  These are the most expensive Bones items in the game, about 3.5 h of engaged play each at the 260/h budget.
- **Cast bodies:** the premium Goldie body (`gold`, 650 GG exists) is featured on the hills store page.
- **Sponsor placements:** a **Volt-Hearse** EV on the club driveway (sponsor skin on `env_hearse` variant; W-031
  vehicles can sell the drivable version), Coffin Coffee at the museum café cart (dressing with a brand slot).
  `AdSurface` billboard: none on the hills ("the residents' association forbids it"). That is a deliberate tone
  choice.

## 13. Acceptance criteria
1. 6 templates validate (as above). Mansions are not offered at New Game. Move-in charges the price exactly once.
2. Reputation is a pure function of state. Its unlock fires once (P-W1). The UI meter matches the formula.
3. Club gating: membership expiry, Passing / reputation alternative, slip eviction (only with W-027).
4. Galas: booking idempotency, 8-guest cap, score bonuses, Legendary counts double for reputation.
5. Museum: donations persist in the museum snapshot across visits and saves. Cases display donated curios. Lent
   paintings return after 7 days with the +30 % value.
6. Premium embalming is limited to once per 7 days per zombie (vitality +2 is precious, GDD §4).
7. **Perf** (busiest view: a gala in Mansard Manor, 8 guests + 3 household + caterer platter):
   - agents ≤ 12;
   - objects ≤ 80;
   - draw calls ≈ 200 (objects) + 120 (agents) + 60 (roof kit + dressing) + 15 ≈ **395 ≤ 650**;
   - tris ≈ 320 k;
   - mansion snapshot ≤ 90 KB.
8. Balance: scenarios B-M (rises), B-M1 (falls), and the existing sweep unchanged.

## 14. Tests
| Test | Kind | Asserts |
|---|---|---|
| `templates.mausoleum.test.ts` | unit | validity, reachability, counts |
| `reputation.test.ts` | unit, adversarial | formula, caps, purity, save/load, the unlock trigger once |
| `club.test.ts` | unit | membership, gating, slips, eviction |
| `gala.test.ts` | unit, integration | booking, guests, score bonuses, moodlets |
| `museum.test.ts` | unit | donations persist, set completion grant once, painting loans |
| `parlor.test.ts` | unit | premium embalming cap, consult performance once per day, Wednesday service |
| `travel.mausoleum.test.ts` | integration | round trip, mansion move-in |
| balance B-M / B-M1 | balance | §13 |
| `mausoleum.spec` | e2e | screenshots incl. the Mansard roof kit, gala draw calls |

## 15. Open questions
1. `VenueKind` lacks `parlor`. Add it, or keep `clinic`?
2. Move Household flow (shared with L1/L3/L4): needed before the mansions are reachable as homes.
3. Reputation as a derived stat: OK with the lead (no new saved field)?
4. Should the club's Passing gate be hard (refuse entry) or soft (higher fees)? Hard here.

## 16. References
- Second Empire style: mansard roof with dormers, brackets, iron cresting, towers, symmetry:
  https://www.phmc.state.pa.us/Portal/Communities/Architecture/styles/second-empire.html ·
  https://en.wikipedia.org/wiki/Second_Empire_architecture_in_the_United_States_and_Canada ·
  https://dahp.wa.gov/node/35
