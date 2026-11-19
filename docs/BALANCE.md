# Balance pass (backlog "Balance", resolved decision #13)

The source of truth for every number is [GDD.md](GDD.md); this file records **how** the numbers were found: the
harness, the scenarios, the measured before/after metrics and the reasoning behind each change.

## 1. Method

- **Harness:** `tests/balance/harness.ts` — `runScenario(spec, seed)` builds `createSimulation(createNewWorld(...))`
  with the real shipped content (engine + spatial + home + people), a seeded household from the same
  `randomHousehold` the Create-a-Zombie "Randomize" button uses (2 or 3 zombies, random traits and aspirations; the
  member count is drawn from the seed too) and an optional scripted player, then steps it tick by tick for N game
  days. The loop keeps only cheap counters: no logging, events drained and dropped every game hour, a yield to the
  event loop every 2 game hours (vitest's worker heartbeat). About 1.0–1.5 s per game day on the shared 4-core box.
- **Entry points:**
  - `npm run balance`: the full sweep (`vitest run --config tests/balance/vitest.config.ts --mode full`, which sets
    `BALANCE_FULL=1`). Every scenario × 5 seeds with the targets asserted and a per-run report printed. About 11 min.
  - The fast subset in `tests/balance/balance.test.ts` (A 9 d, Cg 9 d, B 12 d, about 35 s) always runs. It runs in CI
    through `tests/unit/balance/fast.test.ts`, because `npm test` only collects `tests/unit/**`.
  - Ad-hoc: `npx vite-node tests/balance/sweep.ts -- A,B 11,22 [days]`.
- **Independent checks:** four skeptics' scripts with their own loops, player scripts and household-size rules:
  `tests/balance/verify_1_1.test.ts` and `verify_1_2.test.ts` (seeds 1001–1010), `verify_2_1.test.ts` (3001–3010)
  and `verify_2_2.test.ts` (2001–2010), about 6–7 min each. They sit under `tests/balance/`, so a bare
  `npm run balance` runs them after the sweep (about 37 min in all; 20 tests). Use
  `npm run balance -- tests/balance/balance.test.ts` for the sweep alone (about 11 min), or
  `npx vitest run --config tests/balance/vitest.config.ts tests/balance/verify_1_1.test.ts` for one script.
- **Seeds:** 11, 22, 33, 44, 55 (2, 3, 2, 3, 3 zombies). The world is deterministic per seed, so a rerun reproduces
  every number below exactly.
- **Metrics (per run):**
  - days survived, crumbles (day);
  - % of on-lot hours with each need < 15 (sampled hourly, split into stay-at-home zombies and workers);
  - fresh autonomous runs per zombie per game day. A non-essential interaction above 6/day is flagged as spam;
    socials count as one interaction id across all partners (the rule as written — until the review round they were
    counted per partner, which let 7 jokes a day over two housemates through);
  - share of on-lot waking minutes spent in the single most-used non-sleep interaction;
  - funds at every midnight and their least-squares slope from day 7 on, plus money flow by reason;
  - bills issued / paid / late, power cuts, Repo Ghoul visits, repossessions;
  - fires, limbs lost, skill and career levels, relationships met / friends;
  - faults (must be 0) and invariant violations (`checkInvariants()` every game hour, must be 0).

## 2. Scenarios

| id | lot | difficulty | player | days | notes |
|---|---|---|---|---|---|
| A | Fixer-Upper (starter) | normal | none (full autonomy) | 14 | the unattended household |
| B | starter | normal | reasonable | 21 | the job (by seed) is Mortuary Sciences or Necro-Tech |
| Bc | starter | normal | reasonable | 21 | career coverage: Politics, Culinary, Retail |
| Cg / Cr | starter | grim / relaxed | none | 14 | A on the other difficulties (same households) |
| D | Empty Plot | normal | reasonable + day-1 build | 21 | 9×7 one-room crypt with the essentials, a TV and a bookshelf |

The **reasonable player**:
- At 10:00 on day 1, the first zombie on the lot gets a job (`phone_findJob`).
- At 12:00 on day 1, the player buys a Chill-Rest coffin if funds allow it (bedroom, nearest free spot).
- After that, once funds are at least $3,000, the player buys an Embalming Station.
- Bills are left to autonomy.
- A burned or repossessed fridge or stove is re-bought at its old spot (the game says "Your stove burned — buy a new one").
- Everything else is left to autonomy.

## 3. Targets (normal unless stated)

| target | result |
|---|---|
| A: survives ≥ 10 days in ≥ 4/5 seeds | **5/5** (14/14 days); skeptic seeds 1001–1010: **10/10** |
| A: nobody crumbles before day 8 | **5/5 seeds, no crumble at all in 14 days** (10/10 skeptic seeds) |
| A: stay-at-home zombies, each need < 15 in < 5 % of on-lot hours | **0.0 %** for every need, every seed, all four seed sets (40 skeptic runs). Was 30.2 % preservation on skeptic seed 3001 before §5.9 |
| B: nobody crumbles in 21 days, 5/5 seeds | **5/5** (10/10 skeptic seeds, both skeptic scripts) |
| B: workers' Amusement < 15 in < 5 % of on-lot hours | **0.0 %** in each of the 5 seeds; skeptic seeds: **0.0 %** (script 1) and **≤ 0.5 %** (script 2, lowest sample 13). Was 11.8 % (seed 1007) before §5.8 |
| B: funds trend upward after day 7 | **slope +16 … +86 $/day**, 5/5 seeds; skeptic seeds **+17 … +80** (10/10) |
| B: zero repo visits | **0** (0 late bills, 0 power cuts), both seed sets |
| grim measurably harder, relaxed easier | mean freshness **52.7 / 60.5 / 71.0**; limbs lost **7 / 3 / 0**; day-14 funds **$6,252 / $6,488 / $6,635** (grim / normal / relaxed) |
| no action spam (no non-essential action > 6/zombie/day, socials counted over all partners) | worst **6** per day; since §5.9 a hard cap in autonomy, so it cannot exceed 6 (0 breaches in 30 + 80 runs). Was 7 (social_joke, skeptic seed 2009 d13) before §5.9 |
| no non-sleep interaction > 25 % of waking time (normal) | worst **19.9 %** (skeptic seeds: **22.5 %**). Was 28.7 % before §5.8 |
| faults / invariant violations | **0 / 0** in all 30 runs (525 game days) and all 80 skeptic runs (1,400 game days), invariants checked hourly; save → load → continue identical in all four skeptic scripts |

## 4. Before → after (per scenario, 5 seeds pooled)

"After" here is the first round. The review round (§5.8) changed the TV, Read, fire and ash numbers; its results
are in §3, §5.8 and §6.

"Before" is the tuning the sim backlog agent handed over (after backlog #12/#13/#14/#15). B before rotated through
all five careers; that rotation is now split into B (the two well-paid 9-to-5s) and Bc (the other three).

| metric | A before | A after | B before | B after | Bc after | D before¹ | D after | Cg before → after | Cr before → after |
|---|---|---|---|---|---|---|---|---|---|
| runs without a crumble | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 → 5/5² | 5/5 → 5/5 |
| stay-home worst need < 15 | 0.0 % | 0.0 % | 0.3 % (social) | 0.0 % | 0.0 % | 0.1 % | 0.1 % | 0.3 % → 0.0 % | 0.0 % → 0.0 % |
| worker Amusement < 15 | — | — | 0.4 % (2.3 % worst seed) | 0.0 % (0.0 %) | 0.0 % | 0.3 % | 0.0 % | — | — |
| mean freshness (stay-home) | 42 | 58 | 69 | 74 | 76 | 69 | 70 | 39 → 50 | 45 → 73 |
| funds slope after day 7 ($/day, worst seed) | −245 | −103 | −112 | **+20** | +6 | −102 | −22 | −310 → −158 | −189 → −74 |
| late bills / power cuts / repo visits | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |
| kitchen fires | 4 | 5 | 16 | 5 | 1 | 28 | 11 | 20 → 7 | 9 → 2 |
| limbs lost | 20 | 8 | 0 | 0 | 0 | 0 | 0 | 34 → 11 | 20 → 0 |
| worst non-essential runs / zombie / day | 7 | 5 | 8 | 5 | 5 (was 25/h, §5.1) | 6 | 5 | 7 → 6 | 7 → 5 |
| worst single-interaction share of waking time | 23 % | 23 % | 31 % | 24.5 % | 24 % | 32 % | 24 % | 33 % → 34 %³ | 16 % → 16 % |
| faults / invariant violations | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

¹ "D before": the original sweep's Empty Plot build placed the fridge, stove and coffins facing each other and every
household crumbled by day 3 (a harness bug, not a game bug). The column is the first sweep with the corrected build.
² Before the Chill-Rest swap (§5.3), an intermediate grim run lost its fridge to a kitchen fire on day 3 and the
whole household crumbled on day 5.
³ The 25 % rule is a normal-difficulty target. On grim, faster Amusement decay means more TV.

## 5. What was changed and why (in the order found)

### 5.1 Bugs found by the harness
- **Social / fire-call loop (engine).** A household zombie with a critical Fight Fire call queued was still a valid
  social target. The respond half started, the critical item preempted it within the minute, the actor picked the
  same social again, and the pair looped: Bc seed 55 day 12 had 25 jokes, 23 hugs and 18 gossips in one morning, all
  while the kitchen burned. Fix: `targetBusyReason` returns "{Target} is busy" while any critical item is waiting
  (`src/sim/engine/socials.ts`, engine README §8). Regression: `tests/unit/engine/balance.real.test.ts`. Both tests
  fail with the line reverted; the fire scenario logged 33 looping socials.
- **Harness only:** the Empty Plot build orientation (above) and the day/hour clock offset (the clock starts at 09:00).

### 5.2 Money (B's funds fell $15–112/day after day 7)
The household spent about $45 per zombie per day against one entry-level wage of $84–136 per shift:
- bills: $206–221 twice a week;
- groceries: about $50/day for three zombies, with ~3.8 servings eaten per zombie per day;
- embalming: $40 a session;
- one seed lived on $5 jerky (−$1,675) after its stove burned and nobody replaced it.

| lever | before → after | where |
|---|---|---|
| autonomous eating / snacking / cooking thresholds | Appetite < 80 / < 70 / someone < 75 → **< 65 / < 55 / < 60** | `home/food/eating.ts`, `cooking.ts` (GDD §14) |
| bill formula | `40 + 0.012·lot + 15·n` → **`40 + 0.005·lot + 10·n`** (3 zombies: $221 → $127) | `home/economy/bills.ts` (GDD §6) |
| L1 / L2 wages | **+$3 / +$2 per hour** (e.g. Body Washer $16 → $19, Tech Support Ghoul $17 → $20) | `content/people/careers.ts` (GDD §10) |
| Self-Embalm / Embalm Other fluid | **$40 → $30** | `content/home/interactions/care.ts` (GDD §4) |
| reasonable player | rotates **Mortuary / Necro-Tech** (Bc covers the other three) and re-buys a burned fridge/stove | harness |

Rejected alternatives:
- Bills alone: worst seed still −9 $/d.
- Wages alone: +5 $/d, and lottery luck decided the sign.

### 5.3 Survival robustness: the starter home restorer
An unattended household had exactly one freshness source, the fridge's Preservative Spray. A kitchen fire that spread
to the fridge (the starter puts it next to the stove) crumbled the whole grim household by day 5, and normal would
crumble by about day 7. **One starter pine coffin is now a Chill-Rest** (+4 freshness/h while asleep, powered), which
is the lever the backlog lists. Results:
- A mean freshness 42 → 58, limbs lost 20 → 8.
- The unattended money burn halves, because fewer sprays are bought.
- The B player still buys a second Chill-Rest on day 1.

### 5.4 Fires
4 % at cooking 0, −1 %/level, 0 from cooking 4 (was 6 %, 0 at 6+; the review round took it to **3 %, 0 from
cooking 3**, §5.8). Fire counts dropped 16 → 5 (B), 28 → 11 (D),
20 → 7 (grim). Burned appliances were also the biggest one-off money shock (−$450 fridge, −$400 stove).

### 5.5 Variety (spam and the 25 % rule)
| lever | before → after | why |
|---|---|---|
| starter template | **+ Moldering Bookshelf** at (12,14) | the TV was the only real fun source: workers spent 26–31 % of their evenings in front of it. The shelf is also the only Logic source for Necro-Tech promotions |
| Read stage | **`stopWhen fun ≥ 98`** (like the TV) | Bookworms read 7–8 h a day at Amusement ~93 |
| Bookworm `tagAd.read` | **25 → 12** | Bookworms read 26–36 % of their waking time |
| Hothead / Grumpy door slam `traitAd` | 12 / 6 → **8 / 4** | a Hothead-Grumpy slammed 7–8 doors a day |
| Practice Speech | adBonus 3 + {ambitious 8, socialButterfly 6} → **{5, 3}** | an Ambitious Social Butterfly practised 7–8 speeches a day. With ≤ 6 of flat bonus, the repetition penalty allows one per 6 h unless genuinely bored |
| Empty Plot build (D) | + bookshelf | same as the starter: the TV alone gave 7 sessions on a day off |

### 5.6 Workers
At-work Rest **−6 → −5/h**. At −6, a necro-tech worker came home at Rest ~25 and went straight to bed with Amusement
below 15: 7.4 % of one worker's on-lot hours in one seed. At −5 there is room for an evening TV session first, and
the result is 0.0 % in 5/5 seeds. At-work Amusement stays at the backlog #12 value of −2/h.

### 5.7 Levers evaluated and left alone
- **Critical self-preservation override** (preservation ≤ 15 behaves like feral). With the Chill-Rest and the spray
  urgency (`autoMax 35`), no seed on any difficulty reached the critical band for long. The worst stay-home freshness
  sample was 25 (normal) and 19 (grim). The only failure seen was a household with no freshness source left at all,
  which an override cannot fix.
- **Difficulty multipliers** (0.7/1.0/1.3; freshness 0.6/1.0/1.4). They already separate the difficulties clearly:
  freshness 51 / 58 / 73, limbs 11 / 8 / 0.
- **Spray value and price**, and **sleep decay (#12)**: unchanged.

### 5.8 Review round (independent skeptics, seeds 1001–1010)

Two independent scripts (now `tests/balance/verify_1_*.test.ts`) found the first round's claims did not hold on
other seeds. The cause was one gap in the fun economy, plus two smaller systemic issues the reruns exposed.

| finding (skeptic seeds) | before | after |
|---|---|---|
| B worker Amusement < 15 (seed 1007, Party Animal Necro-Tech) | **11.8 %** of 391 on-lot hours, lowest 0 (1004: 3.1 %) | **0.0 %** (script 1), ≤ 0.5 % (script 2) |
| worst single non-sleep interaction share (normal) | **28.7 %** (Sybil, TV, 1007); 28.2 % / 25.6 % (1004), 25.3 % read (1002) | **22.5 %** (skeptic), **19.9 %** (own seeds) |
| worst non-essential runs / zombie / day | **7** (TV ×7, 1004 d13; social_joke ×7 over two partners, 1007 d21) | **6** (never above the limit) |
| B funds slope, seed 1007, after the TV change only | −5 $/day (3 fires; the burned stove's ash blocked its spot for 2 days) | **+17 $/day** |

**Root cause: the TV could not refill a worker.** A day-job worker spends Amusement on three fronts. For a Party
Animal (fun decay ×1.2) the daily cost is:
- about 35 for roughly 6.5 awake on-lot hours at 5.4/h;
- 16 for the shift at −2/h;
- 13 overnight (×0.3 while asleep).

That is about 64 a day, to be earned in a waking window of about 6 hours that also has to fit meals and a shower.
At +14/h the TV nets only +8.6/h. So the worker watched TV for most of their free time (28 % of waking time),
went to bed at Amusement ~14 and woke at 0. The traces show the same pattern every workday (d4–d6, d11–d13).
Fixes:
- **Watch TV 14 → 20 Amusement/h** (net +14.6/h for a Party Animal);
- **Read 8 → 11/h**, the starter's second fun source.

Both still stop at Amusement 98. The faster refill also fixes the share and spam findings, because a bored zombie
needs fewer, shorter sessions. Rejected alternative: a lower sleep Amusement multiplier (0.3 → 0.15). It would fix
the overnight drop but not the evening TV marathon, and it would undo backlog #12's documented numbers.

**Systemic: ash was never swept.** Clean Up on `item_ash` had adBonus 6, exactly the idle threshold, so any walking
distance (attenuation `1/(1 + path/14)`) left it below the threshold. A burned stove's ash pile stayed on its tile
indefinitely. It blocked the replacement stove ("Something's in the way") for two days while the household lived on
$5 jerky. The fix is **adBonus 12**. Ash only exists after a fire, so the chore is mess-gated and cannot loop. The
regression test is `tests/unit/engine/balance.real.test.ts` "autonomy sweeps up ash": it fails at 6 (verified) and
passes at 12.

**Fires: 4 % → 3 % per cook at cooking 0** (0 from cooking 3). Three-zombie households still had 3–5 fires in 21
days. With one entry-level wage, a 3-zombie household nets only about +$20 a day, and one $400 stove loss mid-window
turned the day-7+ slope negative.

**Harness: socials count as one interaction.** Spam detection now counts each social over all partners, as the rule
is written. Previously each partner was counted separately. The worst count is still 6.

Unchanged and rechecked: sleep decay (#12), at-work rates, preservation weights, difficulty multipliers, wages,
bills.

Tests whose expectations encoded the old numbers were updated: `tests/unit/home/upkeep.test.ts` (TV +10 in 30 min,
was +7) and `tests/unit/home/food.test.ts` (fire chance 3 %, 0 at 3+). In `balance.test.ts`, "relaxed loses fewer
limbs than normal" became `≤`, because normal now loses 0 limbs in 14 days, so relaxed can only tie it.

### 5.9 Review round 2 (independent skeptics, seeds 2001–2010 and 3001–3010)

Two more scripts (`tests/balance/verify_2_1.test.ts`, `verify_2_2.test.ts`) found two targets not met. Both were
systemic, not tuning noise.

| finding (skeptic seeds) | before | after |
|---|---|---|
| A stay-home preservation < 15 (seed 3001, 3 zombies) | **30.2 %** of 973 on-lot hours, lowest 0; Cuthbert crumbled on day 13 | **0.0 %**, lowest 35, no crumble (all 40 A runs: 0.0 %, lowest 31) |
| most non-essential runs / zombie / day (seed 2009 B, Janet) | **7** social_joke on day 13 (4 to Ron, 3 to Earl) at Amusement 76–93 | **6**; 0 runs above 6 in 30 + 80 runs |

**Root cause 1: one refrigerated coffin, used 6 hours a day.** Seed 3001's kitchen fire on day 6 took the fridge.
From then on the unattended household had no spray, and the starter's Chill-Rest (§5.3) was its only freshness
source. It only restores while someone sleeps in it, and zombie sleeps are 3–5 h (12 Energy/h), so the three zombies
together used it about 6 h a day; the rest of the time they decayed at 1.3/h. Pine-coffin sleep only halts decay,
and the sofa nap and the dirt plot halve it. Preservation fell from ~50 on day 6 to 0 on day 10. Fix: **Chill Out**,
a new interaction on the Chill-Rest and the Cryo Sarcophagus. The zombie lies in the cold, awake, for 60 min:
+10 Freshness/h (net +8.7/h on normal), power required. Autonomy considers it only below Freshness 40, with the
spray's urgency (+0.8 per point below 40). It is data (`content/home/interactions/care.ts`, behaviour `activity`).
After the fix, seed 3001's freshness stays between 34 and 57 over 14 days, with about 16 hours of Chill Out after day 7 (hourly samples).
Time rather than money mends it; that is the trade-off against the $15 spray.

Rejected alternatives:
- A critical override (preservation ≤ 15 → feral-like). It would not help: the only object left to pick was the
  occupied or energy-gated coffin.
- Moving the fridge away from the stove. A fire event spreads up to twice along adjacent flammables, so a counter between
  them only delays it, and a burned fridge in an unattended game is a legitimate event.

**Root cause 2: the repetition penalty fades.** The 6-hour window's 0.6ⁿ bonus factor recovers between sessions, so
a liked social came back every ~3 h, 7 times on one day. Several other runs sat at exactly 6. Fix: a **daily cap**
in autonomy (`repetition.ts`, `DAILY_PICK_CAP = 6`). A non-essential interaction id (socials pooled over partners) is
scored 0 once a zombie has picked it 6 times that game day. The tally is counted at pick time, so interrupted runs
count, and is kept in `flags['engine:picks:<agentId>']` (WorldState, so save/load and lockstep determinism hold;
pruned hourly). Essentials, critical overrides and player orders are never capped. With it the target is a
guarantee, not a statistic.

Tests added:
- `tests/unit/engine/dailycap.test.ts` (3): an irresistible hobby is picked ≤ 6 times on every day and reaches the
  cap again the next day; the tally survives a JSON reload, and essentials are never counted; junk, stale and orphan
  tallies are ignored and pruned.
- `tests/unit/engine/balance.real.test.ts` (2): a fridgeless 3-zombie household keeps its freshness up through Chill
  Out (fails with Chill Out removed from the coffin: 0 sessions); Chill Out's numbers, and autonomy never picks it at
  Freshness ≥ 40.

Changed expectation: `balance.test.ts` "relaxed ends richer than normal" was `> normal + $200`; it is now
`> normal` (+$147 measured). Normal's low freshness is now mended with free coffin time instead of sprays, so money
separates the two difficulties less. Freshness (71.0 vs 60.5) and limbs (0 vs 3) still separate them clearly.

Not changed by this round: the B, Bc and D sweep runs reproduce §6 exactly. With the Embalming Station and the bought
Chill-Rest, nobody falls below Freshness 40 and nobody reaches the cap, so the extra candidate never wins a pick and
no random draw changes.

## 6. Final per-run metrics (`npm run balance`, all levers above, including the review rounds in §5.8 and §5.9)

| run | zombies | survived | 1st crumble | stay-home worst need <15 | worker fun <15 | funds start→end | slope d7+ $/d | bills paid/issued | late/cuts/repo | fires | limbs | met/friends | faults/viol |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A/11 | 2 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7000→6288 | -67 | 3/4 | 0/0/0 | 0 | 0 | 12/1 | 0/0 |
| A/22 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6484 | -90 | 3/4 | 0/0/0 | 0 | 2 | 22/3 | 0/0 |
| A/33 | 2 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7000→6346 | -61 | 3/4 | 0/0/0 | 0 | 0 | 15/2 | 0/0 |
| A/44 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6650 | -79 | 3/4 | 0/0/0 | 2 | 1 | 43/3 | 0/0 |
| A/55 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6672 | -72 | 3/4 | 0/0/0 | 3 | 0 | 20/3 | 0/0 |
| B/11 | 2 | 21/21 | — | social 0.8% | 0.0% | 7000→4970 | 48 | 5/6 | 0/0/0 | 0 | 0 | 18/1 | 0/0 |
| B/22 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 7500→4980 | 16 | 5/6 | 0/0/0 | 0 | 0 | 27/3 | 0/0 |
| B/33 | 2 | 21/21 | — | hunger 0.0% | 0.0% | 7000→5534 | 49 | 5/6 | 0/0/0 | 8 | 0 | 19/2 | 0/0 |
| B/44 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 7500→5180 | 34 | 5/6 | 0/0/0 | 5 | 0 | 36/3 | 0/0 |
| B/55 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 7500→6165 | 86 | 5/6 | 0/0/0 | 1 | 0 | 16/3 | 0/0 |
| Bc/11 | 2 | 21/21 | — | hunger 0.0% | 0.0% | 7000→4330 | 10 | 5/6 | 0/0/0 | 0 | 0 | 21/1 | 0/0 |
| Bc/22 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 7500→4951 | 22 | 5/6 | 0/0/0 | 2 | 0 | 34/3 | 0/0 |
| Bc/33 | 2 | 21/21 | — | hunger 0.0% | 0.0% | 7000→4291 | 15 | 5/6 | 0/0/0 | 1 | 0 | 24/3 | 0/0 |
| Bc/44 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 7500→4621 | 4 | 5/6 | 0/0/0 | 2 | 0 | 42/4 | 0/0 |
| Bc/55 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 7500→4874 | 8 | 5/6 | 0/0/0 | 0 | 0 | 17/3 | 0/0 |
| D/11 | 2 | 21/21 | — | hunger 0.0% | 0.0% | 17485→15787 | 84 | 5/6 | 0/0/0 | 1 | 0 | 16/1 | 0/0 |
| D/22 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 17685→15215 | 30 | 5/6 | 0/0/0 | 4 | 1 | 29/3 | 0/0 |
| D/33 | 2 | 21/21 | — | hunger 0.0% | 0.0% | 17485→15454 | 48 | 5/6 | 0/0/0 | 2 | 0 | 22/1 | 0/0 |
| D/44 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 17685→15464 | 45 | 5/6 | 0/0/0 | 0 | 0 | 46/3 | 0/0 |
| D/55 | 3 | 21/21 | — | hunger 0.0% | 0.0% | 17685→15212 | 19 | 5/6 | 0/0/0 | 1 | 0 | 18/3 | 0/0 |
| Cg/11 | 2 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7000→6094 | -81 | 3/4 | 0/0/0 | 1 | 1 | 6/1 | 0/0 |
| Cg/22 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6177 | -117 | 3/4 | 0/0/0 | 2 | 1 | 21/3 | 0/0 |
| Cg/33 | 2 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7000→6206 | -68 | 3/4 | 0/0/0 | 0 | 0 | 12/1 | 0/0 |
| Cg/44 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6325 | -110 | 3/4 | 0/0/0 | 1 | 1 | 34/3 | 0/0 |
| Cg/55 | 3 | 14/14 | — | preservation 1.3% | 0.0% (—) | 7500→6456 | -101 | 3/4 | 0/0/0 | 1 | 4 | 11/3 | 0/0 |
| Cr/11 | 2 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7000→6361 | -55 | 3/4 | 0/0/0 | 0 | 0 | 21/1 | 0/0 |
| Cr/22 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6734 | -71 | 3/4 | 0/0/0 | 1 | 0 | 32/3 | 0/0 |
| Cr/33 | 2 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7000→6347 | -60 | 3/4 | 0/0/0 | 3 | 0 | 22/1 | 0/0 |
| Cr/44 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6834 | -61 | 3/4 | 0/0/0 | 0 | 0 | 41/3 | 0/0 |
| Cr/55 | 3 | 14/14 | — | hunger 0.0% | 0.0% (—) | 7500→6897 | -52 | 3/4 | 0/0/0 | 0 | 0 | 27/3 | 0/0 |

Columns:
- *stay-home worst need < 15*: the stay-at-home zombies' worst need, as a share of their on-lot hours.
- *worker fun < 15*: the same share for the worker's Amusement.
- *slope*: least-squares slope of the daily funds from day 7.
- *met/friends*: relationships of household members (met, friendship ≥ 35).

The per-zombie detail (needs min/avg, skills, careers, top interactions, money flow by reason) is printed by the sweep.

Career levels after 21 days:
- Mortuary Sciences L2 in 4/4 runs (the Embalming Station trains the skill).
- Culinary L2–L3 and Retail L2.
- Necro-Tech and Politics stay at L1. They need Logic 2 or Charisma 2, and autonomy builds those skills only
  incidentally (the bookshelf's Logic genre, the mirror).

Skills at day 21:
- Cooking 2–6 for everyone.
- Charisma 2–8 for the sociable zombies.
- Mortuary 1–5 with the station.

Money, B seed 22 (3 zombies, Mortuary L1 → L2 on day 18):
- in: wages $2,207;
- out: bills $670, groceries $822, embalming $150, raven $61, jerky $35;
- windfall: a $500 lottery ticket.

## 7. Remaining risks

- **Behaviour is chaotic per seed.** The first round's 0.0 % worker-boredom claim held on its 5 tuning seeds and
  failed on 1 of 10 other seeds. Rerun `npm run balance` with no file filter (the sweep plus the four `verify_*`
  scripts, 110 runs, about 37 min) after any autonomy, needs or content change. The CI subset alone (3 runs) will not catch a one-seed regression.
- **One entry-level wage with three zombies is thin:** about +$16–35/day (B) and +$4–22/day (Bc). One burned
  appliance costs $400–450, about two to three weeks of that surplus. Every 21-day run stays positive after the
  fire, ash and fun fixes, but a fourth zombie or two fires in a week would tip it negative. Necro-Tech and Politics
  stay at L1, because autonomy does not chase Logic or Charisma for promotions.
- **Fires per run still vary widely** (0–8 in 21 days at 3 %). Greasy stoves (×1.5) and the Grease-Fire stove
  (×1.25) dominate for cooking-0–2 households.
- **Grim TV share reaches 24.6 %** (was 34 % before the faster TV). The 25 % rule is for normal only.
- **The 6/day limit is now a hard cap** (§5.9), so spam cannot exceed it, but a sociable zombie still reaches 6 of
  one social on some days. If that reads as repetitive in play, lower `DAILY_PICK_CAP` or the social weights; the
  cap only stops the 7th pick, it does not change what is picked first.
- **Chill Out is free.** It costs only time, and only below Freshness 40, but a player could order it at any
  Freshness below 90. The money gap between relaxed and normal shrank from about $260 to $147, because normal
  households now spray less. Normal unattended limb losses rose from 0 to 3 in 14 days (5 seeds); mean freshness
  rose 59 → 60.5.
- **The four skeptic scripts are now the best regression net.** Seeds 2001–2010 and 3001–3010 each exposed a defect
  the 5 tuning seeds and the first 10 skeptic seeds did not. Keep running all of them.
- **Reverting backlog #12's at-work Amusement change** (−2 back to −4), or the TV rate, would bring worker boredom
  back. Rerun the sweep first.
