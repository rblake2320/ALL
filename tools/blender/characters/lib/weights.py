"""Skin-weight helpers. Every function maps a rest-pose vertex position to {bone: weight}."""
from __future__ import annotations

from typing import Callable

from mathutils import Vector

from .noise import smoothstep

V = Vector
WeightFn = Callable[[Vector, str], dict]


def rigid(bone: str) -> WeightFn:
    return lambda co, tag: {bone: 1.0}


def blend_along(a: str, b: str, joint: Vector, axis: Vector, width: float) -> WeightFn:
    """Blend from bone a to bone b across a joint plane (axis points from a towards b)."""
    axis = axis.normalized()

    def fn(co: Vector, tag: str) -> dict:
        t = smoothstep(-width, width, (co - joint).dot(axis))
        return {a: 1.0 - t, b: t}
    return fn


def chain(bones: list[str], joints: list[Vector], axes: list[Vector], widths: list[float]) -> WeightFn:
    """Piecewise blends along a chain (len(joints) == len(bones) - 1)."""
    def fn(co: Vector, tag: str) -> dict:
        w = {bones[0]: 1.0}
        for i, j in enumerate(joints):
            t = smoothstep(-widths[i], widths[i], (co - j).dot(axes[i].normalized()))
            if t <= 0.0:
                break
            prev = bones[i]
            carry = w.get(prev, 0.0)
            w[prev] = carry * (1.0 - t)
            w[bones[i + 1]] = w.get(bones[i + 1], 0.0) + carry * t
        return w
    return fn


def torso_weights(co: Vector, tag: str = '') -> dict:
    """Pelvis/spine/chest by height + shoulder caps."""
    z = co.z
    w = {}
    t1 = smoothstep(0.80, 0.90, z)
    t2 = smoothstep(0.97, 1.06, z)
    w['pelvis'] = 1.0 - t1
    w['spine'] = t1 * (1.0 - t2)
    w['chest'] = t1 * t2
    sh = smoothstep(0.10, 0.165, abs(co.x)) * smoothstep(1.03, 1.12, z)
    if sh > 0:
        side = 'shoulder_L' if co.x > 0 else 'shoulder_R'
        for k in list(w.keys()):
            w[k] *= (1.0 - sh * 0.85)
        w[side] = sh * 0.85
    return w


def hip_to_thigh(side: str, co: Vector, z_top: float = 0.70, z_bot: float = 0.60) -> float:
    return smoothstep(z_top, z_bot, co.z)


def normalize(w: dict, max_inf: int = 4) -> dict:
    items = sorted(((b, v) for b, v in w.items() if v > 1e-4), key=lambda kv: -kv[1])[:max_inf]
    tot = sum(v for _, v in items) or 1.0
    return {b: v / tot for b, v in items}
