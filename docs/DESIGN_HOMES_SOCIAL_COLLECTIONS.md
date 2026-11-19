# Free placement, private homes & invites, resale, collections, social feed, wardrobe — owner direction (2026-11-05)

Team: read, then post feedback on PR #1 (`[to-Claude Cloud] feedback: DESIGN_HOMES_SOCIAL_COLLECTIONS …`). Different
models see different risks — say so. Fairness rules (MONETIZATION §1, DESIGN_LIVE_WORLD §8) and E10+ apply throughout.

## 1. Free placement — W-065
Objects can go **anywhere**, arranged the way the player wants: today placement is grid-snapped with 90° rotation.
Add **Free mode** (hold Alt / toggle): sub-tile positions (1 cm), any rotation (15° steps, Shift = free), raise/lower
for wall and surface items, stacking decor on surfaces; collision still prevents interpenetration and blocking
doorways; interaction slots/routing are recomputed for the actual pose (sim stays deterministic: positions stored as
fixed-point integers). Grid mode remains default for speed.

## 2. Private homes & invitations (hideout/lair model) — W-066
- Every home is **private by default**: other players (and their zombies) cannot enter or see inside. From the street
  you see the exterior only (curtains/opaque windows on other players' homes).
- **Invite list** per home: invite friends; invited friends may **come and go as they please** (owner can revoke any
  time); per-friend permissions: visit only / may use objects / may build (co-build, later).
- **Rank gate:** inviting visitors unlocks at **Afterlife Rank 10** (progression §2), co-build at rank 30. Visiting
  others' homes requires being invited only.
- Visitors see everything inside; owner's household and items are view/interact-only (no taking items, no spending
  the owner's money). Online/Phase 4 service (social.md); offline, townies still visit per existing sim rules.

## 3. Selling items — resale at half price — W-067
Sell value for bought items = **50 % of price** (replaces 15 % depreciation; same-session undo still refunds 100 %).
Grave Gold items sell for household $ at 50 % of their $ reference price, **never back to GG**. Collection-only items
(below) cannot be sold or traded, only displayed.

## 4. Collections & earn-only items — W-068
- Item **collections** (e.g. "Graveyard Relics", "Bayou Curios", "Mansion Heirlooms", seasonal sets) shown in a
  Collection Book; completing a set grants a title, Bones and an exclusive display piece.
- Three sources, labelled on every item: **Store** (buyable), **Craft** (salvage recipes), **Earn-only** (quest, daily,
  weekly, event, achievement) — earn-only items are **never purchasable** and can't be sold.
- **Random drops** come only from free gameplay (challenges, digging, fishing, events) — never from anything paid.
  Every drop table has **bad-luck protection** (guaranteed after N attempts) and an alternate deterministic path
  (e.g. trade 5 duplicates or complete a side project) so nothing is ever impossible. Drop odds are shown.

## 5. In-game social feed — W-069
- Collapsible **sidebar feed** (edge tab; collapsed by default in Live mode; never covers more than 25 % of the view;
  hidden in photo mode): friends' posts (achievements, renovations, contest wins, party invites), optional public
  posts from strangers, The Daily Grave headlines.
- **Posts** = auto-generated achievement cards + photo-mode snapshots + preset captions; free-text captions follow
  the messaging safety tiers (D-033). Reactions (emote set) and comments (15+, moderated).
- **Notification settings** per category (friends' achievements, invites, contest results, news) with quiet hours.
- Strangers' posts: opt-in, 15+ only, ranked by quality signals, report/hide.

## 6. Parties & get-togethers online — W-070
Host a party in your home; invite friends (rank-gated as §2); party types (house party, séance, BBQ, wedding);
guests' zombies mingle with the host's household; party goals reward all attendees; RSVP via feed/phone.

## 7. Wardrobe & clothing shop — W-071
- Clothing shop (store + in-world boutique on Rot Row): tiers **Rag-Tag** (free/cheap, tattered) → **Thrift** →
  **Smart** → **Fancy** (formalwear, gowns, top hats) → **Couture** (premium/earn-only collection pieces).
- Applies to Classic (modular) bodies; cast bodies get **outfit variants** per body (texture/mesh swaps) added over
  time. Outfits affect Look Alive Passing (fancy + clean = higher) and party/venue dress codes.
- Every tier has earnable items; premium outfits are cosmetic only.

## 8. Binding acceptance criteria from team review (W-072: Astra, Terra — 2026-11-05)
- **Free placement:** objects carry authored **contact frames** (seat, hands/tool, feet, work surface, approach) banked
  separately from visual bounds; frames transform with the real pose; placements making a required contact/approach
  unreachable are rejected with a visible reason. Stacked items store a **support-parent id**: moving/selling the base
  moves/drops dependents, never leaves floating decor. Authoritative fixed-point pose + surface attachment; server
  validates in shared homes. Keyboard/controller equivalents for Alt/Shift. Tests: rotated chair + table + long gown
  together, stacks, door clearance, surface removal, save/reload. **No non-uniform scaling** (D-040).
- **Wardrobe:** shared rig/rest pose; outfit-specific body-fit masks; no re-rig per tier. A **fit matrix per body ×
  outfit across seated, bike, kneel, overhead reach, hug** (all 80 clips sampled) gates every outfit (uses the W-073
  clipping detector). Every tier has its own performance LODs; paid clothes never need better hardware. Ship fewer
  fully fitted silhouette families before multiplying texture variants.
- **Fairness:** every paid outfit's gameplay tags (Passing, dress code, venue/party eligibility) are matched by a
  reachable free or earned equivalent; tests prove no paid-only outfit grants a better Passing score, venue or reward (D-039).
- **Privacy:** "private" means interiors are **never delivered** to unauthorized clients (not just opaque windows).
  Specify cached photos/feed previews, revoked invitations, screenshots taken while invited, and ownership of co-build edits.
  Feed art uses safe crops, readable contrast, text alternatives; stranger content and notifications stay off without consent.
- **Resale (D-041):** sell value = 50 % of the price **actually paid** (after discounts), rounded down to $1; free
  rewards and gifts sell for 25 % of their $ reference, subject to the crafting daily resale cap; crafted items use the
  crafting spec formula; earn-only items are unsellable and untradeable (duplicate exchange is with the game, never between players).
- **Accessibility (Sol W-072, binding):** Free/Grid is an on-screen accessible toggle; placement has keyboard-editable
  X/Z/height/angle fields, coarse/fine nudges and explicit Confirm/Cancel (Alt/Shift are shortcuts only, never the
  sole route). Acceptance: a keyboard-only player selects, positions, rotates, stacks, confirms, moves and undoes an
  item, with collision/doorway failures announced. Invite/permission/RSVP controls state reasons and current status and
  restore focus after revoke/reconnect; revoking a visitor inside clears interior visuals, accessible descriptions and
  cached snapshots. The feed is a dismissible drawer/overlay at narrow widths or high zoom (test 1280 px at 200/400 %
  zoom and 390 px); text never shrinks below minimum readable size; updates keep focus/scroll and batch polite
  announcements, no auto-scroll/flash/motion; collapsed feed stops off-screen image/animation work; retained cards and
  decoded photos are bounded and AMD-Low budgets are re-measured with the feed open during a busy party. Item source,
  earn-only/no-resale status, bad-luck counter and alternate path are text/AX-visible (not colour-only); the sell
  preview states the exact refund vs same-session undo, currency and rounding; messages are complete localized
  sentences with plurals. Outfit shop shows body compatibility + fitting preview before purchase (no buying an outfit
  your body can't wear).
- **Asset rules (Claude ZSM W-072, binding):** every model build emits, deterministically into its manifest entry, a
  **2D convex footprint polygon** (tighter than the tile box) and its **contact frames** (D-043) — generated, never
  hand-kept. Wardrobe: cast bodies are grouped into **3–4 body-shape classes** (e.g. standard, broad/strongman,
  small/granny, costume/mascot) and outfits are fitted **per class**, not per body; budget per outfit piece ≤ 1,500 tris,
  1 material, LOD1 ≤ 500. Private homes: every home type ships an **exterior shell GLB with no interior nodes** and a
  separate interior set (build rule + test). Construction state: two shared models (**scaffolding, tarp**) used by
  every timed project. Feed photo cards render with a **fixed studio rig per card type** (reuse the thumbnail studio),
  not from live quality settings. Earn-only display/collection pieces are **unsellable** (D-041). Asset bank cards gain
  `tier` and `collection` fields (W-040). Home tiers, renovation limits and build timers are specified in
  `docs/systems/housing-progression.md` (D-030).
