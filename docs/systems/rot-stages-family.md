# W-033 Rot Stages and the undead family: turning townies, weddings, house guests, rivals, family trees

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_PILLARS §A ("life arc without ageing"), GDD
§4 (decay, vitality, crumbling), §8 (traits), §9 (social table, household cap 8, elope/moveIn outcomes), §11 (visitors,
parties), §12 (aspirations), §14 (autonomy, daily cap), BALANCE.md, look-alive.md (warm townies, Passing),
E10+ constraints (DESIGN_SURVIVAL_PETS_SAVES header; no biting on screen as a means of "turning").

## 1. Player fantasy

*"Grandpa Mort has been dead for ninety days. He's Legendary now: the neighbours ask for his autograph, he's the head
of a family tree of five zombies he personally welcomed to the afterlife, and he's officiating his granddaughter's
wedding under a bone arch."* Zombies don't age. The life arc comes from **how long you've lasted** (Rot Stages) and
**who you've gathered** (turning willing townies, marrying, hosting guests, keeping rivals).

## 2. Rot Stages

### 2.1 Stage by undead days
`undeadDays` counts full game days an agent has existed as household zombie and not crumbled. It increments at 00:00
for each household member with presence ∉ {crumbled, gone}. Starting zombies begin at 0. Turned townies begin at 0.

| Stage | undeadDays | Badge |
|---|---|---|
| **Fresh** | 0–13 | a small green sprout on the portrait frame |
| **Seasoned** | 14–41 | a salt-and-pepper frame |
| **Vintage** | 42–89 | a brass frame |
| **Legendary** | 90+ | a gilded frame with a tiny crown of moss |

With 7-day seasons (W-034, year = 28 days): Seasoned at the start of year 1's Winter, Vintage at mid year 2, Legendary
in the 4th year.

### 2.2 Stage effects (never touch need decay)
The decay economy and the BALANCE targets live on needs. **Rot Stages do not change any need rate, vitality erosion or
limb-loss chance.** Their effects are social, cosmetic and progression only, plus a single safety-net perk (vitality
floor) that only ever helps.

| Stage | Effects |
|---|---|
| Fresh | Look Alive B +5 (look-alive.md); skill xp ×1.10 ("eager learner"); moodlet on stage day: none |
| Seasoned | B 0; unlocks social `rot_shareWisdom` (teach: target gains 15 xp in the actor's best skill ≥ 3, once per pair per day); *Seasoned* (+8, 24 h) on the stage day |
| Vintage | B −5; mortuary xp ×1.10; zombie townies' friendship gains with this zombie ×1.15 ("respect your elders"); vitality floor 25 (GDD min 20); *Vintage Year* (+10, 24 h) |
| Legendary | B −10; aspiration points +10 per game day; zombie townies get *Starstruck* (+5, 2 h) the first time each day they meet this zombie; vitality floor **30**; unlocks *Living Legend* reward trait purchase (900 pts: social success +10 % with zombies, stacks with silverTongue cap 0.95); *Legendary!* (+15, 48 h); notification + confetti FX |

- **Vitality floor:** `vitality = max(vitality, floor)` when erosion would go below the floor. This only raises the
  floor (GDD says vitality ∈ [20, 100]), so scenarios can only get easier. Scenarios run ≤ 21 days, which is below
  Vintage (42), so no BALANCE target sees it anyway.
- **Rotiversary:** every 28 undead days, the zombie gets *Rotiversary* (+6, 24 h), and the phone offers "Throw a
  Rotiversary Party" (a party variant: party score +10 with ≥ 3 guests). Stage days double as Rotiversaries.
- **Reanimation** (GDD §4) keeps `undeadDays` (the bone-pile days don't count). *Back From the Dead* stays as is.

### 2.3 Look (render)
`rotStage` is passed to the rig as 0..3:
- 0 (Fresh): as today.
- 1 (Seasoned): +1 stitch seam set, slightly greyer skin (−4 % saturation).
- 2 (Vintage): a patch on the clothes, greyer skin (−8 %), a distinguished slouch on the idle (`idle` blend weight).
- 3 (Legendary): tiny moss tufts on the shoulders (an extra mesh ≤ 300 tris, `Moss` material), a faint dust-motes
  particle when idle (Low: off).

It is purely additive to the appearance and never stored in `ZombieAppearance`.

## 3. Turning willing townies (household growth)

E10+ rule: **turning is a consensual, cosy ceremony, never an attack.** There is no biting, no chasing and no
infection. Only **warm (living) townies** (`AgentState.living === true`, introduced with L3, look-alive.md) can be
turned, and only after they say yes.

### 3.1 Flow
1. **Pitch the Afterlife** `social_pitchAfterlife` (Friendly). Gate: actor is household, target is a warm townie,
   friendship ≥ 60, target not Squeamish-and-friendship < 80, target not already *Willing*. Base 0.35 + GDD §9
   modifiers + Look Alive warm modifier (`(P−50)/250`). Social +8 on success. Friendship +4 on success / −3 on fail.
   Success sets the target's flag `willing` for **3 game days** (`AgentState.family.willingUntilTick`). The target
   shows a speech bubble `heart` + `skull`. Success line (flavour): *"No rent increases? No dentist? …I'm in."*
2. **The Turning** `rot_turnTownie` (household zombie → the willing townie, both present on the **home lot**, at the
   Embalming Station; pair interaction: the target lies on the slab with `beEmbalmed`, the actor works with `embalm`).
   Duration 60 min. Cost $30 (the embalming fluid price of GDD §4). Actor mortuary ≥ 2. Household size < 8.
   Success chance `0.6 + 0.05 × mortuary` (cap 0.95). The ritual flavour is a "spa treatment": the formaldehyde
   facial, a pinch of grave dust, a lullaby. FX `reanimate` (exists). On success:
   - The target joins the household (reuse the social system's `moveIn` path): `role 'household'`, `living` cleared,
     appearance converted (`skinTone` = nearest of SKIN_TONES to their living tone by hue; `stitches: true`), traits
     kept, a random aspiration (player can change it in the first 24 h, existing rule), needs: preservation 90,
     vitality 95, others kept, `undeadDays 0`, `family.sireId = actor`, `family.turnedTick = now`.
   - Moodlets: target *Welcome to the Afterlife* (+20, 48 h); actor *Proud Sire* (+12, 24 h); every household member
     *New Family Member* (+8, 24 h).
   - The friendship pair stays. A new **sire** relation flag is set (§6).
   
   On failure: *Tickled Instead* (the target giggled off the slab): target fun +10, actor *Butterfingers* (exists).
   Willing stays, and they can retry after 4 game hours.
3. **Pool upkeep:** each level's warm-townie pool is seeded (levels docs). When one is turned, a replacement warm
   townie is generated deterministically from `(worldSeed, levelId, turnedCount)` and moves into town after **3 game
   days** (a notification "A new face moved to Rot Row").

### 3.2 Limits
At most 1 Turning per household per game day. Household cap 8 (GDD §9). Townies never turn autonomously, and no
autonomy picks `social_pitchAfterlife` (`autonomous: false`).

## 4. Weddings

The GDD has elope (`social_elope`, an instant marriage). Weddings add a planned event.

- **Plan a Wedding** (phone → *Plan a Wedding…*, needs an engaged pair with ≥ 1 household member): choose the date (1–7
  game days ahead, 10:00–20:00 start), the venue (home lot, or a venue lot with a ceremony spot: Fancy Funeral Parlor
  L5, Old Graveyard chapel L2 at night, Corner Park L1), up to 8 guests (known townies), and the officiant (any
  household member or a Seasoned+ zombie townie friend; Legendary officiants give +10 to the wedding score).
- **Cost:** home $200 (cake + flowers); venue lots $600 (venue fee). Charged at planning, refunded 50 % if cancelled
  ≥ 24 h before (idempotency `wedding:<id>`).
- **The day:** guests arrive at the start time (existing party arrival logic), a party runs 4 h (existing party
  system, kind `wedding`). The key step is **Exchange Vows** `rot_exchangeVows` (pair, 15 min, at a `wedding`-tagged
  object: `arch_wedding`, or the venue's spot), with the officiant standing at the front (`talk`). Outcome `marry`
  (existing flags married; *Newlyweds* +20, 3 days, GDD §9). Then *Cut the Cake* (group, 10 min, a `cake_wedding`
  meal item: 12 servings, hunger 50/serving, quality 4).
- **Wedding score** = party score (GDD §11) + 10 (Legendary officiant) + 5 per Seasoned+ household guest + 10 if
  vows happened before 2 h. Score ≥ 80: *Till Death… Again* (+25, 3 days) for the couple and +5 friendship with every
  guest. Score ≤ 30: *Awkward Reception* (−8, 24 h).
- **Objects:** `arch_wedding` Bone-and-Lace Arch (free, $300; or crafted W-029), 2×1 floor, outdoor or indoor,
  tags `wedding`, env +2, ≤ 2,200 tris. `cake_wedding` (item, 3-tier "Red Velvet Cerebellum", ≤ 900 tris).

## 5. House guests

- **Invite to Stay Over** (phone, or social `rot_inviteStay`, friendship ≥ 40, target a townie): the guest stays **1–3
  nights** (chosen) on the home lot. At most 1 guest at a time. They count toward the lot's agent cap (8 household +
  guests ≤ the levels README's 21).
- Guest behaviour: visitor-allowed interactions **plus** sleep (any free bed/coffin/sofa; never the household's
  assigned coffin when a member needs it: guest priority is lowest), eat (household food, leftovers), shower.
  Arrival at 17:00, departure at 10:00 on the last day. Friendship +2/day with each household member they interacted
  with that day.
- Costs: guests consume food like a member (leftovers/servings). There is no $ fee.
- *Good Host* (+6, 24 h) on departure if the guest's mood stayed ≥ fine. A bad stay (miserable for ≥ 6 h) makes the
  guest leave early, with friendship −10.
- E10+ note: guests are adult townies; no overnight romance content beyond the existing socials.

## 6. Rivals

- A **rivalry** is a player-declared feud: social `rot_declareRivalry` (Mean, gate friendship ≤ −35, player-only).
  It sets the pair flag `rivals`. Rivalries **never start autonomously**, because unattended mean socials (Hothead,
  Grumpy) must not trigger pranks in BALANCE scenarios.
- **Pranks** (only while `rivals` and the rival is a townie; at night 22:00–04:00 on the home lot; chance 2 % per
  hour, from the family RNG stream; max 1 per 3 game days):

| Prank | Effect | Clean-up |
|---|---|---|
| TP the Tree | `item_tp` streamers on the yard tree (env −1 outdoors) | `rot_cleanPrank` 15 min, autonomous adBonus 12 (chore band) |
| Gnome Swap | a garish `decor_gnome` (value 0, not sellable for money, env −1) appears | same; or keep it (it's ugly but yours) |
| Doorbell Ditch | `doorbell` sfx; no need effect (sleepers don't wake, nothing changes) | — |
| Mailbox Glitter | mailbox flagged "glittered" (cosmetic sparkle); next mail has a glitter-bomb flavour letter | — |

- **Revenge** (player-only): `rot_prankBack` on a rival at their venue/lot (requires travel): 30 min, fun +20/h,
  *Got Them Back* (+10, 12 h); the rival's next prank chance +2 %.
- **Truce:** `rot_offerTruce` (Friendly, base 0.4 + modifiers): clears `rivals`, friendship +15, both get
  *Water Under the Bridge* (+6, 24 h).
- Aspiration hook: optional new milestone pack later. No GDD aspiration change in v1.

## 7. Family tree

- Data: `AgentState.family?: { sireId?: AgentId; turnedTick?: number; willingUntilTick?: number }`. The relationship
  flags (married, partners, engaged, bestFriends, rivals) already live per pair. Pets (W-013) add `ownerIds`.
- **Family Tree screen** (household panel → *Family*): a node graph, rendered in SVG with no layout library.
  Generations = sire depth (founders at the top, the zombies they turned below). Spouses side by side with a ring
  icon. Pets as small nodes beside their owners. Each node shows the portrait, name, rot stage badge, undead days,
  and status chips (crumbled = urn icon, moved out = faded). Ex-household members stay as faded nodes.
- Keyboard: arrows move between nodes (tree order), Enter opens that zombie's panel, Escape closes. The screen-reader
  list view is "Mortimer Graves, Legendary, 94 days. Sire of: Gravella, Ezra. Married to: Opal."
- Max 64 nodes shown (household ≤ 8, plus history ≤ 56). Older history beyond 64 is collapsed into "+N more".

## 8. Data model (additive)

```ts
// src/sim/types.ts
// AgentState gains:
//   undeadDays?: number;                                  // absent ⇒ 0
//   living?: boolean;                                     // warm townie (look-alive.md)
//   family?: { sireId?: AgentId; turnedTick?: number; willingUntilTick?: number };
// Relationship gains: rivals?: boolean; rivalSinceTick?: number
// WorldState gains:
export interface FamilyState {
  weddings: { id: string; couple: [AgentId, AgentId]; lotId: string; startTick: number; guests: AgentId[];
              officiantId: AgentId | null; paid: number; status: 'planned' | 'live' | 'done' | 'cancelled' }[];
  guest: { agentId: AgentId; untilTick: number } | null;
  turnedCount: Record<string /* levelId */, number>;
  lastTurningDay: number | null;
  lastPrankTick: number | null;
  history: { agentId: AgentId; name: string; leftTick: number; reason: 'crumbled' | 'gone' | 'movedOut' }[]; // ≤ 56
}
//   family?: FamilyState;

// src/sim/contracts.ts
// AgentSummary gains: rotStage?: 0 | 1 | 2 | 3; undeadDays?: number
// SimulationAPI gains: familyTree?(): FamilyTreeView
export interface FamilyTreeView { nodes: { id: AgentId; name: string; rotStage: number; undeadDays: number;
  status: 'household' | 'townie' | 'crumbled' | 'gone' | 'movedOut' | 'pet'; sireId?: AgentId }[];
  edges: { a: AgentId; b: AgentId; kind: 'sire' | 'married' | 'partners' | 'engaged' | 'rivals' | 'pet' }[] }
// SocialDef.outcome gains: 'pitchAfterlife' | 'declareRivalry' | 'truce' | 'turn' (system-handled)
// PartyState gains: kind?: 'party' | 'wedding' | 'rotiversary'; weddingId?: string
// Requirements: rot_isWarm, rot_isWilling, rot_householdHasRoom, rot_notTurnedToday; Effects: rot_turn, rot_setRival
// Moodlets: seasoned, vintageYear, legendary, starstruck, rotiversary, welcomeToTheAfterlife, proudSire,
//           newFamilyMember, tickledInstead, tillDeathAgain, awkwardReception, goodHost, gotThemBack, waterUnderTheBridge
```
- **Stage is derived:** `rotStage = undeadDays ≥ 90 ? 3 : ≥ 42 ? 2 : ≥ 14 ? 1 : 0`. Only `undeadDays` is stored.
- **Schema:** optional fields, no bump. Old saves: `undeadDays` is absent and reads as 0. **Migration choice** (open
  question Q-R1): for an existing save, set `undeadDays = floor((tick − createdTick) / 5760)` on first midnight
  instead of 0, so long-running households get credit. Recommended yes, done lazily at the first midnight (not in
  repair, to keep decision #9).
- **Determinism:** pranks and Turning success rolls use `ctx.stream('family')`. Stage changes happen at midnight
  (tick-aligned). Wedding events are keyed by wedding id.

## 9. UI flows

- Portrait frame shows the stage badge, and the tooltip reads "Vintage — 57 days undead". On stage-up day a toast and
  confetti appear (skipped with reduce motion).
- Phone: *Plan a Wedding…* (a 3-step dialog: date → venue → guests/officiant, with cost and a summary; keyboard and
  screen-reader complete), *Invite to Stay Over…*, *Throw a Rotiversary Party*.
- Social menu groups: *Pitch the Afterlife* under Friendly (only on warm townies with the gate shown as a reason),
  *Declare Rivalry* under Mean.
- Household panel → **Family** tab: the tree (§7).

## 10. Render needs

- Rot-stage rig params (§2.3): moss mesh (≤ 300 tris), stitch-set variant toggles, saturation uniform.
- `arch_wedding`, `cake_wedding`, `decor_gnome` (≤ 700), `item_tp` (streamers on a tree: ≤ 600, `flag` nodes sway).
- Turning FX: reuse `reanimate` + `sparkle`. Wedding: `confetti` (exists) + a new `petals` FX kind.
- New anim clips: **`vows`** (hold hands, facing; fallback `talk`), **`officiate`** (book open, gesture; fallback
  `read`), **`prank`** (tiptoe + throw; fallback `wave`).

## 11. Audio needs

New SFX: `weddingBells` (warped, cheerful), `organSting` (short), `vowsAww` (crowd sigh), `prankGiggle`,
`tpRustle`. Music: a `romance` mood variant "wedding waltz" for the `mus_*` themes (AUDIO composer can derive it).

## 12. Store tie-ins (cosmetic only)

*Eternal Vows* set (premium 1,500 GG, sum-of-parts shown): an ornate arch skin, 2 wedding outfits, a cake skin,
bouquet decor, 4 photo frames (W-028). Rot-stage frames for portraits (bones, cosmetic). **Never sold:** undead
days, stages, turning success or extra household slots beyond the MONETIZATION-listed "+1 household slot" boost.
That boost raises the **number of saved households/worlds**, not the 8-member cap; this doc keeps the in-world cap at
8. The lead should confirm the boost's meaning (open question Q-R2).

## 13. Balance (BALANCE.md stays valid)

- Stage effects never touch need rates. Skill xp ×1.10 (Fresh, the first 14 days) **does** apply in scenarios A–D. It
  speeds skills slightly. Effects: careers promote a little sooner (funds trends can only rise) and cooking quality
  rises sooner (fewer fires). Both help the targets, but the BALANCE numbers will **change** (not byte-identical).
  **Required:** rerun `npm run balance`; the targets must hold (expected to). If the lead prefers byte-identical
  baselines, set Fresh xp ×1.00 (option documented in Q-R3).
- Turning, weddings, guests and rivals are all player-initiated (`autonomous: false`) and use their own RNG stream, so
  A–D never trigger them.
- Vitality floors (Vintage/Legendary) occur after day 41, beyond every scenario.
- **New scenario `F`** (60 days, reasonable player + 1 wedding + 1 turning + 1 guest stay; needs L3 warm townies): no
  crumbles, funds trend ≥ 0 after day 7, stage transitions on days 14 and 42 exactly.

## 14. Interplay with levels

| Level | Adds |
|---|---|
| L1 | Rot stages, Rotiversaries, house guests (zombie townies), rivals, wedding at home or the Corner Park |
| L2 | Night weddings at the Graveyard chapel; Legendary zombies get a respectful honour plaque interaction at the memorial (fun +6/h) |
| L3 | **Warm townies → turning**, Pitch the Afterlife; Salon wedding makeovers |
| L5 | Fancy Funeral Parlor wedding venue; Legendary zombies get Country Club honorary membership (Passing gate −10 for them) |
| L7 | Family trees exported with blueprints (names only, no PII); a Necropolis "Founders' Wall" lists Legendary zombies |

## 15. Edge cases

- **Turning target leaves the lot mid-ritual:** pair interaction cancelled, $30 not charged (charged at the start of
  the run stage, idempotent; refunded if cancelled before the run stage completes 1 minute).
- **Household at 8 during a planned Turning:** the requirement fails at queue time with "The house is full (8)".
- **Sire crumbles/gone:** the family tree keeps the edge, and the node shows an urn.
- **Wedding couple member crumbles before the date:** the wedding is cancelled with a full refund and a sad
  notification.
- **Guest present when the household travels:** the guest leaves at departure (the stay ends early with no penalty).
- **Rival moves away** (townie pool churn): the rivalry is cleared silently.
- **undeadDays overflow/NaN:** clamp to 0..100,000 and warn on repair.
- **Halloween wedding:** allowed, with costumes on (W-034); the score gets +5 "themed".

## 16. Acceptance tests

1. Stage boundaries: undeadDays 13/14/41/42/89/90 → stages 0/1/1/2/2/3. Increments only at 00:00 and only for
   eligible presences. Crumbled days don't count. A save at 23:59:45 → load → midnight increments exactly once.
2. Turning: gates (friendship, warm, willing, household room, mortuary, once per day). A success converts the agent
   with exactly the listed fields (deep diff). Failure keeps `willing`. Determinism across save/load mid-ritual.
3. E10+ content check: no `bite` outcome and no `feral` anim used by any turning/rival interaction (content lint).
4. Wedding: plan → cancel (50 % refund once, idempotent across reloads) → plan → day → vows → `married`. A crumble
   before the date refunds in full.
5. Guests: the sleep priority never takes the coffin of a household member below Rest 40. Departure on time. The
   early-leave rule.
6. Rivals: no prank without the player-declared flag; ≤ 1 prank per 3 days; a scenario A run of 14 days has 0 pranks
   (assert).
7. Balance rerun (§13) with the targets held. **Isolation** for turning/wedding/guest/rival code paths: an A run with
   the family stream unused is byte-identical when Fresh xp is set to ×1.00.
8. Family tree view: 64-node cap, cycle-proof (a corrupt sireId loop A→B→A renders without hanging; repair breaks the
   loop and warns).
9. Perf: `familyTree()` with 64 nodes < 0.5 ms. Midnight stage pass for 8 agents < 0.05 ms.

## References

- Life-sim "generations" are usually driven by ageing and births. This design replaces them with survival time and
  consensual recruitment, an original framing that fits zombies and the E10+ rating.
- GDD §9 (`moveIn`, `elope`/`marry` outcomes) and §11 (parties) are reused, so this is mostly new content on existing
  systems.
