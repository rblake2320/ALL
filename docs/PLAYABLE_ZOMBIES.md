# Playable zombie package

Package ID: `afterlife-starter-zombies-v1`. Target: Afterlife Lease's TypeScript / Three.js browser and Electron game.

This package adds six character presets to **Create-a-Zombie → Identity → Ready-to-play zombies**. Each applies a
cast body, three compatible traits, an aspiration and a voice pitch to the selected household member. It keeps
names, voice seed, lot, difficulty and the other members. Use the existing **Start the Afterlife** action to play.
Players can customize the result, add up to four household members, and use the existing interactions, jobs,
camera modes and saves. These are life-sim characters; this package adds no combat abilities or new controls.

## Included roster

These are new playable presets built from existing models, not six newly generated meshes. The full 25-body
cast remains available in the Body tab. Premium-body ownership rules are unchanged.

| Preset | Existing body | Personality | Life goal | Height at asset scale | Triangles | GLB bytes |
|---|---|---|---|---:|---:|---:|
| The New Arrival | `walker` | Cheerful, Bookworm, Neat Freak | Master Preserver | 1.72 m | 8,799 | 617,192 |
| The Fixer | `hardhat` | Ambitious, Neat Freak, Loner | Renaissance Corpse | 1.78 m | 8,798 | 642,832 |
| The Caretaker | `nurse` | Neat Freak, Bookworm, Cheerful | Master Preserver | 1.70 m | 8,799 | 598,756 |
| The Night Reader | `granny` | Bookworm, Night Owl, Loner | Renaissance Corpse | 1.58 m | 8,800 | 788,644 |
| The Go-Getter | `business` | Ambitious, Vain, Night Owl | Undead Tycoon | 1.76 m | 8,800 | 573,268 |
| The Party Starter | `clown` | Social Butterfly, Party Animal, Cheerful | Life of the Afterparty | 1.76 m | 8,799 | 657,756 |

The six existing GLBs total **3,878,448 bytes**. No models or textures are duplicated or newly downloaded by this
change. The picker uses the existing WebP thumbnails; the renderer loads bodies through the existing cast cache.
The shared animation source is `public/assets/models/characters/zombie.glb` (2,303,648 bytes, 45 clips).

## Package contents and provenance

| Component | Source of truth |
|---|---|
| Preset definitions and safe patch factory | `src/game/starterZombies.ts` |
| Picker and accessible selection controls | `src/ui/shell/screens/caz/CazStarterPicker.tsx` |
| Six models | `public/assets/models/characters/cast/{walker,hardhat,nurse,granny,business,clown}.glb` |
| Six portraits | `public/assets/ui/cast/<body-id>.webp` |
| File hashes, source hashes, bounds, bones, textures, anchors | `public/assets/manifest.cast.json` |
| Shared animation hashes and clip inventory | `public/assets/manifest.characters.json` |
| Build pipeline | `tools/blender/cast/build_cast.py` |
| Rights and attribution | `CREDITS.md` and `LICENSE` |

The cast source recorded in `src/shared/cast.ts` is the owner's `zombie-smash-2` repository at `9c79c4c`.
The existing cast models are **all rights reserved by the project owner**, distributed for this game and its
modification; they are not a general-purpose MIT asset library. New preset code and copy follow the project's
MIT license. No generator was called, no provider credits were spent, and no new third-party license was accepted.

## Art specification for additional bodies

Use original, comic undead suitable for the project's E10+ target. Clear silhouettes, readable faces and clothing,
wear and stitches; avoid graphic wounds. Match the existing cast in the actual game lighting.

| Requirement | Acceptance target |
|---|---|
| Format and axes | Self-contained GLB / glTF 2; Y up, +Z front, metres, feet at y=0 |
| Body mesh | Skinned `Body` mesh and `Body` material; existing cast bone names and rest orientations |
| Skeleton | 22 cast bones, including `prop_L` and `prop_R`; match the cast manifest, not a provider's auto-rig |
| Geometry | At most 9,000 triangles per body |
| File size | At most 900 KiB per cast GLB; full cast kit at most 20 MiB |
| Textures | Embedded PBR textures; no dimension above 1,024 px; validate material/color-space handling |
| Height | Set an explicit target per design; within 0.02 m; fit the game's door clearance |
| Animation | Retarget all 45 shared clips; do not ship only idle/walk and call the character playable |
| Furniture contact | Verify sit, read, eat, computer, TV, chess, sleeping and bath poses against actual furniture |
| Props and decay | Validate carry anchors, prop stowing, limb collapse and prosthetics |
| Portrait | WebP matching the body; face crop metadata; fallback if the thumbnail cannot load |
| Loading | Existing lazy-load/cache path; missing body falls back through the existing renderer behavior |
| Rights | Explicit permission for redistribution in this repository; source, prompt, job ID and hashes recorded |

The triangle, texture and size targets above are the existing cast policy in
`tests/unit/cast-assets/helpers.ts`. They are acceptance limits, not measured frame-rate guarantees.
Premium high/low LOD assets have a separate contract and are outside this starter package.

Candidate generation prompt, for a future approved provider job:

> Original comic undead household resident for Afterlife Lease, [role and distinctive clothing], readable face,
> gentle asymmetry, worn fabric and sewn repairs, family-friendly spooky humor, full body, neutral A-pose,
> separate fingers, feet flat, clear joints, no handheld props, clean silhouette, neutral studio lighting.

Negative prompt:

> Graphic gore, exposed organs, realistic wounds, franchise characters, copied designs, logos, text, extra limbs,
> fused hands, floating accessories, baked shadows, dramatic pose, environment geometry.

These prompts have **not been submitted**. A generated mesh still needs topology, rigging, retargeting, texture,
contact and runtime validation before admission. Paid generation requires a separately approved provider and
spend ceiling. Preserve source bytes and create normalized outputs separately.

## Validation and handoff

- `npx vitest run tests/unit/game/starterZombies.test.ts`: all six presets validate against real and fallback
  content; create deterministic worlds, step the simulation, and round-trip through actual save/load. Unknown
  and hostile IDs are rejected, and applying/editing one preset cannot mutate the definitions or another copy.
- `npm run e2e`: the production browser flow selects all six with real input, checks names and other members,
  starts a household containing the selected clown, tests gameplay and persistence, and captures desktop/phone views.
- `npm run verify:assets`: verifies existing manifest hashes and sizes. Thumbnail orphan warnings predate this
  change; they are not proof of missing files.
- `npm run typecheck`, `npm test`, `node scripts/verify-features.mjs --check`, `npm run build`: repository checks.

Save schema, simulation rules, input controls and default random generation are unchanged. Presets only enter
the simulation when the player applies one and creates a household. Existing saves are not rewritten.

The local `game-dev` CLI was unavailable in the implementation environment. This is a repository-native playable
preset package and asset-production plan, **not a canonical Game Development Studio package with validation
receipts**. No Blender normalization, provider generation, hardware-GPU performance certification or human art
approval is claimed. The pull request records actual test results and any remaining limitations.
