"""Prop placement shared by the clips (where the hands go) and the carry anchors (where the carried items go).

Everything is in Blender armature space for a posed `Pose`. Item frames follow the runtime carry convention:
item +X / +Y / +Z are given as Blender vectors (an unrotated item has +Y = Blender +Z (up) and +Z = Blender -Y
(the character's front)), with the item origin as documented per item in src/render/characters/carry.ts.
"""
from __future__ import annotations

from mathutils import Vector

from ..face import HC
from ..skeleton import PALM_LIFT, PALM_OFFSET
from .base import sgn
from .pose import Pose

V = Vector

# rest-pose head landmarks (armature space, relative to the head centre); posed through the head bone with head_pt()
_HZ = HC.z
MOUTH = (0.0, -0.17, _HZ - 0.092)
EAR_R = (-0.165, -0.01, _HZ - 0.012)
EAR_L = (0.165, -0.01, _HZ - 0.012)
CHIN = (0.0, -0.13, _HZ - 0.152)
EYES = (0.0, -0.15, _HZ + 0.003)
HEAD_CENTRE = (0.0, -0.012, _HZ)
MOUTH_CORNER_R = (-0.06, -0.15, _HZ - 0.107)

FORK_LEN = 0.15                          # fork origin (in the fist) -> tine tips
FORK_GRIP = 0.012                        # fork origin beyond the palm centre, along the fingers
FORK_REACH = PALM_OFFSET + FORK_GRIP + FORK_LEN
PHONE_SIZE = (0.054, 0.026, 0.13)        # carried phone: width (item x), thickness (y), length (z)
PHONE_GAP = 0.016                        # skin -> inner face of the phone held to the ear
BOOK_OPEN_W = 0.27                       # open book: total width across both pages


def head_pt(p: Pose, rest_point) -> Vector:
    wr, wh = p.fk()
    return wh['head'] + wr['head'] @ (V(rest_point) - p.sk.head['head'])


def _palm_basis(sk, s: str):
    a0 = sk.rest_dir['hand_' + s].normalized()
    w0 = V((-sgn(s), 0.0, 0.0))
    w0 = (w0 - a0 * w0.dot(a0)).normalized()
    return a0, w0


def palm_point(p: Pose, s: str, wr=None, wh=None) -> Vector:
    """World position of the palm-surface centre of hand `s` in pose p."""
    if wr is None:
        wr, wh = p.fk()
    a0, w0 = _palm_basis(p.sk, s)
    R = wr['hand_' + s]
    return wh['hand_' + s] + (R @ a0) * PALM_OFFSET + (R @ w0) * PALM_LIFT


def wrist_for_palm(palm_pos: Vector, fingers: Vector, palm_dir: Vector) -> Vector:
    """Wrist that puts the palm centre on palm_pos for a hand oriented (fingers, palm normal)."""
    a = V(fingers).normalized()
    w = V(palm_dir) - a * V(palm_dir).dot(a)
    w = w.normalized() if w.length > 1e-6 else V((0.0, 0.0, -1.0))
    return V(palm_pos) - a * PALM_OFFSET - w * PALM_LIFT


def wrist_for_fork_tip(tip: Vector, fingers: Vector, palm_dir: Vector) -> Vector:
    """Wrist that puts the tines of a fork held along the fingers on `tip`."""
    a = V(fingers).normalized()
    w = V(palm_dir) - a * V(palm_dir).dot(a)
    w = w.normalized() if w.length > 1e-6 else V((0.0, 0.0, -1.0))
    return V(tip) - a * FORK_REACH - w * PALM_LIFT


def _orthonormal_frame(y: Vector, z_hint: Vector):
    """Right-handed (x, y, z) with item +Y = y and item +Z as close to z_hint as possible."""
    y = V(y).normalized()
    z = V(z_hint) - y * V(z_hint).dot(y)
    z.normalize()
    x = y.cross(z)
    return x, y, z


def phone_frame(p: Pose):
    """Phone pressed to the RIGHT ear: (centre, x, y, z) with item +Z = long axis (mouthpiece -> earpiece),
    item +Y = screen normal facing the cheek, so the chunky back and the antenna face the camera."""
    ear = head_pt(p, EAR_R)
    mouth = head_pt(p, MOUTH_CORNER_R)
    centre_head = head_pt(p, HEAD_CENTRE)
    long_axis = (ear - mouth).normalized()
    mid = ear.lerp(mouth, 0.45)
    out = mid - centre_head
    out = (out - long_axis * out.dot(long_axis)).normalized()
    centre = mid + out * (PHONE_GAP + PHONE_SIZE[1] * 0.5)
    x, y, z = _orthonormal_frame(-out, long_axis)
    return centre, x, y, z, out


def phone_hand(p: Pose):
    """(wrist, fingers, palm normal) that cups the phone_frame() phone against the ear with the right hand."""
    centre, x, y, z, out = phone_frame(p)
    fingers = z + V((0.0, 0.0, 0.6))                                # up the back of the phone, toward the ear
    fingers = (fingers - out * fingers.dot(out)).normalized()       # ...staying in the phone's back plane
    palm_dir = -out                                                 # palm on the phone's back, toward the head
    back = centre + out * (PHONE_SIZE[1] * 0.5) - z * 0.012
    return wrist_for_palm(back, fingers, palm_dir), fingers, palm_dir


def book_frame(p: Pose):
    """Open book held between both palms facing the reader: (centre, x, y, z) with item +Y = page normal toward
    the eyes, item +Z = toward the top edge, origin at the centre of the spine."""
    wr, wh = p.fk()
    c = (palm_point(p, 'L', wr, wh) + palm_point(p, 'R', wr, wh)) * 0.5
    eyes = head_pt(p, EYES)
    n = (eyes - c).normalized()
    x = V((1.0, 0.0, 0.0))
    x = (x - n * x.dot(n)).normalized()
    z = x.cross(n)
    return c + n * 0.014, x, n, z


def plate_frame(p: Pose, s: str = 'L'):
    """Plate resting level on the upturned palm of hand `s`, its centre toward the body midline:
    (centre of the plate bottom, x, y, z)."""
    pp = palm_point(p, s)
    centre = pp + V((-sgn(s) * 0.06, -0.012, 0.004))
    return centre, V((1.0, 0.0, 0.0)), V((0.0, 0.0, 1.0)), V((0.0, -1.0, 0.0))
