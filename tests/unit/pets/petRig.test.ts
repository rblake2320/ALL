/**
 * W-013 render part: the pet rig loader (src/render/pets) against the real GLBs and manifest.pets.json, and the
 * PetLayer renderer hook that draws whatever the sim lists in the optional world fields `pets` / `strays`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PET_ANIM_STATES,
  PET_VARIANTS,
  createPetLibrary,
  petClipFor,
  readPetViews,
  PetLayer,
  type FetchLike,
} from '../../../src/render/pets';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.pets.json'), 'utf8')) as { species: Record<string, unknown>; clips: { name: string }[] };
const SPECIES = Object.keys(manifest.species);
const CLIP_NAMES = manifest.clips.map((c) => c.name);

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

const lib = createPetLibrary({ baseUrl: 'assets/', fetch: fsFetch });

describe('pet anim states', () => {
  it('maps every pet anim state to a clip the manifest ships', () => {
    expect([...PET_ANIM_STATES]).toEqual(['idle', 'walk', 'run', 'sit', 'sleep', 'eat', 'play']);
    for (const extra of ['beg', 'flee']) expect(CLIP_NAMES).toContain(petClipFor(extra)); // the stray clips
    for (const s of PET_ANIM_STATES) expect(CLIP_NAMES).toContain(petClipFor(s));
  });
  it('falls back to idle for unknown states', () => {
    expect(petClipFor('dance')).toBe('idle');
    expect(petClipFor(undefined)).toBe('idle');
  });
});

describe('pet library', () => {
  it('loads every species from the manifest', async () => {
    await lib.ready;
    expect(lib.species().sort()).toEqual([...SPECIES].sort());
    expect(lib.failed()).toEqual([]);
  });

  it.each(SPECIES)('%s: resolves both variants, shows exactly one mesh, and every anim state finds its clip', async (sp) => {
    await lib.ready;
    for (const v of PET_VARIANTS) {
      const rig = lib.create(sp, v);
      expect(rig, `${sp}/${v}`).not.toBeNull();
      const want = v === 'normal' ? 'Pet_normal' : 'Pet_undead';
      const other = v === 'normal' ? 'Pet_undead' : 'Pet_normal';
      expect(rig!.root.getObjectByName(want)?.visible).toBe(true);
      expect(rig!.root.getObjectByName(other)?.visible).toBe(false);
      let skinned = 0;
      rig!.root.getObjectByName(want)!.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
      });
      expect(skinned).toBeGreaterThan(0);
      for (const s of PET_ANIM_STATES) {
        rig!.play(s);
        expect(rig!.currentClip).toBe(petClipFor(s));
        expect(rig!.hasClip(petClipFor(s))).toBe(true);
      }
      rig!.update(0.1);
      rig!.dispose();
    }
  });

  it('returns null for an unknown species', async () => {
    await lib.ready;
    expect(lib.create('unicorn', 'normal')).toBeNull();
  });

  it('follows a position and facing like agents (rotation.y = facing, +Z front)', async () => {
    await lib.ready;
    const rig = lib.create('dog', 'normal')!;
    rig.setPose(3.5, 0, -2, Math.PI / 2);
    expect(rig.root.position.toArray()).toEqual([3.5, 0, -2]);
    expect(rig.root.rotation.y).toBeCloseTo(Math.PI / 2);
    rig.dispose();
  });

  it('dispose releases the rig geometry and materials and leaves the template intact', async () => {
    await lib.ready;
    const rig = lib.create('cat', 'undead')!;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      geos.add(m.geometry);
      for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
    });
    expect(geos.size).toBeGreaterThan(0);
    let gDisposed = 0;
    let mDisposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => gDisposed++);
    for (const m of mats) m.addEventListener('dispose', () => mDisposed++);
    rig.dispose();
    expect(gDisposed).toBe(geos.size);
    expect(mDisposed).toBe(mats.size);
    expect(rig.root.parent).toBeNull();
    // a new rig after disposal still works (template geometry was not the one released)
    const again = lib.create('cat', 'undead')!;
    let verts = 0;
    again.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.attributes.position) verts += m.geometry.attributes.position.count;
    });
    expect(verts).toBeGreaterThan(0);
    again.dispose();
  });
});

describe('readPetViews (the world\'s pets block)', () => {
  it('renders nothing when the world has no pets block', () => {
    expect(readPetViews({})).toEqual([]);
    expect(readPetViews(null)).toEqual([]);
    expect(readPetViews({ pets: 'nope' })).toEqual([]);
    expect(readPetViews({ pets: [] })).toEqual([]);
  });
  it('reads pets and strays from the block, tags the kind, defaults the variant, and drops malformed entries', () => {
    const views = readPetViews({
      pets: {
        pets: [{ id: 'p1', species: 'cat', pos: { x: 1, z: 2 }, facing: 0, anim: 'sit' }, { id: 'bad' }, { id: 'p9', species: 'dog', pos: { x: NaN, z: 1 } }],
        strays: [{ id: 's1', species: 'raccoon', variant: 'undead', pos: { x: 4, z: 5 }, facing: 1, anim: 'beg' }],
      },
    });
    expect(views.map((v) => [v.id, v.kind, v.variant])).toEqual([
      ['p1', 'pet', 'normal'],
      ['s1', 'stray', 'undead'],
    ]);
  });
});

describe('PetLayer', () => {
  const block = (pets: unknown[], strays: unknown[] = []) => ({ pets: { pets, strays } });
  const settle = async (layer: PetLayer, world: unknown, inView?: (x: number, z: number) => boolean) => {
    for (let i = 0; i < 60 && layer.count === 0; i++) {
      layer.sync(world, 0.016, inView);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('creates, moves, re-variants and removes rigs to match the world', async () => {
    await lib.ready;
    const layer = new PetLayer(lib);
    const world = block([{ id: 'p1', species: 'cat', variant: 'normal', pos: { x: 1, z: 2 }, facing: 0, anim: 'walk' }]);
    layer.sync(world, 0.016);
    const firstMaterialRevision = layer.materialRevision;
    expect(layer.count).toBe(1);
    expect(firstMaterialRevision).not.toBe('');
    expect(layer.group.children.length).toBe(1);
    expect(layer.rigOf('p1')!.root.position.x).toBe(1);
    expect(layer.rigOf('p1')!.currentClip).toBe('walk');

    // a step of the sim is eased, not teleported
    world.pets.pets = [{ id: 'p1', species: 'cat', variant: 'undead', pos: { x: 2, z: 2 }, facing: 0, anim: 'sleep' }];
    layer.sync(world, 0.016);
    expect(layer.materialRevision).not.toBe(firstMaterialRevision);
    expect(layer.rigOf('p1')!.variant).toBe('undead');
    expect(layer.rigOf('p1')!.currentClip).toBe('sleep');
    world.pets.pets = [{ id: 'p1', species: 'cat', variant: 'undead', pos: { x: 2.3, z: 2 }, facing: 0, anim: 'walk' }];
    layer.sync(world, 0.016);
    const x = layer.rigOf('p1')!.root.position.x;
    expect(x).toBeGreaterThan(2);
    expect(x).toBeLessThan(2.3);

    layer.sync({}, 0.016);
    expect(layer.count).toBe(0);
    expect(layer.materialRevision).toBe('');
    expect(layer.group.children.length).toBe(0);
    layer.dispose();
  });

  it('loads a species only when one of its animals is in view, and an out-of-view animal gets no rig', async () => {
    const fetched: string[] = [];
    const spy: FetchLike = (url, init) => {
      fetched.push(url);
      return fsFetch(url, init);
    };
    const lazy = createPetLibrary({ baseUrl: 'assets/', fetch: spy });
    const layer = new PetLayer(lazy);
    const world = block([{ id: 'p1', species: 'cat', pos: { x: 1, z: 2 }, facing: 0, anim: 'idle' }], [{ id: 's1', species: 'dog', pos: { x: 50, z: 2 }, facing: 0, anim: 'idle' }]);
    const view = (x: number) => x < 10; // the dog is far off screen
    expect(fetched).toEqual([]); // nothing is fetched until something is in view
    await settle(layer, world, view);
    expect(layer.count).toBe(1);
    expect(layer.rigOf('s1')).toBeNull();
    expect(fetched.some((u) => u.endsWith('manifest.pets.json'))).toBe(true);
    expect(fetched.some((u) => u.endsWith('cat.glb'))).toBe(true);
    expect(fetched.some((u) => u.endsWith('dog.glb'))).toBe(false); // never asked for the dog's model
    expect(fetched.some((u) => u.endsWith('crow.glb') || u.endsWith('raccoon.glb'))).toBe(false);
    layer.dispose();
    lazy.dispose();
    expect(lazy.create('cat', 'normal')).toBeNull(); // disposed
  });

  it('picks the nearest animal along a ray', async () => {
    await lib.ready;
    const layer = new PetLayer(lib);
    layer.sync(block([{ id: 'p1', species: 'cat', pos: { x: 3, z: 3 }, facing: 0, anim: 'idle' }], [{ id: 's1', species: 'dog', pos: { x: 3, z: 6 }, facing: 0, anim: 'idle' }]), 0.016);
    const ray = new THREE.Ray(new THREE.Vector3(3, 0.35, 0), new THREE.Vector3(0, 0, 1));
    const hit = layer.pick(ray)!;
    expect(hit.id).toBe('p1');
    expect(hit.kind).toBe('pet');
    expect(layer.pick(new THREE.Ray(new THREE.Vector3(20, 0.35, 0), new THREE.Vector3(0, 0, 1)))).toBeNull();
    layer.dispose();
  });
});

// ───────────── review F2 / F3 (resource release, disposed libraries) ─────────────
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { vi } from 'vitest';

function skeletonsOf(root: THREE.Object3D): THREE.Skeleton[] {
  const out = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) out.add(m.skeleton);
  });
  return [...out];
}

/** A scene as the GLTF loader would return it: one skinned mesh with spied-on geometry, material and skeleton. */
function fakeScene() {
  const bone = new THREE.Bone();
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const skeleton = new THREE.Skeleton([bone]);
  mesh.add(bone);
  mesh.bind(skeleton);
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene, spies: { geometry: vi.spyOn(geometry, 'dispose'), material: vi.spyOn(material, 'dispose'), skeleton: vi.spyOn(skeleton, 'dispose') } };
}

describe('rig disposal releases the rig own skeletons (review F2)', () => {
  it('each owned cloned skeleton and its bone texture is disposed exactly once; a sibling rig and the library are untouched', async () => {
    await lib.ready;
    const a = lib.create('dog', 'normal')!;
    const b = lib.create('dog', 'normal')!;
    const sa = skeletonsOf(a.root);
    const sb = skeletonsOf(b.root);
    expect(sa.length).toBeGreaterThan(0);
    expect(sb.length).toBe(sa.length);
    expect(sa.some((s) => sb.includes(s))).toBe(false);
    for (const sk of [...sa, ...sb]) sk.computeBoneTexture();
    const texA = sa.map((s) => vi.spyOn(s.boneTexture!, 'dispose'));
    const texB = sb.map((s) => vi.spyOn(s.boneTexture!, 'dispose'));
    const skA = sa.map((s) => vi.spyOn(s, 'dispose'));
    const skB = sb.map((s) => vi.spyOn(s, 'dispose'));
    a.dispose();
    a.dispose();
    for (const t of texA) expect(t).toHaveBeenCalledTimes(1);
    for (const s of skA) expect(s).toHaveBeenCalledTimes(1);
    for (const t of texB) expect(t).not.toHaveBeenCalled();
    for (const s of skB) expect(s).not.toHaveBeenCalled();
    b.update(0.1);
    const c = lib.create('dog', 'normal')!;
    expect(c).not.toBeNull();
    c.dispose();
    b.dispose();
    for (const t of texB) expect(t).toHaveBeenCalledTimes(1);
  });
});

describe('a disposed pet library does no work and leaks no late scene (review F3)', () => {
  it('after dispose, load() and ready fetch nothing at all', async () => {
    const fetched: string[] = [];
    const l = createPetLibrary({ baseUrl: 'assets/', fetch: (u, i) => (fetched.push(u), fsFetch(u, i)) });
    l.dispose();
    await l.load('cat');
    await l.ready;
    expect(fetched).toEqual([]);
    expect(l.create('cat', 'normal')).toBeNull();
  });

  it('dispose while the manifest is coming: the model is never requested', async () => {
    const fetched: string[] = [];
    let release: (() => void) | null = null;
    const gated: FetchLike = (u, i) => {
      fetched.push(u);
      return new Promise<void>((res) => {
        release = res;
      }).then(() => fsFetch(u, i));
    };
    const l = createPetLibrary({ baseUrl: 'assets/', fetch: gated });
    const p = l.load('cat');
    await new Promise((r) => setTimeout(r, 20));
    expect(fetched).toEqual(['assets/manifest.pets.json']);
    l.dispose();
    release!();
    await p;
    expect(fetched).toEqual(['assets/manifest.pets.json']);
  });

  it('dispose while the GLB bytes are coming: it is not even parsed', async () => {
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    let releaseGlb: (() => void) | null = null;
    const gated: FetchLike = (u, i) =>
      u.endsWith('.glb')
        ? new Promise<void>((res) => {
            releaseGlb = res;
          }).then(() => fsFetch(u, i))
        : fsFetch(u, i);
    const l = createPetLibrary({ baseUrl: 'assets/', fetch: gated });
    const p = l.load('cat');
    for (let i = 0; i < 100 && !releaseGlb; i++) await new Promise((r) => setTimeout(r, 10));
    expect(releaseGlb).not.toBeNull();
    l.dispose();
    releaseGlb!();
    await p;
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('dispose while the GLB is being parsed: the scene that finishes afterwards is released, not kept', async () => {
    const f = fakeScene();
    let finish: ((g: unknown) => void) | null = null;
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(() => new Promise((res) => (finish = res)) as never);
    const l = createPetLibrary({ baseUrl: 'assets/', fetch: fsFetch });
    const p = l.load('cat');
    for (let i = 0; i < 100 && !finish; i++) await new Promise((r) => setTimeout(r, 10));
    expect(finish).not.toBeNull();
    l.dispose();
    finish!({ scene: f.scene, animations: [] });
    await p;
    expect(f.spies.geometry).toHaveBeenCalledTimes(1);
    expect(f.spies.material).toHaveBeenCalledTimes(1);
    expect(f.spies.skeleton).toHaveBeenCalledTimes(1);
    expect(l.create('cat', 'normal')).toBeNull();
    parse.mockRestore();
  });
});
