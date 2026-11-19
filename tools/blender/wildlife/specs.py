"""Wildlife specs for docs/systems/wildlife.md (W-076): songbird, pigeon, squirrel, bat, frog.

Each animal reuses a pet body plan (tools/blender/pets/petlib): its proportions are given at the pet's
reference size and the finished rig + mesh are scaled uniformly by `scale`. `detail` scales segment counts
for the two levels of detail (budgets: LOD0 <= 1,500 triangles, LOD1 <= 500).

`paints` are the colour variants: the model is one mesh, and a variant is a base colour for the recolourable
`Paint` material (coat and markings are vertex-colour multipliers on top, as for the pets).
"""
from __future__ import annotations

FPS = 30
BUDGET = (1500, 500)

_BIRD = dict(plan='bird', leg_r=0.0045, stance=0.022, toe_len=0.026)

WILDLIFE = {
    'songbird': dict(
        _BIRD, H=0.074, body_len=0.150, body_w=0.056, body_h=0.058, body_pitch=24.0,
        head_r=0.040, neck_r=0.030, beak_len=0.026, beak_r=0.010, eye_r=0.009, wing_len=0.135, wing_h=0.040,
        tail_len=0.075, mark='songbird', breast=0.9, coat=(0.52, 0.47, 0.46),
        paints={'robin': '#f0a070', 'bluebird': '#a9c8f0'}, scale=0.42, detail=(0.74, 0.30),
        ground=['perch-idle', 'hop', 'peck'],
    ),
    'pigeon': dict(
        _BIRD, H=0.070, body_len=0.175, body_w=0.064, body_h=0.066, body_pitch=14.0,
        head_r=0.033, neck_r=0.028, beak_len=0.024, beak_r=0.009, eye_r=0.007, wing_len=0.155, wing_h=0.046,
        tail_len=0.080, mark='pigeon', breast=0.55, coat=(0.60, 0.63, 0.70),
        paints={'grey': '#d3d8e2'}, scale=0.85, detail=(0.72, 0.30),
        ground=['walk', 'peck'],
    ),
    'bat': dict(
        plan='bird', leg_r=0.004, stance=0.016, toe_len=0.014, H=0.050, body_len=0.110, body_w=0.036,
        body_h=0.038, body_pitch=10.0, head_r=0.034, neck_r=0.024, beak_len=0.010, beak_r=0.010, eye_r=0.006,
        wing_len=0.200, wing_h=0.085, tail_len=0.030, ears=0.045, mark='bat', breast=0.35, coat=(0.50, 0.44, 0.52),
        paints={'dusk': '#9a8fa0'}, scale=0.70, detail=(0.70, 0.24),
        ground=[],
    ),
    'squirrel': dict(
        plan='quad', H=0.150, L=0.190, body_w=0.066, body_h=0.070, belly=0.05, chest=0.0,
        leg_r=0.020, paw_r=0.024, stance=0.044, hind_thigh=1.6,
        neck_up=0.055, neck_fwd=0.036, neck_r=0.044,
        head=(0.066, 0.070, 0.060), snout_len=0.030, snout_r=0.028, snout_drop=0.012, nose='Detail',
        ear='round', ear_h=0.034, ear_w=0.026, ear_x=0.040,
        eye_r=0.017, eye_x=0.036, eye_fwd=0.046, eye_up=0.012,
        tail_len=0.340, tail_r=0.056, tail_tip=0.040, tail_rise=1.15, tail_curl=0.10, bushy=True,
        mark='squirrel', socks=False, coat=(0.72, 0.42, 0.24),
        paints={'red': '#f1e6d6'}, scale=0.42, detail=(0.70, 0.25),
        ground=['run', 'freeze', 'idle-tail', 'chitter'],
    ),
    'frog': dict(
        plan='quad', H=0.085, L=0.110, body_w=0.075, body_h=0.060, belly=0.08, chest=-0.05,
        leg_r=0.017, paw_r=0.026, stance=0.070, hind_thigh=1.7,
        neck_up=0.012, neck_fwd=0.030, neck_r=0.055,
        head=(0.070, 0.060, 0.045), snout_len=0.012, snout_r=0.040, snout_drop=0.004, nose='Paint',
        ear='round', ear_h=0.010, ear_w=0.010, ear_x=0.030, no_ears=True,
        eye_r=0.022, eye_x=0.040, eye_fwd=0.020, eye_up=0.040,
        tail_len=0.030, tail_r=0.010, tail_tip=0.005, tail_rise=0.2, tail_curl=0.1, no_tail=True,
        mark='frog', socks=False, coat=(0.45, 0.72, 0.36),
        paints={'bayou': '#dfe8b8'}, scale=0.50, detail=(0.85, 0.34),
        ground=['hop', 'idle'],
    ),
}

# clip name: (seconds, loop) per animal, straight from the "Clips" column of docs/systems/wildlife.md
CLIPS = {
    'songbird': {'fly': (0.4, True), 'glide': (1.5, True), 'land': (0.6, False), 'perch-idle': (3.0, True),
                 'hop': (0.5, True), 'peck': (0.8, True), 'takeoff': (0.5, False)},
    'pigeon': {'walk': (0.6, True), 'peck': (0.8, True), 'takeoff': (0.5, False), 'fly': (0.4, True)},
    'squirrel': {'run': (0.4, True), 'freeze': (2.0, True), 'climb': (0.4, True), 'idle-tail': (2.5, True),
                 'chitter': (1.0, True)},
    'bat': {'fly': (0.3, True), 'flap-hover': (0.3, True)},
    'frog': {'hop': (0.7, True), 'idle': (3.0, True)},
}
