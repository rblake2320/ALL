/**
 * Character Lab (dev/characters.html): a grid of 8 random zombies with controls for every animation,
 * expression, limb state, decay, carry item, talking and highlight. Context props (chair/bed/tub/counter)
 * appear under anchored animations so pose anchors can be checked by eye.
 *
 * URL params (deterministic screenshots): ?seed=3&anim=walk&expr=happy&decay=0.6&carry=plate&limbs=legL
 *   &talk=1&t=1.25&cam=game|close|side|front|face|strip&count=8&shot=1&props=0&mixed=1
 *   &stagger=1   each zombie i is advanced by i/count of the clip duration (one screenshot = an animation strip)
 *   &lineup=hair|acc|eyes|top|bottom   one zombie per style of that list (other fields from the seed)
 *   &lineup=expr  one zombie per expression (same look; shows the face + the mood carriage layer)
 *   &same=1      every zombie shares zombie 0's appearance (use with stagger)
 *   &pair=1      zombies in facing pairs one tile apart (hug / kiss / talk with a partner)
 *   &assets=/tools/blender/out/characters/iter/   load a candidate build instead of public/assets
 * window.__charLab exposes { ready, set(params), step(sec), stats() } for Playwright.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ACCESSORIES, ANIM_STATES, BOTTOM_STYLES, CARRY_ITEMS, EXPRESSIONS, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES,
  intactLimbs,
} from '../../../shared/appearance';
import type { AnimState, CarryItem, Expression, LimbState, ZombieAppearance } from '../../../shared/appearance';
import { DIM } from '../../../shared/dimensions';
import { createCharacterFactory } from '../index';
import type { ZombieRigDebug } from '../index';
import { SEATED_ANIMS } from '../plan';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') === '1';
if (shot) document.body.classList.add('shot');

// ───────────────────────────── seeded random appearances
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
// muted "cosy macabre" clothing palette (emissive accents like toxic green are kept for hair only, rarely)
const PALETTE = ['#6b4f8a', '#6f8f5e', '#a5532f', '#6e2a35', '#2b2f3a', '#d9cfb8', '#6f86a8', '#3a3f55', '#5a4a3a',
  '#8a6a4a', '#4a5a6a', '#7a5a7a', '#b0884a'];
const HAIR = ['#3b2f2f', '#2a2420', '#b8763a', '#9a9a8a', '#e8e0c8', '#7a2f2f', '#5a3b2e', '#c9a46a', '#3b2f2f', '#6f8f5e'];
const EYES = ['#f2e86d', '#7fe0ff', '#c94f4f', '#9fe870', '#ffb35a', '#b4a1b0', '#e8e0c8'];

function randomAppearance(r: () => number): ZombieAppearance {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
  return {
    height: r(), build: r(), skinTone: Math.floor(r() * SKIN_TONES.length),
    hairStyle: pick(HAIR_STYLES), hairColor: pick(HAIR), topStyle: pick(TOP_STYLES), topColor: pick(PALETTE),
    bottomStyle: pick(BOTTOM_STYLES), bottomColor: pick(PALETTE), shoeColor: pick(['#2a2420', '#3a2a24', '#1f1a18']),
    eyeStyle: pick(EYE_STYLES), eyeColor: pick(EYES), accessory: pick(ACCESSORIES), stitches: r() > 0.25,
    voicePitch: r(),
  };
}

// ───────────────────────────── renderer / scene
const app = document.getElementById('app') as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2b2633');
scene.fog = new THREE.Fog('#2b2633', 14, 30);
// same image-based ambient the game renderer uses (CONTRACTS #14b: dim PMREM RoomEnvironment ~0.35 by day)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
}
scene.add(new THREE.HemisphereLight('#c9cfc0', '#2b2f3a', 0.9));
const key = new THREE.DirectionalLight('#ffe3c4', 2.4);
key.position.set(-4, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(shot ? 1024 : 2048, shot ? 1024 : 2048);
key.shadow.camera.left = -6;
key.shadow.camera.right = 6;
key.shadow.camera.top = 6;
key.shadow.camera.bottom = -6;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new THREE.DirectionalLight('#a7b4ff', 0.7);
fill.position.set(5, 3, -2);
scene.add(fill);
const rim = new THREE.DirectionalLight('#d6c2ff', 0.9);
rim.position.set(0, 4, -6);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#5d6b52', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(12, 12, '#7a8a6a', '#6a7a5c');
(grid.material as THREE.Material).opacity = 0.35;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.002;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.05, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !shot;

function setCam(kind: string, n: number): void {
  const cols = Math.min(perRow(), n);
  const rows = Math.ceil(n / perRow());
  const cx = ((cols - 1) * spacing()) / 2;
  const cz = ((rows - 1) * SPACING_Z) / 2;
  const target = new THREE.Vector3(cx, 0.75, cz);
  const presets: Record<string, [number, number, number]> = {
    game: [35, 42, 9.5 + n * 0.25],
    close: [20, 12, 3.2],
    side: [90, 8, 7.5],
    front: [0, 10, 7.5],
    face: [14, 6, 1.25],
    strip: [16, 14, 1.2 + cols * 0.6],
    pair: [62, 18, 4.6],
    top: [25, 44, 2.0 + cols * 0.72],
  };
  const [yawDeg, pitchDeg, dist] = presets[kind] ?? presets.game;
  if (kind === 'face') target.set(0, 1.36, 0.12);
  if (kind === 'close') target.set(n > 1 ? spacing() / 2 : 0, 0.85, 0);
  if (kind === 'strip' || kind === 'top') target.set(cx, kind === 'top' ? 0.8 : 0.78, cz);
  if (kind === 'pair') target.set(0.8 * Math.max(0, Math.ceil(n / 2) - 1), 0.95, 0.5);
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  controls.target.copy(target);
  camera.lookAt(target);
  controls.update();
}

// ───────────────────────────── context props for anchored animations
const propMat = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.8 });
const lining = new THREE.MeshStandardMaterial({ color: '#7fa0c8', roughness: 0.7 });
const water = new THREE.MeshStandardMaterial({ color: '#7fe0ff', roughness: 0.2, transparent: true, opacity: 0.45 });
function makeProp(anim: AnimState): THREE.Object3D | null {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  };
  if (SEATED_ANIMS.has(anim)) {
    box(0.5, DIM.SEAT_HEIGHT, 0.46, propMat, 0, DIM.SEAT_HEIGHT / 2, 0.02);
    box(0.5, 0.5, 0.06, propMat, 0, DIM.SEAT_HEIGHT + 0.25, -0.24);
    if (anim !== 'sit' && anim !== 'sitTV') box(0.9, 0.04, 0.5, propMat, 0, DIM.TABLE_HEIGHT - 0.02, 0.6);
    return g;
  }
  if (anim === 'sleep') {
    box(0.7, DIM.BED_HEIGHT, 2.0, lining, 0, DIM.BED_HEIGHT / 2, 0);
    return g;
  }
  if (anim === 'beEmbalmed') {
    box(0.7, DIM.SLAB_HEIGHT, 2.0, propMat, 0, DIM.SLAB_HEIGHT / 2, 0);
    return g;
  }
  if (anim === 'bath') {
    box(0.8, 0.12, 1.5, propMat, 0, 0.06, -0.15);
    box(0.8, DIM.TUB_RIM - 0.05, 0.06, propMat, 0, (DIM.TUB_RIM - 0.05) / 2, 0.6);
    box(0.06, DIM.TUB_RIM, 1.5, propMat, 0.42, DIM.TUB_RIM / 2, -0.15);
    box(0.06, DIM.TUB_RIM, 1.5, propMat, -0.42, DIM.TUB_RIM / 2, -0.15);
    box(0.78, 0.02, 1.45, water, 0, DIM.TUB_RIM - 0.08, -0.15);
    return g;
  }
  if (anim === 'cook' || anim === 'washHands') {
    box(1.0, DIM.COUNTER_HEIGHT, 0.55, propMat, 0, DIM.COUNTER_HEIGHT / 2, 0.68);
    return g;
  }
  if (anim === 'embalm') {
    box(0.7, DIM.SLAB_HEIGHT, 1.8, propMat, 0, DIM.SLAB_HEIGHT / 2, 0.85);
    return g;
  }
  if (anim === 'stitch') {
    box(0.9, DIM.TABLE_HEIGHT, 0.5, propMat, 0, DIM.TABLE_HEIGHT / 2, 0.62);
    return g;
  }
  return null;
}
/** Root lift the renderer applies for lying anims (sleep at BED_HEIGHT, embalming at SLAB_HEIGHT; bath on tub floor). */
function rootLift(anim: AnimState): number {
  if (anim === 'sleep') return DIM.BED_HEIGHT;
  if (anim === 'beEmbalmed') return DIM.SLAB_HEIGHT;
  if (anim === 'bath') return 0.12;
  return 0;
}

// ───────────────────────────── zombies
const SPACING = 1.5;
const SPACING_Z = 2.4;
/** Zombies per row: one row for strips / lineups, else a 4-wide grid (?perRow=N overrides). */
function perRow(): number {
  const n = Number(params.get('perRow'));
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return params.get('stagger') === '1' || params.has('lineup') ? 12 : 4;
}
/** Tighter spacing for single-row strips so the camera can get close. */
function spacing(): number {
  const n = Number(params.get('spacing'));
  return Number.isFinite(n) && n > 0.2 ? n : perRow() > 4 ? 0.95 : SPACING;
}
const BASE = import.meta.env.BASE_URL === './' || !import.meta.env.BASE_URL ? '/' : import.meta.env.BASE_URL;
/**
 * `?assets=/tools/blender/out/characters/iter/` previews a candidate build (build_zombie.py --out-dir <dir>) before
 * it is published to public/assets. Same-origin absolute paths only.
 */
function assetsBase(): string {
  const a = params.get('assets');
  if (a && /^\/[A-Za-z0-9_./-]*\/$/.test(a) && !a.includes('..')) return a;
  return BASE + 'assets/';
}
const ASSETS = assetsBase();
const factory = createCharacterFactory({ baseUrl: ASSETS });
interface Slot { rig: ZombieRigDebug; holder: THREE.Group; prop: THREE.Object3D | null; anim: AnimState; app: ZombieAppearance }
const slots: Slot[] = [];
let seed = Number(params.get('seed') ?? 7) || 7;
let count = Math.max(1, Math.min(12, Number(params.get('count') ?? 8) || 8));
let selected = -1;

interface LabState {
  anim: AnimState; expr: Expression; decay: number; carry: CarryItem | null; limbs: LimbState; talk: boolean;
  mixed: boolean;
}
const state: LabState = {
  anim: (ANIM_STATES as readonly string[]).includes(params.get('anim') ?? '') ? (params.get('anim') as AnimState) : 'idle',
  expr: (EXPRESSIONS as readonly string[]).includes(params.get('expr') ?? '') ? (params.get('expr') as Expression) : 'neutral',
  decay: Number(params.get('decay') ?? 0) || 0,
  carry: (CARRY_ITEMS as readonly string[]).includes(params.get('carry') ?? '') ? (params.get('carry') as CarryItem) : null,
  limbs: parseLimbs(params.get('limbs')),
  talk: params.get('talk') === '1',
  mixed: params.get('mixed') === '1',
};

function parseLimbs(s: string | null): LimbState {
  const l = intactLimbs();
  if (!s) return l;
  for (const part of s.split(',')) {
    const [id, cond] = part.split(':');
    if (id in l) (l as Record<string, string>)[id] = cond === 'prosthetic' ? 'prosthetic' : 'missing';
  }
  return l;
}

/** URL overrides for deterministic close-ups: hair, top, bottom, eyes, acc, skin, stitches. */
function applyOverrides(a: ZombieAppearance): ZombieAppearance {
  const o = { ...a };
  const hair = params.get('hair');
  if (hair && (HAIR_STYLES as readonly string[]).includes(hair)) o.hairStyle = hair as ZombieAppearance['hairStyle'];
  const top = params.get('top');
  if (top && (TOP_STYLES as readonly string[]).includes(top)) o.topStyle = top as ZombieAppearance['topStyle'];
  const bottom = params.get('bottom');
  if (bottom && (BOTTOM_STYLES as readonly string[]).includes(bottom)) o.bottomStyle = bottom as ZombieAppearance['bottomStyle'];
  const eyes = params.get('eyes');
  if (eyes && (EYE_STYLES as readonly string[]).includes(eyes)) o.eyeStyle = eyes as ZombieAppearance['eyeStyle'];
  const acc = params.get('acc');
  if (acc && (ACCESSORIES as readonly string[]).includes(acc)) o.accessory = acc as ZombieAppearance['accessory'];
  if (params.has('skin')) o.skinTone = Number(params.get('skin')) || 0;
  if (params.has('stitches')) o.stitches = params.get('stitches') === '1';
  return o;
}

const MIXED: AnimState[] = ['idle', 'walk', 'sit', 'talk', 'wave', 'dance', 'sitEat', 'cheer', 'cook', 'read', 'phone',
  'laugh'];

/** `lineup=<list>`: one zombie per entry of that style list (bald / none included). */
function lineupStyles(): { key: keyof ZombieAppearance; values: readonly string[] } | null {
  switch (params.get('lineup')) {
    case 'hair': return { key: 'hairStyle', values: HAIR_STYLES };
    case 'acc': return { key: 'accessory', values: ACCESSORIES };
    case 'eyes': return { key: 'eyeStyle', values: EYE_STYLES };
    case 'top': return { key: 'topStyle', values: TOP_STYLES };
    case 'bottom': return { key: 'bottomStyle', values: BOTTOM_STYLES };
    case 'expr': return { key: 'voicePitch', values: EXPRESSIONS }; // look unchanged; see exprFor()
    default: return null;
  }
}
const lineup = lineupStyles();
if (lineup) count = Math.min(12, lineup.values.length);

function build(): void {
  for (const s of slots) {
    s.rig.dispose();
    s.holder.removeFromParent();
    s.prop?.removeFromParent();
  }
  slots.length = 0;
  const r = rng(seed);
  let first: ZombieAppearance | null = null;
  for (let i = 0; i < count; i++) {
    let a = applyOverrides(randomAppearance(r));
    if (params.get('same') === '1' || lineup) {
      first = first ?? a;
      a = { ...first };
    }
    if (lineup && params.get('lineup') !== 'expr') {
      (a as unknown as Record<string, unknown>)[lineup.key] = lineup.values[i % lineup.values.length];
    }
    const holder = new THREE.Group();
    const pr = perRow();
    holder.position.set((i % pr) * spacing(), 0, Math.floor(i / pr) * SPACING_Z);
    if (params.get('pair') === '1') {
      // socials: partners one tile (1 m) apart, facing each other (as the sim places them)
      const k = Math.floor(i / 2);
      holder.position.set(k * 1.6, 0, i % 2 === 0 ? 0 : 1.0);
      holder.rotation.y = i % 2 === 0 ? 0 : Math.PI;
    }
    scene.add(holder);
    const rig = factory.create(a, state.limbs) as ZombieRigDebug;
    holder.add(rig.root);
    slots.push({ rig, holder, prop: null, anim: state.anim, app: a });
  }
  applyAll();
}

function applyAll(): void {
  slots.forEach((s, i) => {
    const anim = state.mixed ? MIXED[i % MIXED.length] : state.anim;
    s.anim = anim;
    s.rig.setLimbs(state.limbs);
    s.rig.setAnim(anim);
    s.rig.setExpression(params.get('lineup') === 'expr' ? EXPRESSIONS[i % EXPRESSIONS.length] : state.expr);
    s.rig.setDecay(state.decay);
    s.rig.setCarry(state.carry);
    s.rig.setTalking(state.talk);
    const hl = params.get('hl');
    s.rig.setHighlight(i === selected ? 'selected' : hl === 'selected' || hl === 'hover' ? (i === 0 ? hl : 'none') : 'none');
    s.prop?.removeFromParent();
    s.prop = makeProp(anim);
    if (s.prop) s.holder.add(s.prop);
    s.rig.root.position.y = rootLift(anim);
  });
  renderPanel();
}

// ───────────────────────────── panel
const panel = document.getElementById('panel') as HTMLDivElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
function btn(label: string, on: boolean, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (on) b.className = 'on';
  b.onclick = fn;
  return b;
}
function section(title: string, children: HTMLElement[]): void {
  const h = document.createElement('h2');
  h.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  children.forEach((c) => row.appendChild(c));
  panel.append(h, row);
}
function renderPanel(): void {
  if (shot) return;
  panel.innerHTML = '<h1>Character Lab</h1>';
  section('Animation', ANIM_STATES.map((a) => btn(a, !state.mixed && a === state.anim, () => {
    state.anim = a;
    state.mixed = false;
    applyAll();
  })).concat([btn('mixed', state.mixed, () => { state.mixed = !state.mixed; applyAll(); })]));
  section('Expression', EXPRESSIONS.map((e) => btn(e, e === state.expr, () => { state.expr = e; applyAll(); }))
    .concat([btn(state.talk ? 'talking' : 'talk', state.talk, () => { state.talk = !state.talk; applyAll(); })]));
  section('Carry', [null, ...CARRY_ITEMS].map((c) => btn(c ?? 'none', c === state.carry, () => { state.carry = c; applyAll(); })));
  const limbBtns = (['armL', 'armR', 'legL', 'legR'] as const).map((id) =>
    btn(`${id}: ${state.limbs[id]}`, state.limbs[id] !== 'ok', () => {
      const order = ['ok', 'missing', 'prosthetic'] as const;
      state.limbs = { ...state.limbs, [id]: order[(order.indexOf(state.limbs[id]) + 1) % 3] };
      applyAll();
    }));
  section('Limbs', limbBtns);
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1';
  range.step = '0.01';
  range.value = String(state.decay);
  range.oninput = () => { state.decay = Number(range.value); slots.forEach((s) => s.rig.setDecay(state.decay)); };
  section(`Decay ${state.decay.toFixed(2)}`, [range]);
  section('Zombies', [btn('re-roll', false, () => { seed++; build(); }), btn('fewer', false, () => { count = Math.max(1, count - 1); build(); }),
    btn('more', false, () => { count = Math.min(12, count + 1); build(); })]);
  section('Camera', ['game', 'close', 'side', 'front', 'face'].map((c) => btn(c, false, () => setCam(c, count))));
}

// ───────────────────────────── picking for highlight
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointermove', (ev) => {
  ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  let best = -1;
  let bestD = 0.5;
  slots.forEach((s, i) => {
    const c = new THREE.Vector3();
    s.rig.root.getWorldPosition(c);
    c.y += 0.9;
    const d = ray.ray.distanceToPoint(c);
    if (d < bestD) { bestD = d; best = i; }
  });
  slots.forEach((s, i) => s.rig.setHighlight(i === selected ? 'selected' : i === best ? 'hover' : 'none'));
});
renderer.domElement.addEventListener('click', (ev) => {
  ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const c = new THREE.Vector3();
  selected = -1;
  slots.forEach((s, i) => {
    s.rig.root.getWorldPosition(c);
    c.y += 0.9;
    if (ray.ray.distanceToPoint(c) < 0.5) selected = i;
  });
  slots.forEach((s, i) => s.rig.setHighlight(i === selected ? 'selected' : 'none'));
});

// ───────────────────────────── loop
const clock = new THREE.Clock();
let paused = shot;
const tmp = new THREE.Vector3();
function step(dt: number): void {
  for (const s of slots) s.rig.update(dt);
}
let renderedFrames = 0;
function frame(): void {
  const dt = Math.min(0.05, clock.getDelta());
  if (shot) {
    // screenshot mode renders on demand only (SwiftShader is slow); see __charLab.render()
    requestAnimationFrame(frame);
    return;
  }
  if (!paused) step(dt);
  controls.update();
  renderer.render(scene, camera);
  renderedFrames++;
  if (!shot) {
    const st = slots.map((s, i) => `${i} ${s.rig.kind} ${s.anim.padEnd(11)} dc=${s.rig.stats().drawCalls} tris=${s.rig.stats().triangles}`);
    statsEl.textContent = `${st.join('\n')}\nframe calls=${renderer.info.render.calls} tris=${renderer.info.render.triangles}`;
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/** Clip durations from the manifest (stagger mode); missing manifest -> 1 s. */
async function clipDurations(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await fetch(ASSETS + 'manifest.characters.json');
    const man = (await res.json()) as { animations?: { name: string; duration: number }[] };
    for (const a of man.animations ?? []) out.set(a.name, a.duration);
  } catch {
    /* stagger falls back to 1 s */
  }
  return out;
}

const ready = factory.ready.then(async () => {
  build();
  setCam(params.get('cam') ?? 'game', count);
  const t = Number(params.get('t') ?? 0.6) || 0;
  // advance deterministically to time t (fixed 1/60 steps) so crossfades settle and poses are exact
  const n = Math.round(t * 60);
  for (let i = 0; i < n; i++) step(1 / 60);
  if (params.get('stagger') === '1') {
    // zombie i shows the clip i/count of a cycle later: a whole animation in one screenshot
    const durs = await clipDurations();
    slots.forEach((s, i) => {
      const d = durs.get(s.anim) ?? 1;
      const extra = Math.round(((d * i) / slots.length) * 60);
      for (let k = 0; k < extra; k++) s.rig.update(1 / 60);
    });
  }
  for (const s of slots) s.rig.headTop(tmp);
  if ((params.get('cam') ?? '') === 'face' && slots[0]) {
    // frame the first zombie's actual face (posture/height vary)
    const top = slots[0].rig.headTop(new THREE.Vector3());
    const target = top.clone().add(new THREE.Vector3(0, -0.36, 0.05));
    camera.position.set(target.x + 0.25, target.y + 0.12, target.z + 1.05);
    controls.target.copy(target);
    camera.lookAt(target);
  }
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  renderedFrames++;
});

build();
setCam(params.get('cam') ?? 'game', count);
requestAnimationFrame(frame);

(window as unknown as Record<string, unknown>).__charLab = {
  ready,
  step: (sec: number) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) step(1 / 60); },
  set: (p: Partial<LabState>) => { Object.assign(state, p); applyAll(); },
  stats: () => ({ rigs: slots.map((s) => ({ kind: s.rig.kind, anim: s.anim, ...s.rig.stats() })), calls: renderer.info.render.calls }),
  pause: (on: boolean) => { paused = on; },
  render: () => { renderer.render(scene, camera); renderedFrames++; return renderedFrames; },
  frames: () => renderedFrames,
};
