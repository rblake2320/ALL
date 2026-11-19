"""Hair styles (one mesh per style, material 'Hair', rigid to the head).

All shells are generated from the analytic head surface: rows run from the hairline (or bottom edge for draped
styles) up to the crown; an inward 'tuck' row gives every edge visible thickness."""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from .face import HC, HR, dir_from_angles, head_point, surface, surface_normal
from .meshkit import Part, add_ring, ellipsoid, fan, grid, tube
from .noise import clamp, fbm3, rng, smoothstep

V = Vector
DRAPE_EL = -0.08
SHELL_TAG = 'shell'   # vertices of hair / cap shells that must stay clear of the scalp (see checks.py)


def _hair_col(k: float, n: float = 1.0) -> tuple:
    v = (0.72 + 0.28 * k) * n
    return (v, v, v)


def hair_point(az: float, el: float, lift: float, flare: float = 0.0) -> Vector:
    """Point on the head surface lifted by `lift`; below DRAPE_EL hair hangs straight down (curtain)."""
    if el >= DRAPE_EL:
        return surface(az, el, lift)
    top = surface(az, DRAPE_EL, lift)
    drop = (DRAPE_EL - el) * HR[2] * 1.05
    out = V((top.x - HC.x, top.y - HC.y, 0.0))
    if out.length > 1e-6:
        out.normalize()
    return top + V((0, 0, -drop)) + out * (flare * min(1.0, (DRAPE_EL - el) / 0.6))


def shell(p: Part, edge_fn, thick_fn, cols: int, rows: int, el_top: float = 1.40, zig: float = 0.0,
          flare_fn=None, noise_amp: float = 0.0, seed: int = 1, tuck: float = 0.006, tag: str = 'hair',
          az_range: tuple[float, float] | None = None, top_fan: bool = True, mat: str = 'Hair',
          col_fn=None, row_bias: float = 0.85) -> list[list[int]]:
    """Generic hair shell. edge_fn(az) -> edge elevation; thick_fn(az, el) -> lift; col_fn(az, el, t) -> grey
    multiplier (clump grooves / part lines; default: darker toward the hem). row_bias < 1 packs rows toward the
    hem (where silhouettes and clumps live)."""
    closed = az_range is None
    a0, a1 = az_range if az_range else (-math.pi, math.pi)
    n_az = cols if closed else cols + 1
    azs = [a0 + (a1 - a0) * j / cols for j in range(n_az)]
    grid_rows: list[list[Vector]] = []
    cols_rows: list[list[tuple]] = []
    for k in range(rows + 1):
        t = k / rows
        row, crow = [], []
        for j, az in enumerate(azs):
            e0 = edge_fn(az) + (zig if (j % 2 == 0 and k == 0) else 0.0)
            el = e0 + (el_top - e0) * (t ** row_bias)
            lift = max(0.0048, thick_fn(az, el) * (0.55 + 0.45 * smoothstep(0.0, 0.25, t)))
            if noise_amp:
                d = dir_from_angles(az, el)
                lift += noise_amp * (fbm3(d.x * 3 + 5, d.y * 3, d.z * 3, seed) - 0.5)
            fl = flare_fn(az, el) if flare_fn else 0.0
            row.append(hair_point(az, el, lift, fl))
            nz = 0.92 + 0.08 * fbm3(az * 4, el * 4, 1.3, seed + 3)
            if col_fn is not None:
                g = col_fn(az, el, t) * nz
                crow.append((g, g, g))
            else:
                crow.append(_hair_col(t, nz))
        grid_rows.append(row)
        cols_rows.append(crow)
    # tuck row: edge pulled toward the head centre axis / into the scalp
    tuck_row = []
    for j, az in enumerate(azs):
        q = grid_rows[0][j]
        inward = V((HC.x - q.x, HC.y - q.y, (HC.z - q.z) * 0.3))
        if inward.length > 1e-6:
            inward.normalize()
        tuck_row.append(q + inward * tuck + V((0, 0, 0.004)))
    # tags: 'tuck' = the inward lip (dips into the scalp by design), SHELL_TAG = the shell proper (clearance-checked)
    idx_rows = [add_ring(p, tuck_row, col=(0.55, 0.55, 0.55), tag='tuck')]
    for k, row in enumerate(grid_rows):
        ids = [p.v(row[j], cols_rows[k][j], 0.0, SHELL_TAG) for j in range(len(row))]
        idx_rows.append(ids)
    # rows ascend from the edge to the crown; ordering azimuth -pi..pi (front=0, +X at +pi/2) is CCW seen from
    # above, so quads (row k -> row k+1) face outward.
    grid(p, idx_rows, mat, close_u=closed, flip=True)
    if top_fan and closed:
        top_lift = thick_fn(0.0, math.pi / 2)
        tp = surface(0.0, math.pi / 2, top_lift)
        ti = p.v(tp, _hair_col(1.0), 0.0, SHELL_TAG)
        fan(p, idx_rows[-1], ti, mat, flip=True)
    return idx_rows


def spike(p: Part, base: Vector, direction: Vector, length: float, radius: float, bend: Vector, sides: int = 5,
          squash: tuple[float, float] = (1.0, 1.0), tag: str = 'hair', col_tip: float = 1.0) -> None:
    d = direction.normalized()
    pts = [base - d * radius * 0.6, base + d * length * 0.45 + bend * length * 0.15,
           base + d * length + bend * length * 0.45]
    tube(p, pts, lambda u, th: radius * (1.0 - 0.95 * u) + 0.0008, sides, 'Hair', up=bend if bend.length > 0 else V((0, 0, 1)),
         squash=squash, cap0=None, cap1='fan', cap_depth1=0.0, colfn=lambda q: _hair_col(0.6 * col_tip + 0.4), tag=tag)


# ------------------------------------------------------------------------------------------------ styles

def _std_hairline(az: float, front: float = 0.58, side: float = 0.08, back: float = -0.45) -> float:
    a = abs(az)
    if a < 0.9:
        t = smoothstep(0.35, 0.9, a)
        return front + (side - front) * t
    t = smoothstep(1.4, 2.8, a)
    return side + (back - side) * t


def hair_buzz() -> Part:
    p = Part('Hair_buzz')
    # close-cropped: low lift, so rows are packed toward the hem (row_bias > 1) to keep every chord of the
    # shell outside the head mesh (a sparse low shell dips into the scalp and lets skin poke through)
    shell(p, lambda az: _std_hairline(az, 0.60, 0.10, -0.42), lambda az, el: 0.012, 16, 4, tuck=0.003,
          row_bias=1.2)
    return p


def tuft(p: Part, az: float, el: float, sweep: Vector, length: float, width: float, curl: float = 0.3,
         lift: float = 0.008, sides: int = 4, col: float = 0.95) -> None:
    """A flat clump of hair rooted in the scalp at (az, el), lying along the surface in direction `sweep`, wide
    for most of its length then tapering to a soft point that lifts off the head a little (not a radial horn)."""
    base = surface(az, el, lift)
    n = surface_normal(az, el)
    d = (sweep - n * sweep.dot(n)).normalized()
    pts = [base - d * width * 0.6,
           base + d * length * 0.40 + n * length * curl * 0.05,
           base + d * length * 0.78 + n * length * curl * 0.22,
           base + d * length * 1.02 + n * length * curl * 0.55]
    tube(p, pts, lambda u, th: width * (1.0 - 0.9 * u ** 2.2) + 0.001, sides, 'Hair', up=n, squash=(0.36, 1.0),
         cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0,
         colfn=lambda q: _hair_col(0.75, col), tag='hair')


def _messy_hem(az: float) -> float:
    # ragged fringe hanging onto the forehead, jagged sideburns, scruffy nape
    base = _std_hairline(az, 0.46, 0.02, -0.52)
    return base - 0.06 * abs(math.sin(az * 5.0 + 0.7)) - 0.03 * abs(math.sin(az * 11.0))


def hair_messy() -> Part:
    """Bedhead: a lumpy, ragged-edged cap with flat tufts sweeping every which way and curling out at the tips
    (fringe flopping forward, crown cowlick, flicks at the sides and nape)."""
    p = Part('Hair_messy')
    shell(p, _messy_hem, lambda az, el: 0.027 + 0.006 * math.sin(az * 6.0 + el * 4.0), 12, 3, zig=-0.05,
          noise_amp=0.014, seed=5, row_bias=0.75,
          col_fn=lambda az, el, t: 0.66 + 0.34 * t * (0.75 + 0.25 * math.sin(az * 7.0)))
    F, B = V((0, -1, 0)), V((0, 1, 0))
    # (az, el, sweep direction, length, width, curl)
    tufts = [
        (-0.28, 0.86, F + V((-0.5, 0, -0.5)), 0.080, 0.034, 0.20),   # fringe clumps flopping over the brow
        (0.26, 0.90, F + V((0.6, 0, -0.4)), 0.075, 0.032, 0.25),
        (0.30, 1.40, B + V((0.7, 0, 0.0)), 0.085, 0.036, 0.55),      # crown swirl (cowlick)
        (-0.55, 1.32, B + V((-0.6, 0, 0.0)), 0.080, 0.034, 0.50),
        (1.40, 0.62, V((0.3, 0.6, -0.7)), 0.075, 0.032, 0.45),       # side flicks
        (-1.45, 0.58, V((-0.3, 0.6, -0.7)), 0.075, 0.032, 0.50),
        (2.70, 0.30, B + V((0.3, 0, -0.8)), 0.075, 0.034, 0.45),     # nape flicks
        (-2.55, 0.40, B + V((-0.4, 0, -0.7)), 0.070, 0.032, 0.40),
    ]
    for az, el, sweep, ln, w, curl in tufts:
        tuft(p, az, el, sweep, ln, w, curl)
    return p


PART_AZ = 0.38   # side parting (character's left of centre)


def _bob_edge(az: float) -> float:
    """Blunt fringe just above the brows, jaw-length sides and back; clumped, slightly uneven hem."""
    a = abs(az)
    edge = 0.40 - (0.40 + 0.74) * smoothstep(0.58, 0.98, a)
    scallop = 0.035 * (0.5 - 0.5 * math.cos(az * 13.0)) * smoothstep(0.7, 1.0, a)
    return edge - scallop


def _clump_col(az: float, el: float, t: float, part_az: float | None = PART_AZ, freq: float = 13.0) -> float:
    groove = 0.5 + 0.5 * math.cos(az * freq)                   # 1 on a clump crest, 0 in the groove
    c = 0.70 + 0.22 * groove * (1.0 - 0.6 * t) + 0.18 * t
    if part_az is not None:
        c *= 1.0 - 0.45 * math.exp(-((az - part_az) / 0.07) ** 2) * smoothstep(0.55, 0.9, el)
    return c


def hair_bob() -> Part:
    """Chin-length bob with a side parting, blunt fringe, clumpy ends tucked under, extra volume at the crown."""
    p = Part('Hair_bob')

    def thick(az, el):
        crown = 0.010 * smoothstep(0.6, 1.3, el)
        clumps = 0.006 * (0.5 + 0.5 * math.cos(az * 13.0)) * smoothstep(0.4, -0.4, el)
        part = -0.008 * math.exp(-((az - PART_AZ) / 0.08) ** 2) * smoothstep(0.55, 0.9, el)
        return 0.024 + 0.012 * smoothstep(0.1, -0.6, el) + crown + clumps + part

    shell(p, _bob_edge, thick, 22, 4, flare_fn=lambda az, el: 0.026, tuck=0.016, row_bias=0.7,
          col_fn=lambda az, el, t: _clump_col(az, el, t))
    return p


def hair_bun() -> Part:
    p = Part('Hair_bun')
    shell(p, lambda az: _std_hairline(az, 0.62, 0.02, -0.40), lambda az, el: 0.016, 16, 3, tuck=0.004, row_bias=1.15)
    c = surface(math.pi, 0.70, 0.05)
    ellipsoid(p, c, (0.058, 0.055, 0.052), 8, 6, 'Hair', colfn=lambda q: _hair_col(0.9), tag='hair')
    # hair tie ring
    n = surface_normal(math.pi, 0.70)
    tube(p, [surface(math.pi, 0.70, 0.008), surface(math.pi, 0.70, 0.022)], 0.032, 8, 'Hair', up=V((1, 0, 0)),
         cap0=None, cap1=None, colfn=lambda q: (0.4, 0.3, 0.3), tag='hair')
    return p


def _mohawk_station(s_: float):
    """Point on the mid-line of the scalp: s in [0,1] runs from the forehead hairline over the crown to the nape.
    Returns (base point, outward normal, forward tangent)."""
    ang = 0.62 + (math.pi - 0.62 + 0.42) * s_       # elevation measured over the top (> pi/2 = past the crown)
    if ang <= math.pi / 2:
        az, el = 0.0, ang
    else:
        az, el = math.pi, math.pi - ang
    base = surface(az, el, 0.002)
    n = surface_normal(az, el)
    e = 0.01
    ang2 = ang + e
    az2, el2 = (0.0, ang2) if ang2 <= math.pi / 2 else (math.pi, math.pi - ang2)
    tng = (surface(az2, el2, 0.002) - base).normalized()
    return base, n, tng


def hair_mohawk() -> Part:
    """Shaved sides (dark stubble) and a broad crest of seven spikes from forehead to nape: low at the brow, tallest
    over the crown, swept back, the tall spikes splaying alternately left/right so the crest reads as a bushy strip
    of hair from any side (a thin serrated fin read as a horn from the front game camera)."""
    p = Part('Hair_mohawk')
    # stubble cap: shaved sides read darker than the crest
    shell(p, lambda az: _std_hairline(az, 0.56, 0.06, -0.42), lambda az, el: 0.0105, 18, 4, tuck=0.002,
          row_bias=1.2, col_fn=lambda az, el, t: 0.40 + 0.06 * t)
    stations = 13
    rows = []
    for i in range(stations):
        s_ = i / (stations - 1)
        base, n, tng = _mohawk_station(s_)
        side = n.cross(tng).normalized()
        tall = i % 2 == 0
        prof = math.sin(math.pi * (0.10 + 0.80 * s_)) * (0.72 + 0.28 * s_)   # rises toward the crown / back
        h = (0.030 + 0.062 * prof) * (1.0 if tall else 0.45) + 0.012
        lean = -tng * h * 0.5                                                  # swept back
        splay = side * (0.016 if (i // 2) % 2 == 0 else -0.016) if tall else V((0.0, 0.0, 0.0))
        # strip tapers in at the brow and the nape (no flat block facing the camera), ~6 cm over the crown
        w0 = 0.012 + 0.020 * smoothstep(0.0, 0.3, s_) * (1.0 - 0.35 * smoothstep(0.75, 1.0, s_))
        w1 = 0.006 if tall else min(w0, 0.014)                                 # pointed tips, full valleys
        top = base + n * h + lean + splay
        ring = [base - side * w0 - n * 0.004, top - side * w1, top + side * w1, base + side * w0 - n * 0.004]
        tip = 1.0 if tall else 0.8
        cols = [_hair_col(0.5), _hair_col(tip), _hair_col(tip), _hair_col(0.5)]
        rows.append([p.v(q, c, 0.0, 'hair') for q, c in zip(ring, cols)])
    for a, b in zip(rows[:-1], rows[1:]):
        for j in range(3):                                  # left side, top, right side (bottom stays open)
            p.f((a[j], b[j], b[j + 1], a[j + 1]), 'Hair')
    first, last = rows[0], rows[-1]
    p.f((first[3], first[2], first[1], first[0]), 'Hair')
    p.f((last[0], last[1], last[2], last[3]), 'Hair')
    return p


def _long_edge(az: float) -> float:
    """Centre-parted curtains: the hairline peaks at the parting and sweeps down past the temples into
    face-framing locks, falling to the shoulders at the back with pointed clump ends."""
    a = abs(az)
    front = 0.30 + 0.32 * math.exp(-(az / 0.20) ** 2)
    edge = front - (front + 1.02) * smoothstep(0.42, 0.92, a) - 0.30 * smoothstep(1.6, 2.8, a)
    return edge - 0.07 * (0.5 - 0.5 * math.cos(az * 11.0)) * smoothstep(0.7, 1.1, a)


def hair_long() -> Part:
    """Long, centre-parted hair: volume at the crown, clumped strands falling to the shoulders, ends flaring out.
    Lower strands are weighted to the neck/chest so nods do not push them through the shoulders."""
    p = Part('Hair_long')

    def thick(az, el):
        clumps = 0.011 * (0.5 + 0.5 * math.cos(az * 11.0)) * smoothstep(0.3, -0.5, el)
        part = -0.012 * math.exp(-(az / 0.08) ** 2) * smoothstep(0.45, 0.85, el)
        return 0.020 + 0.008 * smoothstep(0.0, -0.8, el) + 0.009 * smoothstep(0.7, 1.3, el) + clumps + part

    shell(p, _long_edge, thick, 20, 5,
          flare_fn=lambda az, el: 0.012 + 0.022 * smoothstep(-0.7, -1.4, el) + 0.012 * smoothstep(2.2, 3.1, abs(az)),
          noise_amp=0.004, seed=9, tuck=0.014, row_bias=0.7, zig=-0.06,
          col_fn=lambda az, el, t: _clump_col(az, el, t, part_az=0.0, freq=11.0))
    return p


def long_hair_weights(co: Vector, tag: str) -> dict:
    """Head above the ears, sliding onto the neck/chest down the back so the drape follows the shoulders."""
    t = smoothstep(1.36, 1.20, co.z)
    if t <= 0.0:
        return {'head': 1.0}
    return {'head': 1.0 - t, 'neck': t * 0.65, 'chest': t * 0.35}


def hair_combover() -> Part:
    p = Part('Hair_combover')
    # side/back fringe (bald on top)
    shell(p, lambda az: _std_hairline(az, 0.35, 0.02, -0.42), lambda az, el: 0.012, 12, 2, el_top=0.42,
          top_fan=False, tuck=0.004, az_range=(1.05, 2 * math.pi - 1.05))
    r = rng(23)
    for i in range(4):
        z0 = 0.42 + i * 0.14
        strand = []
        for k in range(7):
            t = k / 6
            az = 1.45 - 2.9 * t
            el = z0 + 0.42 * math.sin(t * math.pi) + r.uniform(-0.02, 0.02)
            strand.append(surface(az, min(el, 1.45), 0.009))
        tube(p, strand, lambda u, th: 0.007, 3, 'Hair', up=V((0, 0, 1)), squash=(1.0, 0.35), cap0='fan',
             cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: _hair_col(0.8), tag='hair')
    return p


def _pig_edge(az: float) -> float:
    a = abs(az)
    return 0.46 - (0.46 + 0.35) * smoothstep(0.6, 1.1, a)


def hair_pigtails() -> Part:
    p = Part('Hair_pigtails')
    shell(p, _pig_edge, lambda az, el: 0.017, 16, 4, tuck=0.006)
    for sx in (1, -1):
        az = 1.85 * sx
        anchor = surface(az, 0.12, 0.012)
        out = V((sx, 0.25, 0.0)).normalized()
        pts = [anchor, anchor + out * 0.05 + V((0, 0, -0.01)), anchor + out * 0.085 + V((0, 0.01, -0.07)),
               anchor + out * 0.095 + V((0, 0.02, -0.15)), anchor + out * 0.085 + V((0, 0.02, -0.21))]
        tube(p, pts, lambda u, th: 0.030 * (1 - 0.6 * u) + 0.004, 6, 'Hair', up=V((0, 0, 1)), cap0='fan',
             cap1='dome', cap_depth0=0.0, cap_depth1=0.01, dome_steps=1, colfn=lambda q: _hair_col(0.8), tag='hair')
        # tie
        tube(p, [anchor + out * 0.035, anchor + out * 0.05], 0.03, 6, 'Hair', up=V((0, 0, 1)), cap0=None,
             cap1=None, colfn=lambda q: (0.35, 0.25, 0.28), tag='hair')
    return p


def hair_afro() -> Part:
    p = Part('Hair_afro')

    def thick(az, el):
        # a soft cloud: volume builds from a rounded hem (no mushroom-cap overhang) up to a big crown,
        # with big puffy lobes and finer frizz
        base = 0.10 * smoothstep(-0.60, 0.55, el) + 0.012
        lobes = 0.018 * (0.5 + 0.5 * math.cos(az * 5.0 + 0.6)) * (0.5 + 0.5 * math.cos(el * 7.0 + 0.4))
        return base + lobes * smoothstep(-0.3, 0.3, el)

    shell(p, lambda az: _std_hairline(az, 0.48, -0.16, -0.52), thick, 20, 5, noise_amp=0.040, seed=31, tuck=0.010,
          row_bias=0.65, col_fn=lambda az, el, t: 0.62 + 0.38 * smoothstep(0.0, 0.5, t) *
          (0.8 + 0.2 * math.cos(az * 5.0 + 0.6)))
    return p


HAIR_BUILDERS = {
    'buzz': hair_buzz, 'messy': hair_messy, 'bob': hair_bob, 'bun': hair_bun, 'mohawk': hair_mohawk,
    'long': hair_long, 'combover': hair_combover, 'pigtails': hair_pigtails, 'afro': hair_afro,
}


def build_hair(style: str) -> Part:
    p = HAIR_BUILDERS[style]()
    p.no_build = True
    p.weight_fn = long_hair_weights if style == 'long' else (lambda co, tag: {'head': 1.0})
    return p
