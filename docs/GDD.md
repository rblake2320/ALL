# Afterlife Lease — Game Design Document (v1.0 ship scope)

> *Death didn't get you out of paying rent.*

A domestic life simulator where **you play the zombies**. No survival shooter: you manage a household of the undead
living ordinary lives in the town of **Wormwood Heights** — jobs, bills, dinner parties, romance, home décor —
where being a zombie changes how every one of those things works. The core twist is the **decay economy**:
the Preservation need never fully resets, and keeping your zombies fresh competes with every other expense.

Working title. The genre (life sim) and mechanics are generic; every name, character, UI, sound and art asset is original.
Never reference or imitate any existing franchise's trade dress (no diamonds over heads, no "Simlish", no copied UI layouts).

---

## 1. Pillars
1. **Mundane undead** — ordinary domestic life, made absurd by being dead.
2. **Decay economy** — Preservation + Vitality create long-term tension and spending decisions.
3. **Emergent comedy** — autonomous zombies + interconnected systems produce stories (an arm falls off at the dinner party).
4. **Build & decorate** — walls, rooms, paint, floors, and ~60 objects to furnish a home.

## 2. Time
- 1 tick = 0.25 game minutes. Speeds: pause, 1× (1 game-min/sec), 2× (3), 3× (8), ultra (30; auto-allowed when every household zombie is asleep or at work).
- Day 1 is a Monday, clock starts 9:00 AM. Night = 20:00–06:00. Full moon on the night of every 7th day (moodlet *Moonstruck*).

## 3. Needs (0–100; higher = better)
| Need | Label in UI | Base decay /h (awake) | Main restores |
|---|---|---|---|
| hunger | Appetite | −5.5 | meals, snacks, leftovers, pizza |
| energy | Rest | −5.0 (asleep: restore) | coffins/beds/plots, naps, espresso |
| preservation | Freshness | −1.3 (see §4) | refrigerated coffin, ice bath, embalming, preservative spray |
| social | Company | −4.0 | social interactions, parties, work |
| fun | Amusement | −4.5 | TV, games, dancing, hobbies |
| hygiene | Odor Control | −3.5 | shower, ice bath, wash hands |

- Difficulty multipliers on decay: relaxed 0.7, normal 1.0, grim 1.3 (preservation uses relaxed 0.6 / grim 1.4).
- **While asleep** (any sleep — coffin, bed, plot, sofa nap, passed out on the floor) the other needs slow down:
  hunger ×0.5, social ×0.3, fun ×0.3, hygiene ×0.5 of the awake rates above (energy restores instead; preservation
  follows the bed's sleep multiplier, §4). Walking to bed or waking up is awake.
- **Amusement sources (balance pass):** Watch TV +20/h (was 14), Read +11/h (was 8), both stop at 98. A day-job
  worker's daily Amusement bill is ~60 (awake on the lot ~5.4/h for a Party Animal, −2/h at work, ×0.3 overnight) and
  their on-lot waking window is ~6 h around meals and showers; at +14/h the TV (net +8.6/h) could not refill it, so a
  Party Animal Necro-Tech worker went to bed at Amusement ~14 and woke at 0 (11.8 % of on-lot hours < 15) and spent
  28 % of their waking time in front of the TV. At +20/h it is 0 % and ≤ 20 %.
- **Critical** = value ≤ 15. At **hunger ≤ 5** the zombie goes *feral* (autonomy overrides queue to find food; with no reachable food it may *nibble* a nearby zombie — hidden social "Feral Nibble": friendship −20 (−12 if dodged) for the pair, target freshness −3 and *Chewed On* (−14, 8h), biter appetite +12 and *Bit the Hand That Feeds* (−6, 6h), at most one bite per 3 game hours). At **energy 0** the zombie collapses asleep on the floor (energy +6/h, moodlet *Slept on the Floor*).
- **Hygiene 0** → *Reeking*: fly swarm FX, nearby zombies get *Stench Nearby* (−10) unless Slob; social success −25%.
- Mood: per-need contribution `c(v) = v>=50 ? (v-50)/50*W : -((50-v)/50)^1.4 * W * 1.6` with W: hunger 14, energy 12, preservation 14, social 10, fun 10, hygiene 8. Plus moodlets, trait baseMood, room environment (−8..+8). Clamp −100..100.
  Bands: ≤ −50 *Miserable*, ≤ −15 *Uneasy*, < 15 *Fine*, < 50 *Good*, ≥ 50 *Great* (UI label "Undead and Loving It").

## 4. Decay economy (systems/decay)
- `preservation ∈ [0, vitality]`, `vitality ∈ [20, 100]` (starts 100; starting zombies may roll 90–100).
- Preservation decay /h: 1.3 base; +0.6 if hygiene < 20; +1.0 if hunger < 10; ×0.5 while asleep in any coffin (×0 in refrigerated/cryo); ×1.5 while exercising/dancing; outdoors in daytime sun ×1.2.
- Vitality erodes 0.6/day at 00:00, plus 0.25 per hour spent with preservation < 15 (so neglect is permanent-ish).
- Restores (all capped by vitality):
  - Pine coffin sleep: preservation decay halted. Chill-Rest coffin: +4/h (needs power). Cryo Sarcophagus: +5/h and **vitality +2 per full sleep (≥6h)**, max 100.
  - **Chill Out** (awake, in a Chill-Rest coffin or Cryo Sarcophagus, 60 min, needs power): +10/h (net +8.7/h on normal after awake decay). Autonomy only below Freshness 40 (urgency grows as it falls). Balance review round 2: zombie sleeps are 3–5 h, so the starter's one refrigerated coffin stood empty ~18 h a day; when a kitchen fire took the fridge (no more spray), an unattended 3-zombie household had no daytime freshness source and rotted (skeptic seed 3001: 30 % of stay-home hours below 15, a crumble on day 13).
  - Ice Bath: +22 over 45 min, hygiene +60, fun −10 (cold), needs power.
  - Self-Embalm at station: +45 over 90 min, costs $30 fluid, mortuary xp; effect × (0.7 + 0.06 × mortuary level). Embalm Other: +60 to target, costs $30, needs actor mortuary ≥ 2. (Balance pass: was $40 — at mortuary 0 that was $1.27 per freshness point, and a 3-zombie household with one Chill-Rest coffin embalmed ~15× in three weeks.)
  - Preservative Spray (from fridge "Grab Preservative Spray", $15): +8 instantly.
- **Limb loss** (checked hourly per on-lot zombie): if preservation < 50, `p = ((50 − pres)/50)^2 × 0.08` per hour; × Clumsy 2.0; × 0.5 if fitness ≥ 5; × 1.5 during exercise/dance; × 0 with *Iron Stitches*. Pick a present limb: arms 35% each, legs 15% each.
  - A lost limb spawns `item_limb_arm/leg` at the zombie (data: limbId, ownerId, createdTick, rotten=false), FX limbDrop + sfx, moodlet *Lost a Limb* (−15, 12h) on the owner; witnesses get *Grossed Out* (−5) or *That Was Hilarious* (+5, Grumpy/PartyAnimal/Hothead) — Squeamish witnesses −15.
  - Missing arms: −1 arm: cooking/painting/chess/computer 35% slower, cannot do Exercise; −2 arms: cannot cook/paint/play chess/computer/stitch (others must help). Missing legs: walk speed ×0.6 (limp) for one, ×0.3 (crawl) for both.
  - Reattach: owner or another zombie "Pick Up" the limb, then "Stitch Back On" at a Stitch-n-Mend Table or Embalming Station (25 min). Success = 0.5 + 0.06 × mortuary (cap 0.95); fail = limb drops again, moodlet *Butterfingers*. Limbs rot after 48 game hours (rotten=true, cannot reattach; only throw away).
  - Prosthetic Limb Crate ($250): "Fit Prosthetic" restores one missing limb as `prosthetic` (consumes crate).
- **Crumbling**: at preservation 0 the zombie gets *Falling Apart* (−30) and limb-loss chance ×3. After 24 consecutive game hours at 0 → **Crumbled**: agent presence `crumbled`, `item_bonepile` spawned (data ownerId), household gets *Mourning* (−20, 48h).
  - Reanimation Kit ($1,500): "Reanimate" on a bone pile within 72 game hours: agent returns with preservation 55, vitality −15 (min 20), all limbs restored, moodlet *Back From the Dead* (+15, 24h). Kit consumed.
  - After 72h the pile becomes `item_urn` (presence `gone`). If every household member is crumbled/gone → game over ("Rest in Pieces").

## 5. Food (systems/food)
| Recipe | Cost | Min cooking | Servings | Quality | Hunger/serving | Cook min |
|---|---|---|---|---|---|---|
| Synthetic Brain Loaf | 12 | 0 | 4 | 2 | 45 | 30 |
| Brain Jerky Snack (fridge, instant) | 5 | 0 | 1 | 1 | 20 | — |
| Cerebellum Stew | 20 | 2 | 4 | 3 | 55 | 45 |
| Frontal Lobe Lasagna | 30 | 4 | 6 | 4 | 60 | 60 |
| Gourmet Medulla Flambé | 45 | 7 | 4 | 5 | 70 | 75 (requires Cryo-Fridge) |
| Microwave Brain Burrito (microwave) | 8 | 0 | 1 | 2 | 40 | 6 |
| Brain Pizza (phone, delivered ~60 min) | 35 | — | 6 | 3 | 50 | — |
- Final quality = clamp(base + floor(cooking/3) − 1 + stove bonus (Necro-Chef +1), 1, 6). Hunger × (0.8 + 0.1 × quality). Quality ≥ 5 → *Delicious Meal* (+10, 4h); quality ≤ 1 → *Ate Something Questionable* (−5).
- Cooking flow: stage 1 fridge ("get ingredients", 2 min, charges recipe cost) → stage 2 stove (cook, cooking xp 40/h) → meal item placed on nearest free counter/table surface (else floor near stove).
- Fire chance per cook: 3% at cooking 0, −1% per level (0 at 3+), × Grease-Fire 1.25, × Necro-Chef 0.5 (balance pass: was 6% / 0 at 6+, then 4% / 0 at 4+ — a three-zombie household still had 3–5 fires in 21 days, and a burned $400 stove flipped a one-wage household's funds trend negative). Fire: `item_fire` spawns at the stove; spreads to an adjacent object (10%/10min), **at most 2 spreads per fire (the original ignition and everything it spread to)**; burning objects become `item_ash` after 60 min (autonomy sweeps ash: Clean Up adBonus 12 — at 6 it never cleared the idle threshold and the pile blocked re-buying the stove on its spot); zombies near fire get *Panicking* (−15) and anyone can "Fight Fire" (20 min, 70% success/attempt). A fire is an emergency: household zombies who are not panicking at it are called to Fight Fire at critical priority (2 per fire). An ashed fridge / stove / microwave says so: "Your fridge burned — buy a new one". Zombies on fire? No — burning tiles drain preservation −10/h nearby.
- Eating: "Have a Serving" (stage 1 grab from meal, stage 2 sit at a chair preferring tables, else eat standing with *Ate Standing Up* −3). Leaves `item_dish` on the table spot or floor. Eating with others at the same table gives social +4/h each and *Family Dinner* (+8) if 2+ household members.
- Leftovers: "Put Away Leftovers" on a meal → fridge stores servings with quality and createdTick. Spoil after 48h (24h if power off; ×2 time in Cryo-Fridge). Eating spoiled: hunger halved, 60% chance *Food Poisoning* (−20, 6h, hunger decay ×1.5) unless *Cast-Iron Stomach*.
- Dirty dishes: −1 environment each in room; after 6h they draw flies. "Clean Up" (stage 1 grab dish, stage 2 sink wash 5 min, or trash can). Neat Freak autonomy loves this.

## 6. Economy (systems/economy)
- Funds are integer dollars, never negative. Every charge uses an idempotency key (no double charges on retries/reloads).
- Bills: issued Monday & Thursday 09:00 in the mailbox: `40 + round(0.005 × lotValue) + 10 × householdSize` (balance pass: was 0.012 / 15 — a $221 starter bill twice a week ate most of an entry-level wage; now ≈ $127 for three zombies after the first upgrades). Due 3 days after issue.
  - Day 3 after due: final notice (warning). Day 4 overdue: **power cut** (utilitiesOn=false: fridge/stove/TV/PC/stereo/lamps/refrigerated coffins/cryo/ice bath/zapper/arcade stop; leftovers spoil 2× faster). Paying everything restores power immediately.
  - Day 6 overdue: the **Repo Ghoul** (service NPC) arrives, walks to the most valuable sellable objects and repossesses them (value ≥ 1.2 × owed) — objects vanish with a puff — then clears the bills.
- "Pay Bills" at the mailbox (5 min) or "Pay Bills Online" at a computer. Mailbox flag is up while bills or mail are waiting.
- Selling objects refunds `value × (1 − depreciation)` (depreciation default 0.15; full refund via undo in the same build session).
- Paintings sell for `40 + 25 × creativity^1.35 × rand(0.8,1.2)` via "Sell Painting".
- Starting funds: Fixer-Upper (starter home) $6,500; Empty Plot $22,000. +$500 per household member beyond the first.

## 7. Skills (0–10)
cooking, charisma, mortuary (Mortuary Science), logic, creativity, fitness. XP per level: `[100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200]`.
Sources (xp/h): cooking 40 (stove), 6 (watch cooking channel); charisma 30 (mirror practice), 6 per social; mortuary 35 (study textbook), 50 (embalming); logic 30 (chess, programming), 25 (reading), 20 (arcade); creativity 40 (painting); fitness 45 (limb gym), 20 (dancing).

## 8. Traits (pick 3 in Create-a-Zombie; conflicting pairs disallowed)
| id | Name | Effect |
|---|---|---|
| gourmand | Gourmand | hunger decay ×1.2; eating fun +10/h; cooking xp ×1.25; likes cooking (+20 ad) |
| neatFreak | Neat Freak | hygiene decay ×1.15; *Disgusted by Mess* near dirty dishes/flies; loves cleaning (+40 ad) — conflicts slob |
| slob | Slob | never cleans autonomously; immune to stench/mess moodlets; hygiene decay ×0.85 — conflicts neatFreak |
| nightOwl | Night Owl | +8 mood at night, −5 by day; energy decay ×0.8 at night |
| socialButterfly | Social Butterfly | social decay ×1.3; social success +10%; loves parties — conflicts loner |
| loner | Loner | social decay ×0.6; −5 mood with 4+ zombies in room; dislikes parties — conflicts socialButterfly |
| hopelessRomantic | Hopeless Romantic | romance gains ×1.5; flirts autonomously; *Lovesick* if partnerless 7 days |
| grumpy | Grumpy | base mood −6; mean socials +15% success; dislikes jokes — conflicts cheerful |
| cheerful | Cheerful | base mood +6; jokes +15% — conflicts grumpy, hothead |
| clumsy | Clumsy | limb loss ×2; fire chance ×1.5; laughs at own limb loss |
| vain | Vain | +10 mood with preservation ≥ 80; −12 with preservation < 40; loves mirrors (+30 ad) |
| lazy | Lazy | energy decay ×1.2; TV/nap fun ×1.3; fitness xp ×0.5 — conflicts ambitious |
| ambitious | Ambitious | job performance +25%; skill xp ×1.1 — conflicts lazy |
| bookworm | Bookworm | reading fun ×2; logic xp ×1.2 |
| partyAnimal | Party Animal | fun decay ×1.2; dancing/party fun ×1.5; party score +15 |
| artistic | Artistic | creativity xp ×1.3; painting fun ×1.5 |
| hothead | Hothead | argues autonomously; mean socials +20%; *Furious* moodlets last ×2 — conflicts cheerful |
| squeamish | Squeamish | grossed out by limbs and embalming (−15); embalming others −30% effect; comic irony |

Reward traits (bought with aspiration points): **wellPreserved** (preservation decay ×0.7, 1,200 pts), **ironStitches** (no limb loss, 900), **castIronStomach** (no food poisoning, 400), **silverTongue** (social success +15%, 700), **deepSleeper** (energy restore ×1.3, 500). Consumable reward **secondWind** (vitality +20, 600).

## 9. Social (systems/social)
Relationship per pair: friendship −100..100, romance 0..100, flags met/partners/engaged/married/bestFriends. Labels: Stranger (not met), Acquaintance (≥ 0), Friend (≥ 35), Good Friend (≥ 60), Best Friend (flag), Disliked (≤ −35), Nemesis (≤ −70); romance labels Crush (≥ 30, not partners), Partner, Fiancé(e), Spouse.
Daily drift: friendship decays toward 0 by 1/day without interaction (2/day if ≥ 60); romance −2/day without romantic interaction.
Success chance = base + 0.03 × charisma + (actorMood + targetMood)/400 + relationship factor (friendship/400) + trait bonuses (silverTongue .15, socialButterfly .10, grumpy/hothead for mean) − 0.25 if actor hygiene < 15 (unless target slob) − 0.2 if target mood band miserable; clamp 0.05..0.95.

| id | Group | Gate | base | friendship ok/fail | romance ok/fail | Notes |
|---|---|---|---|---|---|---|
| social_introduce | Friendly | not met | 0.95 | +5/+1 | — | sets met; auto first interaction |
| social_chat | Friendly | met | 0.85 | +4/−2 | — | Groan Small Talk |
| social_joke | Friendly | met | 0.7 | +6/−4 | — | Tell a Gross Joke; fun +8; grumpy targets −25% |
| social_complimentRot | Friendly | met | 0.75 | +6/−3 | — | Compliment Their Decay; vain targets +20% |
| social_gossip | Friendly | ≥ 20 | 0.75 | +6/−3 | — | fun +6 |
| social_shareRecipe | Friendly | ≥ 10, cooking ≥ 2 | 0.8 | +5/−1 | — | cooking xp 10 to target |
| social_hug | Friendly | ≥ 30 | 0.8 | +7/−5 | — | Cold Embrace |
| social_bestFriends | Friendly | ≥ 75 | 0.7 | +10/−10 | — | outcome bestFriends |
| social_playfulBite | Friendly | ≥ 40 | 0.6 | +8/−10 | — | outcome bite (target fun+, preservation −2) |
| social_flirt | Romantic | ≥ 10 | 0.65 | +2/−3 | +8/−4 | Wink With Remaining Eye |
| social_complimentSmell | Romantic | romance ≥ 10 | 0.7 | +2/−2 | +7/−4 | |
| social_slowDance | Romantic | romance ≥ 25 | 0.7 | +3/−2 | +9/−5 | |
| social_kiss | Romantic | romance ≥ 40 | 0.7 | +3/−6 | +12/−8 | first kiss milestone |
| social_askPartner | Romantic | romance ≥ 60, friendship ≥ 40, notPartnered | 0.7 | +5/−10 | +10/−15 | outcome becomePartners |
| social_propose | Romantic | partners, romance ≥ 80 | 0.75 | +5/−15 | +10/−25 | outcome propose (engaged) |
| social_elope | Romantic | engaged | 0.95 | +10/0 | +10/0 | outcome marry (married, *Newlyweds* +20 3 days) |
| social_moveIn | Friendly | friendship ≥ 50 or partners; target not household; household < 8 | 0.75 | +5/−8 | — | outcome moveIn |
| social_breakUp | Mean | partners+ | 0.95 | −40/−40 | −60/−60 | outcome breakUp |
| social_argue | Mean | met | 0.8 | −8/−4 | −4/−2 | about the smell |
| social_insultDecay | Mean | met | 0.85 | −14/−6 | −8/−4 | target *Offended* |
| social_askToLeave | Mean | target visitor | 0.95 | −3/−3 | — | outcome askToLeave |
| social_inviteStay | Friendly | target visitor | 0.8 | +3/−1 | — | outcome inviteToStay (+3h) |
| social_welcome | Friendly | target visitor waiting | 1.0 | +2/0 | — | outcome welcome (may enter house) |
| social_waveOver | Friendly | target walk-by | 0.85 | +2/0 | — | outcome waveOver (becomes visitor) |
Social duration 10 game minutes (kiss/hug 6, propose 12). Social need +8 each on success (+4 on fail). Charisma xp 6.

## 10. Careers (systems/careers) — five tracks × five levels
Carpool (a hearse) arrives at the curb 30 min before the shift; the zombie walks off-lot automatically (system priority "Go to Work"). Away while at work. Needs while away (/h): hunger −4, energy −5 (balance pass: −6 sent day-job workers home at Rest ~25 and straight to bed with Amusement still below 15 — 7 % of one worker's on-lot hours; at −5 there is room for an evening TV session first, 0 % in 5/5 seeds), fun −2 (balance pass: −4 sent day-job workers home at Amusement ~0 and they slept the evening away below 15 in ~29 % of their on-lot hours; at −2 it is 0 % in 4-day probes), social +3, hygiene −3, preservation normal.
Daily performance at shift end: `+8 + moodAvg/10 + 2 × primarySkill/levelReq + ambitious 3` ; −10 if preservation < 30 at departure ("coworkers complained about the smell"); −6 if hygiene < 20; missed shift −25. Promotion when performance ≥ 100 and requirements met (performance resets to 20, moodlet *Promoted!* +20 24h, notification + promotion event). Performance ≤ −80 or 3 missed shifts in a row → fired. "Call in Sick" (phone, max 3 per week, −5 perf).

| Track (skill) | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| Graveyard Shift Retail (charisma) — 22:00, 6h, Mon–Fri | Night Stocker $17 | Cashier $20 (cha 1) | Shift Lead $24 (cha 3) | Assistant Manager $32 (cha 5) | Store Manager $44 (cha 7) |
| Mortuary Sciences (mortuary) — 09:00, 8h, Mon–Fri | Body Washer $19 | Embalmer's Assistant $24 (mor 2) | Embalmer $31 (mor 4) | Funeral Director $43 (mor 6) | Chief Mortician $60 (mor 8) |
| Undead Politics (charisma) — 10:00, 7h, Mon–Fri | Campaign Volunteer $15 | Council Aide $22 (cha 2) | City Councilor $30 (cha 4) | Deputy Mayor $45 (cha 6) | Mayor of Wormwood $70 (cha 9) |
| Culinary Arts (cooking) — 16:00, 7h, Wed–Sun | Dishwasher $16 | Line Cook $21 (cook 2) | Sous Chef $28 (cook 4) | Head Chef $40 (cook 6) | Celebrity Brain Chef $58 (cook 8) |
| Necro-Tech (logic) — 09:00, 8h, Mon–Fri | Tech Support Ghoul $20 | Junior Coder $27 (log 2) | Senior Developer $36 (log 4) | Lead Architect $50 (log 6) | CTO of the Undead $72 (log 8) |
Each track has 3 work-choice events (25% chance per shift, shown mid-shift, auto-resolve after 2 game hours).
- Balance pass: L1 wages +$3/h and L2 +$2/h (higher levels unchanged) so that one entry-level 9-to-5 (Mortuary Sciences or Necro-Tech) carries a 2–3 zombie starter household with a Chill-Rest coffin and an Embalming Station: funds grow after day 7 in 5/5 seeds (docs/BALANCE.md). Evening/night/weekend tracks (Politics, Culinary, Retail) still lose ~$20–30/day at L1 with three zombies until the first promotion — a deliberate slow start.

## 11. Townies, visitors, parties (systems/townies)
- 24 townies generated from the world seed (names, appearances, 3 traits, occupation flavour). Persistent relationships.
- Walk-bys: 07:00–22:00, 20% per hour when < 2 visitors on lot; walker strolls the sidewalk end to end (clickable: "Wave Over").
- Drop-ins: friends (friendship ≥ 35) ring the doorbell 4%/h, 10:00–21:00.
- Visitors stay 2–4 h (party guests until party end), use visitor-allowed interactions, leave at 01:00 or when mood is miserable/asked to leave.
- Phone (from the zombie panel): Invite Over (known townies), Throw a Party (up to 6 guests, needs a household zombie with fun ≥ 30; party lasts 4h; score from guests' mood + fun + music on + food out; ≥ 70 *Legendary Party* +15, ≤ 30 *Lame Party* −10), Order Brain Pizza, Get a Job / Quit Job, Call in Sick, Pay Bills Online is computer-only.
- Service NPCs: Pizza Delivery Ghoul, Repo Ghoul, Carpool hearse (vehicle prop, not an agent).

## 12. Aspirations (pick 1; milestones award points spent in the Reward Store)
| id | Name | Milestones (points) |
|---|---|---|
| tycoon | Undead Tycoon | $5,000 funds (250) · career level 3 (400) · $25,000 funds (600) · career level 5 (1,000) |
| afterparty | Life of the Afterparty | 3 friends (250) · throw a party (350) · 6 friends (550) · a Legendary Party (900) |
| eternalRomance | Eternal Romance | first kiss (250) · become partners (400) · get married (600) · romance 100 (900) |
| masterPreserver | Master Preserver | mortuary 3 (250) · embalm another zombie (400) · mortuary 7 (600) · keep household avg freshness ≥ 70 for 7 days (1,000) |
| renaissanceCorpse | Renaissance Corpse | creativity 3 (250) · sell a painting (350) · creativity 7 (600) · three skills at 5+ (1,000) |

## 13. Random life events (systems/events)
Fly swarm (dirty dishes ≥ 3 or anyone reeking), Mail: fan letter / coupon / chain letter (flavour + small money), Fridge breaks (breakChance), Power flicker at full moon (visual only), Raven steals a shiny thing (lose $10–40), Grave-robber at night (03:00, 4% if no outdoor light: steals one object < $300 from outdoors), Neighbour complains about the smell (if anyone reeking outdoors: −friendship with a random townie), Lottery ticket in mail (1%: +$500).

## 14. Autonomy
Utility AI over all (interaction, target) candidates the zombie may use:
`score = Σ_needs W_trait(n) × (D(v) − D(min(cap, v + ad_n)))` with `D(v) = (100 − v)² / 100`, plus adBonus + trait/tag bonuses (their positive sum soft-capped at 12: `12 × (1 − e^(−raw/12))`, so personality orders hobbies but never out-bids a real need), × distance attenuation `1 / (1 + pathCost/14)`, × 0.6 if an object is in use by another (non-joinable). **Repetition:** with n = times the zombie completed the same interaction in the last 6 game hours, essentials (eating, cooking, sleep, hygiene, preservation, bills, firefighting, repairs, limbs, cleaning up an actual mess) score × 0.85ⁿ; anything else keeps its need-driven part × 0.85ⁿ while its bonuses fade × 0.6ⁿ — no more door-slamming marathons. **Daily cap:** autonomy picks one non-essential interaction id (a social counts once over all partners) at most 6 times per game day per zombie; further candidates of that id score 0 until midnight (the tally is `flags['engine:picks:<agentId>']`, WorldState, pruned hourly). The fading 6-hour penalty alone let a liked joke come back every ~3 h, 7 times in one day (skeptic seed 2009). Essentials are never capped. Pick weighted-random among the top 3 (seeded) that clear the threshold. Below threshold 6 → idle behaviours (stretch, groan, wander a few tiles, look at phone). Re-plan backoff 4 game minutes after failure. `limited` autonomy: only needs below 35 are considered; `off`: only critical-need overrides (hunger ≤ 5, energy ≤ 3).
- **Appetite gates (balance pass):** autonomy eats a meal/leftovers only below Appetite 65 and a snack below 55, and cooks only when someone at home is below 60 (were 80 / 70 / 75: a ~50-point serving at 75+ was mostly wasted — households ate ~3.8 servings per zombie per day and groceries were the largest expense). Player orders are unaffected.
- **Busy partners:** a social never starts with a target that has a critical action waiting (a Fight Fire call, a feral meal) — it would be preempted within the minute and re-picked, looping dozens of one-minute socials while the fire burned.

## 15. Build/Buy
- Lot 30 × 30 tiles; buildable x∈[1,29), z∈[1,27); sidewalk row z = 28; street beyond. Entry points at the sidewalk ends.
- Walls on tile edges ($15/segment, $10 refund on delete outside undo). Room tool draws a rectangle of walls + floor. Doors/windows replace a wall segment. Floors per tile, wall paint per segment side, "paint room" fills every wall side facing a room.
- Placement rules: inside buildable area; no overlap (rugs layer separately); a multi-tile object may not straddle a wall; outdoorOnly/indoorOnly respected; openings need a wall with free tiles on both sides of a door; wall items need a wall side without another wall item. Blocked slots are allowed but flagged.
- Undo/redo within a build/buy session refunds exactly. Leaving the mode clears the history.

## 16. Save/Load
Slots + autosave every N real minutes (setting) + on quit; SHA-256-verified envelope; backup of previous good save per slot; schema migrations; export/import as file. Corrupt saves fall back to backup with a visible warning; never crash on bad data.

## 17. UI flows
Boot (asset loading) → Main Menu (Continue / New Game / Load / Settings / Credits / Quit) → New Game: choose lot (Fixer-Upper or Empty Plot) + difficulty → Create-a-Zombie (1–4 members: name, look, traits ×3, aspiration, voice; randomize) → Game.
HUD: household portraits (mood ring, alert badge), time + speed controls + funds + bills badge, mode switch Live/Buy/Build, wall mode, selected-zombie panel (Needs, Mood, Skills, Career, Relationships, Aspiration & Rewards, Info/limbs/vitality, Phone), action queue with cancel, toast notifications + log, interaction menu on click, choice popups, buy catalog with thumbnails, build tools palette, party HUD, tutorial hints.

## 18. Balance targets (measured — method and history in docs/BALANCE.md)
Harness: `tests/balance/harness.ts`. Run `npm run balance` for the full sweep (5 seeds per scenario, invariants
checked every game hour). The CI subset is `tests/balance/balance.test.ts`. Independent checks: seeds 1001–1010
(`tests/balance/verify_1_1.test.ts`, `verify_1_2.test.ts`), 3001–3010 (`verify_2_1.test.ts`) and 2001–2010
(`verify_2_2.test.ts`).

| Target (normal unless stated) | Measured (seeds 11/22/33/44/55; skeptic seeds 1001–1010, 2001–2010 and 3001–3010 in brackets) |
|---|---|
| Unattended starter household survives ≥ 10 days in ≥ 4/5 seeds, nobody crumbles before day 8 | 5/5, nobody crumbles in 14 days [30/30] |
| Unattended stay-at-home zombies: every need < 15 in < 5 % of on-lot hours | 0.0 % [0.0 %; was 30.2 % preservation on seed 3001 before Chill Out] |
| Reasonable player (job day 1, Chill-Rest day 1, Embalming Station at ≥ $3,000, bills autonomous): nobody crumbles in 21 days | 5/5, also 5/5 on the Empty Plot and with the other three careers [30/30] |
| Workers' Amusement < 15 in < 5 % of on-lot hours | 0.0 % in every seed [≤ 0.5 %] |
| Funds trend upward after day 7 (Mortuary / Necro-Tech, 2–3 zombies) | +$16 … +$86 per day [+$17 … +$80; +$20 … +$80 on 2001–3010] |
| Repo visits / power cuts / late bills | 0 / 0 / 0 [0 / 0 / 0] |
| No non-essential action > 6 runs per zombie per day (socials counted over all partners); no non-sleep interaction > 25 % of waking time | worst 6 / day, now a hard cap (§14); worst 19.9 % [6 / day, was 7 on seed 2009 before the cap; 23.5 %] |
| Grim harder, relaxed easier | mean freshness 52.7 / 60.5 / 71.0, limbs lost 7 / 3 / 0, day-14 funds $6,252 / $6,488 / $6,635 (grim / normal / relaxed) |
| Faults / invariant violations | 0 / 0 [0 / 0] |

**Balance-pass changes** (each also noted in its own section):
- **Starter home:**
  - the second pine coffin is a **Chill-Rest** (a freshness source that survives a kitchen fire);
  - a **Moldering Bookshelf** stands in the living room (a second fun source, and Logic).
- **Fire chance:** 3 % − 1 %/cooking level (§5); **ash** is swept by autonomy (Clean Up adBonus 6 → 12).
- **Fun sources:** Watch TV **+20 Amusement/h** (was 14), Read **+11/h** (was 8) — see §3.
- **Appetite gates:** autonomy eats below 65, snacks below 55 and cooks when someone is below 60 (§14).
- **Bills:** `40 + 0.005·lot + 10·n` (§6).
- **Wages:** L1 +$3/h, L2 +$2/h (§10).
- **Embalming fluid:** $30 (§4).
- **At work:** Rest −5/h (§10).
- **Read:** stops at Amusement 98; Bookworm read bonus 12.
- **Door slam / Practice Speech:** trait bonuses lowered.
- **Socials:** never start with a zombie who has a critical action waiting (§14).
- **Chill Out** on refrigerated coffins: +10 Freshness/h awake, autonomy below 40 (§4).
- **Daily cap:** ≤ 6 autonomous picks of one non-essential interaction per zombie per day (§14).
