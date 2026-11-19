"""Texture work: pick the source maps, resize, build the runtime 'Body' material, and - for the 'turned' category -
zombify human skin in the base colour.

Zombify (deterministic, no randomness):
  1. rasterise every triangle of the (decimated, re-posed, normalised) mesh into UV space -> per texel: triangle id +
     barycentrics -> 3D surface position (so noise is seamless across UV islands) + owning bone
  2. reference skin colour = robust median of the cheek texels (triangles just below / beside the eye landmarks,
     facing front); skin mask = texels close to it in hue / saturation / value (soft membership), restricted to
     texels covered by the mesh, then dilated a little into the island padding so mip-mapping never shows the
     old colour along seams
  3. masked texels -> grey-green corpse tone keeping the painted shading (value ratio), with low-frequency 3D bruise
     blotches (purple-grey), faint veins (ridged noise) and darker sunken eye sockets around the eye landmarks
Clothes are untouched by construction (mask = colour AND coverage AND a per-body hue window).
"""
from __future__ import annotations

import math

import bpy
import numpy as np

from .config import TEX_MAX


# ------------------------------------------------------------------------------------------------ source maps
def source_maps(ob) -> dict:
    """{'base': img, 'orm': img|None, 'normal': img|None} from the imported principled material."""
    mat = ob.data.materials[0]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    out = {'base': None, 'orm': None, 'normal': None}

    def upstream_image(sock):
        if not sock.is_linked:
            return None
        n = sock.links[0].from_node
        seen = 0
        while n.type != 'TEX_IMAGE' and seen < 8:
            ins = [i for i in n.inputs if i.is_linked]
            if not ins:
                return None
            n = ins[0].links[0].from_node
            seen += 1
        return n.image if n.type == 'TEX_IMAGE' else None

    out['base'] = upstream_image(bsdf.inputs['Base Color'])
    out['orm'] = upstream_image(bsdf.inputs['Roughness']) or upstream_image(bsdf.inputs['Metallic'])
    out['normal'] = upstream_image(bsdf.inputs['Normal'])
    if out['base'] is None:
        raise RuntimeError('source material has no base colour texture')
    return out


def pixels(img) -> np.ndarray:
    W, H = img.size
    a = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(H, W, 4)


def new_image(name: str, arr: np.ndarray, non_color: bool):
    H, W = arr.shape[:2]
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    a = np.ones((H, W, 4), np.float32)
    a[..., :arr.shape[2]] = arr[..., :4] if arr.shape[2] >= 3 else arr
    a[..., 3] = 1.0
    img.pixels.foreach_set(a.ravel())
    img.update()
    return img


def resized(arr: np.ndarray, size: int) -> np.ndarray:
    """Box-filter downscale by an integer factor (deterministic, no Blender scaler)."""
    H, W = arr.shape[:2]
    if W <= size and H <= size:
        return arr
    f = max(W // size, H // size)
    return arr[:H // f * f, :W // f * f].reshape(H // f, f, W // f, f, -1).mean((1, 3)).astype(np.float32)


# ------------------------------------------------------------------------------------------------ raster
def rasterize(ob, W: int, H: int):
    """Per texel: triangle index (-1 = none) and barycentrics. Uses loop-triangles of the active UV map."""
    me = ob.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    loops = np.empty(nt * 3, np.int64)
    me.loop_triangles.foreach_get('loops', loops)
    loops = loops.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2, np.float64)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    P = uv[loops] * np.array([W, H]) - 0.5   # texel centres at integer coords
    tid = np.full((H, W), -1, np.int32)
    bary = np.zeros((H, W, 3), np.float32)
    for t in range(nt):
        a, b, c = P[t]
        x0 = max(0, int(math.floor(min(a[0], b[0], c[0])))); x1 = min(W - 1, int(math.ceil(max(a[0], b[0], c[0]))))
        y0 = max(0, int(math.floor(min(a[1], b[1], c[1])))); y1 = min(H - 1, int(math.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        px, py = xs - a[0], ys - a[1]
        l1 = (px * v1[1] - v1[0] * py) / den
        l2 = (v0[0] * py - px * v0[1]) / den
        l0 = 1 - l1 - l2
        eps = 0.5 / max(1.0, math.sqrt(abs(den)))
        m = (l0 >= -eps) & (l1 >= -eps) & (l2 >= -eps)
        if not m.any():
            continue
        tid[ys[m], xs[m]] = t
        bary[ys[m], xs[m]] = np.stack([l0[m], l1[m], l2[m]], -1)
    return tid, bary, loops


def surface_positions(ob, tid, bary, loops, co: np.ndarray) -> np.ndarray:
    me = ob.data
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    tv = lv[loops]                                  # (T, 3) vertex ids
    pos = np.zeros(tid.shape + (3,), np.float32)
    m = tid >= 0
    vv = tv[tid[m]]                                 # (N, 3)
    b = bary[m]
    pos[m] = (co[vv] * b[..., None]).sum(1)
    return pos


# ------------------------------------------------------------------------------------------------ colour helpers
def rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r); gm = nz & (mx == g) & ~rm; bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h = h / 6.0
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return np.stack([h, s, mx], -1)


def _hue_dist(a, b):
    d = np.abs(a - b)
    return np.minimum(d, 1 - d)


def _noise3(p: np.ndarray, freq: float, seed: float) -> np.ndarray:
    """Deterministic smooth pseudo-noise in [-1, 1] from a sum of rotated sines (no RNG)."""
    out = np.zeros(p.shape[:-1], np.float32)
    amp = 1.0
    tot = 0.0
    for k in range(4):
        a = seed * 1.7 + k * 2.39996
        d = np.array([math.cos(a) * math.sin(a * 1.3 + 0.5), math.sin(a) * math.sin(a * 1.3 + 0.5), math.cos(a * 1.3 + 0.5)])
        d2 = np.array([-d[1], d[2], d[0]])
        f = freq * (1.9 ** k)
        out += amp * np.sin((p @ d) * f + seed * 3.1 + k) * np.cos((p @ d2) * f * 0.77 + seed + 1.3 * k)
        tot += amp
        amp *= 0.5
    return out / tot


def _dilate(mask: np.ndarray, it: int) -> np.ndarray:
    m = mask.copy()
    for _ in range(it):
        n = m.copy()
        n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        m = n
    return m


def _blur(a: np.ndarray, it: int) -> np.ndarray:
    a = a.astype(np.float32)
    for _ in range(it):
        b = a.copy()
        b[1:] += a[:-1]; b[:-1] += a[1:]; b[:, 1:] += a[:, :-1]; b[:, :-1] += a[:, 1:]
        a = b / 5.0
    return a


CORPSE = np.array([0.56, 0.64, 0.50], np.float32)      # grey-green (sRGB), between SKIN_TONES #9fb88a / #8fa7a0
BRUISE = np.array([0.42, 0.36, 0.48], np.float32)      # purple-grey
VEIN = np.array([0.30, 0.38, 0.40], np.float32)
SOCKET = np.array([0.30, 0.27, 0.33], np.float32)


def zombify(base: np.ndarray, ob, co: np.ndarray, marks: dict, weights: dict, profile: dict, seed: float) -> dict:
    """base: (H, W, 4) sRGB floats (Blender pixel order, row 0 = v=0). Returns {'pixels', 'mask', 'ref', 'stats'}."""
    H, W = base.shape[:2]
    tid, bary, loops = rasterize(ob, W, H)
    covered = tid >= 0
    pos = surface_positions(ob, tid, bary, loops, co)
    rgb = base[..., :3]
    hsv = rgb_to_hsv(rgb)

    # per-triangle owner bone (dominant weight of its first vertex) -> per texel
    me = ob.data
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    tv = lv[loops]
    dom = weights['W'].argmax(1)
    tri_bone = dom[tv[:, 0]]
    bones = weights['bones']
    texel_bone = np.where(covered, tri_bone[np.maximum(tid, 0)], -1)

    # reference skin: cheek texels (below the eyes, between them +- one eye spacing, front facing)
    eL, eR = np.array(marks['eye_L']), np.array(marks['eye_R'])
    ec = (eL + eR) / 2
    d = float(np.linalg.norm(eL - eR))
    rel = pos - ec
    cheek = covered & (rel[..., 2] < -0.3 * d) & (rel[..., 2] > -0.75 * d) & (np.abs(rel[..., 0]) > 0.25 * d) & \
        (np.abs(rel[..., 0]) < 1.0 * d) & (rel[..., 1] < 0.2 * d)
    cheek &= (hsv[..., 2] > 0.25) & (hsv[..., 1] > 0.12)
    if cheek.sum() < 50:
        raise RuntimeError(f'too few cheek texels ({int(cheek.sum())}) to sample the skin colour')
    ch = hsv[cheek]
    # hue is circular but skin sits well away from the wrap (0.0-0.12); robust percentiles of the cheek texels
    ch = ch.copy()
    ch[:, 0] = (ch[:, 0] + 0.5) % 1.0          # skin hue (~0.03) away from the red wrap: work in shifted hue
    ref = np.median(ch, axis=0)
    h_lo, h_hi = np.percentile(ch[:, 0], [8, 92])
    s_lo, s_hi = np.percentile(ch[:, 1], [6, 94])
    v_lo = np.percentile(ch[:, 2], 6)
    pad_h = profile.get('skin_hue_pad', 0.006)
    h_lo, h_hi = h_lo - pad_h, h_hi + pad_h
    s_lo, s_hi = s_lo * profile.get('skin_sat_lo', 0.8), s_hi * profile.get('skin_sat_hi', 1.12)
    v_lo = v_lo * profile.get('skin_v_lo', 0.62)
    hh = (hsv[..., 0] + 0.5) % 1.0
    if 'skin_hue_max' in profile:                       # unshifted hue ceiling (straw / khaki next to skin hue)
        h_hi = min(h_hi, profile['skin_hue_max'] + 0.5)

    def window(hp, sl, sh, vl):
        m = np.clip(1.0 - np.maximum((h_lo - hp) - hh, hh - (h_hi + hp)) / 0.008, 0, 1)
        m *= np.clip(1.0 - np.maximum(s_lo * sl - hsv[..., 1], hsv[..., 1] - s_hi * sh) / 0.05, 0, 1)
        m *= np.clip((hsv[..., 2] - v_lo * vl) / 0.06 + 1, 0, 1)
        return m
    strict = window(0.0, 1.0, 1.0, 1.0)
    # hysteresis: shadowed / blushed skin (redder, darker, more saturated) joins when connected to strict skin
    loose = window(profile.get('skin_grow_hue', 0.02), profile.get('skin_grow_sat', 0.7), 1.35, 0.45) > 0.5
    member = strict.copy()
    grow = (strict > 0.5) & covered
    for _ in range(24):
        n = _dilate(grow, 1) & loose & covered
        if (n == grow).all():
            break
        grow = n
    member = np.maximum(member, grow.astype(np.float32))
    # per-body exclusions by owner bone (e.g. blonde hair or a straw hat sharing the skin hue)
    for rule in profile.get('skin_exclude', []):
        bi = [bones.index(b) for b in rule['bones'] if b in bones]
        m = np.isin(texel_bone, bi)
        if 'above_eyes' in rule:
            m &= rel[..., 2] > rule['above_eyes'] * d
        if 'behind' in rule:
            m &= (rel[..., 1] > rule['behind'] * d) & (np.abs(rel[..., 0]) < rule.get('behind_xmax', 0.9) * d)
        if 'rel_above' in rule:                         # only above this height relative to the eyes (x eye spacing)
            m &= rel[..., 2] > rule['rel_above'] * d
        if 'z_above' in rule:                           # absolute height (m, normalised body): e.g. shorts above the hem
            m &= pos[..., 2] > rule['z_above']
        if 'wide' in rule:
            m &= np.abs(rel[..., 0]) > rule['wide'] * d
        member[m] = 0
    member[~covered] = 0
    # keep only coherent skin: drop isolated specks (mostly clothes print) by a local-density test
    dens = _blur(member, 3)
    member *= np.clip((dens - 0.25) / 0.25, 0, 1) ** 0.5
    # spread into seam padding (uncovered texels next to skin) so mips never show the old colour
    grown = _blur(member, 2)
    pad = ~covered & (grown > 0.05)
    member = np.where(pad, np.clip(grown * 2.5, 0, 1), member)
    pos_p = pos.copy()
    if pad.any():
        # nearest covered position for the padding texels (cheap: blur positions weighted by coverage)
        w = covered.astype(np.float32)
        acc = pos * w[..., None]
        for _ in range(4):
            acc = _blur_vec(acc, 1); w = _blur(w, 1)
        pos_p[pad] = acc[pad] / np.maximum(w[pad], 1e-6)[..., None]

    # corpse tone with the painted shading kept
    v_ratio = np.clip(hsv[..., 2] / max(ref[2], 1e-3), 0.25, 1.35)[..., None]
    tone = CORPSE * v_ratio
    n1 = _noise3(pos_p, 9.0, seed)            # broad mottling
    n2 = _noise3(pos_p, 23.0, seed + 5.0)     # bruise blotches
    nv = np.abs(_noise3(pos_p, 55.0, seed + 11.0))
    tone = tone * (1.0 + 0.10 * n1[..., None])
    bruise = np.clip((n2 - 0.35) / 0.3, 0, 1)[..., None] * 0.45
    tone = tone * (1 - bruise) + BRUISE * v_ratio * bruise
    vein = np.clip((0.06 - nv) / 0.06, 0, 1)[..., None] * 0.30
    tone = tone * (1 - vein) + VEIN * v_ratio * vein
    # sunken eye sockets: darken skin around each eye landmark (falls off with 3D distance)
    sock = np.zeros((H, W), np.float32)
    for e in (eL, eR):
        r = np.linalg.norm(pos_p - e, axis=-1)
        sock = np.maximum(sock, np.clip(1.0 - (r - 0.28 * d) / (0.32 * d), 0, 1))
    sock = (sock * sock * (3 - 2 * sock))[..., None] * 0.65
    tone = tone * (1 - sock) + SOCKET * v_ratio * sock
    m = member[..., None]
    out = base.copy()
    out[..., :3] = np.clip(rgb * (1 - m) + tone * m, 0, 1)
    # lips / gums: desaturate strongly red texels near the mouth toward a bruised purple
    mouth = covered & (rel[..., 2] < -0.6 * d) & (rel[..., 2] > -1.6 * d) & (np.abs(rel[..., 0]) < 0.8 * d) & \
        (rel[..., 1] < 0.3 * d)
    lip = mouth & (_hue_dist(hsv[..., 0], 0.98) < 0.05) & (hsv[..., 1] > 0.35) & (member < 0.5)
    if lip.any():
        out[lip, :3] = out[lip, :3] * 0.45 + np.array([0.40, 0.25, 0.32]) * hsv[lip][:, 2:3] * 0.9
    # re-pad every UV island: uncovered texels take the average of their covered neighbours (16 px), so bilinear
    # filtering / mip-maps along seams never pull the old (human) colour back in
    filled = covered.copy()
    img = out[..., :3].copy()
    for _ in range(16):
        acc = np.zeros_like(img); cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh_f = np.roll(filled, (dy, dx), (0, 1)); sh_i = np.roll(img, (dy, dx), (0, 1))
            acc += sh_i * sh_f[..., None]; cnt += sh_f
        new_px = (~filled) & (cnt > 0)
        img[new_px] = acc[new_px] / cnt[new_px][..., None]
        filled |= new_px
    out[..., :3] = np.where(covered[..., None], out[..., :3], np.where(filled[..., None], img, out[..., :3]))
    stats = {'ref_hsv': [round(float(x), 3) for x in ref], 'cheek_texels': int(cheek.sum()),
             'window': [round(float(x), 3) for x in (h_lo, h_hi, s_lo, s_hi, v_lo)],
             'skin_fraction': round(float((member > 0.5).sum() / max(1, covered.sum())), 3),
             'lip_texels': int(lip.sum())}
    return {'pixels': out, 'mask': member, 'stats': stats}


def _blur_vec(a: np.ndarray, it: int) -> np.ndarray:
    for _ in range(it):
        b = a.copy()
        b[1:] += a[:-1]; b[:-1] += a[1:]; b[:, 1:] += a[:, :-1]; b[:, :-1] += a[:, 1:]
        a = b / 5.0
    return a


# ------------------------------------------------------------------------------------------------ material
def orm_has_occlusion(orm: np.ndarray) -> bool:
    r = orm[..., 0]
    return float(r.std()) > 0.03 and 0.25 < float(r.mean()) < 0.995


def build_material(name: str, base_img, orm_img, normal_img, use_ao: bool):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tb = nt.nodes.new('ShaderNodeTexImage'); tb.image = base_img
    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    if orm_img is not None:
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm_img
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        if use_ao:
            grp = _gltf_output_group()
            gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = grp
            nt.links.new(sep.outputs['Red'], gn.inputs['Occlusion'])
    else:
        bsdf.inputs['Roughness'].default_value = 0.7
        bsdf.inputs['Metallic'].default_value = 0.0
    if normal_img is not None:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = normal_img
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    mat.surface_render_method = 'DITHERED'
    return mat


def _gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g is not None:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g
