"""Per-body tuning (art direction). Keys:
  arm_abduction   deg: arms swing out from the zombie A-pose (wide torsos / bellies keep their hands outside the body)
  arm_forward     deg: arms swing forward
  leg_abduction   deg: legs apart (wide hips)
  keep_pose       limb bones NOT re-posed (kept as sculpted)
  skin_*          zombify tuning for the 'turned' category (see textures.zombify)
  jpeg            JPEG quality override, normal_size / orm_size texture sizes
"""
from __future__ import annotations

DEFAULT = {'arm_abduction': 4.0, 'arm_forward': 0.0, 'leg_abduction': 0.0, 'jpeg': 85, 'base_size': 1024,
           'normal_size': 512, 'orm_size': 512}

PROFILES: dict[str, dict] = {
    # W-120 step 2b (decided): the staff is cut off above the fist (the part below stays with the hand and cape)
    'boss': {'arm_abduction': 14.0, 'fused_prop': 'L'},
    'strongman': {'arm_abduction': 16.0},
    'ringmaster': {'arm_abduction': 6.0, 'fused_prop': 'L'},      # the cane, above the fist
    'fortune': {'arm_abduction': 12.0},
    'mascot': {'arm_abduction': 16.0},
    'granny': {'arm_abduction': 6.0},
    'bride': {'arm_abduction': 6.0},
    # turned: straw hat / khaki shorts sit right next to the skin hue
    # (the khaki shorts share the skin hue AND saturation in their shadows: excluded spatially above the hem only, so
    #  the bare thighs below the hem turn with the shins instead of staying pink)
    'tourist': {'skin_hue_max': 0.062, 'skin_exclude': [
        {'bones': ['head'], 'above_eyes': 0.6}, {'bones': ['head'], 'wide': 1.5},
        {'bones': ['pelvis', 'thigh_L', 'thigh_R'], 'z_above': 0.36},
        {'bones': ['head'], 'behind': 0.6, 'behind_xmax': 3.0}]},
    # 'behind' (back-of-head hair) must not reach the cheeks: on these big heads the cheeks wrap 0.25-0.5 eye spacings
    # behind the eye plane, and a shallow rule left a pink cheek patch next to the ear (limit it in depth, or to above
    # the eye line with rel_above where the hair colour itself is outside the skin window)
    'business': {'skin_grow_hue': 0.012, 'skin_exclude': [{'bones': ['head'], 'above_eyes': 1.0},
                                                          {'bones': ['head'], 'behind': 0.25, 'rel_above': 0.0}]},
    'gamer': {'skin_exclude': [{'bones': ['head'], 'above_eyes': 1.0}, {'bones': ['head'], 'behind': 0.6},
                               {'bones': ['head'], 'behind': 0.25, 'behind_xmax': 3.0, 'rel_above': 0.0}]},
    # brown shoes sit inside the skin window; no bare foot skin is visible on this body
    'civilian': {'skin_exclude': [{'bones': ['foot_L', 'foot_R']}]},
    'streamer': {'skin_exclude': [{'bones': ['head'], 'above_eyes': 1.0}, {'bones': ['head'], 'behind': 0.25}]},
}


def get(body_id: str) -> dict:
    p = dict(DEFAULT)
    p.update(PROFILES.get(body_id, {}))
    return p
