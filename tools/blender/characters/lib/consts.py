"""Shared constants. Style and animation lists are parsed from src/shared/appearance.ts so the
asset can never drift from the contract; embedded copies are only a fallback (with a warning)."""
from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
APPEARANCE_TS = os.path.join(PROJECT_ROOT, 'src', 'shared', 'appearance.ts')
DIMENSIONS_TS = os.path.join(PROJECT_ROOT, 'src', 'shared', 'dimensions.ts')

_FALLBACK = {
    'SKIN_TONES': ['#9fb88a', '#8fa7a0', '#b7b59a', '#a3c2a8', '#8f9fbf', '#b4a1b0', '#c2b38f', '#7f8f76',
                   '#d0c6b6', '#9a8a7a'],
    'HAIR_STYLES': ['bald', 'buzz', 'messy', 'bob', 'bun', 'mohawk', 'long', 'combover', 'pigtails', 'afro'],
    'TOP_STYLES': ['tee', 'hoodie', 'suit', 'blouse', 'dress', 'tatters', 'cardigan'],
    'BOTTOM_STYLES': ['pants', 'shorts', 'skirt'],
    'EYE_STYLES': ['droopy', 'wide', 'mismatched', 'sleepy', 'beady'],
    'ACCESSORIES': ['none', 'glasses', 'bowtie', 'necklace', 'beanie', 'bandage', 'flower', 'eyepatch'],
    'ANIM_STATES': ['idle', 'walk', 'limp', 'crawl', 'sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead',
                    'sitChess', 'standEat', 'sleep', 'talk', 'listen', 'laugh', 'cry', 'angry', 'flirt', 'kiss', 'hug',
                    'wave', 'cheer', 'dance', 'cook', 'clean', 'washHands', 'shower', 'bath', 'exercise', 'paint',
                    'embalm', 'beEmbalmed', 'stitch', 'read', 'phone', 'admire', 'pickup', 'groan', 'stretch',
                    'collapse', 'feral', 'mourn', 'yawn', 'disgusted'],
    'EXPRESSIONS': ['neutral', 'happy', 'sad', 'angry', 'sleepy', 'disgusted', 'flirty', 'shocked', 'focused'],
}


def _parse_const_list(src: str, name: str) -> list[str] | None:
    m = re.search(r'export\s+const\s+' + name + r'\s*=\s*\[(.*?)\]\s*as\s+const', src, re.S)
    if not m:
        return None
    body = re.sub(r'//[^\n]*', '', m.group(1))
    return re.findall(r"'([^']*)'", body)


def _load() -> dict[str, list[str]]:
    out = dict(_FALLBACK)
    try:
        with open(APPEARANCE_TS, 'r', encoding='utf-8') as fh:
            src = fh.read()
        for key in list(out.keys()):
            vals = _parse_const_list(src, key)
            if vals:
                out[key] = vals
            else:
                print(f'[consts] WARNING: could not parse {key} from appearance.ts, using fallback', file=sys.stderr)
    except OSError as exc:
        print(f'[consts] WARNING: {exc}; using embedded fallback lists', file=sys.stderr)
    return out


def _parse_dim() -> dict[str, float]:
    dims = {'SEAT_HEIGHT': 0.46, 'TABLE_HEIGHT': 0.76, 'COUNTER_HEIGHT': 0.92, 'BED_HEIGHT': 0.42,
            'SLAB_HEIGHT': 0.86, 'TUB_RIM': 0.6, 'CHARACTER_HEIGHT': 1.62, 'HEAD_TOP': 1.78,
            'COFFEE_TABLE_HEIGHT': 0.42}
    try:
        with open(DIMENSIONS_TS, 'r', encoding='utf-8') as fh:
            src = fh.read()
        for key in list(dims.keys()):
            m = re.search(r'\b' + key + r'\s*:\s*([0-9.]+)', src)
            if m:
                dims[key] = float(m.group(1))
    except OSError:
        pass
    return dims


_L = _load()
SKIN_TONES: list[str] = _L['SKIN_TONES']
HAIR_STYLES: list[str] = _L['HAIR_STYLES']
TOP_STYLES: list[str] = _L['TOP_STYLES']
BOTTOM_STYLES: list[str] = _L['BOTTOM_STYLES']
EYE_STYLES: list[str] = _L['EYE_STYLES']
ACCESSORIES: list[str] = _L['ACCESSORIES']
ANIM_STATES: list[str] = _L['ANIM_STATES']
EXPRESSIONS: list[str] = _L['EXPRESSIONS']
DIM = _parse_dim()

FPS = 30
ONE_SHOTS = {'pickup', 'collapse', 'yawn'}

# Expression morphs on Head (and lids on every Eyes_* mesh) — order is stable in the GLB.
FACE_MORPHS = ['blink', 'talk', 'happy', 'sad', 'angry', 'sleepy', 'disgusted', 'flirty', 'shocked', 'focused']
BUILD_MORPH = 'build'
BUILD_GAIN = 0.15  # build morph at influence 1 = +15% width
STITCH_HIDE_MORPHS = ['hide_armL', 'hide_armR', 'hide_legL', 'hide_legR']

BONES = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'jaw',
         'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L',
         'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
         'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'prop_R', 'prop_L']

MATERIALS = ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes', 'EyeWhite', 'Iris', 'Mouth', 'Teeth', 'Stitch',
             'Prosthetic', 'Accessory']


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str) -> tuple[float, float, float]:
    """sRGB hex -> sRGB floats."""
    h = h.lstrip('#')
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def hex_lin(h: str) -> tuple[float, float, float]:
    r, g, b = hex_rgb(h)
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


# Default material base colours (sRGB hex). Runtime recolours Skin/Hair/Top/Bottom/Shoes/Iris.
MATERIAL_COLORS = {
    'Skin': SKIN_TONES[0],
    'Hair': '#3b2f2f',
    'Top': '#6b4f8a',
    'Bottom': '#3a3f55',
    'Shoes': '#2a2420',
    'EyeWhite': '#e6e1c6',
    'Iris': '#f2e86d',
    'Mouth': '#3b1f27',
    'Teeth': '#e0d4ae',
    'Stitch': '#2a2230',
    'Prosthetic': '#8a5a36',
    'Accessory': '#f4efe2',
}
MATERIAL_ROUGHNESS = {
    'Skin': 0.66, 'Hair': 0.82, 'Top': 0.86, 'Bottom': 0.86, 'Shoes': 0.6, 'EyeWhite': 0.38, 'Iris': 0.32,
    'Mouth': 0.9, 'Teeth': 0.5, 'Stitch': 0.85, 'Prosthetic': 0.72, 'Accessory': 0.62,
}
