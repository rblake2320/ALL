"""Assemble every part of the zombie into skinned Blender objects under the 'Rig' armature."""
from __future__ import annotations

import bpy

from . import accessories, bottoms, clothing, face, hair, limbs, stitches
from .assemble import assign_weights, part_to_object
from .body import build_body
from .consts import ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, TOP_STYLES
from .materials import build_materials
from .meshkit import Part
from .skeleton import Skeleton, ensure_armature

SKIN_PART_PREFIXES = ('Head', 'Torso', 'ArmUpper', 'ArmLower', 'Hand', 'LegUpper', 'LegLower', 'Foot', 'Stump')


def all_parts(sk: Skeleton) -> list[Part]:
    parts: list[Part] = []
    head = face.build_head()
    face.head_shape_keys(head)
    head.weight_fn = face.head_weights
    head.no_build = True
    parts.append(head)
    for st in EYE_STYLES:
        e = face.build_eyes(st)
        face.eye_shape_keys(e, st)
        e.weight_fn = lambda co, tag: {'head': 1.0}
        parts.append(e)
    parts += build_body(sk)
    for st in HAIR_STYLES:
        if st == 'bald':
            continue
        parts.append(hair.build_hair(st))
    for st in TOP_STYLES:
        parts += clothing.build_top(sk, st)
    for st in BOTTOM_STYLES:
        parts += bottoms.build_bottom(sk, st)
    parts += [bottoms.build_shoe(sk, 'L'), bottoms.build_shoe(sk, 'R')]
    for acc in ACCESSORIES:
        if acc == 'none':
            continue
        parts.append(accessories.build_accessory(acc))
    parts += limbs.build_limb_parts(sk)
    parts.append(stitches.build_stitches(sk))
    return parts


def build_character(collection_name: str = 'Zombie') -> dict:
    """Create armature + all mesh objects. Returns dict(arm, objects{name: obj}, parts{name: Part}, sk, mats)."""
    sk = Skeleton()
    arm = ensure_armature(sk, 'Rig')
    mats = build_materials()
    parts = all_parts(sk)
    objects = {}
    pmap = {}
    for p in parts:
        assign_weights(p, p.weight_fn)
        extra = stitches.stitch_hide_keys(p) if p.name == 'Stitches' else None
        skin = p.name.startswith(SKIN_PART_PREFIXES)
        ob = part_to_object(p, mats, arm, sk, skin_part=skin, extra_keys=extra)
        objects[p.name] = ob
        pmap[p.name] = p
    return {'arm': arm, 'objects': objects, 'parts': pmap, 'sk': sk, 'mats': mats}


def tri_report(parts: dict) -> tuple[int, list[tuple[str, int]]]:
    rows = sorted(((n, p.tri_count) for n, p in parts.items()), key=lambda r: -r[1])
    return sum(r[1] for r in rows), rows
