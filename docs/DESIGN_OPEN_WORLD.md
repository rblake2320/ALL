# Open world, first person, homes, crews and raid nights — owner direction (2026-11-11)

Work items: **W-135..W-149**. Decisions: **D-075..D-079**. Builds on the walkable world (W-025, D-068,
`docs/DESIGN_WORLD_LEVELS.md`), private homes (W-066, `docs/DESIGN_HOMES_SOCIAL_COLLECTIONS.md` §2) and online social
(W-043, `docs/DESIGN_LIVE_WORLD.md` §4). Where this file and those disagree, this file is the newer owner direction
and the older file's owner should be asked before either is changed.

This file is a **build specification and a roadmap**. Each stage in §6 is one or more PRs with its own acceptance
criteria (§7). A stage that is not finished stays on the roadmap; nothing here is "done" until its tests exist.

## 1. Owner direction (source)

Owner (rblake2320), 2026-11-11, in the Perplexity session linked from PR #86:

1. "This game should be open world style game that is able to have areas generated as you walk around. Currently the
   players seem fixed to house but you should be able to select a character and walk around the world, go from a 3rd
   person view to more of a first person view."
2. Homes like hideouts and lairs: "only invited people can go in your home and then you have permission levels that
   you can give them so they can come in or change things or port in"; "more than one place to be".
3. "Having a sim style but can later turn to being able to play first person and then go hunt or fight … being able
   to chat and have friends."
4. "Room for real sponsor or advertising with real companies having real things in the game. Those would be controlled
   and built by only certain people."
5. "Walking the world I can go to homes and look around but I can't go inside." Guard dogs: "if you go into their
   space you can get attacked. But you can be safe in your own yard."
6. A night event "where you can go and try to attack and rob people's homes", with "team planning and coordination
   and calling for help and backup".
7. "Chat feature and ways to turn off and report for people being nasty, rude, racist … Turn off features of blood
   and guts. Having all the things current games have."
9. Takeovers (2026-11-11, later the same day): "there can be a purge, but then there also can be a takeover … you
   can take over somebody's property … the next night they will be trying to capture it back. Maybe it can only be
   done on a second home, not somebody's home."
10. "They do have browser rendering currently without needing a machine's GPU, so want to explore all of that."
8. "The hope is that I will use all this to start and then have this be open and shared building with others, but
   the start has to be solid."

## 2. Player promise

Pick any zombie in your household and be that zombie. Pull the camera down from the dollhouse view to over the
shoulder, then into their eyes. Walk out of the gate and keep walking: the town keeps going, built from the world's
seed as you reach it. Other homes are real places you can look at from the street and enter only when invited. Your
own homes are safe. Friends, crews, chat and scheduled raid nights come on top of that, each one opt-in.

## 3. What changes, what stays

| Topic | Before | Now |
|---|---|---|
| View | One orbit camera above the lot (`CameraRig`, pitch 0.35–1.25, distance 6–60) | Three **perspectives** on the same scene: `overview` (unchanged), `shoulder`, `firstPerson` (§4.1) |
| Control | Click an object or a tile; the zombie queues an interaction | The same, plus **direct control** of the selected zombie (§4.2). Direct control produces ordinary journaled orders, so replay and crash recovery stay exact |
| World extent | Authored map: Mildew Lane + graveyard, later districts; unbuilt areas fenced off (W-025 §1.10) | Authored districts stay authored. Everything between and beyond them is **generated from the seed** as the player approaches (§4.3) |
| Multiplayer | Non-goal for v1 (W-025 §1.13) | Still not in the offline game. Added as later stages behind the same legal gate (W-095), designed now so the offline stages do not have to be rebuilt (§5) |
| Rating | E10+, comedic, no gore (D-005) | **Open owner decision** (§8, O-1). Until it is made, everything built stays inside E10+ |
| Determinism, saves, journal | Byte-deterministic sim; journaled commands | Unchanged and binding. No stage may weaken them |

## 4. Systems

### 4.1 Perspectives (W-136)

- `overview`: today's camera, untouched. Build and buy modes always use it.
- `shoulder`: camera 3.2 tiles behind and above the selected zombie, looking past it. Mouse or right stick turns the
  view; the zombie stays in frame.
- `firstPerson`: camera at the zombie's eye height (1.55, below `DIM.HEAD_TOP` 1.78), wide field of view, own body
  hidden, walls drawn at full height (wall mode forced to `up`, restored on exit).
- One key cycles the perspective (`V`), `Esc` returns to `overview`. A HUD button does the same, 44 px, labelled, with
  the current perspective announced in the polite live region.
- Entering build mode or buy mode, or losing the selected zombie (it leaves the lot, crumbles, the world unloads),
  returns to `overview`. A modal does not (the HUD is a DOM layer and stays reachable in every perspective); `Esc`
  closes the innermost HUD layer first, then leaves the close view, then opens the pause menu (D-078).
- Reduce motion: perspective changes cut instead of glide; no head bob in any setting by default.
- The camera never passes through a wall that is drawn at full height in `shoulder`: it is pulled in toward the
  zombie until the line of sight is clear (pure helper, tested). With cutaway or lowered walls nothing is in the way.
- Any drag looks around in a close view; the wheel moves the shoulder camera; the orbit camera's state is never
  written, so returning to `overview` shows exactly the view the player left.
- First-person art is the largest cost of this whole direction: interiors, ceilings and object backs were made to be
  seen from above. Stage R1 ships the camera; a separate art pass (W-136b, ZSM) lists and fixes what looks wrong at
  eye level. Roofs and ceilings are not drawn today; R1 states that honestly in its PR.

### 4.2 Direct control (W-137)

- In `shoulder` and `firstPerson`, movement keys (WASD / arrows / left stick / on-screen stick on touch) walk the
  selected zombie relative to the view.
- Implementation rule: direct control **issues the existing `engine_goHere` order** to a tile ahead of the zombie,
  re-issued as the heading changes, at most 4 orders per second. It never writes agent positions. That keeps one
  movement system, one pathfinder, one journal.
- "Use" key (`E`) = the default interaction of what the zombie is facing, through the existing interaction menu rules
  (`menu.ts`), so nothing becomes possible in first person that is not possible by clicking.
- Autonomy pauses for the controlled zombie while a movement key is held and for 5 game minutes after; needs keep
  decaying. The rest of the household lives on as usual.
- If measured feel is poor (latency from tick-quantised pathing), the fallback is a dedicated `steer` order with a
  heading and a duration. That is a sim contract change and goes through Claude Cloud.

### 4.3 Generated world (W-138)

Method verified against how browser open-world games do it today (sources in §10):

- The world is cut into the existing 10-tile cells (`CELL_TILES`). A cell's content is a **pure function of
  (world seed, generator version, cell x, cell z)**. Same inputs, same bytes, on every machine.
- **Authored regions win.** Every authored district (Mildew Lane, Old Graveyard, Rot Row, Bayou, Mausoleum Hills)
  reserves its cells. The generator fills only unreserved cells: connecting streets, vacant plots, small parks,
  wild ground, neighbour lots with seeded exteriors.
- **Saves hold the seed and the changes, never the generated content.** A region the player has not altered costs
  zero bytes. A region the player has altered stores its diff (`RegionRecord`), so the 4 MB save cap (AC-12) holds.
- **Generator version is saved with the world.** A world keeps the generator it was created with. A newer generator
  applies only to cells no player has visited; visited cells are pinned. This is the "old chunks keep their shape"
  rule from block-world games, made explicit.
- **Bounds.** v1 stays inside the existing `WORLD_SPAN_TILES` (2,560 × 2,560 tiles). An unbounded world needs a `CellId` change and is not planned before live service.
- **Streaming.** Generation runs off the main thread (worker) with a per-frame budget; a cell that is not ready is
  never walkable-but-invisible: the route result is `locked` with the text "Still unpacking this street".
- **Rendering.** Repeated props (fences, lamps, trees, exterior shells) are instanced; distant cells use the warm
  shells of W-025 §1.4; fog hides the edge of what is loaded. Budgets are W-025's (AC-8, AC-9), not new ones.
- **Reserved slots.** The generator leaves marked plots for sponsor venues (§4.9) and community builds (W-132), so
  later content lands in existing worlds without moving anything.

### 4.4 Homes: more than one, private, with permission levels (W-139, extends W-066)

- A household can own **several homes** (start: the Mildew Lane lot; later: a second lot, a crypt under it, a Bayou
  stilt house). One is "home" for autonomy; the others are places to be. Travel between owned homes is instant from
  the overview map ("port home"), subject to the hearse rules for far districts.
- **From the street you see the exterior only.** Windows of homes you may not enter are curtained; the interior is
  not loaded, not sent, and not in memory. That is a privacy rule and a performance rule.
- **Permission levels**, per home and per friend, each including the ones before it:

  | Level | May |
  |---|---|
  | `none` | See the exterior from public ground |
  | `yard` | Enter the yard, use public yard objects |
  | `visit` | Enter the house, look, use objects marked shareable |
  | `decorate` | Move and place objects from the owner's inventory; cannot sell, cannot spend the owner's money |
  | `defend` | Counts as a defender during a raid night (§4.8); time-boxed |
  | `coOwner` | Everything except transferring or deleting the home |

  Separate flag `portIn`: may arrive directly at the home's door instead of walking.
- Rules: private by default; the owner can revoke at any time and the guest is walked out to public ground; a guest
  can never take items, sell items, or spend the owner's currency; every permission change is logged for the owner.
- Offline, the same model governs townies (a townie with `visit` may come in; without it they knock), so the rules
  are exercised and tested long before a server exists.
- Rank gates of W-066 stay (invite at rank 10, co-build at rank 30).

### 4.5 Decorating (extends W-065 free placement)

Free placement, a per-home item limit shown as a meter, inventory separate from the lot, layouts that can be saved
and re-applied, and a home exterior that is the home's public face (curb appeal). Layouts are data
(seed + changes again), which is also what makes them shareable later.

### 4.6 Friends, chat, safety (W-143, extends W-043)

- Friends, crews (named group, roles, shared chat), presence, invitations.
- Text chat for 15+ only, filtered on the server, with **mute, block and report on every message and every player
  card**. Blocked players cannot see, message, visit or target each other. Under-15 and unanswered age profiles get
  preset phrases and emotes only (already in W-043).
- Chat is **off until the player turns it on**; a profanity filter is on by default; voice chat is not in scope.
- Reports carry the message, its context window and both player ids to a moderation queue; a reported player's chat
  is rate-limited pending review. Nothing is stored for under-15 profiles beyond what COPPA review (W-095) allows.
- Rating effect, checked: in Europe, chat that cannot be muted or blocked and is not moderated puts a game at PEGI
  18; in North America chat is a notice ("Users Interact"), not a rating factor (§10).

### 4.7 Combat, hunting, content intensity (W-140, W-141)

- First-person hunting and fighting come after the walkable world, not before.
- **Content intensity** setting with two values: `comic` (default) and `full`. In `comic`, hits show stuffing, dust
  and stars, and limbs pop off and can be put back (the game already has limb loss as comedy). `full` exists only if
  the owner chooses a rating that allows it (O-1).
- Checked fact that shapes this: a setting that hides gore **does not lower the rating**. The ESRB rates the most
  extreme content a game can show, with filters ignored (§10). So `full` being present at all sets the rating; the
  toggle is for players and families, not for the rating board.
- Hit feedback must survive the toggle: every hit has a non-gore visual and a sound.

### 4.8 Home security and raid nights (W-142, W-144)

Working title **Eviction Night** (original name; a film title is not to be used in the game, its store pages or its
code; name check under W-095 before public use).

- **Your yard is safe.** Nobody can be attacked on a lot they own or co-own outside an event they joined.
- **Home security as play:** guard pets (W-013), alarms, locks, lights. A trespasser in a yard without `yard`
  permission is chased off by the guard pet. Offline this applies to townies and strays.
- **Raid nights are opt-in per event.** A household that does not opt in cannot be raided and cannot raid.
- **Bounded loss.** A raid can take only items the owner placed in the home's "at risk" set, capped per event; the
  catalogue price of anything taken is the ceiling of the loss; purchased (real-money) items are never at risk.
  This keeps real money out of chance outcomes, in the spirit of D-006; legal review under W-095.
- **Crews** plan before the event: scouting is limited to what is visible from public ground, so curb appeal is also
  risk. Roles: lookout, breaker, carrier, guard. A distress call reaches friends with `defend`, who may port in.
- **Two builds of the same event.** First, **asynchronous**: the defender's home runs its saved defences while the
  owner is away, the raid is recorded as a command log and replayed for the owner (the sim is deterministic, so a
  replay is exact and cheap). Then **live**, on the server of §5. The async build needs no real-time server and
  proves the rules.
- Scheduled through the shared regional calendar (W-025-S15, D-069).

### 4.8.1 Takeovers (W-147)

A crew can **hold** another player's property for a while. It is control, never ownership.

- **Second homes only.** A household's primary home can never be taken. A second home can be taken only while its
  owner has listed it as **contested**; listing is the owner's choice and can be withdrawn when the home is not
  held and no attempt is under way. A contested home earns its owner a stated bonus, which is the reason to list.
- **What the holder gets:** entry, use of the home's shareable objects, the crew's flag on the exterior, standing on
  the neighbourhood map. **What the holder never gets:** the deed, the owner's stored items, the owner's currency,
  the right to sell, move or delete anything. The owner's at-risk set and its cap (§4.8) are the only loss.
- **The owner's night.** The night after a takeover the owner (and friends with `defend`) has a guaranteed attempt
  to retake it; the holder is told when. The holder may defend with the same tools an owner has.
- **It always comes back.** If the owner does not retake it, the home returns by itself after a fixed number of
  days (start value: 3). A home that has just returned cannot be taken again for a cooling-off period (start: 2 days).
- **One at a time.** A crew holds a bounded number of homes (start: 2); a home has one holder.
- Same two builds as raid nights: asynchronous with exact replay first, live second. Same consent rules: nothing
  happens to a household that has not opted in.
- This opens: a neighbourhood control map, crew seasons with standings, hired defenders.

### 4.9 Sponsor venues (W-145, extends W-014)

- Real brands appear only in **reserved plots and brand slots**, built and signed by the owner's approved builders.
  Community packs cannot contain real brands (already the rule in `docs/community/`).
- Every sponsored surface is labelled as advertising in the world and in its DOM text. No sponsored content is shown
  to under-15 or unanswered age profiles, and none is targeted on personal data.
- A sponsor venue is an authored region like any other: it reserves cells, has a content version, and can be removed
  without breaking a save (it reverts to the generated plot).

### 4.10 Open and shared building (extends W-132)

- The unit of sharing is **data**: a layout, a lot, a district as seed + changes, validated by the pack pipeline
  (W-079, W-084). First shared as files, later through the live service.
- The community path opens only after gates G1–G7 of W-132 (patent check, licence and contributor terms, children's
  privacy review, branch protection, CI, first drop, process test). This direction does not change those gates.

## 5. Architecture for the online stages

- **Offline first.** Stages R1–R6 run with no server and stay playable forever without one.
- **Same sim, authoritative on the server.** The sim is already deterministic and command-driven; the live service
  runs it server-side for shared regions and accepts the same commands the journal records. Clients predict and are
  corrected. No client is trusted for position, inventory or permissions.
- **Privacy by construction.** Interiors of homes a player may not enter are never sent to that player's client.
- **Hosting, cost and data protection are owner decisions** (W-097, W-095). Nothing in R1–R6 depends on them.

### 5.1 Where the picture is drawn (W-148, W-149)

Checked 2026-11-11 (sources in §10). "No GPU needed in the browser" means one of two different things:

| | Drawn on the player's device (today) | Drawn on a server, streamed as video |
|---|---|---|
| Needs on the device | Any graphics chip with WebGL (nearly every phone and laptop) | A video decoder and a steady connection |
| Cost to run | Bandwidth for the files | About one cloud GPU per player online at the same time (roughly $0.50–1.00 per player-hour at list prices), plus idle capacity kept warm |
| Latency | None added | A network round trip on every input |
| Works offline | Yes | No |

- **Default: the player's device.** It is the only form whose cost does not grow with every hour played, and the
  game already targets integrated graphics (TEAM_PLAN §8).
- **Streaming is an option, not a rewrite (W-148).** The same build runs in a browser on a rented GPU machine and its
  picture is sent over WebRTC. Nothing in R1–R11 has to change for it. It is worth building only with a way to pay
  for it (a paid "play anywhere" tier, a time-limited try-before-install demo): owner decision O-6.
- **Drawing on the CPU is not a path for players.** Chrome removed its automatic software fallback for WebGL
  (Chrome 137–139): on macOS and Linux a machine without a usable GPU now gets no WebGL at all; on Windows a slower
  system rasteriser stands in. The cloud container's software GL (used for tests here) runs this game at about one
  to three frames per second.
- **So the game must say so clearly (W-149).** When the 3D view cannot start, the player sees what is wrong and what
  to do (turn on graphics acceleration, update the browser, try another device), not a generic crash screen.

## 6. Roadmap

A stage starts only when the one it depends on has merged. "Server" = cannot ship before W-097 + W-095.

| Stage | Work item | What ships | Depends on | Server |
|---|---|---|---|---|
| R0 | W-135 | This specification, workboard rows, decisions | — | no |
| R1 | W-136 | Perspectives: `overview` / `shoulder` / `firstPerson` on today's lot; key, HUD button, a11y, wall and body handling. **Built** (PR stacked on the specification); open: W-136b eye-level art, compact HUD for close views, frame time on real GPUs | R0 | no |
| R2 | W-137 | Direct control through `engine_goHere`; "Use" key; autonomy pause | R1 | no |
| R3 | W-025 S1–S5, S11, S13 | Walkable connected world (existing plan; PRs #78, #79, #59 to be resolved by Claude Cloud); perspectives follow across regions | R1 | no |
| R4 | W-138 | Generated cells between and beyond authored districts; seed + changes saves; generator version pinning; worker streaming | R3 | no |
| R5 | W-139 | Several homes, exterior-only privacy, permission levels, port home; townies obey the same rules | R3 | no |
| R6 | W-142, W-013 | Guard pets, alarms, safe yard, trespass rules against townies | R5 | no |
| R7 | W-140, W-141 | Content intensity setting; first-person hunting and comic combat | R2, R6, owner decision O-1 | no |
| R8 | W-143, W-097 | Accounts, friends, crews, filtered chat with mute / block / report, moderation queue | R5, W-095 | yes |
| R9 | W-144 | Eviction Night, asynchronous with replay; then live | R6, R7, R8 | async: storage only; live: yes |
| R9b | W-147 | Takeovers of contested second homes: hold, the owner's night, automatic return; asynchronous first, then live | R9, R5 (several homes) | async: storage only; live: yes |
| R10 | W-145 | Sponsor venues in reserved plots | R4, W-014, W-095 | no (content), yes (rotation) |
| R11 | W-146, W-132 | Shared building: files first, then live districts | R4, R8, gates G1–G7 | files: no; live: yes |
| — | W-149 | A clear "this device cannot draw the 3D view" screen | none (independent fix) | no |
| — | W-148 | Streamed play (the same build on a rented GPU, picture over WebRTC) | owner decision O-6, W-097 | yes (GPU fleet) |

Before R3 can merge at all: CI has to run again (GitHub Actions is blocked by the account budget) and branch
protection has to be set. Those are owner actions and are the first risk to the whole plan.

## 7. Acceptance criteria

Each PR meets the ones it touches, in addition to the W-025 criteria for anything that touches the world.

| # | Criterion | Test |
|---|---|---|
| OW-1 | **Overview is unchanged.** With the perspective at `overview`, camera state, picking and every existing e2e suite behave exactly as before | existing unit + e2e suites; `tests/unit/render/perspective.test.ts` (overview path is the identity), `tests/unit/game/perspective.test.ts` |
| OW-2 | **Perspective round trip.** `overview → shoulder → firstPerson → overview` restores the exact camera goal and wall mode the player had | `perspective.test.ts`, `tests/e2e/perspective.mjs` |
| OW-3 | **The view follows the zombie.** In `shoulder` and `firstPerson` the camera is within its stated offset of the selected zombie on every frame while it walks | `tests/e2e/perspective.mjs` (sampled over a walk) |
| OW-4 | **No trap.** Build mode, buy mode, the selected zombie leaving or crumbling, and `Esc` each return to `overview`; garbage inputs (unknown mode, unknown agent, NaN pose) leave the camera valid | `perspective.test.ts`, controller tests |
| OW-5 | **Accessible.** The perspective control is a labelled button reachable by keyboard, 44 px on touch, state announced; Reduce motion cuts; axe finds no new violations | `tests/e2e/perspective.mjs` |
| OW-6 | **Direct control is replayable.** A direct-control session, killed mid-walk, recovers to the same world as the uninterrupted run; no order rate above 4 per second | `tests/e2e/journal.mjs` variant, `tests/unit/game/directControl.test.ts` |
| OW-7 | **Generation is pure.** Same (seed, generator version, cell) gives byte-identical content across runs and worker / main thread; 10,000 cells, no authored cell ever overwritten | `tests/unit/shared/worldgen.test.ts` |
| OW-8 | **Untouched regions cost nothing.** Walking 500 generated cells without changing them adds 0 bytes of region data to the save; a changed cell stores only its diff | `tests/unit/world/saveSize.test.ts` |
| OW-9 | **Generator upgrades pin visited cells.** Loading a world under a newer generator leaves every visited cell byte-identical | `tests/unit/shared/worldgen.test.ts`, `migrate.world.test.ts` |
| OW-10 | **Every generated start is playable.** 1,000 seeds: every generated cell adjoining a street is reachable, no route enters a cell that is not ready | property test |
| OW-11 | **Privacy holds.** A member without `visit` gets route reason `private` at the door; the interior of that home is absent from the render scene and from any payload | `tests/unit/shared/access.test.ts`, e2e scene inspection |
| OW-12 | **Permissions are monotonic and revocable.** Each level allows exactly its row of §4.4; revocation takes effect on the next tick and walks the guest out; no level allows taking, selling or spending | `access.test.ts` (table-driven, every level × every action) |
| OW-13 | **Safe yard.** No hostile action can target an owner on their own lot outside an event they joined (fuzz) | `tests/unit/sim/safeYard.test.ts` |
| OW-14 | **Bounded loss.** For any raid, value taken ≤ the event cap, only from the at-risk set, never a purchased item (property test over random homes and raids) | `tests/unit/sim/raid.test.ts` |
| OW-15 | **Replay is exact.** An asynchronous raid's recorded log replays to a byte-identical end state | `raid.test.ts` |
| OW-16 | **Chat safety.** A blocked player's messages never reach the blocker (including history and crew chat); a report captures message + context; under-15 profiles cannot send or receive free text | service tests (R8) |
| OW-17 | **Hit feedback without gore.** With content intensity `comic`, every hit still produces a visual and a sound; no asset tagged `gore` is loaded | `tests/unit/render/intensity.test.ts` |
| OW-18 | **Perf.** `shoulder` and `firstPerson` stay within W-025 AC-8 / AC-9 on the reference machines. Every number names its hardware; the cloud container (software GL) is not evidence | desktop reports (ZSM, Sol, Terra) |

| OW-19 | **Takeovers are bounded.** A primary home and an unlisted second home can never be taken (fuzz); the holder can never take, sell, move, delete or spend anything of the owner's beyond the at-risk cap; the owner always gets the next night's attempt; every held home returns within the fixed number of days with no player action; replay of an asynchronous takeover is exact | `tests/unit/sim/takeover.test.ts` (property tests) |
| OW-20 | **No 3D, clear words.** With WebGL unavailable the game shows a dedicated screen (what is wrong, three things to try, Try again) instead of the generic crash screen; keyboard focus lands on it; no page error | `tests/unit/shared/fatalKinds.test.ts`, `tests/e2e/no3d.mjs` (Chromium with WebGL disabled) |

## 8. Open owner decisions

| # | Decision | Why it blocks | Default until decided |
|---|---|---|---|
| O-1 | **Rating: stay E10+ (comic damage only) or move to Teen** | Sets what R7 and R9 may show; a gore toggle does not lower a rating | E10+ (D-005 stands); `full` intensity is not built |
| O-2 | **Live service: go or no-go, hosting, budget** | R8, live R9, R10 rotation, live R11 | Not started; R1–R7 and async R9 do not need it |
| O-3 | **World size: bounded 2,560 tiles or unbounded** | `CellId` contract | Bounded |
| O-4 | **Who resolves the open walkable-world PRs (#78, #79, #59) against batch-1106** | R3 | Claude Cloud |
| O-5 | **CI budget and branch protection** | Any merge to `ship/final-phase` under TEAM_PLAN §4 | Local evidence only, PRs stay draft |
| O-6 | **Streamed play: build it, and who pays** (a GPU per concurrent player) | W-148 | Not built; the game draws on the player's device |

## 9. Risks

| Risk | Effect | Answer in this plan |
|---|---|---|
| First-person art | Interiors made for a top view look wrong at eye level | Camera first (R1), then a listed art pass; no ceiling claimed until built |
| Low-end performance | Wider view draws more | Budgets from W-025; fog and instancing; measured on named hardware only |
| Save compatibility | New world data breaks old saves | Seed + changes; every schema step has a migration test (AC-7) |
| Generator drift | A code change reshapes a player's town | Generator version saved and pinned (OW-9) |
| Determinism | Direct control or worker generation introduces wall-clock input | Orders only (OW-6); generation is pure (OW-7) |
| Griefing | Raids drive away players who only want to build | Opt-in, safe yard, bounded loss (OW-13, OW-14) |
| Children's privacy and moderation | Chat and accounts carry legal duties | Gate W-095 before R8; chat off by default; under-15 preset phrases only |
| Team process | No CI, about 20 open draft PRs | O-5; one integration baseline before R3 |
| Streaming cost | A free streamed tier costs more with every player and every hour | Device rendering stays the default; streaming only with a payer (O-6) |
| Takeovers feel like losing a home | Players stop buying second homes | Control only, opt-in listing, guaranteed retake, automatic return (OW-19) |

## 10. Sources checked (2026-11-11)

- Chunk streaming with fog at the load edge: https://www.shanebrumback.com/articles/threejs-procedural-terrain.html
- Seed-pure chunks: https://gilesknap.github.io/mc-html/prompt.html
- Saving only the changes to generated chunks: https://github.com/11adyy/crust
- Generation in web workers: https://github.com/Vincent-P-essy/minecraft-clone
- Instancing cost (10.3 ms vs 0.16 ms in the lesson's measurement): https://spareilleux.github.io/learn/threejs/08-performance-instancing-batching-lod/
- A first-person open-world game in Three.js: https://discourse.threejs.org/t/everrealm-a-first-person-open-world-retro-fantasy-rpg/94518
- Seams when a generator changes: https://www.gameserverkings.com/knowledge-base/minecraft/world-management/
- ESRB rates the most extreme content regardless of filters: https://kotaku.com/taking-the-taboo-out-of-mature-gaming-5843782
- ESRB interactive elements do not influence the rating: https://www.esrb.org/ratings-guide/
- ESRB disclosure of the most extreme content: https://www.esrb.org/ratings/ratings-process/
- One cloud GPU per concurrent viewer, about $0.77 per viewer-hour with a warm buffer: https://vinode.io/blog/cost-of-streaming-3d-per-viewer-study
- Cloud GPU list prices and per-session scaling: https://game-ace.com/blog/unreal-engine-pixel-streaming/
- Browser cloud gaming over WebRTC: https://ppc.land/cloud-gaming/
- Chrome removed the automatic software WebGL fallback (SwiftShader): https://support.google.com/chrome/a/answer/7679408 and https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- PEGI and unmoderated chat (secondary source; confirm with PEGI under W-095): https://www.pouyam.com/guides/video-game-age-ratings-esrb-pegi-explained
