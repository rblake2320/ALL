"""Yard decor builders (W-109 add-on for W-025 start-lot variety): a tree stump, a fallen-branch pile, a small rock
cluster. Cheap one-tile pieces the start generator can scatter. Conventions are the level kit's."""
from __future__ import annotations

import math

from common import shapes as S
from common.model import Model

from .kit import add, builder
from .spec import LevelSpec


@builder('stump_rotten')
def stump_rotten(m: Model, spec: LevelSpec) -> None:
    """What is left of a tree: a low, splintered stump with spreading roots and a shelf fungus."""
    add(m, S.lathe([(0.0, 0.0), (0.30, 0.0), (0.24, 0.10), (0.20, 0.26), (0.19, 0.36), (0.0, 0.34)], 9), 'Bark')
    add(m, S.cylinder(0.17, 0.012, 9, 0.0, base=(0, 0, 0.345)), 'BarkLight')                # the cut face
    for k in range(5):                                                                   # roots
        a = math.tau * k / 5 + 0.3
        add(m, S.tube([(math.cos(a) * 0.20, math.sin(a) * 0.20, 0.10), (math.cos(a) * 0.34, math.sin(a) * 0.34, 0.04),
                       (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.0)], 0.05, 5, radii=[0.06, 0.045, 0.02]), 'Bark')
    for k, a in enumerate((0.9, 1.5, 2.3)):                                              # splinters on the broken side
        add(m, S.cone(0.035, 0.10 + 0.04 * k, 4, base=(math.cos(a) * 0.14, math.sin(a) * 0.14, 0.33)), 'BarkLight')
    add(m, S.sphere(0.07, 7, 3, loc=(0.0, -0.22, 0.20), scale=(1.3, 0.7, 0.25)), 'ByMushroom')   # shelf fungus
    add(m, S.sphere(0.05, 7, 3, loc=(0.07, -0.21, 0.12), scale=(1.3, 0.7, 0.25)), 'ByMushroom')
    add(m, S.blob(0.09, 1, 0.3, 3.0, seed=3, loc=(-0.20, 0.18, 0.05), scale=(1.4, 1.0, 0.4)), 'Moss')


@builder('branches_fallen')
def branches_fallen(m: Model, spec: LevelSpec) -> None:
    """A pile of fallen branches: five crossed sticks and a scatter of dead leaves."""
    sticks = (((-0.40, -0.18, 0.04), (0.38, 0.10, 0.09), 0.035), ((-0.30, 0.26, 0.04), (0.34, -0.22, 0.14), 0.030),
              ((-0.10, -0.38, 0.03), (0.06, 0.36, 0.17), 0.028), ((0.20, -0.34, 0.03), (-0.34, 0.06, 0.20), 0.024),
              ((0.36, 0.30, 0.03), (-0.20, -0.10, 0.24), 0.020))
    for k, (a, b, r) in enumerate(sticks):
        mid = ((a[0] + b[0]) / 2 + 0.03 * (k % 2), (a[1] + b[1]) / 2 - 0.03 * (k % 3), (a[2] + b[2]) / 2 + 0.02)
        add(m, S.tube([a, mid, b], r, 5, radii=[r, r * 0.85, r * 0.5]), 'Bark' if k % 2 else 'BarkLight')
        add(m, S.tube([mid, (mid[0] + 0.10, mid[1] + 0.06 * (1 if k % 2 else -1), mid[2] + 0.08)], r * 0.5, 4), 'Bark')   # a twig
    for k in range(6):                                                                   # dead leaves
        a = 1.1 * k + 0.4
        add(m, S.cylinder(0.045, 0.006, 5, 0.0, base=(0.30 * math.cos(a), 0.30 * math.sin(a), 0.0)), 'GrassDry')


@builder('rocks_small')
def rocks_small(m: Model, spec: LevelSpec) -> None:
    """A small cluster of field stones: one big, three small, with moss on the shaded side."""
    rocks = ((0.0, 0.04, 0.24, 1), (0.27, -0.16, 0.13, 2), (-0.25, -0.18, 0.11, 3), (-0.14, 0.27, 0.09, 4))
    for k, (x, y, r, seed) in enumerate(rocks):
        add(m, S.blob(r, 2 if k == 0 else 1, 0.24, 2.4, seed=20 + seed, loc=(x, y, r * 0.42), scale=(1.2, 1.0, 0.72),
                      flat_bottom=-0.6), 'GyStone' if k % 2 == 0 else 'GyStoneDark')
    add(m, S.blob(0.10, 1, 0.3, 3.0, seed=31, loc=(-0.08, 0.14, 0.21), scale=(1.5, 1.2, 0.35)), 'Moss')
