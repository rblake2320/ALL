"""L2 small items: the 17 grave-goods curios (§4.2: 14 sellable + 3 Vault Key fragments), item_cryptKey, the four
shared fish meshes (small/deep/long/eel, 'Paint' tinted per species at runtime) and the two junk catches.

Items rest on the floor (or a display surface) at z = 0, centred on the origin, front (-Y) toward the camera.
Grave goods are trinkets only (E10+ tone rule §1): never remains."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.model import Model

from .kit import LevelSpec, add, builder, flat_text, node
from .l2_props import _fish_body


def _heart(s: float, n: int = 14):
    pts = []
    for k in range(n):
        t = math.tau * k / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x * s / 16, y * s / 16))
    return pts[::-1] if _area(pts) < 0 else pts


def _area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def _chain(m: Model, pts, mat='Gold', r=0.0025):
    add(m, S.tube(S.catmull(pts, 3), r, 3), mat)


@builder('curio_clayMarble')
def clay_marble(m: Model, spec: LevelSpec) -> None:
    add(m, S.sphere(0.024, 12, 8, loc=(0, 0, 0.024)), 'Clay')
    for k, rot in enumerate(((20, 30, 0), (-35, 10, 60))):
        add(m, S.torus(0.0235, 0.0045, 12, 3, loc=(0, 0, 0.024), rot=rot), 'ClaySwirl' if k == 0 else 'Bone')


@builder('curio_tinSoldier')
def tin_soldier(m: Model, spec: LevelSpec) -> None:
    """Flat tin figure on a round base, chipped red coat, shako, shouldered rifle — one leg (the title)."""
    add(m, S.cylinder(0.026, 0.006, 10, 0.0, base=(0, 0, 0)), 'Tin')
    add(m, S.box(0.01, 0.008, 0.04, 0.0, 0, base=(-0.004, 0, 0.006)), 'Tin')
    add(m, S.box(0.026, 0.012, 0.04, 0.003, 1, base=(0, 0, 0.045)), 'TinRed')
    add(m, S.box(0.028, 0.013, 0.006, 0.0, 0, base=(0, 0, 0.06)), 'Bone')
    add(m, S.sphere(0.011, 8, 6, loc=(0, 0, 0.096)), 'Tin')
    add(m, S.cylinder(0.009, 0.022, 8, 0.0, base=(0, 0, 0.103)), 'Black')
    add(m, S.box(0.004, 0.004, 0.07, 0.0, 0, base=(0.017, 0.0, 0.04), rot=(0, -8, 0)), 'Iron')
    add(m, S.box(0.008, 0.013, 0.006, 0.0, 0, base=(-0.008, -0.002, 0.07)), 'Tin')  # chipped patch


@builder('curio_dollHand')
def doll_hand(m: Model, spec: LevelSpec) -> None:
    add(m, S.superellipsoid(0.022, 0.018, 0.009, 0.5, 0.6, 10, 6, loc=(0, 0, 0.009)), 'Porcelain')
    for k in range(4):
        x = -0.014 + k * 0.0095
        L = (0.026, 0.03, 0.028, 0.022)[k]
        add(m, S.tube([(x, -0.012, 0.012), (x, -0.012 - L * 0.6, 0.016), (x, -0.012 - L, 0.012 + 0.01 * (k == 1))],
                      0.0042, 5), 'Porcelain')
    add(m, S.tube([(0.02, 0.0, 0.01), (0.032, -0.012, 0.014), (0.036, -0.022, 0.012)], 0.005, 5), 'Porcelain')
    add(m, S.cylinder(0.014, 0.014, 8, 0.002, base=(0, 0.024, 0.008), rot=(90, 0, 0)), 'Lace')
    add(m, S.tube([(-0.01, 0.005, 0.018), (0.0, -0.004, 0.019), (0.006, -0.012, 0.018)], 0.0009, 3), 'Charcoal')


@builder('curio_loveLetter')
def love_letter(m: Model, spec: LevelSpec) -> None:
    env = S.box(0.12, 0.08, 0.006, 0.0015, 1, base=(0, 0, 0))
    S.displace(env, lambda v: v + Vector((0, 0, 0.004 * (1 - (v.x / 0.06) ** 2))))
    add(m, env, 'PaperOld')
    add(m, S.prism([(-0.06, 0.0), (0.06, 0.0), (0.0, -0.045)], 0.003, 0.0, 0, plane='XY', loc=(0, 0.04, 0.009)),
        'Envelope')
    add(m, S.cylinder(0.012, 0.004, 10, 0.0015, base=(0, -0.004, 0.011)), 'WaxSeal')
    add(m, S.sphere(0.004, 6, 4, loc=(0.011, -0.012, 0.013)), 'WaxSeal')
    add(m, S.box(0.002, 0.03, 0.001, 0.0, 0, base=(-0.04, 0.0, 0.0095), rot=(0, 0, 70)), 'Ink')


@builder('curio_apothecaryBottle')
def apothecary_bottle(m: Model, spec: LevelSpec) -> None:
    add(m, S.lathe([(0.0, 0.0), (0.03, 0.0), (0.034, 0.008), (0.034, 0.09), (0.016, 0.115), (0.012, 0.13),
                    (0.0, 0.13)], 10), 'Cobalt')
    add(m, S.lathe([(0.0, 0.0), (0.024, 0.0), (0.024, 0.06), (0.0, 0.06)], 8, base=(0, 0, 0.01)), 'BloodWine')
    add(m, S.cylinder(0.011, 0.03, 8, 0.002, base=(0, 0, 0.125), r_top=0.013), 'Cork2')
    add(m, S.cylinder(0.0352, 0.035, 12, 0.0, base=(0, 0, 0.035), cap=False), 'Parchment')
    add(m, S.box(0.03, 0.002, 0.004, 0.0, 0, base=(0, -0.036, 0.055)), 'Ink')


@builder('curio_glassEye')
def glass_eye(m: Model, spec: LevelSpec) -> None:
    add(m, S.cushion(0.07, 0.07, 0.016, 0.003, 0.4, loc=(0, 0, 0.008), segs=10, rings=5), 'FeltRed')
    add(m, S.sphere(0.017, 12, 8, loc=(0, 0, 0.032)), 'EyeWhite')
    add(m, S.cylinder(0.0085, 0.002, 12, 0.0, base=(0, -0.0158, 0.036), rot=(70, 0, 0)), 'EyeIris')
    add(m, S.cylinder(0.0038, 0.0025, 8, 0.0, base=(0, -0.0168, 0.0365), rot=(70, 0, 0)), 'Black')


@builder('curio_silverSpoon')
def silver_spoon(m: Model, spec: LevelSpec) -> None:
    bowl = S.sphere(0.022, 10, 6, loc=(-0.05, 0, 0.008), scale=(1.4, 1.0, 0.35))
    add(m, bowl, 'Silver')
    pts = [(-0.025, 0, 0.01), (0.02, 0, 0.014), (0.055, 0.0, 0.022), (0.075, 0.012, 0.035), (0.07, 0.024, 0.03)]
    add(m, S.tube(S.catmull(pts, 2), 0.0035, 5), 'Silver')
    add(m, S.sphere(0.006, 6, 4, loc=(0.07, 0.024, 0.03), scale=(1, 1, 0.6)), 'Silver')


@builder('curio_pocketWatch')
def pocket_watch(m: Model, spec: LevelSpec) -> None:
    """Open hunter case: case + enamel dial with the hands stuck at 3:07, lid propped open behind, chain."""
    add(m, S.cylinder(0.024, 0.01, 12, 0.0, base=(0, 0, 0)), 'Brass')
    add(m, S.cylinder(0.021, 0.002, 12, 0.0, base=(0, 0, 0.01)), 'Porcelain')
    for k in range(4):
        a = math.tau * k / 4
        add(m, S.box(0.0012, 0.003, 0.0008, 0.0, 0, base=(math.cos(a) * 0.017, math.sin(a) * 0.017, 0.012),
                     rot=(0, 0, math.degrees(a))), 'Ink')
    add(m, S.box(0.0018, 0.011, 0.001, 0.0, 0, base=(0.0055, 0.0, 0.0125), rot=(0, 0, -90)), 'Ink')   # 3 o'clock
    add(m, S.box(0.0012, 0.016, 0.001, 0.0, 0, base=(0.003, -0.007, 0.0128), rot=(0, 0, -42)), 'Ink')  # :07
    lid = S.cylinder(0.024, 0.004, 12, 0.0, base=(0, 0.0, 0.0))
    S.rotate(lid, (-105, 0, 0))
    add(m, S.translate(lid, (0, 0.025, 0.006)), 'Brass')
    add(m, S.torus(0.005, 0.0015, 8, 3, loc=(0, -0.027, 0.006), rot=(90, 0, 0)), 'Brass')
    _chain(m, [(0, -0.031, 0.004), (0.02, -0.045, 0.002), (0.045, -0.035, 0.002), (0.05, -0.012, 0.002)], 'Brass')


@builder('curio_tarnishedLocket')
def tarnished_locket(m: Model, spec: LevelSpec) -> None:
    heart = S.prism(_heart(0.032, 16), 0.012, 0.003, 1, plane='XY', loc=(0, 0, 0.0))
    add(m, heart, 'Bronze')
    add(m, S.prism(_heart(0.024, 16), 0.002, 0.0, 0, plane='XY', loc=(0, 0.001, 0.012)), 'Verdigris')
    add(m, S.torus(0.005, 0.0014, 8, 3, loc=(0, 0.035, 0.006), rot=(0, 90, 0)), 'Bronze')
    _chain(m, [(0, 0.04, 0.004), (-0.03, 0.06, 0.002), (-0.055, 0.03, 0.002), (-0.045, -0.01, 0.002),
               (-0.02, -0.03, 0.002)], 'Bronze', 0.0018)


@builder('curio_funeralBell')
def funeral_bell(m: Model, spec: LevelSpec) -> None:
    add(m, S.lathe([(0.0, 0.006), (0.04, 0.0), (0.042, 0.006), (0.032, 0.025), (0.024, 0.06), (0.018, 0.075),
                    (0.0, 0.078)], 12), 'Brass')
    add(m, S.sphere(0.008, 6, 4, loc=(0.0, -0.012, 0.008)), 'Bronze')
    add(m, S.torus(0.012, 0.003, 10, 3, loc=(0, 0, 0.088), rot=(90, 0, 0)), 'Brass')
    add(m, S.tube([(0, 0, 0.1), (0.006, -0.008, 0.11), (0.03, -0.02, 0.1), (0.05, -0.03, 0.02), (0.07, -0.02, 0.005)],
                  0.003, 4), 'Rope')
    add(m, S.sphere(0.007, 6, 4, loc=(0.07, -0.02, 0.006)), 'BloodWine')


@builder('curio_fossilBeetle')
def fossil_beetle(m: Model, spec: LevelSpec) -> None:
    add(m, S.blob(0.05, 1, 0.2, 2.0, 3, loc=(0, 0, 0.0), scale=(1.0, 0.8, 0.55), flat_bottom=0.0), 'GyStoneWarm')
    add(m, S.sphere(0.02, 10, 6, loc=(0, 0.004, 0.026), scale=(0.75, 1.0, 0.45)), 'Amber')
    add(m, S.sphere(0.009, 8, 4, loc=(0, -0.019, 0.026), scale=(1.0, 0.8, 0.5)), 'Amber')
    add(m, S.box(0.001, 0.034, 0.002, 0.0, 0, base=(0, 0.004, 0.034)), 'Charcoal')
    for sx in (-1, 1):
        for k in range(3):
            y = -0.006 + k * 0.01
            add(m, S.tube([(sx * 0.012, y, 0.026), (sx * 0.022, y + 0.004 * (k - 1), 0.024), (sx * 0.026, y + 0.008 * (k - 1), 0.02)],
                          0.0015, 3), 'Amber')


@builder('curio_cameoBrooch')
def cameo_brooch(m: Model, spec: LevelSpec) -> None:
    ring = [(math.cos(a) * 0.026, math.sin(a) * 0.033, 0.006) for a in (math.tau * k / 16 for k in range(16))]
    add(m, S.tube(ring, 0.0035, 4, closed=True), 'Gold')
    oval = [(math.cos(a) * 0.024, math.sin(a) * 0.031) for a in (math.tau * k / 16 for k in range(16))]
    add(m, S.prism(oval, 0.008, 0.002, 1, plane='XY', loc=(0, 0, 0.002)), 'Coral')
    # a profile in shell (looking unimpressed): head + neck + bun, facing left
    prof = [(-0.008, -0.022), (0.006, -0.022), (0.006, -0.012), (0.01, -0.004), (0.011, 0.008), (0.006, 0.016),
            (-0.002, 0.018), (-0.008, 0.014), (-0.012, 0.008), (-0.014, 0.002), (-0.011, -0.002), (-0.012, -0.006),
            (-0.009, -0.009), (-0.009, -0.014)]
    add(m, S.prism(prof, 0.003, 0.0, 0, plane='XY', loc=(0, 0, 0.01)), 'Shell')
    add(m, S.sphere(0.006, 6, 4, loc=(0.009, 0.014, 0.0115), scale=(1, 1, 0.4)), 'Shell')


@builder('curio_jetRing')
def jet_ring(m: Model, spec: LevelSpec) -> None:
    add(m, S.torus(0.016, 0.0035, 8, 4, loc=(0, 0, 0.0195), rot=(90, 0, 0)), 'Jet')
    gem = S.lathe([(0.0, 0.0), (0.008, 0.002), (0.009, 0.005), (0.0055, 0.009), (0.0, 0.009)], 6)
    add(m, S.translate(gem, (0, 0, 0.0355)), 'Jet')
    add(m, S.cylinder(0.009, 0.002, 6, 0.0, base=(0, 0, 0.035)), 'Silver')


@builder('curio_signetRing')
def signet_ring(m: Model, spec: LevelSpec) -> None:
    add(m, S.torus(0.017, 0.004, 12, 4, loc=(0, 0, 0.021), rot=(90, 0, 0)), 'Gold')
    add(m, S.cylinder(0.011, 0.006, 12, 0.0015, base=(0, 0, 0.036)), 'Gold')
    add(m, flat_text('W', 0.014, (0, 0, 0.0425), rot=(0, 0, 0)), 'Bronze')


def _skull_outline(s: float):
    """Cartoon skull silhouette (cranium + cheeks + jaw), CCW, size ~2s wide."""
    pts = []
    for k in range(9):  # cranium arc from right cheek over the top to the left cheek
        a = math.radians(-20 + 220 * k / 8)
        pts.append((math.cos(a) * s, math.sin(a) * s * 0.95 + s * 0.15))
    pts += [(-s * 0.7, -s * 0.45), (-s * 0.45, -s * 0.75), (s * 0.45, -s * 0.75), (s * 0.7, -s * 0.45)]
    return pts if _area(pts) > 0 else pts[::-1]


def _key_bow(m: Model, ox: float, s: float = 0.03):
    """Skull-shaped bow (flat iron plate, two dark eye holes) with a collar ring toward the shaft."""
    add(m, S.prism(_skull_outline(s), 0.01, 0.0, 0, plane='XY', loc=(ox, 0, 0.0)), 'IronOld')
    for sx in (-1, 1):
        add(m, S.cylinder(s * 0.26, 0.002, 6, 0.0, base=(ox + sx * s * 0.38, s * 0.12, 0.01)), 'Black')
    add(m, S.cylinder(s * 0.12, 0.002, 4, 0.0, base=(ox, -s * 0.3, 0.01)), 'Black')
    add(m, S.torus(0.009, 0.0025, 6, 3, loc=(ox + s * 1.05, 0, 0.007), rot=(0, 90, 0)), 'IronOld')


def _key_shaft(m: Model, x0: float, x1: float):
    add(m, S.cylinder(0.0075, x1 - x0, 6, 0.0, base=(x0, 0, 0.0075), rot=(0, 90, 0)), 'IronOld')
    add(m, S.torus(0.009, 0.0025, 6, 3, loc=(x0 + 0.02, 0, 0.0075), rot=(0, 90, 0)), 'IronOld')


def _key_bit(m: Model, x0: float):
    pts = [(0.0, 0.0), (0.04, 0.0), (0.04, -0.012), (0.03, -0.012), (0.03, -0.02), (0.02, -0.02), (0.02, -0.03),
           (0.008, -0.03), (0.008, -0.012), (0.0, -0.012)]
    add(m, S.prism(pts, 0.012, 0.0, 0, plane='XY', loc=(x0, 0.006, 0.0)), 'IronOld')


@builder('curio_keyBow')
def key_bow(m: Model, spec: LevelSpec) -> None:
    _key_bow(m, -0.02, 0.034)
    add(m, S.cylinder(0.0075, 0.03, 6, 0.0, base=(0.02, 0, 0.0075), rot=(0, 90, 0)), 'IronOld')
    add(m, S.ico(0.004, 1, loc=(0.035, -0.006, 0.012)), 'Rust')


@builder('curio_keyShaft')
def key_shaft(m: Model, spec: LevelSpec) -> None:
    _key_shaft(m, -0.06, 0.06)
    add(m, S.ico(0.004, 1, loc=(0.0, -0.007, 0.012)), 'Rust')


@builder('curio_keyBit')
def key_bit(m: Model, spec: LevelSpec) -> None:
    _key_bit(m, -0.02)
    add(m, S.cylinder(0.0075, 0.03, 8, 0.0, base=(-0.05, 0.0, 0.0075), rot=(0, 90, 0)), 'IronOld')


@builder('item_cryptKey')
def crypt_key(m: Model, spec: LevelSpec) -> None:
    """The assembled Gloam Vault key (bow + shaft + bit): big, iron, a little skull on the bow, lying flat."""
    _key_bow(m, -0.115, 0.034)
    _key_shaft(m, -0.085, 0.09)
    _key_bit(m, 0.07)


# ───────────────────────────── fish & junk ─────────────────────────────

def _lay_fish(m: Model, L: float, H: float, T: float, eye: float = 0.012, whisk: bool = False, fin_mat='Paint'):
    """A fish lying on its side (flat side up), head toward +X."""
    body, fins = _fish_body(L, H, T, 8)
    for bm in (body, fins):
        S.rotate(bm, (90, 0, 0))
        S.translate(bm, (0, 0, T / 2))
    add(m, body, 'Paint')
    add(m, fins, fin_mat)
    add(m, S.sphere(eye, 8, 5, loc=(L * 0.33, -H * 0.05, T * 0.85), scale=(1, 1, 0.6)), 'EyeWhite')
    add(m, S.sphere(eye * 0.55, 6, 4, loc=(L * 0.335, -H * 0.05, T * 0.85 + eye * 0.45), scale=(1, 1, 0.5)), 'Black')
    if whisk:
        for sy in (-1, 1):
            add(m, S.tube([(L * 0.46, sy * H * 0.1, T * 0.4), (L * 0.56, sy * H * 0.3, T * 0.3), (L * 0.6, sy * H * 0.45, T * 0.2)],
                          0.0025, 3), 'Black')


@builder('item_fish_small')
def fish_small(m: Model, spec: LevelSpec) -> None:
    _lay_fish(m, 0.17, 0.06, 0.045)


@builder('item_fish_deep')
def fish_deep(m: Model, spec: LevelSpec) -> None:
    _lay_fish(m, 0.24, 0.13, 0.075, eye=0.016)


@builder('item_fish_long')
def fish_long(m: Model, spec: LevelSpec) -> None:
    _lay_fish(m, 0.34, 0.08, 0.07, eye=0.014, whisk=True)


@builder('item_fish_eel')
def fish_eel(m: Model, spec: LevelSpec) -> None:
    """Lantern Eel: an S-curled tube body (Paint) with glowing spots ('glow' node) along its back."""
    pts = [(-0.2, -0.05, 0.022), (-0.1, 0.04, 0.024), (0.02, -0.03, 0.026), (0.12, 0.03, 0.026), (0.2, 0.0, 0.026)]
    c = S.catmull(pts, 2)
    n = len(c)
    add(m, S.tube(c, radii=[0.004 + 0.022 * math.sin(math.pi * (0.15 + 0.8 * i / (n - 1))) for i in range(n)], segs=6),
        'Paint')
    add(m, S.sphere(0.007, 6, 4, loc=(0.19, -0.01, 0.036)), 'EyeWhite')
    add(m, S.sphere(0.004, 5, 3, loc=(0.193, -0.012, 0.04)), 'Black')
    node(m, 'glow', 'glow', origin=(0, 0, 0.04), pulse=True)
    for i in range(2, n - 2, 2):
        p = c[i]
        add(m, S.sphere(0.006, 6, 4, loc=(p.x, p.y, p.z + 0.018), scale=(1, 1, 0.6)), 'GlowCryo', 'glow')


@builder('junk_oldBoot')
def junk_old_boot(m: Model, spec: LevelSpec) -> None:
    add(m, S.box(0.26, 0.1, 0.025, 0.008, 1, base=(0.02, 0, 0.0)), 'LeatherDark')
    add(m, S.superellipsoid(0.08, 0.05, 0.04, 0.6, 0.6, 8, 4, loc=(0.08, 0, 0.05)), 'Leather')
    add(m, S.cylinder(0.055, 0.12, 10, 0.0, base=(-0.06, 0, 0.02), r_top=0.06), 'Leather')
    add(m, S.cylinder(0.045, 0.004, 10, 0.0, base=(-0.06, 0, 0.14)), 'Black')
    for k in range(3):
        add(m, S.box(0.006, 0.08, 0.004, 0.0, 0, base=(0.0 + k * 0.02, -0.0, 0.085 - k * 0.006), rot=(0, 20, 0)), 'Rope')
    add(m, S.tube([(-0.01, -0.03, 0.09), (0.0, -0.08, 0.05), (0.02, -0.1, 0.005)], 0.003, 3), 'Rope')
    add(m, S.box(0.05, 0.04, 0.012, 0.0, 0, base=(0.13, 0.0, 0.02), rot=(0, -20, 0)), 'Black')  # the sole flapping open
    add(m, S.ico(0.012, 1, loc=(-0.06, 0.0, 0.142), scale=(1, 1, 0.3)), 'PondWater')


@builder('junk_tinCan')
def junk_tin_can(m: Model, spec: LevelSpec) -> None:
    can = S.cylinder(0.035, 0.1, 12, 0.003, base=(0, 0, 0))
    S.displace(can, lambda v: v + Vector((0, 0.008 if (v.y < -0.02 and 0.03 < v.z < 0.07) else 0.0, 0)))
    S.rotate(can, (0, 90, 15))
    S.translate(can, (-0.05, 0, 0.035))
    add(m, can, 'Rust')
    lab = S.cylinder(0.0355, 0.05, 12, 0.0, base=(0, 0, 0.025), cap=False)
    S.rotate(lab, (0, 90, 15))
    S.translate(lab, (-0.05, 0, 0.035))
    add(m, lab, 'TinRed')
    lid = S.cylinder(0.033, 0.002, 12, 0.0, base=(0, 0, 0))
    S.rotate(lid, (0, 40, 15))
    add(m, S.translate(lid, (0.06, 0.015, 0.05)), 'Tin')
