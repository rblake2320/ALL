/**
 * RENDER dev harness (dev/render.html). Serves: `npx vite --port 5174 --strictPort` → http://localhost:5174/dev/render.html
 *
 * URL params:
 *   scene=default|fx|ghost-valid|ghost-invalid|build|caz|stress|thumbs
 *   time=HH:MM (or minutes) · moon=1 · walls=up|cutaway|down · view=live|buy|build · quality=low|medium|high|ultra
 *   cam=yaw,pitch,distance[,tx,tz] · sim=fake|real · libs=auto|placeholder · ui=0 (hide controls) · paused=1
 *   world=1 (W-025 S5: the fake world gets a town → the walkable world is drawn) · worldAgents=N (zombies in other
 *   regions) · world=0 with sim=real (strip the real world's town → home-only, the AC-1 parity view)
 * Automatically uses the real asset libraries (src/render/models, src/render/characters) when they exist.
 */
import { createRenderer, rendererDebug } from '../index';
import type { CharacterFactory, ModelLibrary, QualityLevel, RendererAPI, ViewMode, WallMode } from '../contracts';
import type { SimulationAPI } from '../../sim/contracts';
import { FX_KINDS } from '../../sim/contracts';
import { createPlaceholderModels } from './placeholders';
import { createPlaceholderCharacters } from './placeholderCharacters';
import { buildSampleWorld } from './sampleWorld';
import { createFakeSim, type FakeSim } from './fakeSim';
import { defaultAppearance } from '../../shared/appearance';
import { CAST_BODY_IDS, isCastBodyId } from '../../shared/cast';
import { buildWallAtlas } from '../build/wallPatterns';
import { buildFloorAtlas } from '../build/floorPatterns';
import { grassCanvas, sidewalkCanvas, asphaltCanvas } from '../world/groundTextures';
import { buildFxAtlas } from '../fx/fxTextures';
import { pickTruth, type TruthSample } from './pickTruth';

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'default';
const showUi = params.get('ui') !== '0';
const TICK_SEC = 0.25; // 1× = 1 game minute per second = 4 ticks/s

interface HarnessApi {
  ready: boolean;
  renderer: RendererAPI | null;
  libs: string;
  sim: string;
  error: string | null;
  setTime(minute: number | null, moon?: number): void;
  stats(): unknown;
  frames: number;
  frameMs: number;
  /** Mean / worst renderer.frame() time over the frames after the first 20 (shader compiles excluded). */
  frameMsAvg: number;
  frameMsMax: number;
  /** Render one frame and return the composed view (main canvas + overlay canvases/images) as a PNG data URL. */
  capture(): string;
  /** Simulate a GPU context loss + restore (WEBGL_lose_context); resolves after the restore. */
  loseContext(ms?: number): Promise<boolean>;
  /** The fake sim (null with sim=real) — leak/churn scripts mutate its state directly. */
  fake: FakeSim | null;
  /** The real sim when sim=real. */
  simApi: SimulationAPI | null;
  /** GPU ground truth of what is visible under each sample (dev/render.pick.cjs). */
  pickTruth(samples: TruthSample[]): string[];
  /** Cast body cache state of the real character factory (null with placeholder characters). */
  castStats(): unknown;
  /** Bodies of every live agent rig (`cast=` scenes wait until each shows its wanted body). */
  rigBodies(): { id: string; kind: string; body: string; wanted: string }[];
}

/** Extra layers composed into captures (thumbnail grid, CAZ preview). */
const captureLayers: ((g: CanvasRenderingContext2D) => void)[] = [];

const api: HarnessApi = { ready: false, renderer: null, libs: '', sim: '', error: null, setTime: () => undefined, stats: () => null, frames: 0, frameMs: 0, frameMsAvg: 0, frameMsMax: 0, capture: () => '', loseContext: async () => false, fake: null, simApi: null, pickTruth: () => [], castStats: () => null, rigBodies: () => [] };

/**
 * `cast=walker,boss,...` (or `cast=all`) gives the sample household cast bodies (cyclic over the agents, sorted by
 * id; `classic` keeps an agent procedural) - the real-browser check for the cast body runtime.
 */
function applyCastParam(agents: Record<string, { appearance: import('../../shared/appearance').ZombieAppearance }>): void {
  const raw = params.get('cast');
  if (!raw) return;
  const list = raw === 'all' ? [...CAST_BODY_IDS] : raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length) return;
  Object.keys(agents).sort().forEach((id, i) => {
    const b = list[i % list.length];
    const a = { ...agents[id].appearance };
    if (isCastBodyId(b)) a.body = b;
    else delete a.body;
    agents[id].appearance = a;
  });
}

(window as unknown as { __harness: HarnessApi }).__harness = api;

function parseTime(v: string | null): number | null {
  if (!v) return null;
  if (/^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadLibs(): Promise<{ models: ModelLibrary; characters: CharacterFactory; label: string }> {
  const baseUrl = import.meta.env.BASE_URL + 'assets/';
  const force = params.get('libs') === 'placeholder';
  let models: ModelLibrary | null = null;
  let characters: CharacterFactory | null = null;
  const labels: string[] = [];
  if (!force) {
    const m = import.meta.glob('../models/index.ts');
    const c = import.meta.glob('../characters/index.ts');
    try {
      const loader = Object.values(m)[0];
      if (loader) {
        const mod = (await loader()) as { createModelLibrary?: (o: { baseUrl: string }) => ModelLibrary };
        if (typeof mod.createModelLibrary === 'function') {
          models = mod.createModelLibrary({ baseUrl });
          labels.push('models:real');
        }
      }
    } catch (e) {
      console.warn('[harness] real model library failed, using placeholders', e);
    }
    try {
      const loader = Object.values(c)[0];
      if (loader) {
        const mod = (await loader()) as { createCharacterFactory?: (o: { baseUrl: string }) => CharacterFactory };
        if (typeof mod.createCharacterFactory === 'function') {
          characters = mod.createCharacterFactory({ baseUrl });
          labels.push('characters:real');
        }
      }
    } catch (e) {
      console.warn('[harness] real character factory failed, using placeholders', e);
    }
  }
  if (!models) {
    models = createPlaceholderModels();
    labels.push('models:placeholder');
  }
  if (!characters) {
    characters = createPlaceholderCharacters();
    labels.push('characters:placeholder');
  }
  return { models, characters, label: labels.join(' ') };
}

async function loadSim(): Promise<{ sim: SimulationAPI; fake: FakeSim | null; label: string }> {
  if (params.get('sim') === 'real') {
    try {
      const mods = import.meta.glob('../../sim/index.ts');
      const loader = Object.values(mods)[0];
      if (loader) {
        const mod = (await loader()) as {
          createNewWorld: (o: unknown) => import('../../sim/types').WorldState;
          createSimulation: (s: import('../../sim/types').WorldState) => SimulationAPI;
        };
        const app = defaultAppearance();
        const world = mod.createNewWorld({
          seed: 7,
          householdName: 'Gravesend',
          members: [
            { firstName: 'Mortimer', lastName: 'Gravesend', appearance: { ...app, skinTone: 0 }, traits: ['cheerful', 'gourmand', 'clumsy'], aspiration: null },
            { firstName: 'Ophelia', lastName: 'Gravesend', appearance: { ...app, skinTone: 5, hairStyle: 'bob', topColor: '#2c2346' }, traits: ['nightOwl', 'artistic', 'vain'], aspiration: null },
            { firstName: 'Bertha', lastName: 'Gravesend', appearance: { ...app, skinTone: 3, hairStyle: 'bun', topColor: '#7a6a3a' }, traits: ['partyAnimal', 'slob', 'grumpy'], aspiration: null },
          ],
          lotTemplate: 'starter',
          difficulty: 'normal',
        });
        if (params.get('world') === '0') delete (world as { town?: unknown }).town;
        return { sim: mod.createSimulation(world), fake: null, label: 'sim:real' };
      }
    } catch (e) {
      console.warn('[harness] real sim failed, using the fake sim', e);
    }
  }
  const world = buildSampleWorld({ stress: sceneName === 'stress', fx: sceneName === 'fx', world: params.get('world') === '1', worldAgents: Number(params.get('worldAgents') ?? '0') || 0 });
  applyCastParam(world.agents as never);
  const fake = createFakeSim(world);
  return { sim: fake, fake, label: 'sim:fake' };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text) e.textContent = text;
  return e;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const libs = await loadLibs();
  api.libs = libs.label;
  {
    // record rigs for automation (cast body checks): kind / body of every live rig
    const chars = libs.characters as CharacterFactory & { castStats?: () => unknown };
    const rigs: { id: string; rig: { kind?: string; body?: string; wantedBody?: string; root: { name: string; parent: unknown } } }[] = [];
    const create = chars.create.bind(chars);
    chars.create = (app, limbs) => {
      const r = create(app, limbs);
      rigs.push({ id: String(rigs.length), rig: r as never });
      return r;
    };
    api.castStats = () => chars.castStats?.() ?? null;
    api.rigBodies = () => rigs
      .filter((x) => x.rig.root.parent)
      .map((x) => ({ id: x.rig.root.name || x.id, kind: x.rig.kind ?? '?', body: x.rig.body ?? '?', wanted: x.rig.wantedBody ?? '?' }));
  }
  const renderer = createRenderer({ models: libs.models, characters: libs.characters, assetBaseUrl: import.meta.env.BASE_URL + 'assets/' });
  api.renderer = renderer;
  const dbg = rendererDebug(renderer);
  const quality = (params.get('quality') as QualityLevel) || 'high';
  await renderer.init(canvas, { quality, pixelRatio: window.devicePixelRatio || 1 });
  renderer.resize(canvas.clientWidth, canvas.clientHeight);
  // profiling A/B: perf=legacy turns the draw-call optimisations off (per-object batching, lot chunks, rig culling)
  if (params.get('perf') === 'legacy') dbg?.debugPerf({ batching: false, chunking: false, cullAgents: false });
  else if (params.get('perf') === 'nochunks') dbg?.debugPerf({ chunking: false });
  const { sim, fake, label } = await loadSim();
  api.sim = label;
  api.fake = fake;
  api.simApi = sim;
  renderer.attach(sim);
  if (!fake) {
    // real sim: frame the house like the game does (centre of indoor rooms)
    try {
      const w = sim.spatial.width();
      let sx = 0;
      let sz = 0;
      let n = 0;
      for (const room of sim.spatial.rooms()) {
        if (!room.indoor) continue;
        for (const idx of room.tiles) {
          sx += (idx % w) + 0.5;
          sz += Math.floor(idx / w) + 0.5;
          n++;
        }
      }
      if (n > 0) renderer.focus({ x: sx / n, z: sz / n }, true);
      renderer.setCamera({ distance: 24, pitch: 0.7 }, true);
    } catch (e) {
      console.warn('[harness] could not frame the house', e);
    }
  }
  // initial view
  const walls = params.get('walls') as WallMode | null;
  renderer.setWallMode(walls ?? 'cutaway');
  const view = params.get('view') as ViewMode | null;
  if (view) renderer.setViewMode(view);
  const camP = params.get('cam');
  if (camP) {
    const [yaw, pitch, distance, tx, tz] = camP.split(',').map(Number);
    renderer.setCamera({ yaw, pitch, distance, ...(Number.isFinite(tx) && Number.isFinite(tz) ? { target: { x: tx, z: tz } } : {}) }, true);
  }
  const t0 = parseTime(params.get('time'));
  const moon = params.get('moon') === '1' ? 1 : 0;
  api.setTime = (m, mo = 0) => dbg?.debugTime(m, mo);
  if (t0 !== null || moon) dbg?.debugTime(t0 ?? 0, moon);
  api.stats = () => dbg?.stats();
  api.pickTruth = (samples) => {
    const gl = dbg?.webgl();
    const scene = dbg?.scene();
    if (!dbg || !gl || !scene) return [];
    return pickTruth(gl, scene, dbg.camera(), canvas.clientWidth, canvas.clientHeight, samples);
  };
  api.capture = () => {
    // same task as the frame → the WebGL drawing buffer is still intact (no preserveDrawingBuffer needed)
    renderer.frame(1, 1 / 60);
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const g = c.getContext('2d');
    if (!g) return '';
    g.drawImage(canvas, 0, 0, c.width, c.height);
    for (const layer of captureLayers) {
      try {
        layer(g);
      } catch (e) {
        console.warn('[harness] capture layer failed', e);
      }
    }
    return c.toDataURL('image/png');
  };
  api.loseContext = async (ms = 600) => {
    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    await new Promise((r) => setTimeout(r, ms));
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, ms));
    return true;
  };
  // stats text layer for captures of ui=1 scenes (HTML overlays are not part of the canvas)
  if (showUi)
    captureLayers.push((g) => {
      const st = dbg?.stats();
      if (!st) return;
      const lines = [`fps ${st.fps.toFixed(0)}  draws ${st.drawCalls}  tris ${(st.triangles / 1000).toFixed(1)}k`, `objects ${st.objects} (${st.chunks} chunks)  zombies ${st.agents} (${st.agentsCulled} culled)`, `lamps ${st.lampsLit} (${st.lampLights} lights)  fx ${st.particles}  ${st.quality} @${st.pixelRatio.toFixed(2)}x`];
      const sx = canvas.width / canvas.clientWidth;
      g.save();
      g.font = `${12 * sx}px ui-monospace, monospace`;
      const w = 330 * sx;
      const h = (lines.length * 16 + 12) * sx;
      const x = canvas.width - w - 10 * sx;
      const y = canvas.height - h - 10 * sx;
      g.fillStyle = 'rgba(29,23,38,0.85)';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#e8e0c8';
      lines.forEach((l, i) => g.fillText(l, x + 9 * sx, y + (18 + i * 16) * sx));
      g.restore();
    });
  setupScene(renderer, fake, canvas);
  if (showUi) buildPanel(renderer, dbg, fake);
  const perf = el('div', { position: 'fixed', right: '10px', bottom: '10px', font: '12px/1.35 ui-monospace,monospace', color: '#e8e0c8', background: 'rgba(29,23,38,0.82)', padding: '6px 9px', borderRadius: '8px', border: '1px solid rgba(232,224,200,0.15)', pointerEvents: 'none', whiteSpace: 'pre' });
  if (showUi) document.body.appendChild(perf);
  installInput(renderer, canvas);
  addEventListener('resize', () => renderer.resize(canvas.clientWidth, canvas.clientHeight));
  let last = performance.now();
  let acc = 0;
  let paused = params.get('paused') === '1';
  (window as unknown as { __pause: (p: boolean) => void }).__pause = (p) => (paused = p);
  let perfTimer = 0;
  let perfSum = 0;
  let perfN = 0;
  // automation: stop rendering after N frames so screenshots never wait on a busy software GPU
  const maxFrames = Number(params.get('frames') ?? '0') || 0;
  const loop = (now: number) => {
    if (maxFrames > 0 && api.frames >= maxFrames) {
      document.body.dataset.done = '1';
      return;
    }
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // paused scenes still run a few warm-up frames so walkers settle into a mid-stride pose
    if (!paused || api.frames < 6) {
      acc += dt;
      let n = 0;
      while (acc >= TICK_SEC && n++ < 4) {
        acc -= TICK_SEC;
        try {
          sim.step();
        } catch (e) {
          console.warn('[harness] sim step failed', e);
        }
      }
      if (n >= 4) acc = 0;
    }
    try {
      renderer.consumeEvents(sim.drainEvents());
    } catch {
      /* fake */
    }
    const f0 = performance.now();
    renderer.frame(paused ? 1 : acc / TICK_SEC, dt);
    const ms = performance.now() - f0;
    api.frameMs = ms;
    if (api.frames >= 20) {
      perfSum += ms;
      perfN++;
      api.frameMsAvg = perfSum / perfN;
      if (ms > api.frameMsMax) api.frameMsMax = ms;
    }
    api.frames++;
    perfTimer += dt;
    if (showUi && perfTimer > 0.5 && dbg) {
      perfTimer = 0;
      const s = dbg.stats();
      perf.textContent = `fps ${s.fps.toFixed(0)}  draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(1)}k\nobjects ${s.objects} (${s.chunks} chunks)  zombies ${s.agents} (${s.agentsCulled} culled)  particles ${s.particles}\nlamps ${s.lampsLit} (${s.lampLights} lights)  walls ${s.wallSegments}\n${s.quality} @${s.pixelRatio.toFixed(2)}x  ${libs.label} ${label}`;
    }
  };
  requestAnimationFrame(loop);
  // let a few frames settle before declaring ready (shaders compiled, atlases uploaded)
  let settle = 0;
  const waitReady = () => {
    if (api.frames - settle > 6 || (maxFrames > 0 && api.frames >= maxFrames)) {
      api.ready = true;
      document.body.dataset.ready = '1';
    } else requestAnimationFrame(waitReady);
  };
  settle = api.frames;
  requestAnimationFrame(waitReady);
}

function setupScene(renderer: RendererAPI, fake: FakeSim | null, canvas: HTMLCanvasElement): void {
  const st = fake?.state;
  switch (sceneName) {
    case 'ghost-valid':
      renderer.setViewMode('buy');
      renderer.setPlacementGhost({ defId: 'sofa_moldy', x: 10, z: 18, rot: 2, valid: true, tint: '#3f5a4a', tiles: [{ x: 10, z: 18 }, { x: 11, z: 18 }] });
      renderer.setCamera({ target: { x: 11, z: 16.5 }, yaw: 0.6, pitch: 0.8, distance: 13 }, true);
      break;
    case 'ghost-invalid':
      renderer.setViewMode('buy');
      renderer.setPlacementGhost({ defId: 'fridge_cryo', x: 9, z: 15, rot: 0, valid: false, tiles: [{ x: 9, z: 15 }], blockedSlots: [{ x: 9, z: 16 }] });
      renderer.setCamera({ target: { x: 9.5, z: 15.5 }, yaw: 0.5, pitch: 0.82, distance: 12 }, true);
      break;
    case 'build': {
      renderer.setViewMode('build');
      const edges: string[] = [];
      for (let x = 22; x < 27; x++) edges.push(`h:${x}:12`, `h:${x}:17`);
      for (let z = 12; z < 17; z++) edges.push(`v:22:${z}`, `v:27:${z}`);
      renderer.setBuildOverlay({ edges, edgeMode: 'add', valid: true, tiles: [], label: '20 walls · $300', hoverEdge: 'h:28:11' });
      renderer.setCamera({ target: { x: 21, z: 15 }, yaw: 0.55, pitch: 0.85, distance: 22 }, true);
      break;
    }
    case 'fx': {
      renderer.setCamera({ target: { x: 15, z: 23.5 }, yaw: 0.0, pitch: 0.62, distance: 19 }, true);
      if (fake && st) {
        let i = 0;
        setInterval(() => {
          const kind = FX_KINDS[i % FX_KINDS.length];
          const x = 3 + (i % FX_KINDS.length) * 1.25;
          fake.emit({ type: 'fx', kind, pos: { x, z: 24 } });
          i++;
        }, 140);
      }
      break;
    }
    case 'caz': {
      const c = document.createElement('canvas');
      Object.assign(c.style, { position: 'fixed', left: '50%', top: '50%', width: '360px', height: '480px', transform: 'translate(-50%,-50%)', borderRadius: '14px', background: 'radial-gradient(ellipse at 50% 35%, #3a2f48, #1d1726 70%)', border: '1px solid rgba(232,224,200,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' });
      document.body.appendChild(c);
      const stage = renderer.createPreview(c);
      stage.resize(360, 480);
      captureLayers.push((g) => {
        (stage as unknown as { renderNow?: () => void }).renderNow?.();
        const r = c.getBoundingClientRect();
        const sx = canvas.width / canvas.clientWidth;
        g.save();
        g.fillStyle = 'rgba(29,23,38,0.92)';
        g.beginPath();
        g.roundRect(r.left * sx, r.top * sx, r.width * sx, r.height * sx, 14 * sx);
        g.fill();
        g.drawImage(c, r.left * sx, r.top * sx, r.width * sx, r.height * sx);
        g.restore();
      });
      const cazBody = params.get('cazbody');
      stage.setAppearance({
        ...defaultAppearance(), skinTone: 5, hairStyle: 'bun', topStyle: 'dress', topColor: '#6e2a35', eyeColor: '#c8ff9a',
        ...(isCastBodyId(cazBody) ? { body: cazBody, height: Number(params.get('cazheight') ?? '0.5') } : {}),
      });
      const cazLimbs = params.get('cazlimbs'); // e.g. armR:missing,legL:prosthetic
      if (cazLimbs) {
        const l = { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' } as Record<string, string>;
        for (const kv of cazLimbs.split(',')) {
          const [k, v] = kv.split(':');
          if (k in l && (v === 'missing' || v === 'prosthetic')) l[k] = v;
        }
        stage.setLimbs(l as never);
      }
      stage.setAnim('idle');
      let yaw = -0.5;
      setInterval(() => stage.setYaw((yaw += 0.02)), 50);
      break;
    }
    case 'thumbs': {
      const ids = ['sofa_velvet', 'lamp_skull', 'coffin_pine', 'tv_crt', 'fridge_cryo', 'mailbox_crooked', 'door_crypt', 'window_gothic', 'candelabra_drippy', 'table_wake', 'easel_morbid', 'item_meal'];
      const wrap = el('div', { position: 'fixed', left: '10px', bottom: '10px', display: 'grid', gridTemplateColumns: 'repeat(6, 128px)', gap: '6px', background: 'rgba(29,23,38,0.8)', padding: '8px', borderRadius: '12px' });
      document.body.appendChild(wrap);
      captureLayers.push((g) => {
        const sx = canvas.width / canvas.clientWidth;
        const wr = wrap.getBoundingClientRect();
        g.fillStyle = 'rgba(29,23,38,0.85)';
        g.fillRect(wr.left * sx, wr.top * sx, wr.width * sx, wr.height * sx);
        wrap.querySelectorAll('img').forEach((img) => {
          const r = img.getBoundingClientRect();
          g.fillStyle = '#2b2335';
          g.fillRect(r.left * sx, r.top * sx, r.width * sx, r.height * sx);
          for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2 === 0) {
            g.fillStyle = '#3a3046';
            g.fillRect((r.left + xx * 16) * sx, (r.top + yy * 16) * sx, 16 * sx, 16 * sx);
          }
          if ((img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0) g.drawImage(img as HTMLImageElement, r.left * sx, r.top * sx, r.width * sx, r.height * sx);
        });
      });
      for (const id of ids) {
        const img = el('img', { width: '128px', height: '128px', background: 'repeating-conic-gradient(#3a3046 0 25%, #2b2335 0 50%) 0 0/16px 16px', borderRadius: '8px' });
        img.dataset.id = id;
        wrap.appendChild(img);
        renderer.thumbnail(id, id === 'sofa_velvet' ? '#1f3a33' : null).then((url) => {
          img.src = url;
          img.dataset.loaded = '1';
        });
      }
      break;
    }
    case 'atlas': {
      // texture review sheet: wallpapers, floors, ground and FX atlas, drawn over the view
      const walls = buildWallAtlas(96);
      const floors = buildFloorAtlas(64);
      const sheets: [HTMLCanvasElement, number, number, number][] = [
        [walls.canvas, 8, 8, 0.29],
        [floors.canvas, 300, 8, 0.38],
        [grassCanvas(), 860, 8, 0.38],
        [sidewalkCanvas(), 860, 210, 0.38],
        [asphaltCanvas(), 860, 270, 0.6],
        [buildFxAtlas(), 300, 430, 0.9],
      ];
      captureLayers.push((g) => {
        const sx = canvas.width / canvas.clientWidth;
        g.fillStyle = '#1d1726';
        g.fillRect(0, 0, canvas.width, canvas.height);
        for (const [c, x, y, k] of sheets) {
          g.fillStyle = c === sheets[5][0] ? '#4a3f58' : '#000';
          g.fillRect(x * sx, y * sx, c.width * k * sx, c.height * k * sx);
          g.drawImage(c, x * sx, y * sx, c.width * k * sx, c.height * k * sx);
        }
      });
      break;
    }
    default:
      break;
  }
  if (st && sceneName === 'default') renderer.setSelection('a4');
}

function buildPanel(renderer: RendererAPI, dbg: ReturnType<typeof rendererDebug>, fake: FakeSim | null): void {
  const panel = el('div', { position: 'fixed', left: '10px', top: '10px', font: '13px system-ui,sans-serif', color: '#e8e0c8', background: 'rgba(29,23,38,0.86)', border: '1px solid rgba(232,224,200,0.15)', borderRadius: '12px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', width: '250px' });
  const title = el('div', { fontFamily: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif', fontSize: '16px', color: '#9fe870' }, 'Afterlife Lease · render');
  panel.appendChild(title);
  const row = (label: string, child: HTMLElement) => {
    const r = el('label', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }, label);
    r.appendChild(child);
    panel.appendChild(r);
  };
  const time = el('input');
  time.type = 'range';
  time.min = '0';
  time.max = '1439';
  time.value = String(parseTime(params.get('time')) ?? 720);
  const moon = el('input');
  moon.type = 'checkbox';
  moon.checked = params.get('moon') === '1';
  const applyTime = () => dbg?.debugTime(Number(time.value), moon.checked ? 1 : 0);
  time.oninput = applyTime;
  moon.onchange = applyTime;
  row('time', time);
  row('full moon', moon);
  const sel = <T extends string>(opts: readonly T[], cur: T, on: (v: T) => void) => {
    const s = el('select');
    for (const o of opts) {
      const op = el('option', {}, o);
      op.value = o;
      s.appendChild(op);
    }
    s.value = cur;
    s.onchange = () => on(s.value as T);
    return s;
  };
  row('walls', sel(['up', 'cutaway', 'down'] as const, renderer.getWallMode(), (v) => renderer.setWallMode(v)));
  row('view', sel(['live', 'buy', 'build'] as const, (params.get('view') as ViewMode) ?? 'live', (v) => renderer.setViewMode(v)));
  row('quality', sel(['low', 'medium', 'high', 'ultra'] as const, (params.get('quality') as QualityLevel) ?? 'high', (v) => renderer.setQuality(v)));
  row('scene', sel(['default', 'fx', 'ghost-valid', 'ghost-invalid', 'build', 'caz', 'stress', 'thumbs', 'atlas'] as const, sceneName as 'default', (v) => {
    params.set('scene', v);
    location.search = params.toString();
  }));
  const hint = el('div', { fontSize: '11px', opacity: '0.7', lineHeight: '1.4' }, 'drag: orbit · shift/right-drag: pan · wheel: zoom · Q/E: rotate 45° · WASD: pan · click: select');
  panel.appendChild(hint);
  if (fake) {
    const burst = el('button', { marginTop: '4px' }, 'burst every FX');
    burst.onclick = () => FX_KINDS.forEach((k, i) => fake.emit({ type: 'fx', kind: k, pos: { x: 3 + i * 1.25, z: 24 } }));
    panel.appendChild(burst);
  }
  document.body.appendChild(panel);
}

function installInput(renderer: RendererAPI, canvas: HTMLCanvasElement): void {
  let drag: { x: number; y: number; button: number; shift: boolean; moved: boolean } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.offsetX, y: e.offsetY, button: e.button, shift: e.shiftKey, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const p = renderer.pick(e.offsetX, e.offsetY, { walls: false, tiles: false });
      renderer.setHover(p.kind === 'agent' ? { kind: 'agent', id: p.agentId } : p.kind === 'object' ? { kind: 'object', id: p.objectId } : null);
      renderer.pickGrid(e.offsetX, e.offsetY);
      return;
    }
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.x = e.offsetX;
    drag.y = e.offsetY;
    if (drag.button === 2 || drag.shift) renderer.pan(dx, dy);
    else renderer.orbit(-dx * 0.006, dy * 0.004);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && drag.button === 0) {
      const p = renderer.pick(e.offsetX, e.offsetY);
      if (p.kind === 'agent') renderer.setSelection(p.agentId);
      console.info('[harness] pick', p);
    }
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.zoom(-e.deltaY / 100);
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'q') renderer.rotateCamera(-1);
    if (k === 'e') renderer.rotateCamera(1);
    if (k === 'w') renderer.panWorld(0, -1);
    if (k === 's') renderer.panWorld(0, 1);
    if (k === 'a') renderer.panWorld(-1, 0);
    if (k === 'd') renderer.panWorld(1, 0);
    if (k === 'f') renderer.focus('a1');
  });
}

main().catch((e) => {
  console.error('[harness] failed', e);
  api.error = String(e && (e as Error).stack ? (e as Error).stack : e);
  document.body.dataset.error = '1';
});
