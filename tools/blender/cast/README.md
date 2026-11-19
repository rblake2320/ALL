# Cast bodies (tools/blender/cast)

Converts the 25 "advanced" zombie bodies of the owner's Zombie Smash 2 (`<sourceId>_rigged.glb`, read-only) into
runtime cast GLBs for Afterlife Lease, per the contract in `src/shared/cast.ts` and
`docs/contract-requests/cast.md`.

```
/home/user/.venvs/blender/bin/python tools/blender/cast/build_cast.py                 # all 25 -> public/assets
/home/user/.venvs/blender/bin/python tools/blender/cast/build_cast.py --only walker,boss   # rebuild some (others keep their entry)
/home/user/.venvs/blender/bin/python tools/blender/cast/build_cast.py --preview       # + Cycles sheets in tools/blender/out/cast
/home/user/.venvs/blender/bin/python tools/blender/cast/build_cast.py --out-dir /tmp/c  # reproducibility check, public/assets untouched
    --src DIR   source models (default /home/user/zombie-smash-2/assets/models)
```

Outputs: `public/assets/models/characters/cast/<id>.glb`, `public/assets/ui/cast/<id>.webp`,
`public/assets/manifest.cast.json`; `tools/blender/out/cast/report.json` (per-body fit / clip / limb data), and with
`--preview` `sheet_<id>.png` (idle walk sit sitEat sleep cook hug dance; top row 3/4 front, bottom row side, stand-in
chair at SEAT_HEIGHT and bed at BED_HEIGHT) + `contact_sheet.png` (all 25, catalogue order).

Publishing is atomic: everything is exported and verified in `tools/blender/out/cast/.cast-stage-*`, then renamed
over the live files (GLBs, thumbnails, manifest last). A failed check publishes nothing. GLBs and the manifest are
byte-identical across rebuilds (no clocks, no RNG; `cmp` two `--out-dir` builds); the WEBP thumbnails are Cycles
renders on one CPU thread (multi-threaded denoising is not repeatable) and are byte-identical too.

## Pipeline (lib/)

| step | module | what |
|---|---|---|
| reference | `zref.py` | imports `public/assets/models/characters/zombie.glb` (bone_heuristic BLENDER round-trips its bone frames exactly): rest rotations, edit rolls, clips, classic seat / lying extents |
| import | `body.load_source` | source armature + mesh + eye landmarks; front axis checked (toes → −Y Blender = glTF +Z) |
| skin QA | `body.head_dominance / auto_weights` | a source whose skin is unusable (bride: every vertex 100 % `head`) is re-skinned: voxel proxy → bone heat → nearest-face transfer → smooth / limit 4 / normalise |
| clean | `body.weld_and_clean`, `body.decimate` | weld split vertices (UV seams stay on loops), smooth normals, collapse-decimate to 8.8k tris |
| re-pose | `body.repose` | with THEIR weights, rotate every limb segment onto the classic rig's rest direction (arms at the zombie A-pose ± per-body abduction, straight legs, feet forward) and apply as the new rest shape |
| normalise | `body.normalize` | uniform scale to `CastBodyDef.height`, feet on 0, pelvis on x = z = 0 |
| rig | `body.build_armature` | OUR skeleton: each bone = zombie bone's direction + roll (identical rest rotation) at the fitted joint; `prop_L/R` = zombie palm offset × mesh-measured hand size (`body.hand_scale`); no `jaw` |
| weights | `body.remap_weights` | hips → pelvis; skirt bones → pelvis blending into the thigh of the vertex's side lower down; capes → pelvis; held-prop bones → nearer hand; limb-loss hygiene (no forearm/hand/shin/foot weight on torso-owned or skirt vertices); prune < 0.02, 4 influences |
| textures | `textures.py` | base colour 1024², ORM / normal 512² (box filter), material `Body`; `turned` bodies are zombified (below) |
| anchors | `measure.py` | carry anchors scaled by the MESH hand reach (`body.hand_scale`), not bone lengths; pose with the zombie clips through the runtime rule (`retarget.py`): move the pelvis origin until the seated hip mass matches the classic body (seat), lying offset (mattress plane + centring), clip feet report, limb collapse test, scaled carry anchors |
| plate anchors | `anchors.py` | after export: plate anchors re-seated on the body's own palm (classic palm offset × hand size), measured on the exported GLB |
| export | `glb.py` | GLB (no animations, JPEG), re-read + verified: bone set, rest rotations vs zombie.glb, tris, bytes, textures, height, feet |
| preview | `preview.py` | thumbnails + sheets (Cycles CPU, OIDN) |

### Zombify ('turned' category)
Rasterise the mesh into UV space (triangle id + barycentrics → 3D surface position per texel). Reference skin = robust
median HSV of the cheek texels (below / between the eye landmarks, front facing). Skin mask = texels within a hue /
saturation / value window of it, restricted to covered texels, despeckled, grown into the seam padding. Masked
texels → grey-green corpse tone keeping the painted shading, 3D-noise mottling + purple-grey bruises + faint veins,
darkened sunken eye sockets around the eye landmarks, red lips desaturated toward bruised purple. Clothes are never
touched outside the colour window (per-body tuning in `lib/profiles.py`).

### Per-body tuning
`lib/profiles.py`: arm abduction / forward swing (wide bodies keep hands outside the belly), skin window, texture
sizes / JPEG quality. The JPEG quality steps down automatically if a GLB exceeds 900 KB.

## Independent review (verify/)
`verify/verify_cast.py` does NOT import `lib/`: it reads the published GLBs with numpy, poses them with zombie.glb's
clips through the runtime rule exactly as written in `docs/contract-requests/cast.md` §2, measures contacts against
stand-ins built from the real object specs (chair_creaky seat, counter_butcher + frontStands slot, bed_normal lie
slot, 2.1 m door, hug partner 1 m away) and renders Cycles panels (door + classic, face, back, walk, sit, sitEat with
the manifest plate/fork, sleep, cook, hug pair). The classic body is measured / rendered the same way as reference.

```
/home/user/.venvs/blender/bin/python tools/blender/cast/verify/verify_cast.py --out /tmp/castreview [--only a,b] [--no-render]
/home/user/.venvs/blender/bin/python tools/blender/cast/verify/verify_cast.py --out /tmp/p --pose bride:pickup:0.375
python3 tools/blender/cast/verify/compose.py /tmp/castreview        # review_<id>.png sheets
```
