"""Per-kit exporter pin (tools/blender/toolchains.json).

A GLB's bytes depend on the Blender that wrote it: Blender 5.1.2 and 5.2.3 write different bytes for the same
geometry. A kit rebuilt in part with another Blender is therefore not reproducible. Each kit pins the glTF
`asset.generator` its files carry; a build driver calls `check()` before it publishes or verifies.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

PINS = Path(__file__).resolve().parents[1] / 'toolchains.json'


def pin(kit: str) -> Optional[dict]:
    """The pin of a kit folder (e.g. 'levels/graveyard'): {'generator', 'platform'}, or None when it has none."""
    return json.loads(PINS.read_text(encoding='utf-8'))['kits'].get(kit)


def pinned(kit: str) -> Optional[str]:
    """The generator string pinned for a kit folder, or None when the kit has no pin."""
    entry = pin(kit)
    return entry['generator'] if entry else None


def this_platform() -> str:
    return 'windows' if sys.platform.startswith('win') else 'macos' if sys.platform == 'darwin' else 'linux'


def canonical(kit: str, platform: Optional[str] = None) -> bool:
    """Is this the platform on which the kit rebuilds byte-identically?"""
    entry = pin(kit)
    return bool(entry) and entry['platform'] == (platform or this_platform())


def running() -> str:
    """The generator string the running Blender's glTF exporter writes."""
    import io_scene_gltf2  # bundled with Blender
    return 'Khronos glTF Blender I/O v' + '.'.join(str(n) for n in io_scene_gltf2.bl_info['version'])


def check(kit: str, have: Optional[str] = None) -> Optional[str]:
    """None when this Blender may build the kit, else the reason it may not."""
    want = pinned(kit)
    if want is None:
        return f'{kit}: no exporter pinned in {PINS.name}; add one before publishing'
    have = have if have is not None else running()
    if have != want:
        return (f'{kit} is pinned to "{want}" but this Blender writes "{have}". Use the pinned Blender '
                f'(see {PINS.name}), or rebuild the whole kit and change its pin.')
    return None


def require(kit: str, scratch: bool = False) -> None:
    """Stop the build (exit 2) when this Blender may not write the kit. A scratch build (--out) may use any Blender."""
    if scratch:
        return
    wrong = check(kit)
    if wrong:
        print(wrong, file=sys.stderr)
        raise SystemExit(2)
