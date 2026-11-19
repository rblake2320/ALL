# L6 — The Underneath (vertical dig/build layer)

Level id `underneath` · unlock: **`story_gy_cryptKey`** (the Gloam Vault, L2 §4.5) · build order 5th (W-019).
**Hard dependency: spatial floor −1 (P-W11).** This is the "Minecraft" pillar (DESIGN_PILLARS §B) without voxels.
Every lot gains a diggable layer of packed earth and rock beneath it, with:
- smooth, bevelled tunnel walls;
- basements, cellars, crypts and workshops dug tile by tile, or dropped in as prefabs;
- light and darkness;
- finds while digging;
- one community underground lot, the **Catacomb Market**, reached through the Gloam Vault.

Shared conventions are in [README.md](README.md).

## 1. Fantasy & tone
Under Wormwood runs a second town: the old stone quarries the founders dug for their headstones. A century of
Gloams turned them into a market, an ossuary-styled hall and a little underground canal called the Drip. The real
Paris catacombs grew the same way, as old limestone quarries later turned into an ossuary (References). Here the
"bones" in the arches are **carved stone** (E10+).

Zombies love it down here. It is cool (good for Freshness), quiet and dark. It is also the cheapest square footage
in town: you pay in time and shovel-work, not cash. The tone is cosy spelunking: lantern light on rough walls,
echoes, the odd treasure and a lot of worms.

## 2. Map & lots

`LevelDef`: `{ id:'underneath', name:'The Underneath', blurb:'Dig down. It is cooler down there.', environment:'env_underneath',
townies: 6, unlock:{kind:'quest', value:'story_gy_cryptKey'}, content:['underneath','dig','light','catacomb'] }`.
The 6 "deep folk" townies are seeded from `(seed,'underneath')`.

| id | kind | name | templateId | w×d | buildable | map | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `underneath:catacomb_market` | community | The Catacomb Market | `underneath_market` | 30×30 (floor −1 only) | default | 430,410 (under the graveyard pin) | `crypt` | 10–02 | — | level | `amb_underneath` / `mus_underneath` |
| (every residential lot) | residential, floor −1 | "Basement" | rock fill (§3) | 30×30 | [1,29)×[1,27) at −1 | same pin as the house | — | — | — | level | `amb_underneath_home` / home music, low-passed |

Travel to the Catacomb Market:
- via the graveyard's crypt stairs: 0 min from the graveyard (L2 §4.5);
- via the Neighbourhood Map: the graveyard trip + 2 min;
- or via a **dug connection** (§4.6), with 0 travel from the household's own basement.

## 3. Floor −1 (PROPOSED P-W11 — spatial/render/save contract change)
- `LotState.below?: { walls, floors, rock: string /* base64 bitset 900 */, version }`. A missing `below` means
  untouched rock. Objects gain `placement.level?: -1 | 0` (default 0). Saves migrate by omission (old saves = no
  basement).
- **Rock tiles** are solid: not walkable, not buildable. A **dug tile** becomes floor (`floor_dirt_packed` by
  default) and gets rock walls on every edge facing rock. These are drawn as "rock face" wall style
  `wall_rock_face`; they never show the cutaway bug of thin walls, because the cutaway renders them at
  `WALL_CUTAWAY_HEIGHT`.
- **Stairs:** `stairs_basement` (1×2, placed on level 0 inside a room) creates a linked 1×2 landing on −1. The
  pathfinder treats the pair as a portal with cost 6. Zombies take the stairs like any route.
- **Support rule:** an open dug area may not exceed a 7×7 span without a `pillar_stone`, a wall or undug rock inside
  it. The Dig tool shows the span overlay and refuses the tile that would break the rule ("The ceiling looks
  nervous.") so no collapses are needed (E10+ and no destruction system).
- **Limits:**
  - basement dig area ≤ the lot's buildable rect;
  - ≤ 400 dug tiles per lot (perf / save size: the bitset is fixed at 900 bits; objects on −1 count toward the same
    lot object cap of 240 incl. level 0);
  - there is no third level in v1.
- **View:** a "Below" toggle (key `PgDn`) shows level −1; level 0 is hidden except a ghosted outline of its walls.
  Live mode auto-switches the view when the selected zombie changes level.

## 4. Signature systems

### 4.1 Digging tunnels (skill `digging`, P-W2)
- **Dig mode** (a Build-mode tab, "Dig"): the player marks rock tiles to dig; marks cost nothing. Marked tiles must
  touch a stairs landing or an already-dug tile.
- **Who digs:**
  - **Zombies:** autonomous chore `under_digTile` on marked tiles. Duration `60 × (1 − 0.04 × digging)` min
    (60 → 36). Energy −10/h, hygiene −20/h, digging xp 35/h, fun +2/h. A shovel is needed (`shovel_trusty` on the
    lot, L2).
  - **Pay a crew** (`under_hireCrew` at the phone): $40/tile, done at the next 06:00, at most 30 tiles a night. It
    skips the finds rolls (crews keep what they find, a joke in the confirm text).
- **Autonomy:** a marked tile is a chore. adBonus 4, ambitious +2, lazy −4, Night Owl +2 at night. The daily cap of 6
  applies (non-essential).
- **Undo:** "Fill In" a dug tile with no objects on it: 20 min. No refund needed, because digging was time.

### 4.2 Finds while digging (one seeded roll per dug tile, from `(seed, lotId, tileIndex)`)
Because the roll depends on the tile, not on the time, re-digging after an undo never re-rolls. That makes it
exploit-proof.

| Roll | p | Result |
|---|---|---|
| Just earth | 0.58 | worms: Appetite +4 if the digger is below 55 (free-food gated), else nothing |
| Salvage (W-029) | 0.25 | 1 of: Bone 35 % · Scrap 25 % · Glass 15 % · Wire 10 % · Wood 10 % · Ectoplasm 5 % |
| Mineral | 0.08 | `mineral_boneQuartz` $20 · `mineral_foolsGoldTooth` $35 · `mineral_glowstone` $60 (crafts a light, §4.4); weights 60/30/10 |
| Catacomb Relic (curio) | 0.07 | the "Catacomb Relics" set (§4.3), uniform within bands, common 60 / uncommon 30 / rare 10 |
| Pocket of stale air | 0.02 | `stalePocket` −3, 1 h (comedic cough) |

Money check, skill 5, ~48 min per tile including walking, with mineral EV ≈ $28.5 and relic EV ≈ $48 (§4.3):
`0.08·28.5 + 0.07·48 ≈ $5.6` per tile, about **$7/h**. That is below digging graves at the same skill, because
digging here also builds space.

**Seeded secrets** (2 per lot, positions from `(seed, lotId)`, ≥ 6 tiles from the stairs):
1. **Forgotten Room:** a pre-carved 3×3 chamber with a `chest_old` (one guaranteed relic + $50, once).
2. **Old Tunnel Mouth:** a 1-tile `tunnel_old` that, once reached, enables §4.6.

### 4.3 Catacomb Relics (curios, 8)
| curioId | Name | Rarity | Sell $ |
|---|---|---|---|
| `curio_quarryChisel` | Quarryman's Chisel | common | 10 |
| `curio_candleStub` | Century-Old Candle Stub | common | 8 |
| `curio_stoneDice` | Carved Stone Dice | common | 20 |
| `curio_gloamSeal` | Gloam Family Seal | uncommon | 55 |
| `curio_mapFragment` | Tunnel Map Fragment | uncommon | 45 (also reveals the Old Tunnel Mouth's direction) |
| `curio_brassLanternWick` | Brass Lantern Trimmer | uncommon | 50 |
| `curio_vaultLedger` | The Gloam Vault Ledger | rare | — (quest item, §9) |
| `curio_crystalSkullCandle` | Crystal Skull Candleholder | rare | 140 |

EV per find ≈ (12.7 × 0.6) + (50 × 0.3) + (140 × 0.1 × ½: the ledger is not sold) ≈ **$30–48**, depending on whether
the ledger is out of the pool. Collection "Catacomb Relics" (8): 150 Bones + `cosmetic:frame_catacomb`.

### 4.4 Light & darkness (render + sim)
- Every tile on −1 has a **light level** 0–3, computed when the layout changes (not per tick):

| Source | Radius |
|---|---|
| `torch_wall` (free, $15) | 4 |
| `lamp_glowstone` (crafted from 1 glowstone, or $220) | 6 |
| candelabra / lamps (existing) | their catalogue `light.distance` |

  The level is 3 within half the radius, 1 at the edge.
- **Sim effects of darkness** (light 0):
  - walking ×0.9;
  - `cantSeeFeet` −4 mood while standing in the dark for ≥ 10 min (Night Owl immune);
  - **read / paint / craft / stitch / embalm need light ≥ 1** (requirement `under_lit`, reason "Too dark to see
    the stitches");
  - Clumsy zombies have a 2 %/h chance to stub a toe (comedic `stubbedToe` −2, never limb loss).
- **Underground cool (PROPOSED GDD CHANGE §4):** while on −1, the preservation decay base is **×0.8**. Sleeping in a
  pine coffin on −1 halts decay as on level 0; refrigerated coffins are unchanged. This is the zombie reason to
  build basements. Time underground also counts as indoors (no sun ×1.2).
- **Render:**
  - level −1 has no sky; the ambient is `#141218`;
  - point lights come from sources, capped at **12 shadowless lights per view** (Low: 6), and further sources fake
    their glow with emissive sprites;
  - wall AO is baked in the rock-face material (vertex colour).

### 4.5 Prefabs (placed in Dig mode; carve the shape + place the objects; charge = dig crew per tile + objects)
Plans below were validated with the real spatial code. The stub corridor to the south stands in for the stairs
landing as the reachability source.

**Root Cellar** (`under_rootCellar`, 6×4): cold storage for food.
```
      9 0 1 2 3 4 5 6 7 8 9 0 1   (x; tens: 0111111111122)
z08   . . . . . . . . . . . . .
z09   . . . . . . . . . . . . .
z10   . . . . . . . . . . . . .
z11   . . . . . . . . . . . . .
         +-+-+-+-+-+-+
z12   . .|K K d d C C|. . . . .
         +           +
z13   . .|d d d d d d|. . . . .
         +           +
z14   . .|d d d d d d|. . . . .
         +           +
z15   . .|t d d d d b|. . . . .
         +-+-+D+-+-+-+
z16   . . . .|: :|. . . . . . .
             +   +
z17   . . . .|: :|. . . . . . .
             +   +
z18   . . . .|: :|. . . . . . .
             +-+D+
z19   . . . . : : . . . . . . .
z20   . . . . : : . . . . . . .
z21   . . . . : : . . . . . . .
z22   . . . . : : . . . . . . .
z23   . . . . : : . . . . . . .
z24   . . . . : : . . . . . . .
z25   . . . . : : . . . . . . .
z26   . . . . : : . . . . . . .
z27   . . . . : : . . . . . . .
z28   = = = = = = = = = = = = =
z29   . . . . . . . . . . . . .
```
| Code | Meaning |
|---|---|
| K | shelf_preserves |
| C | crate_coldstore (a fridge without power: leftovers spoil ×0.75 slower than a powered fridge's base; capacity 20; GDD §5 PROPOSED) |
| t | torch_wall |
| b | barrel_brine (pickled snacks: `under_pickledSnack` $0 if stocked by "Pickle Leftovers" — 2 leftovers → 3 snacks, hunger +16, never spoil) |

**Family Crypt** (`under_familyCrypt`, 8×6): four niche beds and an altar.
```
      7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2   (x; tens: 0001111111111222)
z07   . . . . . . . . . . . . . . . .
z08   . . . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . . . .
       +-+-+-+-+-+-+-+-+
z10   .|N c N A A N c N|. . . . . . .
       +               +
z11   .|N : N : : N : N|. . . . . . .
       +               +
z12   .|: : : : : : : :|. . . . . . .
       +               +
z13   .|: : : : : : : :|. . . . . . .
       +               +
z14   .|: : : : : : : :|. . . . . . .
       +               +
z15   .|t : : : : : : t|. . . . . . .
       +-+-+-+-+D+-+-+-+
z16   . . . .|: :|. . . . . . . . . .
             +   +
z17   . . . .|: :|. . . . . . . . . .
             +   +
z18   . . . .|: :|. . . . . . . . . .
             +-+D+
z19   . . . . : : . . . . . . . . . .
z20   . . . . : : . . . . . . . . . .
z21   . . . . : : . . . . . . . . . .
z22   . . . . : : . . . . . . . . . .
z23   . . . . : : . . . . . . . . . .
z24   . . . . : : . . . . . . . . . .
z25   . . . . : : . . . . . . . . . .
z26   . . . . : : . . . . . . . . . .
z27   . . . . : : . . . . . . . . . .
z28   = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . .
```
| Code | Meaning |
|---|---|
| N | niche_crypt (a 1×2 lie slot: a pine-coffin-equivalent bed, energy 10/h, preservation halted, +the −1 cool) |
| A | altar_family (`under_honourAncestors`: fun +6/h, `ancestralPride`, which exists) |
| c | candelabra |

**Workshop** (`under_workshop`, 6×5): the crafting hub (W-029).
```
      8 9 0 1 2 3 4 5 6 7 8 9 0 1   (x; tens: 00111111111122)
z08   . . . . . . . . . . . . . .
z09   . . . . . . . . . . . . . .
z10   . . . . . . . . . . . . . .
         +-+-+-+-+-+-+
z11   . .|T T w S w K|. . . . . .
         +           +
z12   . .|w w w w w w|. . . . . .
         +           +
z13   . .|w w w w w w|. . . . . .
         +           +
z14   . .|w w w w w w|. . . . . .
         +           +
z15   . .|L w w w w C|. . . . . .
         +-+-+-+D+-+-+
z16   . . . .|: :|. . . . . . . .
             +   +
z17   . . . .|: :|. . . . . . . .
             +   +
z18   . . . .|: :|. . . . . . . .
             +D+-+
z19   . . . . : : . . . . . . . .
z20   . . . . : : . . . . . . . .
z21   . . . . : : . . . . . . . .
z22   . . . . : : . . . . . . . .
z23   . . . . : : . . . . . . . .
z24   . . . . : : . . . . . . . .
z25   . . . . : : . . . . . . . .
z26   . . . . : : . . . . . . . .
z27   . . . . : : . . . . . . . .
z28   = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . .
```
| Code | Meaning |
|---|---|
| T | bench_tinker (W-029 Tinker Bench) |
| S | table_stitchnmend |
| K | rack_tools |
| L | lamp_glowstone |
| C | chest_stash (opens the household Stash) |

### 4.6 Connections
Reaching a lot's Old Tunnel Mouth lets the household run `under_clearTunnel` (4 h of digging, digging ≥ 3) once.
After that, the basement has a permanent `door_tunnel` to the Catacomb Market: **travel 0 min** both ways (a portal
in the town graph). Only one connection per lot.

## 5. The Catacomb Market (`underneath_market`) — 23 objects, 0 errors
A vaulted stone hall with five stalls and an echo well. To the north are an ossuary-styled chapel (carved stone
arches) and the **Drip**, an underground canal for cave fishing. Arrival is by the stairs landing (south).
```
      2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7   (x; tens: 00000000111111111122222222)
z02   . . . . . . . . . . . . . . . . . . . . . . . . . .
z03   . . . . . . . . . . . . . . . . . . . . . . . . . .
             +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
z04   . . . .|s A A s s A A s|d ~ ~ ~ ~ ~ ~ ~ ~ d|. . . .
             +               +                   +
z05   . . . .|s s s s s s s s|d ~ ~ ~ ~ ~ ~ ~ ~ d|. . . .
             +               +                   +
z06   . . . .|s s s s s s s s|d d d d d d d d d d|. . . .
             +               +                   +
z07   . . . .|s s E E s s s s|d d d d d d d d d d|. . . .
             +               +                   +
z08   . . . .|s s s s s s s s|d m d d d d d d m d|. . . .
             +               +                   +
z09   . . . .|s s s s s s s s|d d d d d d d d d d|. . . .
             +-+-+-+-+D+-+-+-+-+-+-+-+-+D+-+-+-+-+
z10   . . . .|s s s s s s s s s s s s s s s s s s|. . . .
             +                                   +
z11   . . . .|t s s s s s s s s s s s s s s s s t|. . . .
             +                                   +
z12   . . . .|s s R R R s s B B B s s F F F s s s|. . . .
             +                                   +
z13   . . . .|s s s s s s s s s s s s s s s s s s|. . . .
             +                                   +
z14   . . . .|s s s s s s s s s s s s s s s s s s|. . . .
             +                                   +
z15   . . . .|t s s s s s s s s s s s s s s s s t|. . . .
             +                                   +
z16   . . . .|s s L L L s s O O s s s V V V s s s|. . . .
             +                                   +
z17   . . . .|s s s s s s s O O s s s s s s s s s|. . . .
             +                                   +
z18   . . . .|s s s s s s s s s s s s s s s s s s|. . . .
             +                                   +
z19   . . . .|t s s s s s s s s s s s s s s s s t|. . . .
             +-+-+-+-+-+-+-+-+-+D+-+-+-+-+-+-+-+-+
z20   . . . . . . . . . . .|s s s s|. . . . . . . . . . .
                           +       +
z21   . . . . . . . . . . .|s s s n|. . . . . . . . . . .
                           +       +
z22   . . . . . . . . . . .|s s s s|. . . . . . . . . . .
                           +       +
z23   . . . . . . . . . . .|s s s s|. . . . . . . . . . .
                           +-+D+-+-+
z24   . . . . . . . . . . . . d d . . . . . . . . . . . .
z25   . . . . . . . . . . . . d d . . . . . . . . . . . .
z26   . . . . . . . . . . . . d d . . . . . . . . . . . .
z27   . . . . . . . . . . . . d d . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Meaning | Code | Meaning | Code | Meaning |
|---|---|---|---|---|---|
| R | stall_relics | B | stall_bonecarver | F | stall_fungus |
| L | stall_lanterns | V | stall_salvage | O | well_echo |
| t | torch_wall | A | arch_boneStone (carved stone) | E | pew_salvaged |
| ~ | canal_drip (8×2 water object with 8 fishing slots) | m | mushroom_glowcap (forage) | n | board_notice |

**Stalls (NPC-run):**

| Stall | NPC (body) | Sells / buys |
|---|---|---|
| **Relics** | Old Mole (`thief`) | buys curios at **115 %**, minerals at 100 % |
| **Bone Carver** | Ossia (`fortune`) | bone-carving crafts (W-029): 3 Bone → `decor_boneCarving` (env +2, sells $40); without W-029: buys Bone salvage at $5 |
| **Fungus** | Glimmer (`screamer`, whispering only) | Fungus Skewer $4 (hunger +18), glowcap lamp $220 |
| **Lanterns** | — | torches $15, glowstone lamp $220 |
| **Salvage swap** (W-029) | — | trades 3 of one material for 1 of another |

**Cave fishing (the Drip):** fish table `drip`, with the L2 formulas:

| fishId | Name | Min skill | Weight | Sell $ | Grilled hunger | Note |
|---|---|---|---|---|---|---|
| `fish_paleCaveFish` | Pale Cave Fish | 0 | 30 | 6 | 18 | — |
| `fish_blindEel` | Blind Eel | 3 | 12 | 22 | 30 | — |
| `fish_glowMinnow` | Glow Minnow | 5 | 6 | 30 | 12 | emissive |
| `fish_dripKing` | The Drip King | 8 | 1 | 160 | — | mount only |

The Drip has no time windows: it is always night down here.

## 6. Objects (L6)
| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `stairs_basement` | Basement Stairs | free · $450 | 1×2 (+ linked landing) | stairs | up, down | (portal) | Steep wooden stairs with a rope rail; trapdoor variant | 1,400 |
| `pillar_stone` | Stone Support Pillar | free · $90 | 1×1 | support | — | — | Rough-hewn pillar with an iron band | 500 |
| `torch_wall` | Wall Torch | free · $15 | 1×1 (wall-adjacent) | light | — | — (light 4) | Iron bracket torch (`flame`) | 300 |
| `lamp_glowstone` | Glowstone Lamp | free · $220 · craftable (1 glowstone + 1 Wire) | 1×1 | light | — | — (light 6) | Glowing mineral in a cage (`glow`, cool green) | 600 |
| `shelf_preserves` | Preserves Shelf | free · $160 | 2×1 | storage | f0, f1 | `under_pickleLeftovers` | Jars of pickled things | 1,600 |
| `crate_coldstore` | Cold-Store Crate | free · $180 | 2×1 | fridge (unpowered) | use | home_eatLeftovers, home_putAwayLeftovers | Slatted crate with straw and ice blocks | 900 |
| `barrel_brine` | Brine Barrel | free · $90 | 1×1 | snack | use | `under_pickledSnack` | Oak barrel with a lid and ladle | 700 |
| `niche_crypt` | Crypt Niche Bed | free · $260 | 1×2 | bed, coffin | lie | home_sleep (pine params) | Arched stone niche with a linen bedroll | 900 |
| `altar_family` | Family Altar | bones 300 · $600 | 2×1 | decor, mourn | honour | `under_honourAncestors` | Stone altar with candles and portrait niches | 1,500 |
| `bench_tinker` | Tinker Bench | free · $400 (W-029 owns recipes) | 2×1 | craft | f0, f1 | W-029 craft interactions | Cluttered workbench, vice, gears | 2,200 |
| `chest_stash` | Stash Chest | free · $120 | 1×1 | stash | use | W-029 `stash_open` | Iron-banded chest | 800 |
| `chest_old` | Forgotten Chest | spawned (secret) | 1×1 | loot | use | `under_openChest` | Mouldy chest with a rusted lock | 800 |
| `tunnel_old` | Old Tunnel Mouth | spawned (secret) | 1×1 | tunnel | use | `under_clearTunnel` | Collapsed brick arch | 1,000 |
| `door_tunnel` | Tunnel Door | spawned | opening | door, portal | — | travel portal to the Catacomb Market | Low iron door in a brick arch | 900 |
| `stall_relics` / `stall_bonecarver` / `stall_fungus` / `stall_lanterns` / `stall_salvage` | Market Stalls | — | 3×1 | stall | buy, staff | per stall (§5) | Wooden stalls lit by candles; signage carved in stone | 2,000 each |
| `well_echo` | Echo Well | — | 2×2 | fun | use | `under_shoutEcho` | Stone well; your groan comes back three times | 1,400 |
| `arch_boneStone` | Carved Bone-Stone Arch | — (premium skin for homes) | 2×1 | decor | admire | `hills_admireExhibit`-style "Admire the Carving" | Arch of stone carved to look like stacked bones (clearly stone texture) | 2,400 |
| `canal_drip` | The Drip | — | 8×2 | water, fishing | f0–f7 | fish_cast (table `drip`) | Narrow stone channel with dark water, dripping ceiling FX | 2,800 |
| `mushroom_glowcap` | Glowcap Cluster | — | 1×1 | forage | forage | bayou_forage (glowcap) | Emissive mushrooms | 400 |
| minerals (`mineral_boneQuartz`, `mineral_foolsGoldTooth`, `mineral_glowstone`) | items | item | 1×1 | sellable | grab | curio_sellMail-like `mineral_sell` | Small rocks with sparkle | 200 each |
| `wall_rock_face` (wall style) | Rock Face | — | — | — | — | — | Bevelled irregular rock wall style (vertex-colour AO) | — |

**Totals:** 26 new objects (5 stalls and 3 minerals counted individually) + 1 wall style.

**Reused:** shovel_trusty, rack_tools, table_stitchnmend, candelabra_drippy, pew_salvaged, board_notice, item_curio,
item_fish, every catalogue object (placeable on −1 unless outdoorOnly).

## 7. Interactions (L6)
| id | Target | Effects | Dur. | Requires | Autonomy ad | Anim | Moodlet |
|---|---|---|---|---|---|---|---|
| `under_digTile` | marked rock tile (targetKind tile) | dig + finds roll (§4.2); digging xp 35/h | 60→36 | shovel on lot; adjacent dug/landing; support rule | adBonus 4 (chore); lazy −4, ambitious +2 | `dig` (fallback `clean`) | `dirtUnderNails` |
| `under_fillTile` | dug empty tile | refills | 20 | no objects on the tile | not autonomous | `dig` | — |
| `under_hireCrew` | phone | $40/tile, done 06:00, ≤ 30 per night | 2 | funds | not autonomous | `phone` | — |
| `under_openChest` | chest_old | 1 guaranteed relic + $50 (once, idempotent) | 5 | — | adBonus 8 | `pickup` | `luckyFind` |
| `under_clearTunnel` | tunnel_old | creates `door_tunnel` (§4.6) | 240 | digging ≥ 3 | not autonomous | `dig` | `vaultOpener` (L2) |
| `under_honourAncestors` | altar_family | fun +6/h | 15 | — | fun 3 | proposed `pray` (fallback `mourn`) | `ancestralPride` (exists) |
| `under_pickleLeftovers` | shelf_preserves | 2 leftover servings → 3 pickled snacks (never spoil) | 15 | ≥ 2 leftovers | adBonus 4 when leftovers are about to spoil | `cook` | — |
| `under_pickledSnack` | barrel_brine | hunger +16 | 3 | stock ≥ 1 | hunger 16 (snack gate < 55) | `standEat` | — |
| `under_shoutEcho` | well_echo | fun +12, social +2 (others hear it) | 3 | — | fun 6, adBonus 2; partyAnimal +3, loner −2 | `groan` | — |
| `under_buyRelic`, `under_sellRelics`, `under_buySkewer`, `under_buyLight`, `under_swapSalvage`, `under_carveBone` | stalls | per §5 | 3–30 | open | sell: adBonus 5 when carrying | `talk` | `goodSale` |
| `mineral_sell` | mailbox / Relic stall | 100 % / 100 % | 3 | carrying | adBonus 4 | `pickup` | — |
| `under_giveLedger` | Madame Gloam NPC (L2, full-moon nights) | quest | 5 | carrying the ledger | not autonomous | `talk` | `goodDeed` |

**Totals:** 17 new interactions (the 6 stall interactions counted individually). Reused: fish_cast, fish_grill (the
fungus stall has a grill), bayou_forage, home_sleep, eating, crafting (W-029).

### New moodlets
| id | Label | Mood | Duration |
|---|---|---|---|
| `cantSeeFeet` | Can't See My Own Feet | −4 | while dark |
| `stubbedToe` | Stubbed a Toe | −2 | 60 min |
| `stalePocket` | Stale Air | −3 | 60 min |
| `coolAndCozy` | Cool and Cosy | +4 | while on −1 ≥ 1 h (Freshness ≥ 50) |
| `spelunker` | Spelunker | +6 | after digging 10 tiles in a day, 6 h |

**Totals:** 5 new moodlets.

## 8. Townies & NPCs
- **Deep folk:** 6 townies (miners, candle-makers). Bodies: hardhat, walker, thief, fortune, screamer, granny. They
  appear only at the Catacomb Market. Arrival weights: 10–14 0.3, 14–20 0.5, 20–02 0.6.
- **NPCs:** Old Mole (relics), Ossia (bone carver), Glimmer (fungus). Up to 2 are simulated at a time: Glimmer and
  Mole share a stall shift rota (10–18 / 18–02).
- No townie ever enters a household basement uninvited; party guests may.

## 9. Quests
New stat keys: `tilesDug`, `mineralsFound`, `relicsFound`, `secretsFound`, `tunnelsCleared`.

**Story chain "Beneath It All"** (requires the L6 unlock; total **680 Bones** + 2 cosmetics):

| id | Title | Steps | Bones |
|---|---|---|---|
| `story_un_market` | The Market Below | `visitLot underneath:catacomb_market` → buy a torch | 60 |
| `story_un_stairs` | Going Down | place basement stairs → dig 4 tiles | 70 |
| `story_un_light` | Let There Be (Some) Light | light a room so every tile has light ≥ 1 (P-W6 new kind `litRoom`) | 60 |
| `story_un_room` | A Room of One's Own | dig 20 tiles total → place a prefab or 6 objects on −1 | 90 |
| `story_un_relic` | Finders Keepers, Deeper | find a Catacomb Relic | 80 |
| `story_un_secret` | Something in the Walls | open a Forgotten Chest **or** reach an Old Tunnel Mouth | 120 |
| `story_un_ledger` | The Gloam Ledger | find the Vault Ledger → give it to Madame Gloam on a full-moon night | 200 + `cosmetic:frame_lantern` + `cosmetic:title_deepDweller` |

**Repeatables:**

| id | Title | Objective | Bones | Cooldown |
|---|---|---|---|---|
| `n_un_dig` | Deeper Still | dig 6 tiles | 25 | 2 d |
| `n_un_minerals` | Rockhound | find 2 minerals | 30 | 3 d |
| `n_un_caveFish` | Blind Date | catch 2 cave fish | 25 | 2 d |
| `n_un_echo` | Echo, Echo | shout into the well 3 times | 15 | 2 d |
| `n_un_pickles` | Pickled Pantry | pickle leftovers twice | 20 | 3 d |

**Daily:**

| id | Task | Bones |
|---|---|---|
| `d_un_dig` | dig a tile | 8 |
| `d_un_light` | place a light | 6 |
| `d_un_market` | visit the market | 8 |

## 10. Events
| Event | When | What |
|---|---|---|
| **Candlemarket** | Saturday nights 20:00–02:00 | every stall −10 %; deep folk ×2; the canal gets floating candles (FX) |
| **Drip Tide** | full-moon nights | the Drip King window opens (otherwise the King is weight 0) |
| **Tremor** (comedic) | 1 % per game day per lot with ≥ 50 dug tiles | dust falls (FX); everyone on −1 `startled` −2; no damage, ever |
| **Seasonal (W-034)** | Halloween | "Lantern Descent": a guided procession from the graveyard down to the market; joins give `spelunker` |
| **Seasonal (W-034)** | summer | the market is the coolest place in town: summer heat (if W-034 adds it) has no effect on −1 |

## 11. Music & ambience
- **`mus_underneath`** (original): low marimba-and-bowed-glass ostinato in Phrygian, 70 BPM, with long cave reverb;
  the market version adds a frame-drum pulse.
- **`amb_underneath`:** dripping water (random one-shots, spatial), distant rumble, torch crackle near torches, echo
  on all footsteps and voices (reverb send on the zombie voice bus, below).
- **`amb_underneath_home`:** the same, quieter, with the muffled house above (thumps when level-0 zombies walk
  overhead: a lovely detail, cheap to do).
- **New SFX:** `pickaxeChunk` (the shovel in rock), `rockCrumble`, `drip`, `echoGroan`, `chestCreak`.
- **Audio engine need:** a reverb send for underground (`underground: true` in the AmbienceState); lead-owned.

## 12. Environment (`env_underneath`)
| Key | Value |
|---|---|
| Sky | none (black `#0b0a0e`) |
| Ambient | `#141218` at 0.15 |
| Fog | `#100e14`, near 6 m / far 22 m (hides the lot edge) |
| Rock | warm grey `#5f5a52` / `#4a463f` with damp highlights |
| Floor | packed dirt `#463626` |
| Light colours | torch `#ffb35a`, glowstone `#9fe870`, candles `#ffcf8a` |

Full-moon green tint: none (no sky) except at the canal (a moon-shaft through a grate: one spotlight).

## 13. Store tie-ins
- **Premium themed set "Lantern Deep"** (1,400 GG; sum of parts 1,650 GG):

| Item | GG |
|---|---|
| `arch_boneStone` home skin | 300 |
| `chandelier_ironCandle` | 300 |
| `rug_mossCarpet` | 150 |
| `fountain_cavern` (wall-fed drip fountain) | 300 |
| `lantern_hanging` | 150 |
| `door_vaultRound` (round vault door opening) | 300 |
| `wall_rock_crystal` (crystal-vein rock-face wall skin) | 150 |

- **Quick Build pieces (W-030):** catacomb arches, vaulted ceilings, stone stairs. Basic free; carved variants Bones.
- **Bones unlocks:**

| Item | Bones |
|---|---|
| altar_family | 300 |
| lamp_glowstone shortcut (buy instead of craft) | 120 |

- **Boost** (MONETIZATION §1, "boosts sell convenience"): **none**. Paid dig crews already exist for $ (household
  money). We do not sell instant digging for GG, because that would sell power that skips the core loop.
- **Sponsor:** Coffin Coffee cart at the Candlemarket (dressing with a brand slot). No AdSurface underground.

## 14. Acceptance criteria
1. P-W11 floor −1 lands with migrations (old saves load with no basement and zero repair warnings). Pathfinding
   through stairs portals. Placement on −1 follows the rock/dug masks.
2. Digging: duration, xp, adjacency, support rule (7×7), the 400-tile cap, the tile-keyed finds roll (re-dig never
   re-rolls), the crew at 06:00 (idempotent, ≤ 30).
3. Light: levels are recomputed only on layout/light changes; requirements block lit-only interactions in the dark;
   Night Owl immunity.
4. Underground cool ×0.8 only on −1, and the balance sweep is unchanged on lots without basements.
5. Connections: portal travel 0 min; one per lot; save/load mid-portal.
6. Catacomb Market builds and validates (as above); the stall prices; the cave fish table.
7. **Perf** (busiest view: the market on Candlemarket night):
   - agents ≤ 14;
   - objects ≤ 40;
   - lights ≤ 12 real + emissive sprites;
   - draw calls ≈ 90 + 140 + 40 (rock walls merged per 8×8 chunk) + 20 ≈ **290 ≤ 650**.

   **Basement worst case:** 400 dug tiles + 80 objects: rock walls merged into ≤ 16 chunk meshes, so ≤ 450 draw
   calls with level 0 hidden. Save size: +900-bit mask + objects; a full basement ≤ +60 KB per lot.
8. Balance:
   - a new scenario **U** (B + a 40-tile basement crypt with niche beds) keeps every GDD §18 target;
   - mean freshness may rise by at most +8 (the cool must not trivialise decay);
   - if it rises more, lower ×0.8 to ×0.9.

## 15. Tests
| Test | Kind | Asserts |
|---|---|---|
| `spatial.below.test.ts` | unit, adversarial | masks, adjacency, support spans (forged commands too), portal pathing, migration |
| `dig.under.test.ts` | unit | durations by skill, tile-keyed rolls, crews idempotent, finds distribution (10k) |
| `light.test.ts` | unit | light-level maps, recompute triggers, lit requirements |
| `cool.test.ts` | unit | ×0.8 only on −1; sleeping rules |
| `catacomb.test.ts` | unit | stalls, cave fish, Candlemarket discount |
| `secrets.test.ts` | unit | 2 per lot, ≥ 6 tiles from stairs, chest once, tunnel once |
| `travel.underneath.test.ts` | integration | graveyard ↔ market stairs; basement portal; save/load mid-route |
| balance U | balance | §14 |
| `underneath.spec` | e2e | the Below toggle, cutaway on −1, draw calls in a 400-tile basement (logged), screenshots with torches only |

## 16. Open questions
1. P-W11 is the biggest contract change in all seven levels. Does the lead want a **dedicated spatial design pass**
   first (portal pathing, cutaway on two levels, save shape)? I'd recommend it.
2. Is "underground cool ×0.8" acceptable as a GDD change, or should the perk only be the niche beds?
3. Should the basement view hide level 0 completely (simpler, faster) or ghost it (prettier, +draw calls)?

## 17. References
- Paris Catacombs: an ossuary created in old limestone quarries (1786–1814), reinforced against collapse, narrow
  corridors and chambers: https://en.wikipedia.org/wiki/Catacombs_of_Paris ·
  https://www.worldatlas.com/articles/catacombs-of-paris-subterranean-boneyard-of-france.html
- High water tables rule out basements in parts of Louisiana, which is why the bayou (L4) has no basements and
  above-ground cellars were used there instead:
  https://denr.louisiana.gov/assets/TAD/education/ECEP/drafting/a/app-a.htm. **Rule:** `bayou:*` lots have no
  floor −1 (Dig mode shows "Too wet to dig here").
