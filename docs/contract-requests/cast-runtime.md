# Cast bodies — RUNTIME notes (src/render/characters/**)

Owner: runtime agent. What the three.js runtime reads from the cast assets and guarantees to the renderer / UI.
Asset owner (Blender agent): `docs/contract-requests/cast.md` is authoritative; anything there overrides the defaults
below, and the runtime adapts to it.

## What the runtime reads

- `public/assets/models/characters/cast/<id>.glb` (path overridable per body by the manifest `file`, relative,
  `[A-Za-z0-9_-/]+.glb`, no `..`). Requires one skinned mesh (named `Body` preferred) and `pelvis` + `head` bones;
  anything else missing is tolerated (no `prop_*` -> carry on `hand_*`; no `jaw` -> no talk flap).
- Clips: a clip baked into the GLB under an `ANIM_STATES` name is used as-is; every other state is retargeted from
  zombie.glb by bone name with the shared-clip rule (below). Tracks for bones the body lacks are dropped (no three.js
  "no target node" warnings).
- `public/assets/manifest.cast.json` (optional; a 404 logs once and uses defaults). Any of
  `{bodies:[{id,...}]}`, `{bodies:{id:{...}}}`, `[{id,...}]`. Per body, all optional:
  `file`, `height`, `eyeMaterial` (material name), `skinColor` ('#rrggbb' stump-cap tint; default = body material
  colour x average texture colour), `pelvisRest` [x,y,z], `pelvisScale`, `seatPelvisOffset` [x,y,z],
  `lyingOffset` [x,y,z]. Hostile / out-of-range values are ignored.
- `manifest.pelvisRule` (`zombiePelvisRest`, `sitClips`, `lyingY0`, `lyingSpan`) and per body `headTop`,
  `carryAnchors` (zombie.glb schema) — adopted from cast.md §2/§5/§8. Precedence for every per-body value:
  manifest -> the GLB's `Rig` extras (`pelvisRest`, `pelvisScale`, `seatPelvisOffset`, `lyingOffset`, `headTop`,
  optional `carryPose` / `carryAnchors`) -> measured / neutral defaults (zombie.glb anchors + carry pose), so a
  missing manifest still animates every body correctly.

## Shared-clip rule (same as tools/blender/cast/lib/retarget.py)

Rotations: `q' = castRest * zombieRest^-1 * q` (a no-op when the rests equal zombie.glb's, which the build
guarantees). Pelvis translation (rig-root space): sit* `p' = p + seatPelvisOffset`; others
`p' = Pc + (p - P0) * s + lyingOffset * clamp((0.25 - p.y) / 0.14, 0, 1)` with `P0` = zombie.glb pelvis rest,
`Pc` = `pelvisRest` (default: the cast GLB's pelvis rest), `s` = `pelvisScale` (default `Pc.y / P0.y`).

## Behaviour

- `appearance.body` cast id -> `CastRig`; missing / 'classic' / unknown -> the classic rig, unchanged. The handle
  keeps the same `root`: until the body's GLB is ready (lazy, on first use) the classic rig stands in and is swapped in
  place; a load failure keeps the classic rig and logs once per body (never retried). Switching bodies keeps the
  current body until the new one is ready (no classic flash between two cast bodies).
- Templates are ref-counted per body; up to 3 unreferenced bodies stay warm, older ones are disposed (geometry,
  textures, materials, skeleton). Per rig: cloned materials + one Skeleton, freed on dispose.
- Height: `castHeightScale(height)` = 0.94..1.06 around the sculpted height; sit* keeps the pelvis at SEAT_HEIGHT.
- Limbs: missing = forearm / shin bone scaled to 1e-3 (hand / foot follow) + a body-tinted stump cap at the elbow /
  knee; prosthetic = the same + a wooden peg that follows the bone's animation (leg peg reaches the floor). Clip
  substitution (limp / crawl / mirroring) as classic. Caps and pegs never cast shadows.
- Expression: posture layer (as classic) + subtle eye tint/glow on `eyeMaterial` (eyeColor is the base) — every
  published body has `eyeMaterial: null` (single atlas material), so on the shipped cast only the posture layer
  shows the mood. No face morphs, no jaw: talking nods the head slightly (4 deg) instead. Decay dulls the body colour slightly. Highlight rim on every cast material.
- Draw calls: 1 per material primitive of the body (+1 shadow); +1 per carried item; caps/pegs +1 each, no shadow.

## Requests to the asset owner

None open (cast.md §3 already ships ONE primitive / ONE material per body = 1 main + 1 shadow draw per zombie).
