# W-045 Gameplay telemetry: consent, event taxonomy, buffer, dashboards

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §6 (owner direction:
consent-gated, opt-in, off for under-15, no PII, pseudonymous install id, retention limit, deletion on request),
`src/economy/analytics.ts` (shipped: closed event union, `scrub`, consent + bracket gate, no-op sink), MONETIZATION §1
(minors), §7 (Phase 2 schema, Phase 4 server), W-039 auto quality (GPU tier, presets), D-010 (FastAPI), BALANCE.md /
GDD §18 (targets the dashboards watch), housing-progression.md §7.3 (fairness alarm), social.md §8 (retention).

## 1. Principles (binding)

1. **Opt-in, never default-on.** Nothing is recorded or sent until the player says yes. Two separate switches:
   *Gameplay statistics* and *Crash reports*.
2. **Under-15 and unknown age: nothing.** No prompt, no buffer, no crash reports (stricter than COPPA's
   internal-operations allowance, on purpose). This is already how `Analytics.enabled` works and stays so.
3. **No PII, ever.** Events carry only enumerated ids from our own content lists, counts and buckets
   (`scrub()` rejects anything else). No names, typed text, emails, IPs (the server never stores the request IP),
   precise timestamps, device serials or hardware fingerprints.
4. **Pseudonymous install id**, random, resettable, deletable (§6).
5. **Collect only what answers a decision** (§9 lists the question each event answers; an event with no question is
   removed). **Telemetry never affects gameplay** and never runs inside the sim (determinism: it reads SimEvents and
   views in the game layer, like the audio/UI).

## 2. Consent flow

```
first launch → age gate (exists) ──under13/unknown──► telemetry OFF, no prompt (Settings shows "Not available")
                                 └─teen/adult──► Privacy choices dialog
```

- **Privacy choices dialog** (one screen, before the main menu, skippable = both OFF):
  - Title: "Help us make the game better?"
  - Toggle *Share gameplay statistics* (OFF) — "Which features you use and how the game runs. No names or messages."
  - Toggle *Send crash reports* (OFF) — "Technical details when something breaks."
  - Buttons **Save choices** and **No thanks** of equal size and weight; *Learn more* opens the privacy summary (§8).
- **Settings → Privacy:** the same toggles, "Your statistics ID" (copyable, §6), *Reset ID*, *Delete my statistics*.
- Withdrawal: switching a toggle OFF stops recording immediately, deletes the local buffer, and (if any batch was ever
  sent) queues a deletion request for that install id.
- Re-prompt only when the schema's **major** version changes (new purpose), never on minor additions within a purpose.
- A teen whose bracket later moves to under-15 (younger-only moves, age.ts) → telemetry OFF + local deletion +
  deletion request.

## 3. Envelope and batch format

```jsonc
// POST /v1/telemetry/batch  (gzip, ≤ 64 KB uncompressed, ≤ 200 events)
{
  "schema": "al-telemetry", "v": "1.0",
  "batchId": "b_8f3c…",                 // random 128-bit hex, idempotency key (server dedupes)
  "install": "i_2b7e…",                 // random 128-bit hex, created at consent time, resettable
  "session": "s_91aa…",                 // random 64-bit hex per session
  "day": "2026-11-05",                  // UTC date only
  "build": "1.2.0+3f9c2a1", "platform": "web" | "steam" | "desktop",
  "os": "win" | "mac" | "linux" | "other", "locale": "en", "bracket": "teen" | "adult",
  "events": [ { "n": "session_start", "t": 0, "seq": 1, /* fields */ } ]
}
```
- `t` = seconds since session start rounded to 10 s; `seq` = per-install monotonically increasing counter.
- Every field value is an integer, a bucket id or a content id matching `^[a-z0-9_:]{1,64}$` (`scrub`). Booleans are
  sent as 0/1. Numbers are rounded at the source.
- Crash reports use a separate endpoint and envelope (`POST /v1/crash`), only with the crash switch ON (§4.10).

## 4. Event taxonomy (exact names and fields)

Buckets: `len` minutes `0_5|5_15|15_30|30_60|60_120|120p`; `$b` funds `lt0_1k|1k_5k|5k_15k|15k_50k|50kp`; `ms`
`lt100|100_500|500_2k|2k_5k|5k_15k|15kp`; `fps` `lt20|20_30|30_45|45_60|60p`; game day `gd` = integer 1..365 (capped).

### 4.1 Session & settings
| Event | Fields |
|---|---|
| `session_start` | `entry: menu\|continue\|file_open`, `gpuTier: low\|mid\|high\|unknown`, `preset: auto\|low\|medium\|high\|ultra`, `ram: lt4\|4_8\|8_16\|16p`, `first: 0\|1` |
| `session_end` | `len`, `reason: quit\|background\|timeout`, `gameMinutes` (rounded to 60) |
| `settings_changed` | `key` (enum of settings ids), `value` (enum id or bucket) |

### 4.2 Funnel & onboarding
| Event | Fields |
|---|---|
| `funnel_step` | `step: boot\|menu\|new_game\|lot_chosen\|caz_open\|caz_done\|first_live_min\|first_buy\|first_build\|first_quest\|first_save\|gd2\|gd7\|gd30`, `lot` (template id, when known), `ms` (time since previous step) |
| `hint` | `hintId`, `action: shown\|dismissed\|followed` |
| `caz_done` | `members: 1..4`, `classic: n`, `cast: n`, `randomised: 0\|1` |

### 4.3 Quests & Bones (extends shipped events)
| Event | Fields |
|---|---|
| `quest_started` / `quest_done` / `quest_abandoned` | `questId`, `category: story\|neighbourhood\|daily\|cast`, `gd` |
| `bones_granted` (exists) | `source: quest\|daily\|weekly\|streak\|achievement\|contest\|help\|fair\|event`, `amount` |
| `bones_unlock` (exists) | `skuId`, `priceBones` |
| `body_unlocked` | `bodyId`, `via: cast_call\|bones\|gg\|grandfather\|starter_pack` |

### 4.4 Store & Grave Gold (shipped events kept as they are)
`store_opened`, `store_tab`, `sku_viewed`, `gg_purchase_attempt`, `age_gate_answered`, `ledger_issue` (exact shapes in
`analytics.ts`), plus `gg_spend` {`skuId` (`boost:rush` for Rush Order), `amount`} — purchase *receipts* are counted
server-side from the payment ledger, not from the client.

### 4.5 Sim economy & balance (one compact summary per game day per world, at 00:00)
| Event | Fields |
|---|---|
| `day_summary` | `gd`, `members`, `funds: $b`, `income` and `spend` per channel rounded to $10: `inWage`, `inSale`, `inCraft`, `inRent`, `inOther`, `outBills`, `outBuild`, `outBuy`, `outFood`, `outPreserve`, `outProject`, `outOther`; `lateBills`, `powerCut: 0\|1`, `repo: 0\|1` |
| `needs_summary` | `gd`, household-summed hours below 15 per need: `hHunger`, `hEnergy`, `hPres`, `hSocial`, `hFun`, `hHygiene` (capped 0..200); `limbsLost`, `fires`, `crumbles`, `feral` |
| `life_event` | `kind: promotion\|fired\|skill_up\|married\|turned\|rot_stage\|legendary_party\|game_over`, `id` (careerId / skillId / stage), `level`, `gd` |
| `difficulty` | `value: relaxed\|normal\|grim` (on new game and change) |

### 4.6 Housing (W-042)
| Event | Fields |
|---|---|
| `project_started` | `kind`, `target`, `class`, `reno`, `hl`, `baseH` (rounded to 0.5) |
| `project_done` | `kind`, `target`, `class`, `baseH`, `actualH`, minutes reduced per source rounded to 15: `rPitch`, `rCoffee`, `rFavour`, `rTownie`, `rFriend`, `rTips`, `rRush`; `cancelled: 0\|1` |
| `limit_hit` | `limit: objects\|rooms\|storey\|basement\|household`, `class`, `reno` |
| `household_level` | `hl`, `gd` |
| `move_house` | `fromClass`, `toClass`, `hl`, `gd` |

### 4.7 World & travel (W-025, W-046)
| Event | Fields |
|---|---|
| `trip` | `fromLevel`, `toLevel`, `mode: carpool\|vehicle\|walk\|transit`, `minutes` (rounded to 5) |
| `unlock` | `kind: level\|town\|city\|region`, `id`, `gd` |
| `fair_entry` | `category`, `place: 1..8` |

### 4.8 Social & contests (Phase 4; counts only, never content)
| Event | Fields |
|---|---|
| `friend_added` | `via: code\|qr\|search` |
| `social_action` | `kind: visit\|gift\|help\|ask_help\|crew_join\|crew_leave`, `giftDefId?` |
| `message_sent` | `kind: preset\|text`, `presetId?` (presets only) |
| `report_sent` | `reason` (social.md §3 enum) |
| `contest_entry` | `category` |
| `votes_session` | `pairs`, `skipped` |
| `dailygrave_open` | `edition: local\|weekly`, `section?` |
| `photo_taken` | `source: phone\|selfie\|lookout\|photoMode` |

### 4.9 Performance
| Event | Fields |
|---|---|
| `perf_sample` (every 5 real minutes of rendering, max 24 per session) | `fps50`, `fps5` (p50/p5 buckets), `p95ms` (frame time bucket), `preset`, `gpuTier`, `pixelRatio: 1\|1_25\|1_5\|2`, `drawCalls` (rounded to 50), `heapMb` (rounded to 100), `lotKind: residential\|community\|workplace`, `agents` (rounded to 5) |
| `quality_auto` | `from`, `to`, `reason: probe\|downgrade_p95\|user` (W-039) |
| `load_time` | `phase: boot\|world_load\|lot_swap\|save`, `ms` |

### 4.10 Errors & crashes
| Event | Fields | Switch |
|---|---|---|
| `fault_contained` | `where: sim\|render\|ui\|audio\|persistence`, `sig` (`e_` + 8 hex: hash of error name + top 3 frames *function names* only; no paths, no messages) | statistics |
| `save_issue` | `status: recovered_backup\|corrupt\|quota\|lock_timeout` | statistics |
| crash report (`/v1/crash`) | `sig`, `build`, `platform`, `os`, `gpuTier`, minified stack with paths stripped to file basenames, last 20 event names (no fields) | crash |

The shipped `ALLOWED_KEYS` grows to the union of the field names above (C42); unknown keys are still dropped and any
non-matching string still voids the event.

## 5. Local buffer (Phase 4 sink)

- Store: ProfileStore object store `telemetry` (C43), separate from saves and the ledger. Ring buffer **≤ 2,000
  events or 512 KB**, oldest dropped first.
- **Flush:** every 5 real minutes, at `session_end`, and on `visibilitychange: hidden` (web: `navigator.sendBeacon`;
  Electron: main-process fetch). A batch is removed from the buffer only after a 2xx.
- **Retry:** exponential backoff 30 s → 60 min; batches older than 7 days are dropped unsent.
- **Phase 2 (now):** the sink is the no-op sink, so **nothing is buffered** (the buffer is only created when a real
  sink is configured). Offline single-player sends nothing.
- Never blocks the frame: writes are batched per second and deferred to idle time; telemetry failures are swallowed
  (as `Analytics.track` does today).

## 6. Identity, retention, deletion

| Data | Retention | Notes |
|---|---|---|
| Raw events | **90 days** | then deleted |
| Daily aggregates (per build × platform × gpuTier × bracket cell) | 25 months | a cell is stored only with ≥ 20 distinct installs (k-anonymity floor) |
| Crash reports | 180 days | |
| Install id ↔ events | until reset/deletion | the install id is not linked to an account; signed-in players' telemetry still uses only the install id |

- **Reset ID:** new random install id; old data ages out (or is deleted if the player also asks).
- **Delete my statistics:** sends `DELETE /v1/telemetry/install/{id}`; the server deletes raw events and crash reports
  for that id within **30 days** and confirms in-game on the next launch. Aggregates already below the k-anonymity
  floor are not re-identifiable and stay.

## 7. Server sketch (FastAPI, D-010)

`POST /v1/telemetry/batch` (validates against a JSON Schema generated from the TS union; rejects unknown keys/values;
dedupes `batchId`; does not log the IP; writes to an append-only event store, e.g. Postgres partitioned by day or
ClickHouse), `POST /v1/crash`, `DELETE /v1/telemetry/install/{id}`. Nightly jobs: aggregates, the 90-day purge,
k-anonymity checks, dashboard refresh.

## 8. Privacy policy points (to include; counsel to finalise)

1. What we collect (the §4 categories in plain words) and what we never collect (names, messages, contacts, location,
   IP storage, advertising ids).
2. Why: fixing crashes, performance on different hardware, and balancing the game (§9).
3. Legal basis: consent (opt-in); withdraw any time in Settings → Privacy.
4. Children: no telemetry for players under 15 or of unknown age; for online accounts, the social policy (social.md)
   and parental controls apply.
5. Identifiers: a random statistics ID you can see, reset and delete.
6. Retention periods (§6) and deletion within 30 days on request.
7. Processors and storage location (to fill: hosting provider, region); no sale or sharing for advertising; no
   profiling for ads; no personalised ads (MONETIZATION §4).
8. Security: TLS in transit, access-controlled storage, minimal staff access.
9. Rights (GDPR/UK GDPR/CCPA-style): access, deletion, objection; contact address.
10. Changes: a new purpose re-asks for consent (§2).

## 9. Dashboards and the questions they answer

| Dashboard | Events | Questions (decisions it informs) |
|---|---|---|
| **Onboarding funnel** | `funnel_step`, `hint`, `caz_done` | Where do new players drop (menu → CAZ → first build)? Which hints get dismissed unread? Is CAZ too long? |
| **Retention** | `session_start/end`, `funnel_step gd2/gd7/gd30` | D1/D7/D30 by lot choice and difficulty; session length trends after each patch |
| **Sim balance** | `day_summary`, `needs_summary`, `life_event`, `difficulty` | Do real households match GDD §18 (crit-need hours < 5 %, funds trend up after day 7, 0 repo/power cuts for engaged players)? Which need fails first? Fire/limb rates vs harness |
| **Economy ($)** | `day_summary` channels | Are hobbies below wages (levels README §5)? Is any money source dominating? Are projects the main late-game sink? |
| **Bones & store** | `bones_granted`, `bones_unlock`, store events, `body_unlocked` | Is one premium unlock per ~45 min of engaged play real? Which earn paths are never completed? Which SKUs are viewed but locked by age/cap? |
| **Housing fairness** | `project_*`, `limit_hit`, `household_level` | Median actual/base duration; **paid share of reductions per HL band (alarm > 25 %)**; which limits players hit first; HL pace vs spec (HL 5 by day 21) |
| **World** | `trip`, `unlock` | Which levels are visited; travel time pain; unlock pacing |
| **Social & contests** (Phase 4) | §4.8 | Help/gift usage; preset vs text share; report rates per 1,000 messages; contest participation; votes per entry ≥ 30? |
| **Performance** | `perf_sample`, `quality_auto`, `load_time` | Do we hit 60 fps on mid GPUs and ≥ 30 on integrated (TEAM_PLAN §8)? Does Auto pick the right preset (W-039)? Lot swap ≤ 2 s? |
| **Stability** | `fault_contained`, `save_issue`, `ledger_issue`, crashes | Top crash signatures per build; save recovery rates; regressions per release |

## 10. Acceptance tests

| # | Test |
|---|---|
| 1 | under13 / unknown: no dialog, `track()` records nothing, no buffer store is created, crash endpoint never called |
| 2 | Consent OFF by default; "No thanks" and closing the dialog both leave both switches OFF |
| 3 | `scrub` property test: random objects with extra keys, free text, NaN, nested values → dropped or voided; every §4 event shape passes |
| 4 | Schema parity: the server JSON Schema is generated from the TS union in CI; a client event the server rejects fails CI |
| 5 | Buffer: cap 2,000 / 512 KB holds; batch removed only on 2xx; duplicate `batchId` accepted once server-side |
| 6 | Withdrawal deletes the local buffer and queues the deletion request once |
| 7 | Determinism: a BALANCE run with telemetry enabled vs disabled → byte-identical WorldState (telemetry reads, never writes) |
| 8 | Perf: telemetry adds < 0.1 ms per frame on the stress scene (p95), measured |
| 9 | Crash report contains no absolute paths, user names or messages (fixture with a path in the stack) |

## 11. Open questions for the lead

| Id | Question | Default |
|---|---|---|
| Q-T1 | No telemetry at all for under-15 (not even internal-operations crash data)? | yes |
| Q-T2 | Raw retention 90 days, aggregates 25 months with a k ≥ 20 floor? | yes |
| Q-T3 | Event store: Postgres partitions (simple) vs ClickHouse (scale)? | Postgres first |
| Q-T4 | Move the event union to `src/shared/telemetry.ts` (C42) so server schema generation has one source? | yes |

## References

- FTC COPPA amendments (2025; persistent identifiers, retention and notice requirements):
  [Mondaq: enforcement begins](https://mondaq.com/unitedstates/privacy-protection/1771468/enforcement-begins-soon-for-significant-coppa-rule-amendments),
  [Perkins Coie](https://perkinscoie.com/insights/update/ftc-announces-new-childrens-privacy-requirements-updated-coppa-rule).
- UK ICO Children's Code (data minimisation, high-privacy defaults, profiling off by default):
  [ICO code PDF](https://ico.org.uk/media/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services-2-1.pdf),
  [gov.uk guidance](https://gov.uk/guidance/child-online-safety-data-protection-and-privacy).
