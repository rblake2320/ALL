# L4 — Swampside Bayou (neighbourhood)

Level id `bayou` · unlock: **household funds ≥ $15,000, or finishing `story_rr_regular`** (P-W1) · build order 3rd
(W-017). This is the first level with **water terrain** (P-W3), **raised (stilt) houses**, the **Swamp Guide**
career (P-W8), crawdad traps, swamp foraging and pirogue tours. Shared conventions are in [README.md](README.md).

## 1. Fantasy & tone
At the edge of town, the road turns to boardwalk and the boardwalk turns to water. Swampside Bayou is cypress knees,
Spanish moss, frogs the size of hats, and houses up on piers. The piers keep the floorboards above the high water,
let the breeze through and keep the mosquitoes guessing. That is exactly why real raised houses in South Louisiana
were built that way (References).

Life is slower and wetter here:
- a rocking chair on the front gallery, a crawdad trap off the back dock;
- a pirogue for getting anywhere that matters;
- the Swamp Diner for gossip;
- Old Toothless, the town's oldest (and toothless) undead alligator, for company.

The tone is warm and neighbourly. Names and food are original and nod to the region without caricature: no dialect
spelling in UI text, no real festival names, no real brands.

## 2. Neighbourhood map

`LevelDef`: `{ id:'bayou', name:'Swampside Bayou', blurb:'Stilts, moss, crawdads and a gator with no teeth.',
environment:'env_bayou', townies: 14, unlock:{kind:'funds', value:15000}, content:['bayou','fishing','forage','swampGuide'] }`.
14 bayou townies, seeded from `(seed,'bayou')`.

| id | kind | name | templateId | w×d | buildable | map | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `bayou:bait_tackle` | community | Bayou Bait & Tackle | `bayou_bait` | 30×30 | default (water excluded) | 120,710 | `market` | 06–20 | — | level | `amb_bayou` / `mus_bayou` |
| `bayou:swamp_diner` | community | The Swamp Diner | `bayou_diner` | 30×30 | default | 160,740 | `diner` | 07–22 | — | level | `amb_bayou` / `mus_bayou_diner` |
| `bayou:gator_pond` | community | Gator Pond | `bayou_gator` | 30×30 | default (water excluded) | 200,780 | `pond` | always | — | level | `amb_bayou_night` (night) / `mus_bayou` |
| `bayou:shotgun` | residential | Shotgun Stilt Shack | `bayou_shotgun` | 30×30 | default | 90,760 | — | — | 13,000 | level | `amb_bayou` / `mus_bayou` |
| `bayou:acadian` | residential | Raised Acadian Cottage | `bayou_acadian` | 30×30 | default | 130,780 | — | — | 17,000 | level | `amb_bayou` / `mus_bayou` |
| `bayou:fishcamp` | residential | Fish Camp on the Bend | `bayou_fishcamp` | 30×30 | default | 220,720 | — | — | 15,000 | level | `amb_bayou` / `mus_bayou` |

- **New-game / move-in funds** ($26,000 rule): Shotgun $13,000 · Acadian $9,000 · Fish Camp $11,000.
- Travel from Mildew Lane is 30–37 min; within the bayou 15–20 min (boardwalk).
- Water tiles are not buildable and not walkable. Placement and pathing treat them as blocked (P-W3).

```
Bayou tab
                        (120,710) Bait & Tackle         (220,720) Fish Camp
   ~~~~~~~~ Mossback Bayou (fictional channel) ~~~~~~~~~~~~~~~~~~~~~~~~~~~
        (90,760) Shotgun Shack   (160,740) Swamp Diner
                 (130,780) Acadian Cottage        (200,780) Gator Pond
```

## 3. Lots
**Water note:** in the plans, `~` blocks are **water terrain** (P-W3). For validation they were stood in by
impassable placeholder objects. The real template writes `LotState.water` tiles instead, and **all objects and slots
were validated** with the real spatial code around them: 0 errors, everything reachable from both sidewalk entries.
`_` = boardwalk / gallery / dock (new floor style `floor_boardwalk`, P-W4; validated with another floor style).
Over-water boardwalk tiles are land tiles that the renderer draws with pilings and water underneath.

**Raised rooms (PROPOSED P-W16, render only).** A template may flag rooms and galleries `raised: 1.2` (metres). The
renderer lifts their floor, walls and objects by 1.2 m, draws pilings under them and steps at exterior doors and
gallery edges. The sim is unchanged: pathing, slots and rooms are 2D. Zombie root height follows the raised floor
(a render offset). Cutaway works as today.

### 3.1 Shotgun Stilt Shack (`bayou_shotgun`) — 41 objects, 0 errors
Three rooms in a line, front to back (front room → bedroom → kitchen), a bath lean-to, a front gallery with two
rocking chairs, and a back dock with a pirogue and a fishing post. Cheapest bayou lot. **Raised:** all rooms + the
gallery.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ Y ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z02   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ p _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z03   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ p _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z04   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ p _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z05   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z06   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z07   . . . . . w . . . . . . . _ _ _ . . . . . . . . . . . . . .
z08   . . . . . . . . . . . . . _ _ _ . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . _ _ _ . . . . . . . . . Z Z . . .
                           +-+-+D+-+-+
z10   . . . . . . . . . . .|f h f T f|. . . . . . . . . Z Z . . .
                           +         +
z11   . . . . . . . . . . .|F f f f S|. . . . . . . . . . . . . .
                           +         +
z12   . . . . b . . . . . .WG f f f NW. . . . . . . . . . . . . .
                           +         +
z13   . . . . . . . . . . .|f f f f R|. . . . . . . . . . . . . .
                           +-+-+D+-+-+-+W+-+
z14   . . . . . . . . . . .|C P b b c|t M H|. . . . . b . . . . .
                           +         +     +
z15   . . . . . . . . . . .|C P b b bDt t t|. . . . . . . . . . .
                           +         +     +
z16   . . . . . . . . . . .Wb b b b K|t t t|. . . . . . . . . . .
                           +         +-+-+-+
z17   . . . . . . . . . . .|b b b b b|. . . . . . . . . . . . . .
                           +-+-+D+-+-+
z18   . . . . . . . . . . .|V f f f L|. . . . . . . . . . . . . .
                           +         +
z19   . . . . . . . . . . .|f f f f f|. . . . . . . . . . . . . .
                           +         +
z20   . . . Z Z . . . . . .Wf f f f AW. . . . . . m . . . . . . .
                           +         +
z21   . . . Z Z . . . . . .|O O f f f|. . . . . . . . . . . . . .
                           +-+-+D+-+-+
z22   . . . . . . . . . . _ r _ _ _ r _ . . . . . . . . . . . . .
z23   . . . . . . . . . . _ _ _ _ _ _ _ . . . . . . . . . . . . .
z24   . . . . . . . . . . . . . : . . . . . . . . . . . . . . . .
z25   . . . . . . . . . . . . . : . . . . . . . . . . . . . . . .
z26   . . . . . . . . . . . . . : X . . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . : . . . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Codes as L1 §3.3, plus:

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| p | pirogue_dock | Y | post_fishing | r | chair_rocking |
| w | pot_crawdad | b | bush_bogberry | m | log_mushroom |
| Z | tree_cypress (2×2) | | | | |

### 3.2 Raised Acadian Cottage (`bayou_acadian`) — 53 objects
The classic: a parlour with a wood stove, a big kitchen with a table for four, three back rooms (two bedrooms + bath),
and a deep front gallery with rocking chairs, a porch swing and a moss hammock. The dock is on the back channel.
**Raised:** all rooms + the gallery.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ Y ~ ~ ~ ~ ~ ~ .
z02   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ p _ _ ~ ~ ~ ~ ~ ~ .
z03   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ p _ _ ~ ~ ~ ~ ~ ~ .
z04   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ p _ _ ~ ~ ~ ~ ~ ~ .
z05   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ ~ ~ ~ ~ ~ ~ .
z06   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ ~ ~ ~ ~ ~ ~ .
z07   . . . . w . . . . . . . . . . . . . . . _ _ _ . . . w . . .
                     +-+W+-+-+-+-+W+-+-+-+-+-+-+D+
z08   . . . . . e . .|C c b P b|P b b b f|H M t t|. . . . . . . .
                     +         +         +       +
z09   . . . . . . . .|C b b P b|P b b b b|t t t t|. . . . . . . .
                     +         +         +       +
z10   . . . . . . . .|b b b b b|b b b b b|t t t t|. . . . . . . .
                     +         +         +       +
z11   . . . . . . . .|b b b b b|b b b b b|t t t t|. . . . . . . .
                     +-+-+D+-+-+-+-+D+-+-+-+-+D+-+
z12   . . . b . . . .|p V p p p K p|k R k k k k k|. . . . . . . .
                     +             +             +
z13   . . . . . . . .|p p p p p p p|k k k k k k F|. . . . . . . .
                     +             +             +
z14   . . . . . . . .|p u u p p p p|k k h h k k G|. . . . . . . .
                     +             +             +
z15   . . . . . . . .Wp u u p W p pDk k T T k k NW. . . . m . . .
                     +             +             +
z16   . . . . . . . .|p O O p p p p|k k h h k k S|. . . . . . . .
                     +             +             +
z17   . . . . . . . .|p p p p p p p|k k k k k k k|. . . . . . . .
                     +-+W+-+D+-+W+-+-+W+-+D+-+W+-+
z18   . . . . . . _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ . . . . . .
z19   . . . . . . _ r _ r _ _ _ _ _ _ s s _ _ _ a a _ . . . . . .
z20   . . . . . . _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ . . . . . .
z21   . . . . . . . . . . . . . . : . . . . . . . . . . . . . . .
z22   . . Z Z . . . . . . . . . . : . . . . . . . . . . Z Z . . .
z23   . . Z Z . . . . . . . . . . : . . . . . . . . . . Z Z . . .
z24   . . . . . . . . . . . . . . : . . . . . . . . . . . . . . .
z25   . . . . . . . . . . . . . . : . . . . . . . . . . . . . . .
z26   . . . . . . . . . . . . . . : X . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . : . . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Extra codes: W stove_woodburning, s swing_porch, a hammock_moss, e reeds_cattail, u rug_rag.

### 3.3 Fish Camp on the Bend (`bayou_fishcamp`) — 40 objects
A wide bend of water on two sides: a one-room camp with a bunk room and washroom, a wraparound dock with **three
fishing posts**, a boathouse (pirogue + bait rack), a hammock and a firepit. The angler's home. **Raised:** the camp
rooms. The boathouse sits at dock level.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . .
z02   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . .
z03   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . .
z04   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . .
                                                 +-+-+-+-+-+-+
z05   . ~ ~ ~ ~ ~ ~ ~ ~ _ Y _ . . . . . . . _ _ _|o o o o o R|. .
                                                 +           +
z06   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . _ _ _|o p o o o o|. .
                                                 +           +
z07   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . _ _ _|o p o o o o|. .
                                                 +           +
z08   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ . . . . . . . _ _ _|o p o o o o|. .
                             +-+-+W+-+-+-+W+-+   +           +
z09   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|V c c c c K c F|. .|o o o o T o|. .
                             +               +   +           +
z10   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|c c c c c c c G|. .|o o o o o o|. .
                             +               +   +-+-+-+D+-+-+
z11   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|c c c h c c c S|. . . . . . . . . .
                             +               +
z12   . ~ ~ ~ ~ ~ ~ ~ ~ _ Y _Dc c c T c c c cW. . . . . . . . . .
                             +               +
z13   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|c A c h c c c N|. . . . . . Z Z . .
                             +               +
z14   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|c c c c c c c c|. . . . . . Z Z . .
                             +-+-+D+-+-+-+D+-+
z15   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|C o o o o|M t H|. . . . . . . . . .
                             +         +     +
z16   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _|C o o o o|t t t|. . . F F . . . . .
                             +         +     +
z17   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _Wo o P P o|t t t|. . . F F . . . . .
                             +         +     +
z18   . ~ ~ ~ ~ ~ ~ ~ ~ _ Y _|o o o o o|t t t|. . . . . . . . . .
                             +-+-+-+-+D+-+-+-+
z19   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ _ _ _ _ _ _ _ _ _ . . . . . . . . .
z20   . ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ _ a a _ _ _ r _ _ . . . . . . . . .
z21   . ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . : . . . . . . . . . . . . .
z22   . ~ ~ ~ ~ ~ ~ ~ ~ w . . . . . . : . . . . . . . . . b . . .
z23   . ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . : . . . . . . . . . . . . .
z24   . ~ ~ ~ ~ ~ ~ ~ ~ w . . . . . . : . . . . . . . m . . . . .
z25   . ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . : . . . . . . . . . . . . .
z26   . ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . : X . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . . . : . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```
Extra codes: R rack_bait, F (outside) firepit_backyard (L2 home version).

**Balance rule** (L1 §3.1): each template has a Chill-Rest and ≥ 2 fun sources (TV + shelf; the Acadian also has
the porch). **Scenarios A-By and B-By** run on all three templates. Crawdad traps add cheap food (§5.1). The B funds
slope must stay within the GDD §18 band (it should rise, since groceries fall).

### 3.4 Bayou Bait & Tackle (`bayou_bait`) — 23 objects
A clapboard shop on a dock: a tackle counter (NPC), a bait tank, a rod rack, the Swamp Guide hiring board, a Rot-Pop
fridge, rocking chairs, and two pirogues for rent at the dock.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ Y _ _ _ _ Y ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z02   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ p _ _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z03   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ p _ p _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z04   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ p _ p _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z05   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ _ p _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
z06   . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ _ _ _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ .
                     +-+-+-+-+-+
z07   . . . . . . . .|b b b b _|_ _ _ _ _ . . . . . . . . . . . .
                     +         +
z08   . . . . . . . .|b c b b _|_ _ _ _ _ . . . . . . . . . . . .
                     +         +
z09   . . . . . . . .|b b b b _|_ _ _ _ _ . . . . . . . . . . . .
                     +-+-+D+-+-+-+-+-+D+-+-+-+-+-+
z10   . . . . . . . .|s s s s s s s s s s R R R s|. . . . . . . .
                     +                           +
z11   . . . . . . . .|s B B s s s s s s s s s s s|. . . . . . . .
                     +                           +
z12   . . . . . . . .|s s s s s s s s s s s s s s|. . . . . . . .
                     +                           +
z13   . . . . . . . .|s s s s Q Q Q s s s s s s s|. . . . . . . .
                     +                           +
z14   . . . Z Z . . .|s s s s s s s s s s s s s s|. . . . . . . .
                     +                           +
z15   . . . Z Z . . .|s s s s s s s s s s s s s n|. . . Z Z . . .
                     +                           +
z16   . . . . . . . .|s s s s s s s s s r s r s s|. . . Z Z . . .
                     +                           +
z17   . . . . . . . .|s P s s s s s s s s s s s s|. . . . . . . .
                     +                           +
z18   . . . . . . . .|s s s s s s s s s s s s s s|. . . . . . . .
                     +-+-+W+-+-+-+D+D+-+-+-+W+-+-+
z19   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z20   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z21   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z22   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z23   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z24   . . . . . . . . . . . . . . : : . n . . . . . . . . . . . .
z25   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z26   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| Q | counter_tackle | B | tank_bait | R | rack_rods |
| n (east wall) | board_swampguide | P | fridge_rotpop | | |

- **NPC:** **Mama Odile Fontaine** (body `granny`), 06–20.

### 3.5 The Swamp Diner (`bayou_diner`) — 28 objects
A checkerboard diner with a 5-stool counter, four booths, a jukebox and a kitchen (NPC only). The deck out front
holds picnic tables and the Saturday boil pot.
```
      3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6   (x; tens: 000000011111111112222222)
z03   . . . . . . . . . . . . . . . . . . . . . . . .
z04   . . . . . . . . . . . . . . . . . . . . . . . .
           +-+-+-+-+-+-+-+-+-+-+
z05   . . .|t G G N t t F t S t|. . . . . . . . . . .
           +                   +
z06   . . .|t t t t t t t t t t|. . . . . . . . . . .
           +                   +
z07   . . .|t t t t t t t t t t|. . . . . . . . . . .
           +                   +
z08   . . .|t t t t t t t t t t|. . . . . . . . . . .
           +-+-+-+-+D+-+-+-+-+-+-+-+-+-+-+-+-+-+
z09   . . .|d d d d d d d d d d d d d d d d d d|. . .
           +                                   +
z10   . . .|d d d d d d d d d d d d d d d d d J|. . .
           +                                   +
z11   . . .|d d Q Q Q Q Q d d d d d d d d d d d|. . .
           +                                   +
z12   . . .|e d d d d d d d d d d d d d d d d d|. . .
           +                                   +
z13   . . .|d d d d d d d d d d d d T d d T d d|. . .
           +                                   +
z14   . . .|d d d d d d d d d d d d v v d v v d|. . .
           +                                   +
z15   . . .|d d d d d d d d d d d d d d d d d d|. . .
           +                                   +
z16   . . .|d d d d d d d d d d d d T d d T d d|. . .
           +                                   +
z17   . . .|d d d d d d d d d d d d v v d v v d|. . .
           +                                   +
z18   . . .|d n d d d d d d d d d d d d d d d d|. . .
           +                                   +
z19   . . .|d d d d d d d d d d d d d d d d d d|. . .
           +-+-+W+-+-+W+-+-+D+D+-+-+W+-+-+W+D+-+
z20   . . . . . . . . . . . : : . _ _ _ _ _ _ _ _ _ .
z21   . . . . . . . . . . . : : . _ P P _ _ P P _ _ .
z22   . . . . . . . . . . . : : . _ P P _ _ P P _ K .
z23   . . . . . . . . . . . : : . _ P P _ _ P P _ _ .
z24   . . . . . . . . . . . : : . _ _ _ _ _ _ _ _ _ .
z25   . . . . . . . . . . . : : . _ _ _ _ _ _ _ _ _ .
z26   . . . . . . . . . . . : : . . . . . . . . . . .
z27   . . . . . . . . . . . : : . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| Q | counter_diner (5 front places + cook) | v | booth_diner + T tables | J | jukebox_swamp |
| e | espresso (Coffin Coffee "chicory blend" skin) | P | picnic_table | K | pot_boil |

- **NPCs:** cook **Cookie Marchand** (body `strongman`) and server **Pearl Delacroix** (body `nurse`), 07–22.

### 3.6 Gator Pond (`bayou_gator`) — 25 objects
An 18×12 pond ringed on three sides by boardwalk with four fishing posts. It has a viewing platform, Old Toothless's
sunning log (den), benches, firefly lanterns and forage bushes.
```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z02   . . . . . e . . . . . . . . . . . . . . . . . . e . . . . .
z03   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . . . .
z04   . . Z Z _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . . . .
z05   . . Z Z _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . . . .
z06   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . Z Z .
z07   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . Z Z .
z08   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . . . .
z09   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ G G . .
z10   . . Z Z _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ G G . .
z11   . . Z Z _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . . . .
z12   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . Z Z .
z13   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . Z Z .
z14   . . . . _ _ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ _ _ . . . .
z15   . . . . _ _ _ _ Y _ _ _ Y _ _ _ _ _ Y _ _ _ Y _ _ _ . . . .
z16   . . . . _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ . . . .
z17   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z18   . . . b . . . . . . . . . V V V V . . . . . . . . . b . . .
z19   . . . . . . B B . . . L . V V V V . L . B B . . . . . . . .
z20   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z21   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z22   . . . . . . . . . b . . . . : : . . . . . . . . . . . . . .
z23   . . . . . . . . . . . . . . : : . . . . . . . . b . . . . .
z24   . . . . . m . . . . . . . . : : . . . . . . . . . . . . . .
z25   . . . . . . . . . . . . . R : : . n . . . m . . . . . . . .
z26   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z27   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| V | platform_viewing (4×2) | G | den_gator (2×2 sunning log) | L | lantern_firefly |

- **NPC animal:** **Old Toothless** (role npc, new model `gator_toothless`, see §6), always present except
  02:00–06:00 when he sinks to sleep (bubbles FX).

## 4. Water terrain (P-W3) — data used by L4
- `LotState.water?: number[]` lists the tile indices (z·30+x).
- The templates fill:

| Template | Water tiles |
|---|---|
| shotgun | z 1–6 except the dock x 13–15 |
| acadian | z 1–6 except the dock x 20–22 |
| fishcamp | x 1–8 for all z ≤ 26, and x 9–18 at z 1–4 |
| bait | z 1–6 except the dock x 12–17 |
| gator | x 6–23, z 3–14 |

- Water is blocked for pathing and placement except objects tagged `waterOk` (pirogue_dock and post_fishing may
  touch water edges; their footprints themselves sit on land/dock tiles in these templates).
- `fish_cast` targets a `post_fishing` (any lot) or a pond object (L2). The **water body id** chooses the fish table:
  `bayou` for channels, `gatorPond` for Gator Pond.
- Render: one water plane per lot at y = −0.35 m over the water tiles + under boardwalk tiles. A shoreline mud strip
  is a ground texture blend. Animated duckweed is an instanced decal.

## 5. Signature systems

### 5.1 Crawdad traps (residential + diner)
| Interaction | Effects |
|---|---|
| `bayou_setTrap` | `pot_crawdad`, cost $1 bait, 5 min |
| `bayou_checkTrap` | ready 12 game hours after setting; yields 1–3 `item_crawdads` (seeded; mean 2) |
| `bayou_boilCrawdads` | at a stove or `pot_boil`: 20 min, cooking xp 40/h; makes an `item_meal` with servings = crawdad count, quality 3, **hunger 24 per serving** |

- Each trap gives about **48 hunger a day for $1**. Sale value is $3 each at the diner or bait shop.
- Traps work only on lots with water terrain, and the cap is 3 traps per lot. `pot_crawdad` is free at $40.
- This is a deliberate **bayou living perk** (cheap food, not free). It is not free-food gated, because it costs
  bait and it is cooking, which is an essential.
- Checking a ready trap is a chore: adBonus 6 when ready, Neat Freak +2, Lazy −2.

### 5.2 Swamp foraging (digging xp, P-W2)
Spawns are seeded daily at 06:00 from `(seed, lotId, day)` and read in closed form on catch-up. All forage is
free-food gated when eaten raw. It is sellable at the diner and bait shop.

| Patch | Object | Daily spawn | Eat raw | Sell | Notes |
|---|---|---|---|---|---|
| Bog berries | `bush_bogberry` | 0–3 | hunger +6, fun +2 | $2 | — |
| Ghost mushrooms | `log_mushroom` | 0–2 | hunger +8 | $4 | 5 % chance one is a **Glowcap** (sell $25, curio-like trophy, emissive) |
| Cattail root | `reeds_cattail` | 1 per clump | hunger +10 | $1 | hygiene −4 (mud) |

`bayou_forage`: 5 min, digging xp 10, picks one unit. Salvage (W-029): Spanish moss → Cloth ×1 at 20 %.

### 5.3 Fishing — bayou waters
Same loop and formulas as L2 §4.3 (20-min rolls, bite `0.35 + 0.05·fishing`, junk `0.15 − 0.015·fishing`).
`bayou_buyBait` ($3, carried, lasts 60 min of fishing) adds **+0.10 bite chance**. The new `rod_cypress` adds
+0.05 (Bones).

| fishId | Name | Water | Window | Min skill | Weight | Sell $ | Grilled hunger | Mesh |
|---|---|---|---|---|---|---|---|---|
| `fish_bogBluegill` | Bog Bluegill | bayou, gatorPond | any | 0 | 30 | 4 | 16 | small |
| `fish_whiskerCat` | Whiskered Swamp Cat | both | 19–05 | 1 | 20 | 10 | 36 | long |
| `fish_speckledGar` | Speckled Gar | bayou | 06–20 | 2 | 15 | 14 | 34 | long |
| `fish_mudfin` | Mudfin | both | any | 3 | 12 | 16 | 38 | deep |
| `fish_rustfinDrum` | Rustfin Drum | bayou | 05–09, 17–20 | 4 | 8 | 24 | 40 | deep |
| `fish_ghostShad` | Ghost Shad (glows) | both | 22–04 | 5 | 6 | 30 | 28 | small (emissive) |
| `fish_cypressKing` | Cypress Kingfish | bayou | fog nights only (§10) | 7 | 3 | 70 | 50 | long |
| `fish_oldBucktooth` | Old Bucktooth (legendary catfish) | gatorPond | full-moon nights 22–02 | 9 | 1 | 250 | — (mount/sell) | long, scaled ×2 |
| `junk_lostLure` | Lost Lure | both | any | — | junk | 2 | — | salvage Wire |

- **Money check** (skill 6, night, bayou): ≈ $10.2 per catch × 1.95 catches/h ≈ **$20/h**, the same as L2. Selling at
  the bait shop's 120 % → $24/h, under an L3 wage.
- **Collection** "Bayou Waters" (8 fish): 150 Bones + `cosmetic:frame_cypress`.

### 5.4 Pirogue tours (rabbit hole, no on-water pathing; README §10)
`bayou_rowTour`:
- **Rental:** $15 at the bait shop, or free with an owned `pirogue_dock` on the household lot, or free for Swamp
  Guide careerists.
- **Departure:** the zombie walks to the dock, boards (`row` anim proposed, fallback `sit`), and the pirogue
  glides off the lot edge. The agent is **away for 60 game min**, simulated like work (needs: hunger −4/h,
  energy −4/h, fun +14/h, hygiene −3/h, preservation normal, outdoors-sun ×1.2 by day).
- **Return:** a seeded outcome bundle: 2 fishing rolls on the `bayou` table with the actor's skill, 1 forage roll,
  8 % chance of a **Bayou Find** curio (§5.6), fishing xp 40/h, `scenicRoute` +5.
- **Joinable:** up to 2 household members in one pirogue. Both get the rolls, and social +6/h.

### 5.5 Swamp Guide career (P-W8 — PROPOSED GDD CHANGE §10: a sixth track)
| Level | Title | Wage $/h | Requirement |
|---|---|---|---|
| L1 | Bait Runner | 18 | — |
| L2 | Deckhand | 22 | fishing 2 |
| L3 | Pirogue Pilot | 29 | fishing 4 |
| L4 | Swamp Tour Guide | 41 | fishing 6 |
| L5 | Bayou Legend | 57 | fishing 8 |

- **Shift:** 07:00, 7 h, Tue–Sat. The carpool is a swamp-boat-hearse (new `env_hearseBoat`, see §11).
- Wages sit between Culinary and Mortuary on purpose, with the same balance-pass L1/L2 uplift.
- Performance uses GDD §10's formula with fishing as the primary skill.
- **Join:** `bayou_joinSwampGuide` at `board_swampguide`, or via the phone once the bayou is unlocked.
- **Perk:** free pirogue tours on days off.
- **Work-choice events** (25 %/shift, auto-resolve 2 h; original):
  1. **"A tourist dropped their hat in the water."** Dive for it (fitness check; +perf / soggy −hygiene) or lend
     yours (+perf, −mood "Hatless").
  2. **"Fog rolls in."** Navigate by memory (fishing check; +perf) or turn back (−perf, +safety, no change).
  3. **"Old Toothless wants a ride."** Let him (+fun, tourists love it, +perf; 10 % comedic capsize: hygiene −40) or
     shoo him (nothing).
- Balance: rerun B with Swamp Guide (scenario **Bs**). Target: funds rise after day 7 like Mortuary/Necro-Tech.
  Fishing has to grow via the home fishing post and tours for promotions.

### 5.6 Bayou Finds (curios, 8; `item_curio`)
Found on tours (8 %), as Old Toothless gifts (§6), and in Gator Pond junk rolls at skill ≥ 5 (2 %).

| curioId | Name | Rarity | Sell $ | Examine (original) |
|---|---|---|---|---|
| `curio_bottleMessage` | Message in a Bottle | common | 12 | seeded line ("If found, please return to: the swamp. You're here. Thanks.") |
| `curio_lanternHook` | Rusty Lantern Hook | common | 16 | "Held a lantern for a boat that never came back. It came back. It was just late." |
| `curio_cypressCarving` | Cypress Knee Carving | common | 24 | "Someone carved a frog. Or a face. Or a frog face." |
| `curio_riverboatToken` | Riverboat Token | uncommon | 45 | "Good for one ride. Riverboat not included." |
| `curio_pearlButton` | Freshwater Pearl Button | uncommon | 55 | "From a very fancy coat, worn to a very muddy party." |
| `curio_fiddlePeg` | Old Fiddle Peg | uncommon | 60 | "Still hums when the wind's right." |
| `curio_gatorTooth` | Toothless's Lost Tooth | rare | — (quest: give it back) | quest `n_by_tooth` |
| `curio_sunkenCompass` | Sunken Pocket Compass | rare | 150 | "Points to the diner. Every time." |

Collection "Bayou Finds" (7 sellable + the tooth returned): 150 Bones + `cosmetic:frame_moss`.

## 6. Townies, NPCs & animals
- **Bayou pool:** 14 townies. Occupations: trapper, boat builder, cook, fiddler, schoolteacher, moss gatherer.
  Bodies that fit: walker, granny, hardhat, runner, tourist, civilian, jogger, bride, fortune, clown, sneezer, gold.
- **Arrival weights:**

| Venue | 06–09 | 09–12 | 12–15 | 15–18 | 18–21 | 21–24 | 00–06 |
|---|---|---|---|---|---|---|---|
| Bait & Tackle | 0.6 | 0.4 | 0.3 | 0.4 | 0.3 | — | — |
| Diner | 0.5 | 0.4 | 0.7 | 0.4 | 0.7 | 0.2 | — |
| Gator Pond | 0.2 | 0.3 | 0.3 | 0.4 | 0.6 | 0.5 | 0.1 |

  Saturday boil: diner ×2, 16–20.
- **NPCs:**

| NPC | Venue | Body | Shift | Note |
|---|---|---|---|---|
| Mama Odile Fontaine | Bait shop | granny | 06–20 | rents pirogues, tells the Old Bucktooth legend |
| Cookie Marchand | Diner | strongman | 07–22 | runs the boil |
| Pearl Delacroix | Diner | nurse | 07–22 | gossip source (`town_dryerGossip`-style reveal on chats) |

- **Old Toothless**, the undead alligator (role npc; new model `gator_toothless`, ~6,000 tris, 6 clips: idle, swim,
  sun, yawn — a toothless gummy smile, roll, happy tail-wag; built by the pets pipeline W-009 or a desktop Blender
  member). Friendly, harmless, toothless. He has an **affection** meter (0–100, household-level, decays −2/day):

| Interaction | Effects | Dur. | Requires |
|---|---|---|---|
| `bayou_feedGator` | give a fish: affection +10 (+15 Bog Bluegill, his favourite), fun +12 | 3 min | carrying a fish; ≤ 1 per 4 h |
| `bayou_watchGator` | fun +10/h | 20 min | at `platform_viewing` |
| `bayou_scratchChin` | fun +8, `gatorWhisperer` +8 (8 h) | 5 min | affection ≥ 50 |

  At affection 25 / 50 / 75 / 100 he surfaces with a **Bayou Find**: common, uncommon, uncommon, then the rare
  compass. At 100 (once) he also returns `curio_gatorTooth`: "he wants you to have it… back to him? It's
  complicated." That starts `n_by_tooth`.
- **Strays:** the bayou has its own small pool (3 individuals: a marsh cat, a swamp dog, a raccoon). The L2 rules
  apply (§4.4 there), with spawns at Gator Pond and the bait-shop dock.

## 7. New objects (L4)
| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `pirogue_dock` | Moored Pirogue | bones 600 · $1,200 (home), community free | 1×3 (dock tile; `waterOk`) | boat | board | bayou_rowTour | Narrow flat-bottomed cypress canoe, a paddle, tied to a cleat | 1,600 |
| `post_fishing` | Mooring Post Fishing Spot | free · $60 | 1×1 (`waterOk`) | fishing | fish (front) | fish_cast | Weathered piling with a coil of rope, a bait bucket | 600 |
| `chair_rocking` | Porch Rocking Chair | free · $140 | 1×1 | seat | sit | bayou_rockOnPorch, home_sit | Slatted rocker, woven seat; rocks while in use | 1,200 |
| `swing_porch` | Porch Swing | free · $260 | 2×1 | seat | s0, s1 | bayou_swingPorch | Hanging bench on chains (chains up to the gallery ceiling) | 1,400 |
| `hammock_moss` | Moss Hammock | bones 250 · $300 | 2×1 | nap | lie | bayou_napHammock | Rope hammock draped with Spanish moss, between two posts | 1,500 |
| `stove_woodburning` | Pot-Belly Stove | free · $380 | 1×1, indoor | warm | warm | bayou_warmStove | Cast-iron pot-belly stove, glowing grate (`flame`), flue pipe | 1,300 |
| `pot_crawdad` | Crawdad Trap | free · $40 (max 3/lot, water lots) | 1×1 | trap | trap (any side) | bayou_setTrap, bayou_checkTrap | Wire cylinder trap on a rope, a float; full state shows claws | 700 |
| `pot_boil` | Big Boil Pot | free · $220 (home) | 1×1 | cook | stir (any side) | bayou_boilCrawdads, bayou_crawdadBoil (event) | Huge steel pot on a propane-free fire ring, steam (`water` node) | 1,200 |
| `bush_bogberry` | Bog Berry Bush | free · $50 | 1×1 | forage | forage | bayou_forage | Low bush with dark purple berries (data `count` 0–3 drives visible clusters) | 900 |
| `log_mushroom` | Mushroom Log | free · $60 | 1×1 | forage | forage | bayou_forage | Mossy log with pale ghost mushrooms; Glowcap is emissive | 800 |
| `tree_cypress` | Bald Cypress | free · $300 | 2×2 | tree | look | home_broodTree | Flared buttress trunk, cypress knees, moss curtains (alpha cards) | 5,500 |
| `rack_bait` | Bait Rack | — (fish camp), community | 1×1 | bait | front | bayou_buyBait (home: free bait) | Shelf with bait jars and a cooler | 700 |
| `counter_tackle` | Tackle Counter | — | 3×1 | counter | buy, staff | bayou_buyBait, bayou_rentPirogue (= rowTour), bayou_sellCatch | Plank counter with a till, hooks on a pegboard, a mounted (plastic) fish | 1,800 |
| `tank_bait` | Bait Tank | — | 2×1 | bait | f0, f1 | bayou_buyBait | Bubbling tank of minnows (`water`) | 1,000 |
| `rack_rods` | Rod Rack | — | 3×1 | rods | f0–f2 | catalogue unlock browse (rod_cypress) | Wall of rods in a crate rack | 1,400 |
| `board_swampguide` | Swamp Guide Hiring Board | — | 1×1 | career | front | bayou_joinSwampGuide | Board with a hand-painted map, "GUIDES WANTED — MUST NOT FEAR FROGS" | 800 |
| `counter_diner` | Diner Counter | — | 5×1 | counter | f0–f4, staff | bayou_orderMeal, bayou_sellForage | Chrome-edged counter with stools in the mesh, pie case (`Glass`) | 3,000 |
| `booth_diner` | Diner Booth | — | 2×1 | seat | s0, s1 | home_sit, eating, bayou_swapStories | Red vinyl booth, patched | 1,300 |
| `jukebox_swamp` | Swamp Jukebox | — (home: premium skin of L3 `jukebox_ghoul`) | 1×1 | music | front | bayou_playJukebox | Bubble-tube jukebox with a frog on top (`glow`) | 1,800 |
| `platform_viewing` | Gator Viewing Platform | — | 4×2 | view | view, rail | bayou_watchGator | Raised deck with a rail and a coin binocular (non-functional, decor) | 2,000 |
| `den_gator` | Sunning Log | — | 2×2 | gator | feed | bayou_feedGator, bayou_scratchChin | A big half-sunk log with claw marks | 1,200 |
| `lantern_firefly` | Firefly Lantern | free · $90 | 1×1 | light | — | — (light, night) | Jar lantern with drifting fireflies (particles, `glow`) | 500 |
| `item_crawdads` | Crawdads | item | 1×1 | food, sellable, ingredient | grab | bayou_boilCrawdads, bayou_sellCatch | Small bucket of crawdads | 300 |
| `rod_cypress` | Cypress Fishing Rod | bones 300 · $120 · craftable (Wood 3, Wire 1) | wall item | tools, rod | — | +0.05 bite | Polished cypress rod with a brass reel | 600 |

**Floor style:** `floor_boardwalk` (P-W4).

**New env models:** `env_hearseBoat` (swamp-boat hearse, carpool on bayou lots, 4,000 tris), `env_stiltHouse_a/b`
(neighbour dressing, 4,500 each), `env_cypressGroup` (instanced 3-tree cluster, 6,000).

**Character asset:** `gator_toothless`.

**Totals:** 24 new objects + 1 floor style + 4 env models + 1 animal model.

**Reused:** fridge_rotpop, reeds_cattail, picnic_table, bench_iron, crate_supplies, board_notice, firepit_backyard,
espresso_embalmer (chicory skin), every residential object (catalogue), item_fish, item_curio.

## 8. New interactions (L4)
| id | Target | Effects | Dur. | Requires | Autonomy ad | Anim | Moodlet |
|---|---|---|---|---|---|---|---|
| `bayou_setTrap` | pot_crawdad | cost $1; arms the trap | 5 | trap empty | adBonus 6 when empty and funds < $500; neatFreak +2 | `pickup` | — |
| `bayou_checkTrap` | pot_crawdad | 1–3 item_crawdads | 5 | ready (12 h) | adBonus 6 (chore) | `pickup` | — |
| `bayou_boilCrawdads` | stove / pot_boil | meal servings = crawdads, q3, hunger 24 | 20 | carrying crawdads | as cooking (Appetite gate < 60) | `cook` | deliciousMeal if q ≥ 5 |
| `bayou_forage` | bush_bogberry, log_mushroom, reeds_cattail | §5.2; digging xp 10 | 5 | count ≥ 1 | hunger by item; free-food gated when eating | `clean` (proposed `dig`) | — |
| `bayou_rowTour` | pirogue_dock | §5.4 (away 60 min) | 60 | rental paid / own boat / Swamp Guide | fun 14, adBonus 3 on days off; lazy −3 | proposed `row` (fallback `sit`) | `scenicRoute` +5 |
| `bayou_buyBait` | counter_tackle, tank_bait, rack_bait | cost $3 (free at home rack); bite +0.10 for 60 min of fishing | 2 | — | adBonus 3 before fishing | `pickup` | — |
| `bayou_sellCatch` | counter_tackle | sells carried fish/crawdads at **120 %**, curios at 100 % | 3 | carrying | adBonus 5 when carrying | `talk` | `goodSale` (L3) |
| `bayou_joinSwampGuide` | board_swampguide | join the Swamp Guide track (L1) | 5 | no job, or quits the current one (confirm) | not autonomous | `read` | — |
| `bayou_orderMeal` | counter_diner / booth | menu: **Swamp Gumbo** $14 (hunger 55, q4) · **Crawdad Po'Brain** $10 (hunger 45, q3) · **Bog Berry Pie** $6 (hunger 20, fun +6) · **Chicory Coffee** $3 (energy +10) | 5 + eat | open | as eating; paid food | `talk` then `sitEat` | familyDinner (exists) at a shared booth |
| `bayou_sellForage` | counter_diner | sells forage/crawdads at 100 % | 3 | carrying | adBonus 4 | `talk` | — |
| `bayou_playJukebox` | jukebox_swamp | cost $1; music on 30 min (diners: fun +10/h listening; party score "music on") | 1 | — | fun 3; partyAnimal +3 | `pickup` | — |
| `bayou_swapStories` | booth (social, group ≤ 4) | friendship +5 each, fun +6, charisma xp 6 | 15 | ≥ 2 seated | social 8, fun 4; socialButterfly +3 | `sitTalk` | `tallTale` +5 |
| `bayou_feedGator` | den_gator | §6 | 3 | §6 | fun 6, adBonus 3 | `pickup` | — |
| `bayou_watchGator` | platform_viewing | fun +10/h | 20 | Toothless present | fun 4 | `idle` | — |
| `bayou_scratchChin` | den_gator | §6 | 5 | affection ≥ 50 | fun 4, adBonus 3; cheerful +2 | `crouchPet` | `gatorWhisperer` |
| `bayou_rockOnPorch` | chair_rocking | fun +8/h; social +4/h with another rocker within 3 tiles | 30 | — | fun 4, adBonus 3; lazy +2 | `sit` (rocking) | `porchLife` +4 |
| `bayou_swingPorch` | swing_porch | fun +10/h; romance +2/h with a partner beside | 30 | — | fun 5; hopelessRomantic +3 | `sit` | `porchLife` |
| `bayou_napHammock` | hammock_moss | energy +12/h, fun +4/h (a nap: preservation ×0.5 like the sofa nap) | ≤ 60 | — | energy 10; lazy +3 | `sleep` | — |
| `bayou_warmStove` | stove_woodburning | fun +6/h, social +4/h; joinable | 30 | — | fun 4, social 3 | `idle` | `cosyCampfire` (L2) |
| `bayou_crawdadBoil` | pot_boil (event) | one free serving (hunger 24), social +8/h; joinable | 45 | Saturday boil | hunger 24, social 8 | `standEat` | `bigBoil` +8 |
| `bayou_floatLantern` | Gator Pond rail (event) | cost $1; fun +10 | 5 | Firefly Float nights | fun 6 | `pickup` | — |

**Totals:** 21 new interactions. Reused: fish_cast, fish_grill, curio_*, stray_*, home_sit, eating, town_buySoda,
town_buyJerky, town_readBoard.

### New moodlets
| id | Label | Mood | Duration |
|---|---|---|---|
| `scenicRoute` | Scenic Route | +5 | 240 min |
| `tallTale` | Told a Tall Tale | +5 | 240 min |
| `gatorWhisperer` | Gator Whisperer | +8 | 480 min |
| `porchLife` | Porch Life | +4 | 180 min |
| `bigBoil` | Big Boil | +8 | 360 min |
| `hatless` | Hatless (work event) | −2 | 240 min |

**Totals:** 6 new moodlets.

## 9. Quests
New stat keys: `crawdadsCaught`, `forageItems`, `tours`, `gatorFeeds`, `legendCaught`, `storiesSwapped`.

**Story chain "Down on the Bayou"** (total **620 Bones** + 2 cosmetics):

| id | Title | Steps | Bones | Requires |
|---|---|---|---|---|
| `story_by_arrive` | Welcome to the Wet | `visitLot bayou` → eat at the Swamp Diner (`[bayou_orderMeal] 1`) | 50 | — |
| `story_by_traps` | Crawdad Country | set a trap → check it → boil crawdads | 70 | story_by_arrive |
| `story_by_forage` | Living Off the Land (Mostly Mud) | forage 4 times | 50 | story_by_arrive |
| `story_by_tour` | The Long Way Round | take a pirogue tour | 70 | story_by_arrive |
| `story_by_gator` | Toothless, Not Heartless | feed Old Toothless 3 times | 80 | story_by_arrive |
| `story_by_guide` | Swamp Guide | join the Swamp Guide career (`[bayou_joinSwampGuide] 1`) → work a shift | 100 + `cosmetic:hat_guide` | story_by_tour |
| `story_by_legend` | Old Bucktooth | catch Old Bucktooth (`stat legendCaught 1`), **or** catch 3 fish of skill-4+ species (alt step) | 200 + `cosmetic:frame_bucktooth` | story_by_guide |

The legend step offers an alternative objective so it does not hard-gate on a 1-weight, full-moon, skill-9 roll.
The story completes on whichever step finishes first. **PROPOSED P-W6b:** `anyOf` steps.

**Repeatables:**

| id | Title | Objective | Bones | Cooldown |
|---|---|---|---|---|
| `n_by_boil` | Boil Season | boil crawdads twice | 20 | 2 d |
| `n_by_forager` | Swamp Pantry | forage 5 | 20 | 2 d |
| `n_by_tours` | Paddle Pusher | 2 tours | 30 | 3 d |
| `n_by_gatorSnack` | Snack for Toothless | feed him twice | 20 | 2 d |
| `n_by_porch` | Porch Philosopher | rock on the porch 3 times | 15 | 2 d |
| `n_by_bigFish` | Gar, Drum or Shad | catch one | 35 | 3 d |
| `n_by_tallTales` | Tall Tales | swap stories 3 times | 20 | 2 d |
| `n_by_tooth` | The Tooth of the Matter | give Toothless his tooth back | 80 | once |

**Daily:**

| id | Task | Bones |
|---|---|---|
| `d_by_trap` | check a trap | 8 |
| `d_by_forage` | forage | 6 |
| `d_by_gator` | feed Toothless | 8 |
| `d_by_tour` | take a tour | 10 |
| `d_by_diner` | eat at the diner | 6 |

## 10. Level events
| Event | When | What |
|---|---|---|
| **Saturday Crawdad Boil** | Sat 16:00–20:00, diner deck | free serving per attendee; townies ×2; party score at the venue: ≥ 70 → everyone `bigBoil` ×1.5 duration |
| **Fog Nights** | 20 % of nights (seeded from `(seed,'bayou',day)`), 20:00–06:00 | fog density ×2 (render; off on Low); the Cypress Kingfish window; tour outcome + 1 forage roll; `amb_bayou_fog` |
| **Full Moon over the Pond** | full-moon nights | Old Bucktooth window; Toothless "sings" (low rumble, comedic) at 23:00 |
| **Firefly Float** (W-034 summer) | summer nights 21:00–24:00 at Gator Pond | float lanterns ($1); townies ×1.5 |
| **Lantern Regatta** (W-034 autumn) | one autumn Saturday 18:00 | pirogue race rabbit hole: the winner is the best `fishing + fitness` score among entrants (seeded tie-break) and gets 50 Bones once per year + `regattaChamp` +10 |
| **High Water** (W-034 spring rain) | visual only | the water plane rises 0.2 m; ambience; no tile changes in v1 |

## 11. Music & ambience
- **`mus_bayou`** (original): 3/4 waltz and 2-step feels at ~100 BPM; a fiddle-like bowed lead, an accordion-like
  reed pad and washboard-style scraped percussion; no traditional melodies quoted. Night: slow sustained slide-like
  tones over a frog-chorus bed.
- **`mus_bayou_diner`:** an upbeat honky-tonk piano variant.
- **`amb_bayou`:**
  - day: cicadas, birds (heron call one-shots), water lapping on pilings, moss rustle, the rocking-chair creak
    (spatial);
  - night (`amb_bayou_night`): a big frog chorus, crickets, owls, Toothless's distant bellow (rare, comedic low
    rumble);
  - fog (`amb_bayou_fog`): muffled; a foghorn-ish low hum, very distant.
- **New SFX:** `paddleStroke`, `trapRattle`, `boilBubble`, `gatorRumble`, `rockingCreak`, `frogCroak`, `heronCall`,
  `jukeboxClunk`.

## 12. Environment look (`env_bayou`)
| Key | Day | Dusk | Night | Fog night |
|---|---|---|---|---|
| Sky | humid green-gold haze `#a8ad86` | pink-orange `#c98a6a` | teal-plum `#17202a` | `#2a3230` |
| Fog | `#9aa585`, near 12 m / far 60 m | `#a27c74` | `#1e2a2c` | near 6 m / far 30 m |
| Water | `#3d4a33`, duckweed `#6f8f5e` | — | firefly accents `#d8f080` (bloom) | — |
| Foliage | cypress `#3f4a32`, Spanish moss `#9a9a8a`, mud bank `#4a3c2c` | — | — | — |

Sun ×1.1 warmer than Wormwood. Full moon keeps the global green tint.

## 13. Store tie-ins
- **Premium themed set "Bayou Porch"** (1,500 GG; sum of parts 1,800 GG):

| Item | GG |
|---|---|
| `swing_porchDeluxe` | 400 |
| `rocker_carved` | 300 |
| `lights_stringJar` | 200 |
| `chime_shell` (wall) | 150 |
| `lantern_ship` | 150 |
| `trap_decorTrio` (decor) | 150 |
| `pirogue_decor` (wall-hung) | 300 |
| `rug_braided` | 150 |

- **Quick Build piece set "Stilts & Galleries"** (W-030): pilings, gallery railings, tin roof pieces; free basic,
  Bones for the carved variants.
- **Bones unlocks:**

| Item | Bones |
|---|---|
| pirogue_dock | 600 |
| rod_cypress | 300 |
| hammock_moss | 250 |

- **Sponsor placements** (house brands):

| Brand | Placement |
|---|---|
| Rot-Pop | bait-shop fridge |
| Coffin Coffee | diner espresso (chicory-blend skin) |
| Crypt-Kicks | wader display at the bait shop (dressing with a brand slot) |
| Volt-Hearse | logo on the swamp-boat hearse livery |

  `AdSurface`: the diner's menu-board slot (house brands only).

## 14. Acceptance criteria
1. Water terrain (P-W3) blocks pathing and placement. Saves round-trip `LotState.water`. Old saves (no field) mean
   no water.
2. The 6 templates build and validate as shown (0 errors). Raised rendering (P-W16) never changes sim state.
3. Traps: 12 h timer survives save/load and catch-up; cap 3 per lot; only on water lots.
4. Tours: the agent is away exactly 60 min; the outcome is a pure function of `(seed, agentId, tick)`; rental is
   charged once (idempotent); joinable pair.
5. The Swamp Guide career appears in the job list only once the bayou is unlocked. Wages and requirements per §5.5.
   Its 3 events resolve.
6. Toothless: affection math, the milestone gifts exactly once each, decay closed form.
7. **Perf** (busiest view: Saturday boil at the diner):
   - simulated agents ≤ 18 (+ Toothless on the pond lot);
   - objects ≤ 55;
   - draw calls ≈ 120 + 180 + 60 (cypress/moss dressing, instanced) + 15 (water + fireflies) ≈ **375 ≤ 650**;
   - alpha-card moss is the main overdraw risk, so cap it at 40 cards per view on Low.
8. Balance:
   - A-By and B-By on all 3 templates;
   - Bs (Swamp Guide);
   - the existing sweep unchanged;
   - crawdads must not push the stay-home hunger metric negative, nor make the B funds slope exceed +$150/day
     (a sanity cap; above that, traps are too strong).

## 15. Tests
| Test | Kind | Asserts |
|---|---|---|
| `water.terrain.test.ts` | unit | pathing/placement blocked; `waterOk` exceptions; save migration |
| `templates.bayou.test.ts` | unit | 6 templates validity/reachability/counts |
| `crawdads.test.ts` | unit, adversarial | timers, yields seeded, cap, no double collect on reload |
| `forage.test.ts` | unit | spawn purity, closed-form catch-up, Glowcap rate |
| `fishing.bayou.test.ts` | unit | tables by water body, bait/rod bonuses stack and cap at 0.85 + bonuses ≤ 0.95 |
| `tour.test.ts` | integration | away 60 min; outcomes deterministic; save/load mid-tour restores correctly |
| `career.swampGuide.test.ts` | unit | levels, wages, performance, events |
| `gator.test.ts` | unit | affection, gifts once, tooth quest |
| `travel.bayou.test.ts` | integration | home ↔ bayou round trip identical to reference |
| balance A-By, B-By, Bs | balance | §14 |
| `bayou.spec` | e2e | screenshots day/dusk/fog/night; raised houses with cutaway; draw calls |

## 16. Open questions
1. P-W16 raised rooms (render-only): acceptable, or do you want real elevation in the sim (stairs as path costs)?
2. A 6th career (P-W8) means the phone job list and the career UI need a sixth row. OK?
3. `anyOf` quest steps (P-W6b) for the legend quest: or should the legend just be a repeatable?
4. Old Toothless model: who builds it? Fable (pets pipeline) or a cloud headless-Blender agent?

## 17. References
- Raised Acadian houses on piers: ventilation, flood and moisture protection, cypress frames, galleries:
  https://freepages.rootsweb.com/~acadiancajun/genealogy/chousing.htm · https://chambersarchitects.com/?p=7796 ·
  https://denr.louisiana.gov/assets/TAD/education/ECEP/drafting/a/app-a.htm
- Atchafalaya Basin ecology (cypress-tupelo swamp, abundant fish, crawfish harvest):
  https://www.ebsco.com/research-starters/earth-and-atmospheric-sciences/atchafalaya-swamp ·
  https://wise.er.usgs.gov/dp/pdfs/FS-021-02.pdf
