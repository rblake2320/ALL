"""Per-kit driver for the yard building art (W-109, docs/systems/yard-building.md).

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/levels/build_yard.py --
            [--only id1,id2] [--out DIR] [--preview] [--no-ao]

Outputs
  public/assets/models/levels/yard/<id>.glb
  public/assets/manifest.yard.json     the level-kit entry shape with `tileFootprint`, `outline` and `frames` (D-043)

The driver is the Bayou kit's (build_l4.run): the level kit's build_one builds, bakes, exports and validates each
model; every validator warning fails the build; nothing is published unless every model passes.
Fences and gates are in the structures kit, not here.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> common, levels, manifest_meta

from levels import build_l4, yard_specs  # noqa: E402
from levels import yard_decor, yard_furniture, yard_garden, yard_structures  # noqa: E402,F401  (register builders)

if __name__ == '__main__':
    sys.exit(build_l4.run(yard_specs.LEVEL_ID, yard_specs, 'build_yard.py'))
