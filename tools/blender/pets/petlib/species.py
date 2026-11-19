"""Species specs. All lengths in metres. `H` = height of the leg-top joints, `L` = hip-to-shoulder distance.

Colours: `paint` is the lightest tone of the animal (belly, muzzle, socks) and the base colour of the recolourable
`Paint` material. `coat` is the per-vertex multiplier that turns it into the coat colour; markings darken the
coat further. Everything is a multiplier <= 1, so any colour set on `Paint` at runtime keeps coat and markings.
"""
from __future__ import annotations

CLIPS = ['idle', 'walk', 'run', 'sit', 'sleep', 'eat', 'play', 'beg', 'flee']

# name: (seconds, loop)
CLIP_TIMING = {
    'idle': (3.0, True), 'walk': (0.8, True), 'run': (0.5, True), 'sit': (3.0, True), 'sleep': (4.0, True),
    'eat': (1.0, True), 'play': (1.2, True), 'beg': (1.6, True), 'flee': (0.4, True),
}
FPS = 30

MATERIALS = {
    # name: (hex, roughness, emission strength or None)
    'Paint': (None, 0.85, None),          # colour comes from the species
    'Skin': ('#c98a8a', 0.7, None),       # inner ears, cat nose
    'Detail': ('#2b2a30', 0.6, None),     # noses, beak, claws, crow legs
    'Eye': ('#1d1726', 0.18, None),
    'Shine': ('#e8e0c8', 0.3, None),
    'EyeGlowA': ('#9fe870', 0.4, 3.0),    # toxic glow (undead, big eye)
    'EyeGlowB': ('#ffb35a', 0.4, 3.0),    # candle (undead, small eye)
    'Stitch': ('#2a2030', 0.9, None),
}
VARIANT_MATERIALS = {
    'normal': ['Paint', 'Skin', 'Detail', 'Eye', 'Shine'],
    'undead': ['Paint', 'Skin', 'Detail', 'EyeGlowA', 'EyeGlowB', 'Stitch'],
}
UNDEAD_TINT = (0.66, 0.86, 0.70)   # sickly green-grey multiplier over the whole coat
UNDEAD_PATCH = (0.74, 0.62, 0.95)  # mismatched lilac patch (sewn-on)

SPECIES = {
    'cat': dict(
        plan='quad', paint='#f3e6cf', coat=(0.90, 0.60, 0.33), H=0.165, L=0.205, body_w=0.076, body_h=0.080, belly=0.03, chest=0.03,
        leg_r=0.024, paw_r=0.029, stance=0.050, hind_thigh=1.45,
        neck_up=0.066, neck_fwd=0.040, neck_r=0.050,
        head=(0.084, 0.078, 0.072), snout_len=0.024, snout_r=0.034, snout_drop=0.018, nose='Skin',
        ear='point', ear_h=0.066, ear_w=0.050, ear_x=0.050,
        eye_r=0.0205, eye_x=0.044, eye_fwd=0.056, eye_up=0.008,
        tail_len=0.260, tail_r=0.019, tail_tip=0.013, tail_rise=0.62, tail_curl=0.55,
        mark='tabby', socks=True,
    ),
    'dog': dict(
        plan='quad', paint='#f0e2c8', coat=(0.74, 0.55, 0.36), H=0.290, L=0.300, body_w=0.092, body_h=0.104, belly=-0.02, chest=0.10,
        leg_r=0.034, paw_r=0.041, stance=0.064, hind_thigh=1.35,
        neck_up=0.105, neck_fwd=0.075, neck_r=0.058,
        head=(0.096, 0.100, 0.090), snout_len=0.066, snout_r=0.046, snout_drop=0.022, nose='Detail',
        ear='flop', ear_h=0.095, ear_w=0.050, ear_x=0.082,
        eye_r=0.0215, eye_x=0.050, eye_fwd=0.066, eye_up=0.022,
        tail_len=0.210, tail_r=0.020, tail_tip=0.010, tail_rise=0.80, tail_curl=0.35,
        mark='patch', socks=False,
    ),
    'raccoon': dict(
        plan='quad', paint='#e9e6de', coat=(0.56, 0.56, 0.55), H=0.150, L=0.220, body_w=0.096, body_h=0.094, belly=0.10, chest=-0.04,
        leg_r=0.024, paw_r=0.029, stance=0.056, hind_thigh=1.5,
        neck_up=0.050, neck_fwd=0.050, neck_r=0.052,
        head=(0.084, 0.078, 0.068), snout_len=0.044, snout_r=0.031, snout_drop=0.012, nose='Detail',
        ear='round', ear_h=0.040, ear_w=0.034, ear_x=0.056,
        eye_r=0.0180, eye_x=0.040, eye_fwd=0.056, eye_up=0.010,
        tail_len=0.290, tail_r=0.040, tail_tip=0.026, tail_rise=0.25, tail_curl=0.20,
        mark='mask', socks=False,
    ),
    'crow': dict(
        plan='bird', paint='#5c6176', coat=(0.74, 0.74, 0.80), H=0.074, body_len=0.165, body_w=0.050, body_h=0.054, body_pitch=18.0,
        leg_r=0.0050, stance=0.022, toe_len=0.030,
        head_r=0.036, neck_r=0.026, beak_len=0.050, beak_r=0.014,
        eye_r=0.0085, wing_len=0.150, wing_h=0.040, tail_len=0.085,
        mark='crow',
    ),
}


def hex_lin(h: str) -> tuple[float, float, float]:
    """sRGB hex -> linear RGB."""
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def torso_profile(sp: dict, u: float) -> float:
    """Radius multiplier of a quadruped torso along its length (u = 0 at the rump end, 1 at the chest end)."""
    import math
    k = 0.78 + 0.22 * math.sin(math.pi * min(1.0, max(0.0, u))) ** 0.6
    k += sp['chest'] * math.exp(-((u - 0.80) / 0.16) ** 2)
    k += sp['belly'] * math.exp(-((u - 0.42) / 0.22) ** 2)
    return k


def torso_span(sp: dict) -> tuple[float, float]:
    """(y of the rump end, y of the chest end) of the torso centre line in rest pose."""
    return sp['L'] / 2 + 0.80 * sp['body_w'], -sp['L'] / 2 - 0.55 * sp['body_w']
