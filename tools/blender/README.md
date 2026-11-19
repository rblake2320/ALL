# Blender art tools

Every model under `public/assets/models/` is built from the Python in this folder by a headless Blender:

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/<kit>/<build script>.py -- [args]

## Toolchain: one Blender and one platform per kit

A GLB's bytes depend on what wrote it:

- **Blender version.** 5.1.2 and 5.2.3 write different bytes for the same geometry.
- **Operating system.** The same Blender writes different last float bits on Linux and on Windows. On the
  graveyard kit, 66 of 68 models came out byte-identical on both; `arch_ironGate` differed by 12 bytes (7e-9 m in
  one position) and `circle_seance` by 249 bytes.

So "a second build is byte-identical" is a promise per kit and per platform, and `tools/blender/toolchains.json`
records both for every folder under `public/assets/models/`:

    "levels/graveyard": { "generator": "Khronos glTF Blender I/O v5.2.41", "platform": "windows" }

- `generator` is the glTF `asset.generator` every GLB in the folder carries. `toolchains.json` also names the
  Blender release and the official download checksums for each exporter.
- `platform` is where a rebuild is byte-identical.
- `tests/unit/art-manifests/toolchain.test.ts` reads every published GLB and fails when one differs from its
  folder's generator, or when a folder has no pin.
- `tools/blender/levels/build_levels.py` refuses to publish or `--verify` with another exporter (exit 2). A
  scratch build with `--out` may use any Blender.
- `--verify` on the kit's platform compares bytes. On another platform it compares content
  (`tools/blender/common/glb_semantic.py`: nodes, transforms, extras, materials, vertex and triangle counts, every
  coordinate, bounds, surface area) and prints `cross-platform: semantic match N/N`. It never claims byte-identity
  there.

| Exporter | Blender | Platform | Kits |
|---|---|---|---|
| `v5.2.41` | 5.2.3 LTS | windows | levels/graveyard |
| `v5.2.41` | 5.2.3 LTS | linux | characters, characters/cast, objects, levels/rotrow, levels/mausoleum |
| `v5.1.20` | 5.1.2 | windows | structures, vehicles, pets, wildlife, creatures, levels/bayou, levels/yard, homes |

Moving a kit to another Blender or platform is a deliberate full rebuild of that kit plus a change to its entry.
Do not rebuild part of a kit anywhere else.

## Every build script refuses the wrong Blender

Each driver calls `toolchain.require(<kit>)` right after it reads its arguments and stops with exit code 2 when
the running Blender's exporter is not the kit's pin: `build_levels.py`, `build_l4.py` (Bayou, and the yard and
street kits that run on it), `build_rotrow.py`, `build_structures.py`, `objects/build_all.py`, `build_homes.py`,
`build_cast.py`, `build_zombie.py`, `build_creatures.py`, `build_pets.py`, `build_vehicles.py`,
`build_wildlife.py`. A scratch build (`--out` / `--out-dir`) is exempt, except with `--verify`.
`tests/unit/art-manifests/toolchain.test.ts` fails if a `build_*.py` driver under `tools/blender/` lacks the call.

## Not done yet

- Only `build_levels.py` compares content when `--verify` runs off the kit's platform. The other drivers with a
  `--verify` (`build_rotrow.py`, `objects/build_all.py`) still compare bytes there.
- The `linux` entries are what the published files and the lead's record say; nobody has run a byte `--verify`
  of those kits on Linux since the pin was added.
