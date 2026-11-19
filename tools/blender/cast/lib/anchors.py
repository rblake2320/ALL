"""Palm-fitted plate anchors, measured on the EXPORTED GLB (glTF joint frames, exactly what the runtime binds).

zombie.glb's plate anchor (sitEat / standEat, on hand_L) rests the plate on ITS palm. Scaling that translation by
the hand size gets close on a cast body, but cartoon hands differ in thickness / palm offset, so the scaled plate
still hovers 4-6 cm off the hand. Instead the plate frame keeps the classic rotation (level in the clip pose) and
its origin keeps the classic plate's relation to the palm:
  palm point = centre of the palm vertices (dominant joint = the hand, between 25 % and 75 % of the wrist ->
               fingertip reach, within 6 cm of the hand axis) in the plate plane, lifted to the palm's upper surface
               along the plate normal (+ half the plate thickness);
  origin     = palm point + (classic anchor - classic palm point), the in-plane part scaled by the hand size
               (the classic plate is held off-centre, toward the fingers).
On the classic body the rule returns zombie.glb's own anchor exactly (by construction).
"""
from __future__ import annotations

import numpy as np

from . import glb as G

PLATE_HALF = 0.006


def _joint_world(js, name):
    nodes = js['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    idx = next(i for i, n in enumerate(nodes) if n.get('name') == name)

    def local(i):
        n = nodes[i]
        T = np.eye(4)
        T[:3, :3] = G._quat_mat(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1]))
        T[:3, 3] = n.get('translation', [0, 0, 0])
        return T

    M = local(idx)
    i = idx
    while i in parent:
        i = parent[i]
        M = local(i) @ M
    return M


def palm_points(js, bin_, bone: str, mesh_names=None) -> np.ndarray:
    """Rest positions (rig space) of the vertices whose dominant joint is `bone`."""
    nodes = js['nodes']
    pts = []
    for n in nodes:
        if 'mesh' not in n or 'skin' not in n or (mesh_names and n.get('name') not in mesh_names):
            continue
        skin = js['skins'][n['skin']]
        jn = [nodes[j]['name'] for j in skin['joints']]
        if bone not in jn:
            continue
        bi = jn.index(bone)
        for p in js['meshes'][n['mesh']]['primitives']:
            pos = G.accessor(js, bin_, p['attributes']['POSITION']).astype(np.float64)
            J = G.accessor(js, bin_, p['attributes']['JOINTS_0']).astype(np.int64)
            W = G.accessor(js, bin_, p['attributes']['WEIGHTS_0']).astype(np.float64)
            dom = J[np.arange(len(J)), W.argmax(1)]
            pts.append(pos[dom == bi])
    return np.concatenate(pts) if pts else np.zeros((0, 3))


def palm_point(js, bin_, anchor: dict, mesh_names=None) -> np.ndarray | None:
    """Bone-local palm point under the plate (see module doc)."""
    bone = anchor['bone']
    A = np.array(anchor['matrix'], np.float64).reshape(4, 4).T          # bone-local anchor
    Bw = _joint_world(js, bone)                                          # bone -> rig (rest)
    pts = palm_points(js, bin_, bone, mesh_names)
    if len(pts) < 20:
        return None
    loc = (np.linalg.inv(Bw) @ np.c_[pts, np.ones(len(pts))].T).T[:, :3]  # bone-local
    ax = np.array([0.0, 1.0, 0.0])                                       # glTF joint axis along the bone
    proj = loc @ ax
    lat = np.linalg.norm(loc - np.outer(proj, ax), axis=1)
    near = (lat < 0.06) & (proj > -0.02)
    if near.sum() < 20:
        return None
    tip = np.percentile(proj[near], 95)
    palm = near & (proj > 0.25 * tip) & (proj < 0.75 * tip)
    if palm.sum() < 8:
        return None
    n = A[:3, 1] / np.linalg.norm(A[:3, 1])                              # plate normal (anchor +Y)
    P = loc[palm]
    c = P.mean(0)
    c = c - n * (c @ n)                                                  # in-plane centre
    up = float((P @ n).max())                                            # palm upper surface along the normal
    return c + n * (up + PLATE_HALF)


def classic_offsets(zombie_glb: str) -> dict:
    """{anchor name: (normal, classic anchor origin - classic palm point)} for zombie.glb's plate anchors."""
    import json
    js, bin_ = G.read_glb(zombie_glb)
    rig = next(n for n in js['nodes'] if n.get('name') == 'Rig')
    out = {}
    for k, e in json.loads(rig['extras']['carryAnchors']).items():
        if 'plate' in e.get('items', []) and e.get('bone', '').startswith('hand_'):
            p = palm_point(js, bin_, e, mesh_names={'Hand_L', 'Hand_R'})
            if p is not None:
                out[k] = np.array(e['matrix'][12:15], np.float64) - p
    return out


#: item -> half extents (m) of its footprint along the anchor's X and Z (src/render/characters/carry.ts)
GRIP_FOOT = {'phone': (0.027, 0.065)}


def _grip_surface(js, bin_, e: dict, mesh_names=None) -> float | None:
    """Height (m, along the anchor's +Y) of the highest hand vertex under the item's footprint, from the anchor
    origin. The hand is on the item's -Y side, so this is where the hand first meets the item's back."""
    foot = next((GRIP_FOOT[i] for i in e.get('items', []) if i in GRIP_FOOT), None)
    if foot is None or not e.get('bone', '').startswith('hand_'):
        return None
    pts = palm_points(js, bin_, e['bone'], mesh_names)
    if not len(pts):
        return None
    A = np.array(e['matrix'], np.float64).reshape(4, 4).T
    ax, n, az = (A[:3, i] / np.linalg.norm(A[:3, i]) for i in range(3))
    loc = (np.linalg.inv(_joint_world(js, e['bone'])) @ np.c_[pts, np.ones(len(pts))].T).T[:, :3]
    rel = loc - A[:3, 3]
    under = (np.abs(rel @ ax) < foot[0]) & (np.abs(rel @ az) < foot[1])
    return float((rel[under] @ n).max()) if under.any() else None


def classic_grips(zombie_glb: str) -> dict:
    """{anchor name: _grip_surface on the classic body} for zombie.glb's hand-held grip anchors (the phone)."""
    import json
    js, bin_ = G.read_glb(zombie_glb)
    rig = next(n for n in js['nodes'] if n.get('name') == 'Rig')
    out = {}
    for k, e in json.loads(rig['extras']['carryAnchors']).items():
        h = _grip_surface(js, bin_, e, mesh_names={'Hand_L', 'Hand_R'})
        if h is not None:
            out[k] = h
    return out


def fit_grip_anchors(path: str, carry: dict, classic: dict, log=None) -> dict:
    """carry with every hand-held grip anchor (the phone) moved along its own Y until this body's hand meets the
    item's back where the classic hand does. The scaled classic offset assumes a thick mitten: on a realistic
    hand the phone hovers 2-5 cm off the palm."""
    js, bin_ = G.read_glb(path)
    out = {}
    for k, e in carry.items():
        h = _grip_surface(js, bin_, e) if k in classic else None
        if h is None:
            out[k] = e
            continue
        A = np.array(e['matrix'], np.float64).reshape(4, 4).T
        n = A[:3, 1] / np.linalg.norm(A[:3, 1])
        o = A[:3, 3] + n * (h - classic[k])
        if log:
            log(f'    grip {k}: moved {(h - classic[k]) * 1000:+.1f} mm')
        m = list(e['matrix'])
        m[12], m[13], m[14] = (round(float(o[0]), 6), round(float(o[1]), 6), round(float(o[2]), 6))
        out[k] = dict(e, matrix=m)
    return out


PLATE_BOTTOM_R = 0.095  # m: radius of the plate's underside (src/render/characters/carry.ts, plate())
SETTLE_CLEAR = 0.001     # m: the settled plate's underside rests this far above the highest hand vertex below it


def settle_on_hand(js, bin_, bone: str, origin: np.ndarray, n: np.ndarray):
    """Move a plate origin along its normal until the underside rests on the hand: the highest vertex of `bone`
    inside the underside's disc ends SETTLE_CLEAR below it. A long hand with curled fingers leaves the scaled classic
    offset hovering over the fingertips (or cutting into them); this closes that. Returns (origin, moved m) or
    (origin, None) when no hand vertex lies under the disc."""
    pts = palm_points(js, bin_, bone)
    if not len(pts):
        return origin, None
    loc = (np.linalg.inv(_joint_world(js, bone)) @ np.c_[pts, np.ones(len(pts))].T).T[:, :3]
    rel = loc - origin
    h = rel @ n
    under = np.linalg.norm(rel - np.outer(h, n), axis=1) < PLATE_BOTTOM_R
    if not under.any():
        return origin, None
    move = float(h[under].max()) + SETTLE_CLEAR
    return origin + n * move, move


def fit_plate_anchors(path: str, carry: dict, classic: dict, hand_k: float, settle: bool = False, log=None,
                      shift: dict | None = None) -> dict:
    """carry (manifest carryAnchors of one body) with every plate anchor re-seated on this body's palm.
    shift ({anchor: (x, z)} m, premium bodies): move that anchor's plate in its own plane (anchor X / Z) first.
    settle (premium bodies): then rest the plate on the hand under it (settle_on_hand)."""
    js, bin_ = G.read_glb(path)
    out = {}
    for k, e in carry.items():
        p = palm_point(js, bin_, e) if k in classic else None
        if p is None:
            out[k] = e
            continue
        A = np.array(e['matrix'], np.float64).reshape(4, 4).T
        n = A[:3, 1] / np.linalg.norm(A[:3, 1])
        d = classic[k]
        dn = float(d @ n)
        o = p + (d - n * dn) * hand_k + n * dn
        if shift and k in shift:
            o = o + A[:3, 0] * shift[k][0] + A[:3, 2] * shift[k][1]
        if settle:
            o, moved = settle_on_hand(js, bin_, e['bone'], o, n)
            if log:
                log(f'    plate {k}: ' + ('no hand under the plate' if moved is None else f'settled {moved * 1000:+.1f} mm'))
        m = list(e['matrix'])
        m[12], m[13], m[14] = (round(float(o[0]), 6), round(float(o[1]), 6), round(float(o[2]), 6))
        out[k] = dict(e, matrix=m)
    return out
