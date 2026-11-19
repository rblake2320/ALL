/**
 * Dev harness for ASSETS-OBJECTS (dev/objects.html, `npx vite --port 5175 --strictPort`):
 * every catalog + environment model in a labelled grid on a 1 m tile floor, each with a 1.62 m reference capsule
 * and a +Z front arrow; toggles for every ObjectVisualState field, tints, day/night lighting and bloom.
 *
 * URL params (used by dev/objects.shots.cjs): focus=id,id  cats=seating,kitchen  state=powered,inUse,lit,flag,broken,burning
 *   servings=0..4 progress=0..1 dirt=0..1 night=1 tint=variant|#hex t=<seconds frozen time> ui=0 bloom=0 env=0
 *   cam=iso|front|top  zoom=<factor>
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ObjectVisualState } from '../../contracts';
import { BUY_CATEGORIES, PHYSICAL_BY_ID } from '../../../shared/catalog';
import { DIM } from '../../../shared/dimensions';
import { createModelLibrary, DEFAULT_VISUAL_STATE, allModelIds, shapeOf } from '../index';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = Number(params.get(k));
  return params.has(k) && Number.isFinite(v) ? v : d;
};
const flags = new Set((params.get('state') ?? 'powered').split(',').filter(Boolean));
const state: ObjectVisualState = {
  ...DEFAULT_VISUAL_STATE,
  powered: flags.has('powered'),
  inUse: flags.has('inUse'),
  lit: flags.has('lit'),
  flag: flags.has('flag'),
  broken: flags.has('broken'),
  burning: flags.has('burning'),
  servings: num('servings', 4),
  progress: num('progress', 0.5),
  dirt: num('dirt', 0),
};
let night = params.get('night') === '1';
const frozenT = params.has('t') ? num('t', 0) : null;
const tintMode = params.get('tint') ?? 'default';
if (params.get('ui') === '0') document.body.classList.add('hide-ui');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(params.has('frames') ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.style.position = 'fixed';
labels.domElement.style.top = '0';
labels.domElement.style.left = '0';
labels.domElement.style.pointerEvents = 'none';
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const useEnv = params.get('env') !== '0';

const hemi = new THREE.HemisphereLight('#d9d4c8', '#55604c', 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(params.has('frames') ? 1024 : 2048, params.has('frames') ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const lampLights: THREE.PointLight[] = [];
const fogDist: [number, number] = [40, 160];

function applyLighting(): void {
  if (night) {
    scene.background = new THREE.Color('#1d1726');
    scene.fog = new THREE.Fog('#1d1726', fogDist[0], fogDist[1]);
    hemi.color.set('#4a4870');
    hemi.groundColor.set('#1d1726');
    hemi.intensity = 0.55;
    sun.color.set('#9fb4ff');
    sun.intensity = 0.45;
    scene.environmentIntensity = 0.12;
  } else {
    scene.background = new THREE.Color('#9aa39a');
    scene.fog = new THREE.Fog('#9aa39a', fogDist[0] * 1.2, fogDist[1] * 1.4);
    hemi.color.set('#d9d4c8');
    hemi.groundColor.set('#55604c');
    hemi.intensity = 1.2;
    sun.color.set('#fff1dc');
    sun.intensity = 2.2;
    scene.environmentIntensity = 0.35;
  }
  scene.environment = useEnv ? envTex : null;
  for (const l of lampLights) l.visible = night && state.lit;
}

// ── layout ──────────────────────────────────────────────────────────────────────────────────────────────────
const lib = createModelLibrary({ baseUrl: '/assets/' });
const focus = (params.get('focus') ?? '').split(',').filter(Boolean);
const catFilter = new Set((params.get('cats') ?? '').split(',').filter(Boolean));
const ROWS: { title: string; cats: string[] }[] = [
  { title: 'seating & surfaces', cats: ['seating', 'surfaces'] },
  { title: 'kitchen', cats: ['kitchen'] },
  { title: 'preservation & beds', cats: ['preservation', 'beds'] },
  { title: 'electronics & hobbies', cats: ['electronics', 'hobbies'] },
  { title: 'decor, yard, lighting, misc', cats: ['decor', 'outdoor', 'lighting', 'misc'] },
  { title: 'doors & windows', cats: ['doors', 'windows'] },
  { title: 'loose items', cats: ['item'] },
  { title: 'environment', cats: ['env'] },
];

interface Cell {
  id: string;
  inst: THREE.Object3D;
  label: HTMLDivElement;
}

const cells: Cell[] = [];
const world = new THREE.Group();
scene.add(world);
const capsuleGeo = new THREE.CapsuleGeometry(0.17, DIM.CHARACTER_HEIGHT - 0.34, 6, 16);
const capsuleMat = new THREE.MeshStandardMaterial({ color: '#9b9aa3', roughness: 0.6 });
const arrowMat = new THREE.MeshBasicMaterial({ color: '#9fe870' });
const wallMat = new THREE.MeshStandardMaterial({ color: '#a59e93', roughness: 0.9 });
const arrowGeo = (() => {
  const s = new THREE.Shape();
  // drawn pointing -Y so that rotateX(-90deg) makes it lie flat, face up, pointing +Z (the model front)
  s.moveTo(-0.06, 0);
  s.lineTo(-0.06, -0.14);
  s.lineTo(-0.13, -0.14);
  s.lineTo(0, -0.3);
  s.lineTo(0.13, -0.14);
  s.lineTo(0.06, -0.14);
  s.lineTo(0.06, 0);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
})();

function categoryOf(id: string): string {
  return PHYSICAL_BY_ID[id]?.category ?? 'env';
}

let tintCycle = tintMode === 'variant' ? 1 : 0;
function variantTint(id: string, k: number): string | null {
  if (tintMode.startsWith('#')) return tintMode;
  if (tintCycle === 0) return null;
  const v = PHYSICAL_BY_ID[id]?.variants;
  return v && v.length ? v[(k + tintCycle - 1) % v.length] : null;
}

/** Re-create every instance with the next colour variant (exercises tint caching in the library). */
function cycleTints(): void {
  tintCycle++;
  cells.forEach((c, k) => {
    const parent = c.inst.parent;
    if (!parent) return;
    parent.remove(c.inst);
    c.inst = lib.create(c.id, variantTint(c.id, k));
    parent.add(c.inst);
  });
  const info = document.getElementById('info');
  if (info) info.textContent = `${cells.length} models · tint set ${tintCycle} · ${lib.variantCount()} variants`;
}

function addWall(group: THREE.Group, kind: 'wall' | 'door' | 'window', openingHeight: number = DIM.WINDOW_HEIGHT): void {
  const T = DIM.WALL_THICKNESS;
  const H = DIM.WALL_HEIGHT;
  const box = (w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, T), wallMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  if (kind === 'wall') {
    box(1.6, H, 0, H / 2, -T / 2);
    return;
  }
  const hw = (kind === 'door' ? DIM.DOOR_WIDTH : DIM.WINDOW_WIDTH) / 2;
  const side = 0.8 - hw;
  box(side, H, -(hw + side / 2), H / 2, 0);
  box(side, H, hw + side / 2, H / 2, 0);
  if (kind === 'door') box(2 * hw, H - DIM.DOOR_HEIGHT, 0, (H + DIM.DOOR_HEIGHT) / 2, 0);
  else {
    const top = DIM.WINDOW_SILL + openingHeight;
    box(2 * hw, DIM.WINDOW_SILL, 0, DIM.WINDOW_SILL / 2, 0);
    box(2 * hw, H - top, 0, (H + top) / 2, 0);
  }
}

function layout(): THREE.Box3 {
  const all = allModelIds();
  const chosen = focus.length ? focus : all;
  const box = new THREE.Box3();
  let z = 0;
  const showEnv = catFilter.has('env');
  const rows = focus.length ? [{ title: 'focus', cats: [] as string[] }] : ROWS.filter((r) => showEnv || !r.cats.includes('env'));
  for (const row of rows) {
    const ids = focus.length ? chosen : chosen.filter((id) => row.cats.includes(categoryOf(id)) && (!catFilter.size || catFilter.has(categoryOf(id))));
    if (!ids.length) continue;
    let x = 0;
    let depth = 0;
    const isEnv = row.cats.includes('env');
    const maxRow = num('wrap', isEnv ? 40 : 15);
    ids.forEach((id, k) => {
      const sh = shapeOf(id);
      const b = lib.bounds(id);
      const w = Math.max(sh.placement === 'env' ? Math.ceil(b.max.x - b.min.x) : sh.w, 1);
      const d = Math.max(sh.placement === 'env' ? Math.ceil(b.max.z - b.min.z) : sh.d, 1);
      if (x > 0 && x + w > maxRow) {
        z -= depth + (isEnv ? 3 : 2);
        x = 0;
        depth = 0;
      }
      const cell = new THREE.Group();
      const cx = x + w / 2 - (sh.id === 'env_fence' ? 0.5 : 0);
      cell.position.set(cx, 0, z - d / 2);
      const inst = lib.create(id, variantTint(id, k));
      cell.add(inst);
      if (sh.placement === 'wall') addWall(cell, 'wall');
      if (sh.placement === 'door') addWall(cell, 'door');
      if (sh.placement === 'window') addWall(cell, 'window', sh.height);
      const cap = new THREE.Mesh(capsuleGeo, capsuleMat);
      cap.position.set(Math.max(b.max.x, w / 2 - 0.2) + 0.35, DIM.CHARACTER_HEIGHT / 2, 0);
      cap.castShadow = true;
      cell.add(cap);
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(0, 0.005, Math.max(b.max.z, d / 2 - 0.2) + 0.12);
      cell.add(arrow);
      const div = document.createElement('div');
      div.className = 'lbl';
      div.textContent = id;
      const lbl = new CSS2DObject(div);
      lbl.position.set(0, 0, d / 2 + 0.55);
      cell.add(lbl);
      const spec = PHYSICAL_BY_ID[id];
      if (spec?.light && params.get('lamps') !== '0') {
        const pl = new THREE.PointLight(spec.light.color, spec.light.intensity * 0.6, spec.light.distance, 2);
        pl.position.set(0, spec.light.height, spec.placement === 'wall' ? 0.25 : 0);
        cell.add(pl);
        lampLights.push(pl);
      }
      world.add(cell);
      cells.push({ id, inst, label: div });
      x += w + (isEnv ? 3 : 2); // integer gaps keep every footprint on the 1 m tile grid
      depth = Math.max(depth, d);
      box.expandByPoint(new THREE.Vector3(cx - w / 2, 0, z - d));
      box.expandByPoint(new THREE.Vector3(cx + w / 2 + 0.6, Math.min(b.max.y, isEnv ? 12 : 4), z));
    });
    z -= depth + (isEnv ? 3 : 2);
  }
  // tile floor (1 m checker) under everything
  const size = box.getSize(new THREE.Vector3());
  const fw = Math.ceil(size.x + 6);
  const fd = Math.ceil(size.z + 6);
  const tex = checkerTexture();
  tex.repeat.set(fw / 2, fd / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  const c = box.getCenter(new THREE.Vector3());
  floor.position.set(Math.round(c.x) + 0.5 * (fw % 2), -0.001, Math.round(c.z) + 0.5 * (fd % 2));
  floor.receiveShadow = true;
  scene.add(floor);
  return box;
}

function checkerTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const a = '#8b8e86';
  const b = '#7a7d76';
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? a : b;
    g.fillRect(i * 64, j * 64, 64, 64);
  }
  g.strokeStyle = 'rgba(40,40,40,0.25)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 128);
  g.moveTo(0, 64);
  g.lineTo(128, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function frame(box: THREE.Box3, mode: string): void {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  c.y = Math.min(c.y, s.y * 0.35);
  const r = 0.5 * Math.hypot(s.x, s.z * 0.8, s.y * 0.6) * num('zoom', 1);
  const dir = mode === 'front' ? new THREE.Vector3(0, 0.35, 1) : mode === 'top' ? new THREE.Vector3(0, 1, 0.02) : new THREE.Vector3(0.45, 0.8, 1);
  dir.normalize();
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = r / Math.sin(Math.min(vfov, hfov) / 2);
  camera.position.copy(c).addScaledVector(dir, Math.max(2.5, dist));
  fogDist[0] = dist * 1.5;
  fogDist[1] = dist * 5.5;
  applyLighting();
  controls.target.copy(c);
  sun.position.copy(c).add(new THREE.Vector3(-8, 14, 10));
  sun.target.position.copy(c);
  const sh = sun.shadow.camera as THREE.OrthographicCamera;
  const ext = Math.max(s.x, s.z) * 0.6 + 4;
  sh.left = sh.bottom = -ext;
  sh.right = sh.top = ext;
  sh.far = 80;
  sh.updateProjectionMatrix();
  controls.update();
}

// ── post ────────────────────────────────────────────────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.88);
const useBloom = params.get('bloom') !== '0';
if (useBloom) composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── UI ──────────────────────────────────────────────────────────────────────────────────────────────────────
function buildUi(): void {
  const ui = document.getElementById('ui') as HTMLDivElement;
  ui.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = 'Object models';
  ui.appendChild(h);
  const info = document.createElement('div');
  info.className = 'muted';
  info.id = 'info';
  ui.appendChild(info);
  const keys: (keyof ObjectVisualState)[] = ['powered', 'inUse', 'lit', 'broken', 'flag', 'burning'];
  for (const k of keys) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state[k] as boolean;
    cb.onchange = () => {
      (state as unknown as Record<string, unknown>)[k] = cb.checked;
      applyLighting();
    };
    l.append(cb, document.createTextNode(k));
    ui.appendChild(l);
  }
  const slider = (k: 'servings' | 'progress' | 'dirt', max: number, step: number) => {
    const l = document.createElement('label');
    const r = document.createElement('input');
    r.type = 'range';
    r.min = '0';
    r.max = String(max);
    r.step = String(step);
    r.value = String(state[k]);
    r.oninput = () => {
      state[k] = Number(r.value);
    };
    l.append(document.createTextNode(k), r);
    ui.appendChild(l);
  };
  slider('servings', 4, 1);
  slider('progress', 1, 0.05);
  slider('dirt', 1, 0.05);
  const row = document.createElement('div');
  row.className = 'row';
  const nb = document.createElement('button');
  nb.textContent = 'day / night';
  nb.onclick = () => {
    night = !night;
    applyLighting();
  };
  const tb = document.createElement('button');
  tb.textContent = 'next tint';
  tb.onclick = cycleTints;
  row.append(nb, tb);
  ui.appendChild(row);
  const cats = document.createElement('div');
  cats.className = 'muted';
  cats.textContent = `categories: ${BUY_CATEGORIES.map((c) => c.id).join(', ')}, item, env`;
  ui.appendChild(cats);
}

/**
 * Screenshot without the browser compositor (robust under SwiftShader + heavy CPU load): copy the WebGL canvas
 * (preserveDrawingBuffer) into a 2D canvas and paint the model labels at their projected positions.
 */
function capture(): string {
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(renderer.domElement, 0, 0);
  const sx = w / innerWidth;
  const v = new THREE.Vector3();
  g.font = `600 ${Math.round(11 * sx)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const c of cells) {
    const lbl = c.label.parentElement ? c.label : null;
    if (!lbl) continue;
    const obj = c.inst.parent;
    if (!obj) continue;
    const l = obj.children.find((o): o is CSS2DObject => o instanceof CSS2DObject);
    if (!l) continue;
    l.getWorldPosition(v).project(camera);
    if (v.z > 1) continue;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    const tw = g.measureText(c.id).width + 12 * sx;
    const th = 16 * sx;
    g.fillStyle = 'rgba(29,23,38,0.8)';
    g.beginPath();
    g.roundRect(x - tw / 2, y - th / 2, tw, th, 7 * sx);
    g.fill();
    g.fillStyle = lib.isPlaceholder(c.inst) ? '#ffb35a' : '#e8e0c8';
    g.fillText(c.id, x, y + 0.5);
  }
  return cv.toDataURL('image/png');
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
let frames = 0;
/** frames=N renders N frames then stops (screenshots under SwiftShader); default: run forever. */
const maxFrames = params.has('frames') ? Math.max(1, num('frames', 3)) : Infinity;
function tick(): void {
  const t = frozenT ?? clock.getElapsedTime();
  for (const c of cells) lib.update(c.inst, state, t);
  controls.update();
  if (useBloom) composer.render();
  else renderer.render(scene, camera);
  labels.render(scene, camera);
  frames++;
  if (frames >= Math.min(4, maxFrames)) (window as unknown as { __objectsReady: boolean }).__objectsReady = true;
  if (frames < maxFrames) requestAnimationFrame(tick);
}

void lib.ready.then(() => {
  const box = layout();
  applyLighting();
  buildUi();
  frame(box, params.get('cam') ?? 'iso');
  const placeholders = cells.filter((c) => lib.isPlaceholder(c.inst));
  for (const c of placeholders) c.label.classList.add('ph');
  const info = document.getElementById('info');
  if (info) info.textContent = `${cells.length} models · ${placeholders.length} placeholders · ${lib.variantCount()} variants`;
  (window as unknown as { __capture: () => string }).__capture = capture;
  (window as unknown as { __viewer: unknown }).__viewer = {
    state,
    lib,
    placeholders: placeholders.map((c) => c.id),
    setNight(v: boolean) {
      night = v;
      applyLighting();
    },
  };
  requestAnimationFrame(tick);
});
