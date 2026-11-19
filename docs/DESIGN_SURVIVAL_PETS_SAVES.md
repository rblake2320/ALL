# Survival, Scavenging, Strays & Pets, Never-Lose-Progress — design (v1.1)

Owner request 2026-11-05: zombies must need to eat; hunger has visible/physical consequences (slower, wasting away);
there must be FREE ways to eat when broke (graves, strays...); pets; progression must never be lost across log-offs.
Rating constraint: **E10+** (comedic, no gore, no harming pets/animals on screen).

## 1. Hunger has teeth (sim, deterministic)
Appetite (hunger need, 0–100) already drives autonomy and feral at ≤ 5. Add **Wasting**:
| Appetite | Effect |
|---|---|
| < 35 | *Peckish*: walk speed ×0.9 |
| < 20 | *Starving*: walk speed ×0.75, skill gain ×0.8, Freshness decay ×1.25, moodlet *Hollow* |
| < 10 for ≥ 12 game h | **Wasting stage 1**: max Energy capped at 70, body visibly thinner (render `wasting` 0..1 → thinner build, sunken cheeks, slower idle) |
| < 10 for ≥ 36 game h | **Wasting stage 2**: walk ×0.6, a random limb may loosen (existing limb-loss system, once per 24 h, never below 2 limbs from hunger alone), *Withered* moodlet |
Recovery: each full meal reduces the hidden `wasting` meter; 2 game days of normal eating fully recovers. Multipliers stack with limb multipliers (limp ×0.6, crawl ×0.3); floor ×0.2. Exposed as `AgentView.wasting` (0..1) + `moveMultiplier` for render/HUD. Balance: unattended A-scenario targets in BALANCE.md must still hold (re-run sweep).

## 2. Free food when broke (no household $ needed)
| Source | Where | Yield | Cost / risk |
|---|---|---|---|
| **Rummage Trash** (exists) | own bin | small snack | hygiene −, *Ate Garbage* |
| **Dig for Grub** | **Old Graveyard** community lot (new; walk/carpool) + own-lot grave plot object | worms/beetle snack, rare "grave goods" collectible to sell | energy −, freshness − (dirt), shovel skill |
| **Forage** | yard: mushrooms/weeds grow on untended soil (spawn deterministically daily) | small snack | none; more with Gardening skill |
| **Brain Bank food pantry** | community lot, 1 free meal box per zombie per day | full meal | social moodlet *Charity Case* (mild), queue time |
| **Fishing** | Graveyard pond | "mystery fish" ingredient | time; fishing skill |
| **Neighbour's leftovers** | ask a townie friend (friendship ≥ 40) | leftovers | friendship −2 if asked twice in a day |
| **Chase Pigeons** | street | they always escape — drops crumbs (tiny snack) + *Comedic Failure* fun | none (pure comedy, E10+) |
Autonomy: free sources score only when funds < grocery cost or no food reachable; feral override prefers them before **Feral Nibble**.

## 3. Strays → Pets (no eating animals — E10+)
- **Adoption limit:** three household pets for new adoptions (Fable approval, 2026-11-12). A valid older save containing four pets keeps all four, their needs and positions; care remains available, and another adoption waits until there are fewer than three. The structural save validator must not clamp a valid old household to the new adoption limit. Current home animals remain in the home frame: a zombie must return home to care for them, and a queued errand cancels on leaving that region. Connected graveyard placement/travel continues in S14.
- **Strays** (cats, dogs, raccoons, a crow) wander the street/graveyard on a deterministic schedule. Zombies can **Chase** (stray always escapes, comedy), **Offer Scraps** (costs a snack/leftover), **Pet**, **Befriend**. Trust meter per stray; at trust ≥ 70 → **Adopt** (free).
- **Pets** are new agents with needs (Appetite, Fun, Hygiene, Affection), traits (Lazy, Guard, Curious, Thief), interactions (feed, play, walk, train, cuddle), behaviours: Guard pets scare the Repo Ghoul (delays repossession), Thief pets bring home junk to sell, Curious pets dig up grave goods. Pets never die from neglect: they **run away** (return later as strays). Premium/cosmetic: collars, beds, pet houses, undead-style variants (stitched cat, glowing-eyed dog) via the store.
- Content: pet bodies built in Blender (procedural, our own art; 4 species × variants), animations walk/run/sit/sleep/eat/play/beg.

## 4. Never lose progress
Already shipped: crash-safe atomic saves with backup, SHA-256 envelopes, autosave every 5 real min, save on tab hide /
pagehide / beforeunload, Electron close-flush, emergency crash save, `navigator.storage.persist()` request.
Added in v1.1:
1. **Write-ahead command journal**: the sim is deterministic, so every player command (with its tick) is appended to a small crash-safe journal per slot between autosaves (batched ≤ 1 s). On next launch after a crash/power loss/killed tab: load the last snapshot and **replay the journal deterministically** → loss ≤ ~1 s instead of ≤ 5 min. Journal is hash-chained and truncated at every successful save; a corrupt tail is dropped at the last valid entry (never blocks loading).
2. **Event-driven saves**: also save at day rollover, after any store purchase/unlock, quest completion, CAZ finish, build-mode exit.
3. **Profile progression** (Bones ledger, entitlements, quest/daily-task state, settings) is separate from world saves, crash-safe, and backed up — deleting a world never loses purchases/unlocks.
4. **Cloud saves (Phase 4, signed-in)**: snapshots + journals sync to the server; per-slot vector of (device, saveSeq) for conflict detection; on conflict the player picks (both kept). Purchases/GG live only server-side, so reinstalling or changing devices never loses them.
5. Storage-eviction guard (web): warn once if the browser denies persistent storage and offer "Export save" / sign-in.
