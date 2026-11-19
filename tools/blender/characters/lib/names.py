"""Canonical mesh node names (mirrored by src/render/characters/names.ts)."""
from __future__ import annotations

from .consts import ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, TOP_STYLES

BODY = ['Head', 'Torso', 'ArmUpper_L', 'ArmLower_L', 'Hand_L', 'ArmUpper_R', 'ArmLower_R', 'Hand_R',
        'LegUpper_L', 'LegLower_L', 'Foot_L', 'LegUpper_R', 'LegLower_R', 'Foot_R', 'Shoe_L', 'Shoe_R', 'Stitches']
LIMB_PARTS = ['Stump_ArmL', 'Stump_ArmR', 'Stump_LegL', 'Stump_LegR',
              'Prosthetic_ArmL', 'Prosthetic_ArmR', 'Prosthetic_LegL', 'Prosthetic_LegR']


def required_nodes() -> list[str]:
    out = list(BODY) + list(LIMB_PARTS)
    out += ['Eyes_' + s for s in EYE_STYLES]
    out += ['Hair_' + s for s in HAIR_STYLES if s != 'bald']
    for s in TOP_STYLES:
        out += [f'Top_{s}_Body', f'Top_{s}_SleeveL', f'Top_{s}_SleeveR']
    for s in BOTTOM_STYLES:
        out += [f'Bottom_{s}_Waist', f'Bottom_{s}_LegL', f'Bottom_{s}_LegR']
    out += ['Acc_' + a for a in ACCESSORIES if a != 'none']
    return out
