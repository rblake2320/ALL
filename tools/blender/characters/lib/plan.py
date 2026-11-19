"""Appearance -> visible mesh names (Python mirror of src/render/characters/plan.ts, used for previews)."""
from __future__ import annotations

from .bottoms import BOTTOM_COVERS
from .clothing import TOP_COVERS
from .consts import ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, TOP_STYLES

BEANIE_HIDES = {'afro', 'mohawk', 'bun'}


def visible_parts(app: dict, limbs: dict | None = None) -> set[str]:
    limbs = limbs or {'armL': 'ok', 'armR': 'ok', 'legL': 'ok', 'legR': 'ok'}
    hair = app.get('hairStyle') if app.get('hairStyle') in HAIR_STYLES else 'messy'
    top = app.get('topStyle') if app.get('topStyle') in TOP_STYLES else 'tee'
    bottom = app.get('bottomStyle') if app.get('bottomStyle') in BOTTOM_STYLES else 'pants'
    eyes = app.get('eyeStyle') if app.get('eyeStyle') in EYE_STYLES else 'droopy'
    acc = app.get('accessory') if app.get('accessory') in ACCESSORIES else 'none'
    vis = {'Head', 'Eyes_' + eyes}
    if hair != 'bald' and not (acc == 'beanie' and hair in BEANIE_HIDES):
        vis.add('Hair_' + hair)
    if acc != 'none':
        vis.add('Acc_' + acc)
    if app.get('stitches', True):
        vis.add('Stitches')
    tc = TOP_COVERS[top]
    bc = BOTTOM_COVERS[bottom]
    dress = top == 'dress'
    if not tc['torso']:
        vis.add('Torso')
    vis.add(f'Top_{top}_Body')
    if not dress:
        vis.add(f'Bottom_{bottom}_Waist')
    for s in ('L', 'R'):
        arm = limbs.get('arm' + s, 'ok')
        if arm != 'missing':
            vis.add(f'Top_{top}_Sleeve{s}')
        if arm == 'ok':
            if not tc['armUpper']:
                vis.add('ArmUpper_' + s)
            if not tc['armLower']:
                vis.add('ArmLower_' + s)
            vis.add('Hand_' + s)
        elif arm == 'missing':
            vis.add('Stump_Arm' + s)
        else:
            vis.add('Prosthetic_Arm' + s)
        leg = limbs.get('leg' + s, 'ok')
        if leg != 'missing' and not (dress and bottom == 'shorts'):
            vis.add(f'Bottom_{bottom}_Leg{s}')
        if leg == 'ok':
            if not bc['legUpper']:
                vis.add('LegUpper_' + s)
            if not bc['legLower']:
                vis.add('LegLower_' + s)
            vis.add('Shoe_' + s)
        elif leg == 'missing':
            vis.add('Stump_Leg' + s)
        else:
            vis.add('Prosthetic_Leg' + s)
    return vis
