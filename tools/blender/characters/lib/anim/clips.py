"""Imports every clip module and validates coverage against ANIM_STATES (the contract)."""
from __future__ import annotations

from ..consts import ANIM_STATES, ONE_SHOTS
from . import clips_chores, clips_move, clips_sit, clips_social  # noqa: F401  (registration side effects)
from .base import CLIPS


def all_clips() -> dict:
    missing = [s for s in ANIM_STATES if s not in CLIPS]
    extra = [s for s in CLIPS if s not in ANIM_STATES]
    if missing or extra:
        raise RuntimeError(f'clip coverage mismatch: missing={missing} extra={extra}')
    for name, c in CLIPS.items():
        if (name in ONE_SHOTS) == c['loop']:
            raise RuntimeError(f'clip {name}: loop flag disagrees with ONE_SHOTS')
    return {name: CLIPS[name] for name in ANIM_STATES}
