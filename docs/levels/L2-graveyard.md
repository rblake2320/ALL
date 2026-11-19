# L2 — The Old Graveyard (community level, built first)

Level id `graveyard` · unlock: start (adjacent to Wormwood Heights) · build order **1st** (W-015, after the W-025
framework). This is the most detailed level doc. It is the first level built, and it exercises travel, a community
lot, free food (DESIGN_SURVIVAL_PETS_SAVES §2), strays → pets (§3), two new skills (README P-W2) and the hand-off to
L6. Shared conventions, scales and proposed contract changes are in [README.md](README.md).

## 1. Fantasy & tone
The Old Graveyard is Wormwood's back garden. It is a Victorian "garden cemetery" gone soft at the edges:
- winding gravel walks, leaning headstones in tidy rows, an obelisk for the town founder;
- a weeping willow over a murky pond where something large and patient lives;
- the Gloam family mausoleum, sealed for a century, and a groundskeeper's shed that smells of coffee and turned earth.

For the undead it is part allotment, part park, part family reunion. Broke zombies come to **dig for grub** in the
soft, unmarked mounds of the old potter's field. They find worms, beetles and, now and then, a lost trinket a mourner
dropped a hundred years ago. Patient zombies **fish**. Kind ones **befriend the strays** that live between the graves.
On full-moon nights the medium Madame Wisteria Gloam holds a **séance** in the stone circle, mostly to tell the
living-impaired to tidy their rooms.

**Tone rules (E10+).** Nobody is ever dug up. Marked graves are only honoured: pay respects, leave flowers, tidy, read
the epitaph. The menu explains why ("Someone lives here. Try the soft mounds in Potter's Field."). Strays are never
harmed or eaten; chasing them is cartoon slapstick, and they always escape. The séance is comedy, not occult horror.
Grave goods are trinkets (lockets, marbles, a stopped watch), never remains.

## 2. Neighbourhood map

`LevelDef`: `{ id:'graveyard', name:'Old Graveyard', blurb:'Worms, wishes and whatever the pond is hiding.',
environment:'env_graveyard', townies: 0, unlock:{kind:'none'}, content:['graveyard','curios','fishing','strays'] }`.
`townies: 0` means the level has no townie pool of its own: Wormwood's 24 townies visit it (§7).

| id | kind | name | templateId | w×d | buildable | map (x,z) | venue | hours | price | unlock | ambience / music |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `graveyard:old_graveyard` | community | The Old Graveyard | `graveyard_main` | 30×30 | [1,29)×[1,27) | 420,400 | `graveyard` | always (the gate never locks; strays and the séance are at night) | — | none | `amb_graveyard` (day/night variants) / `mus_graveyard` |

Travel from the Mildew Lane starter (220,470) takes 28 game min each way (README §3). Build/Buy is disabled on
community lots. The lot snapshot persists: mound cooldowns, curios left on the ground, dirt, broken vending machine,
and the stray trust table (that one lives in the household, §4.4).

```
Map, Graveyard tab: one pin, NE of Mildew Lane, across the old iron fence
   Mildew Lane ── (310,440) Corner Park ── footpath ──► (420,400) THE OLD GRAVEYARD
                                                        └── (crypt stairs) ──► L6 Catacomb Market (under the same pin)
```

## 3. Lot layout — `graveyard_main`

Five zones on a cruciform gravel walk:
- the **Gloam Mausoleum + Old Section** of marked graves (NW);
- the **Willow Pond** (NE), with the **New Rows** of marked graves south of it;
- **Potter's Field** of soft mounds + the compost heap + the **Groundskeeper's Shed** (SW);
- the **Moon Circle** séance ring + picnic lawn + firepit (SE).

The main gate is at the sidewalk (x 14–15). The layout follows the rural-cemetery pattern: an entrance with the
receiving tomb or vault near the gate, a straight main avenue, a cross avenue, and organic plots between them
(References). Validated with the real spatial code: **72 objects, 0 placement errors, every slot reachable from both
sidewalk entries.**

```
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9   (x; tens: 000000000011111111112222222222)
z00   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
z01   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
           +-+-+-+-+-+-+-+
z02   . . .|c s s V V s c|. d . . : : . . . . . . . . . . . g . .
           +             +
z03   . . .|s s s V V s s|. . . . : : . . r ~ ~ ~ ~ ~ ~ ~ . . . .
           +             +
z04   . . .Ws s s s s s sW. . O . : : . . . ~ ~ ~ ~ ~ ~ ~ . . . .
           +             +
z05   . . .|E E s s s E E|. . . . : : . . . ~ ~ ~ ~ ~ ~ ~ . . . .
           +             +
z06   . . .|s s s s s s s|. . . . : : . . . ~ ~ ~ ~ ~ ~ ~ . . . .
           +-+-+-+D+-+-+-+
z07   . . . . . . : . . . . f . L : : . . r ~ ~ ~ ~ ~ ~ ~ r . . .
z08   . T . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z09   . . . G . G . G . G . G . . : : . L . . . . . . . . . . . .
z10   . . . G . G . G . G . G . . : : : : : . . B B . . Y Y Y . .
z11   . . . . . . . . . . . . . . : : . . . . . . . . . Y Y Y . .
z12   . . . G . G . G . G . G . . : : L . G . G . G . G Y Y Y . .
z13   . . . G . G . G . G . G . . : : . . G . G . G . G . . . . .
z14   . . : : : : : : : : : : : : : : : : : : : : : : : : : : . .
z15   . . : : : : : : : : : : : : : : : : : : : : : : : : : v . .
z16   . T . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z17   . . . M . M . M . M . M . L : : . R . . . . . . . . R . . .
z18   . . . M . M . M . M . M . . : : . . . . @ @ @ . . . . d . .
z19   . . . . . . . . . . . . H H : : . . . . @ @ @ . . . . . . .
z20   . . . M . M . M . M . M H H : : . . . . @ @ @ . . . . . . .
z21   . . . M . M . M . M . M . . : : L . . . . . . . . . . . . .
         +-+-+-+-+W+-+
z22   . .|K w t w e w|. . . . . . : : . P P . . . . . . P P . . .
         +           +
z23   . .|w w h w w w|. . M . M . : : . P P . . F F . . P P . . .
         +           +
z24   . .|w w w w w wD: : M : M : : : . P P . . F F . . P P . . .
         +           +
z25   . .|w w w w w w|m m . . . L : : . . . . . . . d . . . . . .
         +-+-+W+-+-+-+
z26   . . . . . . . . . . . . . . : : n . . . . . . . . . . T . .
z27   . . . . . . . . . . . . . . : : . . . . . . . . . . . . . .
z28   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
z29   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
```

| Code | Object | Code | Object | Code | Object |
|---|---|---|---|---|---|
| `:` | `path_gravel` (validated as packed dirt) | `s` | mausoleum flagstone | `w` | shed planks |
| V | stairs_crypt (2×2, inside the mausoleum) | E | pew_salvaged | c | candelabra_drippy |
| G | grave_marked (1×2, headstone at −Z) | O | obelisk_founder | d | den_stray |
| ~ | pond_murky (7×5) | r | reeds_cattail | B | bench_iron |
| Y | tree_willow (3×3) | L | lantern_post | M | mound_soft (1×2, diggable) |
| H | heap_compost (2×2) | K | rack_tools | t | table_rickety |
| h | chair_creaky | e | espresso_embalmer (sponsor Coffin Coffee) | m | mower_mulchmaster (sponsor) |
| @ | circle_seance (3×3) | P | picnic_table (2×3) | F | firepit_grill (2×2) |
| R | trash_lidded | v | vending_gravecola (sponsor) | n | board_notice |
| T | tree_gnarled | f | plant_deadfern | g | headstone_decor |

**Rooms** (`buildRooms`):

| Room | rect excl. | floor | wall |
|---|---|---|---|
| mausoleum | (3,2)-(10,7) | floor_stone_crypt | wall_stone_crypt |
| shed | (2,22)-(8,26) | floor_planks_worn | wall_wood_panel |

**Openings:**
- `door_crypt` h:6:7 (mausoleum, faces the Old Section walk);
- `door_splintered` v:8:24 (shed, faces the field path);
- `window_gothic` v:3:4 and v:10:4 (mausoleum side windows);
- `window_grimy` h:4:26 and h:6:22 (shed).

**Floor fills** (`path_gravel`, P-W4):

| Path | rect excl. |
|---|---|
| main avenue | (14,2)-(16,28) |
| cross avenue | (2,14)-(28,16) |
| mausoleum spur | (6,7)-(7,8) |
| shed path | (8,24)-(14,25) |
| pond spur | (16,10)-(19,11) |

**Objects** (defId x,z,rot; rot 0 unless given):

| Zone | Objects |
|---|---|
| Mausoleum | stairs_crypt 6,2 · pew_salvaged 3,5,r2 · pew_salvaged 8,5,r2 · candelabra_drippy 3,2 · candelabra_drippy 9,2 |
| Old Section | grave_marked at x 3,5,7,9,11 on z 9 and on z 12 (10) · obelisk_founder 12,4 · den_stray 11,2 (cat) · plant_deadfern 11,7 |
| New Rows | grave_marked at x 18,20,22,24 on z 12 (4) |
| Pond | pond_murky 19,3 · reeds_cattail 18,3 · 18,7 · 26,7 · bench_iron 21,10,r2 · tree_willow 25,10 (crow perch) · lantern_post 17,9 |
| Potter's Field | mound_soft at x 3,5,7,9,11 on z 17 and on z 20 (10) · mound_soft 10,23 · 12,23 (12 in all) · heap_compost 12,19 |
| Shed | rack_tools 2,22 · table_rickety 4,22 · chair_creaky 4,23,r2 · espresso_embalmer 6,22 · mower_mulchmaster 8,25 (outside) |
| Moon Circle & lawn | circle_seance 20,18 · picnic_table 17,22 · 25,22 · firepit_grill 21,23 · trash_lidded 17,17 · 26,17 · den_stray 27,18 (raccoon) · 23,25 (dog) · vending_gravecola 27,15 |
| Avenues | board_notice 16,26 · lantern_post 13,7 · 16,12 · 13,17 · 16,21 · 13,25 · tree_gnarled 1,16 · 27,26 · 1,8 · headstone_decor 27,2 |

**Non-simulated dressing** (render only, instanced, no collision beyond the lot edge):
- `fence_iron` along the lot boundary (x 0.5, x 29.5, z 0.5) and along z 27.5 with a `gate_iron` gap at x 14–15
  (112 segments in 1 instanced draw);
- `env_gravestones` clusters ×10 beyond the north fence, so the cemetery reads as larger than the lot;
- `env_tree_b` cypress ×6;
- the church spire silhouette `env_spire` (new env model, ≤ 2,500 tris, 40 m back, fog-faded).

**Counts:** 14 marked graves, 12 diggable mounds, 1 compost heap, 6 fishing spots, 7 séance places (6 + medium),
8 picnic seats, 3 benches/pews (6 seats), 3 stray dens + 1 perch.

## 4. Signature systems (sim)

### 4.1 Digging for grub & treasure (new skill `digging`, P-W2)
- **Tools:** the shed's `rack_tools` lends a shovel for free. Every dig's first stage is "Grab a Shovel" at the rack
  (1 min, carry `shovel`, proposed carry item, fallback `brush`), unless the zombie already carries one. The shovel
  returns itself when the zombie leaves the lot. At home, the free `shovel_trusty` wall tool does the same for the
  new `plot_grub`.
- **Where:**
  - `mound_soft` (12 on the lot): once per **24 game hours** per mound (`data.turnedUntil`; a turned mound shows fresh
    dark soil).
  - `heap_compost`: 8 worm servings per day, refilled at 06:00; no curios.
  - `plot_grub` (own lot): one dig per 24 h, curio chance × 0.5.
  - Marked graves can **never** be dug. The menu shows "Dig Here" greyed out with the reason above.
- **Duration:** `30 × (1 − 0.03 × digging)` min (30 → 21). Needs over the run: energy −8/h, hygiene −24/h,
  fun +4/h, then preservation −2 (dirt) on completion. Digging xp **35/h**. Clumsy: 10 % chance the shovel "bonks"
  (fun +5, comedic, no harm).
- **Outcome (one seeded roll from the world RNG at completion):**

| Grub roll | p | Hunger | Extra |
|---|---|---|---|
| Wriggly Worms | 0.55 | +18 | — |
| Crunchy Beetle | 0.25 | +24 | fun +3 |
| Fat Grub | 0.10 | +30 | `grubGourmet` +4 (Gourmand +8) |
| Just Dirt | 0.10 | 0 | `justDirt` −2, 1 h |

  Expected hunger per dig is **+18.9**. `grave_digGrub` eats it on the spot. `grave_digTreasure` is the
  player-ordered variant with the same dig and odds, but the grub is released (no hunger) and the zombie does not need
  to be hungry.
- **Curio roll** (independent): `p = 0.06 + 0.015 × digging` (6 % → 21 %). Mounds blessed by the séance (§10) give
  100 %. A find spawns an `item_curio` beside the mound, the zombie auto-picks it up, and the `luckyFind` moodlet
  applies (§6.2 table).
- **Salvage roll** (W-029 Stash, when that system exists): 30 % one unit; Bone 40 %, Cloth 25 %, Wood 20 %,
  Glass 10 %, Ectoplasm 5 % (×3 on full-moon nights). The compost heap gives 15 % Cloth/Wood.
- **Moodlets:** `dirtUnderNails` −3 for 2 h after any dig (Neat Freak −8; Slob immune).

### 4.2 Grave goods (curios) — 14 sellable + 3 quest fragments
One item def `item_curio` (README §8) with `data.curioId`. Rarity within a find: common 60 %, uncommon 30 %,
rare 10 %, uniform within a band. Values are fixed (no value randomness).

| curioId | Name | Rarity | Sell $ | Examine text (flavour, original) | Model (≤ 400 tris) |
|---|---|---|---|---|---|
| `curio_clayMarble` | Clay Marble | common | 6 | "Someone lost their marbles. Literally. In 1887." | swirled clay sphere |
| `curio_tinSoldier` | One-Legged Tin Soldier | common | 14 | "Still standing guard. Mostly." | flat tin figure, chipped red coat |
| `curio_dollHand` | Porcelain Doll Hand | common | 18 | "It waves if you don't look at it." | tiny glazed hand, crack |
| `curio_loveLetter` | Wax-Sealed Love Letter | common | 22 | Seeded line from a 12-line pool ("My dearest Cornelius, the turnips have failed again…") · Hopeless Romantic `swoon` +6 | folded letter, red wax seal |
| `curio_apothecaryBottle` | Apothecary Bottle | common | 30 | "Label: 'For What Ails You'. Contents: hope." | cobalt glass bottle, cork (`Glass`) |
| `curio_glassEye` | Glass Eye | uncommon | 40 | "It winks. You checked twice." | blue iris marble on a felt pad |
| `curio_silverSpoon` | Engraved Silver Spoon | uncommon | 50 | "Engraved 'BABY'S FIRST GRAVY'." | curled spoon, metallic |
| `curio_pocketWatch` | Stopped Pocket Watch | uncommon | 60 | "Stopped at 3:07. Nobody remembers why." | open hunter case, chain |
| `curio_tarnishedLocket` | Tarnished Locket | uncommon | 65 | "Inside: a tiny portrait of a very serious cat." Quest item for the Widow Veil (§8) | heart locket, chain |
| `curio_funeralBell` | Brass Funeral Bell | uncommon | 75 | "From an old 'just in case' coffin bell-pull. It worked once." | small brass bell with a pull cord |
| `curio_fossilBeetle` | Fossilised Beetle | rare | 90 | "Older than the graveyard. Older than the town. Smug about it." | amber-brown stone with a beetle relief |
| `curio_cameoBrooch` | Cameo Brooch | rare | 130 | "A profile in shell. She looks unimpressed." | oval cameo, gold rim |
| `curio_jetRing` | Jet Mourning Ring | rare | 160 | "Polished black jet. Very fashionable, two centuries ago." | black band, faceted |
| `curio_signetRing` | Founder's Signet Ring | rare | 200 | "The Wormwood crest. Ezekiel's statue in the park is missing one." (hook: L1 statue flavour) | gold signet, crest |
| `curio_keyBow`, `curio_keyShaft`, `curio_keyBit` | Vault Key (bow / shaft / bit) | quest | — (not sellable) | "One third of a very large key." | iron key parts that fit together |

- **Expected value** per find: common avg $18 × 0.6 + uncommon avg $58 × 0.3 + rare avg $145 × 0.1 = **$42.70**.
- **Money from digging** (incl. ~4 min walking per dig; curios only, grub aside):

| Digging skill | $/dig | $/hour |
|---|---|---|
| 0 | $2.56 | **≈ $4.4/h** |
| 5 | $5.76 | **≈ $11/h** |
| 10 | $8.97 | **≈ $20/h** (≈ an L2 wage) |

  The 24 h mound cooldown caps the lot at 12 mound digs per day, about $108/day at skill 10 for a whole household.
  README §5's rule holds: below an L1 wage at skill 0, about L2 at skill 10.
- **Key fragments** drop only while `story_gy_cryptKey` is active. Each curio find is the next missing fragment with
  p = 0.5, in a fixed order: bow → shaft → bit. The séance blessing (§10) guarantees one.
- **Using curios:**
  - `curio_examine` (2 min, fun +4, shows the text);
  - `curio_display` on `shelf_curio` (env +1 each, up to +5);
  - `curio_sellMail` at any mailbox: 100 %, paid in the next 09:00 mail with idempotency key
    `curio:<objectId>`;
  - sell at Rot Row Market for 110 % (L3);
  - donate at the Hilltop Museum for Bones and reputation (L5).
- **Collection:** the "Graveyard Curios" set of 14 (P-W6 `collect`) pays 150 Bones and `cosmetic:frame_curator` on
  completion, recorded per profile (MONETIZATION grant id `<saveId>:collect_curios:1`).

### 4.3 Fishing (new skill `fishing`, P-W2)
- **Rod:** borrowed from `rack_tools` (stage 1, carry `rod`, proposed carry item, fallback none), or the free
  `rod_bent` wall tool at home (for the L4 ponds and later home ponds).
- **Spots:** 6 bank slots on `pond_murky` (fish0..fish5). The interaction is **joinable**: anglers within 3 tiles of
  each other get social +4/h ("Fish Stories").
- **Loop:** `fish_cast` has an open duration. Autonomy runs it 60 min, the player as long as they like. Every
  **20 game min** one seeded roll:
  - **bite** chance `p = 0.35 + 0.05 × fishing` (cap 0.85);
  - on a bite, **junk** with `max(0, 0.15 − 0.015 × fishing)`, else a fish drawn by weight among the species eligible
    now (window, skill).
- **Needs over the loop:** fun +12/h (stopWhen fun ≥ 98 for autonomy), energy −1/h extra, hygiene −2/h. Fishing xp
  **40/h**. Anim: proposed `fishCast` / `fishWait` (fallback `idle` + rod prop).
- **Fish** (`item_fish` with `data.fishId`; four shared meshes tinted per species):

| fishId | Name | Window (game h) | Min skill | Weight | Sell $ | Grilled hunger | Mesh |
|---|---|---|---|---|---|---|---|
| `fish_murkMinnow` | Murk Minnow | any | 0 | 30 | 3 | 12 | small |
| `fish_gudgeon` | Graveyard Gudgeon | 06–20 | 0 | 25 | 5 | 18 | small |
| `fish_palePerch` | Pale Perch | 05–08, 17–21 | 1 | 18 | 9 | 25 | deep |
| `fish_tombCarp` | Tombstone Carp | any | 2 | 15 | 12 | 32 | deep |
| `fish_weepingCatfish` | Weeping Catfish | 20–06 | 2 | 14 | 12 | 36 | long |
| `fish_boneBream` | Bone-Fin Bream | 08–17 | 3 | 10 | 18 | 34 | deep |
| `fish_lanternEel` | Lantern Eel (glows) | 21–04 | 4 | 8 | 20 | 28 | eel (emissive `glow`) |
| `fish_mourningTrout` | Mourning Trout | 05–08 or raining (W-034) | 5 | 6 | 32 | 40 | long |
| `fish_phantomPike` | Phantom Pike | 22–03 | 6 | 4 | 36 | 45 | long |
| `fish_moonKoi` | Moonscale Koi | full-moon nights 22–02 | 8 | 2 | 150 | — (too pretty to eat: sell or mount only) | deep (pearl `Paint`) |
| `junk_oldBoot` | Old Boot | any | — | junk | 1 | — | salvage: Cloth (W-029) |
| `junk_tinCan` | Rusty Tin Can | any | — | junk | 0 | — | salvage: Scrap (W-029) |

- **Money check:**

| Skill / time | Catches/h | Avg $/catch | $/h |
|---|---|---|---|
| 0, day | 1.05 (×0.85 fish) | ≈ $4 | **≈ $3.5/h** |
| 6, day | 1.95 | $7.2 | **≈ $14/h** |
| 6, night | 1.95 | $10.5 | **≈ $20/h** |

  The Koi is a full-moon jackpot: about one per two full moons at skill 8. Fishing stays under an L3 wage. It is
  mainly fun, skill and collection.
- **Using a catch:**
  - `fish_grill` at `firepit_grill`: 15 min, cooking xp 40/h, makes an `item_meal` (1 serving). Hunger = grilled
    hunger × (0.8 + 0.1 × quality), with quality = clamp(2 + ⌊cooking/3⌋ − 1, 1, 6). **Fire chance 0** (a contained
    pit; no fires on community lots).
  - `fish_putInFridge` at home: becomes the ingredient for the new recipe **Fish Supper**, PROPOSED GDD CHANGE §5
    (cost $0 with a stored fish, min cooking 1, 2 servings, quality 3, hunger 40, 30 min; it spoils like leftovers).
  - `fish_sellMail` at a mailbox: 100 %; Rot Row Market 110 %; Bayou Bait & Tackle 120 % (L4).
  - `fish_mount`: $20 fee; a `plaque_fish` wall item, env +2 (Pike/Koi +3).
  - An uncarried `item_fish` despawns after 24 game hours: "the crows got it".
- **Collection:** "Pond Life" (10 fish species, junk excluded): 150 Bones + `cosmetic:frame_angler`.

### 4.4 Strays → pets (DESIGN_SURVIVAL_PETS_SAVES §3; agent role `stray`, P-W7; pet system W-013, pet models W-009)
- **Pool:** 8 individual strays live in the graveyard pool, 2 per species. Each has a stable id `stray_gy_<n>`, a
  name, a variant model, and one pet trait (Lazy, Guard, Curious or Thief), all seeded from `(seed, 'graveyard')`.
  The 16 seeded names are original: Mossy, Biscuit, Sir Wiggles, Ghoulash, Pickle, Tombstone, Rattle, Mrs Feathers,
  Inkblot, Bramble, Nibs, Duchess, Clank, Soot, Puddle, Gravy.
- **Daily spawn schedule** (deterministic from `(seed, 'graveyard', day)`; recomputed in closed form on catch-up; at
  most 3 strays on the lot at once):

| Species | Present on a given day | Window | Den / haunt | Idle behaviour |
|---|---|---|---|---|
| Cat | 70 % | 18:00–02:00 | den 11,2 (beside the mausoleum) | sits on headstones; sun… moon-bathes on the obelisk |
| Dog | 60 % | 07:00–19:00 | den 23,25 (picnic lawn) | begs at picnic tables and the firepit; fetches sticks alone |
| Raccoon | 80 % | 21:00–04:00 | den 27,18 (by the bins) | rummages the bins; makes off with food items left out (meals/fish, never curios) |
| Crow | 100 % | 06:00–18:00 | willow 25,10 (perch) | struts on the paths; carries off a **common curio** left on the ground. It returns it as a gift once trust ≥ 40 |

  The individual is chosen by index `hash(seed, day, species) mod n` among the species' non-adopted strays. A species
  whose strays are all adopted is absent until a runaway pet returns to the pool (with trust 30). Two extra
  non-interactive crows are FX only.
- **Trust** is 0–100 per (household, stray), stored in household flags `stray.trust.<strayId>`. It decays −2 per game
  day without contact (closed form, floor 0).

| Interaction | Requires | Trust Δ (base) | Needs / other | Duration |
|---|---|---|---|---|
| `stray_offerScraps` | actor Appetite ≥ 30 | +12 (later offers within 4 h: +3) | actor hunger −6 (they share their snack); free | 3 min |
| `stray_offerFish` | carrying an `item_fish` | +18 (cat, raccoon ×1.5, dog ×1.0, crow ×0.5) | consumes the fish | 3 min |
| `stray_offerShiny` | crow only; carrying a common curio | +25 (once per curio id) | consumes the curio | 3 min |
| `stray_befriend` ("Speak Softly") | — | +4, max 3 per stray per day | social +3 | 10 min |
| `stray_pet` | trust ≥ 20 | +5 (cat +7) | fun +6, social +4, `furryFriend` +5 (4 h). Below 20: 50 % the stray flees, trust −2, `rebuffed` −2 | 10 min |
| `stray_play` | trust ≥ 40 | +6 | fun +18/h. Dog: fetch; cat: string; raccoon: "shell game"; crow: "trade a bauble" | 15 min |
| `stray_chase` | — | −8; the stray flees and despawns for 2 h | fun +10, energy −2, `comedicFailure` +5. Autonomy never chases a stray with trust ≥ 40 | 6 min |
| `stray_adopt` | trust ≥ 70; household pets < 3 (PROPOSED cap); not a visitor | — | free. The stray becomes a pet (role `pet`), travels home with the household, `newBestFriend` +12 (24 h), stat `petsAdopted` | 5 min |

- **Species multipliers on trust gains:**

| Species | Multiplier |
|---|---|
| cat | ×0.8 (aloof; petting +7) |
| dog | ×1.2 |
| raccoon | ×1.5 on scraps/fish, ×0.7 otherwise |
| crow | ×0.5 on scraps; shinies +25 |

- **Pacing target:** adopt a dog in ~2 visits, a cat or raccoon in 3–4, a crow in 3 with shinies. Example dog:
  - visit 1: scraps 14 + 3× befriend 14 + pet 6 = **34**;
  - visit 2: scraps 14 + befriend 14 + play 7 + pet 6 = **75 → adopt**.

  This mirrors real shelter advice that shy or feral animals need repeated short, calm sessions (References).
- **Autonomy:**
  - `stray_pet` and `stray_befriend`: adBonus 3, cheerful +3, loner +2 (animals are not people), squeamish −2;
  - `stray_play`: adBonus 3, partyAnimal +3;
  - `stray_chase`: partyAnimal +3, clumsy +2, adBonus 1;
  - `stray_adopt` is **never autonomous** (it is a player decision).
- **After adoption** (W-013 owns the pet sim): the pet keeps its trait.
  - Guard pets delay the Repo Ghoul.
  - Thief pets bring home one junk item a day (sell $1–5).
  - **Curious pets dig at a home `plot_grub`** once a day: 8 % curio roll, never a key fragment.
  - Neglected pets **run away** back to this pool with trust 30. Nothing dies.

### 4.5 The Gloam Vault — crypt entrance to L6
- `stairs_crypt` (2×2, inside the mausoleum) is behind an iron vault grille. `grave_inspectVault` (2 min) shows
  "Sealed by order of the Gloam family. Three-part keyhole."
- **Gating with no stubs:** the chain `story_gy_cryptKey` (§8) is offered **only when the `underneath` level is
  registered** (its content module exists). Before L6 ships, the vault is scenic, and no step, button or quest
  points at missing content.
- With the chain active, the fragments drop (§4.2). Then:
  - `grave_assembleKey` at `rack_tools` (needs all three, 20 min, digging xp 10) produces `item_cryptKey`;
  - `grave_unlockVault` on the stairs (5 min, `cryptOpened` event) runs the `grantLevelUnlock('underneath')` effect
    (P-W1) and moves the stairs to state open (animated grille).
- `grave_descend` (open stairs): travel to `underneath:catacomb_market` with **0 travel minutes** (a stairs
  transition: fade, footsteps echo). The return trip is the same.

### 4.6 Free-food balance (aligned with DESIGN_SURVIVAL_PETS_SAVES §2)
**Need side.** A zombie spends about **105–120 Appetite per game day** (−5.5/h awake for ~19–20 h, ×0.5 asleep
for 4–5 h; Gourmand ×1.2).

**Supply side, per hour of effort** (incl. walking on the lot; travel to the lot excluded):

| Source | Hunger per action | Time | Hunger/h | Limits | Cost / risk |
|---|---|---|---|---|---|
| Dig grub (mound, skill 0 / 10) | +18.9 avg | 30 / 21 min + 4 walk | **≈ 33 / 45** | 12 mounds/day per lot, 24 h cooldown each | hygiene −12 per dig, preservation −2, `dirtUnderNails` |
| Compost heap | +14 | 20 + 3 min | ≈ 36 | 8/day per heap | hygiene −8 |
| Fishing + grill (skill 0 / 6) | 12–45 per fish | 20-min rolls + 15-min grill | ≈ 11 / 32 | none | time |
| Own `plot_grub` (L2 buy item) | +18.9 | 30 min | ≈ 36 | 1/day | as dig |
| Rummage trash (exists) | +10 | 6 min | — | trash fill | hygiene −15, 60 % `questionableMeal` |
| Park mushrooms (L1) | +8 | 5 min | — | 0–9/day | 10 % `questionableMeal` |
| Brain Bank pantry (L3) | +45 meal | ~20 min queue | — | 1 per zombie per day | `charityCase` −3 |

**Outcome.** A broke zombie self-feeds on about **3–3.5 h of graveyard time a day**, plus about 56 min of round-trip
travel. That leaves ~12 waking hours for everything else.
- One graveyard can feed **2–3 broke zombies** (12 mound digs + 8 compost ≈ 340 hunger per day). A 4+ zombie
  household also needs the pantry, fishing and trash. That limit is intentional, because a job must stay strictly
  better.
- The saving is about $7/day per zombie of groceries (118 Appetite at Brain Loaf's $0.067/point), against an L1 wage
  of $120–160/day. Free food is a safety net, never a strategy that beats work.

**Autonomy rules.**
- Free-food interactions score only when household funds < $12 **or** no paid food is reachable on the active lot.
  The graveyard's vending machine is paid food, so a household with ≥ $12 buys jerky there instead.
- They count as essential (eating) only while Appetite < 55 (README §4), so the daily cap never starves a zombie.
- The feral override (Appetite ≤ 5) prefers a free source on the lot before Feral Nibble (GDD §3).

**PROPOSED GDD CHANGE P-W13 — autonomous scavenging trip.** Today only the player starts a trip (DESIGN_WORLD_LEVELS
§1). An unattended broke household would never reach the graveyard. Proposal:
- at 10:00, if funds < $12, the fridge has no edible leftovers and any member is below Appetite 55, the household
  autonomously travels to the nearest unlocked free-food lot;
- it returns at 17:00 or when everyone is above Appetite 80;
- at most one trip a day; never while a member is at work; it obeys the v1 "everyone travels together" rule.

**Balance scenario F (new):** starter lot, normal, funds $0, no job, no player, 14 days, 5 seeds. Targets:
- nobody crumbles;
- Appetite < 15 in < 5 % of hours;
- Wasting stage 1 in < 2 % of hours;
- ≥ 1 graveyard trip on ≥ 12/14 days;
- faults 0.

### 4.7 Respect for the marked graves
| Interaction | Effects | Duration | Notes |
|---|---|---|---|
| `grave_payRespects` | fun +6/h, `paidRespects` (exists, +4) | 10 min | visitorAllowed; townies do it too |
| `grave_leaveFlowers` | cost $3; the grave's env +1 for 3 days (data `flowersUntil`); `tendedGrave` +4 | 3 min | stat `flowersLeft` |
| `grave_tidyGrave` | hygiene −6, digging xp 10, `tendedGrave` +4; the groundskeeper's friendship +3 if he is on the lot | 15 min | Neat Freak +6 ad, Slob −10 |
| `home_readEpitaph` (exists) | fun +30/h | 5 min | 14 graves with seeded epitaphs from a 40-line original pool ("Here lies Mabel. She'd rather be standing.") |

## 5. Objects

### 5.1 New objects (L2)
Tri budgets follow ART_DIRECTION. All bevelled, chunky and crooked; recolourable `Paint` where noted.

| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art notes | Tris |
|---|---|---|---|---|---|---|---|---|
| `grave_marked` | Weathered Grave | not buyable (community); data `epitaphId`, variant 0–3 (rounded, cross-topped, scroll, mossy slab) | 1×2 | grave, marked | front (stand: front/sides) | grave_payRespects, grave_leaveFlowers, grave_tidyGrave, home_readEpitaph | Headstone at −Z on a low grassy mound; moss, lean 2–6°; flowers node (`flag`) shows when flowers are left | 900 |
| `mound_soft` | Soft Mound (Potter's Field) | not buyable | 1×2 | dig, mound | dig (any side) | grave_digGrub, grave_digTreasure | Low unmarked earth mound with sparse grass; `turned` state = dark fresh soil + a few worms; `blessed` state = faint green glow (`glow` node) | 500 |
| `heap_compost` | Groundskeeper's Compost Heap | not buyable | 2×2 | dig, compost | dig (any side) | grave_digCompost | Slatted wooden bin of leaves and peelings, steam wisps at dawn | 1,200 |
| `pond_murky` | Willow Pond | not buyable | 7×5 | pond, water, fishing | fish0..fish5 (bank stands, faceObject) | fish_cast | Irregular pond (water plane with `water` node, lily pads, a sunken bench, eyes that blink in the dark under the willow); banks of mud and stones. Counts as one object (README §10: no water terrain for L2) | 5,800 |
| `stairs_crypt` | Gloam Vault Stairs | not buyable | 2×2 | crypt, stairs | descend (front ×2) | grave_inspectVault, grave_unlockVault, grave_descend | Stone stairwell going down into darkness, an iron grille (`door` node, animated open), carved "GLOAM" lintel | 2,800 |
| `circle_seance` | Moon Circle | not buyable | 3×3 | seance | s0..s5 + medium | grave_joinSeance (hidden `grave_leadSeance` for the NPC) | Ring of 8 worn standing stones around a mossy disc; candle stubs (`flame` node, lit only during a séance); moon-rune inlay glows on full moon (`glow`) | 2,400 |
| `firepit_grill` | Picnic Firepit | not buyable (community); home version `firepit_backyard` free $260 | 2×2 | grill, cook | cook0, cook1, warm | fish_grill, grave_warmByFire, grave_toastBrainmallows | Stone ring with an iron grate, glowing coals (`flame`), a kettle on a hook | 1,600 |
| `vending_gravecola` | Grave-Cola Vending Machine | **sponsor** skin `grave_cola_vending` (free $600 at home) | 1×1 | vending | front | town_buySoda, town_buyJerky, home_repair | Chunky retro vending machine, cracked glow panel (`screen`), brand slot = front decal + livery (house brand Grave-Cola) | 1,800 |
| `tree_willow` | Weeping Willow | bones 280 · $400 | 3×3 | tree, perch | look (any side) | home_broodTree (exists), stray crow perch | Drooping grey-green willow, hanging fronds (alpha cards), knotted trunk; sways | 4,500 |
| `den_stray` | Stray Den | not buyable | 1×1 | strayDen | use (any side) | (stray spawn point; `stray_*` target the agent) | Variant by species: cardboard box (cat), upturned crate (dog), drainpipe end (raccoon) | 400 |
| `rack_tools` | Tool Rack | not buyable (community) | 1×1, indoor | tools, shovel, rod | front | (stage 1 of digs/fishing: grab a tool), grave_assembleKey | Wall-backed rack with 3 shovels, 3 bent rods, a lantern, a "PLEASE RETURN" sign | 1,400 |
| `mower_mulchmaster` | Mulch Master Ride-On Mower | **sponsor** skin `mulch_master_mower`; home version free $900 | 2×1 | mower | ride (sit) | grave_rideMower | Small ride-on mower, chunky tyres, grass catcher; brand slot = hood decal + livery | 3,200 |
| `obelisk_founder` | Founder's Obelisk | not buyable | 1×1 | grave, marked, monument | front (any side) | grave_payRespects, home_readEpitaph | Tall granite obelisk with an urn finial; cracked plaque "EZEKIEL WORMWOOD — HE MEANT WELL" | 1,000 |
| `reeds_cattail` | Cattail Reeds | free · $35 (yards) | 1×1 | plant, forage | use (any side) | home_waterFern-style "Rustle the Reeds" (`grave_rustleReeds`, fun +2) | Clump of cattails + reeds, slight sway | 600 |
| `plot_grub` | Backyard Grub Plot | free · $60 | 1×2, outdoorOnly | dig, mound | dig (any side) | grave_digGrub, grave_digTreasure (curio ×0.5, 1/day) | A little fenced dirt bed with a "WORM FARM" sign | 600 |
| `shovel_trusty` | Trusty Shovel | free · $40 · craftable (Wood 2, Scrap 1) | wall item | tools, shovel | — | enables digging at home and in L6 (the zombie grabs it like the rack) | Long-handled spade on two wall pegs | 500 |
| `rod_bent` | Bent Fishing Rod | free · $30 · craftable (Wood 1, Wire 1) | wall item | tools, rod | — | enables fishing away from the graveyard rack | Wobbly bamboo rod with a red float, on pegs | 400 |
| `plaque_fish` | Mounted Catch | spawned by `fish_mount` (sellable $10 + 50 % of fish value) | wall item | decor, trophy | look | home_admirePortrait-style "Admire the Catch" (`fish_admireMount`) | Oval wooden plaque with the fish (species tint), brass label | 500 |
| `item_cryptKey` | Gloam Vault Key | item (quest) | 1×1 item | key, quest | grab | grave_unlockVault target (requires carrying) | A big iron key with a skull bow | 300 |

**Totals:** 19 new objects. Also used from README §8: `item_curio`, `item_fish`, `shelf_curio`, `bowl_pet`,
`bed_pet`, `board_notice`, `fence_iron`, `gate_iron`, `path_gravel`; from L1: `bench_iron`, `picnic_table`.

### 5.2 Reused (exists)
pew_salvaged, candelabra_drippy, door_crypt, door_splintered, window_gothic, window_grimy, lantern_post,
tree_gnarled, plant_deadfern, headstone_decor, table_rickety, chair_creaky, espresso_embalmer (Coffin Coffee
sponsor), trash_lidded, mailbox_crooked (at home, for mail sales), env_fence, env_gravestones, env_tree_b.

## 6. Interactions

### 6.1 New interactions (L2)
Durations in game minutes. "Free-food gated" = README §4. Anim fallbacks per README §6.

| id | Target | Effects | Dur. | Requires | Autonomy ad | Anim | Moodlet(s) |
|---|---|---|---|---|---|---|---|
| `grave_digGrub` | mound_soft, plot_grub | §4.1 (grub eaten), digging xp 35/h, curio + salvage rolls | 30→21 | mound not turned; shovel (rack/own); arms ≥ 1; Appetite < 90 | hunger 19; free-food gated; gourmand −2, neatFreak −6, slob +2 | proposed `dig` (fallback `clean`) | dirtUnderNails, grubGourmet / justDirt, luckyFind |
| `grave_digTreasure` | mound_soft, plot_grub | as above without the grub; player-only | 30→21 | as above minus Appetite | not autonomous | `dig` | dirtUnderNails, luckyFind |
| `grave_digCompost` | heap_compost | hunger +14, hygiene −8, digging xp 35/h | 20 | heap stock ≥ 1; shovel | hunger 14; free-food gated | `dig` | dirtUnderNails |
| `grave_payRespects` | grave_marked, obelisk | fun +6/h | 10 | — | fun 1, adBonus 2; squeamish 0, nightOwl +2 | proposed `pray` (fallback `mourn`) | paidRespects (exists) |
| `grave_leaveFlowers` | grave_marked | cost $3; grave env +1 for 3 d | 3 | funds ≥ 3 | adBonus 2; hopelessRomantic +3 | `pickup` | tendedGrave |
| `grave_tidyGrave` | grave_marked | hygiene −6; digging xp 10 | 15 | grave dirt ≥ 1 (dirt +1/day per grave) | adBonus 6 (a chore when dirty); neatFreak +6, slob −10 | `clean` | tendedGrave |
| `grave_inspectVault` | stairs_crypt | fun +4; shows the vault text / quest hint | 2 | — | fun 1 | `idle` | — |
| `grave_assembleKey` | rack_tools | consumes 3 fragments → item_cryptKey; digging xp 10 | 20 | carrying all 3 fragments | not autonomous | `stitch` | `handyCorpse` +6 |
| `grave_unlockVault` | stairs_crypt | event `cryptOpened`; grantLevelUnlock('underneath') | 5 | carrying item_cryptKey; `underneath` registered | not autonomous | `pickup` | `vaultOpener` +10 (24 h) |
| `grave_descend` | stairs_crypt (open) | travel to `underneath:catacomb_market` (0 min) | 1 | vault open | not autonomous | `walk` | — |
| `grave_joinSeance` | circle_seance | social +12/h, fun +20/h; outcome roll §10 | 60 | séance active (§10); ≤ 6 participants | fun 18, social 10, adBonus 4; partyAnimal +3, squeamish −4, nightOwl +3 | `sitTalk` → fallback; standing: `listen` | outcome moodlets §10 |
| `grave_leadSeance` | circle_seance | NPC-only, hidden | 60 | Madame Gloam | — | `talk` | — |
| `grave_askEzra` | groundskeeper NPC (agent) | social +8 (friendly social, base 0.9, +5/−1 friendship); first time: unlocks the rules tutorial card | 10 | Ezra on lot | social 6 | `talk` | — |
| `grave_giveLocket` | Widow Veil NPC (agent) | consumes curio_tarnishedLocket; friendship +20; quest `n_gy_widowLocket` | 5 | carrying the locket | not autonomous | `talk` | `goodDeed` +8 (24 h) |
| `grave_rideMower` | mower_mulchmaster | fun +12/h; Ezra friendship +2 if present | 20 | — | fun 6, adBonus 3; lazy +3 | `sit` (+ vibration) | — |
| `grave_warmByFire` | firepit_grill (warm) | social +6/h, fun +6/h; joinable | 30 | — | social 4, fun 4, adBonus 2 | `idle` → proposed `warmHands` | `cosyCampfire` +4 (3 h) |
| `grave_toastBrainmallows` | firepit_grill | cost $2; hunger +6, fun +8 (paid food) | 10 | — | hunger 6, fun 6, adBonus 2 | `cook` | — |
| `grave_rustleReeds` | reeds_cattail | fun +2 | 2 | — | fun 1 | `idle` | — |
| `town_buySoda` (shared) | vending_* | cost $2; fun +3, hunger +4 | 2 | not broken | hunger 4, fun 3 | `pickup` then `standEat` | — |
| `town_buyJerky` (shared) | vending_* | cost $5; hunger +20 (= fridge jerky, GDD §5) | 2 | not broken | hunger 20 | `pickup` then `standEat` | — |
| `fish_cast` | pond_murky (and L4 waters) | §4.3; joinable | open (auto 60) | rod; arms ≥ 1 | fun 14, adBonus 3; lazy +2, partyAnimal −2 | `fishCast`/`fishWait` (fallback `idle`) | goodCatch +5 / bigCatch +10 |
| `fish_grill` | firepit_grill (and any stove) | item_fish → item_meal (§4.3); cooking xp 40/h | 15 | carrying a fish | hunger by fish; free-food gated on community lots | `cook` | deliciousMeal (exists) if q ≥ 5 |
| `fish_putInFridge` | fridge (home) | stores the fish for Fish Supper | 2 | carrying a fish | not autonomous | `pickup` | — |
| `fish_sellMail` | mailbox | 100 % value next 09:00 | 3 | carrying fish | adBonus 4 when funds < $50 | `pickup` | — |
| `fish_mount` | mailbox (mail-order taxidermy) | $20 → plaque_fish delivered next morning | 3 | carrying a fish | not autonomous | `phone` | — |
| `fish_admireMount` | plaque_fish | fun +10/h | 10 | — | fun 3 | `admire` | — |
| `curio_pickUp` | item_curio | carry | 1 | — | adBonus 8 (shiny!) | `pickup` | — |
| `curio_examine` | item_curio (carried or displayed) | fun +4, shows text | 2 | — | fun 2 | `read` | swoon (love letter, romantic) |
| `curio_sellMail` | mailbox | 100 % value next 09:00 (idempotent) | 3 | carrying a curio | adBonus 4 when funds < $50 | `pickup` | — |
| `curio_display` | shelf_curio | places the curio on a free surface | 2 | free surface | adBonus 3 | `pickup` | — |
| `curio_admireCollection` | shelf_curio | fun +10/h | 10 | ≥ 1 displayed | fun 3 | `admire` | `proudCollector` +4 (with ≥ 4 displayed) |
| `stray_offerScraps` | stray (agent) | §4.4 | 3 | §4.4 | adBonus 3; cheerful +3 | proposed `crouchPet` (fallback `pickup`) | — |
| `stray_offerFish` | stray | §4.4 | 3 | carrying fish | adBonus 2 | `crouchPet` | — |
| `stray_offerShiny` | crow | §4.4 | 3 | carrying a common curio | not autonomous | `crouchPet` | — |
| `stray_befriend` | stray | §4.4 | 10 | — | social 3, adBonus 3; loner +2 | `talk` | — |
| `stray_pet` | stray | §4.4 | 10 | trust ≥ 20 | fun 6, social 4, adBonus 3 | `crouchPet` | furryFriend / rebuffed |
| `stray_play` | stray | §4.4 | 15 | trust ≥ 40 | fun 12, adBonus 3; partyAnimal +3 | `cheer` / `dance` (dog) | furryFriend |
| `stray_chase` | stray | §4.4 | 6 | trust < 40 for autonomy | fun 6, adBonus 1; partyAnimal +3, clumsy +2 | `feral` | comedicFailure |
| `stray_adopt` | stray | §4.4 | 5 | trust ≥ 70; pets < 3 | never autonomous | `hug` | newBestFriend |

**Totals:** 39 new interactions (18 `grave_` + 2 shared `town_` vending, 6 `fish_`, 5 `curio_`, 8 `stray_`). Reused: home_readEpitaph,
home_broodTree, home_sit, home_nap, home_haveServing (picnic tables), home_wipeDown, home_emptyTrash,
home_rummageTrash, home_repair, home_brewEspresso (shed), all socials.

**New recipe** (PROPOSED GDD CHANGE §5): **Fish Supper**, ingredients = one stored fish ($0), min cooking 1,
2 servings, quality 3, hunger 40/serving, cook 30 min.

### 6.2 New moodlets (L2)
| id | Label | Mood | Duration | Trigger |
|---|---|---|---|---|
| `dirtUnderNails` | Dirt Under the Nails | −3 (Neat Freak −8; Slob immune) | 120 min | any dig |
| `grubGourmet` | Grub Gourmet | +4 (Gourmand +8) | 180 min | fat grub |
| `justDirt` | Just Dirt | −2 | 60 min | empty dig |
| `luckyFind` | Lucky Find! | +6 common / +8 uncommon / +12 rare | 360 min | curio found |
| `tendedGrave` | Tended a Grave | +4 | 240 min | flowers / tidy |
| `goodCatch` | Good Catch | +5 | 180 min | any fish ≥ skill-2 species |
| `bigCatch` | The Big One | +10 | 480 min | Pike, Trout, Koi |
| `furryFriend` | Furry Friend | +5 | 240 min | pet / play |
| `rebuffed` | Rebuffed by a Raccoon | −2 | 60 min | failed pet |
| `newBestFriend` | New Best Friend | +12 | 1,440 min | adopt |
| `spiritsApprove` | The Spirits Approve | +8 | 720 min | séance |
| `coldSpot` | Cold Spot | −4 (Squeamish −8) | 120 min | séance |
| `slimed` | Slimed (Delightfully) | +3 | 120 min | séance ectoplasm |
| `cosyCampfire` | Cosy Campfire | +4 | 180 min | warm by fire |
| `handyCorpse` | Handy Corpse | +6 | 240 min | assemble key |
| `vaultOpener` | Opened the Vault | +10 | 1,440 min | unlock vault |
| `goodDeed` | Good Deed | +8 | 1,440 min | give locket (shared with L3 volunteering) |
| `proudCollector` | Proud Collector | +4 | 240 min | admire ≥ 4 curios |
| `swoon` | Swooning | +6 | 180 min | Hopeless Romantic reads a love letter |
| `comedicFailure` | (L1) | +5 | 180 min | chase |

**Totals:** 19 new (+1 shared from L1).

## 7. Townies & NPCs
- **Townies:** Wormwood's 24 are routed here. At most **8 on the lot**. They stay 1–3 h, pay respects, leave flowers,
  fish, picnic and gossip. Arrival weights (per hour, drawn hourly from `(seed, lotId, day, hour)`):

| Hours | 00–06 | 06–09 | 09–12 | 12–17 | 17–20 | 20–24 |
|---|---|---|---|---|---|---|
| Weight | 0.05 | 0.25 (joggers) | 0.35 | 0.45 | 0.40 | 0.20 (×3 on full moon 21–01) |

  Townie autonomy here: grave_payRespects 30 %, grave_leaveFlowers 10 %, fish_cast 20 %, picnic/eat 10 %, socials
  20 %, stray_pet 10 %. Townies never dig (it is a zombie household thing, and it keeps mounds for the player).
- **NPC — Ezra Spade, groundskeeper.** Body `walker`, role npc, shift 06:00–22:00. Traits flavour: neatFreak,
  grumpy-but-kind.
  - Routine: mows (rides the mower 09:00–09:20), tidies 2 graves an hour, leans on the shed at noon with his coffee
    (uses the espresso machine), does the 23:00 lantern walk (§10).
  - Teaches the rules (`grave_askEzra`).
  - His friendship ≥ 35 gives a 10 % discount at Rot Row Market's curio counter: "he knows a guy".
- **NPC — Madame Wisteria Gloam, medium.** Body `fortune`. Only on full-moon nights, 21:30–02:00. She leads up to 3
  séance rounds and is the last of the Gloam family (L6 story hook: the vault is "family business").
- **Named regular — the Widow Veil.** Body `bride`, a seeded townie flagged `graveyardRegular`. She visits 16:00–18:00
  daily and leaves flowers on grave (9,12). She lost her locket a century ago (`n_gy_widowLocket`).
- **Other cast-body fits** (W-002 townie bodies): jogger (dawn route), tourist (photographs the obelisk), granny,
  civilian, nurse (night stroll), streamer ("ghost-hunting" livestream, comedic, full moons).
- **Strays:** up to 3 (§4.4). Pets that travel with the household count as household agents (≤ 8 + pets ≤ 3).

## 8. Quests

New stat keys (global + per agent, like `STAT`): `gravesDug`, `graveGoodsFound`, `curiosSold`, `fishCaught`,
`rareFishCaught`, `straysBefriended` (incremented when a stray's trust crosses 40), `petsAdopted`, `flowersLeft`,
`gravesTidied`, `seanceRounds`. New objective kinds per P-W6: `visitLot`, `collect`.

**Story chain "Grave Matters"** (a DAG; up to 3 active; total **590 Bones** + 3 cosmetics):

| id | order | Title | Steps (objective) | Bones (+ entitlement) | Requires |
|---|---|---|---|---|---|
| `story_gy_rules` | 1 | The Groundskeeper's Rules | talk to Ezra (`interaction ids [grave_askEzra] 1`) → pay respects at a grave (`[grave_payRespects] 1`) | 40 | `visitLot graveyard:old_graveyard` happened (or story_ww_overTheFence) |
| `story_gy_firstDig` | 2 | Worms, Glorious Worms | dig for grub twice (`[grave_digGrub, grave_digTreasure] 2`) | 50 | story_gy_rules |
| `story_gy_finders` | 3 | Finders, Keepers | find a grave good (`stat graveGoodsFound 1`) → sell or display one (`[curio_sellMail, curio_display] 1`) | 60 | story_gy_firstDig |
| `story_gy_angler` | 4 | Something's Biting | catch 3 fish (`stat fishCaught 3`) → grill one (`[fish_grill] 1`) | 60 | story_gy_rules |
| `story_gy_strays` | 5 | Four-Legged Regulars | befriend a stray (`stat straysBefriended 1`) → adopt one (`stat petsAdopted 1`) | 100 + `cosmetic:petCollar_stitched` | story_gy_rules |
| `story_gy_seance` | 6 | Knock Twice for Yes | join a séance (`[grave_joinSeance] 1`) | 80 + `cosmetic:frame_moon` | story_gy_rules |
| `story_gy_cryptKey` | 7 | The Gloam Vault (**offered only when `underneath` is registered**) | find the 3 key parts (`collect cryptKey 3`) → assemble (`[grave_assembleKey] 1`) → open the vault (`[grave_unlockVault] 1`) | 200 + `cosmetic:frame_vault` + unlock L6 | story_gy_finders, story_gy_seance |

**Repeatables** (offered in the shipped 2-per-morning rotation once their prerequisite is done):

| id | Title | Objective | Bones | Cooldown | Requires |
|---|---|---|---|---|---|
| `n_gy_digDeep` | Dig Deep | dig 4 times | 20 | 2 d | story_gy_firstDig |
| `n_gy_curioHunter` | Curio Hunter | find 2 grave goods | 35 | 3 d | story_gy_finders |
| `n_gy_catchOfDay` | Catch of the Day | catch 5 fish | 25 | 2 d | story_gy_angler |
| `n_gy_bigOne` | The Big One | catch a Pike, Trout or Koi (`stat rareFishCaught 1`) | 45 | 4 d | story_gy_angler |
| `n_gy_tidyRows` | Tidy Rows | tidy 3 graves | 20 | 2 d | story_gy_rules |
| `n_gy_flowers` | Forget-Me-Nots | leave flowers twice | 15 | 2 d | story_gy_rules |
| `n_gy_strayRounds` | Stray Rounds | pet strays 3 times | 15 | 2 d | story_gy_strays |
| `n_gy_widowLocket` | The Widow's Locket | give the Widow Veil her locket (`[grave_giveLocket] 1`) | 60 | once (no repeat) | story_gy_finders |
| `n_gy_moonlight` | Moonlight Regular | join 2 séance rounds | 40 | 7 d | story_gy_seance |

**Daily-task pool additions:**

| id | Task | Bones |
|---|---|---|
| `d_gy_dig` | dig once | 8 |
| `d_gy_fish` | catch a fish | 8 |
| `d_gy_respects` | pay respects | 6 |
| `d_gy_pet` | pet a stray | 8 |
| `d_gy_grill` | grill a fish | 8 |
| `d_gy_flowers` | leave flowers | 6 |

**Collections:** Graveyard Curios (14) and Pond Life (10), each 150 Bones + a frame. Bones/hour sanity check: a
focused graveyard session earns a story step (40–100) + a repeatable (15–45) + 1–2 daily tasks (6–8), about
**120–170 per hour**, plus collections. That is below the 260/h budget (README §5), which leaves room for
aspirations and L1/L3 content running in parallel.

## 9. Level events
| Event | When | What |
|---|---|---|
| **Moonlit Séance** | full-moon nights (GDD §2: every 7th day), 22:00–02:00 | §10 |
| **Lantern Walk** | nightly 23:00–23:30 | Ezra walks the avenues with a lantern; strays present follow him; zombies on the lot get `+2` fun/h while within 4 tiles (ambient). Purely flavour; deterministic route |
| **Morning Mist** | 05:00–08:00 | ground fog plane (render); Pale Perch and Mourning Trout window |
| **Dawn Chorus** | 06:00 | the crow caws 3×, the church bell tolls (ambience) |
| **Remembrance Day** (W-034 spring) | one day per spring | townie arrivals ×2; everyone leaving flowers gets `tendedGrave` ×2 duration; Ezra hands out free flowers (cost $0) |
| **Night of the Open Gates** (W-034 Halloween) | Halloween night 19:00–02:00 | the graveyard is the town's party venue: 8 extra `lantern_jack` dressing objects, a `bob_for_brains` barrel (fun +16/h, 15 min, joinable), a costume contest at the Moon Circle (charisma check; winner `bestCostume` +10). A séance runs whatever the moon phase |
| **Firefly Nights** (W-034 summer) | summer nights 21:00–24:00 | firefly FX; `grave_warmByFire` → "Firefly Watching" variant (+fun 10/h) |
| **Frozen Pond** (W-034 winter) | winter | the pond freezes: `fish_cast` becomes "Ice Fishing" (bite chance ×0.8, Freshness −0.5/h less decay outdoors: the cold suits zombies) |

## 10. The Moonlit Séance (night event, detail)
- **Start:** at 21:30 on a full-moon night, Madame Gloam walks in from the gate and lights the candles (`flame`
  nodes, sfx `candleWhoosh`). From 22:00 a notification reads "A séance is gathering at the Moon Circle".
- **Rounds:** up to **3 rounds** of 60 min (22:00, 23:00, 00:00; 01:00 if a round was skipped). Each round needs
  ≥ 1 household participant. Townies fill the free places (attendance weight ×3).
- **Outcome:** one seeded roll per round from `(seed, day, round)`. The whole circle sees the same result:

| Roll | p | Effect |
|---|---|---|
| The Spirits Approve | 0.40 | `spiritsApprove` +8 (12 h) to all participants |
| A Message from Great-Aunt Ida | 0.25 | one random unturned mound becomes **blessed** for 24 h (the next dig there always finds a curio: rare 40 % / uncommon 60 %; with `story_gy_cryptKey` active, the next key part instead); a toast names the mound's row |
| Cold Spot | 0.20 | `coldSpot` −4, but fun +10 instant (a delicious shiver) |
| The Table Knocked Twice | 0.10 | +15 friendship between every pair of participants |
| Ectoplasm! | 0.05 | `slimed` +3; +1 Ectoplasm each (W-029) |

- **Comedic dialogue:** "The spirits say… tidy your room." / "Someone named Harold wants his hat back." Lines come
  from an original 30-line pool, delivered in Groanish by the medium with subtitle bubbles.
- **End:** at 02:00 Wisteria blows out the candles and leaves. `seanceRounds` +1 per round per participant.

## 11. Music & ambience brief
- **`mus_graveyard`** (original, synthesised by the existing composer):
  - live: Dorian mode, ~64 BPM, a slow 6/8 lullaby on a reed-organ patch with glass-harmonica counter-melody;
  - night: solo cello-like bowed patch, very sparse, long reverb;
  - **séance**: tense mood variant with a sine "theremin" lead with slow vibrato over a low drone; a knock motif
    (two muffled hits) at round start;
  - party (Halloween): the same motif as a jaunty harpsichord waltz.
- **`amb_graveyard`:**
  - day: wind through the iron fence (whistle band 1.5–3 kHz), crows, pond frogs (low), distant church bell tolling
    once per game hour, Ezra's mower when it runs (spatialised);
  - night: crickets, owls, louder frogs, willow wind chimes, the bell 12 tolls at midnight;
  - full moon: the existing moon layer.
- **New SFX ids** (lead adds to `SFX_IDS`): `shovelDig`, `dirtThrow`, `fishCast`, `reelIn`, `splashSmall`,
  `catMeow`, `dogBark` (soft, playful), `raccoonChitter`, `crowCaw`, `churchBell`, `seanceKnock`, `candleWhoosh`,
  `vaultGrille`.

## 12. Environment look (`env_graveyard`)
| Key | Day | Dusk | Night | Full moon |
|---|---|---|---|---|
| Sky | overcast `#a7ada8` | lilac `#7e6a92` → ember `#b97a55` at the horizon | plum `#1a1424`, moon `#e8e0c8` | moon larger, sky `#1d2a24` (green tint) |
| Fog | `#8f9a94`, near 18 m / far 70 m (denser than Wormwood) | `#76708a` | `#22202e` | `#2a3a30` |
| Sun / moon light | warm-grey `#d9cfb8` 0.8 | `#c98a5a` 0.6 | cold moonlight `#b8c4e0` 0.35 | `#bfe8c0` 0.45 |
| Ground | moss `#5f7a52` + dirt `#5a4634` + gravel `#8d877a` | — | — | — |
| Water | `#3e4f45` with lily pads `#6f8f5e` | — | — | — |
| Accents | — | — | lanterns `#ffb35a` | toxic-glow mound blessing `#9fe870` |

- **Ground mist:** a 0.4 m low fog plane 05:00–08:00 and all night (alpha 0.25), off on Low quality.
- **Post:** the existing ACES + bloom (candles, lanterns, the eel, the koi).

## 13. Store tie-ins
- **Premium themed set "Moonlit Mourning"** (1,500 GG; sum of parts 1,750 GG, shown):

| Item | GG |
|---|---|
| `statue_angelWeeping` | 300 |
| `bench_gothic` | 300 |
| `arch_ironGate` (garden arch) | 300 |
| `obelisk_mini` | 250 |
| `lantern_ironCage` | 150 |
| `wreath_mourning` (wall) | 150 |
| `candle_cluster` | 150 |
| `urn_planterStone` | 150 |

  All are cosmetic decor with no gameplay advantage beyond env scores in the normal decor bands.
- **Bones unlocks:**

| Item | Bones |
|---|---|
| `tree_willow` | 280 |
| `table_seance` (home séance table: on full moons it lets the household hold a 1-round mini séance at home, outcome table without key parts) | 450 |
| `plaque_fish` gold frame variant | 120 |

- **Pet cosmetics** (premium 150 GG each; the pet system owns them): stitched collar, glowing-eye collar, bat-wing
  harness, crow monocle. Store pet beds are skins of `bed_pet`.
- **Sponsor placements** (house brands only, README §5):

| Brand | Skin | Object |
|---|---|---|
| Grave-Cola | `grave_cola_vending` | vending machine (also a free home version) |
| Mulch Master | `mulch_master_mower` | ride-on mower (also a free home version) |
| Coffin Coffee | existing espresso skin | in the shed |

  An `AdSurface` billboard creative slot on the far side of the street (outside the fence) serves house-brand art
  only.

## 14. Acceptance criteria
1. `createLotTemplate('graveyard_main')` builds the layout in §3; every object passes placement checks with no
   blocked slots; every slot is reachable from both sidewalk entries (as validated here: 72 objects, 0 errors).
2. The first entry into `graveyard:old_graveyard` builds deterministically. A second entry restores the snapshot and
   never rebuilds from the template.
3. Digging: odds, cooldowns, xp and money match §4.1–4.2 over 10,000 seeded rolls (±1.5 %). Marked graves never
   offer an enabled dig.
4. Fishing: bite/junk/eligibility per §4.3. The Koi only on full-moon nights at skill ≥ 8.
5. Strays: the spawn schedule is a pure function of (seed, day, adoption state). Trust arithmetic and multipliers per
   §4.4. Adoption moves the stray into the household as a pet and removes it from the pool. Runaway pets return
   with trust 30.
6. Free-food gate: funds ≥ $12 with the vending machine reachable → no autonomous free-food pick. Funds < $12 →
   digging is picked when Appetite < 55.
7. Séance: only on full-moon nights. ≤ 3 rounds. Same outcome for all participants. A blessed mound yields a curio.
8. Crypt: no quest, button or text points at L6 before `underneath` is registered. After it is registered the chain
   works end to end and the descend trip round-trips.
9. **Perf:** at most 21 simulated agents (8 household + 8 townies + 2 NPC + 3 strays); 72 template objects + up to
   ~40 transient items. **Draw-call estimate on the busiest view (dusk, full moon, séance running):**

| Part | Draw calls |
|---|---|
| template objects | ~150 |
| agents (18 × ~10) | ~180 |
| strays (3 × 4) | ~12 |
| fence (instanced) | 1 |
| dressing | ~30 |
| candles/lights | ~20 |
| post-processing | ~10 |
| **total** | **≈ 400 ≤ 650** |

   Tri total ≈ 260 k incl. characters. RAM delta ≤ 60 MB.
10. Snapshot ≤ 25 KB (72 objects + mound/grave data). Lot load ≤ 2 s on the reference mid GPU.
11. Balance: the full `npm run balance` sweep is unchanged, and **scenario F** (§4.6) meets its targets on 5/5 seeds.

## 15. Tests (to add with the implementation)
| Test | Kind | Asserts |
|---|---|---|
| `templates.graveyard.test.ts` | unit | shape; placement validity; reachability; counts (14 graves, 12 mounds, 6 fish slots, 3 dens); mausoleum + shed rooms (35 and 24 tiles) |
| `graveyard.dig.test.ts` | unit, adversarial | duration by skill; 24 h cooldown survives save/load and catch-up; outcome distribution (10k rolls); curio EV $42.70 ±3 %; marked graves never diggable (also via a forged command); no double grant on reload (idempotency key); one-armed zombie can dig, zero-armed cannot |
| `graveyard.curios.test.ts` | unit | mail sale pays exactly once at 09:00 (replay, reload, duplicate command); display env bands; key parts only during the quest, fixed order; collection completion grant idempotent |
| `fishing.test.ts` | unit | bite/junk formulas, windows, Koi gating, 24 h despawn, grill quality formula, fire chance 0 on community lots, Fish Supper recipe |
| `strays.test.ts` | unit, adversarial | schedule purity; ≤ 3 strays; trust math, caps (3 befriends/day, scraps 4 h), decay closed form = per-day iteration; adopt cap 3; chase never targets trust ≥ 40 autonomously; adoption removes the stray from the pool across save/load |
| `seance.test.ts` | unit | moon gating; round count; shared outcome; blessing behaviour |
| `freefood.gate.test.ts` | unit | gate predicate truth table (funds × reachable paid food × Appetite) |
| `travel.graveyard.test.ts` | integration | home → graveyard → home equals a reference run byte for byte; save/load during a dig and mid-trip; catch-up idempotent (apply twice = once) |
| `crypt.gating.test.ts` | integration | with `underneath` unregistered: no quest, vault scenic; registered: chain completes, unlock granted once |
| balance **F** | balance | §4.6 targets on 5 seeds; the full sweep unchanged |
| `graveyard.spec` | e2e (Playwright) | map pin → arrive; dig, fish, pet; screenshots day/dusk/night/full-moon séance; draw calls logged ≤ 650 |

## 16. Open questions for the lead
1. **P-W13 autonomous scavenging trip:** accept? Without it, an unattended broke household cannot use the graveyard
   and scenario F cannot pass.
2. Pet cap of 3 for NEW adoptions: approved by Fable, 2026-11-12; retain every animal in valid older four-pet saves and refuse further adoptions until below three.
3. Proposed carry items `shovel`, `rod` and anim states `dig`, `fishCast`, `fishWait`, `crouchPet`, `pray`,
   `warmHands`: who builds the clips (characters agent), and do the fallbacks ship if they slip?
4. Firepit fire chance 0 on community lots: OK? It avoids a fire system on lots the household does not own.
5. Should townies ever dig? This doc says no, to keep mounds for the player and the free-food capacity predictable.

## 17. References
Layout and behaviour references only. All names, characters, text and numbers above are original.
- Rural cemetery movement (picturesque winding paths, garden cemetery as a park; Mount Auburn 1831):
  https://en.wikipedia.org/wiki/Rural_cemetery · https://www.tclf.org/mount-auburn-cemetery-ma ·
  https://w1.planning.org/greatplaces/spaces/2013/mountauburncemetery.htm
- Groton Cemetery inventory (16 sections; avenues/ways/paths of ~5–8 ft; receiving tomb inside the entrance):
  https://gpl.org/uploads/pages/img/Documents/GrotonCemeteryFormE.pdf
- Victorian cemeteries mixing formal grids and picturesque paths; denominational sections; costlier plots along
  paths: https://vhd-dr.heritage.vic.gov.au/places/14998 · https://www.parksandgardens.org/places/flaybrick-memorial-gardens-birkenhead
- Shy/feral adult cat socialisation, slow repeated short sessions (trust pacing for strays):
  https://www.maddiesfund.org/assets/lifesaving-academy/feline-lifesaving/APA!%20Guide%20to%20Socializing%20Adult%20Cats.pdf
- Raccoons: active shortly after dusk, drawn to bins (spawn window and den by the bins):
  https://skedaddlewildlife.com/location/baltimore-md/blog/why-raccoons-are-most-active-at-night
