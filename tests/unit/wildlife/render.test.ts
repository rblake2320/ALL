/**
 * W-075 render part (src/render/wildlife): the wildlife library against the real GLBs and manifest.wildlife.json,
 * and the layer that draws the sim's ambient critter list. Species load only when a critter is in view; fireflies have
 * no model; everything is released on dispose.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ambientWildlife } from '../../../src/sim/systems/wildlife';
import { createWildlifeLibrary, WildlifeLayer } from '../../../src/render/wildlife';
import type { FetchLike } from '../../../src/render/models/loader';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
const fsFetch: FetchLike = (url) => {
  const rel = url.replace(/^assets\//, '');
  try {
    const buf = readFileSync(join(ASSETS, rel));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(ab), json: () => Promise.resolve(JSON.parse(buf.toString('utf8'))) });
  } catch {
    return Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.reject(new Error('404')), json: () => Promise.reject(new Error('404')) });
  }
};

const world = (tick: number) => ({ seed: 1234, tick, lot: { width: 30, depth: 30 } });
const LAYOUT = { width: 30, depth: 30 };
/** A game tick at which the sim lists at least `n` modelled critters. */
function tickWith(n: number): number {
  for (let t = 0; t < 200_000; t += 80) {
    if (ambientWildlife(1234, 'home', t, LAYOUT).filter((c) => c.species !== 'firefly').length >= n) return t;
  }
  throw new Error('no such tick');
}

describe('wildlife library', () => {
  it('fetches nothing until a species is asked for, then only that species', async () => {
    const fetched: string[] = [];
    const lib = createWildlifeLibrary({ baseUrl: 'assets/', fetch: (u, i) => (fetched.push(u), fsFetch(u, i)) });
    expect(fetched).toEqual([]);
    expect(lib.create('songbird')).toBeNull();
    await lib.load('songbird');
    expect(fetched.filter((u) => u.endsWith('.glb'))).toEqual(['assets/models/wildlife/songbird.glb']);
    const rig = lib.create('songbird')!;
    expect(rig).not.toBeNull();
    expect(rig.hasClip('fly')).toBe(true);
    rig.play('fly');
    expect(rig.currentClip).toBe('fly');
    rig.play('no-such-clip'); // unknown state: a clip it does have
    expect(rig.hasClip(rig.currentClip)).toBe(true);
    rig.dispose();
    lib.dispose();
    expect(lib.create('songbird')).toBeNull();
  });
});

describe('WildlifeLayer', () => {
  it('draws the sim critters once their models are in, skips fireflies, and disposes everything', async () => {
    const lib = createWildlifeLibrary({ baseUrl: 'assets/', fetch: fsFetch });
    const layer = new WildlifeLayer(lib);
    const tick = tickWith(2);
    const expected = ambientWildlife(1234, 'home', tick, LAYOUT).filter((c) => c.species !== 'firefly');
    expect(layer.materialRevision).toBe('');
    for (let i = 0; i < 80 && layer.count < expected.length; i++) {
      layer.sync(world(tick), 10 + i * 0.2, 0.016);
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(layer.count).toBe(expected.length);
    const populatedRevision = layer.materialRevision;
    expect(populatedRevision).not.toBe('');
    expect(layer.group.children.length).toBe(expected.length);
    const first = expected[0];
    const rig = layer.group.children.find((c) => c.name === `wildlife:${first.species}`)!;
    expect(rig).toBeDefined();
    layer.dispose();
    expect(layer.count).toBe(0);
    expect(layer.materialRevision).toBe('');
    lib.dispose();
  });

  it('an out-of-view critter gets no rig and costs no download', async () => {
    const fetched: string[] = [];
    const lib = createWildlifeLibrary({ baseUrl: 'assets/', fetch: (u, i) => (fetched.push(u), fsFetch(u, i)) });
    const layer = new WildlifeLayer(lib);
    layer.sync(world(tickWith(1)), 10, 0.016, () => false);
    await new Promise((r) => setTimeout(r, 50));
    expect(layer.count).toBe(0);
    expect(fetched).toEqual([]);
    layer.dispose();
    lib.dispose();
  });
});

// ───────────── review F2 / F3 for the wildlife rigs and library ─────────────
import * as THREE from 'three';
import { vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

describe('wildlife rig disposal and a disposed library (review F2 / F3)', () => {
  it('a rig disposes its own cloned skeleton and bone texture once; a sibling is untouched', async () => {
    const lib = createWildlifeLibrary({ baseUrl: 'assets/', fetch: fsFetch });
    await lib.load('songbird');
    const a = lib.create('songbird')!;
    const b = lib.create('songbird')!;
    const sk = (r: THREE.Object3D) => {
      const out = new Set<THREE.Skeleton>();
      r.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh) out.add(m.skeleton);
      });
      return [...out];
    };
    const sa = sk(a.root);
    const sb = sk(b.root);
    expect(sa.length).toBeGreaterThan(0);
    expect(sa.some((s) => sb.includes(s))).toBe(false);
    for (const s of [...sa, ...sb]) s.computeBoneTexture();
    const ta = sa.map((s) => vi.spyOn(s.boneTexture!, 'dispose'));
    const tb = sb.map((s) => vi.spyOn(s.boneTexture!, 'dispose'));
    a.dispose();
    a.dispose();
    for (const t of ta) expect(t).toHaveBeenCalledTimes(1);
    for (const t of tb) expect(t).not.toHaveBeenCalled();
    b.dispose();
    lib.dispose();
  });

  it('after dispose the library fetches nothing, and a scene that finishes parsing after dispose is released', async () => {
    const fetched: string[] = [];
    const l1 = createWildlifeLibrary({ baseUrl: 'assets/', fetch: (u, i) => (fetched.push(u), fsFetch(u, i)) });
    l1.dispose();
    await l1.load('songbird');
    expect(fetched).toEqual([]);

    const bone = new THREE.Bone();
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    const skeleton = new THREE.Skeleton([bone]);
    mesh.add(bone);
    mesh.bind(skeleton);
    const scene = new THREE.Group();
    scene.add(mesh);
    const spies = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(skeleton, 'dispose')];
    let finish: ((g: unknown) => void) | null = null;
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(() => new Promise((res) => (finish = res)) as never);
    const l2 = createWildlifeLibrary({ baseUrl: 'assets/', fetch: fsFetch });
    const p = l2.load('songbird');
    for (let i = 0; i < 100 && !finish; i++) await new Promise((r) => setTimeout(r, 10));
    expect(finish).not.toBeNull();
    l2.dispose();
    finish!({ scene, animations: [] });
    await p;
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(l2.create('songbird')).toBeNull();
    parse.mockRestore();
  });
});
