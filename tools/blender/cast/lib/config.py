"""Paths, budgets and the cast list. The body list is parsed from src/shared/cast.ts (THE contract) so the build can
never drift from it; parsing failures are fatal (no embedded fallback: a wrong id would corrupt saves)."""
from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
CAST_DIR = os.path.dirname(HERE)
PROJECT_ROOT = os.path.abspath(os.path.join(CAST_DIR, '..', '..', '..'))
CHAR_TOOLS = os.path.join(PROJECT_ROOT, 'tools', 'blender', 'characters')
CAST_TS = os.path.join(PROJECT_ROOT, 'src', 'shared', 'cast.ts')
ASSETS_DIR = os.path.join(PROJECT_ROOT, 'public', 'assets')
ZOMBIE_GLB = os.path.join(ASSETS_DIR, 'models', 'characters', 'zombie.glb')
OUT_DIR = os.path.join(PROJECT_ROOT, 'tools', 'blender', 'out', 'cast')
DEFAULT_SRC = '/home/user/zombie-smash-2/assets/models'

GLB_DIR_REL = 'models/characters/cast'
MANIFEST_NAME = 'manifest.cast.json'
THUMB_DIR_REL = 'ui/cast'

# Budgets (task brief / ART_DIRECTION)
TRI_BUDGET = 9000
TRI_TARGET = 8800          # decimation target (a little headroom below the budget)
TEX_MAX = 1024
GLB_BYTES_BUDGET = 900 * 1024
TOTAL_BYTES_BUDGET = 20 * 1024 * 1024
HEIGHT_TOL = 0.02

MANIFEST_VERSION = 1
CAST_RIG_VERSION = 1

# Our bone set (zombie.glb names; jaw omitted on cast bodies - the runtime skips tracks with no target).
CAST_BONES = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head',
              'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'prop_L',
              'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R', 'prop_R',
              'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']

SIT_CLIPS = ('sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess')


def parse_cast_bodies() -> list[dict]:
    with open(CAST_TS, 'r', encoding='utf-8') as fh:
        src = fh.read()
    m = re.search(r'export const CAST_BODY_IDS\s*=\s*\[(.*?)\]\s*as const', src, re.S)
    if not m:
        raise SystemExit('cannot parse CAST_BODY_IDS from src/shared/cast.ts')
    ids = re.findall(r"'([^']+)'", m.group(1))
    bodies = []
    for row in re.finditer(r"\{\s*id:\s*'([^']+)',\s*sourceId:\s*'([^']+)',\s*name:\s*'([^']*)',\s*category:\s*'([^']+)',"
                           r"\s*height:\s*([0-9.]+)", src):
        bodies.append({'id': row.group(1), 'sourceId': row.group(2), 'name': row.group(3),
                       'category': row.group(4), 'height': float(row.group(5))})
    if [b['id'] for b in bodies] != ids or len(ids) != 25:
        raise SystemExit(f'CAST_BODIES rows ({[b["id"] for b in bodies]}) do not match CAST_BODY_IDS ({ids})')
    return bodies
