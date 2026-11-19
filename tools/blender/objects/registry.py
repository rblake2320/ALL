"""Builder registry: ``@builder('chair_creaky')`` registers ``fn(model, spec)`` for one or more model ids."""
from __future__ import annotations

from typing import Callable, Dict

from common.catalog import Spec
from common.model import Model

BuilderFn = Callable[[Model, Spec], None]
BUILDERS: Dict[str, BuilderFn] = {}


def builder(*ids: str) -> Callable[[BuilderFn], BuilderFn]:
    def deco(fn: BuilderFn) -> BuilderFn:
        for i in ids:
            if i in BUILDERS:
                raise KeyError(f'duplicate builder for {i}')
            BUILDERS[i] = fn
        return fn

    return deco
