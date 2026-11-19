/**
 * Pure unit tests for the model-library building blocks: manifest parsing (adversarial), URL joining, tint
 * normalisation, material variants, placeholders, state sanitising, the task queue and timeouts.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DIM } from '../../../src/shared/dimensions';
import { ENV_MODELS, PHYSICAL_SPECS } from '../../../src/shared/catalog';
import { isSafeRelativePath, joinUrl, parseManifest } from '../../../src/render/models/manifest';
import { MaterialVariants, normalizeTint, EMISSIVE_LEVELS, hasEmissive } from '../../../src/render/models/variants';
import { PlaceholderFactory } from '../../../src/render/models/placeholder';
import { allModelIds, ENV_DIMS, shapeBounds, shapeOf } from '../../../src/render/models/specs';
import { DEFAULT_VISUAL_STATE, partKindOf, sanitizeState } from '../../../src/render/models/dynamic';
import { TaskQueue, withTimeout, parseGlb } from '../../../src/render/models/loader';
import type { ObjectVisualState } from '../../../src/render/contracts';

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseManifest({
      version: 3,
      objects: { chair_creaky: { file: 'models/objects/chair_creaky.glb', bytes: 10, sha256: 'ab', tris: 5, bounds: { min: [-1, 0, -1], max: [1, 2, 1] } } },
    });
    expect(m.version).toBe(3);
    expect(m.objects.chair_creaky.bounds).toEqual({ min: [-1, 0, -1], max: [1, 2, 1] });
  });

  it.each([null, undefined, 42, 'x', [], { objects: [] }, { objects: 'nope' }])('tolerates junk input %#', (raw) => {
    const m = parseManifest(raw);
    expect(m.objects).toEqual({});
  });

  it('drops unsafe paths, bad ids and broken bounds', () => {
    const m = parseManifest({
      version: 1,
      objects: {
        a: { file: '../secret.glb' },
        b: { file: '/abs.glb' },
        c: { file: 'http://evil/x.glb' },
        d: { file: 'models\\..\\x.glb' },
        'Bad-Id': { file: 'ok.glb' },
        e: { file: 'models/objects/e.glb', bounds: { min: [0, 0], max: [1, 1, 1] } },
        f: { file: 'models/objects/f.glb', bounds: { min: [2, 0, 0], max: [1, 1, 1] } },
        g: { file: 'models/objects/g.glb', bytes: NaN, tris: 'many' },
      },
    });
    expect(Object.keys(m.objects).sort()).toEqual(['e', 'f', 'g']);
    expect(m.objects.e.bounds).toBeNull();
    expect(m.objects.f.bounds).toBeNull();
    expect(m.objects.g.bytes).toBe(0);
    expect(m.objects.g.tris).toBe(0);
  });

  it('isSafeRelativePath / joinUrl', () => {
    expect(isSafeRelativePath('models/objects/x.glb')).toBe(true);
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('a/../b')).toBe(false);
    expect(isSafeRelativePath('C:/x')).toBe(false);
    expect(isSafeRelativePath('x y.glb')).toBe(false);
    expect(joinUrl('./assets/', 'm.json')).toBe('./assets/m.json');
    expect(joinUrl('./assets', 'm.json')).toBe('./assets/m.json');
    expect(joinUrl('', 'm.json')).toBe('m.json');
  });
});

describe('normalizeTint', () => {
  it.each([
    ['#AbCdEf', '#abcdef'],
    ['#abc', '#aabbcc'],
    [' #123456 ', '#123456'],
    ['123456', null],
    ['#12345', null],
    ['red', null],
    [null, null],
    [undefined, null],
  ])('%s -> %s', (i, o) => {
    expect(normalizeTint(i as string | null | undefined)).toBe(o);
  });
});

describe('MaterialVariants', () => {
  const base = () => {
    const m = new THREE.MeshStandardMaterial({ color: '#808080', emissive: '#ffaa00', emissiveIntensity: 4 });
    m.name = 'Paint';
    return m;
  };

  it('returns the base for the identity variant and caches everything else', () => {
    const v = new MaterialVariants();
    const b = base();
    expect(v.paint(b, null, 0)).toBe(b);
    const t = v.paint(b, '#ff0000', 0);
    expect(t).not.toBe(b);
    expect(v.paint(b, '#ff0000', 0)).toBe(t);
    expect(t.name).toBe('Paint');
    expect(v.size).toBe(1);
    const dirty = v.paint(b, '#ff0000', 4) as THREE.MeshStandardMaterial;
    expect(dirty.color.r).toBeLessThan((t as THREE.MeshStandardMaterial).color.r);
    expect(v.emissive(b, EMISSIVE_LEVELS)).toBe(b);
    const off = v.emissive(b, 0) as THREE.MeshStandardMaterial;
    expect(off.emissiveIntensity).toBe(0);
    expect((v.emissive(b, 4) as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(2);
    expect(v.emissive(b, 99)).toBe(b);
    expect(v.isOwned(off)).toBe(true);
    expect(v.isOwned(b)).toBe(false);
    v.dispose();
    expect(v.size).toBe(0);
  });

  it('hasEmissive only for lit standard materials', () => {
    expect(hasEmissive(base())).toBe(true);
    expect(hasEmissive(new THREE.MeshStandardMaterial())).toBe(false);
    expect(hasEmissive(new THREE.MeshBasicMaterial())).toBe(false);
    expect(hasEmissive(null)).toBe(false);
  });
});

describe('placeholders', () => {
  const pf = new PlaceholderFactory();

  it.each(PHYSICAL_SPECS.map((s) => [s.id, s] as const))('%s placeholder fits the catalog footprint/placement', (id, s) => {
    const g = pf.create(shapeOf(id));
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    expect(b.isEmpty()).toBe(false);
    if (s.placement === 'floor') {
      expect(b.max.x - b.min.x).toBeLessThanOrEqual(s.footprint.w + 0.01);
      expect(b.max.y).toBeCloseTo(Math.max(0.02, s.height), 1);
      expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
    } else if (s.placement === 'wall') {
      expect(b.min.z).toBeGreaterThanOrEqual(-1e-6);
      expect(b.min.y).toBeGreaterThan(1.0);
    } else if (s.placement === 'door') {
      expect(b.max.y).toBeGreaterThanOrEqual(DIM.DOOR_HEIGHT);
      expect(b.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
    } else if (s.placement === 'window') {
      expect(b.min.y).toBeGreaterThan(DIM.WINDOW_SILL - 0.2);
    }
    const front = g.children.find((c) => c.name.endsWith('_front'));
    expect(front).toBeDefined();
    const fb = new THREE.Box3().setFromObject(front!);
    expect(fb.getCenter(new THREE.Vector3()).z, 'front notch marks +Z').toBeGreaterThan(0);
    const paint = g.children.find((c) => ((c as THREE.Mesh).material as THREE.Material)?.name === 'Paint');
    expect(paint).toBeDefined();
  });

  it('shares geometry per id and disposes cleanly', () => {
    const a = pf.create(shapeOf('sofa_velvet'));
    const b = pf.create(shapeOf('sofa_velvet'));
    expect((a.children[0] as THREE.Mesh).geometry).toBe((b.children[0] as THREE.Mesh).geometry);
    expect(() => pf.dispose()).not.toThrow();
  });

  it('env and unknown shapes are sized sensibly', () => {
    const house = shapeBounds(shapeOf('env_house_a'));
    expect(house[4]).toBeGreaterThan(5);
    const unknown = shapeOf('???');
    expect(unknown.w).toBe(1);
    expect(allModelIds()).toContain('env_fence');
  });
});

describe('dynamic helpers', () => {
  it('partKindOf recognises dynamic node names only', () => {
    expect(partKindOf('screen')).toBe('screen');
    expect(partKindOf('serving_3')).toBe('serving');
    expect(partKindOf('serving_4')).toBeNull();
    expect(partKindOf('door_leaf')).toBeNull();
    expect(partKindOf('flame_0')).toBeNull();
  });

  it('sanitizeState clamps and defaults every field', () => {
    const out = { ...DEFAULT_VISUAL_STATE } as ObjectVisualState;
    sanitizeState({ servings: 7.9, progress: -1, dirt: NaN, powered: undefined } as unknown as ObjectVisualState, out);
    expect(out).toMatchObject({ servings: 4, progress: 0, dirt: 0, powered: true, inUse: false });
    sanitizeState(null, out);
    expect(out.servings).toBe(4);
    sanitizeState({ servings: 2.6, progress: 0.25, dirt: 3, powered: false } as ObjectVisualState, out);
    expect(out).toMatchObject({ servings: 2, progress: 0.25, dirt: 1, powered: false });
  });
});

describe('loader helpers', () => {
  it('TaskQueue never runs more than the limit at once', async () => {
    const q = new TaskQueue(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        q.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1 + (i % 3)));
          active--;
          if (i === 7) throw new Error('task failure must not wedge the queue');
          return i;
        }).catch(() => -1),
      ),
    );
    expect(peak).toBe(3);
    expect(q.running).toBe(0);
  });

  it('withTimeout rejects slow promises and passes fast ones', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'slow')).rejects.toThrow(/timed out/);
    await expect(withTimeout(Promise.resolve(5), 1000, 'fast')).resolves.toBe(5);
  });

  it('parseGlb rejects non-GLB payloads', async () => {
    await expect(parseGlb(new ArrayBuffer(4), '')).rejects.toThrow();
    const junk = new TextEncoder().encode('{"asset":{"version":"2.0"}} padding padding').buffer as ArrayBuffer;
    await expect(parseGlb(junk, '')).rejects.toThrow(/magic/);
  });
});

describe('environment sizes come from the catalog (single source of truth)', () => {
  it('ENV_DIMS mirrors ENV_MODELS[].size exactly', () => {
    expect(Object.keys(ENV_DIMS).sort()).toEqual(ENV_MODELS.map((e) => e.id).sort());
    for (const e of ENV_MODELS) {
      expect(ENV_DIMS[e.id]).toEqual([e.size.w, e.size.d, e.size.h]);
      const sh = shapeOf(e.id);
      expect(sh.placement).toBe('env');
      expect([sh.w, sh.d, sh.height]).toEqual([e.size.w, e.size.d, e.size.h]);
    }
  });

  it('is frozen (callers cannot corrupt the shared table)', () => {
    expect(Object.isFrozen(ENV_DIMS)).toBe(true);
    expect(Object.isFrozen(ENV_DIMS.env_house_a)).toBe(true);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'prototype key %s is an unknown id (misc fallback), not an env prop',
    (id) => {
      const sh = shapeOf(id);
      expect(sh.placement).toBe('floor');
      expect(sh.category).toBe('misc');
      for (const v of [sh.w, sh.d, sh.height]) expect(Number.isFinite(v)).toBe(true);
    },
  );
});
