# W-043 Social: friends, visits, gifts, Help, Crews and safe messaging (online, Phase 4)

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §4 (owner direction),
MONETIZATION §1 (minors: no free-text UGC under 15, teen spend cap, neutral age gate, bracket-only storage), §7
(Phase 4 online), `src/economy/age.ts` (brackets, younger-only moves), D-010 (Phase 4 server = Python FastAPI,
server-authoritative), D-024 (Laya, server-side, fine-tune before trusting), housing-progression.md §7 (Help on
timers), contests-newsletter.md (voting uses friend graph for anti-abuse), L7 §4.4 (publishing blueprints), docs/
SECURITY.md (threat model style).

Everything here is **online-only and additive**: offline play never waits on it, and no sim state depends on a
server answer except through journaled inbox commands (§6).

## 1. Player fantasy

*"My friend Pru's zombies left a Gift Box on my porch and three of her crew hit Help on my renovation while I was at
work. I visited her mansion, left a 'Love the gargoyles!' note and helped her basement dig. Our Crew is 14 points from
the weekly goal."*

Async, cosy, cooperative. No live multiplayer in v1 (L7 §4.4), no PvP, no trading, no money between players.

## 2. Accounts, names and age bands

- **Account** (Phase 4): email or platform sign-in (Steam). The client keeps today's neutral age gate; the server keeps
  an **age band** (C39): `u15 | 15-17 | 18+` (the client still stores only `AgeBracket`, MONETIZATION §1).
  Bands only move younger from the client (age.ts rule); moving older needs the parent/support flow.
  The edges follow D-082 (the child profile is under 15): u15 is the child band (preset-only everywhere below).
  The stored record cannot tell under-13 from 13–14 (`bracketForAge` returns the legacy `under13` for both), so the
  consent rule is set for the whole band: **every u15 account needs VPC before any online feature** (stricter than
  COPPA's under-13 threshold; counsel confirms the policy).
- **Every u15 account needs verifiable parental consent (VPC)** before any online feature (COPPA: a friends list and
  persistent identifiers are personal information). Method: "email plus" while nothing a child types is disclosed to
  others (our u15 features are preset-only, §5), with a parent dashboard (§9). Without VPC a u15 player plays
  offline exactly as today.
- **Display names:** u15 = generated from curated word lists (`MossyBones742`), never typed. 15+ = typed, 3–20
  chars, letters/digits/one space, through the name filter (§7) and Laya `name` policy; renames 1 per 30 days. Real
  names, numbers ≥ 4 digits, and handles of other platforms are blocked.
- **Friend code:** 12 characters Crockford base32 with a check digit, shown as `ZMB-7K2Q-9XPA`, plus a QR (same
  payload, `al://friend/<code>`). Codes rotate on request (old code stops working).

## 3. Friends

| Rule | Value |
|---|---|
| Add by | friend code / QR (all bands); **username search: 15+ only**, and a 15–17 account is not findable by search from 18+ accounts |
| Requests | pending outgoing ≤ 50; expire after 14 days; ≤ 20 sends per day; decline is silent |
| Friend cap | 200 (u15: 50) |
| u15 | every new friend needs parent approval in the dashboard (default ON; parent may switch to "approve automatically for friend codes entered in person") |
| Cross-band | u15 can only friend u15 and parent-approved accounts; 18+ ↔ 15–17 friendships need a friend code (no search) |
| Remove | instant, silent |
| **Block** | mutual invisibility: no requests, visits, gifts, helps, messages, contest pairings with each other; removes friendship; never revealed to the blocked person |
| **Report** | from any profile/message/visit/contest entry: reason enum (`harassment`, `inappropriate_name`, `inappropriate_content`, `spam`, `asking_personal_info`, `self_harm_concern`, `cheating`, `other`) + the server attaches the context automatically (the last 20 messages of that thread, the entry id). Reporting also offers Block/Mute in one tap |
| Mute | hides messages from a person without blocking (15+) |

**Friend list UI** (phone app *Friends*, and main menu → Friends): online-recently dot (coarse: "today", "this week";
never live presence for u15), household name, HL, home class + renovation level, last visit. Actions: Visit, Message,
Gift, Help (if they have a project), Invite to Crew, Remove, Block, Report.

## 4. Async visits, gifts and Help

### 4.1 Visits
- A **Home Card** is published by the server for each signed-in player who opts in (default ON for 15+, OFF for u15
  until the parent enables it): the home lot as a blueprint (L7 BlueprintV1: walls, floors, objects; no items, no money,
  no relationships, no free text), the household's appearances (CAZ records, display name of the household from a
  curated list for u15, typed + filtered for 15+), class/level, and the running projects (kind, % done). Size ≤ 220 KB;
  re-published at save time at most once per real hour.
- **Visiting** opens the friend's Home Card as a **read-only community-style lot** in your game: your selected
  zombies travel there (W-025 travel, a "Friend's Place" pin on the map), their household appears as visiting-host NPCs
  with simple scripted idles (no sim autonomy over their state), and you can: admire objects, take photos (W-028), use
  a few safe objects (sit, watch TV, read), and do the three social actions below. Nothing you do changes their save;
  everything reaches them as **inbox items**. Your zombies get the normal visit moodlets/needs.
- Determinism: the visit lot is built from the Home Card (data) + your seed; it never touches your home snapshot.

### 4.2 Gifts
- **Gift Box** (sent from Visit or the Friends app): one item chosen from a **curated gift list**: a free-tier decor
  object instance from a rotating list of 12, 1 Builder's Coffee, a Postcard (a framed photo from your gallery, image
  moderated, §7.4), or a Bouquet. The recipient finds it on the porch / in the mailbox as a placeable item.
- **Limits:** 3 sent per real day per sender, 1 per recipient per day, 10 received per day (overflow waits in the
  inbox). Accounts younger than 7 days or friendships younger than 48 h can't gift.
- **No value transfer:** gifts are never $, Bones, GG, materials beyond 1 coffee, or entitlements; a gifted object
  sells for **$0** and salvages to nothing (anti-laundering, anti-alt farming). Opening a gift: *Gifted with Love* (+6,
  12 h).

### 4.3 Help on timers
- From the friend list or a visit: **Help** on a running project (housing-progression.md §7.1). Effect on the
  recipient: −max(15 min, 0.02 B) of the project's timer, 1 per helper per project, ≤ 10 helps per project in total
  (townie + online). Helps queue in the inbox while the recipient is offline.
- Helper reward: 2 Bones per help, ≤ 10 Bones per day (daily task "Help 3 friends", 8 Bones), so helping is pleasant
  but never a Bones farm.
- **Ask for Help** button on a project card: notifies friends and crew once per project (no spam loops).
- Anti-abuse: helps only from friendships ≥ 48 h and accounts ≥ 7 days old with HL ≥ 2; same-device/same-payment
  clusters are counted once (server); helps always count toward the free reduction cap, so alt accounts can at most
  replace coffee.

### 4.4 Phone integration
The in-game phone (exists: Invite Over, Party, Pizza…) gains a **Friends** app (list, messages, requests) and
**Calls from real friends** arrive as phone notifications ("Pru's household sent a Gift Box"). Townie calls are
unchanged. There are no voice calls (out of scope v1).

## 5. Messaging: safety tiers

| Band | What you can send | To whom | Defaults |
|---|---|---|---|
| **u15** | **preset phrases + emotes + stickers only** (no free text in or out; u15 never *receives* free text either) | parent-approved friends; Safe Crews | messaging **off until the parent enables it** in the dashboard |
| **15–17** | presets + **filtered text** (≤ 140 chars) | friends who are 15–17; Open Crews (15–17 only); 18+ only if mutual friends added by code/QR and the parent setting allows (default **off**) | text ON with friends; strangers cannot message |
| **18+** | presets + filtered text | friends; Open Crews | — |

- **Preset phrase set:** ~220 phrases in 10 categories (greetings, compliments, building, help, events, contests,
  thanks, goodbyes, emote reactions, crew), each an id (`pp_hello`, `pp_loveTheGargoyles` …) translated client-side.
  Phrases never contain blanks the user can fill. 40 animated emotes and 24 stickers (all original art).
- **Never allowed in text** (pre-filter, all bands): URLs, emails, phone numbers, street addresses, social handles,
  digit runs ≥ 4 (spaced/obfuscated forms included), images. A blocked message shows "That message can't be sent: it
  looks like personal info" (no echo of what matched).
- **Rate limits:** 5 messages / 10 s, 300 / day (15+); presets 60 / 10 min (u15).
- Threads: 1:1 with friends and one Crew board per Crew. No group DMs with non-friends. History kept 30 days (§8).
- Voice chat: out of scope v1 (owner direction).

## 6. Inbox: how online events reach a deterministic sim

All social effects that touch a save (gift arrives, help applied, crew reward) come down as **inbox items** with a
server-signed id. The client applies them only through a journaled sim command at a tick boundary:

```ts
// src/sim/contracts.ts (C38)
| { type: 'inbox'; items: { id: string; kind: 'help' | 'gift' | 'crewReward'; projectId?: string; giftDefId?: string; from: string /* hashed friend id */ }[] }
// SimEvent
| { type: 'inbox'; applied: string[]; refused: { id: string; reason: string }[] }
```

The sim records applied ids (`WorldState.inbox?.applied`, last 500, plus per-project `helpers`) and refuses
duplicates; the journal replays the exact same command, so replay is byte-identical and a reloaded save never
double-applies. Profile-level effects (Bones for helping) go through the economy ledger with key
`help:<helpId>`.

## 7. Moderation pipeline (server)

```
client ─► API gateway (auth, rate limit, size) ─► normaliser (NFKC, confusables, leetspeak, spacing)
      ─► deterministic filters (blocklists per locale, PII regexes, URL/handle detectors, repeat/spam heuristics)
      ─► Laya classifier (D-024, server-side) → typed decision per category
      ─► policy table per age band → allow | mask | block | hold-for-review
      ─► deliver / store (30-day retention) / queue for human review
```

### 7.1 Laya (D-024) role and gating
- Laya returns typed decisions for categories `harassment`, `hate`, `sexual`, `self_harm`, `grooming_risk`,
  `pii_request` ("what school do you go to"), `spam`, `scam`, `other_ok`, with calibrated scores.
- **Fine-tune before trust** (D-024: 0.362 zero-shot vs 0.766 fine-tuned on its benchmark). Gate for enabling free text
  at all: on our labelled eval set (≥ 5,000 messages incl. adversarial obfuscations, per launch locale),
  **recall ≥ 0.95 for `grooming_risk` + `pii_request` + `sexual`** at the 15–17 threshold, false-block rate on
  ordinary chat ≤ 5 %. Until met: Laya runs in **shadow mode**, 15+ text is limited to friends only, with the
  deterministic filters and a stricter blocklist; the presets-only fallback for everyone is the kill switch.
- Thresholds are stricter for 15–17 than 18+ (table in the moderation config, versioned, changes reviewed).
- `self_harm` hits are never just blocked: the sender sees a supportive message with regional helpline links (curated
  list), and the item is escalated (P1).

### 7.2 Human review
- Queues: **P0** child-safety (grooming risk, sexual content involving minors): page on-call, review ≤ 1 h; preserve
  evidence; legal reporting obligations (US: NCMEC CyberTipline for apparent CSAM; we accept no images in chat, so the
  expected source is Postcards/contest images, §7.4). **P1** self-harm, threats: ≤ 4 h. **P2** reports and held
  content: ≤ 24 h. **P3** names/titles: ≤ 72 h.
- Sanctions ladder: warning → 24 h chat mute → 7-day social suspension → permanent social ban (offline play always
  kept). Appeals via support (Laya triage per D-024, human decision).

### 7.3 Names, Crew names, titles
Same pipeline with the `name` policy (stricter: no slurs in any language, impersonation of staff, brand marks per
IP_NOTES). u15 never types names.

### 7.4 Images (Postcards, contest entries)
Only game-rendered images (gallery photos) can be sent, and only as Postcards to friends. Server checks: the image
decodes as our JPEG profile (W-028: 1280×720, q 0.85), an image-safety classifier, and perceptual-hash dedupe against
known-bad hashes. u15 can send/receive Postcards only with parent-approved friends, and only images taken in-game.

## 8. Data retention (social)

| Data | Retention |
|---|---|
| Messages | 30 days, then deleted (reports keep the attached context 1 year) |
| Friend graph, blocks | until account deletion |
| Visits / helps / gifts logs | 90 days (anti-abuse) |
| Moderation decisions | 1 year (appeals, repeat-offender logic) |
| IP addresses | hashed with a rotating salt, 30 days, only for abuse clusters |
Account deletion removes all of it within 30 days (except legal holds). Policy text is in telemetry.md §8 (one privacy
policy).

## 9. Parent dashboard (u15 and 15–17)

Web page reached from the parent's email: approve/deny friends, enable/disable messaging (u15: presets), Home Card
publishing, contests participation, Postcards; view the friend list (not message content, except reports involving
the child); set the teen spend cap (MONETIZATION §1); request data export/deletion. Every change takes effect on the
next sync.

## 10. Crews (clubs)

- Create at HL 5 (15+) or join by invite code. ≤ 30 members. One crew per player.
- **Crew type** fixed at creation: **Safe Crew** (any age; presets only for everyone; name from curated words) or
  **Open Crew** (15+ only; filtered text; band rules of §5 still apply per pair: a 15–17 member never sees 18+ free
  text — those messages show as "(message hidden)" and the crew board warns adults that minors are present).
- Roles: Leader (1), Officers (≤ 3), Members. Leader can kick, rename (moderated), set crew emblem from parts.
- **Crew goals (weekly):** sum of members' helps, completed projects, contest entries; tiers at 50/150/300 points pay
  each member 20/40/60 Bones + a crew banner cosmetic at the top tier. No paid crew boosts.
- **Crew board:** messages (§5), "Ask for Help" posts, contest entry shares.

## 11. Server API sketch (FastAPI, D-010)

All endpoints JSON over HTTPS, auth = short-lived bearer (OAuth/Steam session ticket exchange), idempotency key header
on every POST, rate limits per route. Pydantic models mirror `src/shared/social.ts` (C37).

| Method & path | Body / query | Returns | Notes |
|---|---|---|---|
| `POST /v1/friends/requests` | `{code}` or `{username}` (15+) | `{requestId}` | band rules §3 |
| `GET /v1/friends` | — | `FriendSummary[]` | coarse presence |
| `POST /v1/friends/requests/{id}:accept` / `:decline` | — | — | u15: may return `pending_parent` |
| `DELETE /v1/friends/{friendId}` | — | — | |
| `POST /v1/blocks` / `DELETE /v1/blocks/{id}` | `{userId}` | — | |
| `POST /v1/reports` | `{targetKind, targetId, reason}` | `{reportId}` | context attached server-side |
| `PUT /v1/homecard` | `HomeCardV1` (≤ 220 KB) | `{version}` | validated with the blueprint harness |
| `GET /v1/homecard/{friendId}` | — | `HomeCardV1` | friends only |
| `POST /v1/gifts` | `{to, giftDefId, postcardId?}` | `{giftId}` | limits §4.2 |
| `POST /v1/helps` | `{to, projectId}` | `{helpId}` | 1 per helper per project |
| `GET /v1/inbox?after=` | — | `InboxItem[]` (server-signed) | applied via `inbox` command (§6) |
| `POST /v1/inbox:ack` | `{ids}` | — | |
| `POST /v1/messages` | `{threadId, presetId?, text?}` | `{messageId, decision}` | pipeline §7 |
| `GET /v1/threads/{id}/messages?after=` | — | `Message[]` | 30-day window |
| `POST /v1/crews` / `POST /v1/crews/{id}/join` / `.../leave` / `.../kick` | … | … | |
| `GET /v1/crews/{id}` | — | `CrewView` (goals, members, board) | |
| `GET /v1/parent/...` | parent session | dashboard data | separate auth realm |
| `POST /v1/account:delete` / `GET /v1/account/export` | — | — | privacy rights (§8) |

Storage: Postgres (users, friendships, blocks, crews, inbox, reports), Redis (rate limits, presence), object storage
(Home Cards, Postcards). Laya served on GPU inference nodes behind an internal queue (p95 ≤ 150 ms per message;
on queue overflow messages are **held**, never passed unchecked).

## 12. Abuse cases

| Case | Mitigation |
|---|---|
| Adult grooming a minor via search | no search into 15–17 from 18+; u15 friends parent-approved; no free text for u15; PII filters + Laya `grooming_risk`/`pii_request` P0 queue; block/report one tap |
| Sharing contact info in obfuscated text ("five five five…") | normaliser + digit-word detector + Laya `pii_request`; 15–17 threshold strict |
| Bullying via notes/messages | rate limits, mute/block, report with auto context, sanctions ladder |
| Alt accounts farming Helps/Bones | account ≥ 7 days, friendship ≥ 48 h, HL ≥ 2, device/payment clustering, helps count under the free cap, 10 Bones/day helper cap |
| Gift laundering / RMT | gifts have no $ value, can't be sold/salvaged, no currency transfer exists |
| Offensive Home Card (builds) | object placement can't form text easily, but obscene shapes are possible: report → hide Home Card pending review; repeat offenders lose publishing |
| Impersonating staff | name filter; staff accounts have a verified badge rendered by the client from a signed claim |
| Spam crew invites | invites only to friends; ≤ 20 per day |
| Doxxing via Postcards | in-game renders only; image classifier; perceptual-hash checks |
| Harassment of contest creators | contest voting is anonymous; no comments on entries in v1 |
| Self-harm disclosures | supportive response + helplines + P1 escalation |

## 13. Acceptance tests

| # | Test |
|---|---|
| 1 | Band matrix: every (sender band, receiver band, relation) combination yields exactly the §5 permission (table-driven, server + client) |
| 2 | u15 cannot send or receive free text by any route (messages, names, crew board, Home Card, gift notes) |
| 3 | PII filter corpus (≥ 500 obfuscated phone/email/address/URL/handle forms) blocked 100 %; false-positive corpus ≤ 2 % |
| 4 | Laya gate: shadow-mode metrics computed per locale; text cannot be enabled by config unless the gate thresholds are recorded as met |
| 5 | Inbox: applying the same items twice or replaying the journal yields one effect; WorldState byte-identical to a single application |
| 6 | Help limits: 1 per helper per project; 11th help refused; helps count toward the housing free cap |
| 7 | Gifts: limits per sender/recipient/day; gifted object sells for $0 and salvages to nothing |
| 8 | Block: blocked users never appear in pairings, search, friends, inbox, visits |
| 9 | Deletion: account delete removes messages, Home Card, friend edges within 30 days (job test) |
| 10 | Offline: with the server unreachable, the game runs with no errors and no social UI dead-ends ("Offline" state) |

## 14. Open questions for the lead

| Id | Question | Default |
|---|---|---|
| Q-S1 | Server-side age bands `u15/15-17/18+` (the client bracket edges, D-082; the server keeps the band)? | yes (C39) |
| Q-S2 | every u15 account online requires VPC (email plus), and messaging is off until a parent enables presets? | yes |
| Q-S3 | Text chat ships only after the Laya recall gate; presets-only until then? | yes |
| Q-S4 | Postcards (game-rendered photos) to friends in v1, or later? | v1 with image checks; off for u15 unless parent enables |
| Q-S5 | Visiting = read-only Home Card lot (no live multiplayer) for v1? | yes |

## References

- FTC COPPA amendments (published 22 Apr 2025, effective 23 Jun 2025, compliance by 22 Apr 2026; persistent
  identifiers and notice changes): [Wiley alert](https://www.wiley.law/alert-FTC-Adopts-Amended-Childrens-Online-Protection-Act-Rule),
  [Fenwick](https://whatstrending.fenwick.com/post/coppas-coming-of-age-key-compliance-changes-in-ftcs-final-rule),
  [PRIVO](https://www.privo.com/blog/understanding-new-coppa-amendments).
- UK ICO Age Appropriate Design Code (high-privacy defaults, profiling/geolocation off by default):
  [ICO code PDF](https://ico.org.uk/media/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services-2-1.pdf).
- Age-banded chat in a large UGC platform (bands, under-13 restrictions):
  [PC Gamer on Roblox age checks for chat](https://www.pcgamer.com/gaming-industry/roblox-to-make-facial-age-checks-mandatory-to-access-any-chat-features-and-will-put-common-sense-limits-on-the-age-ranges-users-can-chat-within),
  [Roblox DevForum](https://devforum.roblox.com/t/age-checks-to-access-chat-studio-team-create-and-links-on-roblox/4079702).
  We adopt banding as a mechanic; we do **not** adopt facial age estimation (biometric data, now COPPA personal
  information) — Q for counsel if bands need stronger assurance.
- Help-on-timers mechanics: see housing-progression.md References.
