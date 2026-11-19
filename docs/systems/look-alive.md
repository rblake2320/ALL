# W-027 Look Alive: Passing, mirror routines, makeup, wigs and slips

Status: **implementation-ready spec v1.0** (2026-11-05). Owner of this doc: systems design agent (`docs/systems/**`).
Sources: DESIGN_PILLARS §A (owner direction), GDD §3/§4/§7/§9/§14, BALANCE.md, MONETIZATION §1/§3/§8,
docs/levels/README.md (§4–§7 scales). All numbers below use the shipped scales: needs 0–100 per game hour, skills
0–10, integer $, ticks of 0.25 game min (240/h, 5,760/day).

## 1. Player fantasy

*"I'm a zombie. I want a normal life, so I'll put my face on, fix my wig, spray some Eau de Living and walk into that
job interview like I have a pulse."* Getting ready in front of the mirror is a small daily ritual, with skills to learn
and cosmetics to collect. You can see the payoff: living-world doors open (job interviews, dates with warm townies,
the country club), and there is always a chance of a comic slip. A groan escapes over the canapés, the wig slides
sideways, and the whole room goes quiet.

## 2. Rules

### 2.1 Passing score (per zombie, 0–100, derived)

Passing is **never stored**. It is a pure function of the agent state plus the Look Alive record (§3), evaluated on
demand (O(1)). That means it can never drift or desync, and saves stay small.

```
P = clamp(round(F + M + H + S + C + R + T + B − Lm − W − X), 0, 100)
```

| Term | Source | Formula | Range |
|---|---|---|---|
| **F** Freshness | `needs.preservation` | `30 × clamp((pres − 20) / 70, 0, 1)` | 0…30 |
| **M** Makeup | applied layer (§2.3) | `5 × q × fade`; q = 1…4; fade = 1 for 6 game h after application, then linear to 0 at 10 h | 0…20 |
| **H** Hair | appearance + wig | bald and no wig 0 · natural hair 6 · wig 10 (askew: 2) · *Groomed* buff +2 (8 h) | 0…12 |
| **S** Scent | `needs.hygiene` + cologne | hygiene ≥ 60: +5 · 30–59: 0 · < 30: −10 · 0 (*Reeking*): −25 · cologne active +8 (cologne is cancelled while Reeking) | −25…13 |
| **C** Clothes | outfit condition 0–100 | `condition / 10`; `topStyle 'tatters'` caps C at 2 | 0…10 |
| **R** Poise | skill + rehearsal | `1.5 × charisma` + *Rehearsed* buff +5 (8 h) | 0…20 |
| **T** Entrance | vehicle (W-031) | +8 for the first 60 game min on a lot reached in a vehicle with *Tinted Windows* | 0…8 |
| **B** Rot stage | W-033 | Fresh +5 · Seasoned 0 · Vintage −5 · Legendary −10 | −10…5 |
| **Lm** Limbs | `limbs` | per `missing` 12 · per `prosthetic` 5 · per prosthetic with the *Lifelike* upgrade (W-029) 0 | 0…48 |
| **W** Wasting | DESIGN_SURVIVAL §1 | stage 1: 8 · stage 2: 16 | 0…16 |
| **X** Slip penalty | §2.5 | stored value, decays 5/h toward 0 | 0…40 |

The terms can add up to 118, so a fully prepared zombie clamps at 100. Reference points (normal difficulty):
- A fresh starter zombie who does nothing: freshness 80 (F 25.7), natural hair 6, hygiene ok (S 5), clothes 80 (C 8),
  charisma 2 (R 3), Fresh (B 5). That is **P ≈ 53**, *Passable in Dim Light*.
- The same zombie after a 25-minute routine (Drugstore makeup q2, *Rehearsed*, cologne) is at **P ≈ 76**, *Passing*.
- A Vintage zombie with charisma 6, a wig, Salon makeup q3, cologne, *Rehearsed* and freshness 90 is at **P = 100**.
- A neglected zombie with freshness 30, Reeking, one missing arm, tatters and no wig is at **P = 0**.

**Bands** (UI shows the band, never the number, except in the debug overlay):

| P | Band (UI label) | Icon |
|---|---|---|
| 0–19 | Obviously Undead | `skull` |
| 20–39 | Pale & Peaky | `sad` |
| 40–59 | Passable in Dim Light | `question` |
| 60–79 | Passing | `happy` |
| 80–100 | Positively Alive | `sparkle` |

**Halloween override** (W-034): from 17:00 to 02:00 on Halloween, every zombie wearing a costume has P = max(P, 85),
and no slips are rolled. Everyone is in costume, so nobody can tell.

### 2.2 What Passing does (gates and modifiers)

All gates use a new requirement `look_passingAtLeast {min}`, which fails with a player-facing reason
("Needs to look more alive (Passing)"). It is checked **when the interaction or event starts**. Later drops are handled
by slips (§2.5).

| Use | Threshold | Introduced by | Effect |
|---|---|---|---|
| Social modifier vs **warm (living) townies** | — | L3 Rot Row | success chance `+ (P − 50) / 250` (−0.20…+0.20), applied after the GDD §9 formula and before the clamp. Not applied between zombies |
| Romantic socials with warm townies (`social_flirt` and above) | 50 | L3 | gate |
| **Warm Date** (phone "Ask on a Date" to a warm partner/crush) | 50 | L3 | date venue + date score bonus `+(P−50)/5` |
| **Job Interview** event for *living-world* career levels (career level ≥ 3 of Politics and Retail, the public-facing tracks) | 60 | L3 (Necro-Tech office lobby) | the promotion needs a passed interview (Passing ≥ 60 at the interview, else retry after 2 days). Mortuary, Necro-Tech and Culinary are back-of-house and have **no** interview gate |
| Hilltop Museum **Gala Night** | 75 | L5 | event entry |
| **Country Crypt Club** membership interactions (golf, brunch, networking) | 70 | L5 | venue interactions |
| Holiday Parade float (W-034) | 60 | L3 | event role |
| Rot Row **Salon** "VIP Makeover" upsell | — | L3 | sells q3 makeup application |

Career performance bonus (living-facing tracks only: Politics, Retail): `+2 performance/day` when P ≥ 60 at departure
(shown as "Looked the part"). The −10 freshness complaint (GDD §10) is unchanged and stacks.

### 2.3 Mirror and vanity interactions

Every Look Alive interaction is **player-only by default** (`autonomous: false`). The exceptions are Vain zombies, and
any zombie with a Look-Alive event within 3 game h (date, interview, gala): for them the routine is autonomous with
`adBonus 3` and `traitAd {vain: 4}`. It is non-essential, so the GDD §14 daily cap (6) and the repetition penalty
apply. Unattended households (BALANCE scenario A) have no events and few Vain zombies, so their behaviour changes only
as much as an existing mirror hobby already does (§9).

| id | Label | Target | Duration (game min) | Cost / consumes | Effects | Anim (existing / **new**) |
|---|---|---|---|---|---|---|
| `look_practiseSmile` | Practise Smile | mirror / vanity `front` | 30 | — | charisma xp 30/h, fun +3/h; on complete *Rehearsed* (8 h, +5 R) | `admire` + expression `happy` |
| `look_rehearseSmallTalk` | Rehearse Small Talk | mirror / vanity | 30 | — | charisma xp 30/h; on complete `smallTalkCharges = 3` (each of the next 3 socials with a warm townie gets +0.10 success) | `talk` |
| `look_applyMakeup` | Apply Makeup | vanity, or mirror with a kit in the household | 20 (vanity 15) | 1 use from the best kit owned | sets makeup `{q, appliedTick}`, creativity xp 15/h; q = clamp(kitTier + floor(creativity/5) + (vanity ? 1 : 0), 1, 4) | **`applyMakeup`** (fallback `admire`) |
| `look_removeMakeup` | Wipe Off Makeup | sink / vanity | 3 | — | clears makeup | `washHands` |
| `look_fixWig` | Fix Wig | self (any mirror nearby improves it) | 5 (mirror 3) | — | wig askew → false; *Groomed* 8 h | **`adjustWig`** (fallback `admire`) |
| `look_combHair` | Comb Hair | mirror | 5 | — | natural hair: *Groomed* 8 h | **`adjustWig`** |
| `look_wearWig` / `look_removeWig` | Put On Wig… / Take Off Wig | wig stand, or the household wig box (UI) | 4 | wig from the household wardrobe | sets `wigId`; the renderer swaps the hair mesh | `admire` |
| `look_applyCologne` | Dab On Eau de Living | self | 2 | 1 use of a cologne bottle | `scentUntilTick = now + 6 h` | **`spray`** (fallback `washHands`) |
| `look_checkPassing` | How Do I Look? | mirror | 2 | — | bubble + notification with the band and the top 2 levers ("Fix your wig", "Freshen up") | `admire` |
| `look_mendClothes` | Mend Clothes | Stitch-n-Mend Table | 30 | 2 cloth (W-029) **or** $10 thread | outfit condition +50 (cap 100), stitch-free hint | `stitch` |
| `look_changeOutfit` | Change Outfit… | wardrobe (new) | 5 | — (owned outfits) | opens the outfit picker; a newly bought outfit starts at condition 100 | `admire` |

Mirrors that offer the routine are any object tagged `mirror` (the shipped `mirror_cracked`, `vanity_*`, `mirror_lookout`
is excluded, see photo-mode.md). The existing `Admire Decay`, `Practice Speech` and `Check Freshness` stay unchanged.

### 2.4 Decay of looks

| State | Rule |
|---|---|
| Makeup | fade per §2.1. Removed by: shower, ice bath, swimming, `look_removeMakeup`, a rain or snow block outdoors (halves the remaining q, rounded down; at 0 it is gone), crying (`cry` anim run ≥ 5 min: −1 q) |
| Wig askew | set by a slip (§2.5), by `exercise`/`dance` runs ≥ 30 min (25 %), and by wind ≥ strong outdoors (W-034, 10 %/h) |
| Outfit condition | −4 per game day worn (at midnight) · −20 on a limb loss · −10 per fire nearby · −15 per dig/salvage session ≥ 20 min · ×1.5 in rain outdoors |
| Cologne | expires at `scentUntilTick` |
| Slip penalty X | −5 per game hour (continuous: `X(t) = max(0, X₀ − 5·h)`) |

### 2.5 Slips (the comedy)

**When:** every game hour (at `tick % 240 == agentPhase`, where agentPhase = `hash32(agentId) % 240`, so zombies
are not checked in the same tick), for each household zombie who is awake, `onLot`, and in **public**. Public means
on any non-home lot, or on the home lot with ≥ 1 warm townie within 8 tiles. No slip is rolled within 2 game h of the
previous one, or while Halloween's override is active.

```
p = 0.03 × clamp(1 + (60 − P) / 30, 0.25, 3.0) × (clumsy ? 1.5 : 1) × (smallTalkCharges > 0 ? 0.8 : 1)
```
So P 90 gives 0.75 %/h, P 60 gives 3 %/h and P 0 gives 9 %/h. The draw comes from the Look Alive stream (§4.4).

**Which slip** (weighted, filtered by eligibility):

| Slip | Weight | Eligible when | Effect |
|---|---|---|---|
| Groan Escaped | 35 | always | X += 12; voice `groan`; bubble `exclamation` |
| Wig Slipped | 20 | wig worn | askew = true (H drops to 2) |
| Stitches Showing | 20 | `appearance.stitches` | X += 8 |
| A Fly Got Out | 15 | hygiene < 40 | X += 15; FX `flies` for 10 s |
| Wobbly Bit | 10 | preservation < 50 | the existing hourly limb-loss chance for this hour is ×2 (still rolled by `decay`); if a limb drops, X += 20 |

X caps at 40.

**Witnesses:** warm townies within 6 tiles who can see the slip get the reaction *Did You See That?* (anim `shocked`
expression, 3 s). The slipping zombie's player gets a **choice popup** (GDD choice system, auto-resolves to option 1
after 30 game min):
1. *Play it off* (charisma check `0.40 + 0.05 × charisma`, cap 0.90): success halves X, gives *Smooth Recovery*
   (+6, 3 h) and charisma xp 10. Failure gives *Mortified* (−8, 4 h) and friendship −2 with each witness.
2. *Own it* (always works): X unchanged, *Brave Face* (+3, 2 h). Witnesses with friendship ≥ 35 get +1 friendship
   ("refreshingly honest"). Others get friendship −1.

**Shown the door (no forced travel):** if P stays below the active venue's gate (§2.2) for 30 continuous game min
after a slip, the zombie becomes *Unwelcome* at that venue for the rest of the game day. Gated venue interactions are
unavailable, with the reason "The maître d' is pretending not to see you". This applies only to that zombie. The
household is not sent home (W-025 v1 rule: the household travels together).

### 2.6 Wigs, makeup kits, cologne and outfits (household wardrobe)

Owned looks live in the household **wardrobe** (`HouseholdState.lookAlive.wardrobe`), not as lot objects. They travel
with the household and survive lot swaps. Kits and cologne are **consumable stacks** with uses.

| id | Name | Kind | Tier | $ (sim) | Uses | Stat | Where to buy |
|---|---|---|---|---|---|---|---|
| `kit_drugstore` | Drugstore Face Kit | makeup kit | free | 40 | 10 | kitTier 1 | phone "Order Cosmetics" (arrives with the next mail delivery) or Rot Row Market |
| `kit_homebrew` | Homebrew Face Paint | makeup kit | free (crafted, W-029) | — | 8 | kitTier 2 | Embalming Station recipe |
| `kit_salon` | Salon Pro Palette | makeup kit | free | 120 | 10 | kitTier 2 | Rot Row Salon (L3) |
| `kit_glamGhoul` | Glam Ghoul Glitter Palette | makeup kit | **premium** 300 GG (small decor band) | 120 | 10 | kitTier 2 (same as Salon), gold-glitter look | store |
| `kit_moonlit` | Moonlit Contour Set | makeup kit | **bones** 180 | 120 | 10 | kitTier 2, cool-tone look | store |
| `cologne_living` | Eau de Living | cologne | free | 15 | 6 | — | phone / Market |
| `cologne_petrichor` | Petrichor No. 9 | cologne | bones 120 | 15 | 6 | same stat, rain-scent FX colour | store |
| `wig_*` × 12 | see below | wig | 4 free / 4 bones / 4 premium | 80 (free tier), 80 (others) | ∞ | +10 H (all wigs equal) | Salon / store / Sewing recipe |
| `outfit_*` | outfit presets (appearance top/bottom/colours) | outfit | free/bones/premium | 60 | ∞ | resets condition to 100 | wardrobe "Buy Outfit" (phone or Salon) |

The maximum makeup q is 4: kitTier 2 + creativity ≥ 5 (+1) + vanity (+1). Paid kits never exceed the best free kit.
Wigs (art names, original): free *Sensible Bob*, *Church-Social Perm*, *Office Side-Part*, *Grandpa's Toupee*. Bones:
*Bouffant Supreme*, *Beehive*, *Pompadour*, *Wavy Shag*. Premium: *Silver-Screen Waves*, *Rockabilly Quiff*,
*Mermaid Lengths*, *Powdered Periwig* (each premium wig 250 GG; a set of all four as *Hair-Raising Collection*
900 GG, sum-of-parts 1,000 GG shown).

### 2.7 Look Alive objects (catalog)

| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Env | Tris |
|---|---|---|---|---|---|---|---|---|
| `vanity_dressing` | Dead-Ringer Vanity | free, $450 | 2×1 floor, indoor | `mirror`, `vanity`, `makeup` | `sit` (stool, faces mirror) | all §2.3 routine; makeup 15 min; +1 q | +2 | ≤ 2,400 (bulb ring = `glow` node) |
| `vanity_hollywood` | Stage-Light Vanity | premium 450 GG (furniture band), $450 | 2×1 | same | same | same (identical stats) | +2 | ≤ 2,800 |
| `stand_wig` | Wig Stand Trio | free, $90 | 1×1 floor | `wig` | `front` | `look_wearWig`, `look_removeWig` | +1 | ≤ 900 (3 foam heads, wigs as shown on the household) |
| `wardrobe_creaky` | Creaky Wardrobe | free, $260 | 2×1 floor, indoor | `wardrobe` | `front` | `look_changeOutfit` | +1 | ≤ 1,800 (door node) |

`mirror_cracked` ($160) also gets the routine, without the vanity bonus.

## 3. Data model (additive contract changes)

```ts
// src/sim/types.ts — additive, all OPTIONAL (old saves load unchanged; created on first write)
export interface LookAliveAgentState {
  makeup: { q: 1 | 2 | 3 | 4; appliedTick: number } | null;
  wigId: string | null;          // wardrobe wig id worn
  wigAskew: boolean;
  groomedUntilTick: number;      // 0 = none
  scentUntilTick: number;
  rehearsedUntilTick: number;
  smallTalkCharges: number;      // 0..3
  outfitCondition: number;       // 0..100 (absent record ⇒ treated as 80)
  outfitId: string | null;       // wardrobe outfit preset; null = CAZ outfit
  slipX: number;                 // slip penalty at slipTick
  slipTick: number;
  lastSlipTick: number;          // -1 = never
  arrivalTintUntilTick: number;  // W-031 Entrance bonus
  unwelcome: { lotId: string; day: number } | null;
}
// AgentState gains:  lookAlive?: LookAliveAgentState;   living?: boolean  (true = warm townie; absent = undead)
// HouseholdState gains:
export interface WardrobeState {
  wigs: string[];                                 // owned wig ids
  outfits: string[];                              // owned outfit preset ids
  kits: { id: string; uses: number }[];           // makeup kits (stacks, uses > 0)
  colognes: { id: string; uses: number }[];
}
//   lookAlive?: { wardrobe: WardrobeState };
```

```ts
// src/sim/contracts.ts — additive
export interface LookAliveApi {
  passing(agentId: AgentId): number;                  // 0..100, pure
  passingBand(agentId: AgentId): 'undead' | 'peaky' | 'dim' | 'passing' | 'alive';
  levers(agentId: AgentId): { id: string; label: string; gain: number }[]; // top fixes, sorted by gain desc
}
// AgentSummary gains: passingBand?: ...; lookAlive?: { wig: string | null; makeupQ: number; outfitCondition: number }
// SimulationAPI gains: passing?(agentId): number   (engine delegates to sys('lookAlive'), like decayLevel)
// SimEvent gains:      | { type: 'slip'; agentId: AgentId; kind: 'groan'|'wig'|'stitches'|'fly'|'wobble'; witnesses: AgentId[] }
// Requirement id:      look_passingAtLeast { min: number }
// Effects:             look_setMakeup {q?}, look_setBuff {buff:'rehearsed'|'groomed'|'scent', hours}, look_mend {amount}
// Render: ZombieAppearance stays the save format; the renderer receives a derived LookView per agent:
export interface LookView { makeupQ: number; makeupFade: number; wigId: string | null; wigAskew: boolean; outfitWear: number /*0..1*/ }
```

- **System:** `lookAlive` (a SimSystem in a new `src/sim/systems/lookalive/` owned by a new SIM-LOOK module, or by
  SIM-PEOPLE, for the lead to decide). It owns the hourly slip check, midnight outfit wear, and the wardrobe.
- **Schema:** no `SAVE_SCHEMA_VERSION` bump needed. Every field is optional and lazily created on first write, which
  keeps decision #9 (repairWorld must be a no-op on healthy worlds). `repairWorld` clamps corrupt values
  (q ∉ 1..4 → null makeup; NaN ticks → 0; condition outside 0..100 → clamp; unknown wig ids → null) and warns only
  when it changed something.
- **Snapshots (W-025):** Look Alive agent state travels with the agent. The wardrobe is household-level (WorldState),
  never inside a lot snapshot. Catch-up applies makeup fade and outfit wear in closed form; slips are never replayed
  during catch-up.

## 4. Determinism

1. Passing is a pure function of (agent, lookAlive record, tick, rot stage, wasting, limbs). No RNG.
2. Slip rolls happen at fixed per-agent phase ticks only.
3. Wig-askew rolls from wind and exercise happen at run end / block start only.
4. **Separate RNG stream.** All Look Alive draws come from `ctx.stream('lookAlive')` (proposed
   `SimContext.stream(key): Rng`, see README §4 *Determinism*), derived from `(world.seed, key)` and stored in
   `WorldState.rngStreams?.lookAlive`. It never consumes `world.rng`. So a world that never uses Look Alive
   (no warm townies, no public slips) is **byte-identical** to the pre-feature build. The BALANCE seeds reproduce
   exactly (§9).
5. Choice auto-resolve uses the engine's existing tick-based choice timeout.

## 5. UI flows

- **Zombie panel → new "Looks" tab** (between Needs and Skills): a band chip with an icon and label, plus up to 5
  lever rows from `levers()` ("Fix your wig +8", "Freshen up +10", "Makeup has faded −6"), each with a *Do it*
  button that queues the matching interaction. Below that: wardrobe strips for wig, outfit and makeup, showing uses
  left. Keyboard: `L` opens the Looks tab for the selected zombie. Tab and Shift+Tab move through the rows, Enter
  activates. Screen reader: "Passing: Passable in Dim Light. Top fix: Fix your wig, plus 8".
- **Gate feedback:** a disabled venue interaction shows its reason and a "How do I look?" shortcut.
- **Slip toast:** "Mortimer groaned out loud at the gala!" A 1.5 s camera nudge toward the zombie, skipped when
  `reduceMotion` is on. The choice popup follows.
- **Portrait ring:** a thin outer ring in band colour, only on non-home lots (no clutter at home). Colourblind mode
  adds band glyphs.
- **Mirror routine macro:** right-click a mirror → **Get Ready** queues Fix Wig/Comb → Apply Makeup →
  Practise Smile → Cologne (total ≈ 57 min, or ≈ 52 min at a vanity), skipping steps that would add nothing.
  This is the "one click" flow for busy players.

## 6. Render needs

- **Makeup** (shader uniform per agent): blend the skin albedo toward a "living" warm tone `#d8b49a` by
  `0.12 × q × fade`. Add a cheek blush decal (vertex-colour region, existing face UVs) scaled by q. Fewer visible
  blotches: decay-blotch intensity × (1 − 0.15 × q × fade).
- **Wigs:** 12 wig meshes are hair-style meshes with a `wig` flag (≤ 1,200 tris each, in the character GLB's
  hidden-but-present variants budget: ART_DIRECTION character ≤ 14k total; the wigs go into a separate
  `wigs.glb` ≤ 15k total, loaded on demand). Askew = rotate the wig 12° on Z with a 3 cm offset.
- **Outfit wear:** `outfitWear` 0..1 adds frayed-edge alpha and darkened patches (material param on the existing
  top/bottom materials, swapped from immutable cached variants per decision #23, using 4 wear steps).
- **Slip FX:** `flies` (exists), a new `fx: 'shine'` (a small sparkle when the wig is fixed), and a `voice` groan.
- No new draw calls beyond the wig mesh (one per zombie wearing a wig).

## 7. Audio needs

New SFX ids: `makeupDab` (soft brush pats), `colognePuff` (atomiser), `wigShuffle` (fabric rustle), `crowdGasp`
(3–5 voice murmur, used on slips with ≥ 2 witnesses), `recordScratch` (comic sting, *Mortified* only, max 1 per
game hour). The existing `mirrorShimmer` plays on routine start.

## 8. Store tie-ins (cosmetic only)

- Kits, wigs, colognes, outfits and vanities in the premium/bones tiers have **identical stats** to their free
  equivalents (§2.6). A unit test enforces it: for every premium or bones look item, its gameplay stats are ≤ the
  free-tier maximum of its kind.
- Bundles: *Dead Gorgeous* themed set: Stage-Light Vanity + Glam Ghoul palette + 4 premium wigs + 2 outfits
  (8 items, 1,500 GG, sum of parts 1,950 GG shown).
- Entitlement ≠ world item: owning a premium wig unlocks it in the Salon and wardrobe picker. Adding it to the
  household wardrobe still costs $80 in-sim (MONETIZATION §1).

## 9. Balance (BALANCE.md targets stay valid)

- **No new need restores.** The only need effects are fun +3/h (Practise Smile, below every shipped fun source) and
  hygiene effects from existing interactions.
- **Autonomy unchanged for unattended households:** player-only by default, with autonomy only for Vain zombies or
  before events (none exist in scenarios A–D). `adBonus 3` sits inside the shipped hobby band (2–4).
- **Money:** the career bonus applies only to Politics and Retail at P ≥ 60, which needs player effort (makeup). It
  can only raise funds, and the targets are lower bounds. Interview gates apply only at career level ≥ 3 of those two
  tracks. BALANCE scenario Bc's "reasonable player" never promotes past L2 within 21 days on those tracks (measured
  max L2), so Bc is unaffected. If a future rerun shows L3 reached, the harness player gets a scripted Get Ready
  before the interview (add to `tests/balance/harness.ts`).
- **Stream isolation (§4.4)** makes scenarios A–D byte-identical while no warm townie is present. Warm townies arrive
  with L3 and never visit the home lot in scenarios A–D.
- **Required check:** `npm run balance` before merge. Add a scenario **LA** to the harness: B plus a daily Get Ready,
  21 days. Targets: funds trend ≥ B's, the Amusement and freshness targets unchanged, and the Look Alive routine
  ≤ 12 % of waking time.

## 10. Interplay with levels

| Level | What it adds to Look Alive |
|---|---|
| L1 Wormwood | Mirror routine, Drugstore kit, cologne, wardrobe, wig stand (free). Tutorial quest `story_ww_firstImpressions` ("Get Ready" once, 60 Bones) |
| L2 Graveyard | Digging and grave work wear outfits (−15). Night séance: no Passing gates (everyone there is dead) |
| L3 Rot Row | **Introduces warm townies + slips + gates.** Salon (makeovers, wigs, outfits, kits), Necro-Tech lobby interviews, Market cosmetics counter |
| L4 Bayou | Humidity: makeup fades from 4 h instead of 6 h outdoors. Mosquitoes count as flies for the *A Fly Got Out* slip |
| L5 Mausoleum Hills | Country Crypt Club (70), Gala (75), the high-end vanity |
| L6 Underneath | No gates (underground undead community). Fully dark tiles hide makeup fade (render only) |
| L7 Necropolis | Photo gallery "Glow-Up" category; blueprints can include vanities |

## 11. Edge cases

- **Bald zombie with no wig:** H = 0 is valid. The lever list suggests a wig.
- **Two arms missing:** cannot `applyMakeup`/`fixWig` themselves (GDD −2 arms rule). A housemate can do
  `look_applyMakeupOn` (Friendly, target agent, 20 min, same q rules using the actor's creativity), which also gives
  friendship +3.
- **Kit runs out mid-run:** the use is consumed at stage start. If no kit is left, the run fails with "Out of makeup".
- **Wig worn by someone who crumbles:** the wig returns to the wardrobe. The bone pile shows no wig.
- **Turned townie (W-033):** a turned townie gains `lookAlive` fields lazily. A warm townie's `living: true` flips to
  absent/false.
- **Shower during makeup run:** not possible (one run at a time). Queue order is respected.
- **Slip while sitting or sleeping:** asleep zombies are skipped. Sitting zombies roll normally (Groan Escaped is the
  funniest at a dinner table).
- **Clock rollback / journal replay (W-004):** pure tick math, so replays are exact.
- **NaN or corrupt record:** repair clamps it (§3). `passing()` returns 0 for missing or crumbled agents and never
  throws.
- **Visitors and townies:** Passing is computed for household zombies only. Undead townies have no slips.
- **Halloween at a venue with a gate:** the override applies, so a costumed zombie meets the gate.

## 12. Acceptance tests

Unit (`tests/unit/lookalive/**`):
1. Formula table: 40 hand-computed fixtures, including every term's boundaries (pres 20/90, hygiene 0/29/30/59/60,
   charisma 0/10, all limb combinations, wasting 0/1/2, every band edge 19/20/39/40/59/60/79/80) → exact P.
2. Fade: makeup at +0 h, +6 h, +8 h, +10 h, +11 h gives 1, 1, 0.5, 0, 0.
3. Adversarial records: NaN ticks, q = 7, negative uses, an unknown wig id, `lookAlive: "garbage"`. `passing()` is
   finite and repair warns exactly once. A second repair warns 0 times.
4. Cosmetic parity: for every catalogued look item, tier ≠ free implies its stats are ≤ the max free stat of its kind.
5. Slip probability: 100,000 seeded rolls per P bucket stay within ±0.2 percentage points of the formula. No slip
   within 2 h of the last one. Halloween gives 0 slips.
6. Gate requirement: the reason string is shown, and a gated interaction never starts below the threshold
   (property test over 1,000 random agents).

Integration (real engine):
7. **Determinism:** a 3-day run with warm townies and the Get Ready macro, compared against a save → load at a
   random tick → continue. `serialize` is deep-equal. Journal replay (W-004) of the same commands is byte-identical.
8. **Isolation:** BALANCE seeds 11/22/33 scenario A for 3 days with the Look Alive system registered, compared
   against the same build with it unregistered: byte-identical `WorldState` (the stream is never touched).
9. Wardrobe across travel: home → Rot Row → home keeps the wig, makeup fade and kit uses exactly. Catch-up applied
   twice equals once.
10. Choice auto-resolve after 30 game min picks option 1. A save during an open choice restores it.

Perf: `passing()` × 8 agents × 60 calls per frame (UI) < 0.05 ms in total on the CI box. The hourly slip pass for
8 agents < 0.02 ms.

## References

- The Sims 4 skill structure (levels 1–10, objects that train skills) is common life-sim practice. This system reuses
  only the generic "mirror trains a social skill" mechanic, already shipped as GDD §7 charisma 30 xp/h.
- FTC v. Cognosphere (Jan 2025) and EU CPC key principles on virtual currencies (Mar 2025), via MONETIZATION §1. They
  are the reason for the no-paid-power and price-transparency rules in §8.
- The comic "trying to pass as human" premise is a general trope. All names, items and slips here are original.
