"""Deterministic seeded jitter for "slightly crooked" geometry.

Python's ``hash()`` is salted per process, so seeds are derived with CRC32 of a string key. Every model gets its
own ``Jitter(model_id)``; sub-streams (``fork('legs')``) keep one part's randomness independent of how many random
numbers another part consumed, so tweaking one builder never reshuffles the rest of the model.
"""
from __future__ import annotations

import math
import random
import zlib
from typing import Sequence, TypeVar

T = TypeVar('T')


def seed_of(key: str) -> int:
    return zlib.crc32(key.encode('utf-8')) & 0xFFFFFFFF


class Jitter:
    def __init__(self, key: str):
        self.key = key
        self._r = random.Random(seed_of(key))

    def fork(self, sub: str) -> 'Jitter':
        return Jitter(f'{self.key}/{sub}')

    def uniform(self, a: float, b: float) -> float:
        return self._r.uniform(a, b)

    def sym(self, amount: float) -> float:
        """Uniform in [-amount, amount]."""
        return self._r.uniform(-amount, amount)

    def deg(self, max_deg: float) -> float:
        """Random signed angle (degrees) with magnitude in [max/3, max] so crookedness is always visible."""
        mag = self._r.uniform(max_deg / 3.0, max_deg)
        return mag if self._r.random() < 0.5 else -mag

    def rad(self, max_deg: float) -> float:
        return math.radians(self.deg(max_deg))

    def chance(self, p: float) -> bool:
        return self._r.random() < p

    def choice(self, seq: Sequence[T]) -> T:
        return seq[self._r.randrange(len(seq))]

    def int(self, a: int, b: int) -> int:
        return self._r.randint(a, b)

    def shuffle(self, seq: list) -> list:
        self._r.shuffle(seq)
        return seq

    def gauss(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        return self._r.gauss(mu, sigma)


def value_noise3(x: float, y: float, z: float, seed: int = 0) -> float:
    """Cheap deterministic smooth 3D value noise in [-1, 1] (for blobby displacement)."""

    def h(ix: int, iy: int, iz: int) -> float:
        n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        n &= 0xFFFFFFFF
        n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 32767.5 - 1.0

    x0, y0, z0 = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - x0, y - y0, z - z0
    sx, sy, sz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    acc = 0.0
    for dx in (0, 1):
        wx = sx if dx else 1 - sx
        for dy in (0, 1):
            wy = sy if dy else 1 - sy
            for dz in (0, 1):
                wz = sz if dz else 1 - sz
                acc += wx * wy * wz * h(x0 + dx, y0 + dy, z0 + dz)
    return acc
