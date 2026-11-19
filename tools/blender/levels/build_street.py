"""Per-kit driver for the street and district art (W-025 slice S9, docs/DESIGN_WORLD_LEVELS.md).

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/levels/build_street.py --
            [--only id1,id2] [--out DIR] [--preview] [--no-ao]

Outputs
  public/assets/models/levels/street/<id>.glb
  public/assets/manifest.street.json   the level-kit entry shape with `tileFootprint`, `outline` and `frames` (D-043)

The driver is the shared one (build_l4.run): every validator warning fails the build; nothing is published unless
every model passes. Toolchain: Blender 5.1.2 on Windows, like the yard and Bayou kits.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> common, levels, manifest_meta

from levels import build_l4, street_specs  # noqa: E402
from levels import street_kit  # noqa: E402,F401  (registers builders)

if __name__ == '__main__':
    sys.exit(build_l4.run(street_specs.LEVEL_ID, street_specs, 'build_street.py'))
