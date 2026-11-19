# Afterlife Lease — Economy, Store & Sponsorship Spec (v1.1 "Economy Foundation")

Owner decisions (2026-11-05): **E10+** rating target · **Web + Steam first** · single paid currency **Grave Gold** · start now.
Contract types: `src/shared/economy.ts`. This doc is the source of truth; code that diverges from it is a P0 bug.

## 1. Three kinds of money — never mixed

| Money | Scope | Earned by | Spent on | Authority |
|---|---|---|---|---|
| **Household funds ($)** | per save (WorldState) | jobs, selling, sim events | bills, basic catalogue, build | deterministic sim (unchanged; balance targets in BALANCE.md still bind) |
| **Bones** | per player profile (all saves) | quests, daily tasks, achievements, aspirations, season track | unlocking premium catalogue items, cosmetics, cast bodies in rotation | **local profile ledger** offline; server ledger when signed in (Phase 4) |
| **Grave Gold (GG)** | per account | real-money purchase only (+ small season-track grants) | bundles, premium items, season pass, boosts | **server only** (Phase 4). Offline/dev builds can never mint GG. |

Rules:
- Unlocks are **entitlements** (profile/account level), not world items. Buying an unlocked item into a lot still costs household $ at its sim price, so the sim economy and balance never depend on real money.
- **No paid randomness.** No loot boxes, gacha, mystery packs or paid re-rolls — every paid thing shows exactly what you get. (FTC v. Cognosphere/HoYoverse, Jan 2025; EU CPC Key Principles on in-game virtual currencies, 21 Mar 2025.)
- **Price transparency:** every GG price shows its real-money equivalent next to it (computed from the cheapest GG pack's rate, local currency). Bundles list their contents and the sum of the parts. GG packs are sized so common bundle prices can be bought without forced leftovers (offer exact-amount top-ups).
- **14-day withdrawal** for unused purchases (EU); refunds/chargebacks revoke entitlements through the server ledger.
- **Boosts sell convenience, never win the sim**: career XP ×1.25 for 7 game days, +1 household slot, extra build lot slots, instant "skip night". No paid need-fillers that bypass gameplay.
- **Minors (E10+):** under-15 accounts: no purchases without verified parental consent (COPPA; its own threshold is under 13), no ads personalisation, no free-text UGC (offline: zombie, household and save names are picked from preset lists — also while the age question is unanswered; 15+ keeps free text). 15–17: monthly spend cap (default $25); changing it needs the parent gate, which does not exist offline, so the cap is read-only until the Phase 4 parent account. Age gate is neutral (year-of-birth asked once; store only the bracket). The bracket only moves younger from the client; an older bracket needs the parent flow (fails closed offline). **Fail closed:** the stored bracket is sealed; a missing-but-previously-decided, corrupt, unverifiable or hand-edited record resolves to under-15, never back to the gate. Limit: the seal is not a secret (a client key is public), and wiping ALL local data is indistinguishable from a fresh install offline — only the account-level bracket (Phase 4, server) closes that.

## 2. Earning Bones — quests & tasks (offline, Phase 2)

- **Quest system** = a sim plugin system (`quests`) so progress is deterministic and saved in the world: quest defs are content data (`QuestDef`: id, title, steps with objective predicates over sim events/state, rewards). Completing a quest emits `questCompleted` with a stable `grantId`.
- **Grants are idempotent per profile:** the sim's `questCompleted`/achievement events carry a world grant id (`<worldId>:<questId>:<instance>`, `worldId` = `state.quests.worldId`, derived once and stored — an *unmodified* copy of a save shares it). `worldId` and `flags` are save data that an edited or shared save can change (its checksums are unkeyed), so the profile — not the save — decides eligibility (`src/economy/grantPolicy.ts`, security review H-1): one-off quests are keyed per profile (`profile:<questId>:1`, paid once across all worlds); repeatable quests and achievements stay per world but are capped at 600 Bones per profile per local day across all worlds; a save's `flags.cheated: true` is remembered by the profile, `false` is never trusted. The profile ledger refuses duplicates (reload/replay/undo can never double-pay). Grants re-requested from a loaded save's grant record (crash recovery) are paid the quest **definition's** reward, and only for worlds this profile created (new game); an imported save is never reconciled and the quests already in progress inside the file pay nothing when they complete — only progress made after the import earns.
- **Daily tasks** (3/day, profile-level, rotate at local midnight from a seeded pool, e.g. "Cook 2 meals", "Make a friend", "Fix something broken") and **weekly challenges**. Streak bonus capped.
- Bones earn rate target: an engaged free player can unlock one premium item every ~45 min of play; a full themed set in ~1 week. Tunable via remote config later.
- **Profile ledger** (`economy/ledger`): append-only entries `{seq, ts, kind: grant|spend|refund, currency, amount, grantId|sku, prevHash, hash}` hash-chained (SHA-256), written crash-safely on the existing storage backend with the ProfileStore's rotate-to-backup + checksum pattern (own keys, so recovery can inspect both copies) plus a high-water mark kept in the ProfileStore (truncation detection). A storage *read error* is never treated as an empty ledger. The local ledger holds Bones only and never records an entitlement that is sold only for GG / real money (those are server entitlements). Locally it detects corruption only (a single-player client cannot keep a secret) — the server ledger is the authority for GG. Every local ledger view and export is marked `trust: 'local-unverified'`, and `acceptAsAuthoritative` (`src/economy/ledgerTrust.ts`) refuses it: the Phase 4 server must never import a local balance, entitlement, `quests.grants`, `worldId` or `flags` as truth (security review M-1).

## 3. Store (Phase 2 UI, Phase 4 payments)

- Catalogue tiers on every buyable def: `free` | `bones` (price in Bones) | `premium` (GG) | `sponsor` (free, brand skin).
- Store screen tabs: Featured · Bundles · Items · Bodies · Boosts · Season · Grave Gold. Owned items marked. Real-money equivalents always visible.
- **SKUs** (`StoreSku`): id, kind (item|bundle|body|boost|season|ggPack|subscription), contents, priceBones?, priceGG?, priceUsdCents (GG packs and the directly priced offers in §8 — Starter Pack, Afterlife+; never together with priceGG), availability window, ageMin, platform availability.
- **Payments (Phase 4):** Web → Stripe Checkout (server creates session; webhook credits GG to server ledger) with Stripe Tax enabled; Steam → Steam MicroTransactions (ISteamMicroTxn InitTxn/FinalizeTxn from our server; Steam requires in-app purchases on Steam builds go through the Steam Wallet). Client never credits itself.
- Offline/dev builds: store browsable; GG purchase buttons show "Sign in to buy" (Phase 4). A `DevWallet` exists only in dev builds (`import.meta.env.DEV`), stripped from production bundles (test asserts).

## 4. Sponsor slots & house brands (Phase 2)

- Any catalogue object may declare `brandSlots` (mesh parts / texture regions: logo decal, label, livery colour, display name, flavour text). A **BrandSkin** (content pack data) fills them. Skins are swapped by remote config / content pack without code changes and can be disabled instantly (kill switch).
- **No real trademarks without a signed license.** Launch set = original house brands only, e.g. Mulch Master (ride-on mower), Grave-Cola (vending machine/fridge), Volt-Hearse (EV in the driveway), Brain Bran (cereal), Rot-Pop (soda), Coffin Coffee, Crypt-Kicks (sneakers), Necro-Tech (computers). Names must not imitate real marks (legal review checklist in docs/IP_NOTES.md).
- Real brand deal checklist (docs/SPONSORSHIP.md, Phase 3): brand-safety review (E10+ comedic tone, no gore near logos, brand never "infected"), creative approval loop, flight dates, geo/age targeting (none for under-15), impression reporting.
- **In-world ad surfaces** (Phase 4 SDK integration, e.g. an intrinsic in-game ad network — web and mobile builds only, 15+ only, contextual only; never on Steam builds, §10): TV screen, street billboards, magazine rack, bus stop. Phase 2 ships the `AdSurface` abstraction fed by house-brand creatives only. Opt-in rewarded ad ("watch for 50 Bones", max 5/day, never for under-15, never forced, **never on Steam builds** — Valve does not allow rewards for watching ads, §10).

## 5. Content packs (Phase 2 format; Creator Kit + marketplace = Phase 3)

- Pack = zip/dir with `pack.json` (id, version, author, ageRating, requires engine version, contents: objects, brandSkins, quests, lots, bodies), assets, and a detached signature over the canonical manifest + asset SHA-256 list.
- Loader: validate schema → verify every asset hash → verify signature against allowed publisher keys (first-party key for now) → register content. Any failure = pack rejected with a clear message; the game never half-loads a pack.
- Unsigned local packs allowed only in "Creator mode" (dev/offline), clearly labelled, never in online/shared towns.

## 6. Season pass "Season Lease" (Phase 3)
8-week seasons, free track (Bones, cosmetics) + paid track (GG, ~950 GG) with themed quests. No FOMO dark patterns: season items return later in the store.

## 7. Phasing
1. **1.0 ship** (in progress).
2. **Economy foundation (now, offline-safe):** quests + daily tasks, Bones profile ledger, catalogue tiers, store UI (browse/unlock with Bones; GG locked behind sign-in), house-brand sponsor skins + BrandSlot rendering, AdSurface abstraction, pack format + verifier, age gate + parental flags, analytics event schema (consent-gated, no PII).
3. **Necropolis + Creator Kit + MCP server**, season pass.
4. **Online services:** accounts, server-authoritative wallet/ledger, Stripe + Steam payments, receipts/refunds, marketplace + moderation, ads SDK, remote config.

## 8. Grave Gold price ladder & offers (benchmarked 2026-11-05)

Benchmarks (US list prices, third-party-reported; verify in each store before launch):
- **COD Points:** 1,100 / $9.99 · 2,400 / $19.99 · 5,000 / $39.99 · 9,500 / $74.99 · 13,000 / $99.99. Bonus grows with tier (+10 % → +30 %). The 1,100 pack exactly buys the base Battle Pass.
- **Fortnite V-Bucks (from 19 Mar 2026):** 800 / $8.99 · 2,400 / $22.99 · 4,500 / $36.99 · 12,500 / $89.99. Battle Pass = 800, so the smallest pack buys it.
- **Robux:** 400 / $4.99 · 800 / $9.99 · 1,700 / $19.99 · 4,500 / $49.99 · 10,000 / $99.99. Premium subscription $4.99 / $9.99 / $19.99 per month for 450 / 1,000 / 2,200 Robux, plus +10 % on purchases.
- **Minecoins:** 320 / $1.99 · 1,020 / $5.99 · 1,720 / $9.99 · 3,500 / $19.99 · 8,800 / $49.99.
- **Genshin:** $0.99 → $99.99 in 6 tiers; first purchase of each tier doubled once. Welkin Moon $4.99 = 300 now + 90 per day on login for 30 days.
- **The Sims 4:** free base game; revenue from directly priced packs (expansions, game packs, stuff packs, kits). No currency.

**Our ladder** (reference rate 100 GG ≈ $1 at the base tier; larger packs get bigger bonuses, matching the industry):

| Pack | Price | GG | Bonus |
|---|---|---|---|
| Pocket Change | $0.99 | 100 | — |
| Handful | $4.99 | 510 | +2 % |
| Coffin Stash | $9.99 | 1,100 | +10 % |
| Crypt Hoard | $19.99 | 2,400 | +20 % |
| Mausoleum | $49.99 | 6,250 | +25 % |
| Necropolis Vault | $99.99 | 13,000 | +30 % |

**First-purchase double:** the first buy of each pack tier grants double GG once per account. Shown plainly, never time-pressured.

**Starter Pack** ($4.99, once per account, 72 h after first launch, then permanently in the store at the same price): 1,000 GG, one premium cast body, and a 6-item themed set. This is the biggest lever for turning a free player into a paying one.

**Afterlife+ subscription** ($4.99 per month; Steam and web):
- 300 GG on purchase, then 30 GG for each day you log in (up to 900 a month).
- +10 % GG on pack purchases.
- One exclusive cosmetic a month, and cloud saves.
- Cancel anytime. Unclaimed daily grants are listed and never pressured.

**Season Lease:** 950 GG, bought exactly by the $9.99 pack, the same pattern as COD and Fortnite. The premium track pays back about 1,100 GG over the 8-week season, so engaged players can fund the next pass. The free track pays Bones and cosmetics.

**Item price bands (GG):**

| Item | GG |
|---|---|
| Small decor | 150–300 |
| Furniture piece | 300–600 |
| Premium cast body | 500–800 |
| Themed set (8–12 items) | 1,200–1,800 (with sum-of-parts shown) |
| Mega bundle | 2,400–3,000 |
| Boost | 300–700 |

Expansions (new neighbourhoods, careers, life stages) are sold at a **direct real-money price**, like The Sims 4: $9.99 for a stuff pack, $19.99 for a game pack, $39.99 for an expansion. On Steam they are Steam DLC.

**Deliberate deviation from the industry:**
- We do not size items so you are forced to keep leftover currency (EU CPC principle). Every store page offers an exact top-up when the balance is short.
- We do not sell anything random.

Both cost some short-term revenue and avoid the FTC and EU exposure described in §1.

**Creator marketplace payout (Phase 4):** creator-earned GG is tracked separately from purchased GG, the same split Roblox DevEx uses. Only earned GG can be cashed out, at a published rate. Proposal: creators receive about 40 % of the net receipt after platform fees and refunds; to confirm against unit economics. For comparison, Roblox DevEx pays $0.0038 per earned Robux (third-party-reported; DevEx minimum 30,000 Robux), about 30 % of the $4.99 Robux list price.

**Platform fees to model:** Steam takes 30 % of revenue, falling to 25 % after $10M and 20 % after $50M per app. Stripe on the web charges about 2.9 % + 30¢ plus tax handling. Our own web store is the highest-margin channel, so offer the same prices everywhere and add web-only bonus items, never lower web prices.

**Expectations:** simulation games convert payers better than most genres. Xsolla's Q2 2025 report puts simulation's success rate at 10.2 %. Revenue concentrates in a small share of high spenders. The ladder's top tier exists for them, while the under-15 lock and the teen spending cap (§1) apply on every tier.

## 9. Compliance checklist (must be green before Phase 4 ships)
FTC (no deceptive currency/odds; dark-pattern review) · COPPA (under-13 consent) · EU CPC principles (price transparency, withdrawal) · ESRB/IARC "In-Game Purchases" descriptor · Steam MicroTxn policy · Steam advertising policy (no ads business model, no rewarded ads; §10) · Stripe ToS + tax · privacy policy & data deletion · accessibility of store UI · refund/chargeback handling · brand license on file for every real mark.

## 10. Ads & sponsorship at scale

The owner's business planning for ads and sponsorship (W-128) is kept outside this repository. The rules below refine §4. They do not
change §1–§8.
- **Steam builds:** no rewarded ads, no ad SDK, no programmatic ads. Brand skins and posters are allowed only as
  product placement or direct sponsorship that fits the world (Steamworks "Advertising on Steam").
- **Contextual only, for every age**, as proposed policy pending the owner's decision: no ads SDK that reads
  advertising IDs, and no ad personalisation. This is stricter than §1's under-15 rule, and the §1 rule still applies.
- **Under-15:** only house brands and direct, human-reviewed, labelled sponsors from an under-15 category allowlist.
  No rewarded, programmatic or measured-upload ads. These are the §1 minors rules applied to ads.
- **Measurement:** viewability is counted on the device only (IAB in-game thresholds), as aggregate counters with no
  identifiers. Nothing is uploaded until the COPPA lawyer signs off (owner rule). Until then, sponsors buy on
  modelled reach.
- **Kill switch:** per creative, per sponsor and global. An expired or unverifiable config falls back to house
  brands. This extends the instant-disable rule in §4.
