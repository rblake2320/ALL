"""Read the physical catalog (``src/shared/catalog.ts``) without a TypeScript toolchain.

The Blender pipeline needs footprints, heights, placement kinds, declared dynamic parts and colour variants to
build and validate models. Instead of duplicating the table we parse the TS source: each object literal in the
``PHYSICAL_SPECS`` array is isolated by brace matching (string-aware), then the top-level fields we need are read
with small regexes. ``DIM.X`` references in heights are resolved from ``dims.py``.

Pure Python (no bpy) so it can also run under a system interpreter:
    python3 tools/blender/common/catalog.py --json
"""
from __future__ import annotations

import json
import math
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:  # package import (Blender pipeline) or direct script execution
    from . import dims as _dims
except ImportError:  # pragma: no cover - script mode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import dims as _dims  # type: ignore

ROOT = Path(__file__).resolve().parents[3]
CATALOG_TS = ROOT / 'src' / 'shared' / 'catalog.ts'


@dataclass
class Spec:
    id: str
    category: str
    placement: str
    w: int
    d: int
    height: float
    dynamic_parts: List[str] = field(default_factory=list)
    variants: List[str] = field(default_factory=list)
    needs_power: bool = False
    tags: List[str] = field(default_factory=list)
    model_notes: str = ''
    light_height: Optional[float] = None
    env: bool = False
    #: ENV_MODELS only: approximate (w along X, d along Z, h) in metres from the catalog's ``size`` field
    size: Optional[Tuple[float, float, float]] = None


def _skip_string(src: str, i: int) -> int:
    """``src[i]`` is a quote; return the index just past the closing quote."""
    q = src[i]
    i += 1
    while i < len(src):
        c = src[i]
        if c == '\\':
            i += 2
            continue
        if c == q:
            return i + 1
        i += 1
    raise ValueError('unterminated string literal')


def _skip_comment(src: str, i: int) -> int:
    if src.startswith('//', i):
        j = src.find('\n', i)
        return len(src) if j < 0 else j + 1
    if src.startswith('/*', i):
        j = src.find('*/', i + 2)
        if j < 0:
            raise ValueError('unterminated comment')
        return j + 2
    return i


def top_level_objects(array_src: str) -> List[str]:
    """Split the text of an array literal (without the outer brackets) into its top-level ``{...}`` items."""
    items: List[str] = []
    depth = 0
    start = -1
    i = 0
    while i < len(array_src):
        c = array_src[i]
        if c in '\'"`':
            i = _skip_string(array_src, i)
            continue
        if c == '/' and array_src.startswith(('//', '/*'), i):
            i = _skip_comment(array_src, i)
            continue
        if c in '{[(':
            if depth == 0 and c == '{':
                start = i
            depth += 1
        elif c in '}])':
            depth -= 1
            if depth == 0 and c == '}' and start >= 0:
                items.append(array_src[start:i + 1])
                start = -1
        i += 1
    return items


def _array_body(src: str, marker: str) -> str:
    k = src.find(marker)
    if k < 0:
        raise ValueError(f'marker not found: {marker}')
    open_i = src.find('[', k + len(marker) - 1)
    depth = 0
    i = open_i
    while i < len(src):
        c = src[i]
        if c in '\'"`':
            i = _skip_string(src, i)
            continue
        if c == '/' and src.startswith(('//', '/*'), i):
            i = _skip_comment(src, i)
            continue
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                return src[open_i + 1:i]
        i += 1
    raise ValueError('unterminated array')


def _strip_nested(obj_src: str) -> str:
    """Blank out nested object/array literals (depth >= 2) so top-level field regexes cannot match inside slots."""
    out = []
    depth = 0
    i = 0
    while i < len(obj_src):
        c = obj_src[i]
        if c in '\'"`':
            j = _skip_string(obj_src, i)
            out.append(obj_src[i:j] if depth <= 1 else ' ' * (j - i))
            i = j
            continue
        if c in '{[(':
            depth += 1
            out.append(c if depth <= 2 else ' ')
        elif c in '}])':
            out.append(c if depth <= 2 else ' ')
            depth -= 1
        else:
            out.append(c if depth <= 1 else ' ')
        i += 1
    return ''.join(out)


_NUM_EXPR = re.compile(r'^[0-9.+\-*/() ]+$')


def eval_number(expr: str, consts: Dict[str, List[str]] | None = None) -> float:
    e = expr.strip()
    e = re.sub(r'DIM\.([A-Z_]+)', lambda m: repr(_dims.DIM[m.group(1)]), e)
    if not _NUM_EXPR.match(e):
        raise ValueError(f'cannot evaluate numeric expression {expr!r}')
    return float(eval(e, {'__builtins__': {}}, {}))  # noqa: S307 - whitelisted arithmetic only


def _string_list(src: str) -> List[str]:
    return re.findall(r"'((?:[^'\\]|\\.)*)'", src)


def _const_lists(src: str) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for m in re.finditer(r'^const ([A-Z_]+) = \[([^\]]*)\];', src, re.M):
        out[m.group(1)] = _string_list(m.group(2))
    return out


def _field(top: str, name: str) -> Optional[str]:
    m = re.search(r'(?:^|[\s{,])' + name + r'\s*:\s*', top)
    if not m:
        return None
    i = m.end()
    depth = 0
    j = i
    while j < len(top):
        c = top[j]
        if c in '\'"`':
            j = _skip_string(top, j)
            continue
        if c in '{[(':
            depth += 1
        elif c in '}])':
            if depth == 0:
                break
            depth -= 1
        elif c == ',' and depth == 0:
            break
        j += 1
    return top[i:j].strip()


def parse_specs(src: Optional[str] = None) -> List[Spec]:
    if src is None:
        src = CATALOG_TS.read_text(encoding='utf-8')
    consts = _const_lists(src)
    body = _array_body(src, 'export const PHYSICAL_SPECS: PhysicalSpec[] = [')
    specs: List[Spec] = []
    for obj in top_level_objects(body):
        full = obj
        top = _strip_nested(obj)

        def req(name: str) -> str:
            v = _field(top, name)
            if v is None:
                raise ValueError(f'spec without {name}: {full[:80]}')
            return v

        sid = _string_list(req('id'))[0]
        fp_src = _field(full, 'footprint') or ''
        fm = re.search(r'w:\s*(\d+)\s*,\s*d:\s*(\d+)', fp_src)
        if not fm:
            raise ValueError(f'{sid}: bad footprint')
        dyn = _field(full, 'dynamicParts')
        var = _field(full, 'variants')
        variants: List[str] = []
        if var:
            variants = consts.get(var.strip(), []) if re.match(r'^[A-Z_]+$', var.strip()) else _string_list(var)
        light = _field(full, 'light')
        light_h = None
        if light:
            lm = re.search(r'height:\s*([0-9.]+)', light)
            light_h = float(lm.group(1)) if lm else None
        notes = _field(top, 'modelNotes') or "''"
        notes_s = _string_list(notes)
        specs.append(Spec(
            id=sid,
            category=_string_list(req('category'))[0],
            placement=_string_list(req('placement'))[0],
            w=int(fm.group(1)),
            d=int(fm.group(2)),
            height=eval_number(req('height')),
            dynamic_parts=_string_list(dyn) if dyn else [],
            variants=variants,
            needs_power=(_field(top, 'needsPower') or 'false').strip() == 'true',
            tags=_string_list(_field(full, 'tags') or '[]'),
            model_notes=notes_s[0].replace("\\'", "'") if notes_s else '',
            light_height=light_h,
        ))
    return specs


def parse_env(src: Optional[str] = None) -> List[Spec]:
    if src is None:
        src = CATALOG_TS.read_text(encoding='utf-8')
    body = _array_body(src, 'export const ENV_MODELS = [')
    out: List[Spec] = []
    for obj in top_level_objects(body):
        sid = _string_list(_field(obj, 'id') or '')[0]
        notes = _string_list(_field(obj, 'notes') or "''")
        size_src = _field(obj, 'size') or ''
        sm = re.search(r'w:\s*([0-9.]+)\s*,\s*d:\s*([0-9.]+)\s*,\s*h:\s*([0-9.]+)', size_src)
        if not sm:
            raise ValueError(f'{sid}: ENV_MODELS entry without size {{ w, d, h }}')
        size = (float(sm.group(1)), float(sm.group(2)), float(sm.group(3)))
        out.append(Spec(id=sid, category='env', placement='floor', w=max(1, math.ceil(size[0])),
                        d=max(1, math.ceil(size[1])), height=size[2], model_notes=notes[0] if notes else '',
                        env=True, size=size))
    return out


def all_specs() -> Dict[str, Spec]:
    src = CATALOG_TS.read_text(encoding='utf-8')
    d = {s.id: s for s in parse_specs(src)}
    for e in parse_env(src):
        d[e.id] = e
    return d


if __name__ == '__main__':  # pragma: no cover
    if '--json' in sys.argv:
        print(json.dumps({k: asdict(v) for k, v in all_specs().items()}, indent=1))
    else:
        for s in all_specs().values():
            print(f'{s.id:24s} {s.placement:7s} {s.w}x{s.d} h={s.height:.2f} dyn={s.dynamic_parts} var={len(s.variants)}')
