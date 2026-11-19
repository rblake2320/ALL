/**
 * ModelLibrary behaviour against the real GLBs (loaded in Node through an injected file-system fetch):
 * loading/progress, cloning + shared resources, tint caching, every dynamic part, allocation-free updates,
 * placeholders for missing/corrupt/unknown assets, adversarial inputs and disposal.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectVisualState } from '../../../src/render/contracts';
import { createModelLibrary, DEFAULT_VISUAL_STATE, type FetchLike, type ModelLibraryExt } from '../../../src/render/models/index';
import { PHYSICAL_SPECS, ENV_MODELS } from '../../../src/shared/catalog';

const PUBLIC = join(__dirname, '..', '..', '..', 'public');

function response(buf: Buffer | null, status = 200) {
  return {
    ok: !!buf && status === 200,
    status: buf ? status : 404,
    arrayBuffer: async () => {
      const b = buf ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    json: async () => JSON.parse((buf ?? Buffer.from('null')).toString('utf8')) as unknown,
  };
}

interface FsFetchOpts {
  missing?: Set<string>;
  corrupt?: Set<string>;
  hang?: Set<string>;
  manifestOverride?: unknown;
  onRequest?: (url: string) => void;
  delayMs?: number;
}

function fsFetch(o: FsFetchOpts = {}): FetchLike & { inFlight: number; maxInFlight: number } {
  const f = (async (url: string) => {
    f.inFlight++;
    f.maxInFlight = Math.max(f.maxInFlight, f.inFlight);
    try {
      o.onRequest?.(url);
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      const rel = url.replace(/^\/+/, '');
      const name = rel.split('/').pop() ?? '';
      const id = name.replace(/\.glb$/, '');
      if (o.hang?.has(id)) await new Promise(() => undefined);
      if (name === 'manifest.objects.json' && o.manifestOverride !== undefined) {
        return response(Buffer.from(JSON.stringify(o.manifestOverride)));
      }
      if (o.missing?.has(id)) return response(null, 404);
      if (o.corrupt?.has(id)) return response(Buffer.from('this is definitely not a glb file, sorry'));
      try {
        return response(await readFile(join(PUBLIC, rel)));
      } catch {
        return response(null, 404);
      }
    } finally {
      f.inFlight--;
    }
  }) as FetchLike & { inFlight: number; maxInFlight: number };
  f.inFlight = 0;
  f.maxInFlight = 0;
  return f;
}

const silent = (): void => undefined;
const state = (p: Partial<ObjectVisualState> = {}): ObjectVisualState => ({ ...DEFAULT_VISUAL_STATE, ...p });

function find(o: THREE.Object3D, name: string): THREE.Object3D {
  const n = o.getObjectByName(name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

function meshesOf(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}

function emissiveOf(o: THREE.Object3D): number {
  let best = 0;
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((c as THREE.Mesh).isMesh && m && m.isMeshStandardMaterial) best = Math.max(best, m.emissiveIntensity * Math.max(m.emissive.r, m.emissive.g, m.emissive.b));
  });
  return best;
}

let lib: ModelLibraryExt;
let fetchSpy: ReturnType<typeof fsFetch>;

beforeAll(async () => {
  fetchSpy = fsFetch();
  lib = createModelLibrary({ baseUrl: '/assets/', fetch: fetchSpy, onWarning: silent });
  await lib.ready;
}, 60000);

describe('loading', () => {
  it('loads every manifest model, reports progress 1 and respects the concurrency limit', () => {
    const ids = [...PHYSICAL_SPECS.map((s) => s.id), ...ENV_MODELS.map((e) => e.id)];
    for (const id of ids) {
      expect(lib.has(id), id).toBe(true);
      expect(lib.status(id)).toBe('loaded');
    }
    expect(lib.progress()).toBe(1);
    expect(fetchSpy.maxInFlight).toBeLessThanOrEqual(6);
    expect(lib.has('no_such_model')).toBe(false);
    expect(lib.status('no_such_model')).toBe('unknown');
  });

  it('reports partial progress while loading and never exceeds 1', async () => {
    const slow = fsFetch({ delayMs: 5 });
    const l = createModelLibrary({ baseUrl: '/assets', fetch: slow, onWarning: silent, concurrency: 2 });
    expect(l.progress()).toBe(0);
    const seen: number[] = [];
    const timer = setInterval(() => seen.push(l.progress()), 2);
    await l.ready;
    clearInterval(timer);
    expect(slow.maxInFlight).toBeLessThanOrEqual(3); // manifest + 2 models
    expect(l.progress()).toBe(1);
    expect(seen.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(seen.some((p) => p > 0 && p < 1)).toBe(true);
    l.dispose();
  }, 60000);
});

describe('create', () => {
  it('clones share geometry and materials with the prototype', () => {
    const a = lib.create('chair_creaky');
    const b = lib.create('chair_creaky');
    expect(a).not.toBe(b);
    const ma = meshesOf(a);
    const mb = meshesOf(b);
    expect(ma.length).toBeGreaterThan(0);
    expect(ma.length).toBe(mb.length);
    for (let i = 0; i < ma.length; i++) {
      expect(ma[i].geometry).toBe(mb[i].geometry);
      expect(ma[i].material).toBe(mb[i].material);
    }
    expect(lib.isPlaceholder(a)).toBe(false);
    expect(a.userData.modelId).toBe('chair_creaky');
  });

  it('sets shadows: opaque parts cast, glass/emissive parts do not', () => {
    const w = lib.create('window_grimy');
    for (const m of meshesOf(w)) {
      const mat = m.material as THREE.Material;
      if (mat.transparent) expect(m.castShadow, mat.name).toBe(false);
      expect(m.receiveShadow).toBe(true);
    }
    const lamp = lib.create('lamp_skull');
    for (const m of meshesOf(find(lamp, 'bulb'))) expect(m.castShadow).toBe(false);
  });

  it('tints only Paint materials and caches one material per tint', () => {
    const base = lib.create('sofa_moldy');
    const t1a = lib.create('sofa_moldy', '#3f5a4a');
    const t1b = lib.create('sofa_moldy', '#3F5A4A');
    const t2 = lib.create('sofa_moldy', '#6e3b3b');
    const paintOf = (o: THREE.Object3D) => meshesOf(o).find((m) => (m.material as THREE.Material).name === 'Paint')!.material as THREE.MeshStandardMaterial;
    expect(paintOf(t1a)).toBe(paintOf(t1b));
    expect(paintOf(t1a)).not.toBe(paintOf(t2));
    expect(paintOf(t1a)).not.toBe(paintOf(base));
    expect('#' + paintOf(t1a).color.getHexString()).toBe('#3f5a4a');
    const others = (o: THREE.Object3D) => meshesOf(o).filter((m) => (m.material as THREE.Material).name !== 'Paint').map((m) => m.material);
    expect(others(t1a)).toEqual(others(base));
  });

  it('ignores invalid tints instead of throwing', () => {
    for (const t of ['not-a-colour', '#12', '', 'rgb(1,2,3)', null, undefined, 42 as unknown as string]) {
      const o = lib.create('chair_creaky', t as string | null);
      expect(o).toBeInstanceOf(THREE.Object3D);
    }
  });

  it('returns a catalog-sized placeholder for unknown ids (never throws)', () => {
    const o = lib.create('no_such_model');
    expect(lib.isPlaceholder(o)).toBe(true);
    expect(meshesOf(o).length).toBeGreaterThan(0);
    const odd = lib.create(undefined as unknown as string);
    expect(odd).toBeInstanceOf(THREE.Object3D);
  });

  it('starts in the default visual state (doors shut, overlays hidden)', () => {
    const f = lib.create('fridge_humming');
    expect(find(f, 'broken').visible).toBe(false);
    const door = find(f, 'door');
    expect(Math.abs(new THREE.Euler().setFromQuaternion(door.quaternion).y)).toBeLessThan(1e-6);
    const sink = lib.create('sink_rusty');
    expect(find(sink, 'water').visible).toBe(false);
  });
});

describe('update drives dynamic parts', () => {
  it('servings: serving_N visible while N < servings', () => {
    const meal = lib.create('item_meal');
    for (let n = 0; n <= 4; n++) {
      lib.update(meal, state({ servings: n }), 1);
      for (let i = 0; i < 4; i++) expect(find(meal, `serving_${i}`).visible).toBe(i < n);
    }
    lib.update(meal, state({ servings: 99 }), 1);
    expect(find(meal, 'serving_3').visible).toBe(true);
    lib.update(meal, state({ servings: -3 }), 1);
    expect(find(meal, 'serving_0').visible).toBe(false);
  });

  it('screens glow only when in use and powered, and flicker', () => {
    const tv = lib.create('tv_crt');
    const screen = find(tv, 'screen');
    lib.update(tv, state({ inUse: false }), 1);
    expect(emissiveOf(screen)).toBe(0);
    lib.update(tv, state({ inUse: true, powered: false }), 1);
    expect(emissiveOf(screen)).toBe(0);
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) {
      lib.update(tv, state({ inUse: true }), 1 + k * 0.037);
      seen.add(Math.round(emissiveOf(screen) * 1000));
    }
    expect([...seen].every((v) => v > 0)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('bulbs light when lit; candle flames show and flicker in scale', () => {
    const lamp = lib.create('lamp_skull');
    lib.update(lamp, state({ lit: false }), 0);
    expect(emissiveOf(find(lamp, 'bulb'))).toBe(0);
    lib.update(lamp, state({ lit: true }), 0);
    expect(emissiveOf(find(lamp, 'bulb'))).toBeGreaterThan(1);

    const cand = lib.create('candelabra_drippy');
    const flame = find(cand, 'flame');
    lib.update(cand, state({ lit: false }), 0);
    expect(flame.visible).toBe(false);
    lib.update(cand, state({ lit: true }), 0.1);
    expect(flame.visible).toBe(true);
    const f0 = find(cand, 'flame_0');
    const ys = new Set<number>();
    for (let k = 0; k < 20; k++) {
      lib.update(cand, state({ lit: true }), 0.1 + k * 0.05);
      ys.add(Math.round(f0.scale.y * 1000));
    }
    expect(ys.size).toBeGreaterThan(3);
  });

  it('stove burners glow while cooking; coils stay visible when off', () => {
    const st = lib.create('stove_greasefire');
    const flame = find(st, 'flame');
    lib.update(st, state({ inUse: false }), 1);
    expect(flame.visible).toBe(true);
    expect(emissiveOf(flame)).toBe(0);
    lib.update(st, state({ inUse: true }), 1);
    expect(emissiveOf(flame)).toBeGreaterThan(0.5);
    const gas = lib.create('stove_necrochef');
    lib.update(gas, state({ inUse: false }), 1);
    expect(find(gas, 'flame').visible).toBe(false);
    lib.update(gas, state({ inUse: true }), 1);
    expect(find(gas, 'flame').visible).toBe(true);
  });

  it('the fire item always burns', () => {
    const fire = lib.create('item_fire');
    lib.update(fire, state({ lit: false, powered: false }), 3);
    expect(find(fire, 'flame').visible).toBe(true);
    expect(emissiveOf(find(fire, 'flame'))).toBeGreaterThan(1);
  });

  it('water shows in use; frost shows when powered; broken shows + jitters when broken', () => {
    const tub = lib.create('tub_icebath');
    lib.update(tub, state({ inUse: true, powered: true }), 1);
    expect(find(tub, 'water').visible).toBe(true);
    expect(find(tub, 'frost').visible).toBe(true);
    lib.update(tub, state({ inUse: false, powered: false }), 2);
    expect(find(tub, 'water').visible).toBe(false);
    expect(find(tub, 'frost').visible).toBe(false);
    const tv = lib.create('tv_crt');
    const broken = find(tv, 'broken');
    lib.update(tv, state({ broken: true }), 1);
    expect(broken.visible).toBe(true);
    const p1 = broken.position.clone();
    lib.update(tv, state({ broken: true }), 1.37);
    expect(broken.position.distanceTo(p1)).toBeGreaterThan(0);
    lib.update(tv, state({ broken: false }), 2);
    expect(broken.visible).toBe(false);
  });

  it('fridge door swings open smoothly while in use and closes again', () => {
    const f = lib.create('fridge_humming');
    const door = find(f, 'door');
    const yaw = () => new THREE.Euler().setFromQuaternion(door.quaternion, 'YXZ').y;
    lib.update(f, state({ inUse: false }), 0);
    lib.update(f, state({ inUse: true }), 0.1);
    const early = yaw();
    expect(early).toBeLessThan(0);
    for (let k = 2; k < 40; k++) lib.update(f, state({ inUse: true }), k * 0.1);
    expect(yaw()).toBeLessThan(early);
    expect(yaw()).toBeCloseTo(-2.18, 2);   // 125 degrees: the leaf clears the widest body (W-073 D1)
    for (let k = 40; k < 80; k++) lib.update(f, state({ inUse: false }), k * 0.1);
    expect(Math.abs(yaw())).toBeLessThan(1e-6);
    // opening swings the free edge toward +Z (the front)
    for (let k = 80; k < 120; k++) lib.update(f, state({ inUse: true }), k * 0.1);
    f.updateMatrixWorld(true);
    const leaf = find(f, 'door_leaf');
    const box = new THREE.Box3().setFromObject(leaf);
    expect(box.max.z).toBeGreaterThan(0.8);
  });

  it('mailbox flag rotates up when there is mail', () => {
    const mb = lib.create('mailbox_crooked');
    const flag = find(mb, 'flag');
    const plateHeight = () => {
      mb.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(flag).max.y;
    };
    lib.update(mb, state({ flag: false }), 0);
    const down = plateHeight();
    for (let k = 1; k < 30; k++) lib.update(mb, state({ flag: true }), k * 0.1);
    expect(plateHeight()).toBeGreaterThan(down + 0.1);
  });

  it('canvas strokes appear with progress; finished paintings always show', () => {
    const easel = lib.create('easel_morbid');
    const strokes = () => [0, 1, 2, 3].map((i) => find(easel, `canvas_stroke_${i}`).visible);
    lib.update(easel, state({ progress: 0 }), 1);
    expect(strokes()).toEqual([false, false, false, false]);
    lib.update(easel, state({ progress: 0.5 }), 1);
    expect(strokes()).toEqual([true, true, false, false]);
    lib.update(easel, state({ progress: 1 }), 1);
    expect(strokes()).toEqual([true, true, true, true]);
    const canvasMat = (find(easel, 'canvas') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    lib.update(easel, state({ progress: 0 }), 1);
    const blank = (find(easel, 'canvas') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(canvasMat).not.toBe(blank);
    const item = lib.create('item_painting');
    lib.update(item, state({ progress: 0 }), 1);
    expect(find(item, 'canvas_stroke_0').visible).toBe(true);
  });

  it('speakers pulse while playing; pump bobs while in use', () => {
    const bb = lib.create('stereo_boombox');
    const cone = find(bb, 'speaker_0');
    const scales = new Set<number>();
    for (let k = 0; k < 30; k++) {
      lib.update(bb, state({ inUse: true }), k * 0.033);
      scales.add(Math.round(cone.scale.x * 1000));
    }
    expect(scales.size).toBeGreaterThan(3);
    lib.update(bb, state({ inUse: false }), 2);
    expect(cone.scale.x).toBeCloseTo(1, 5);
    const st = lib.create('station_embalming');
    const pump = find(st, 'pump');
    const y0 = pump.position.y;
    const ys: number[] = [];
    for (let k = 0; k < 60; k++) {
      lib.update(st, state({ inUse: true }), k * 0.05);
      ys.push(pump.position.y);
    }
    expect(Math.max(...ys) - y0).toBeGreaterThan(0.03);
  });

  it('dirt and burning darken Paint through shared variants', () => {
    const lum = (o: THREE.Object3D) => {
      const m = meshesOf(o).find((x) => (x.material as THREE.Material).name === 'Paint')!.material as THREE.MeshStandardMaterial;
      return m.color.r + m.color.g + m.color.b;
    };
    const a = lib.create('chair_creaky');
    const b = lib.create('chair_creaky');
    lib.update(a, state({ dirt: 0 }), 0);
    const clean = lum(a);
    lib.update(a, state({ dirt: 1 }), 0);
    const dirty = lum(a);
    lib.update(b, state({ dirt: 1 }), 0);
    expect(dirty).toBeLessThan(clean);
    expect(meshesOf(a)[0].material).toBe(meshesOf(b)[0].material);
    lib.update(a, state({ dirt: 0, burning: true }), 0);
    expect(lum(a)).toBeLessThanOrEqual(dirty);
  });

  it('does not create materials once warm (per-frame updates only swap shared references)', () => {
    const ids = ['tv_crt', 'candelabra_drippy', 'fridge_cryo', 'zapper_fly', 'kit_reanimation', 'item_bonepile', 'easel_morbid'];
    const objs = ids.map((id) => lib.create(id, null));
    const run = (t0: number, frames: number) => {
      for (let k = 0; k < frames; k++) {
        const s = state({ inUse: k % 2 === 0, lit: true, powered: true, progress: (k % 11) / 10, dirt: (k % 5) / 4 });
        for (const o of objs) lib.update(o, s, t0 + k * 0.016);
      }
    };
    run(0, 400);
    const warm = lib.variantCount();
    run(0, 400); // identical frames: every variant is already cached
    expect(lib.variantCount()).toBe(warm);
    run(10, 4000); // new times may reach other quantised levels, but the cache stays bounded
    const bound = lib.variantCount();
    run(50, 4000);
    expect(lib.variantCount()).toBeLessThanOrEqual(bound + 4);
    expect(lib.variantCount()).toBeLessThan(400);
  });

  it('survives garbage state and unknown instances', () => {
    const tv = lib.create('tv_crt');
    const bad = [null, undefined, {}, { servings: NaN, progress: Infinity, dirt: -5 }, { inUse: 'yes' }] as unknown as ObjectVisualState[];
    for (const s of bad) {
      expect(() => lib.update(tv, s, NaN)).not.toThrow();
      expect(() => lib.update(tv, s, -1e12)).not.toThrow();
    }
    expect(() => lib.update(new THREE.Group(), state(), 1)).not.toThrow();
    expect(() => lib.update(null as unknown as THREE.Object3D, state(), 1)).not.toThrow();
  });

  it('leaves materials alone once something else replaced them (e.g. renderer window glow)', () => {
    const lamp = lib.create('env_streetlamp');
    const bulbMesh = meshesOf(find(lamp, 'bulb'))[0];
    const foreign = new THREE.MeshStandardMaterial({ name: 'foreign' });
    bulbMesh.material = foreign;
    lib.update(lamp, state({ lit: true }), 1);
    lib.update(lamp, state({ lit: false }), 2);
    expect(bulbMesh.material).toBe(foreign);
  });
});

describe('bounds', () => {
  it('matches the manifest for loaded models and returns copies', () => {
    const b = lib.bounds('bed_normal');
    expect(b.max.y).toBeGreaterThan(1.0);
    expect(b.min.x).toBeLessThan(-0.9);
    b.max.y = 999;
    expect(lib.bounds('bed_normal').max.y).toBeLessThan(2);
  });

  it('falls back to catalog-sized bounds for unknown ids', () => {
    const b = lib.bounds('totally_unknown');
    expect(b.isEmpty()).toBe(false);
    expect(Number.isFinite(b.max.y)).toBe(true);
  });
});

describe('failure handling', () => {
  it('missing and corrupt GLBs become placeholders; ready still resolves', async () => {
    const warnings: string[] = [];
    const l = createModelLibrary({
      baseUrl: '/assets/',
      fetch: fsFetch({ missing: new Set(['chair_creaky']), corrupt: new Set(['sofa_moldy']) }),
      onWarning: (m) => warnings.push(m),
    });
    await expect(l.ready).resolves.toBeUndefined();
    expect(l.status('chair_creaky')).toBe('failed');
    expect(l.status('sofa_moldy')).toBe('failed');
    expect(l.has('chair_creaky')).toBe(false);
    const ph = l.create('sofa_moldy', '#123456');
    expect(l.isPlaceholder(ph)).toBe(true);
    const box = new THREE.Box3().setFromObject(ph);
    expect(box.max.x - box.min.x).toBeGreaterThan(1.5); // 2-tile sofa
    expect(box.max.z).toBeGreaterThan(0.3); // front notch at +Z
    const paint = meshesOf(ph).find((m) => (m.material as THREE.Material).name === 'Paint')!;
    expect('#' + (paint.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('#123456');
    expect(warnings.some((w) => w.includes('chair_creaky'))).toBe(true);
    expect(l.progress()).toBe(1);
    expect(l.has('table_wake')).toBe(true);
    l.dispose();
  }, 60000);

  it('a missing manifest means placeholders everywhere and progress 1', async () => {
    const l = createModelLibrary({ baseUrl: '/nowhere/', fetch: fsFetch(), onWarning: silent });
    await l.ready;
    expect(l.progress()).toBe(1);
    expect(l.isPlaceholder(l.create('fridge_humming'))).toBe(true);
    expect(l.manifestIds()).toEqual([]);
    l.dispose();
  });

  it('a hostile manifest (bad paths, junk entries) is sanitised', async () => {
    const l = createModelLibrary({
      baseUrl: '/assets/',
      fetch: fsFetch({
        manifestOverride: {
          version: 1,
          objects: {
            chair_creaky: { file: 'models/objects/chair_creaky.glb' },
            evil: { file: '../../etc/passwd' },
            url: { file: 'https://example.com/x.glb' },
            junk: 42,
            'BAD ID': { file: 'models/objects/sofa_moldy.glb' },
          },
        },
      }),
      onWarning: silent,
    });
    await l.ready;
    expect(l.manifestIds()).toEqual(['chair_creaky']);
    expect(l.has('chair_creaky')).toBe(true);
    l.dispose();
  });

  it('a fetch that throws or never answers cannot hang or reject ready', async () => {
    const throwing: FetchLike = () => {
      throw new Error('boom');
    };
    const l1 = createModelLibrary({ baseUrl: '/assets/', fetch: throwing, onWarning: silent });
    await expect(l1.ready).resolves.toBeUndefined();
    const l2 = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch({ hang: new Set(['bed_normal']) }), onWarning: silent, timeoutMs: 300 });
    await expect(l2.ready).resolves.toBeUndefined();
    expect(l2.status('bed_normal')).toBe('failed');
    expect(l2.has('sofa_velvet')).toBe(true);
    l1.dispose();
    l2.dispose();
  }, 60000);

  it('placeholders created before the manifest arrives are upgraded too', async () => {
    const l = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch({ delayMs: 15 }), onWarning: silent });
    const early = l.create('table_rickety');
    const never = l.create('not_in_manifest');
    expect(l.isPlaceholder(early)).toBe(true);
    await l.ready;
    expect(l.isPlaceholder(early)).toBe(false);
    expect(l.isPlaceholder(never)).toBe(true);
    l.dispose();
  }, 60000);

  it('placeholders created while loading are upgraded in place when the model arrives', async () => {
    const l = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch({ delayMs: 20 }), onWarning: silent, concurrency: 1 });
    // wait for the manifest, then grab an instance before its GLB arrives
    while (l.status('item_ash') === 'unknown') await new Promise((r) => setTimeout(r, 2));
    const early = l.create('item_ash');
    expect(l.isPlaceholder(early)).toBe(true);
    await l.ready;
    expect(l.isPlaceholder(early)).toBe(false);
    expect(meshesOf(early).some((m) => (m.material as THREE.Material).name === 'Ash')).toBe(true);
    l.dispose();
  }, 60000);
});

describe('release', () => {
  it('unbinds an instance: later updates are no-ops, shared geometry/materials are never disposed', () => {
    const inst = lib.create('tv_crt');
    const screen = find(inst, 'screen');
    let disposed = 0;
    for (const m of meshesOf(inst)) {
      m.geometry.addEventListener('dispose', () => disposed++);
      (m.material as THREE.Material).addEventListener('dispose', () => disposed++);
    }
    lib.update(inst, state({ inUse: true, powered: true }), 1);
    const lit = emissiveOf(screen);
    expect(lit).toBeGreaterThan(0.5);
    expect(typeof lib.release).toBe('function');
    lib.release!(inst);
    lib.update(inst, state({ inUse: false }), 2);
    expect(emissiveOf(screen)).toBe(lit); // the library no longer drives it
    expect(disposed).toBe(0);
    // a fresh instance of the same model still works (prototype resources intact)
    const again = lib.create('tv_crt');
    lib.update(again, state({ inUse: true, powered: true }), 3);
    expect(emissiveOf(find(again, 'screen'))).toBeGreaterThan(0.5);
  });

  it('tolerates double release, foreign objects and junk without throwing', () => {
    const inst = lib.create('chair_creaky');
    expect(() => {
      lib.release!(inst);
      lib.release!(inst);
      lib.release!(new THREE.Group());
      lib.release!(null as unknown as THREE.Object3D);
      lib.release!({} as unknown as THREE.Object3D);
    }).not.toThrow();
  });

  it('a released placeholder is not upgraded behind the caller\'s back', async () => {
    const l = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch({ delayMs: 15 }), onWarning: silent });
    const kept = l.create('table_rickety');
    const dropped = l.create('table_rickety');
    l.release!(dropped);
    await l.ready;
    expect(l.isPlaceholder(kept)).toBe(false);
    expect(dropped.children.some((c) => c.name === 'table_rickety_placeholder')).toBe(true);
    l.dispose();
  }, 60000);
});

describe('decision #23: static-batching invariants', () => {
  /** Nodes the renderer batches per node/kid: the library may only move/show/hide them, never touch materials. */
  const MOVE_ONLY = /^(door|flag|pump|water|frost|speaker|broken|serving_[0-3])$/;
  function underMoveOnly(o: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) if (MOVE_ONLY.test(n.name)) return true;
    return false;
  }
  function snap(m: THREE.Material): string {
    const s = m as THREE.MeshStandardMaterial;
    return JSON.stringify([s.color?.getHex(), s.emissive?.getHex(), s.emissiveIntensity, s.roughness, s.metalness, s.opacity,
      s.transparent, s.side, s.name]);
  }
  const STATES: Partial<ObjectVisualState>[] = [
    {}, { powered: true, inUse: true, lit: true }, { broken: true, inUse: true }, { dirt: 0.5 }, { dirt: 1, lit: true },
    { burning: true }, { servings: 0 }, { servings: 2 }, { flag: true }, { progress: 0.6 }, { powered: false }, {},
  ];
  const IDS = [...PHYSICAL_SPECS.map((x) => x.id), ...ENV_MODELS.map((e) => e.id)];
  it.each(IDS)('%s: move-only nodes keep their materials; Paint is swapped to immutable variants', (id) => {
    const inst = lib.create(id, '#556677');
    const fixed = new Map<THREE.Mesh, THREE.Material>();
    const seen = new Map<THREE.Material, string>();
    const observe = (): void => {
      for (const m of meshesOf(inst)) {
        const mat = m.material as THREE.Material;
        if (!seen.has(mat)) seen.set(mat, snap(mat));
      }
    };
    for (const m of meshesOf(inst)) {
      if (underMoveOnly(m, inst) && (m.material as THREE.Material).name !== 'Paint') fixed.set(m, m.material as THREE.Material);
    }
    observe();
    let t = 0.5;
    for (const st of STATES) {
      for (let k = 0; k < 3; k++) {
        lib.update(inst, state(st), (t += 0.37));
        observe();
      }
    }
    for (const [m, mat] of fixed) expect(m.material, `${m.name} under a move-only node had its material swapped`).toBe(mat);
    for (const [mat, before] of seen) expect(snap(mat), `${mat.name} was mutated in place`).toBe(before);
    lib.release!(inst);
  });
});

describe('power', () => {
  /** Brightest emissive among meshes that are actually visible (hidden overlays like 'broken' sparks don't count).
   *  Decorative candles flagged userData.alwaysOn (decision 14e: table_wake, tv_seance) burn regardless of power. */
  function visibleEmissive(o: THREE.Object3D): number {
    let best = 0;
    o.traverseVisible((c) => {
      for (let n: THREE.Object3D | null = c; n && n !== o; n = n.parent) if (n.userData?.alwaysOn === true) return;
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if ((c as THREE.Mesh).isMesh && m && m.isMeshStandardMaterial) {
        best = Math.max(best, m.emissiveIntensity * Math.max(m.emissive.r, m.emissive.g, m.emissive.b));
      }
    });
    return best;
  }
  const ALWAYS_ON = new Set(['stove_necrochef']); // radioactive goo glows by itself (see structure.test.ts)
  const POWERED = PHYSICAL_SPECS.filter((s) => s.needsPower).map((s) => s.id);

  it.each(POWERED.filter((id) => !ALWAYS_ON.has(id)))('%s goes completely dark when unpowered', (id) => {
    const inst = lib.create(id);
    lib.update(inst, state({ powered: false, inUse: false, lit: false, broken: false }), 1.3);
    expect(visibleEmissive(inst)).toBe(0);
    lib.release!(inst);
  });

  it.each(['tub_icebath', 'desk_hauntedpc', 'arcade_tombstone', 'fridge_cryo', 'coffin_chillrest'])(
    '%s shows a status light while powered', (id) => {
      const inst = lib.create(id);
      lib.update(inst, state({ powered: true, inUse: false, lit: false }), 0.5);
      expect(visibleEmissive(inst)).toBeGreaterThan(0.3);
      lib.update(inst, state({ powered: false }), 0.6);
      expect(visibleEmissive(inst)).toBe(0);
      lib.release!(inst);
    });
});

describe('dispose', () => {
  it('frees cached tint/dirt/emissive variants and placeholder resources, and is idempotent', async () => {
    const l = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch({ missing: new Set(['sofa_moldy']) }), onWarning: silent });
    await l.ready;
    const tinted = l.create('chair_creaky', '#336699');
    l.update(tinted, state({ dirt: 1 }), 1);
    const tv = l.create('tv_crt');
    l.update(tv, state({ inUse: true, powered: true }), 1.1);
    const ph = l.create('sofa_moldy');
    expect(l.isPlaceholder(ph)).toBe(true);
    expect(l.variantCount()).toBeGreaterThan(0);
    const mats = new Set<THREE.Material>();
    const geos = new Set<THREE.BufferGeometry>();
    for (const o of [tinted, tv, ph]) {
      for (const m of meshesOf(o)) {
        mats.add(m.material as THREE.Material);
        geos.add(m.geometry);
      }
    }
    const disposedM = new Set<THREE.Material>();
    const disposedG = new Set<THREE.BufferGeometry>();
    for (const m of mats) m.addEventListener('dispose', () => disposedM.add(m));
    for (const g of geos) g.addEventListener('dispose', () => disposedG.add(g));
    l.dispose();
    expect(disposedM.size, 'every material in use (base, variants, placeholder) is freed').toBe(mats.size);
    expect(disposedG.size, 'every geometry in use is freed').toBe(geos.size);
    expect(l.variantCount()).toBe(0);
    // everything stays callable (and inert) afterwards
    expect(() => {
      l.dispose();
      l.update(tinted, state({ inUse: true }), 2);
      l.release!(tv);
      l.bounds('chair_creaky');
      l.bounds('no_such_thing');
      l.progress();
    }).not.toThrow();
    expect(l.has('chair_creaky')).toBe(false);
    const after = l.create('chair_creaky');
    expect(after.children.length).toBe(0);
  }, 60000);

  it('models that finish loading after dispose() are discarded, and ready still resolves', async () => {
    const l = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch({ delayMs: 25 }), onWarning: silent });
    const early = l.create('table_rickety');
    l.dispose();
    await l.ready;
    expect(l.has('table_rickety')).toBe(false);
    // the early placeholder is never upgraded with a late (already-disposed) prototype
    expect(l.isPlaceholder(early)).toBe(true);
    expect(early.children.map((c) => c.name)).toContain('table_rickety_placeholder');
    expect(() => l.update(early, state(), 1)).not.toThrow();
  }, 60000);

  it('disposes prototype geometry and keeps create() safe afterwards', async () => {
    const l = createModelLibrary({ baseUrl: '/assets/', fetch: fsFetch(), onWarning: silent });
    await l.ready;
    const inst = l.create('table_rickety');
    let disposed = 0;
    for (const m of meshesOf(inst)) m.geometry.addEventListener('dispose', () => disposed++);
    l.dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(() => l.create('table_rickety')).not.toThrow();
    expect(l.has('table_rickety')).toBe(false);
    expect(() => l.dispose()).not.toThrow();
  }, 60000);
});
