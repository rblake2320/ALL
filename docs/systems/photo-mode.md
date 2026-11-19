# W-028 Mirror Cam & Photo Mode: selfies, the Lookout Mirror, in-game cameras, gallery and share cards

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_PILLARS §A (Mirror Cam / Photo mode), the
owner's message ("look in a mirror and have mirror view something down the road"), CONTRACTS decisions #20/#23
(`snapshot()`, static batching), PLATFORM (ProfileStore), MONETIZATION §1 (minors: no free-text UGC under 15).

## 1. Player fantasy

*"Let me fix my wig and take a selfie."* Your zombies pose in the mirror, take Ghoul-aroid snapshots of the family
dinner and hang the good ones on the wall. A convex **Lookout Mirror** at the end of the drive shows you who's
coming down the road: the carpool, the pizza ghoul, or the dreaded Repo Ghoul. When you just want a pretty picture,
**Photo Mode** freezes the moment, frees the camera and adds filters and frames. Then you save a share card.

Two layers, kept strictly apart:
- **Sim photos** (`photo_*` interactions): deterministic in-world items with quality, skill xp and value.
- **Photo Mode** (UI/render only): never touches the sim. No xp, no items, no RNG. Deterministic by construction.

## 2. Mirror views ("look in a mirror and see down the road")

### 2.1 Mirror Selfie (any `mirror`-tagged object)

- Interaction `photo_mirrorSelfie` ("Take Mirror Selfie"): 5 game min, anim `admire` → **`selfie`** (new; one arm
  raised with a phone; fallback `phone`). It creates a sim photo (§3) whose subjects are the actor plus anyone within
  2 tiles of the mirror's front.
- **Mirror Cam view** (render): while the selfie runs, and from the **Mirror Cam** button in Photo Mode when a mirror
  is focused, the renderer draws the scene from the mirror's point of view:
  - camera at the glass centre (`slot front`, pose y ≈ 1.45 m, eye height of a standing zombie) offset 0.05 m along the
    mirror normal, looking out along that normal, FOV 55°.
  - The image is **mirrored horizontally**: projection matrix scaled `x × −1`, with front-face winding flipped
    (`renderer.setFrontFace` / material `side` swap for the pass). This is cheaper and more exact than a planar
    reflection, and no scene duplication is needed.
  - The cracked-mirror overlay (`mirror_cracked`) is a screen-space crack texture (SVG-generated, original) at 40 %
    alpha.
  - In normal play the mirror glass itself stays a cheap dark-silver material. Live in-world reflections are **not**
    rendered: the view is a separate pass, shown in a framed PiP panel or full-screen in Photo Mode.

### 2.2 Lookout Mirror (the "down the road" mirror)

A convex street safety mirror on a post. Real ones are used at blind driveways. Ours is crooked, with a skull finial.

| id | Name | Tier / $ | Footprint | Placement | Tags | Env | Tris |
|---|---|---|---|---|---|---|---|
| `mirror_lookout` | Lookout Mirror | free, $180 (also crafted, W-029) | 1×1 floor, **outdoorOnly** | yard; must be within 3 tiles of the sidewalk row (z ≥ 25) | `lookout` | 0 | ≤ 1,100 |

- Interaction `photo_peekDownTheRoad` ("Peek Down the Road"): 2 game min, anim `admire`, `autonomous: false`. Opens the
  **Road View** PiP for 60 game min (the timer is shown), or until the player closes it.
- **Road View render:** a second camera at the mirror head (y 2.1 m), looking along the street (±X, whichever end has
  more distance to the lot edge; a toggle button swaps ends), FOV 70°. The view is drawn into a 384×216 render target
  and then barrel-distorted in the composite shader (convex look), with a vignette. Update rate: High 15 fps ·
  Medium 8 fps · Low 2 fps. Integrated-GPU "Low" uses 1 fps, one shadow-less pass, and LOD1 for everything.
  Budget ≤ 1.2 ms GPU per updated frame on a GTX 1660.
- **Arrivals ticker** (sim-derived, deterministic): next to the PiP, a list of what will come down the road in the next
  3 game hours, from a new read-only `SimulationAPI.upcomingArrivals?(withinMin)`:

| Kind | Source of truth | Shown as |
|---|---|---|
| carpool | `flags['people:carpool:until']` + career schedules | "Carpool for Mortimer — 08:30" |
| pizza | pending phone order ETA | "Brain Pizza — ~20 min" |
| repo | bill stage 4 + dispatch day | "⚠ Repo Ghoul — tomorrow 10:00" |
| mail | 09:00 mail (bills days) | "Mail (bills)" |
| visitors | invited/party guests with an arrival tick | "Gravella arriving — 19:00" |
| trick-or-treaters | W-034 Halloween schedule | "Trick-or-treaters — 18:00" |
| delivery gig return | W-031 | "Ezra back from deliveries — 16:00" |

Walk-bys are random hourly rolls and are **not** predicted (we never show the future of an RNG draw). The ticker shows
only scheduled events.

### 2.3 Vehicle mirrors (W-031)

During a trip's **depart** and **arrive** vignettes (render-only, ≤ 4 s each, skipped with `reduceMotion` or any key),
the camera can cut to a rear-view-mirror framing: an oval inset showing the zombies on the back seat waving. This is
the same mirrored-camera technique as §2.1, with the camera at the dashboard. It is cosmetic only.

## 3. Sim photos (deterministic items)

### 3.1 Cameras

| id | Name | Tier / $ | Camera tier bonus | Notes |
|---|---|---|---|---|
| (phone) | every zombie's phone | — | 0 | `photo_takePhoto` from the zombie's phone menu |
| `camera_ghoularoid` | Ghoul-aroid Instant Camera | free, $220 | +1 | held item, lives in the household inventory (like kits) |
| `camera_bellows` | Bellows Box Camera | bones 240, $650 | +2 | big wooden tripod camera, floor object 1×1 |
| `booth_photo` | Snap-Your-Rot Photo Booth | free, $1,100 (community lots L3 have one) | +1, 4-shot strip | floor 2×1, `sit` slot inside, curtain node |

### 3.2 Interactions

| id | Label | Target | Duration | Effects |
|---|---|---|---|---|
| `photo_takePhoto` | Take Photo… | tile/agent/object (pick) | 5 min | photo item; creativity xp 20/h; fun +6/h |
| `photo_mirrorSelfie` | Take Mirror Selfie | mirror | 5 min | photo; fun +6/h; charisma xp 10/h |
| `photo_groupPhoto` | Gather for a Group Photo | self (household + guests within 6 tiles join, pair-style) | 10 min | photo with all joiners; *Say Cheese* (+5, 4 h) to everyone; family-dinner style social +4/h |
| `photo_boothStrip` | Photo Booth Strip ($5) | booth | 8 min | a 4-shot strip item (quality from the best shot); fun +15/h; joinable (2 seats) |
| `photo_hang` | Hang Photo | photo item → wall (wall-item placement like paintings) | 3 min | becomes `photo_framed` wall object |
| `photo_sell` | Sell to the Wormwood Gazette | photo item, at the mailbox/computer | 2 min | $ per §3.4, cap 2 per household per game day |
| `photo_strikeAPose` | Strike a Pose | self | 3 min | anim **`pose`** (new, 4 variants by seeded index; fallback `cheer`); fun +4/h. Used by Photo Mode too |

### 3.3 Photo quality (sim formula, 1–5)

```
q = clamp(1 + floor(creativity / 3) + cameraTier
          + (subjects ≥ 1 ? 1 : 0)
          + (avgSubjectMoodBand ≥ 'good' ? 1 : 0)
          + (roomEnvironment(tile) ≥ 5 ? 1 : 0)
          − (any subject Reeking or mid-slip ? 1 : 0), 1, 5)
```
Every input is sim state, so the formula is deterministic. Composition (what the render camera actually framed) is
**never** part of quality, because render output is not deterministic across GPUs.

### 3.4 Photo item and value

- `item_photo` (loose item, `photo` tag, value 0 when spawned): `data = { photoId, q, takenTick, takerId, subjects:
  'a1,a7', lotId, kind: 'photo'|'selfie'|'group'|'strip' }`.
- **Framed:** `photo_framed` (wall item, 1×1, env = q − 2 → −1…+3, sellable value as below).
- **Sell value** (Gazette): `8 + 4 × creativity + 6 × q` (q5, creativity 10 gives $78). A group photo with ≥ 3
  subjects gets ×1.25. At most **2 sales per household per game day**, so the free-money ceiling is about $150/day at
  creativity 10, normally $40–80. The cap counts with `flags['photo:sold:<day>']`. This stays inside the levels scale
  (hobbies below an L1 wage at skill 0, about L2–L3 at skill 8–10).

### 3.5 Image capture (render side, best effort)

When a sim photo is created, the sim emits `{ type: 'photoTaken', photoId, agentId, objectId?, kind, pose }`. Where a
renderer is attached, the game layer frames a shot:
- selfie: the mirror cam view;
- photo of a target: a camera 3 tiles from the actor along their facing, at 1.4 m, looking at the target centre;
- group: a camera centred on the joiners' centroid, distance fit to their bounding box.

It renders a 1280×720 JPEG at q 0.85 (≤ 350 KB) and stores it in the **profile gallery** (§5) under `photoId`.
Headless or no GPU: no image. The item still exists and the UI shows a sepia "faded photo" placeholder generated from
the subjects' appearance colours. The sim never waits for, or depends on, the image.

## 4. Photo Mode (UI/render only)

- **Enter:** `P` (or the camera icon in the HUD time bar). By default the game pauses while in Photo Mode. A toggle
  "Keep time running" sets speed 1×. Exiting restores the previous speed. Not available on the main menu or during
  CAZ (CAZ has its own preview).
- **Free camera:** WASD move, mouse drag orbit, wheel = dolly, Q/E down/up, Shift ×3 speed. It is clamped to the lot
  bounds + 8 tiles, y 0.3–40 m, and collides with the ground (no going under the terrain). The camera may pass through
  walls: cutaway walls are shown down.
- **Controls panel** (right side, collapsible, every control keyboard-reachable):

| Control | Range / options | Default |
|---|---|---|
| FOV | 20°–90° | 50° |
| Roll | −15°…+15° | 0 |
| Depth of field | off / focus-pick (click a point) / auto (selected zombie); aperture 1–8 | off |
| Exposure | −2…+2 EV | 0 |
| Time-of-day preview | lighting only, ±6 h from now (render-only light rig; the sim clock is untouched) | now |
| Weather preview | clear / current / fog / rain / snow (render-only particles + fog) | current |
| Filter (LUT) | None · Sepia Séance · Moonlit · Toxic Glow · Ghoul-aroid · Silent Film (B&W) · Bone China (pastel) | None |
| Frame | None · Ghoul-aroid border · Gothic oval · Film strip · Tombstone · Postcard | None |
| Stickers | 24 original icons (bats, stitched hearts, tiny tombstones, speech bubbles with preset phrases); drag, scale, rotate; max 12 | — |
| Caption | **preset phrases only for under-15 or unknown age brackets** (24 presets); free text (≤ 60 chars, local profanity filter) for teen/adult | — |
| Pose zombie | pick a zombie → one of the `pose` variants or any idle/expression; pose is render-only while paused | — |
| Hide | HUD · bubbles · UI wisps · the selected-zombie highlight | all hidden |
| Grid overlay | thirds / golden / off | off |

- **Capture:** `Space` or `Enter` on the shutter. Renders at the chosen resolution (1920×1080 default; 1280×720 on
  Low; 3840×2160 "Hi-res" on High/Ultra if the max texture size ≥ 4096). The image is composited with LUT, frame,
  stickers and caption, then saved to the gallery with `{ source: 'photoMode' }`. It creates no sim item and no
  sim event.
- **Exit:** `Esc` or `P`. The camera returns to its pre-Photo-Mode state.

## 5. Gallery and share cards

- **Storage (PLATFORM):** a new IndexedDB object store `gallery` in the profile DB (not in world saves: the world save
  budget is ≤ 2 MB). Record: `{ id, worldId, source: 'sim'|'photoMode', photoId?, createdAt, w, h, jpeg (Blob),
  thumb (≤ 24 KB webp), caption?, stickersJson? }`. Caps: 300 images or 120 MB, whichever comes first. At 90 % a
  banner appears ("Gallery almost full — export or delete some"). We never auto-delete. Writes are atomic (one tx per
  image) and idempotent by id.
- **Gallery screen** (main menu → Gallery, and in-game via the phone "Photos" app): a grid of thumbnails filtered by
  world, zombie, source and month. Actions: view, set as save thumbnail, delete (with confirm), export PNG/JPEG, and
  **Share Card**.
- **Share card:** a 1200×630 PNG (the common link-preview aspect ratio). The photo, cropped with a 20 px bone border,
  goes on the left 2/3. The right 1/3 carries the household name, the band chips of the zombies in shot, the in-game
  date ("Autumn, day 6 — Halloween"), the game logo and a small "Afterlife Lease" wordmark. No URL and no QR code
  until the Phase 4 online service. Output: download (web), save dialog (Electron), Web Share API where supported
  (mobile later). There is no in-game upload or social feed (no UGC moderation surface before Phase 4).
- **Minors:** under-15 or unknown bracket: preset captions only and no free-text sticker phrases. Share is
  export-only (already true for everyone).
- **Necropolis (L7):** the **Town Gallery** lot displays framed sim photos the player chooses to donate (the item
  moves to the lot snapshot). Phase 4 online sharing of gallery images goes through moderation (MONETIZATION §7).

## 6. Data model (additive)

```ts
// src/sim/contracts.ts
// SimEvent: | { type: 'photoTaken'; photoId: string; agentId: AgentId; objectId?: ObjectId; kind: 'photo'|'selfie'|'group'|'strip'; subjects: AgentId[] }
// SimulationAPI: upcomingArrivals?(withinMin: number): { kind: string; label: string; etaTick: number; agentId?: AgentId }[]
// photoId = `p${world.nextId++}` (stable, saved in item data)

// src/render/contracts.ts (RendererAPI additions)
export interface PhotoCamera { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; fov: number; roll?: number; mirrored?: boolean }
export interface PhotoRenderOpts { width: number; height: number; camera: PhotoCamera; lut?: string; exposure?: number;
  dof?: { focusDist: number; aperture: number }; hideUi?: boolean; lightingHourOverride?: number; weatherOverride?: string }
//   capturePhoto(opts: PhotoRenderOpts): Promise<Blob | null>            // null without GL
//   setPip(view: { kind: 'mirror'|'road'; objectId: ObjectId; fps: number } | null): void
//   pipCanvasRect(): DOMRect | null                                     // for the UI frame
//   setPhotoMode(on: boolean): void                                      // free camera rules, hides wisps/bubbles

// src/persistence/contracts.ts (ProfileStore additions)
//   gallery.put(rec), gallery.list(filter), gallery.get(id), gallery.delete(id), gallery.usage()
// src/game/contracts.ts (GameController additions)
//   photoMode: PhotoModeState | null; enterPhotoMode(); exitPhotoMode(); capture(): Promise<void>; openGallery()
```
Saved sim state: only `item_photo`/`photo_framed` objects with `data.photoId` and the daily sale counter flag. The
schema is unchanged (objects already carry free-form `data`).

## 7. Determinism

- Sim photos: quality from sim state only. The photo id comes from `nextId`. No RNG except the pose variant
  (`hash32(photoId) % 4`, no stream used).
- The image capture is a side effect in the game layer after event drain and is never fed back into the sim.
- Photo Mode issues zero sim commands (a test asserts that the journal is unchanged across a Photo Mode session).
  Pausing uses the existing speed command, which is journaled like any speed change.

## 8. Render needs (summary)

- Mirrored camera pass (projection flip + winding flip), PiP render target (384×216, shared, one at a time), barrel
  distortion + vignette composite shader, LUT post pass (7 LUTs as 16³ strips generated from code, no image assets),
  frame overlays as SVG drawn to a canvas, sticker atlas (24 SVG icons → 1024² canvas atlas at boot).
- Capture path: an offscreen render at the target resolution reuses the main scene. Bloom, ACES and vignette are kept
  and the UI layer is excluded. Hi-res needs `maxTextureSize ≥ 4096` and is disabled on Low.
- Perf: Photo Mode paused is ≤ the live frame cost. The PiP adds ≤ 1.2 ms per updated frame on a GTX 1660, and it is
  off by default on integrated GPUs (static refresh every 2 s).

## 9. Audio needs

New SFX: `shutter` (mechanical click + film wind), `polaroidEject`, `boothFlash` (4 pops), `mirrorPeek` (soft metal
creak). Photo Mode ducks music −6 dB and plays the existing `uiOpen`/`uiClose`.

## 10. Store tie-ins (cosmetic only)

Premium/bones: filters (3 extra LUTs: *Neon Necro*, *Old Daguerreotype*, *Moss & Mist*, 150 GG each or the bones
equivalent), frames (6 extra, 150 GG), sticker packs (12 icons, 200 GG), the Bellows Camera skin "Brass Bellows"
(300 GG). These change only the image's look. Camera tier bonuses stay the same as the free equivalents
(Ghoul-aroid +1 is free; the Bellows +2 is a **bones** unlock earnable by play).

## 11. Interplay with levels

| Level | Adds |
|---|---|
| L1 | Phone photos, Mirror Selfie, Lookout Mirror, Photo Mode, gallery. Daily task "Take a family photo" (8 Bones) |
| L2 | Night photography of the moonlit graveyard; séance photos show a faint "ghost" in render only |
| L3 | **Photo booth** at Club / Market; Gazette office: sell photos at the counter for +10 % |
| L5 | Gala portrait (Gala Night photo with q +1) |
| L7 | Town Gallery donation wall; share cards for blueprints (W-030) |

## 12. Edge cases

- Mirror removed during a selfie: the run fails ("The mirror was sold") and no photo is made.
- PiP open while the Lookout Mirror is sold, or on a lot swap: the PiP closes silently.
- Photo Mode during a choice popup: choices stay queued and the popup reappears on exit (no auto-resolve while paused,
  because the sim is paused).
- Gallery quota exceeded mid-capture: the capture is kept in memory and the user is prompted to free space or export
  that image. No silent loss.
- Corrupt gallery record: skipped in the list, with a single warning toast. Never crash.
- WebGL context lost during capture: returns null and shows the toast "Couldn't take the photo — try again". The sim
  is unaffected.
- `photo_sell` above the cap: disabled with the reason "The Gazette only buys 2 photos a day".

## 13. Acceptance tests

1. Quality formula: a fixture table of 30 cases. Property: q ∈ 1..5 and is never NaN for corrupt inputs.
2. Sell cap: 3rd sale on the same day refused. Day rollover resets. A save/load in between keeps the count.
3. **Journal invariance:** enter Photo Mode, move the camera for 2 real minutes, capture 5 images, exit. The command
   journal and `serialize(world)` are identical before and after, except the speed change commands.
4. Determinism: a 2-day run with phone photos and group photos, versus save → load mid-run. Byte-identical.
5. Headless (no GL): `capturePhoto` returns null, the photo item still exists, and the gallery has no entry. The
   placeholder renders in the UI test.
6. Mirror pass correctness (Playwright, swiftshader): render a scene with an asymmetric marker. In the mirror view the
   marker appears horizontally flipped (pixel probe) and the backfaces are not visible (winding test).
7. PiP perf (desktop report, GTX 1660 or the owner's machine scaled): ≤ 1.2 ms per updated frame. Integrated GPU on
   Low: total frame ≤ 33 ms with the PiP open.
8. Under-15 profile: the caption free-text input is absent in the DOM, and only presets are offered.
9. Upcoming arrivals: a scheduled pizza at an ETA shows the exact tick; walk-bys never appear; a repo warning appears
   only at stage 4.

## References

- Convex traffic/safety mirrors are standard road furniture for seeing around blind driveways and junctions. The
  Lookout Mirror is a comic version of that real object.
- Mirroring by negating the projection's x axis (and flipping triangle winding) is the standard trick for mirror
  cameras in real-time engines; three.js exposes front-face winding via material `side` and renderer state.
- 1200×630 is the widely used social link-preview image size (Open Graph practice); the share card follows it.
- MONETIZATION §1 (COPPA/minor rules) is the reason captions are restricted for under-15.
