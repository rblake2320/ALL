# W-031 Vehicles: buy, build, enhance, drive (bike → moped → sedan → hearse)

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_PILLARS §D/§E, DESIGN_WORLD_LEVELS §1
(W-025 travel, everyone travels together in v1), docs/levels/README.md §3 (travel formula with `vehicleMult`, owned
by this doc), `src/shared/world.ts` (`TownState.trip`), GDD §6/§10/§11 (carpool, economy), MONETIZATION §3/§4
(Volt-Hearse house brand, sponsor tier), crafting-salvage.md (vehicle recipes, trunk cargo), look-alive.md
(tinted-window Entrance bonus).

## 1. Player fantasy

*"We started with one rusty bicycle. Now the family rolls up to the country club in a matte-black hearse with tinted
windows and a horn that plays a funeral march."* You buy or build vehicles. You park them in the drive. You tinker
with them on the weekend: paint, wheels, a hotter engine, more seats. They make trips across town faster, carry your
salvage home and earn money on delivery runs. They also break down at the worst moment, which is part of the fun.

## 2. Vehicle catalogue

| id | Name | $ (sim) | Tier | Craft (W-029) | Seats | Trunk cargo (units) | `vehicleMult` | Fuel/trip-block | Tank | Parking size | Tris (LOD0/LOD1) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `veh_bike` | Bone-Shaker Bicycle | 250 | free | tnk 2, 3 h | 1 | 10 | **1.10** | 0 | — | small | 1,500 / 600 |
| `veh_moped` | Rattletrap Moped | 900 | free | tnk 4, 8 h | 1 (2 with Sidecar) | 15 | **0.85** | 0.5 | 6 | small | 3,000 / 1,200 |
| `veh_sedan` | Rustbucket Sedan | 3,200 | free | tnk 6, 14 h | 4 (5 with Bench Seat) | 40 | **0.70** | 1.0 | 12 | car | 6,000 / 2,400 |
| `veh_hearse` | Family Hearse | 7,500 | free | tnk 8, 20 h | 6 (8 with Jump Seats) | 80 | **0.70** | 1.5 | 16 | car (long) | 6,000 / 2,400 |
| (carpool) | the existing service hearse | free | — | — | all | 0 | **1.00** | — | — | — | (exists, `env_hearse`) |
| (walking) | on foot | — | — | — | all | 0 | **1.60** | — | — | — | — |

- **Premium rides are skins, never stats** (MONETIZATION §1): *Monster Hearse* (oversized wheels, flames decal),
  *Volt-Hearse EV* (sponsor tier, house brand: silent hum, a charge-port lid instead of a fuel cap; fuel use shown as
  "charge", same units, same price), *Vintage Roadster* (a sedan skin), *Chopper Bike* (a bike skin), *Scooter Deluxe*
  (a moped skin). A skin entitlement applies to a vehicle **of that model owned in-world** (you still buy or craft the
  model with $/materials).
- **Household limit:** at most 4 vehicles. Vehicles are household property: they travel with the household between
  lots and are **excluded from lot value**, so bills are unchanged (GDD §6 formula).

## 3. Travel time (W-025 integration)

The levels README defines the carpool baseline. This doc owns the multipliers:

```
baseMin   = clamp(round(15 + 0.06 × d), 15, 45)            // d = Euclidean map distance between lots (0..1000 map units)
tripMin   = max(10, round(baseMin × vehicleMult × weatherMult × engineMult)) + boardMin + breakdownDelay
engineMult = 1 − 0.05 × engineTier                          // tiers 0..3 (T3 = 0.85); bikes use Racing Gears (tier 0..1 only)
boardMin  = own vehicle 4 (walk to parking + get in) · carpool 0 (its wait is inside the 1.00 baseline) · walking 0
weatherMult (W-034) = bike/moped: rain 1.10, snow 1.25, storm 1.20 · sedan/hearse: rain 1.0, snow 1.15, storm 1.10 · walking: rain 1.05, snow 1.20
```
Reference (Mildew Lane → Rot Row Market, d 386, carpool 38 min): walk 61 · bike 46 · moped 36 · sedan 31 ·
hearse 31 · sedan T3 (×0.85) 27. The floor of 10 min applies (e.g. sedan T3 to Corner Park:
max(10, 21 × 0.7 × 0.85 = 12.5) = 12, + 4 board = 16).

**Group assignment (v1: the whole household on the lot travels together, DESIGN_WORLD_LEVELS §1):**
1. The player picks the destination on the Neighbourhood Map and a **ride plan**: *Carpool* (default), *Walk*, or
   *Drive*. Drive auto-assigns travellers to drivable household vehicles parked on the **current lot**, largest seats
   first, and fills seats. Any travellers left over take the carpool, or walk if the carpool is unavailable
   (01:00–06:00 the carpool doesn't run, shown in the map).
2. **Arrival is together:** `arriveTick = departTick + max(tripMin over groups)`. The whole party appears at the
   destination's spawn at once, which matches the v1 framework rule. Faster groups simply wait (shown as "Waiting for
   the carpool...").
3. **Carpool a friend:** free seats (after household members) can take up to `freeSeats` townies present on the lot
   with friendship ≥ 35 who accept (a social `veh_offerRide`, 0.8 base). They arrive with you as visitors at the
   destination (if it is open to visitors). They get +5 friendship and *Road Trip!* (+8, 4 h) for all riders.
4. Fuel is checked at plan time (`fuel ≥ fuelPerBlock × blocks × 2`, so a return trip is always possible;
   `blocks = ceil(d / 100)`). Vehicles that fail the check are excluded, with a reason ("Moped needs fuel").
   Condition < 10 excludes a vehicle ("Broken down — needs a Tune Up").

`TownState.trip` (src/shared/world.ts) gains, additively:
```ts
trip: null | {
  to: string; agents: string[]; departTick: number; arriveTick: number;
  /** NEW (optional): who rides what. Absent = carpool for everyone (current behaviour). */
  groups?: { mode: 'vehicle' | 'carpool' | 'walk'; vehicleId?: string; agents: string[]; guests?: string[]; minutes: number }[];
  /** NEW (optional): resolved at departure, deterministic. */
  events?: { kind: 'breakdown'; vehicleId: string; delayMin: number }[];
  tripId?: string;                         // 't<nextId>' — idempotency key for arrival effects (pockets → stash, fuel, wear)
}
```

## 4. Fuel, wear, breakdowns, repair

- **Fuel:** "Motor-Grade Embalming Fluid", a separate consumable from the GDD §4 embalming fluid ($30, used for
  preservation), so the decay economy is untouched. Household fuel stock `HouseholdState.fuelUnits` (cap 60). Buy:
  phone **"Order Fuel"**, $8 per 4 units, delivered by the Pizza Ghoul cart in 45 game min (it reuses the delivery
  NPC). Or Rot Row Market $7 per 4, or craft (W-029: bone 1 + glass 1 → 4 units). `veh_refuel` ("Refuel", 3 min, at
  the vehicle) moves stock into the tank. Example cost: sedan to Rot Row and back = 4 blocks × 2 × 1.0 = 8 units ≈
  $16.
- **Wear per trip:** `condition −= (1 + 0.8 × blocks) × weatherWear × chassisMult` (weatherWear: rain 1.2, snow 1.5;
  chassisMult: Reinforced Chassis 0.6). Carport/garage parking: weather wear ×1.0 regardless of the season (shelter).
  Parked outdoors in snow: −1 condition per game day. Bikes wear ×0.5.
- **Breakdown** (resolved once at departure, from the vehicles RNG stream):
  `p = clamp((60 − condition) / 60, 0, 1) × 0.35`. A breakdown adds `delayMin = 20` (`15` if any rider has
  tinkering ≥ 3: "fixed it on the roadside", tinkering xp 10). Riders get *Stranded on the Roadside* (−6, 3 h), or
  *Roadside Hero* (+6, 3 h) for the fixer. If condition < 10 after arrival, the vehicle is **Broken**: it is parked and
  cannot be driven until repaired. Cars never strand the household (arrival always happens); E10+ comedy only.
- **Repair** `veh_tuneUp` ("Tune Up", 45 min, at the vehicle on the home lot; tinkering xp 20/h; consumes 2 scrap +
  1 wire from the stash **or** $25 parts): success `0.6 + 0.04 × tinkering` (cap 0.95) gives condition +35 (cap 100).
  Failure gives +10 and *Oily Face* (−3, 2 h, comic). Two arms missing → cannot (GDD §4). A **Mechanic** call (phone,
  $120, arrives in 2 h, +60 condition, guaranteed) is the money path.
- **Wash** `veh_wash` (20 min, needs an outdoor tile + a sink or hose; hygiene −3, fun +6/h): resets the cosmetic
  `dirt` 0..1 (rendering only). Dirt rises 0.1 per trip, 0.2 in rain.

## 5. Parking (objects and curb spots)

| id | Name | Tier / $ | Footprint | Placement | Spots | Notes | Tris |
|---|---|---|---|---|---|---|---|
| `pad_driveway` | Cracked Driveway Pad | free, $200 | 2×5 floor, rug layer (passable), **outdoorOnly** | must touch the sidewalk row (z+d = 28) so vehicles can reach the street | 1 car **or** 2 small | the default parking | ≤ 300 |
| `carport_crooked` | Crooked Carport | free, $650 | 3×6 floor, outdoorOnly, passable except 4 post tiles at its corners | touches the sidewalk row | 1 car + 1 small | roof = **covered** (W-034: no snow wear, snow doesn't pile on vehicles) | ≤ 2,800 |
| `rack_bike` | Bike Rack | free, $60 (craftable) | 1×2 floor, outdoor | anywhere outdoors | 2 small | | ≤ 500 |
| `door_garage` | Roll-Up Garage Door | free, $480 | **opening spanning 3 wall segments** (needs the multi-segment opening extension below) | on a Quick Build / classic wall run facing the street | — | a room behind it with a `pad_garage` floor marker becomes a garage: 1 car per 3×6 interior | ≤ 1,600 (`door` node rolls up) |
| `pad_garage` | Garage Floor Marker | free, $0 | 3×6 rug layer, indoor | inside a room reachable through `door_garage` | 1 car or 2 small | indoor parking; Tune Up gets +0.05 success here | ≤ 100 |

- **Parking spec** (catalog contract, additive): `PhysicalSpec.parking?: { spots: { x: number; z: number; rot: Rot;
  size: 'small' | 'car' }[]; needsStreetAccess: boolean }` in local coords. A car fits a 'car' spot. Small vehicles fit
  either kind, and a car spot holds 2 small vehicles.
- **Multi-segment openings** (for `door_garage`, v1.1 if the lead prefers to ship carports first):
  `ObjectPlacement.opening` gains `span?: EdgeKey[]` (2–3 contiguous, collinear edges). `checkOpening` validates that
  all edges exist and are free and that both sides have free tiles. Pathing treats every spanned edge as a door.
  Rooms treat them as a door. **Proposed** as an additive spatial contract change. If deferred, ship `carport_crooked`
  only.
- **Street parking (no parking object):** every lot template exposes up to 2 **curb spots** on the street just beyond
  the sidewalk at the entry points (render-only positions, z = 29.5). Community lots list curb spots in their template
  (levels docs). Vehicles on curb spots get weather wear and "Ticket!" flavour: on community lots, curb parking > 4 h
  costs a $15 parking ticket (mail). Owned lots have no ticket.
- **Arrival placement:** at the destination, each vehicle takes the first free spot for its size: parking objects
  (home lot), else curb spots. With no free spot, the vehicle is "parked around the corner" (not rendered, still
  usable). Deterministic order: by vehicle id.

## 6. Upgrades (Garage / Tinker Bench)

Customize from the vehicle menu **"Customize…"** (opens the Garage screen; needs the vehicle on the home lot). Installing
a part takes a zombie a **Install** run at the vehicle (duration below; tinkering xp 20/h). Paint and decals are
instant from the Garage screen (UI-only edits applied as a build-like command).

| Slot | Options | $ | Craft | Install | Effect |
|---|---|---|---|---|---|
| Paint | any tint (hex, palette + picker) | 25 | — | instant | cosmetic (`Paint` material swap, decision #23) |
| Decals | 16 original decals (flames, stitched hearts, bats, racing stripes, "Just Buried", "Honk if you're undead"...) | 15 each, max 3 | — | instant | cosmetic |
| Wheels | 6 styles (spoked bone, whitewall, chrome, monster, wagon, skull hubcaps) | 120 | — | 30 min | cosmetic (Monster = skin-only) |
| Horn | 8 sounds (funeral march bars, ghostly whoo, organ chord, rubber chicken, church bell, owl, theremin, groan) | 40 | — | 10 min | cosmetic; `veh_honk` fun +2 (1/h) |
| Lights | standard / candle-yellow / cryo-blue / toxic-green underglow | 90 | — | 20 min | cosmetic; headlights on at night |
| **Engine** T1/T2/T3 | — | 400 / 900 / 1,600 | W-029 (tnk 4/6/8) | 120 min | engineMult −0.05 per tier (§3) · cars/moped only |
| **Racing Gears** (bike) | — | 150 | — | 30 min | engineMult 0.95 |
| **Seats** | Sidecar (moped +1) · Bench Seat (sedan +1) · Jump Seats (hearse +2) | 300 | — | 60 min | capacity |
| **Trunk** | Roof Rack / Big Trunk | 250 | — | 45 min | cargo ×1.5 |
| **Tinted Windows** | — | 350 | W-029 (tnk 3) | 60 min | Look Alive *Entrance* +8 Passing for 60 min after arrival (cars/hearse only) |
| **Reinforced Chassis** | — | 500 | W-029 (tnk 5) | 120 min | wear ×0.6 |

The upgrade values are household-$ prices. Premium entitlements cover only **cosmetic** slots (paint palettes, decals,
wheels, horns, lights, skins). The functional slots (engine, seats, trunk, tint, chassis) are never sold for GG
(unit test).

## 7. Gameplay interactions (vehicle as a target)

New target kind `TargetRef { kind: 'vehicle'; id: VehicleId }` (additive). The renderer picks vehicles (`PickResult`
gains `{ kind: 'vehicle'; id }`).

| id | Label | Duration | Effects | Anim | Autonomous |
|---|---|---|---|---|---|
| `veh_driveTo` | Drive To… | — (opens the Neighbourhood Map with Drive preselected) | §3 | **`enterVehicle`** one-shot (fallback `pickup`) | no |
| `veh_refuel` | Refuel | 3 | tank ← stock | `clean` | no |
| `veh_tuneUp` | Tune Up | 45 | §4 | **`fixVehicle`** (crouched under the bonnet; fallback `clean`) | no |
| `veh_install` | Install {part} | per §6 | applies the upgrade | `fixVehicle` | no |
| `veh_wash` | Wash | 20 | §4 | `clean` | no |
| `veh_honk` | Honk the Horn | 1 | fun +2; nearby sleepers: no wake (the comedy is the sound only; no need changes) | `talk` | no |
| `veh_sitRadio` | Sit In and Listen to the Radio | 60 | fun +12/h (inside the shipped 6–22 band), social +3/h if 2+ | (zombie hidden inside; `sit`) | no |
| `veh_selfie` | Rear-View Selfie | 5 | photo (W-028) | `selfie` | no |
| `veh_offerRide` | Offer a Ride (social, Friendly) | — | §3.3 | `talk` | no |
| `veh_sell` | Sell | — | refund `value × 0.6 × (0.5 + condition/200)` (crafted vehicles use the W-029 resale rule) | — | no |

**Delivery side gig** (DESIGN_PILLARS §D): phone → **"Deliveries (2 h)"** (or the new odd-job board at Rot Row). Needs a
vehicle on the lot with condition ≥ 20 and fuel ≥ 3 × fuelPerBlock (bike: none). The zombie leaves like a work shift
(presence `atWork`, the existing away-need rates of GDD §10: hunger −4, energy −5, fun −2, social +3, hygiene −3)
with the vehicle (the vehicle becomes unavailable for travel during the gig).

| Vehicle | Pay | Fuel | Wear |
|---|---|---|---|
| bike | $12/h | 0 | −4 |
| moped | $15/h | 1.5 | −5 |
| sedan | $18/h | 3 | −6 |
| hearse | $18/h | 4.5 | −7 |
| Tips | +15 % when the driver's Passing ≥ 60 at departure (W-027) | | |

At most 1 gig per zombie per game day. 07:00–21:00 starts only. Not autonomous. Pay is credited at return with
idempotency key `gig:<tripId>`. Breakdown rules apply (−15 min of pay when one happens).

**Townies drive too (render only):** ambient street traffic. 0–3 vehicles at a time drive along the street, drawn from
the vehicle models + townie appearance seeds. The spawn schedule is a render-side hash of `(levelId, real frame time)`:
no sim state, no sim RNG, never pickable. Disabled on Low quality and with `reduceMotion` (static parked cars instead).

## 8. Data model (additive)

```ts
// src/sim/types.ts
export type VehicleId = string;                       // 'v<n>' from world.nextId
export interface VehicleState {
  id: VehicleId;
  defId: 'veh_bike' | 'veh_moped' | 'veh_sedan' | 'veh_hearse';
  skin: string | null;                                // cosmetic entitlement id
  tint: string | null;
  decals: string[];                                   // ≤ 3
  upgrades: Partial<Record<'wheels'|'horn'|'lights'|'engine'|'gears'|'seats'|'trunk'|'tint'|'chassis', string>>;
  condition: number;                                  // 0..100
  dirt: number;                                       // 0..1 cosmetic
  fuel: number;                                       // tank units
  odometerBlocks: number;
  value: number;                                      // resale basis ($ paid, or crafted resale)
  crafted: boolean; quality: number | null;
  purchasedTick: number;
  /** Where it is. null = in transit / on a gig. */
  parked: { lotId: string; spot: { objectId: ObjectId; index: number } | { curb: number } | { aroundCorner: true } } | null;
  gig: { agentId: AgentId; returnTick: number } | null;
}
// WorldState gains: vehicles?: Record<VehicleId, VehicleState>   (world-level, never inside a lot snapshot)
// HouseholdState gains: fuelUnits?: number
// TownState.trip gains: groups?, events?, tripId? (§3)

// src/sim/contracts.ts
export interface VehicleDef { id: string; name: string; price: number; seats: number; cargo: number; vehicleMult: number;
  fuelPerBlock: number; tank: number; parkSize: 'small' | 'car'; modelId: string; upgradeSlots: string[] }
export interface VehicleUpgradeDef { id: string; slot: string; price: number; installMin: number; cosmetic: boolean;
  appliesTo: string[]; effect?: { seats?: number; cargoMult?: number; engineTier?: number; wearMult?: number; tint?: boolean } }
// ContentModule gains: vehicles?: VehicleDef[]; vehicleUpgrades?: VehicleUpgradeDef[]
// Command gains: | { type: 'vehicle'; action: 'buy'; defId: string; payWith: 'funds' }
//                | { type: 'vehicle'; action: 'customize'; vehicleId: VehicleId; tint?: string|null; decals?: string[]; skin?: string|null }
//                | { type: 'vehicle'; action: 'sell'; vehicleId: VehicleId }
// TargetRef gains: | { kind: 'vehicle'; id: VehicleId }
// SimulationAPI gains: vehicles?(): VehicleView[];  planTrip?(toLotId, plan): TripPlanView  (pure preview: minutes, groups, fuel, reasons)
// SimEvent gains: | { type: 'vehicle'; what: 'bought'|'sold'|'parked'|'departed'|'arrived'|'brokeDown'|'repaired'; vehicleId: VehicleId }
export interface VehicleView { id: VehicleId; name: string; defId: string; condition: number; fuel: number; tank: number;
  seats: number; cargo: number; parked: VehicleState['parked']; broken: boolean; onGig: boolean; look: { modelId: string; skin: string|null; tint: string|null; decals: string[]; wheels?: string; lights?: string; dirt: number } }
```
- **Buying:** the Buy catalogue's new **Vehicles** category (or the Rot Row Motors venue in L3) issues
  `{ type: 'vehicle', action: 'buy' }`. It charges $ with idempotency `veh:buy:<nextId>`, then places the vehicle at the
  first free home parking spot or curb spot. Buying needs a parking spot, or a curb spot as fallback; with none, the
  purchase is refused ("No room to park — build a driveway"). Buying is refused off the home lot unless at a dealer
  venue.
- **Schema:** optional fields only, no version bump. `repairWorld`: vehicles with an unknown defId are removed
  (warn); NaN fields are clamped; a parked lotId that doesn't exist resets to a home curb spot; more than 4 vehicles
  keeps the first 4 by id (warn). A healthy world is a no-op.
- **Snapshots/catch-up:** vehicles are world-level. Catch-up on re-entry: parked-outdoors snow wear per elapsed day,
  closed form. Gig returns are resolved by tick on re-entry (idempotent by `gig:<tripId>`).

## 9. Determinism

- Breakdowns and delays are resolved **once at departure** from `ctx.stream('vehicles')` and stored in
  `trip.events`. Arrival effects (wear, fuel, pockets → stash, gig pay) are keyed by `tripId`. Replay, save/load
  mid-trip and catch-up all give the same result.
- Street traffic is render-only and never touches the sim.
- Without vehicles, trips are carpool-only with `groups` absent. The existing W-025 behaviour is byte-identical.

## 10. UI flows

- **Neighbourhood Map** (W-025 screen) gets a **ride selector** under the destination card: Carpool / Walk / Drive,
  with per-option minutes (`planTrip` preview), fuel needed, and a seat assignment strip showing household portraits
  in vehicle seat slots (drag to rearrange; keyboard: Tab to a portrait, arrows to a seat, Enter to drop). Warnings
  are inline ("Moped needs fuel — Refuel or Order Fuel").
- **Garage screen** (from a vehicle: Customize…): a 3D turntable of the vehicle (reuses the renderer's preview stage
  with a vehicle model). Tabs: Paint · Decals · Wheels · Horn · Lights · Performance · Comfort. Price and install time
  per item, owned and entitlement marks, "Install" queues the run for the selected zombie. A preview horn plays on
  hover/focus (respecting the volume settings). Every control is keyboard-reachable, and the colour picker has hex
  input plus a 16-swatch palette (colourblind-safe names).
- **HUD:** a vehicle chip next to the stash chip (count, a red dot if any vehicle is broken or low on fuel). Its panel
  lists vehicles with condition and fuel bars and the quick actions Refuel/Tune Up/Customize.
- **Trip vignette** (render, ≤ 4 s each way, skippable, off with `reduceMotion`): zombies walk to the vehicle,
  `enterVehicle`, the vehicle pulls out onto the street and drives off-screen. On arrival the reverse happens, plus
  the optional rear-view-mirror inset (W-028 §2.3).

## 11. Render needs

- Models (ASSETS-OBJECTS / W-032 art): 4 base vehicles with LOD0/LOD1 (budgets in §2), wheels as separate nodes
  (`wheel_FL`... spin), a `Paint` slot, `glow` nodes for lights, a `door` node (cars) for enter/exit, a `screen`-like
  node for the decal atlas (decals = a decal atlas texture on a dedicated mesh, which is allowed under the
  never-batched rule as a textured mesh). Skins: Monster Hearse (≤ 6,000), Volt-Hearse (≤ 6,000), Vintage Roadster
  (≤ 6,000), Chopper Bike (≤ 1,500), Scooter Deluxe (≤ 3,000).
- Rider poses on bike/moped while in a vignette: **`rideBike`** (pedalling loop) and **`rideMoped`** (seated lean).
  New ANIM_STATES, fallback `sit`. Car/hearse riders are hidden behind tinted/curtain glass (only shadows show).
- A vehicle on a parking spot is one object batch. Ambient traffic uses LOD1 instanced, ≤ 3 draw calls.
- Dirt: a 4-step immutable material variant swap (decision #23 rules).

## 12. Audio needs

New SFX: `engineStartMoped`, `engineStartCar`, `engineIdle` (loop), `engineDriveAway` (doppler), `bikeBell`,
`bikeChain` (loop), `carDoor`, `hornFuneral`, `hornGhost`, `hornOrgan`, `hornChicken`, `hornBell`, `hornOwl`,
`hornTheremin`, `hornGroan`, `refuelGlug`, `wrenchClank`, `breakdownSputter`, `voltHum` (EV skin). Street ambience
gets a soft distant-traffic layer when traffic is on.

## 13. Store tie-ins (cosmetic only)

| SKU | Tier | Price | Contents |
|---|---|---|---|
| Monster Hearse skin | premium | 600 GG (furniture band upper) | hearse skin + monster wheels + flames decal |
| Volt-Hearse EV | **sponsor** (free, house brand) | 0 | hearse skin + `voltHum` + charge-port; requires owning a hearse; brand kill-switch per MONETIZATION §4 |
| Vintage Roadster skin | premium | 500 GG | sedan skin |
| Chopper Bike skin | bones | 240 Bones | bike skin |
| Scooter Deluxe skin | bones | 300 Bones | moped skin |
| Horn Pack (4 extra horns) | premium | 200 GG | horns |
| Decal Pack *Graveyard Racing* (8) | premium | 250 GG | decals |
| *Road Ghoul* bundle | premium | 1,400 GG (sum of parts 1,550 shown) | Monster Hearse + Roadster + Horn Pack + Decal Pack |

The test enforces that no SKU contains a functional upgrade (§6), fuel, condition or a vehicle without the in-world $
purchase.

## 14. Balance (BALANCE.md stays valid)

- No vehicle exists in any BALANCE scenario, and the carpool behaviour is unchanged (`groups` absent), so A–D are
  byte-identical (vehicles stream untouched).
- Money: the delivery gig at most $36/day/zombie (sedan 2 h) minus fuel ~$6. It is an opt-in player action, and only
  raises funds (targets are lower bounds). Costs (fuel, repairs, parking tickets) are opt-in through vehicle
  ownership.
- **New scenario `V`** (harness): B + bike bought on day 3 + 1 bike gig/day by the non-worker + one Rot Row trip every
  2 days. Targets: GDD §18 targets hold; funds trend ≥ B − $5/day; no repo/power cut.

## 15. Interplay with levels

| Level | Adds |
|---|---|
| L1 | Bike (free catalogue), Driveway Pad, Bike Rack; quest `story_ww_wheels` (ride to the Corner Park, 50 Bones) |
| L2 | Graveyard curb spots; night travel: carpool not running 01:00–06:00, so your own vehicle matters |
| L3 | **Rot Row Motors** dealer (moped, sedan; trade-in at resale value), Market fuel, odd-job board for deliveries, parking tickets |
| L4 | Boat tours remain rabbit holes (levels README §10); snow/rain travel multipliers matter on bayou roads; sedan muddy dirt ×2 |
| L5 | Hearse at the dealer's Mausoleum showroom, valet curb at the Country Crypt Club (tinted windows → Entrance bonus) |
| L6 | No vehicles underground; travel to the Catacomb Market is a walk-through (levels README) |
| L7 | Necropolis parade: vehicles join the holiday parade (W-034) as floats (cosmetic) |

## 16. Edge cases

- **Vehicle on a gig when the household travels:** that zombie is at work and stays (v1 rule "workers at work stay at
  work"). The vehicle is excluded from the plan.
- **A parking object is sold while a vehicle is on it:** the vehicle moves to the next free spot, or a curb spot, or
  around the corner (deterministic order). This is never refused, and never deletes the vehicle.
- **Buy a 5th vehicle:** refused ("Your household can keep 4 vehicles").
- **Household member crumbles mid-trip:** impossible. Trips are atomic in sim time (agents are off-lot during the
  trip, and decay ticks keep running per W-025). On arrival the crumble rules apply as normal.
- **Fuel stock overflow** (cap 60): an order that would exceed it is refused with a reason.
- **Save during a trip:** `trip.groups/events` persist. Load → continue arrives at the same tick, with the same wear
  and fuel effects (idempotent by tripId).
- **Corrupt `vehicles`:** see §8 repair. `vehicles: []` (an array instead of an object) → reset to `{}` with a warning.
- **Under-15 profile:** no change (no purchases without consent applies to GG only; household $ is in-sim money).

## 17. Acceptance tests

1. Travel formula table: 20 fixtures (each vehicle × 5 distances × weather), including the 10-min floor and the 45-min
   clamp before multipliers.
2. Group assignment: 1–8 travellers × vehicle mixes → exact groups and arrival tick. Property: every traveller is in
   exactly one group; seats are never exceeded.
3. Determinism: departure → save mid-trip → load → arrival gives byte-identical state versus an uninterrupted run.
   Journal replay is identical. A breakdown resolved at departure is never re-rolled.
4. Idempotency: replaying the arrival handler twice (catch-up applied twice) leaves wear/fuel/stash/gig pay
   unchanged.
5. **Isolation:** BALANCE A seeds 11/22/33, 3 days, with and without the vehicles system: byte-identical.
6. Cosmetic-only store: every vehicle SKU's contents ⊆ cosmetic ids (automated).
7. Fuzz: 5,000 random vehicle commands (buy/sell/customize with bad ids, NaN tints, 10 decals) give no throw;
   invariants: funds ≥ 0, condition 0..100, fuel 0..tank, ≤ 4 vehicles, every parked vehicle on a valid spot.
8. Parking: selling the driveway with a car on it relocates the car. Multi-segment garage door (if shipped):
   pathing through all 3 segments; room separation.
9. Perf: `planTrip` preview < 0.2 ms. 3 ambient traffic cars + 2 parked vehicles add ≤ 6 draw calls.
10. Real browser: the keyboard-only flow buys a bike, rides to the Corner Park and returns; screenshots of the Garage
    screen for each vehicle.

## References

- levels/README.md §3: the travel formula `clamp(round(15 + 0.06·d), 15, 45) × vehicleMult`, floor 10 min, with this
  doc owning `vehicleMult` (its examples: bike 1.1, car 0.7, matched here).
- MONETIZATION §1/§4: no paid power; house brands only (Volt-Hearse); sponsor tier = free brand skin.
- Real-world grounding: delivery couriers by bicycle/moped/car earn similar hourly gross with higher vehicle running
  costs for cars. The gig table mirrors that shape (higher pay, higher fuel and wear for bigger vehicles) without
  claiming real wage figures.
