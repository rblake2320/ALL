"""Yard structure builders (W-109 part 4): shed, gazebo, greenhouse, doghouse. Each is one placed object, not a
room: a zombie uses it through its contact frames (approach outside, pose inside), so the outline is solid.
Conventions are the level kit's (front = -Y, Z up, base at z = 0)."""
from __future__ import annotations

import math

from mathutils import Vector

import manifest_meta as meta
from common import dims
from common import shapes as S
from common.materials import MatSpec
from common.model import Model

from . import kit
from .kit import add, builder, node
from .spec import LevelSpec

kit.LEVEL_LOOKS.update({
    'YdShingle': MatSpec('#4a4640', roughness=0.9),
    'YdShingleMoss': MatSpec('#5a6a48', roughness=0.95),
    'YdIvy': MatSpec('#3f5a34', roughness=0.9),
    'YdGlassHouse': MatSpec('#a9c7b8', roughness=0.1, alpha=0.35, double_sided=True),
    'YdTin': MatSpec('#7a7f80', roughness=0.4),
    'YdDark': MatSpec('#1c1a1c', roughness=0.95),
    'YdPot': MatSpec('#a45a3c', roughness=0.85),
})


def facing_yaw(x: float, y: float, tx: float = 0.0, ty: float = 0.0) -> float:
    """Frame yaw for something at (x, y) looking at (tx, ty). Yaw 0 faces the front (-Y), 90 faces +X."""
    return round(math.degrees(math.atan2(tx - x, -(ty - y))), 3)


def gable(m: Model, half_w: float, rise: float, y: float, z: float, look: str, back: bool = False) -> None:
    """The triangle of wall under a pitched roof, on the front (or back) wall at depth y."""
    tri = kit.front_poly([(-half_w, 0.0), (half_w, 0.0), (0.0, rise)], (0.0, 0.0, 0.0))
    if back:
        S.rotate(tri, (0, 0, 180))
    add(m, S.translate(tri, (0.0, y, z)), look)


def pitched(m: Model, half_w: float, depth: float, z: float, pitch: float, over: float, look: str, t: float = 0.05,
            seams: int = 0, seam_look: str = 'IronOld') -> float:
    """Two roof slabs over wall tops at z; returns the ridge height."""
    tan = math.tan(math.radians(pitch))
    ridge = z + half_w * tan
    run = half_w + over
    length = run / math.cos(math.radians(pitch))
    for sx in (-1, 1):
        add(m, S.box(length, depth, t, 0.0, 0, loc=(sx * run / 2, 0.0, ridge - run * tan / 2 + t * 0.6), rot=(0, sx * pitch, 0)), look)
        for k in range(1, seams + 1):
            x = sx * run * k / (seams + 1)
            add(m, S.box(0.03, depth, 0.02, 0.0, 0, loc=(x, 0.0, ridge - abs(x) * tan + t * 1.5), rot=(0, sx * pitch, 0)), seam_look)
    add(m, S.tube([(0.0, -depth / 2, ridge + t), (0.0, depth / 2, ridge + t)], t * 0.9, 5), seam_look)
    return ridge


# ─────────────────────────────────────────── shed ───────────────────────────────────────────

@builder('shed_tool')
def shed_tool(m: Model, spec: LevelSpec) -> None:
    """A plank tool shed under a rusted tin roof: a braced door on its own node, a dark side window, a shovel and a
    rake leaning outside. `Paint` is the walls."""
    hw, hd, wall = 0.80, 0.78, 1.85
    add(m, S.box(2 * hw, 2 * hd, wall, 0.0, 0, base=(0, 0, 0)), 'Paint')
    for sx in (-1, 1):                                                                   # corner boards and battens
        for sy in (-1, 1):
            add(m, S.box(0.07, 0.07, wall, 0.0, 0, base=(sx * hw, sy * hd, 0)), 'YdPlankDark')
        for k in range(1, 4):
            add(m, S.box(0.02, 0.04, wall, 0.0, 0, base=(sx * (hw + 0.008), -hd + 2 * hd * k / 4, 0)), 'YdPlankDark')
    for k in (-0.52, 0.52):
        add(m, S.box(0.04, 0.02, wall, 0.0, 0, base=(k, hd + 0.008, 0)), 'YdPlankDark')
    rise = hw * math.tan(math.radians(28))
    gable(m, hw, rise, -hd, wall, 'Paint')
    gable(m, hw, rise, hd, wall, 'Paint', back=True)
    pitched(m, hw, 2 * hd + 0.24, wall, 28, 0.14, 'Rust', seams=3)
    add(m, S.box(0.03, 0.42, 0.40, 0.0, 0, loc=(hw + 0.005, 0.10, 1.25)), 'WindowDark')    # the side window
    add(m, S.box(0.05, 0.52, 0.05, 0.0, 0, loc=(hw + 0.02, 0.10, 1.02)), 'YdPlankDark')
    dw, dh = 0.74, 1.62                                                                  # the door, hinged on its left
    node(m, 'door', 'door', origin=(-dw / 2, -hd - 0.02, 0.04))
    add(m, S.box(dw, 0.04, dh, 0.004, 1, base=(0, -hd - 0.02, 0.04)), 'YdPlank', 'door')
    for z in (0.30, 1.40):
        add(m, S.box(dw - 0.06, 0.02, 0.09, 0.0, 0, loc=(0, -hd - 0.045, z)), 'YdPlankDark', 'door')
    add(m, S.box(1.22, 0.02, 0.08, 0.0, 0, loc=(0, -hd - 0.045, 0.85), rot=(0, 62, 0)), 'YdPlankDark', 'door')
    add(m, S.box(0.05, 0.03, 0.08, 0.0, 0, loc=(dw / 2 - 0.07, -hd - 0.055, 0.90)), 'IronOld', 'door')   # the hasp
    add(m, S.torus(0.035, 0.008, 6, 3, loc=(dw / 2 - 0.07, -hd - 0.06, 0.82), rot=(90, 0, 0)), 'Rust', 'door')
    add(m, S.box(dw + 0.12, 0.05, 0.07, 0.0, 0, loc=(0, -hd - 0.02, dh + 0.09)), 'YdPlankDark')
    sx = -hw - 0.07                                                                      # shovel and rake against the left wall
    add(m, S.tube([(sx - 0.10, -0.30, 0.0), (sx, -0.28, 1.25)], 0.014, 4), 'Wood')
    add(m, S.box(0.02, 0.16, 0.22, 0.0, 0, loc=(sx - 0.10, -0.30, 0.11), rot=(0, -5, 0)), 'IronOld')
    add(m, S.tube([(sx - 0.12, 0.25, 0.0), (sx, 0.27, 1.40)], 0.013, 4), 'Wood')
    add(m, S.box(0.02, 0.30, 0.03, 0.0, 0, loc=(sx - 0.115, 0.25, 0.03)), 'IronOld')
    add(m, S.blob(0.10, 1, 0.3, 3.0, seed=7, loc=(0.35, hd - 0.1, wall + rise * 0.55), scale=(1.6, 1.2, 0.3)), 'Moss')
    meta.add_frame('door', (0.0, -hd - 0.70, 0.0), 180.0, 'approach')
    meta.add_frame('hands', (dw / 2 - 0.07, -hd - 0.10, 0.95), 180.0, 'hands')


# ─────────────────────────────────────────── gazebo ───────────────────────────────────────────

@builder('gazebo_wilted')
def gazebo_wilted(m: Model, spec: LevelSpec) -> None:
    """L1's Wilted Gazebo: a hexagonal deck, six peeling posts, a shingled roof that droops to one side, benches on
    four sides and ivy. `Paint` is the posts and rails. Seats `sit0`..`sit3`: approach from outside, pose inside."""
    deck_h, R, post_h = 0.14, 1.24, 2.10                                                  # the roof's corners stay on the 3 x 3
    deck = S.lathe([(0.0, 0.0), (R, 0.0), (R, deck_h), (0.0, deck_h)], 6)
    a0 = min(math.atan2(v.co.y, v.co.x) % (math.tau / 6) for v in deck.verts if math.hypot(v.co.x, v.co.y) > R * 0.9)
    turn = -math.degrees(a0)                                                             # put a corner on the +X axis
    add(m, S.rotate(deck, (0, 0, turn)), 'YdPlank')
    add(m, S.box(0.90, 0.26, deck_h / 2, 0.0, 0, base=(0, -R * math.cos(math.pi / 6) - 0.13, 0)), 'YdPlankDark')   # the step
    corners = [(math.cos(math.tau * k / 6), math.sin(math.tau * k / 6)) for k in range(6)]
    pr = R - 0.10
    top = deck_h + post_h
    for cx, cy in corners:
        add(m, S.box(0.10, 0.10, post_h, 0.006, 1, base=(cx * pr, cy * pr, deck_h)), 'Paint')
    seat = 0
    for k in range(6):
        (ax, ay), (bx, by) = corners[k], corners[(k + 1) % 6]
        mid = math.tau * (k + 0.5) / 6
        p0, p1 = (ax * pr, ay * pr), (bx * pr, by * pr)
        add(m, S.tube([(p0[0], p0[1], top - 0.06), (p1[0], p1[1], top - 0.06)], 0.045, 4), 'Paint')   # the ring beam
        if abs(math.sin(mid) + 1.0) < 1e-6:                                              # the front side is the way in
            continue
        for z in (deck_h + 0.82, deck_h + 0.12):
            add(m, S.tube([(p0[0], p0[1], z), (p1[0], p1[1], z)], 0.028, 4), 'Paint')
        for q in range(1, 5):
            if k == 1 and q == 2:                                                        # one baluster is gone
                continue
            f = q / 5
            x, y = p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f
            add(m, S.box(0.035, 0.035, 0.70, 0.0, 0, base=(x, y, deck_h + 0.12), rot=(0, 0, math.degrees(mid))), 'Paint')
        if abs(math.sin(mid) - 1.0) < 1e-6:                                              # no bench on the back side
            continue
        br = pr * math.cos(math.pi / 6) - 0.24
        bx_, by_ = math.cos(mid) * br, math.sin(mid) * br
        add(m, S.box(0.34, 0.92, 0.05, 0.006, 1, loc=(bx_, by_, deck_h + dims.SEAT_HEIGHT - 0.025), rot=(0, 0, math.degrees(mid))), 'YdPlank')
        for s in (-1, 1):
            lx, ly = bx_ - math.sin(mid) * 0.36 * s, by_ + math.cos(mid) * 0.36 * s
            add(m, S.box(0.05, 0.05, dims.SEAT_HEIGHT - 0.05, 0.0, 0, base=(lx, ly, deck_h), rot=(0, 0, math.degrees(mid))), 'YdPlankDark')
        meta.add_frame(f'sit{seat}', (bx_, by_, deck_h + dims.SEAT_HEIGHT), facing_yaw(bx_, by_), 'seat')
        seat += 1
    eave = top - 0.02
    prof = [(R + 0.24, eave), (R + 0.16, eave + 0.10), (R * 0.70, eave + 0.52), (R * 0.32, eave + 0.92), (0.0, eave + 1.10)]
    roof = S.lathe(prof, 6, cap_bottom=False)
    S.rotate(roof, (0, 0, turn))
    droop = lambda v: Vector((v.x, v.y, v.z - 0.16 * max(0.0, v.x / (R + 0.24)) ** 2 - 0.04 * max(0.0, -v.y / (R + 0.24))))  # noqa: E731
    add(m, S.displace(roof, droop), 'YdShingle')
    for (r1, z1, r2, z2) in ((R * 0.98, eave + 0.245, R * 0.86, eave + 0.365), (R * 0.56, eave + 0.675, R * 0.44, eave + 0.80)):
        band = S.lathe([(r1, z1 + 0.012), (r2, z2 + 0.012)], 6, cap_bottom=False, cap_top=False)
        S.rotate(band, (0, 0, turn))
        add(m, S.displace(band, droop), 'YdShingleMoss')                                 # mossy shingle courses
    add(m, S.cone(0.06, 0.34, 6, base=(0, 0, eave + 1.06)), 'IronOld')                    # the finial
    add(m, S.sphere(0.07, 6, 4, loc=(0, 0, eave + 1.16)), 'IronOld')
    ix, iy = corners[2][0] * pr, corners[2][1] * pr                                       # ivy up the back-left post
    for q in range(6):
        add(m, S.blob(0.13 - 0.008 * q, 1, 0.3, 3.0, seed=40 + q, loc=(ix + 0.05 * math.sin(q * 2.0), iy + 0.03, deck_h + 0.20 + 0.36 * q),
                      scale=(1.0, 0.7, 1.2)), 'YdIvy')
    add(m, S.blob(0.20, 1, 0.3, 2.6, seed=50, loc=(ix * 1.02, iy * 1.02, top + 0.10), scale=(1.5, 1.0, 0.5)), 'YdIvy')
    meta.add_frame('approach', (0.0, -R - 0.75, 0.0), 180.0, 'approach')


# ─────────────────────────────────────────── greenhouse ───────────────────────────────────────────

@builder('greenhouse_grim')
def greenhouse_grim(m: Model, spec: LevelSpec) -> None:
    """A small glasshouse on a low stone footing: a painted iron frame, grimy panes (one missing), a glazed door on
    its own node, and potting shelves you can see through the glass. `Paint` is the frame."""
    hw, hd, foot, wall = 0.86, 1.18, 0.34, 1.75                                           # the front step stays on the 2 x 3
    add(m, S.box(2 * hw + 0.10, 2 * hd + 0.10, foot, 0.01, 1, base=(0, 0, 0)), 'GyStone')
    add(m, S.box(2 * hw - 0.10, 2 * hd - 0.10, 0.02, 0.0, 0, base=(0, 0, foot)), 'SoilDark')   # the floor inside
    ys = [-hd + 2 * hd * k / 3 for k in range(4)]
    for sx in (-1, 1):
        for y in ys:                                                                     # posts
            add(m, S.box(0.05, 0.05, wall - foot, 0.0, 0, base=(sx * hw, y, foot)), 'Paint')
        add(m, S.box(0.05, 2 * hd, 0.05, 0.0, 0, loc=(sx * hw, 0, wall)), 'Paint')          # eave rail
        add(m, S.box(0.03, 2 * hd, 0.03, 0.0, 0, loc=(sx * hw, 0, (foot + wall) / 2)), 'Paint')
        for k in range(3):                                                               # side panes; one is out
            if sx == 1 and k == 1:
                continue
            add(m, S.box(0.012, 2 * hd / 3 - 0.06, wall - foot - 0.06, 0.0, 0, loc=(sx * hw, (ys[k] + ys[k + 1]) / 2, (foot + wall) / 2)), 'YdGlassHouse')
    pitch = 34
    rise = hw * math.tan(math.radians(pitch))
    for sy in (-1, 1):                                                                   # end walls
        y = sy * hd
        add(m, S.box(2 * hw, 0.05, 0.05, 0.0, 0, loc=(0, y, wall)), 'Paint')
        add(m, S.box(0.04, 0.04, rise, 0.0, 0, base=(0, y, wall)), 'Paint')
        tri = kit.front_poly([(-hw, 0.0), (hw, 0.0), (0.0, rise)], (0.0, 0.0, 0.0))
        add(m, S.translate(tri, (0.0, y, wall)), 'YdGlassHouse')
        if sy == 1:
            add(m, S.box(2 * hw - 0.06, 0.012, wall - foot - 0.06, 0.0, 0, loc=(0, y, (foot + wall) / 2)), 'YdGlassHouse')
            add(m, S.box(0.04, 0.04, wall - foot, 0.0, 0, base=(0, y, foot)), 'Paint')
    dw = 0.66                                                                            # front: fixed panes beside a glazed door
    for sx in (-1, 1):
        add(m, S.box(0.05, 0.05, wall - foot, 0.0, 0, base=(sx * dw / 2, -hd, foot)), 'Paint')
        add(m, S.box(hw - dw / 2 - 0.06, 0.012, wall - foot - 0.06, 0.0, 0, loc=(sx * (hw + dw / 2) / 2, -hd, (foot + wall) / 2)), 'YdGlassHouse')
    add(m, S.box(dw + 0.20, 0.30, foot / 2, 0.0, 0, base=(0, -hd - 0.16, 0)), 'GyStoneDark')   # the step
    node(m, 'door', 'door', origin=(-dw / 2 + 0.03, -hd - 0.02, foot))
    dh = wall - foot - 0.08
    for sx in (-1, 1):
        add(m, S.box(0.04, 0.035, dh, 0.0, 0, base=(sx * (dw / 2 - 0.05), -hd - 0.02, foot + 0.02)), 'Paint', 'door')
    for z in (foot + 0.04, foot + dh * 0.45, foot + dh):
        add(m, S.box(dw - 0.10, 0.035, 0.04, 0.0, 0, loc=(0, -hd - 0.02, z)), 'Paint', 'door')
    add(m, S.box(dw - 0.14, 0.010, dh - 0.06, 0.0, 0, loc=(0, -hd - 0.02, foot + dh / 2 + 0.02)), 'YdGlassHouse', 'door')
    add(m, S.sphere(0.022, 6, 4, loc=(dw / 2 - 0.09, -hd - 0.05, foot + dh * 0.45)), 'IronOld', 'door')
    run = hw + 0.08                                                                      # the glass roof
    length = run / math.cos(math.radians(pitch))
    ridge = wall + rise
    for sx in (-1, 1):
        add(m, S.box(length, 2 * hd + 0.10, 0.012, 0.0, 0, loc=(sx * run / 2, 0, ridge - run * math.tan(math.radians(pitch)) / 2 + 0.02),
                     rot=(0, sx * pitch, 0)), 'YdGlassHouse')
        for y in ys:                                                                     # rafters
            add(m, S.tube([(sx * hw, y, wall + 0.02), (0.0, y, ridge + 0.02)], 0.018, 4), 'Paint')
    add(m, S.tube([(0, -hd - 0.05, ridge + 0.03), (0, hd + 0.05, ridge + 0.03)], 0.03, 5), 'Paint')
    for sx in (-1, 1):                                                                   # potting shelves and pots
        add(m, S.box(0.34, 2 * hd - 0.50, 0.03, 0.0, 0, loc=(sx * (hw - 0.24), 0.10, 0.92)), 'YdPlank')
        for y in (-0.70, 0.90):
            add(m, S.box(0.04, 0.04, 0.92 - foot, 0.0, 0, base=(sx * (hw - 0.36), y, foot)), 'YdPlankDark')
        for k in range(4):
            y = -0.52 + 0.42 * k
            r = 0.07 + 0.012 * ((k + (sx > 0)) % 2)
            add(m, S.cylinder(r * 0.7, r * 1.5, 7, 0.0, r_top=r, base=(sx * (hw - 0.24), y, 0.935)), 'YdPot')
            add(m, S.blob(r * 1.2, 1, 0.3, 3.0, seed=60 + 4 * k + (sx > 0), loc=(sx * (hw - 0.24), y, 0.935 + r * 2.4), scale=(1, 1, 1.25)),
                'YdIvy' if (k + (sx > 0)) % 2 else 'YdShingleMoss')
    add(m, S.blob(0.16, 1, 0.3, 3.0, seed=80, loc=(hw, ys[1] + 0.25, foot + 0.25), scale=(0.5, 1.6, 1.4)), 'YdIvy')   # ivy through the gap
    meta.add_frame('door', (0.0, -hd - 0.85, 0.0), 180.0, 'approach')
    meta.add_frame('inside', (0.0, 0.0, foot + 0.02), 0.0, 'feet')
    meta.add_frame('hands', (-(hw - 0.24), 0.10, 0.98), -90.0, 'hands')


# ─────────────────────────────────────────── doghouse ───────────────────────────────────────────

@builder('doghouse_crypt')
def doghouse_crypt(m: Model, spec: LevelSpec) -> None:
    """A doghouse the dog fits in: plank walls, a doorway 0.38 m wide and 0.63 m clear above the bedding, 0.90 m of floor inside, a
    shingled roof, a name board, a food bowl and a bone. `Paint` is the walls. `pet` and `lie` are on the bedding,
    facing out of the doorway; the space comes from thin walls and short eaves, so the house stays on one tile."""
    hw, hd, wall, t = 0.34, 0.475, 0.74, 0.025
    add(m, S.box(2 * hw, 2 * hd, 0.04, 0.0, 0, base=(0, 0, 0)), 'YdPlankDark')              # the floor
    for sx in (-1, 1):
        add(m, S.box(t, 2 * hd, wall, 0.0, 0, base=(sx * (hw - t / 2), 0, 0)), 'Paint')
    add(m, S.box(2 * hw, t, wall, 0.0, 0, base=(0, hd - t / 2, 0)), 'Paint')
    ow, oh = 0.38, 0.69                                                                  # the doorway: 0.63 m clear above the bedding
    for sx in (-1, 1):
        add(m, S.box(hw - ow / 2, t, wall, 0.0, 0, base=(sx * (hw + ow / 2) / 2, -hd + t / 2, 0)), 'Paint')
    add(m, S.box(ow, t, wall - oh, 0.0, 0, base=(0, -hd + t / 2, oh)), 'Paint')
    pitch = 36
    rise = hw * math.tan(math.radians(pitch))
    gable(m, hw, rise, -hd, wall, 'Paint')
    gable(m, hw, rise, hd, wall, 'Paint', back=True)
    pitched(m, hw, 2 * hd + 0.05, wall, pitch, 0.09, 'YdShingle', t=0.04, seams=0, seam_look='YdPlankDark')
    add(m, S.box(0.30, 0.02, 0.09, 0.003, 1, loc=(0, -hd - 0.012, wall + 0.10), rot=(0, -4, 0)), 'YdPlank')   # the name board
    add(m, kit.flat_text('FANG', 0.055, (0.0, -hd - 0.024, wall + 0.10)), 'DecalInk')
    add(m, S.box(2 * hw - 2 * t - 0.04, 2 * hd - 2 * t - 0.04, 0.02, 0.0, 0, base=(0, 0, 0.04)), 'Straw')   # bedding
    bx, by = hw + 0.08, -0.20                                                           # the bowl, beside the house
    add(m, S.lathe([(0.0, 0.0), (0.065, 0.0), (0.075, 0.05), (0.062, 0.05), (0.052, 0.02), (0.0, 0.02)], 8, base=(bx, by, 0.0)), 'YdTin')
    add(m, S.cylinder(0.050, 0.012, 8, 0.0, base=(bx, by, 0.022)), 'YdBrain')
    ox = -hw - 0.07                                                                     # a bone, beside the other wall
    add(m, S.tube([(ox, -0.26, 0.025), (ox, -0.10, 0.025)], 0.016, 5), 'Bone')
    for ey in (-0.26, -0.10):
        add(m, S.sphere(0.028, 5, 3, loc=(ox, ey, 0.028)), 'Bone')
    # every pet in manifest.pets.json fits here: the raccoon's tail clears the back wall, the dog's nose stays on the tile
    meta.add_frame('pet', (0.0, -0.035, 0.06), 0.0, 'attach')
    meta.add_frame('lie', (0.0, -0.035, 0.06), 0.0, 'feet')
    meta.add_frame('approach', (0.0, -hd - 0.95, 0.0), 180.0, 'approach')
