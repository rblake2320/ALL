"""Build-time geometry checks (run before export; any problem fails the build).

hair_clearance: every face of a hair / cap shell (vertices tagged SHELL_TAG) must stay outside the analytic head
surface. The head mesh is a polyhedron whose vertices lie ON that surface, so a face outside the analytic surface
can never be poked through by the scalp - the bug this guards against is a sparse, low shell whose chords dip into
the head and let skin show through in patches.
"""
from __future__ import annotations

from mathutils import Vector

from .face import HC, HR, head_point
from .hair import SHELL_TAG

V = Vector
MIN_CLEARANCE = 0.001    # metres (well above depth-buffer resolution at the farthest game zoom)


def surface_radius(u: Vector) -> float:
    """Distance from the head centre to the analytic head surface along the unit direction u."""
    d = V((u.x / HR[0], u.y / HR[1], u.z / HR[2])).normalized()
    for _ in range(6):                       # refine: head_point(d) must point along u
        q = (head_point(d) - HC).normalized()
        d = (d + (u - q) * 1.5).normalized()
    return (head_point(d) - HC).length


def hair_clearance(parts: dict, min_clearance: float = MIN_CLEARANCE) -> tuple[list[str], dict]:
    problems: list[str] = []
    worst: dict[str, float] = {}
    for name, part in parts.items():
        if not (name.startswith('Hair_') or name == 'Acc_beanie'):
            continue
        lo = 1.0
        bad = 0
        for fc in part.faces:
            if any(part.tag[i] != SHELL_TAG for i in fc):
                continue
            c = sum((part.co[i] for i in fc), V((0.0, 0.0, 0.0))) / len(fc)
            rel = c - HC
            r = rel.length
            if r < 1e-6:
                continue
            clearance = r - surface_radius(rel / r)
            lo = min(lo, clearance)
            if clearance < min_clearance:
                bad += 1
        if lo < 1.0:
            worst[name] = round(lo * 1000.0, 2)
        if bad:
            problems.append(f'{name}: {bad} shell faces within {min_clearance * 1000:.1f} mm of the scalp '
                            f'(worst {lo * 1000:.1f} mm) - skin would poke through')
    return problems, worst
