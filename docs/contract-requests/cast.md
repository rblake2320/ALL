# Contract notes — CAST BODY ASSETS (tools/blender/cast)

Owner: cast-asset agent (`tools/blender/cast/**`, `public/assets/models/characters/cast/**`,
`public/assets/manifest.cast.json`, `public/assets/ui/cast/**`, `tests/unit/cast-assets/**`).
Readers: **runtime agent** (`src/render/characters/**`) and **UI agent** (`src/ui/**`). Source of truth for the body
list: `src/shared/cast.ts`.

## 1. Decision: clips are SHARED from zombie.glb (cast GLBs carry no animations)

Baking 45 clips into each body would cost ≈1.1 MB per GLB (zombie.glb's animation data) — over the 900 KB per-body
budget on its own and ≈28 MB for the cast. Instead every cast skeleton is built with **exactly the rest orientations
of zombie.glb** (same bone names, same local rest rotations; only the joint positions / bone lengths differ), so the
classic clips bind by bone name. The build verifies the rotations (< 0.001°) on the exported GLB and
`tests/unit/cast-assets` re-checks them against the published zombie.glb on every run.

`manifest.cast.json` → `animationsShared: true`, `clipSource: "models/characters/zombie.glb"`, `clipSourceSha256`
(the zombie.glb the bodies were fitted to — if zombie.glb is rebuilt, re-run `build_cast.py`; the tests fail on a
mismatch).

## 2. Runtime rule (RENDER: please implement exactly this)

For a cast body, take each `AnimationClip` of zombie.glb and make a per-body copy:

1. **Keep every `<bone>.quaternion` track unchanged.**
2. **Drop every `.position` and `.scale` track except `pelvis.position`** (zombie.glb keys translation/scale on all
   bones, but only `pelvis.position` actually varies; keeping the others would impose the classic bone lengths on the
   cast body). Drop tracks whose bone the body lacks (cast bodies have **no `jaw`**).
3. **Remap `pelvis.position`** per keyframe value `p` (rig-root space, metres; constants in `manifest.pelvisRule`,
   per-body values in `bodies[i]`):

   ```ts
   const P0 = manifest.pelvisRule.zombiePelvisRest;          // [0, 0.66, 0]
   if (manifest.pelvisRule.sitClips.includes(clip.name)) {     // sit, sitEat, sitTalk, sitTV, sitComputer, sitRead, sitChess
     p' = p + body.seatPelvisOffset;                          // absolute: seat contact stays at DIM.SEAT_HEIGHT
   } else {
     const w = clamp((pelvisRule.lyingY0 - p.y) / pelvisRule.lyingSpan, 0, 1);   // 0.25, 0.14 -> 1 only for lying keys
     p' = body.pelvisRest + (p - P0) * body.pelvisScale + body.lyingOffset * w;
   }
   ```

   `pelvisScale` = cast hip-joint height / zombie hip-joint height (feet stay planted while walking / crouching /
   kneeling); `lyingOffset` puts thick or long bodies' BACK (torso, not capes / skirts / hats / veils / ponytails, which may press
   into the mattress or pillow by up to 25 cm) on the mattress plane (y = 0 before the renderer's
   BED_HEIGHT / SLAB_HEIGHT lift) centred like the classic body; `seatPelvisOffset` = `[0, y, z]`: y is a ≤ 3 cm
   residual (the build already moves each body's pelvis origin so the seated hip mass rests exactly where the
   classic body's does, `pelvisRule.seatContactY` = 0.402), z ∈ [0, 0.15] slides short-thighed (big-headed) bodies
   forward on the seat so their knees clear the seat front like the classic knees do.
4. **sit\* only, thighs**: when `body.sitThighLift > 0` (degrees; 0 for most bodies, 3–9 for long-legged ones),
   pre-multiply every `thigh_L.quaternion` / `thigh_R.quaternion` keyframe by a rotation of `-sitThighLift` about
   the X axis of the parent (pelvis) frame: `q' = qx(-lift) · q` (`new THREE.Quaternion().setFromAxisAngle(X,
   -lift).multiply(q)`). The knees lift slightly so long shins do not push the feet through the floor.

   A reference implementation of 3. and 4. (with CPU skinning of every body) is in
   `tests/unit/cast-assets/retarget.test.ts` (`remapPelvis`, `liftThigh`).
5. Loop flags / durations / one-shots: unchanged (read them from `manifest.characters.json` as for the classic rig).
6. **Carry anchors**: the zombie `carryAnchors` are bone-relative; the cast manifest repeats them per body
   (`bodies[i].carryAnchors`, same schema) with the translation scaled to that body's hand (hand-bone anchors) or arm
   length (chest anchors). The hand scale is the MESH wrist -> fingertip reach vs the classic hand (0.95-1.67x; the
   source hand bones run to the fingertips, so a bone-length ratio over-scaled every palm anchor ~3x until the cast
   review). The plate anchors (`sitEat`, `standEat`) are additionally re-seated on the body's own palm surface with the
   classic plate's offset from the palm; `tests/unit/cast-assets/retarget.test.ts` poses every body and checks the
   plate / phone anchors land at the holding hand. Use those for cast bodies. `prop_L` / `prop_R` exist on every cast skeleton (palm frame
   identical to zombie.glb's, offset scaled by the mesh-measured hand size) so the default palm carry works as is.
7. **Limb loss**: collapse `forearm_*` / `shin_*` to scale ≈ 0 exactly as for the classic rig and show the stump cap at
   the elbow / knee joint. The build strips forearm/hand and shin/foot weights from every vertex owned by the torso or
   another limb (and from skirts), so the collapse never tears the body; per-body result in
   `bodies[i].limbCollapse` (all 25 bodies × 4 limbs = `clean`, see `tools/blender/out/cast/report.json`).
8. **Appearance fields**: `height` → ±6 % scale around the GLB (already normalised to `CastBodyDef.height`);
   `eyeColor` → **not supported**: every body has `eyeMaterial: null` (single baked atlas material named `Body`).
   **UI agent: please add all 25 ids to `NO_EYE_MATERIAL` in `src/ui/common/castArt.ts`** (or read
   `eyeMaterial` from the manifest).
9. `headTop` (manifest) = rest skull/headwear top = `height`; follow the posed `head` bone for bubbles as for the
   classic rig (the head bone sits lower on big-headed bodies — use `headTop - head joint rest y` as the offset).

## 3. Asset format

- `public/assets/models/characters/cast/<id>.glb`: glTF Y-up metres, front +Z, feet on y = 0, standing height =
  `CastBodyDef.height` (±2 cm, tested), pelvis on x = z = 0. Nodes: armature `Rig` (extras: `castBody`,
  `castRigVersion`, `pelvisRest`, `pelvisScale`, `seatPelvisOffset`, `lyingOffset`, `headTop`) → bones
  (`root pelvis spine chest neck head shoulder_L upperarm_L forearm_L hand_L prop_L …_R thigh_L shin_L foot_L …_R`)
  and ONE skinned mesh `Body` with ONE material `Body` (MeshStandardMaterial: base colour JPEG 1024², metallic-
  roughness (+ occlusion when the source has real AO) JPEG 512², normal map JPEG 512² where the source has one;
  opaque, no alpha). ≤ 9,000 triangles (8.8k), ≤ 900 KB (≈ 500–720 KB), whole folder ≈ 15 MB.
- `public/assets/ui/cast/<id>.webp`: 256×256, transparent background, head-based bust framing (skull = half the
  frame, eyes 30 % from the top, lower for tall headwear: cone, top hat, veil), same Cycles light rig for every body.
  **UI agent:** `bodies[i].thumbFace = {fx, fy, size}` is the exact face crop for `castArt.ts` (`fx` 0.5, `fy`
  0.35–0.5, `size` ≈ 124–133) — please use it (or copy it into `CROP_OVERRIDES`) instead of `DEFAULT_CROP`.
- `public/assets/manifest.cast.json`: `{version, rigVersion, animationsShared, clipSource, clipSourceSha256, bones,
  pelvisRule, totalBytes, bodies:[{id, file, bytes, sha256, sourceSha256, triangles, height, headTop, pelvisRest,
  pelvisScale, seatPelvisOffset, lyingOffset, sitThighLift, eyeMaterial, bones, materials, textures, limbCollapse,
  carryAnchors, seatProbe, thumbFace}]}` (`seatProbe` = rest positions of the hip-mass vertices used by the tests).
  Bodies are in `CAST_BODY_IDS` order. Published atomically (GLBs, thumbnails, manifest last).

## 4. Known per-body caveats (art)

- Held props are part of the sculpt and stay rigid on the hand (shield lid, strongman dumbbells, fortune teller's
  crystal ball, phones, tourist camera strap): they follow every clip, so e.g. the strongman eats with a dumbbell in
  his hand. A carried runtime item is added on top.
- Bodies with long dresses / capes (bride, granny, fortune, boss) carry the skirt with the thighs when sitting; some
  thigh poke-through on the front hem in `sit*` remains. The Big Lug's cape is rigid on the pelvis: it passes through
  the chair back / floor when seated and, when lying, through the mattress (the lift rests his back on the mattress;
  it used to rest the cape there, floating him 0.44 m above the bed).
- bride: the source skin was unusable (every vertex 100 % `head`), so the build re-skins it with bone heat — expect
  softer elbows / knees than the other bodies.
- Short-legged bodies (mascot, nurse, gamer) sit with their feet dangling above the floor (up to ~15 cm).
- Big-headed cartoon proportions: the classic clips' hand-to-face motions (sitEat fork, phone, yawn) land at the
  cheek / jaw rather than the mouth on bodies whose head is much larger than the classic one (phone 5-35 cm from the
  ear on boss / strongman / mascot / ringmaster / fortune).
- Short cartoon arms: in `cook` (and other counter clips) most bodies' hands reach only 0.6-0.8 m, i.e. they work at
  the counter's front face rather than on the 0.92 m top; big bellies (sneezer, cone, gold, granny, ringmaster, boss)
  also press 7-18 cm into a counter whose front is 0.30 m ahead of the stand slot. **Runtime (optional):** a two-bone
  arm IK toward the classic hand targets, or standing cast bodies a few cm further back at counters, would fix it.
- Big feet: during `walk` the toe / heel of large shoes dips up to ~5 cm under the floor at heel-strike / toe-off
  (classic: < 1 cm). Foot IK at runtime would hide it.
- Big heads roll into the pillow by up to ~4 cm during `sleep` (lying lift fitted on the first frame).
