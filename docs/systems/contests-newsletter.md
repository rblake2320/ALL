# W-044 Rate-it contests, The Daily Grave newsletter, live events

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §5 (owner direction: weekly
rate-it contests for Zombie, Ride, Home, Room, Lot, Pet; 1–5 ratings from random pairs; anti-abuse; The Daily Grave;
rank earned by votes only; free + premium event tracks), MONETIZATION §1/§6 (no paid randomness; Season Lease;
no FOMO), photo-mode.md (Photo Mode, gallery, share cards; no upload before Phase 4), L7 §4.1/§4.4 (BlueprintV1,
validation harness, "Doff Hat"), social.md (moderation pipeline, age bands, friend graph), housing-progression.md
(Featured Builder booster, Build-off Week), body-tiers.md (Mascot Cast Call), D-024 (Laya).

Online contests are Phase 4. An **offline Wormwood Fair** (§8) gives every player the same loop without a server.

## 1. Player fantasy

*"This week's Room theme is 'Cosy Crypt'. I lit the basement with forty candles, framed it in Photo Mode and entered.
Thursday to Sunday everyone rates pairs of rooms. Monday morning The Daily Grave lands on the porch: my crypt made the
top 10, I got Bones, a Featured badge and my renovation crew works faster this week."*

## 2. Contest structure

| Item | Rule |
|---|---|
| Categories | `zombie`, `ride`, `home`, `room`, `lot`, `pet` |
| Cadence | two categories per week on a 3-week cycle: wk A **Zombie + Room**, wk B **Home + Pet**, wk C **Ride + Lot**; a **Grand Rot-Off** (all six, best-of-month entries, invite-only for that month's top 20) on the last weekend of each month |
| Week (UTC) | Mon 00:00 theme announced (Daily Grave) · Mon–Thu 23:59 submissions · Fri 00:00 – Sun 23:59 voting · Mon 00:00 results in the weekly Daily Grave |
| Themes | from a curated list (≥ 52 per category, original), e.g. Zombie: "Sunday Best", "Gym Rot", "Grandparent Chic"; Room: "Cosy Crypt", "Haunted Home Office"; Home: "Curb Appeal on a Budget"; Lot: "Garden of Unearthly Delights"; Ride: "Hearse Couture"; Pet: "Spa Day for Strays". Theme fit is up to voters |
| Entry limit | 1 entry per category per contest per account |
| Eligibility | signed in, HL ≥ 2, account ≥ 3 days; u13 only with the parent's "contests" toggle (social.md §9) |
| Divisions & prizes | **Open** (all entries), plus two prize lists drawn from the same ranking: **Scrappy Prize** (best entries using no `premium` (GG) items: free, bones and free sponsor items only; verified from the snapshot's tier stats) and **New Builder** (best entries from HL ≤ 8) |

The Scrappy and New Builder prizes are how "buying gives an edge, never a lock" works for contests: a payer's premium
decor can help in Open, but a free player always has prize lists where premium items can't count.

## 3. Submission (via Photo Mode)

1. In Photo Mode (W-028) or the CAZ/Garage/Home panels, **Enter Contest** (visible during submission days).
2. The client builds a **structured snapshot** for the category, never a free-form upload:

| Category | Snapshot | Server render (what voters see) |
|---|---|---|
| zombie | CAZ appearance record (`ZombieAppearance` + body) + rot stage | turntable 3 views, neutral studio, the category's standard lighting |
| ride | vehicle def + customisation record (vehicles.md §6) | 3/4 front + side |
| pet | pet appearance record (pets W-013) | 3/4 + close-up |
| room | BlueprintV1 subset clipped to one room's bounds + its storey | cutaway iso, top-down |
| home | BlueprintV1 of the lot exterior shell + yard | street view + iso |
| lot | full BlueprintV1 (incl. basement if any) | iso + top-down + one interior cutaway |

3. Optional **hero photo**: one gallery image of the player's choice (moderated as an image, social.md §7.4). It is
   shown only on the entry's detail page and in the Daily Grave if featured, never in voting (fair comparisons).
4. **Title:** u13 = curated word list; 13+ = ≤ 40 chars typed, through the name/title pipeline (social.md §7.3).
5. **Server validation:** schema → blueprint harness (L7 §4.1: placement, reachability) → **entitlement check**
   (every premium/bones item in the snapshot is owned by the submitter, so nobody fakes premium items) → duplicate
   detection (canonical-JSON SHA-256 + a near-duplicate score on object sets, so copying another player's published
   blueprint is refused unless it is the submitter's own) → render on the render workers (headless, deterministic
   camera rigs; the same Three.js renderer code run in a GPU worker; output WebP).
6. The entry shows "Submitted ✓" with its server renders. Withdraw allowed until submissions close.

## 4. Voting

- **Where:** Daily Grave app → "Rate entries", the Necropolis Gallery kiosk (L7), and main menu → Contests.
- **What the voter sees:** a **pair** of entries from the same category (server renders, titles hidden until after the
  vote to reduce name bias), and gives each **1–5 stars** (owner direction). Keyboard: `1–5` for left, `Shift+1–5` for
  right, `Enter` next. A "Can't decide" skip exists (no penalty).
- **Pair outcome** used by the ranking: `o = clamp(0.5 + (sA − sB) / 8, 0, 1)` (a 5 vs 1 is a full win; equal stars
  a draw). Stars also feed the displayed average (§5.3).
- **Never shown to a voter:** their own entries, entries by friends, crew mates and blocked users, and entries by
  accounts sharing the voter's device/payment cluster.
- **Caps:** 100 pairs per account per day; votes count only from accounts ≥ 3 days old with HL ≥ 3.
- **Voting rewards** (encourage voting, not ranking): 1 Bone per 10 pairs, ≤ 10 Bones/day; daily task "Rate 20 pairs"
  (8 Bones).
- Anonymous: creators see their rank and star average, never who voted.

## 5. Ranking math

### 5.1 Live (during voting): Glicko-1 per entry, for pair selection
- Each entry: rating `r` (init 1500), deviation `RD` (init 350). Each pair outcome updates both entries with the
  Glicko-1 formulas, the outcome weighted by the voter's reputation `w` (§6.1) by scaling the update term by `w`.
- **Active pair selection:** 70 % informative (pick the eligible entry with the highest RD, then an opponent whose `r`
  is within 1 RD and that this voter hasn't seen), 20 % uniform random, 10 % **calibration pairs** (pairs with a strong
  known consensus from earlier votes, used to score voters).
- Each entry gets ≥ 30 comparisons before voting closes (the selector prioritises entries below 30; with N entries
  and V daily pairs the server checks `V × 2 ≥ 30 N` and widens the voting window by up to 24 h if not met).

### 5.2 Final (after voting closes): weighted Bradley–Terry with a prior
- Fit `θ_i` (entry strength) by maximising `Σ_votes w_v · [o·log σ(θa − θb) + (1 − o)·log σ(θb − θa)] − Σ_i θ_i² / (2·1²)`
  (Gaussian prior N(0, 1)), with Newton–Raphson or MM iterations to convergence (`|Δθ| < 1e-6`).
- Uncertainty `σ_i` from the diagonal of the inverse Hessian.
- **Rank score = θ_i − 2σ_i** (a conservative lower bound: entries with few or split votes rank below well-supported
  ones). Ties broken by the number of comparisons, then submission time.
- Entries with < 30 weighted comparisons are not eligible for the top 10 (they still get participation rewards).
- Results are reproducible: the vote log + the fit code + a fixed iteration order produce byte-identical results
  (audit job).

### 5.3 Displayed stars
Bayesian average per entry: `(C·m + Σ w·s) / (C + Σ w)`, with `m` the category's mean star of the week and `C = 20`,
shown with one decimal. Stars are for display; the rank uses §5.2.

## 6. Anti-abuse

### 6.1 Rater reputation `w` ∈ [0.1, 1.0]
- Starts at **0.5** (after 20 votes; before that a voter's pairs count at 0.25).
- Weekly update after a contest closes, from agreement with the final fit on **decisive pairs** (`|θa − θb| ≥ 1`):
  `w = clamp(2 × (agree − 0.5) + 0.1, 0.1, 1.0)` over the last 200 decisive pairs, blended 50/50 with the previous `w`.
  Calibration-pair failures count double.
- Per-vote zero weight when: decided in < 1.2 s; the voter's left/right or star distribution over the last 50 pairs is
  degenerate (≥ 85 % same side or same star); the voter is in a flagged cluster (§6.2).

### 6.2 Vote rings and collusion
- **Creator lift:** for each (voter v, creator c) compute the sum of residuals `Σ (o − σ(θc − θopp))` over v's pairs
  that include c's entries; a z-score ≥ 4 over ≥ 5 such pairs marks the edge v → c as suspicious.
- **Ring detection:** build the bipartite graph of suspicious edges; find dense blocks (≥ 3 voters × ≥ 2 creators,
  density ≥ 0.6) with a biclique search (as in collusion-detection literature); add co-registration signals (device id
  hash, payment fingerprint, IP hash within 30 days, accounts created within the same hour).
- **Actions:** ring voters' weights → 0 for the contest (retroactively; the fit is re-run); an entry whose weighted
  wins come > 30 % from flagged voters is disqualified for the week; repeat (2 contests) → contest ban 30 days.
  Friends are already excluded from each other's pairs, so ordinary friends can't "accidentally" ring.
- **Human review:** every top-10 entry, Scrappy/New Builder winner and Editor's Pick is reviewed before publication
  (theme fit is *not* judged, only rules and safety).
- **Never purchasable:** votes, vote weight, rank, entry slots, visibility in pairs, Featured status. No SKU may carry a
  contest effect (catalogue test). GG players get no extra entries.

## 7. Rewards

| Result (per category, Open ranking unless stated) | Bones | Other |
|---|---|---|
| Valid entry (participation) | 30 | `stat contestEntries +1` (Mascot Cast Call, body-tiers.md) |
| Top 50 % | +20 | — |
| Top 10 % | +80 | 3 Builder's Coffee (housing) |
| Top 10 | +150 | badge cosmetic `cosmetic:badge_top10_<category>` |
| **Featured** (top 3 Open, top Scrappy, top New Builder, 2 Editor's Picks) | +250 | **Featured Builder** booster (housing: next 3 projects B × 0.9), a frame cosmetic `cosmetic:frame_featured_<category>_<yyyyww>`, the Daily Grave feature with the hero photo |
| Grand Rot-Off winner (monthly) | +500 | trophy decor object `trophy_rotoff` (free-tier, $0 resale) + a nameplate on the Necropolis Gallery wall (L7) |

- Bones are granted through the server ledger with key `contest:<contestId>:<entryId>:<tier>` (idempotent).
- Bones scale check: a typical participant (2 entries/week, top 50 %) earns ~100 Bones/week, well under the ~260
  Bones per engaged hour budget (levels README §5). Featured is rare and meaningful, never needed.
- Editor's Picks rules (published): favour first-time and small creators; never premium-only entries twice in a row;
  creators can't be picked two weeks in a row.

## 8. Offline: the Wormwood Fair (works today, no server)

A weekly in-sim event so offline players get the same "make something, show it, win a ribbon" loop.

- **When:** every game Sunday 10:00–14:00 at the L1 Corner Park (next to the L1 Sunday Swap Meet), or the household lot
  if the park isn't built yet. Entry from the Daily Grave app or the notice board until Saturday 23:59.
- **Judges:** 3 seeded townies (the "Fair Committee"), chosen per week from the townie roster by `hash(seed, 'fair',
  week)`. Each category has a deterministic score from sim state with ±5 % judge taste from the `fair` RNG stream
  (`ctx.stream('fair')`, C1, so worlds without the Fair stay byte-identical):

| Category | Score inputs (0–100 each, weighted) |
|---|---|
| zombie | Passing (W-027) 40, rot stage 20, outfit/accessory variety 20, mood 20 |
| room | room environment score 60, object variety 20, lighting objects 20 |
| home | lotValue band 30, renovation level 30, extensions 20, exterior decor 20 |
| lot | object variety 30, garden/outdoor objects 30, paths/fences 20, rooms 20 |
| pet | pet trust 40, grooming/needs 40, pet bed/bowl owned 20 |
| ride | upgrades installed 40, condition (wear) 30, cosmetics 30 |

- **Townie entries:** 4–7 seeded competitor scores per category (normal around 55 ± 12).
- **Prizes:** Blue/Red/White **ribbon** decor objects (free tier, $0 resale), and Bones via the quests grant path
  (grantId `<worldId>:fair:<week>:<category>`, 40/25/15 Bones; participation 10), `stat contestEntries +1`.
- The result is printed in the next Daily Grave local edition.

## 9. The Daily Grave (in-game newsletter)

### 9.1 Editions and cadence
| Edition | When | Where | Content source |
|---|---|---|---|
| **Local daily** (offline) | every game day 07:00 | mailbox flag + phone app *Daily Grave* + a `newspaper` item on the doorstep (readable: fun +6/h, 10 min) | generated in the game layer from SimEvents and state, deterministic templates |
| **Weekly community** (online) | Mon 00:00 UTC | phone app + main menu tab; cached for offline reading | signed content bundle from the server (CMS-curated) |

### 9.2 Local daily sections (templated, original copy, i18n keys + params)
1. **Headline** from yesterday's most notable household event, by priority: promotion, Legendary party, wedding,
   rot-stage milestone, renovation done, limb lost at a party, fire, contest/Fair placing ("LOCAL GHOUL PROMOTED TO
   SOUS CHEF; KITCHEN STILL STANDING").
2. **Weather & moon** (W-034 forecast blocks, full-moon notice).
3. **Town gossip:** 2 items about townies (friendships, moves, council builds in L7).
4. **Your projects:** crew report with ETAs (housing).
5. **Classifieds:** today's daily tasks, Swap Meet listings (L1), open Cast Calls.
6. **Comic strip:** one panel from a pool of 60 original strips (rotates by day).
7. **House-brand ad** from the AdSurface creatives (MONETIZATION §4; non-personalised; same rule for u13).
Generation never reads `world.rng`; variety comes from `hash(seed, 'dailyGrave', day)`. It writes nothing to the
world (a UI artefact), except the doorstep `newspaper` item, which uses its own stream key.

### 9.3 Weekly community sections
Contest results per category (renders, titles, display names, stars), Scrappy + New Builder winners, Editor's Picks
with the hero photos, next week's themes, the live events calendar (§10), Crew leaderboard (opt-in crews only), patch
notes, "Builder Spotlight" interview (staff-written from a questionnaire with fixed questions; no free text from
under-15s). Only moderated titles and names from players appear; no player-written body text.

### 9.4 Rewards from the newsletter
Being featured (§7). Reading isn't rewarded with currency (no "open the app" bribes), but each weekly edition has a
free **Coupon** for one Builder's Coffee (claim once per account per week; 13+ and u13 alike).

## 10. Live events calendar

Events follow MONETIZATION §6: a free track (Bones, cosmetics) for everyone and an optional premium track
(cosmetics only, GG); event progress is earned only by play; event items return to the store later (no FOMO).

| Event | When (real dates, UTC) | Length | Gameplay | Free track | Premium track |
|---|---|---|---|---|---|
| **Build-off Week** | first full week of each month | 7 days | housing `eventFactor 0.85` for projects started; contest rewards ×1.5 for Home/Room/Lot that week | 5 tiers: Bones, coffee, a build-piece cosmetic | — (none: build speed is never sold as an event pass) |
| **Full Moon Festival** | the weekend nearest each astronomical full moon (dates from a published ephemeris table baked at build time) | 3 days | night interactions ×1.5 fun, moonlit decor quests, L2 séance guaranteed | Bones, moon cosmetics | moonlight outfit set |
| **Halloween Howl** | Oct 20 – Nov 2 | 14 days | W-034 Halloween in every world during the real event (opt-in in Settings for saves not in autumn), trick-or-treat quests | Bones, costumes, the Screamer Cast Call boost (×2 progress) | costume set |
| **The Long Night** | Dec 18 – Jan 2 | 16 days | winter decor quests, snow photo theme | Bones, winter cosmetics | winter set |
| **Rising Day** | 2 weeks around the March equinox | 14 days | spring garden quests | Bones, garden decor | spring set |
| **Summer Rot-Off** | July, 2 weeks | 14 days | a Grand Rot-Off with all six categories open to everyone | Bones, trophy decor | summer set |

Event currency **Candles** (per event, expires with the event and converts to Bones at 1:1 when it ends, so nothing is
lost) is earned only by event quests and contest participation. There is no way to buy Candles or tiers.

## 11. Data model

```ts
// src/shared/contests.ts (C40)
export type ContestCategory = 'zombie' | 'ride' | 'home' | 'room' | 'lot' | 'pet';
export interface ContestDef { id: string /* 'c_2027w03_room' */; category: ContestCategory; themeId: string; opens: string; submitUntil: string; voteFrom: string; voteUntil: string; grand?: boolean }
export interface EntrySnapshot { category: ContestCategory; format: 'afterlife-entry'; version: 1;
  appearance?: unknown; vehicle?: unknown; pet?: unknown; blueprint?: unknown /* BlueprintV1 or room subset */;
  tiers: Record<'free' | 'bones' | 'premium' | 'sponsor', number>; sha256: string }
export interface EntryView { entryId: string; contestId: string; titleId?: string; title?: string; renders: string[]; heroPhoto?: string; stars?: number; rank?: number; prizes: string[] }
export interface VotePair { pairId: string; left: EntryView; right: EntryView; calibration?: boolean /* never sent to the client */ }

// photo-mode (C41): PhotoRecord gains `contest?: { contestId: string; entryId: string }`; render contract gains
// renderEntrySnapshot(snapshot, rig): Promise<Blob> for the server render workers (headless).

// Offline Fair (sim, game layer): WorldState.fair?: { week: number; entries: { category, score, place }[] } (optional, additive)
```

Server (FastAPI, D-010): `GET /v1/contests/current`, `POST /v1/contests/{id}/entries` (snapshot + title + heroPhotoId),
`DELETE /v1/contests/{id}/entries/{entryId}`, `GET /v1/contests/{id}/pairs?n=10`, `POST /v1/votes` (`{pairId, sLeft,
sRight, ms}`), `GET /v1/contests/{id}/results`, `GET /v1/dailygrave/weekly/{yyyyww}` (signed bundle). Jobs: hourly
Glicko update, close-of-voting BT fit + ring detection + review queue, Monday bundle build.

## 12. Acceptance tests

| # | Test |
|---|---|
| 1 | Snapshot validation rejects: invalid blueprint, unowned premium items, duplicates of another account's published blueprint |
| 2 | Pair selection never shows own/friends/crew/blocked/cluster entries (property test over random graphs) |
| 3 | BT fit: on synthetic data with known θ (500 entries, 20k noisy votes), Spearman ρ ≥ 0.9 and the top 10 recovered ≥ 8/10; deterministic output for the same log |
| 4 | Conservative score: an entry with 3 perfect votes ranks below one with 200 votes at 80 % wins |
| 5 | Rings: injected rings of 5–20 voters boosting 1–3 creators are detected with recall ≥ 0.9 at ≤ 1 % false flags on honest synthetic voters |
| 6 | Speed and straight-lining votes get zero weight |
| 7 | Catalogue test: no SKU affects votes, weights, entries or rank |
| 8 | Scrappy eligibility is exactly `tiers.premium == 0` (free, bones and sponsor items allowed; sponsor items are free) |
| 9 | Offline Fair: byte-identical WorldState for worlds that never enter; same seed + same entries → same placings; grant ids unique per week |
| 10 | Daily Grave local edition: same world + day → identical text; never reads `world.rng`; all strings i18n |
| 11 | u13: curated titles only, no hero photo unless the parent enabled Postcards, results show display names only |

## 13. Open questions for the lead

| Id | Question | Default |
|---|---|---|
| Q-C1 | Two categories per week on a 3-week cycle (vs all six weekly)? | yes: keeps vote volume per category high |
| Q-C2 | Server renders for voting (fair, safe) vs player screenshots? | server renders; hero photo only for features |
| Q-C3 | Scrappy + New Builder prize lists as the free-player guarantee? | yes |
| Q-C4 | Offline Wormwood Fair in the sim (needs `ctx.stream('fair')`, C1)? | yes |
| Q-C5 | Keep L7's "Doff Hat" likes for blueprint browsing, separate from contests (X20)? | yes |

## References

- Ranking with uncertainty instead of raw averages: [Evan Miller, How Not To Sort By Average Rating](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html);
  [Evan Miller, Ranking Items With Star Ratings](https://www.evanmiller.org/ranking-items-with-star-ratings.html);
  [Evan Miller, Bayesian Average Ratings](https://evanmiller.org/bayesian-average-ratings.html).
- Pairwise comparison + rater quality + active sampling: [Chen, Jiao, Lin — Bayesian Decision Process for Cost-Efficient Dynamic Ranking via Crowdsourcing (JMLR 2016)](https://jmlr.csail.mit.edu/papers/v17/16-066.html);
  [Crowd-BT (Chen, Bennett, Collins-Thompson, Horvitz)](https://www.erichorvitz.com/crowd_pairwise.pdf).
- Rating deviation for live ratings: [Glicko rating system](https://en.wikipedia.org/wiki/Glicko_rating_system) (Glickman).
- Collusion / vote-ring detection: [Allahbakhsh et al., Detecting, Representing and Querying Collusion in Online Rating Systems](https://arxiv.org/pdf/1211.0963);
  [Araujo et al., A Maximum Independent Set Approach for Collusion Detection in Voting Pools](https://hal-univ-tlse3.archives-ouvertes.fr/INRIA/hal-00788764v1);
  [GroupTie (Penn State)](https://www.cse.psu.edu/~sxz16/papers/grouptie.pdf).
- Creator showcases in life-sims (sharing households/rooms/lots, curated monthly picks favouring small creators):
  [EA Help: The Sims 4 Gallery](https://help.ea.com/help/the-sims/the-sims-4/the-sims-4-gallery),
  [EA: Builds of the Month](https://www.ea.com/games/the-sims/news/november-2018-botm). We learn the *mechanics*
  (share categories, curated picks); every name, layout and asset is ours.
