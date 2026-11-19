"""Preview contact sheets (Cycles, CPU, low samples). Called by build_zombie.py --preview."""
from __future__ import annotations

import os

import bpy
from mathutils import Vector

from . import plan, preview
from .anim.bake import apply_pose
from .consts import EXPRESSIONS, FACE_MORPHS, SKIN_TONES
from .materials import set_material_color, vertex_color_preview

V = Vector

APPEARANCES = [
    dict(hairStyle='messy', topStyle='tee', bottomStyle='pants', eyeStyle='droopy', accessory='none', skin=0,
         hair='#3b2f2f', top='#6b4f8a', bottom='#3a3f55', shoes='#2a2420', iris='#f2e86d'),
    dict(hairStyle='bob', topStyle='dress', bottomStyle='skirt', eyeStyle='wide', accessory='flower', skin=5,
         hair='#b8763a', top='#6e2a35', bottom='#2b2f3a', shoes='#3a2a24', iris='#7fe0ff'),
    dict(hairStyle='combover', topStyle='suit', bottomStyle='pants', eyeStyle='sleepy', accessory='glasses', skin=2,
         hair='#9a9a8a', top='#2f3a4a', bottom='#2f3a4a', shoes='#1f1a18', iris='#c94f4f'),
    dict(hairStyle='afro', topStyle='hoodie', bottomStyle='shorts', eyeStyle='mismatched', accessory='necklace',
         skin=4, hair='#2a2420', top='#6f8f5e', bottom='#5a4a3a', shoes='#5a3a2a', iris='#9fe870'),
    dict(hairStyle='bun', topStyle='blouse', bottomStyle='skirt', eyeStyle='beady', accessory='bowtie', skin=8,
         hair='#7a2f2f', top='#d9cfb8', bottom='#3a3f55', shoes='#2a2420', iris='#2a2420'),
    dict(hairStyle='mohawk', topStyle='tatters', bottomStyle='pants', eyeStyle='wide', accessory='eyepatch', skin=7,
         hair='#9fe870', top='#a5532f', bottom='#3a2f2a', shoes='#2a2420', iris='#ffb35a'),
    dict(hairStyle='long', topStyle='cardigan', bottomStyle='pants', eyeStyle='droopy', accessory='bandage', skin=1,
         hair='#e8e0c8', top='#a5532f', bottom='#2b2f3a', shoes='#3a2a24', iris='#f2e86d'),
    dict(hairStyle='pigtails', topStyle='tee', bottomStyle='shorts', eyeStyle='sleepy', accessory='beanie', skin=3,
         hair='#3b2f2f', top='#7fa0c8', bottom='#6e2a35', shoes='#2a2420', iris='#b4a1b0'),
    dict(hairStyle='buzz', topStyle='hoodie', bottomStyle='pants', eyeStyle='droopy', accessory='none', skin=6,
         hair='#2a2420', top='#2b2f3a', bottom='#5a4a3a', shoes='#2a2420', iris='#f2e86d'),
]


def _materials(ch: dict, app: dict, tag: str) -> dict:
    mats = ch['mats']
    out = {}
    for key, name in (('hair', 'Hair'), ('top', 'Top'), ('bottom', 'Bottom'), ('shoes', 'Shoes'), ('iris', 'Iris')):
        m = mats[name].copy()
        m.name = f'{name}_{tag}'
        set_material_color(m, app[key])
        out[name] = m
    m = mats['Skin'].copy()
    m.name = f'Skin_{tag}'
    set_material_color(m, SKIN_TONES[app['skin'] % len(SKIN_TONES)])
    out['Skin'] = m
    return out


def _set_face(ch: dict, expr: str | None) -> None:
    for ob in ch['objects'].values():
        keys = ob.data.shape_keys
        if not keys:
            continue
        for kb in keys.key_blocks[1:]:
            if kb.name in FACE_MORPHS:
                kb.value = 1.0 if kb.name == expr else 0.0


def _tile(ch, app, limbs, pose, offset, yaw, tag, expr=None):
    apply_pose(ch['arm'], ch['sk'], pose)
    _set_face(ch, expr)
    vis = plan.visible_parts(app, limbs)
    objs = [ch['objects'][n] for n in sorted(vis) if n in ch['objects']]
    snaps = preview.snapshot(objs, offset, material_map=_materials(ch, app, tag), yaw_deg=yaw)
    for s in snaps:
        s.hide_render = False
    return snaps


def _finish(path: str, center: Vector, span: float, width: int, height: int, ortho: float, pitch: float = 28,
            samples: int = 10, dist: float = 14) -> None:
    preview.add_ground(span * 4, (center.x, center.y, 0))
    preview.standard_lights(center + V((0, 0, 0.8)), max(3.0, span * 0.6))
    preview.add_camera(center + V((0, 0, 0.72)), 0, pitch, dist, ortho_scale=ortho)
    preview.setup_render(width, height, samples)
    preview.setup_world()
    preview.render_to(path)
    preview.clear_sheet()


def sheet_appearance(ch, clips, out_dir):
    for ob in ch['objects'].values():
        ob.hide_render = True
    idle = clips['idle']['fn'](ch['sk'], 0.6)
    for i, app in enumerate(APPEARANCES):
        _tile(ch, app, None, idle, V((i * 0.78, 0, 0)), -28, f'a{i}')
        preview.add_label(f"{app['topStyle']} / {app['hairStyle']} / {app['eyeStyle']}", (i * 0.78, -0.55, 0.0),
                          0.05)
    n = len(APPEARANCES)
    _finish(os.path.join(out_dir, 'sheet_appearance.png'), V(((n - 1) * 0.39, 0, 0)), n * 0.78, 1500, 520,
            n * 0.78 + 0.3)


def sheet_expressions(ch, clips, out_dir):
    idle = clips['idle']['fn'](ch['sk'], 0.0)
    styles = [APPEARANCES[0], APPEARANCES[1], APPEARANCES[3]]
    for r, app in enumerate(styles):
        for c, ex in enumerate(['neutral', 'blink', 'talk'] + list(EXPRESSIONS[1:])):
            off = V((c * 0.42, 0, -r * 0.66 - 1.2))
            _tile(ch, app, None, idle, off, -12, f'e{r}_{c}', expr=None if ex == 'neutral' else ex)
            if r == 0:
                preview.add_label(ex, (c * 0.42, -0.3, 0.68 - 0.0), 0.045)
    _set_face(ch, None)
    cols = 2 + len(EXPRESSIONS)
    preview.add_light('FaceKey', V((cols * 0.21, -3.0, 1.0)), (80, 0, 0), 300, '#fff0e0', size=4)
    center = V(((cols - 1) * 0.21, 0, 0))
    preview.add_camera(V(((cols - 1) * 0.21, 0, -0.42)), 0, 6, 10, ortho_scale=cols * 0.42 + 0.1)
    preview.standard_lights(center + V((0, 0, 0.2)), 5.0)
    preview.setup_render(1500, 640, 10)
    preview.setup_world()
    preview.render_to(os.path.join(out_dir, 'sheet_expressions.png'))
    preview.clear_sheet()


POSE_TIMES = {
    'walk': 0.25, 'limp': 0.3, 'crawl': 0.35, 'pickup': 0.45, 'collapse': 1.0, 'yawn': 0.5, 'wave': 0.25,
    'cook': 0.3, 'sitEat': 0.45, 'admire': 0.6, 'stitch': 0.45, 'stretch': 0.4, 'sitChess': 0.75, 'phone': 0.2,
}


def sheet_poses(ch, clips, out_dir, names=None, tag='poses', per_row=8, yaw=-35):
    names = names or list(clips.keys())
    app_cycle = [APPEARANCES[0], APPEARANCES[1], APPEARANCES[2], APPEARANCES[6]]
    sp = 1.0
    for i, name in enumerate(names):
        c = clips[name]
        tt = POSE_TIMES.get(name, 0.3) * c['duration']
        pose = c['fn'](ch['sk'], tt)
        limbs = None
        if name == 'limp':
            limbs = {'armL': 'ok', 'armR': 'ok', 'legL': 'missing', 'legR': 'ok'}
        if name == 'crawl':
            limbs = {'armL': 'ok', 'armR': 'ok', 'legL': 'missing', 'legR': 'missing'}
        row, col = divmod(i, per_row)
        off = V((col * sp, row * 1.6, 0))
        _tile(ch, app_cycle[i % len(app_cycle)], limbs, pose, off, yaw, f'p{i}')
        preview.add_label(name, (col * sp, row * 1.6 - 0.75, 0.0), 0.075)
    cols = min(per_row, len(names))
    center = V(((cols - 1) * sp / 2, 0, 0))
    _finish(os.path.join(out_dir, f'sheet_{tag}.png'), center, cols * sp, 1600, 400, cols * sp + 0.3, pitch=26,
            dist=18)


def sheet_limbs(ch, clips, out_dir):
    combos = [
        ({'armL': 'missing', 'armR': 'ok', 'legL': 'ok', 'legR': 'ok'}, 'armL missing'),
        ({'armL': 'ok', 'armR': 'prosthetic', 'legL': 'ok', 'legR': 'ok'}, 'armR prosthetic'),
        ({'armL': 'ok', 'armR': 'ok', 'legL': 'prosthetic', 'legR': 'ok'}, 'legL prosthetic'),
        ({'armL': 'prosthetic', 'armR': 'missing', 'legL': 'ok', 'legR': 'missing'}, 'mixed'),
        ({'armL': 'ok', 'armR': 'ok', 'legL': 'missing', 'legR': 'ok'}, 'legL missing (limp)'),
        ({'armL': 'missing', 'armR': 'missing', 'legL': 'missing', 'legR': 'missing'}, 'all missing'),
    ]
    idle = clips['idle']['fn'](ch['sk'], 0.6)
    limp = clips['limp']['fn'](ch['sk'], 0.3)
    crawl = clips['crawl']['fn'](ch['sk'], 0.4)
    for i, (limbs, label) in enumerate(combos):
        pose = limp if label.startswith('legL missing') else crawl if label == 'all missing' else idle
        app = APPEARANCES[i % 4] if i != 3 else APPEARANCES[4]
        _tile(ch, app, limbs, pose, V((i * 0.9, 0, 0)), -30, f'l{i}')
        preview.add_label(label, (i * 0.9, -0.6, 0.0), 0.06)
    n = len(combos)
    _finish(os.path.join(out_dir, 'sheet_limbs.png'), V(((n - 1) * 0.45, 0, 0)), n * 0.9, 1400, 520, n * 0.9 + 0.3)


def sheet_walk(ch, clips, out_dir):
    for i in range(8):
        t = i / 8.0
        pose = clips['walk']['fn'](ch['sk'], t)
        _tile(ch, APPEARANCES[0], None, pose, V((i * 0.75, 0, 0)), 90, f'w{i}')
        preview.add_label(f'walk {i}/8', (i * 0.75, -0.6, 0.0), 0.06)
    _finish(os.path.join(out_dir, 'sheet_walk_side.png'), V((3.5 * 0.75, 0, 0)), 6.0, 1400, 420, 6.4, pitch=8)


# Most-seen clips (game time share): each as a 6-frame strip with a stand-in prop (chair / bed / counter).
CYCLE_SHEETS = ['idle', 'talk', 'sit', 'sitEat', 'sitTV', 'cook', 'sleep']
_SEATED = {'sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess'}


def _context_prop(name: str, x: float, yaw: float) -> None:
    from .consts import DIM
    seat = DIM['SEAT_HEIGHT']
    o = (x, 0.0, 0.0)
    if name in _SEATED:   # chair under the seat point (character front = -Y), backrest behind
        preview.add_box(f'chair_{x}', (0.46, 0.44, seat), (0.0, 0.04, seat / 2), o, yaw)
        preview.add_box(f'chairback_{x}', (0.46, 0.05, 0.5), (0.0, 0.24, seat + 0.25), o, yaw)
    elif name == 'sleep':
        preview.add_box(f'bed_{x}', (0.66, 1.9, DIM['BED_HEIGHT']), (0.0, 0.05, DIM['BED_HEIGHT'] / 2), o, yaw,
                        '#7fa0c8')
    elif name == 'cook':
        c = DIM['COUNTER_HEIGHT']
        preview.add_box(f'counter_{x}', (0.62, 0.42, c), (0.0, -0.62, c / 2), o, yaw, '#9a8a7a')


def sheet_cycle(ch, clips, out_dir, name: str, frames: int = 6):
    """One clip as `frames` evenly spaced frames, 3/4 front view, with its context prop."""
    from .consts import DIM
    c = clips[name]
    sp = 0.95 if name != 'sleep' else 0.85
    lift = DIM['BED_HEIGHT'] if name == 'sleep' else 0.0
    app = APPEARANCES[{'idle': 0, 'talk': 1, 'sit': 2, 'sitEat': 6, 'sitTV': 3, 'cook': 4, 'sleep': 7}.get(name, 0)]
    for i in range(frames):
        t = c['duration'] * i / frames
        pose = c['fn'](ch['sk'], t)
        x = i * sp
        yaw = -28
        _tile(ch, app, None, pose, V((x, 0, lift)), yaw, f'c{name}{i}')
        _context_prop(name, x, yaw)
        preview.add_label(f'{name} {t:.2f}s', (x, -0.62 if name != 'sleep' else -1.15, 0.0), 0.055)
    center = V(((frames - 1) * sp / 2, 0, 0))
    _finish(os.path.join(out_dir, f'sheet_cycle_{name}.png'), center, frames * sp, 1400, 380 if name != 'sleep' else 420,
            frames * sp + 0.2, pitch=24 if name != 'sleep' else 50, dist=16)


HAIR_LINEUP = ['bald', 'buzz', 'messy', 'bob', 'bun', 'mohawk', 'long', 'combover', 'pigtails', 'afro', 'beanie']
HAIR_COLORS = ['#3b2f2f', '#2a2420', '#7a2f2f', '#b8763a', '#3b2f2f', '#6f8f5e', '#d9cfb8', '#9a9a8a', '#5a3b2e',
               '#2a2420', '#3b2f2f']


def sheet_hair(ch, clips, out_dir):
    """Head close-ups of every hair style (+ the beanie) from the front-3/4 and from the elevated game camera."""
    idle = clips['idle']['fn'](ch['sk'], 0.6)
    sp = 0.42
    for view, (pitch, yaw, tag) in enumerate(((8, -26, 'front'), (44, -26, 'game'))):
        for i, style in enumerate(HAIR_LINEUP):
            app = dict(APPEARANCES[0])
            app.update(hairStyle=style if style != 'beanie' else 'long', accessory='beanie' if style == 'beanie' else 'none',
                       hair=HAIR_COLORS[i % len(HAIR_COLORS)], skin=(i * 3) % len(SKIN_TONES), eyeStyle='droopy')
            _tile(ch, app, None, idle, V((i * sp, 0, 0)), yaw, f'h{view}_{i}')
            preview.add_label(style, (i * sp, -0.32, 1.02), 0.04)
        n = len(HAIR_LINEUP)
        center = V(((n - 1) * sp / 2, 0, 0))
        preview.add_ground(n * sp * 4, (center.x, 0, 0))
        preview.standard_lights(center + V((0, 0, 1.4)), 3.5)
        preview.add_camera(center + V((0, 0, 1.38)), 0, pitch, 14, ortho_scale=n * sp + 0.1)
        preview.setup_render(1400, 260 if view == 0 else 300, 8)
        preview.setup_world()
        preview.render_to(os.path.join(out_dir, f'sheet_hair_{tag}.png'))
        preview.clear_sheet()


def render_all(ch: dict, clips: dict, out_dir: str, which: str = 'all') -> None:
    os.makedirs(out_dir, exist_ok=True)
    for m in ch['mats'].values():
        vertex_color_preview(m, True)
    for ob in ch['objects'].values():
        ob.hide_render = True
    want = set(which.split(',')) if which != 'all' else {'appearance', 'expressions', 'poses', 'limbs', 'walk', 'hair',
                                                         'cycles'}
    if 'appearance' in want:
        sheet_appearance(ch, clips, out_dir)
    if 'expressions' in want:
        sheet_expressions(ch, clips, out_dir)
    names = list(clips.keys())
    for k in range(0, len(names), 9):
        tag = f'poses_{k // 9 + 1}'
        if 'poses' in want or tag in want:
            sheet_poses(ch, clips, out_dir, names[k:k + 9], tag, per_row=9)
    if 'limbs' in want:
        sheet_limbs(ch, clips, out_dir)
    if 'walk' in want:
        sheet_walk(ch, clips, out_dir)
    if 'hair' in want:
        sheet_hair(ch, clips, out_dir)
    for name in CYCLE_SHEETS:
        if 'cycles' in want or f'cycle_{name}' in want:
            sheet_cycle(ch, clips, out_dir, name)
