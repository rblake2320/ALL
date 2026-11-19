# W-034 Seasons, weather and holidays (Halloween is Christmas for zombies)

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_PILLARS §A, GDD §2 (time: day 1 = Monday
09:00; night 20:00–06:00; full moon every 7th day), §3/§4 (needs, preservation "outdoors in daytime sun ×1.2"), §13
(events), BALANCE.md, look-alive.md (makeup in rain, Halloween override), vehicles.md (weather travel multipliers),
crafting-salvage.md (seasonal recipes), ART_DIRECTION (sky/fog palettes), MONETIZATION §6 (no FOMO).

## 1. Player fantasy

*"The first snow! The zombies love winter: they stay fresh, build snow-ghouls and drink hot cocoa they can't taste.
Then October comes, the house is covered in Jack-o'-Skulls, and on Halloween night nobody in town can tell who's
dead."* The calendar gives the year a rhythm, weather gives days texture, and four original holidays give the
household traditions to look forward to.

## 2. Calendar

- **Season length** setting: 7 (default), 14 or 28 game days. **Year = 4 × length.** Order: **Autumn → Winter →
  Spring → Summer**. New worlds start on Autumn day 1 (Halloween comes early, as the showcase).
- Day index `D = floor(tick / 5760)` (day 0 = world day 1). Season `S = floor(D / len) mod 4`, day-of-season
  `d = D mod len + 1`.
- **Full moon alignment:** the GDD full moon is every 7th day (world days 7, 14, ...). Any allowed length (7/14/28) is a
  multiple of 7, so the **last day of every season is a full-moon night**. Halloween is set on the last day of Autumn,
  so **Halloween is always under a full moon**. This is deliberate and documented.
- Changing the season length mid-game takes effect at the next season boundary. The current season keeps its length,
  so a holiday is never skipped or doubled (stored `calendar.pendingLength`).
- Calendar setting `seasons: 'on' | 'off'` (per world, new-game option, default **on**). `off` is today's behaviour:
  no weather and no seasons (perpetual mild Autumn look, no holidays except the GDD full moon). This keeps every
  existing save and the BALANCE harness unchanged (§9).

## 3. Weather

### 3.1 Blocks and forecast
- The weather is constant within a **block** of 8 game hours: 06:00–14:00, 14:00–22:00 and 22:00–06:00, so 3 blocks a
  day. A transition crossfades over 20 game min (render). Sim effects switch at the block start.
- **Deterministic and stateless:** block `k` (0-based from world start) draws from
  `hashRng(world.seed, 'weather', k)` (a pure function, e.g. splitmix32 of the seed xor `k × 0x9E3779B9`). **No RNG
  state is consumed or saved.** The forecast for any future block is computable at any time. The 7-day forecast is
  exact: it is a promise, not a guess.
- **Persistence:** with probability 0.55 a block repeats the previous block's weather (if allowed in the season).
  Otherwise it draws from the season table. Recursion is bounded: compute from the first block of the day, which
  ignores the previous day (also drawn from the table), so evaluation is O(3) per block.

### 3.2 Season tables (weights for a fresh draw)

| Weather | Autumn | Winter | Spring | Summer | Notes |
|---|---|---|---|---|---|
| clear | 20 | 15 | 25 | 35 | |
| overcast | 25 | 25 | 20 | 15 | the shipped default look |
| fog | 20 | 15 | 15 | 5 | night fog ×2 weight |
| drizzle | 15 | 5 | 20 | 10 | |
| rain | 10 | 5 | 15 | 10 | |
| thunderstorm | 5 | 0 | 5 | 10 | |
| wind | 5 | 10 | 0 | 0 | |
| snow | 0 | 25 | 0 | 0 | |
| heatwave | 0 | 0 | 0 | 15 | day blocks only, else → clear |

**Temperature band** (flavour + some effects): Autumn mild, Winter cold (snow: freezing), Spring mild, Summer warm
(heatwave: hot). It is not a per-agent temperature simulation: zombies "don't feel the cold", and that is the joke.

### 3.3 Weather effects (sim)
"Outdoors" means a tile where `!isIndoor && !isCovered` (quick-build.md `isCovered`: a roof or slab above). Effects
apply to awake agents standing outdoors on the active lot, evaluated per tick by the systems that own the need (the
existing decay system reads a multiplier from the weather system).

| Weather | Preservation (outdoors) | Other | Moodlets | Look Alive | Other systems |
|---|---|---|---|---|---|
| clear (day) | GDD sun ×1.2 (unchanged) | — | — | — | — |
| overcast | ×1.0 (no sun factor) | — | — | — | — |
| fog | ×1.0 | — | *Mysterious Mood* (+3, Night Owl +6) once per block | slips −20 % (who can see you?) | lantern posts glow |
| drizzle | ×1.0 | hygiene +2/h (rinse) | — | makeup halves after 60 min outdoors | — |
| rain | ×0.95 | hygiene +4/h; fun −2/h unless *Puddle Jumping* | *Soggy* (−5, 2 h, after 30 min outdoors; refreshes) | makeup halves at block start if outdoors | outdoor fires (GDD §5) cannot spread outdoors; garden/forage +1 spawn |
| thunderstorm | ×0.95 | as rain | *Jumpy* (−3, 1 h) on each thunder (≤ 2 per block), Night Owl *Electrified* (+5) instead | as rain | power flicker visuals (no outage); 2 % per block: the "Spark of Life" event (§3.4) |
| wind | ×1.0 | — | — | wig askew 10 %/h outdoors | `decor_windchime` +1 env while windy |
| snow | **×0.85** (cold preserves) | — | *Snow Day!* (+6, 6 h) at the first outdoor snow of the season | makeup halves at block start if outdoors | `season_buildSnowGhoul`, `season_snowAngel`, `season_snowBath`; vehicles: travel ×(vehicles.md); snow cover on objects |
| heatwave | **×1.4 instead of the sun ×1.2** (day, outdoors) | hygiene decay ×1.15 outdoors | *Melting* (−6, 2 h) after 60 min outdoors | makeup fade from 4 h | ice bath fun +10 (relief) |

- **Indoors there is no change in any weather.** This is the key balance guarantee (§9): BALANCE's unattended
  households spend ~all their time indoors.
- **Season (all blocks, outdoors only):** Winter ×0.95 preservation; Summer ×1.05; others ×1.0. These multiply the
  weather factor. There is no seasonal effect indoors.

### 3.4 Seasonal and weather interactions

| id | Label | Where / when | Duration | Effects | Anim |
|---|---|---|---|---|---|
| `season_puddleJump` | Jump in Puddles | outdoor tile, rain/drizzle | 15 | fun +18/h, hygiene −5, removes *Soggy* sting (sets *Puddle Jumping* +5, 2 h) | **`jump`** (fallback `dance`) |
| `season_buildSnowGhoul` | Build a Snow-Ghoul | outdoor tile, snow on the ground | 45 | fun +14/h, creativity xp 15/h; spawns `item_snowghoul` (env +2 outdoors; melts when snow cover ends) | **`buildSnow`** (fallback `clean`) |
| `season_snowAngel` | Make a Snow Angel (Snow Zombie) | snow | 10 | fun +20/h | `sleep` on the ground (lie) |
| `season_snowBath` | Take a Snow Bath | snow, outdoors | 30 | preservation +15 over 30 min (a +30/h rate; total below the ice bath's +22 per 45 min; see the balance note below), hygiene +20, fun −5; once per zombie per day | `bath` (on the ground) |
| `season_catchSnowflakes` | Catch Snowflakes | snow | 5 | fun +10/h; *Tastes Like Nothing* (+2) | `cheer` |
| `season_watchStorm` | Watch the Storm | indoor window during a thunderstorm | 30 | fun +10/h; Night Owl +4 | `admire` |
| `season_rakeLeaves` | Rake Leaves | yard, Autumn | 30 | fitness xp 15/h, fun +6/h; yields 1 wood (twigs) to the stash once the household has crafted (W-029 opt-in) | `clean` |
| `season_sunbathe` | Sunbathe (Bad Idea) | yard, Summer clear | 30 | fun +12/h, preservation per heatwave/sun rule (that is the joke); *Crispy* (−4, 4 h) | `sleep` on a lounger/ground |

> **Snow Bath balance note:** the levels README caps *free* freshness at ≤ +10/h for always-available sources. The
> Snow Bath is seasonal (Winter snow blocks only: ~25 % of Winter blocks, ~6 % of the year), outdoor, player-only
> (`autonomous: false`) and capped at once per zombie per day. That gives ≤ +15/day per zombie during snow. This is
> the one deliberate exception, flagged for the lead (Q-S2). It is a seasonal "zombies love winter" perk. Fallback:
> +10 over 60 min.

**Spark of Life** (thunderstorm, 2 % per block, from the seasons RNG stream, see below): if a household zombie is
outdoors within 3 tiles of a `lantern_post` or `lamp_*` object, a lightning "zap" (FX `zap`, sfx `thunder`) gives
*Electrified* (+10, 6 h) and vitality +1 (cap 100). No harm. Frequency ≤ once per zombie per season.

> **RNG note:** weather is a pure hash. The Spark of Life and other seasonal rolls use `ctx.stream('seasons')`, never
> `world.rng` (README §4).

## 4. Holidays

Four original holidays plus the existing weekly full moon. Each has **traditions**: optional checklist items that grant
a moodlet when done and roll up into a holiday score. Holidays return every year (no FOMO; MONETIZATION §6).

| Holiday | Season / day | Hours | Traditions (each ✓ gives the household *Tradition Kept* +3, max 3 stacks) | Big moment |
|---|---|---|---|---|
| **Halloween** | Autumn, last day (always a full moon) | all day; Treat Night 18:00–22:00; Costume Night 17:00–02:00 | Decorate (≥ 3 `seasonal:halloween` objects placed) · Wear Costumes · Carve a Jack-o'-Skull (Workbench, W-029) · Hand Out Treats · Exchange Gifts · Throw a Halloween Party | **Costume Night**: costumed zombies have Passing ≥ 85 and no slips (look-alive.md). Living-world venues welcome everyone |
| **Long Night** | Winter, day `ceil(len/2)` | 18:00–06:00 | Light Candles (≥ 3 candle/lantern objects on) · Share a Feast · Tell Ghost Stories (group social at a table: fun +15/h) · Stay Up Till Dawn | *The Longest Night*: night mood +5 for all; ultra speed disabled 18:00–02:00 (cosy) |
| **Rising Day** | Spring, day 1 | 06:00–20:00 | Visit the Old Graveyard (L2) · Tidy a Grave (honouring, L2) · Bone Hunt (L1 park/yard: 6 hidden `item_bonehunt` spawn at 06:00, collect for 5 Bones each, quest-ledger idempotent) · Plant Something | **Rising Parade** (L3 Rot Row 11:00): float roles need Passing ≥ 60 (living spectators) |
| **Cool-Down Carnival** | Summer, day `ceil(len/2)` | 10:00–22:00 | Eat a Brain-Freeze (ice-cream treat from the fridge, $6, hunger +15, fun +10) · Water Fight (group, outdoor, fun +20/h, hygiene +10) · Ice Bath Party (2+ in tubs: social +4/h) · Watch the Fireworks (21:00, outdoor: fun +15/h) | Fireworks at 21:00 on every residential lot (render + audio) |

**Holiday score:** traditions done / available. ≥ 3 traditions: *Best {Holiday} Ever!* (+12, 24 h) for the household.
0 traditions: no penalty (nothing bad for skipping). Holiday daily tasks (MONETIZATION §2) can target traditions
(e.g. "Hand out 10 treats", 12 Bones).

### 4.1 Halloween details (the flagship)
- **Trick-or-treaters:** at 18:00–22:00, groups of 2–3 **costumed living children** (a new service-NPC kind `tot`,
  E10+ friendly; they never enter the house) ring the doorbell every 20–40 game min (seasons stream; max 8 groups).
  `season_handOutTreats` at the door (2 min): consumes 1 treat from a Candy Bowl (`bowl_candy`, free, $20 = 20
  treats, 1×1 floor near the door). Effects: fun +4, social +4, and a cute reaction (`cheer`). No treats: *Tricked!*
  (a TP prank on the tree, rot-stages-family.md §6 clean-up; comedic, at most 1).
- **Costumes:** wardrobe items (`costume_*`, 8 free: Ghost Sheet, Vampire, Witch, Pumpkin, Robot, Mummy (lol),
  Astronaut, "A Normal Living Person"). Crafted at the Sewing Table (W-029). Premium costume set *Monster Mash* (6,
  1,200 GG, cosmetic).
- **Gifts:** `social_giveGift` (Friendly, gate friendship ≥ 20; consumes one gift: any crafted object boxed item or a
  `gift_box` bought at $25 by phone). Friendship +10 (+15 if the gift is crafted at q ≥ 4). On Halloween and Long
  Night the gains are ×1.5.
- **Decor:** `decor_jackoskull` (crafted/free $45, env +2 at night, `flame` node), `decor_spiderweb` (wall item $30,
  env +1), `decor_inflatableBat` (yard $120, env +1, sways). All are tagged `seasonal:halloween`, and env counts only
  during Autumn (out of season env 0, still placeable).

## 5. Data model (additive)

```ts
// src/sim/types.ts
// SimSettings gains: seasons?: { enabled: boolean; lengthDays: 7 | 14 | 28 }   (absent ⇒ disabled: existing saves unchanged)
// WorldState gains:
export interface CalendarState {
  /** Season length in effect for the current season, and a change waiting for the boundary. */
  lengthDays: 7 | 14 | 28;
  pendingLength: 7 | 14 | 28 | null;
  /** Day index where the current length started (season math is piecewise from here). */
  epochDay: number;
  epochSeason: 0 | 1 | 2 | 3;                         // 0 Autumn, 1 Winter, 2 Spring, 3 Summer
  holidays: Record<string, { year: number; traditions: string[]; scoreAwarded: boolean }>;  // last held instance per holiday id
  snowCover: number;                                   // 0..1 ground snow (accumulates 0.25 per snow block, melts 0.34 per non-snow block above freezing)
  sparks: Record<AgentId, number>;                     // last season index a Spark of Life hit (≤ once/season)
}
//   calendar?: CalendarState;

// src/sim/contracts.ts
export type Season = 'autumn' | 'winter' | 'spring' | 'summer';
export type Weather = 'clear' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'thunderstorm' | 'wind' | 'snow' | 'heatwave';
export interface WeatherView { season: Season; dayOfSeason: number; year: number; weather: Weather; temp: 'cold' | 'mild' | 'warm' | 'hot';
  blockEndsTick: number; snowCover: number; holiday: { id: string; name: string; active: boolean } | null;
  forecast: { day: number; blocks: [Weather, Weather, Weather]; holiday?: string }[] }   // next 7 days
export interface HolidayDef { id: string; name: string; season: Season; day: 'first' | 'mid' | 'last';
  hours: { open: number; close: number }; traditions: { id: string; label: string; objective: ObjectiveDef }[];
  moodletOnScore: MoodletId; music?: string }
export interface SeasonsApi { view(): WeatherView; outdoorPreservationMult(x: number, z: number, level?: number): number;
  isHoliday(id: string): boolean; weatherAt(blockIndex: number): Weather }
// SimulationAPI gains: weather?(): WeatherView
// ContentModule gains: holidays?: HolidayDef[]
// SimEvent gains: | { type: 'weather'; weather: Weather; season: Season; transitionMin: number }
//                 | { type: 'holiday'; id: string; phase: 'start' | 'end' | 'tradition'; tradition?: string }
// Objective kinds reused (ObjectiveDef 'interaction', 'own', ...) for traditions; quests system tracks them.
// ObjectDef.params: seasonal: 'halloween' | 'longnight' | ...; envInSeasonOnly: true
// DecayApi.preservationPerHour gains the weather/season factor via sys('seasons').outdoorPreservationMult (only when outdoors).
```
- **Schema:** optional, no bump. `calendar` is created on the first midnight of a world with `seasons.enabled`.
  Existing saves have no `settings.seasons`, so they stay disabled until the player turns it on in Settings (a
  per-world toggle with a confirm: "Turning on seasons starts Autumn tomorrow").
- **Determinism:** weather is a pure hash of `(seed, block)`. Snow cover is a deterministic fold over blocks (closed
  form for catch-up: iterate ≤ 3 × elapsedDays blocks, O(n) cheap, max 3 × 120 for a 4-month absence). Holiday
  windows are tick-aligned. Trick-or-treaters and Spark of Life use `ctx.stream('seasons')`.
- **Snapshots (W-025):** the calendar is world-level. Snow cover is lot-independent (town-wide). Catch-up: seasonal
  env and snow cover recomputed from the tick, never replayed per tick.

## 6. UI flows

- **Time widget** (HUD): adds a season glyph + day ("Autumn 6") and a weather icon. Hovering or focusing shows the
  tooltip "Rain until 14:00 · Halloween tomorrow!".
- **Calendar panel** (click the season glyph, or `C`): a 7-day forecast strip (3 blocks a day), the season wheel
  (holidays marked), this holiday's traditions checklist (live ticks), and a "Remind me" toggle (notification at
  08:00 on the day). Screen reader: "Tuesday, Autumn day 6. Forecast: morning fog, afternoon drizzle, night rain.
  Tomorrow: Halloween."
- **Holiday banner:** on the day at 06:00 (or at the holiday start), a toast plus a banner with the traditions. It is
  dismissible, and the banner shows only once per holiday per year.
- **Settings:** per-world Seasons on/off and length (7/14/28). Global: weather particles quality (off/low/high),
  lightning flashes (on/off: **photosensitivity**, default ON but auto-OFF when `reduceMotion` is on; flashes limited
  to ≤ 3 per 10 s, under the WCAG 2.3.1 threshold of 3 flashes/s).

## 7. Render needs

- **Sky/fog/ground palettes** per season (4) × weather (9) as parameter sets (no new textures), crossfading 20 game
  min. Autumn: warm ochre ground tint plus leaf litter decals (instanced quads, Low: off). Winter: snow cover shader
  (world-up mask × `snowCover` on ground, roofs, wall tops and outdoor object tops; one uniform in the shared
  material chunk, no per-object material swaps, decision #23 safe via a global uniform). Spring: greener grass, blossom
  particles. Summer: higher sun, warmer key light, heat shimmer post (High only).
- **Precipitation:** GPU-instanced particles in a camera-following volume. Rain ≤ 4,000 (High) / 1,500 (Medium) / 0
  (Low: screen-space streak overlay instead); snow ≤ 2,500/1,000/0 (Low: overlay). ≤ 2 draw calls. Hidden indoors
  under the cutaway (particles culled by the roof/cover mask texture of the lot).
- **Puddles** (rain): screen-space roughness drop on outdoor ground + 12 puddle decals (Medium+).
- **Lightning:** a 120 ms sky flash + key-light pulse, rate-limited (§6).
- **Fireworks** (Cool-Down Carnival): GPU particles, ≤ 3 bursts at once, emissive (bloom).
- **Halloween:** decor models (§4.1), jack-o'-skull flame flicker (existing flame node), a slight purple full-moon
  tint (ART_DIRECTION already tints full moons green; Halloween adds an orange rim light).
- Budget: weather adds ≤ 1.5 ms GPU on a GTX 1660 at High and ≤ 0.5 ms on Low. Total draw calls stay ≤ 650.
- New anim clips: **`jump`** (puddles; fallback `dance`), **`buildSnow`** (fallback `clean`), **`shiver`** (comic
  "zombies don't shiver" fake-out idle in snow; fallback `stretch`).

## 8. Audio needs

New ambience loops: `rainLight`, `rainHeavy`, `windGusts` (extends `wind`), `snowHush` (low-pass filter on all
ambience, −4 dB), `summerCicadas` (night: frogs), `autumnLeaves`. SFX: `thunder` (exists; add 3 distance variants),
`doorbellTot` (trick-or-treat chime), `kidsTrickOrTreat` (a short cheerful "trick or treat!" chorus as our own
synthesized voice, no real recordings), `fireworksPop`, `fireworksWhistle`, `puddleSplash`, `snowCrunch` footsteps on
snow (footstep variant). Music: per-season variants of each `mus_*` theme (instrument swaps) and a **Halloween theme**
(`mus_holiday_halloween`: harpsichord + theremin waltz).

## 9. Balance (BALANCE.md stays valid)

1. **Existing saves and the harness:** `settings.seasons` absent ⇒ disabled ⇒ byte-identical behaviour. The BALANCE
   scenarios as written are unchanged.
2. **With seasons on:** no indoor effects at all. Outdoor effects: preservation ×0.85–×1.4 only while outdoors, and
   unattended zombies are outdoors < 3 % of their on-lot hours (measured on scenario A: walking to the mailbox,
   carpool). The worst case is a Summer heatwave: +0.2/h for ~0.7 h/day ≈ −0.15 freshness/day. Negligible against the
   Chill-Rest/embalming sources.
3. **Required:** add scenario variants **A-S** and **B-S** (seasons on, 14/21 days, starting in each of the 4 seasons:
   5 seeds × 4 = 20 runs each). Targets: every GDD §18 target holds. Measured deltas must be reported in BALANCE.md.
   The Halloween trick-or-treat doorbell is not an autonomy trigger (the player hands out treats; no NPC needs change).
4. Moodlets added are small (−6…+12) and short. Mood affects autonomy weights only via mood/social success, inside
   GDD ranges.

## 10. Store tie-ins (cosmetic only, no FOMO)

Seasonal decor sets (*Hallowed Haunt* 1,500 GG set of 10 Halloween decor, *Long Night Lights* 1,200 GG, *Spring
Rising* 1,200 GG, *Carnival Cool-Down* 1,200 GG), the *Monster Mash* costume set (1,200 GG), seasonal photo frames
(W-028). **Every seasonal SKU returns each year at the same price** (MONETIZATION §6). Free equivalents exist for every
tradition: free decor (Jack-o'-Skull crafted/$45), free costumes (8), the free Candy Bowl. No weather control is ever
sold.

## 11. Interplay with levels

| Level | Seasonal content |
|---|---|
| L1 | Calendar, weather, all four holidays at home; Bone Hunt at the Corner Park (Rising Day) |
| L2 | Rising Day pilgrimage + grave tidying; foggy nights ×2 fog weight; Halloween séance special (ecto +1) |
| L3 | Rising Parade, Halloween costume contest at The Rigor Room (Passing irrelevant), Cool-Down Carnival stalls |
| L4 | Bayou: rain weights ×1.5, summer fog; *Swamp Snow* is rare (snow weight ×0.3) |
| L5 | Long Night Gala (Passing 75; Legendary guests of honour), fireworks over the hills |
| L6 | Underground: no weather (always "indoors"); the Catacomb Market's Halloween night market |
| L7 | Town square seasonal tree/decor that the community decorates (Phase 4 shared) |

## 12. Edge cases

- **Seasons toggled off mid-holiday:** the holiday ends immediately, moodlets stay until expiry, and the `calendar`
  stays saved but is ignored.
- **Season length changed on a holiday day:** the change applies at the boundary (§2), so the holiday finishes
  normally.
- **Travel during weather:** the destination uses the same town-wide weather block. Vehicles get the travel
  multipliers. Outdoor effects apply on whichever lot is active.
- **Covered tile under a carport/roof:** counts as sheltered (`isCovered`). An open-sided Quick Build porch with a roof
  is sheltered.
- **Indoor windows during snow:** windows show frost (render) and nothing else.
- **Trick-or-treaters with no reachable door** (lot with no door or no path): they wave from the sidewalk; Hand Out
  Treats targets the sidewalk tile instead (a fallback stage `tileNear` of an entry point).
- **Corrupt calendar** (length 9, NaN epoch): repair resets it to `{7, epoch = current day, season by D}` with a
  warning. A healthy calendar is a no-op.
- **Very long absence** (catch-up of 120+ days on a snapshot): the snow cover fold is capped at the last 9 blocks
  (snow cover saturates; earlier blocks can't matter).
- **Photosensitivity:** lightning flashes are rate-limited even when on; the setting is respected in Photo Mode
  previews too.

## 13. Acceptance tests

1. Calendar math: for lengths 7/14/28, every day for 3 years maps to the correct season/day, and Halloween always lands
   on a full-moon day (property). A length change mid-season applies at the boundary.
2. Weather purity: `weatherAt(k)` is identical across processes and save/load, and doesn't change when other systems
   consume RNG (consume 10,000 `world.rng` draws in between → same forecast). The forecast shown 7 days ahead equals
   the realised weather.
3. Distribution: over 100,000 blocks per season, frequencies (after persistence) are within ±1 % of the analytic
   stationary values derived from the table + 0.55 persistence.
4. **Disabled ⇒ identical:** BALANCE A seeds 11/22/33 for 3 days with the seasons system registered but disabled:
   byte-identical to the build without it.
5. Indoor invariance: a zombie indoors under every weather has an identical preservation trend (`NeedView.trend`).
6. Halloween: costume override P ≥ 85 from 17:00 to 02:00 only; trick-or-treater schedule deterministic across
   save/load at 19:00; candy bowl consumption; *Tricked!* at most once.
7. Holiday traditions: an objective completed is counted once (idempotent through reloads/journal replay), and the
   score moodlet is awarded once per year.
8. Balance: A-S/B-S scenario runs (§9.3) meet every GDD §18 target; results recorded in BALANCE.md.
9. Render (Playwright, swiftshader): screenshots of each season × {clear, rain/snow, fog}, and the Halloween night.
   Draw calls ≤ 650. Low quality: 0 particle draw calls. The flash limiter never exceeds 3 flashes per 10 s.
10. Perf: `view()` with a 7-day forecast < 0.1 ms. The per-tick outdoor multiplier lookup is O(1) (cached per block).

## References

- The Sims 4: Seasons (2018) set the life-sim convention of a calendar with configurable season length (default
  one week, adjustable), a 7-day forecast and seasonal holidays: [Sims Wiki: The Sims 4 Seasons](https://sims.fandom.com/wiki/TS4S),
  [TheGamer calendar guide](https://www.thegamer.com/the-sims-4-seasons-calendar-system-guide-tips/),
  [PCGamesN overview](https://www.pcgamesn.com/the-sims-4/the-sims-4-seasons). We adopt only that generic structure
  (season length options, block-based weather, forecast, traditions). Our holidays (Long Night, Rising Day,
  Cool-Down Carnival) and every tradition, name and effect are original. Halloween is a generic public holiday name.
- WCAG 2.1 SC 2.3.1 (Three Flashes or Below Threshold) is the basis for the lightning flash limiter and the
  reduce-motion default.
