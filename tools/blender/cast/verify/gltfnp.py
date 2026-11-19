"""Independent pure-numpy glTF reader + linear-blend skinning for the cast review (does NOT reuse lib/)."""
from __future__ import annotations

import json
import struct

import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Glb:
    def __init__(self, path: str):
        data = open(path, 'rb').read()
        magic, _v, ln = struct.unpack('<III', data[:12])
        assert magic == 0x46546C67 and ln == len(data), path
        off = 12
        self.js, self.bin = None, b''
        while off < len(data):
            cl, ct = struct.unpack('<II', data[off:off + 8])
            ch = data[off + 8:off + 8 + cl]
            if ct == 0x4E4F534A:
                self.js = json.loads(ch)
            elif ct == 0x004E4942:
                self.bin = ch
            off += 8 + cl
        self.nodes = self.js['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self.byname = {n.get('name'): i for i, n in enumerate(self.nodes)}

    def acc(self, idx: int) -> np.ndarray:
        a = self.js['accessors'][idx]
        bv = self.js['bufferViews'][a['bufferView']]
        dt = np.dtype(COMP[a['componentType']])
        n = NC[a['type']]
        st = bv.get('byteStride', 0)
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        item = dt.itemsize * n
        if st and st != item:
            raw = np.frombuffer(self.bin, np.uint8, count=st * a['count'], offset=start).reshape(a['count'], st)
            out = raw[:, :item].copy().view(dt).reshape(a['count'], n)
        else:
            out = np.frombuffer(self.bin, dt, count=a['count'] * n, offset=start).reshape(a['count'], n)
        out = out.astype(np.float64) if dt.kind == 'f' else out.astype(np.int64)
        if a.get('normalized'):
            out = out / float(np.iinfo(dt).max)
        return out

    def image_bytes(self, i: int) -> bytes:
        im = self.js['images'][i]
        bv = self.js['bufferViews'][im['bufferView']]
        o = bv.get('byteOffset', 0)
        return self.bin[o:o + bv['byteLength']]

    def anim(self, name: str):
        return next((a for a in self.js.get('animations', []) if a['name'] == name), None)


def qmat(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def trs(t, q, s=(1, 1, 1)) -> np.ndarray:
    M = np.eye(4)
    M[:3, :3] = qmat(q) * np.asarray(s, float)
    M[:3, 3] = t
    return M


class Clips:
    """Samples zombie.glb clips (LINEAR / STEP; quaternions nlerp'd on the short arc)."""

    def __init__(self, z: Glb):
        self.z = z
        self.cache = {}

    def duration(self, name: str) -> float:
        a = self.z.anim(name)
        return max(self.z.js['accessors'][s['input']]['max'][0] for s in a['samplers'])

    def tracks(self, name: str) -> dict:
        if name in self.cache:
            return self.cache[name]
        a = self.z.anim(name)
        out = {}
        for ch in a['channels']:
            node = self.z.nodes[ch['target']['node']].get('name')
            s = a['samplers'][ch['sampler']]
            out[(node, ch['target']['path'])] = (self.z.acc(s['input'])[:, 0], self.z.acc(s['output']),
                                                 s.get('interpolation', 'LINEAR'))
        self.cache[name] = out
        return out

    def sample(self, name: str, node: str, path: str, t: float):
        tr = self.tracks(name).get((node, path))
        if tr is None:
            return None
        times, vals, interp = tr
        if interp == 'CUBICSPLINE':
            vals = vals.reshape(len(times), 3, -1)[:, 1]
        if t <= times[0]:
            return vals[0].copy()
        if t >= times[-1]:
            return vals[-1].copy()
        i = int(np.searchsorted(times, t, side='right') - 1)
        if interp == 'STEP':
            return vals[i].copy()
        f = (t - times[i]) / (times[i + 1] - times[i])
        a, b = vals[i], vals[i + 1]
        if path == 'rotation':
            if np.dot(a, b) < 0:
                b = -b
            v = a * (1 - f) + b * f
            return v / np.linalg.norm(v)
        return a * (1 - f) + b * f


def world_mats(g: Glb, local: dict) -> dict:
    W = {}

    def w(i):
        if i in W:
            return W[i]
        m = local[i]
        if i in g.parent:
            m = w(g.parent[i]) @ m
        W[i] = m
        return m
    for i in range(len(g.nodes)):
        w(i)
    return W


def rest_local(g: Glb) -> dict:
    out = {}
    for i, n in enumerate(g.nodes):
        if 'matrix' in n:
            out[i] = np.array(n['matrix']).reshape(4, 4).T
        else:
            out[i] = trs(n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]), n.get('scale', [1, 1, 1]))
    return out


class SkinnedMesh:
    """One skinned primitive set (all primitives of one mesh node)."""

    def __init__(self, g: Glb, mesh_node: int, skin: int | None = None):
        self.g = g
        n = g.nodes[mesh_node]
        self.node = mesh_node
        self.skin = g.js['skins'][n['skin'] if skin is None else skin]
        self.joints_nodes = self.skin['joints']
        self.ibm = g.acc(self.skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        P, J, Wt, UV, I, mats = [], [], [], [], [], []
        base = 0
        for p in g.js['meshes'][n['mesh']]['primitives']:
            a = p['attributes']
            pos = g.acc(a['POSITION'])
            P.append(pos)
            J.append(g.acc(a['JOINTS_0']))
            Wt.append(g.acc(a['WEIGHTS_0']))
            UV.append(g.acc(a['TEXCOORD_0']) if 'TEXCOORD_0' in a else np.zeros((len(pos), 2)))
            I.append(g.acc(p['indices']).reshape(-1, 3) + base)
            mats.append(p.get('material'))
            base += len(pos)
        self.pos = np.concatenate(P)
        self.jnt = np.concatenate(J)
        self.wt = np.concatenate(Wt)
        self.uv = np.concatenate(UV)
        self.tri = np.concatenate(I)
        self.material = mats[0]
        self.jnames = [g.nodes[j]['name'] for j in self.joints_nodes]

    def skin_with(self, W: dict) -> np.ndarray:
        S = np.stack([W[j] @ self.ibm[k] for k, j in enumerate(self.joints_nodes)])   # (J,4,4)
        out = np.zeros_like(self.pos)
        ph = np.concatenate([self.pos, np.ones((len(self.pos), 1))], 1)
        for k in range(4):
            M = S[self.jnt[:, k]]                                   # (N,4,4)
            out += self.wt[:, k:k + 1] * np.einsum('nij,nj->ni', M, ph)[:, :3]
        return out

    def dominant_joint(self) -> np.ndarray:
        return self.jnt[np.arange(len(self.jnt)), self.wt.argmax(1)]
