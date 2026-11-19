"""Print a level's spec table as JSON (system python3; used by tests/unit/levels-assets):
    python3 tools/blender/levels/specs_json.py [graveyard]
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from levels import l2_specs  # noqa: E402

LEVELS = {'graveyard': l2_specs}

if __name__ == '__main__':
    lv = sys.argv[1] if len(sys.argv) > 1 else 'graveyard'
    mod = LEVELS[lv]
    print(json.dumps({'level': lv, 'aliases': getattr(mod, 'ALIASES', {}),
                      'specs': [asdict(s) for s in mod.specs().values()]}, indent=1))
