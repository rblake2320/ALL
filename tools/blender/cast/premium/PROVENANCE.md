# Premium bodies — provenance record (W-152, D-084)

One row per body: how its source was made, with which tool and version, from which prompt and reference images.
Everything after the Tripo rig is our own code (`prep_source.py`, `build_premium.py`, `../lib`) in Blender 5.2.3.
Masters, concept images and every service output are kept off the repository in
`D:\projects\afterlife-asset-production\premium-zombies-20261111\<sourceId>\` (`concept/`, `tripo/`, `rig/`).
Recorded 2026-11-12 by Fable 5.2 ZSM from the session's own tool calls and the services' run records.

## Pipeline (all five)

| Step | Tool and version | Settings |
|---|---|---|
| 1. Concept views (front, side, back) | Meshy text-to-image, model `gpt-image-2-5-sunburst`, multi-view, A-pose (Meshy MCP, 2026-11-11) | prompt below; no reference images in; no real person, brand or franchise named |
| 2. Model | Tripo CLI 0.11.2, `multiview-to-model`, model `v3.1-20260211` (H3.1) | `texture_quality=detailed`, `pbr=true`, `geometry_quality=detailed`; input = the three concept views |
| 3. Rig | Tripo `animate_rig` on the step-2 model | `spec=mixamo`, `topology=biped`, `out_format=glb` (from each `rig/run.json`); renamed to the cast rig by `prep_source.py` |
| 4. Game files | our scripts, Blender 5.2.3 | `prep_source.py` (decimate, bake, rig names), `build_premium.py` (fit, high + low file, thumbnail) |
| 5. E10+ repaint (D-085, 2026-11-12, Opus 2 ZSM) | our scripts (kept with the masters), numpy / OpenCV / Pillow, Blender 5.2.3 | face and skin textures of three sources repainted in UV space; the three images of each cast source GLB replaced, mesh, rig and everything else byte-identical; old sources kept as `<sourceId>_rigged.pre-e10.glb`; then step 4's `build_premium.py --only sexton,fisherman,lowside` |

A bake-off for the first body also made a Meshy `multi-image-to-3d` model (`meshy-7.1`) and a Nano Banana Pro concept
(`nbp_*`); neither is used in any shipped file.

## Per body

| id (sourceId) | Prompt (step 1) | Reference views used (SHA-256, first 16) | Tripo model task | Tripo rig task |
|---|---|---|---|---|
| `sexton` (`undertaker`) | "Photorealistic full-body zombie character for a AAA game, head to toe in frame. A gaunt elderly undertaker, tall and thin, rotted black three-piece funeral suit with frayed lapels and a loose black tie, sunken grey-green skin, left cheek torn open showing teeth and jawbone, milky eyes, thin white hair, bony hands with fingers spread and empty, worn leather shoes. Neutral standing pose, arms away from the body. Flat even studio lighting, no shadows, plain light grey background, no props, no text." | `gpt_0` 67b42c1dc9ddb2a0, `gpt_1` 41e3ad4d863b443f, `gpt_2` 5f6b113682d161ca | aeffdca0-52ff-45a1-b01a-7684fb1d4a7f | afcb86be-37d3-4fe8-b973-185e5df77a48 |
| `lowside` (`biker`) | "Photorealistic full-body zombie character for a AAA game, head to toe in frame. A huge heavyset bearded biker, worn black leather vest over a torn grey t-shirt, tattooed forearms, weathered grey-green mottled skin, scraped and scarred right arm, matted grey beard, one clouded eye, ripped dirty jeans, heavy scuffed boots, thick hands with fingers spread and empty. Neutral standing pose, arms away from the body. Flat even studio lighting, no shadows, plain light grey background, no props, no text, no logos." (second prompt; the first, with exposed ribs, was refused by the provider's safety check) | `view_0` 72186939d982e082, `view_1` f7fecc78f7bbbe48, `view_2` 9fba249bbc84b12d | 5de872e0-8c6c-4fab-ba7b-4a3a8ba2e057 | 384808ca-0cf4-4ba1-9cc7-7492ebdf5d9d |
| `waitress` | "Photorealistic full-body zombie character for a AAA game, head to toe in frame. A 1950s diner waitress zombie, adult woman, stained pale teal knee-length uniform dress with a torn white apron and a name badge, a dirty bandage wrapped around her left forearm, grey-green skin with dark veins, sunken clouded eyes, dark hair falling out of a bun, laddered stockings, worn white work shoes, slender hands with fingers spread and empty. Neutral standing pose, arms away from the body. Flat even studio lighting, no shadows, plain light grey background, no props, no text." (second prompt; the first, with bite marks, failed) | `view_0` 2728bfa50908ff19, `view_1` ebc1cb0a5590928d, `view_2` c5bdb3cdb68b5667 | 0e1a2266-8786-4d0f-b403-54f05f46b488 | 23f6e922-0181-41cd-af2a-4c056fc53a65 |
| `patient` | "Photorealistic full-body zombie character for a AAA game, head to toe in frame. A thin young man, a hospital patient zombie in a stained pale blue knee-length hospital gown, shaved head wrapped in a loose dirty gauze bandage with a line of surgical staples above one ear, medical tape and a hospital wristband on one arm, grey-green bruised skin, hollow clouded eyes, bare dirty feet, bony hands with fingers spread and empty. Neutral standing pose, arms away from the body. Flat even studio lighting, no shadows, plain light grey background, no props, no text." (second prompt; the first, with an open craniotomy, was refused by the provider's safety check) | `view_0` 1dcc7a67671d7324, `view_1` 8ca65e14e7c86d9c, `view_2` cde9d1802f84cd6d | eb4219a1-850d-4092-8564-f5be5fdcbf09 | dacb68c0-926d-4e0a-84fa-533b3c5cccbd |
| `fisherman` | "Photorealistic full-body zombie character for a AAA game, head to toe in frame. A drowned fisherman, stocky middle-aged man, bloated waterlogged blue-grey skin, one empty eye socket, wet grey stubble, cracked yellow oilskin bib overalls over a soaked dark wool sweater, barnacles and strands of seaweed on the shoulders, black rubber boots, swollen hands with fingers spread and empty. Neutral standing pose, arms away from the body. Flat even studio lighting, no shadows, plain light grey background, no props, no text." | `view_0` 910287ad22bb0003, `view_1` 61373e9a4f5810c1, `view_2` a0a573ef20db712b | 3264b950-0cf4-4273-831f-fc8869b11db9 | de43b963-95a5-4c4e-bd43-f64e4a589b7d |

Which request made which views: `concept_receipts.json` (next to this file, and a copy beside the masters) binds each
body to its Meshy text-to-image task id, the Meshy image object downloaded to each local view file, and that file's
SHA-256. It was extracted from the originating session's own Meshy calls (request, response and download), so the
lineage is bound by task id and hash, not by file times. Meshy concept tasks: sexton `01a1ccdc-cf2f-746b-af33-ff767717d1e1`,
lowside `01a1cce5-5c22-7579-8633-2cbe63e27d2d`, waitress `01a1cce5-5f04-700b-9af0-245ea3f914ed`, patient
`01a1cce5-61c0-754f-9541-dfd84e7302f4`, fisherman `01a1cce3-b491-7589-a6b2-c15d04eacddd`. The first tasks of
lowside, waitress and patient did not succeed and produced no file. The prompt text above is the text sent in each
task's request as recorded in that session.

## Licence terms of the plans used: OPEN (owner + counsel)

Not recorded here because they have not been read against the plans on the accounts: the owner's Meshy plan and
the Tripo account (region `ov`) used for these tasks. Before any release, counsel records for each service: the plan,
commercial use of output, ownership/assignment of output, any attribution or disclosure duty, and training-use
terms. Until then these five bodies are not cleared for a public build (IP_NOTES §1, THIRD_PARTY_NOTICES §1).

## Step 5: E10+ repaint (D-085)

The rating decision (D-085, `docs/DECISIONS.md`) forbids exposed bone, teeth or jaw through torn flesh, empty or gouged eye sockets, exposed organs or brain and deep open wounds. Every source was checked against it with close-up renders of the face from three angles and upper-body views, then the textures edited at the source (the masters, the concept images and the old sources are not changed). Masks were made from the mesh (the UV triangles whose centroid lies in a region of the head or arm), so each edit follows the geometry.

| body (source) | what was wrong | what was done |
|---|---|---|
| `sexton` (`undertaker`) | both cheeks torn open: teeth and jaw showing | cheek and jaw wounds filled with the surrounding skin (inpaint from the forehead, chin and cheekbone, its fine detail laid over, colour matched to the skin around, a few faint healed scars), wound normals flattened to 15 %, ORM taken from the skin |
| `fisherman` (`fisherman`) | one empty eye socket (black) | the socket painted as a clouded eye like the other (milky, darker lid line, faint pupil smudge) from per-vertex distance to the eye centre; normals flattened, wet ORM |
| `lowside` (`biker`) | a raw bloody gash on the left forearm and a red laceration at the left temple | only the raw red tissue replaced with skin (selective), saturation lowered; the rest of the area keeps its texture |
| `waitress`, `patient` | nothing that fails | unchanged (Bed Nine's closed, stitched temple and the blood stains are mild and stay) |

SHA-256 of the three images inside each cast source GLB (JPEG bytes as stored), before and after, and of the GLBs:

| source | image | before | after |
|---|---|---|---|
| `undertaker` | base colour | `c3a624704268cfb564b28f1e33996b3e3d68b49da22650c16004e97e1c722915` | `26ce372d3a3200dc51c5f10a2190cd5568d5a97844a8c06708485a3ace22446f` |
| `undertaker` | normal | `28b5d73575a6d8c459a317773c93ec73b7b6915c2e56645a3da313518be08af9` | `c1b446ba6f7e48a177ce88ba5fd461230c22d30981879d371c1d55deea2f0e95` |
| `undertaker` | ORM | `034374e88c166631d4545b8510316cd1dacc5f63a0bd33c05f1bd2a6599536f2` | `270d40f4dd163cd4454728fa4df95c467cefc93e88e444679b94c576cb72fef7` |
| `undertaker` | source GLB | `454bcbff84d8c32b268e737b46d863bca229593ced0ca1bd1a08f44acc6bda3f` (`undertaker_rigged.pre-e10.glb`) | `f78e362b6fb942a7c83485a9ea00bfcde5618908279530421056213c3925ae77` (`undertaker_rigged.glb`, the `sourceSha256` in `manifest.premium.json`) |
| `fisherman` | base colour | `5937cbd22ad9bde78a31131c767557c033e769fafee27388f3ef95427530d285` | `616ee1d66f18145fc788b13ec71d28ae4c21208bdd9f4fca01e859a124776c7b` |
| `fisherman` | normal | `aab097e3f2bda62e0677c9c83551b21878e3df07c0ea9a5a4cf3fd7ce7c779f7` | `173b5ecd5c1d62d7e238143c7950dd7a8d74b9956742c999c537c5dae38e5788` |
| `fisherman` | ORM | `805ee6806a6d30e5cf92421e9b342aa3ff0911759d3a54f157f88c94a6077072` | `c180363a10ecdda1aeb8e69cde7bb2b274bbfb5f4cb64b64c264a3d06024dc0e` |
| `fisherman` | source GLB | `fb2fc6c34141cfc1a9165cdd020b55331754cf07bb862cfbf8d7bd7c7d6d8cdb` (`fisherman_rigged.pre-e10.glb`) | `872f573fa1157ceea9afaaa4a8a2dd961a6dd3ae9fd0ce555bcc3ad56f0f4d85` (`fisherman_rigged.glb`, the `sourceSha256` in `manifest.premium.json`) |
| `biker` | base colour | `5453d1dffe091679055d25f936ced351727f837d18ad9710f50b21068f082daa` | `13c9730e1e46b8540d94707b2e375b6cdb0f16da982f009b4abcbd80173ba0ea` |
| `biker` | normal | `1941d48f765016d30eaf3ff3e509e8088f05fe050dd05af6e464f7ce9cd8d140` | `37b2e8e91b570f70c14328cf2435e5c8b419f43ed8c04226576833263e806ab8` |
| `biker` | ORM | `c7b55675d3bf3e503d54830d72281caaf93c9880e00f50ca1ee33683487bd2b3` | `20401b35df451e62ae109f1f4a167f3fa5b59b55e681ea108adeb1acef959d89` |
| `biker` | source GLB | `f8eda42df3d16817200ac7d466dd8f4438401504c01dca41b13e5727e4e57028` (`biker_rigged.pre-e10.glb`) | `d5ac0ef19596576f603d8b4b40719be9f3fa40deaf46f4849435411e8265f4df` (`biker_rigged.glb`, the `sourceSha256` in `manifest.premium.json`) |

The geometry is unchanged: the jagged silhouette of the torn cheeks is still in the mesh (it now reads as scarred skin). Rebuilt with `blender -b --factory-startup --python-exit-code 1 --python tools/blender/cast/premium/build_premium.py -- --src <masters>\cast-src --only sexton,fisherman,lowside` (Blender 5.2.3); thumbnails regenerated by the same run.
