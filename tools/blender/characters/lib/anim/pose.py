"""Semantic pose container with FK, analytic two-bone IK, blending and mirroring.

A Pose stores per-bone semantic rotations (degrees, see skeleton.py) and optional explicit matrices produced by
IK, plus a pelvis offset in armature space. Everything is pure mathutils, deterministic and side-effect free.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Quaternion, Vector

from ..skeleton import ORDER, Skeleton, base_kind, euler_matrix, mirror_name

V = Vector
TAU = 2 * math.pi


def osc(t: float, period: float, phase: float = 0.0) -> float:
    return math.sin(TAU * (t / period + phase))


def cosc(t: float, period: float, phase: float = 0.0) -> float:
    return math.cos(TAU * (t / period + phase))


def ease(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def ease_in(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x ** 3


def keyed(t: float, pts: list[tuple[float, float]], smooth: bool = True) -> float:
    """Piecewise interpolation through (time, value) pairs (eased between keys)."""
    if t <= pts[0][0]:
        return pts[0][1]
    for i in range(len(pts) - 1):
        t0, v0 = pts[i]
        t1, v1 = pts[i + 1]
        if t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            return v0 + (v1 - v0) * (ease(u) if smooth else u)
    return pts[-1][1]


def pulse(t: float, period: float, at: float, width: float) -> float:
    """Periodic smooth bump (0..1) centred at phase `at` (0..1) with half-width `width` (phase units)."""
    ph = (t / period - at) % 1.0
    if ph > 0.5:
        ph -= 1.0
    x = abs(ph) / width
    return 0.0 if x >= 1 else 0.5 * (1 + math.cos(math.pi * x))


class Pose:
    def __init__(self, sk: Skeleton):
        self.sk = sk
        self.rot: dict[str, list[float]] = {}
        self.mat: dict[str, Matrix] = {}
        self.loc = V((0.0, 0.0, 0.0))

    # ---------------------------------------------------------------- authoring
    def r(self, bone: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> 'Pose':
        cur = self.rot.setdefault(bone, [0.0, 0.0, 0.0])
        cur[0] += x
        cur[1] += y
        cur[2] += z
        self.mat.pop(bone, None)
        return self

    def side(self, base: str, s: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> 'Pose':
        """Author in LEFT-side semantics; for s == 'R' the values are mirrored (x, -y, -z)."""
        if s == 'L':
            return self.r(base + '_L', x, y, z)
        return self.r(base + '_R', x, -y, -z)

    def sym(self, base: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> 'Pose':
        self.side(base, 'L', x, y, z)
        self.side(base, 'R', x, y, z)
        return self

    def move(self, dx: float = 0.0, dy: float = 0.0, dz: float = 0.0) -> 'Pose':
        self.loc = self.loc + V((dx, dy, dz))
        return self

    def set_matrix(self, bone: str, m: Matrix) -> None:
        self.mat[bone] = m
        self.rot.pop(bone, None)

    def matrices(self) -> dict[str, Matrix]:
        out = {}
        for n in self.sk.order:
            if n in self.mat:
                out[n] = self.mat[n]
            elif n in self.rot:
                rx, ry, rz = self.rot[n]
                out[n] = euler_matrix(rx, ry, rz, ORDER[base_kind(n)])
            else:
                out[n] = Matrix.Identity(3)
        return out

    def fk(self):
        return self.sk.fk(self.matrices(), self.loc)

    def copy(self) -> 'Pose':
        p = Pose(self.sk)
        p.rot = {k: list(v) for k, v in self.rot.items()}
        p.mat = {k: m.copy() for k, m in self.mat.items()}
        p.loc = self.loc.copy()
        return p

    # ---------------------------------------------------------------- IK
    def leg_ik(self, s: str, ankle: Vector, foot_pitch: float = 0.0, foot_yaw: float = 0.0,
               foot_roll: float = 0.0, knee_out: float = 0.0) -> None:
        """Place the ankle of leg `s` at `ankle` (armature space). Foot orientation is given in world terms
        (pitch + = toe down, yaw + = toe turns to the character's left, roll + = sole tilts outward-left)."""
        sk = self.sk
        th, sh, ft = 'thigh_' + s, 'shin_' + s, 'foot_' + s
        self.mat.pop(th, None)
        self.rot.pop(th, None)
        self.mat.pop(sh, None)
        self.rot.pop(sh, None)
        wr, wh = self.fk()
        P = wr['pelvis']
        hip = wh[th]
        L1 = (sk.head[sh] - sk.head[th]).length
        L2 = (sk.head[ft] - sk.head[sh]).length
        dv = V(ankle) - hip
        d = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, dv.length))
        a = math.acos(max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
        t_local = P.inverted() @ dv.normalized()
        fwd = V((0.0, -1.0, 0.0))
        axis = t_local.cross(fwd)
        if axis.length < 1e-6:
            axis = V((-1.0, 0.0, 0.0))
        axis.normalize()
        if knee_out:
            sgn = 1.0 if s == 'L' else -1.0
            axis = (Matrix.Rotation(math.radians(knee_out * sgn), 3, t_local) @ axis).normalized()
        thigh_dir = Matrix.Rotation(a, 3, axis) @ t_local
        rest_t = sk.rest_dir[th]
        R_th = rest_t.rotation_difference(thigh_dir).to_matrix()
        self.mat[th] = R_th
        wr, wh = self.fk()
        knee = wh[sh]
        sdir = (V(ankle) - knee)
        if sdir.length < 1e-6:
            sdir = wr[th] @ sk.rest_dir[sh]
        s_local = (wr[th]).inverted() @ sdir.normalized()
        R_sh = sk.rest_dir[sh].rotation_difference(s_local).to_matrix()
        self.mat[sh] = R_sh
        wr, wh = self.fk()
        F = (Matrix.Rotation(math.radians(foot_yaw), 3, 'Z') @ Matrix.Rotation(math.radians(foot_pitch), 3, 'X')
             @ Matrix.Rotation(math.radians(foot_roll), 3, 'Y'))
        self.set_matrix(ft, wr[sh].inverted() @ F)

    def arm_ik(self, s: str, wrist: Vector, pole: Vector, hand_world: Matrix | None = None,
               twist: float = 0.0) -> None:
        """Place the wrist of arm `s` at `wrist`; elbow bends toward `pole` (direction from the shoulder joint)."""
        sk = self.sk
        ua, fa, hd = 'upperarm_' + s, 'forearm_' + s, 'hand_' + s
        for b in (ua, fa):
            self.mat.pop(b, None)
            self.rot.pop(b, None)
        wr, wh = self.fk()
        S = wh[ua]
        par = wr['shoulder_' + s]
        L1 = (sk.head[fa] - sk.head[ua]).length
        L2 = (sk.head[hd] - sk.head[fa]).length
        dv = V(wrist) - S
        d = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, dv.length))
        u = dv.normalized()
        a = math.acos(max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
        pp = V(pole) - u * V(pole).dot(u)
        if pp.length < 1e-6:
            pp = V((0.0, 0.0, -1.0)) - u * (-u.z)
        pp.normalize()
        elbow = S + (u * math.cos(a) + pp * math.sin(a)) * L1
        a_dir = (elbow - S).normalized()
        local = par.inverted() @ a_dir
        R_ua = sk.rest_dir[ua].rotation_difference(local).to_matrix()
        if twist:
            R_ua = Matrix.Rotation(math.radians(twist), 3, local) @ R_ua
        self.mat[ua] = R_ua
        wr, wh = self.fk()
        f_dir = (V(wrist) - wh[fa])
        if f_dir.length < 1e-6:
            f_dir = a_dir
        f_local = wr[ua].inverted() @ f_dir.normalized()
        R_fa = sk.rest_dir[fa].rotation_difference(f_local).to_matrix()
        self.mat[fa] = R_fa
        if hand_world is not None:
            wr, wh = self.fk()
            self.set_matrix(hd, wr[fa].inverted() @ hand_world)

    # ---------------------------------------------------------------- utils
    def world_rot(self, bone: str) -> Matrix:
        wr, _ = self.fk()
        return wr[bone]

    def quats(self) -> dict[str, Quaternion]:
        return {n: m.to_quaternion() for n, m in self.matrices().items()}

    def mirrored(self) -> 'Pose':
        out = Pose(self.sk)
        M = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
        for n, m in self.matrices().items():
            out.mat[mirror_name(n)] = M @ m @ M
        out.loc = V((-self.loc.x, self.loc.y, self.loc.z))
        return out


def blend(a: Pose, b: Pose, t: float) -> Pose:
    """Slerp every bone rotation and lerp the pelvis offset."""
    out = Pose(a.sk)
    qa, qb = a.quats(), b.quats()
    for n in a.sk.order:
        q1, q2 = qa[n], qb[n]
        if q1.dot(q2) < 0:
            q2 = -q2
        out.mat[n] = q1.slerp(q2, t).to_matrix()
    out.loc = a.loc.lerp(b.loc, t)
    return out
