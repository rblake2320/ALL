# Contract requests — ASSETS-OBJECTS

Owner: ASSETS-OBJECTS (`tools/blender/{common,objects}/**`, `public/assets/models/objects/**`,
`public/assets/manifest.objects.json`, `src/render/models/**`). Nothing here blocks anyone.

Status after the hardening pass (independent art-director / technical review):

## 1. Objects manifest file name — RESOLVED
`src/render/contracts.ts` documents `public/assets/manifest.objects.json`
(`{ version, objects: { id: { file, bytes, sha256, tris, bounds } } }`), which is exactly what the pipeline writes and
`createModelLibrary` reads. Bounds are THREE axes and exclude the hidden-by-default `broken` overlay.

## 2. `ObjectVisualState.lit` for decorative candles — RESOLVED (decision 14e)
`table_wake` (centre candle cluster) and `tv_seance` (console candles) keep `userData.alwaysOn = true` on their `flame`
nodes, as agreed.

## 3. Declare the `broken` dynamic part — RESOLVED
`broken` is now declared on every powered/plumbing spec; the asset tests assert the node exists on each of them.

## 4. Environment map for metals (RENDER) — RESOLVED (decision 14b)
Large steel surfaces stay at metallic ~0.6 so they degrade gracefully without one.

## 5. Sizes for ENV_MODELS — RESOLVED, local copies removed
`ENV_MODELS[].size { w, d, h }` is now the single source of truth. The hardening pass deleted both hand-copied tables:
`src/render/models/specs.ts` derives `ENV_DIMS` from the catalog, and `tools/blender/common/catalog.py` parses
`size` for the Blender validator/preview framing. Tests fail if a copied table reappears.

## 6. Notes for consumers (no change needed)
* `ModelLibrary.release(instance)` is now implemented: it unbinds the instance (later `update()` calls are no-ops,
  pending placeholder upgrades are cancelled). Geometry and materials are shared and library-owned (freed by
  `dispose()`), so RENDER's `objects.ts` correctly stops ref-counting geometries once `release` exists.
* Doors (`door_splintered`, `door_crypt`) also have a `door` pivot (hinge at local x = -DOOR_WIDTH/2). If RENDER
  passes `inUse: true` while an agent walks through, the leaf swings (by `userData.openAngle`, toward +Z).
* Neighbour-house windows use a material named `WindowGlass`, so RENDER's WindowGlow (matches "glass") drives them;
  the same meshes also sit in a `bulb` node for other consumers. The library never fights material swaps made by
  others: if a slot's material was replaced externally, `update()` leaves it alone.
* `create()` before `ready` returns a placeholder that is upgraded in place (same Object3D) once the GLB arrives.
* `has(id)` is true only when a real GLB prototype is loaded (placeholders do not count).
* Shadows: the library pre-sets `castShadow = false` on transparent and emissive meshes (glass, water, mist,
  flames, glows, screens) and `true` elsewhere (decision 14a).
* `coffin_chillrest` is now a half-couch casket: the lid stays closed over the foot half (top ≈ 0.7 m, underside
  ≈ 0.6 m), so a sleeping zombie's legs are tucked in under it; the head half is open above the lining at BED_HEIGHT.
* `lamp_skull`'s `bulb` node has two emissive materials: the shell glows softly (strength 0.9) and the eye/nose
  sockets burn hot (5.0), so lit lamps read as a face at night. Both are driven by the normal bulb on/off levels.

## 7. Finish pass (ASSETS-OBJECTS finisher) — FYI, nothing blocks anyone
* **Atomic publishing.** `build_all.py` now builds every requested GLB into a private staging dir
  (`tools/blender/out/objects/.stage-*`, same filesystem) and only when the WHOLE build succeeded (and, with
  `--strict`, validated cleanly) swaps changed files into `public/assets/models/objects/` with `os.replace`, then
  replaces `manifest.objects.json` last (each swap is atomic, so every file is always complete; the whole set lands
  within milliseconds). Unchanged files are not touched (no watcher churn); a failed build publishes nothing; a lock
  serialises concurrent builds. `--out DIR` writes a complete tree elsewhere (reproducibility checks).
* **Reproducible.** A from-scratch `build_all.py --out <tmp>` is byte-identical to the published GLBs + manifest
  (`diff -r` clean); `build_all.py --verify` checks bytes, manifest entries and (full builds) the manifest text.
* **Cleaner geometry.** The canonical GLB pass now drops degenerate and duplicated triangles produced by
  post-quantisation vertex merging (door_crypt, fridge_humming, item_meal, lantern_post lost 8–32 invisible tris).
* **Powered status lights are power-gated.** Small always-on LEDs that sat in the static body now live in a `glow`
  node, so they go dark when the object is unpowered: `tub_icebath`, `desk_hauntedpc` (power LED), `arcade_tombstone`
  (lit button + coin slots). These subtrees are never batched (decision #23), i.e. +1 draw call per instance.
  Only intentional always-on glows remain static: `stove_necrochef`'s radioactive goo, embers (`item_fire`,
  `item_ash`), decorative goo (`gym_limb`, `diffuser_formaldehyde`), stained glass, and the `alwaysOn` candles (#14e).
* **Redone models (names unchanged).** `item_meal` (cartoon brain loaf: `BrainDark` crust + `Brain` gyri + `LoafCut`
  caps in each of `serving_0..3`), `sconce_candle` (bigger gothic plate, still centred ~1.7 m, projects 0.29 m),
  `coffin_chillrest` (still half-couch; plum velvet bier skirt, rose spray on the closed lid, `glow` is now an LED
  ring around the foot-end fan porthole), `fridge_cryo` (compressor on top, copper coolant pipe, full-height LED strip
  + display inside `glow` on the door), `station_embalming` (mint pump cabinet, sheet, bucket; `glow`/`pump` kept),
  `env_bush` (smooth-shaded foliage). New material looks: `Verdigris`, `EnamelMint` (non-Paint, batchable).
* Decision #23 (batching invariants) holds: `dynamic.ts` only moves/shows/hides door/flag/pump/water/frost/serving_N
  nodes and speaker/broken kids, and swaps (never mutates) `Paint` slots to immutable cached variants.
