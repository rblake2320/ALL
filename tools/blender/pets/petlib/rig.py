"""Bone tables, semantic FK, planar two-bone leg IK and armature creation.

Semantic rotation convention (same as the zombie rig): each bone's rotation is expressed in armature-aligned
axes, applied about the bone head, relative to its parent as if the parent were at rest.
  +X rotation: a forward-pointing bone (spine, neck, head, jaw) tips its nose DOWN; a backward-pointing bone
               (tail) lifts its tip UP; a downward bone (leg) swings its foot BACKWARD.
  +Z rotation: turns the front toward the pet's LEFT (+X).
  +Y rotation: rolls (left side down for a forward-pointing bone).
Blender pose basis = B^-1 * R * B with B the bone's rest orientation.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

V = Vector
LEGS_QUAD = ('F_L', 'F_R', 'H_L', 'H_R')
LEGS_BIRD = ('H_L', 'H_R')


def rx(a: float) -> Matrix:
    return Matrix.Rotation(math.radians(a), 3, 'X')


def ry(a: float) -> Matrix:
    return Matrix.Rotation(math.radians(a), 3, 'Y')


def rz(a: float) -> Matrix:
    return Matrix.Rotation(math.radians(a), 3, 'Z')


def euler(r) -> Matrix:
    """(rx, ry, rz) degrees -> matrix applying X first, then Y, then Z. Matrices pass through."""
    if isinstance(r, Matrix):
        return r
    return rz(r[2]) @ ry(r[1]) @ rx(r[0])


def quad_table(sp: dict) -> list[tuple]:
    H, L = sp['H'], sp['L']
    hb = H + 0.30 * sp['body_h']                 # body centre line
    yb, yf = L / 2, -L / 2                       # hips (back), shoulders (front)
    nb = V((0.0, yf - 0.012, hb + 0.020))        # neck base
    hd = nb + V((0.0, -sp['neck_fwd'], sp['neck_up']))   # head joint
    hr = sp['head']
    hc = hd + V((0.0, -0.45 * hr[1], 0.10 * hr[2]))      # head centre
    t0 = V((0.0, yb + 0.80 * sp['body_w'], hb + 0.25 * sp['body_h']))
    seg = sp['tail_len'] / 3
    rise = sp['tail_rise']
    td = [V((0.0, math.cos(rise + i * sp['tail_curl']), math.sin(rise + i * sp['tail_curl']))) for i in range(3)]
    t1, t2, t3 = t0 + td[0] * seg, t0 + td[0] * seg + td[1] * seg, t0 + (td[0] + td[1] + td[2]) * seg
    sx = sp['stance']
    ph = max(0.55 * sp['paw_r'], 0.98 * sp['leg_r'])   # ankle height: a folded shin lying flat stays above the floor
    rows = [
        ('root', (0, 0, 0), (0, 0, 0.08), None),
        ('hips', (0, yb, hb), (0, L / 6, hb), 'root'),
        ('spine', (0, L / 6, hb), (0, -L / 6, hb), 'hips'),
        ('chest', (0, -L / 6, hb), (0, yf, hb), 'spine'),
        ('neck', tuple(nb), tuple(hd), 'chest'),
        ('head', tuple(hd), tuple(hd + V((0, -0.9 * hr[1], 0))), 'neck'),
        ('jaw', tuple(hc + V((0, -0.55 * hr[1], -0.42 * hr[2]))),
         tuple(hc + V((0, -hr[1] - 0.8 * sp['snout_len'], -0.42 * hr[2] - sp['snout_drop']))), 'head'),
        ('tail_1', tuple(t0), tuple(t1), 'hips'),
        ('tail_2', tuple(t1), tuple(t2), 'tail_1'),
        ('tail_3', tuple(t2), tuple(t3), 'tail_2'),
    ]
    ear_base = hc + V((sp['ear_x'], 0.10 * hr[1], 0.72 * hr[2]))
    if sp['ear'] == 'flop':
        ear_tip = ear_base + V((0.030, 0.0, -sp['ear_h']))
    else:
        ear_tip = ear_base + V((0.010, 0.0, sp['ear_h']))
    side = [
        ('ear_L', tuple(ear_base), tuple(ear_tip), 'head'),
        # front leg: elbow slightly back; hind leg: knee forward, hock back
        ('upper_F_L', (sx, yf + 0.010, H), (sx, yf + 0.030, 0.50 * H), 'chest'),
        ('lower_F_L', (sx, yf + 0.030, 0.50 * H), (sx, yf + 0.004, ph), 'upper_F_L'),
        ('paw_F_L', (sx, yf + 0.004, ph), (sx, yf - 1.2 * sp['paw_r'], 0.4 * ph), 'lower_F_L'),
        ('upper_H_L', (sx, yb - 0.010, H), (sx, yb - 0.038, 0.52 * H), 'hips'),
        ('lower_H_L', (sx, yb - 0.038, 0.52 * H), (sx, yb + 0.010, ph), 'upper_H_L'),
        ('paw_H_L', (sx, yb + 0.010, ph), (sx, yb - 1.2 * sp['paw_r'] + 0.006, 0.4 * ph), 'lower_H_L'),
    ]
    return rows + _mirrored(side)


def bird_table(sp: dict) -> list[tuple]:
    H = sp['H']
    bl = sp['body_len']
    p = math.radians(sp['body_pitch'])
    fwd = V((0.0, -math.cos(p), math.sin(p)))    # chest is higher than the rump
    hips = V((0.0, 0.020, H + 0.030))
    chest = hips + fwd * (0.55 * bl)
    rump = hips - fwd * (0.40 * bl)
    hd = chest + V((0.0, -0.012, 0.040))
    sx = sp['stance']
    rows = [
        ('root', (0, 0, 0), (0, 0, 0.05), None),
        ('hips', tuple(hips), tuple(chest), 'root'),
        ('neck', tuple(chest), tuple(hd), 'hips'),
        ('head', tuple(hd), tuple(hd + V((0, -sp['head_r'] * 1.4, 0))), 'neck'),
        ('jaw', tuple(hd + V((0, -0.85 * sp['head_r'], -0.006))),
         tuple(hd + V((0, -0.85 * sp['head_r'] - 0.8 * sp['beak_len'], -0.012))), 'head'),
        ('tail_1', tuple(rump), tuple(rump - fwd * sp['tail_len'] + V((0, 0, -0.004))), 'hips'),
    ]
    sh = chest + V((sx + 0.016, 0.020, 0.012))
    back = V((0.0, math.cos(p * 0.6), -math.sin(p * 0.6)))
    mid = sh + back * (0.5 * sp['wing_len'])
    tip = sh + back * sp['wing_len'] + V((-0.006, 0, -0.004))
    side = [
        ('wing_1_L', tuple(sh), tuple(mid), 'hips'),
        ('wing_2_L', tuple(mid), tuple(tip), 'wing_1_L'),
        ('upper_H_L', (sx, 0.014, H), (sx, 0.034, 0.52 * H), 'hips'),
        ('lower_H_L', (sx, 0.034, 0.52 * H), (sx, 0.012, 0.008), 'upper_H_L'),
        ('paw_H_L', (sx, 0.012, 0.008), (sx, 0.012 - sp['toe_len'], 0.004), 'lower_H_L'),
    ]
    return rows + _mirrored(side)


def _mirrored(side: list[tuple]) -> list[tuple]:
    out = list(side)
    for n, h, t, p in side:
        pn = p[:-2] + '_R' if p.endswith('_L') else p
        out.append((n[:-2] + '_R', (-h[0], h[1], h[2]), (-t[0], t[1], t[2]), pn))
    return out


class Pose:
    def __init__(self):
        self.rot: dict[str, object] = {}
        self.loc = V((0.0, 0.0, 0.0))      # hips offset, armature space


class Rig:
    """Rest data + semantic FK + leg IK (pure mathutils)."""

    def __init__(self, sp: dict):
        self.sp = sp
        self.plan = sp['plan']
        self.table = quad_table(sp) if self.plan == 'quad' else bird_table(sp)
        self.order = [r[0] for r in self.table]
        self.head = {n: V(h) for n, h, _, _ in self.table}
        self.tail = {n: V(t) for n, _, t, _ in self.table}
        self.parent = {n: p for n, _, _, p in self.table}
        self.legs = LEGS_QUAD if self.plan == 'quad' else LEGS_BIRD

    # ------------------------------------------------------------------ FK
    def fk(self, pose: Pose) -> tuple[dict, dict]:
        wr: dict[str, Matrix] = {}
        wh: dict[str, Vector] = {}
        for n in self.order:
            p = self.parent[n]
            R = euler(pose.rot.get(n, (0.0, 0.0, 0.0)))
            if p is None:
                wr[n], wh[n] = R, self.head[n].copy()
            else:
                wr[n] = wr[p] @ R
                wh[n] = wh[p] + wr[p] @ (self.head[n] - self.head[p])
                if n == 'hips':
                    wh[n] = wh[n] + pose.loc
        return wr, wh

    def ankle_rest(self, leg: str) -> Vector:
        return self.tail['lower_' + leg].copy()

    # ------------------------------------------------------------------ IK
    def place_foot(self, pose: Pose, leg: str, dy: float = 0.0, dz: float = 0.0, toe: float = 0.0) -> None:
        """Rotate upper/lower/paw of `leg` so the ankle lands at its rest position + (dy, dz).

        Planar (YZ) analytic two-bone IK. The leg's ancestors must already be posed, and should carry X
        rotations only (their pitch is read from the world matrix). `toe` pitches the paw (+ = toes down).
        """
        up, lo, paw = 'upper_' + leg, 'lower_' + leg, 'paw_' + leg
        for b in (up, lo, paw):
            pose.rot.pop(b, None)
        wr, wh = self.fk(pose)
        par = wr[self.parent[up]]
        a_par = math.atan2(par[2][1], par[1][1])
        J = wh[up]
        T = self.ankle_rest(leg) + V((0.0, dy, dz))
        d1, d2 = self.tail[up] - self.head[up], self.tail[lo] - self.head[lo]
        l1, l2 = math.hypot(d1.y, d1.z), math.hypot(d2.y, d2.z)
        ty, tz = T.y - J.y, T.z - J.z
        d = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, math.hypot(ty, tz)))
        psi = math.atan2(tz, ty)
        alpha = math.acos(max(-1.0, min(1.0, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
        # which way the middle joint points: front elbows back (+Y), hind knees forward (-Y), bird "knees" back
        want_fwd = leg.startswith('H') and self.plan == 'quad'
        # a middle joint should not dip below this (crouched poses): the leg's own thickness above the floor
        floor = max(self.tail[lo].z + 0.004, 1.25 * self.sp['leg_r'])
        cands = []
        for s in (1.0, -1.0):
            phi_u = psi + s * alpha
            ky, kz = J.y + l1 * math.cos(phi_u), J.z + l1 * math.sin(phi_u)
            phi_l = math.atan2((J.z + math.sin(psi) * d) - kz, (J.y + math.cos(psi) * d) - ky)
            cands.append((phi_u, phi_l, ky, kz))
        a, b = cands
        pick = a if (a[2] < b[2]) == want_fwd else b
        other = b if pick is a else a
        if pick[3] < floor and other[3] > pick[3]:
            pick = other
        phi_u, phi_l = pick[0], pick[1]
        a_u = _wrap(phi_u - math.atan2(d1.z, d1.y))
        a_l = _wrap(phi_l - math.atan2(d2.z, d2.y))
        pose.rot[up] = (math.degrees(_wrap(a_u - a_par)), 0.0, 0.0)
        pose.rot[lo] = (math.degrees(_wrap(a_l - a_u)), 0.0, 0.0)
        pose.rot[paw] = (math.degrees(_wrap(-a_l)) + toe, 0.0, 0.0)


def _wrap(a: float) -> float:
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def ensure_armature(rig: Rig, name: str = 'Rig'):
    import bpy

    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = data.edit_bones
    for n, h, t, p in rig.table:
        b = eb.new(n)
        b.head, b.tail, b.roll = h, t, 0.0
        if p:
            b.parent = eb[p]
        b.use_connect = False
        b.use_deform = n != 'root'
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm
