import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { envLayout, fenceLayout, streetLampLayout, mergeSimple, envSide } from '../../../src/render/world/dressing';
import { openingCutFor, applyShadowFlags } from '../../../src/render/objects/objects';
import { isBatchable, batchHost, StaticBatcher, findBatch, type BatchInfo } from '../../../src/render/objects/staticBatch';
import { decayLevel, cullAgentShadowCasters, AGENT_SHADOW_MIN_RADIUS } from '../../../src/render/agents/agents';
import { instanceModel, placeMatrix } from '../../../src/render/world/instancing';
import { PHYSICAL_BY_ID, ENV_MODELS } from '../../../src/shared/catalog';
import { DIM } from '../../../src/shared/dimensions';
import { SpecResolver, FALLBACK_SPEC } from '../../../src/render/core/specs';
import type { SimulationAPI } from '../../../src/sim/contracts';

const LOT = { width: 30, depth: 30, sidewalkZ: 28 };
/** Generous half-extents of env props (houses ~9×8 m, trees ~3 m canopy). */
const RADIUS: Record<string, number> = { env_house_a: 4.6, env_house_b: 4.8, env_house_c: 4.2, env_tree_a: 1.2, env_tree_b: 1.2, env_bush: 0.6, env_gravestones: 1.2, env_hydrant: 0.2, env_hearse: 2.6, env_cart: 0.7 };

function distToLot(x: number, z: number, w: number, d: number): number {
  const dx = Math.max(0 - x, 0, x - w);
  const dz = Math.max(0 - z, 0, z - d);
  return Math.hypot(dx, dz);
}

describe('world dressing layout', () => {
  it('never places props inside the lot (with their footprint)', () => {
    for (const dims of [LOT, { width: 20, depth: 24, sidewalkZ: 22 }, { width: 44, depth: 36, sidewalkZ: 34 }]) {
      for (const p of envLayout(dims)) {
        const r = (RADIUS[p.id] ?? 1) * p.scale;
        expect(distToLot(p.x, p.z, dims.width, dims.depth), `${p.id} @ ${p.x},${p.z}`).toBeGreaterThanOrEqual(r * 0.999);
      }
      for (const l of streetLampLayout(dims)) expect(distToLot(l.x, l.z, dims.width, dims.depth)).toBeGreaterThan(0);
    }
  });

  it('uses only ENV_MODELS ids', () => {
    const ids = new Set(ENV_MODELS.map((m) => m.id));
    for (const p of envLayout(LOT)) expect(ids.has(p.id as (typeof ENV_MODELS)[number]['id'])).toBe(true);
  });

  it('fence segments run along the outside of the back and side boundaries, stopping before the sidewalk', () => {
    const f = fenceLayout(LOT);
    expect(f.length).toBe(30 + 2 * 27);
    for (const s of f) {
      // segment start and end (1 m along local +X rotated by yaw)
      const ex = s.x + Math.cos(s.yaw);
      const ez = s.z - Math.sin(s.yaw);
      const outside = s.z < 0 || s.x < 0 || s.x > LOT.width;
      expect(outside).toBe(true);
      expect(Math.max(s.z, ez)).toBeLessThanOrEqual(LOT.sidewalkZ - 1 + 1e-9);
      expect(Number.isFinite(ex)).toBe(true);
    }
  });

  it('garbage dims do not throw and still produce outside-the-lot layouts', () => {
    expect(() => envLayout({ width: NaN, depth: -1, sidewalkZ: Infinity })).not.toThrow();
    expect(fenceLayout({ width: 0, depth: 0, sidewalkZ: 0 }).length).toBe(0);
  });

  it('mergeSimple merges indexed and non-indexed geometries', () => {
    const a = new THREE.PlaneGeometry(1, 1);
    const b = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    const m = mergeSimple([a, b]);
    expect(m.getAttribute('position').count).toBe(4 + 6);
    expect(m.index!.count).toBe(6 + 6);
    for (const i of m.index!.array as Uint32Array) expect(i).toBeLessThan(10);
  });
});

describe('neighbourhood merge clusters', () => {
  it('every prop lands in exactly one side cluster, and each side is spatially compact (frustum-cullable)', () => {
    const all = [...envLayout(LOT), ...streetLampLayout(LOT).map((l) => ({ id: 'env_streetlamp', ...l })), ...fenceLayout(LOT).map((f) => ({ id: 'env_fence', ...f }))];
    const bySide = new Map<string, { x: number; z: number }[]>();
    for (const p of all) {
      const side = envSide(p.x, p.z, LOT);
      expect(['back', 'front', 'west', 'east']).toContain(side);
      bySide.set(side, [...(bySide.get(side) ?? []), p]);
    }
    expect(bySide.get('front')!.every((p) => p.z > LOT.depth)).toBe(true);
    expect(bySide.get('back')!.every((p) => p.z < 0)).toBe(true);
    expect(bySide.get('west')!.every((p) => p.x < LOT.width / 2 && p.z >= 0 && p.z <= LOT.depth)).toBe(true);
    expect(bySide.get('east')!.every((p) => p.x >= LOT.width / 2 && p.z >= 0 && p.z <= LOT.depth)).toBe(true);
    // the four clusters are what the camera culls: none of them may span the whole neighbourhood
    for (const [side, ps] of bySide) {
      const xs = ps.map((p) => p.x);
      const zs = ps.map((p) => p.z);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      expect(span, side).toBeLessThan(120);
    }
  });

  it('adversarial: NaN coordinates still classify (never throw)', () => {
    expect(['back', 'front', 'west', 'east']).toContain(envSide(NaN, NaN, LOT));
    expect(envSide(5, 1e9, LOT)).toBe('front');
    expect(envSide(-1e9, 5, LOT)).toBe('west');
  });
});

describe('opening cuts', () => {
  it('doors span the floor to DOOR_HEIGHT; windows sit on the sill with their spec height', () => {
    const door = openingCutFor(PHYSICAL_BY_ID.door_splintered);
    expect(door).toEqual({ kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: DIM.DOOR_HEIGHT });
    const win = openingCutFor(PHYSICAL_BY_ID.window_grimy);
    expect(win.kind).toBe('window');
    expect(win.bottom).toBe(DIM.WINDOW_SILL);
    expect(win.top).toBeCloseTo(DIM.WINDOW_SILL + DIM.WINDOW_HEIGHT);
    const gothic = openingCutFor(PHYSICAL_BY_ID.window_gothic);
    expect(gothic.top).toBeCloseTo(DIM.WINDOW_SILL + DIM.WINDOW_HEIGHT + 0.25);
    expect(gothic.top).toBeLessThan(DIM.WALL_HEIGHT);
  });

  it('unknown / garbage specs fall back to a safe window cut below the wall top', () => {
    for (const s of [null, undefined, { placement: 'floor', height: NaN, tags: [] }, { placement: 'window', height: 99, tags: [] }]) {
      const c = openingCutFor(s as never);
      expect(c.top).toBeLessThan(DIM.WALL_HEIGHT);
      expect(c.top).toBeGreaterThan(c.bottom);
    }
    expect(openingCutFor({ placement: 'floor', height: 2, tags: ['door'] }).kind).toBe('door');
  });
});

describe('static batching', () => {
  const mk = (name: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ name, ...opts }));
  const infoOf = (root: THREE.Object3D) => root.userData.__staticBatch as BatchInfo | undefined;
  const BOX_V = 24;

  it('root batch takes plain, Paint, double-sided and static-glow parts; glass gets a single-pass glass batch; swap parts stay live', () => {
    const root = new THREE.Group();
    const wood = mk('Wood', { color: '#553311' });
    const iron = mk('Iron', { metalness: 0.8 });
    const paint = mk('Paint', { color: '#336655' });
    const glass = mk('Glass', { transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const glow = mk('Glow', { emissive: new THREE.Color('#ffaa00'), emissiveIntensity: 2 });
    const lace = mk('Lace', { side: THREE.DoubleSide });
    const bulbNode = new THREE.Group();
    bulbNode.name = 'bulb';
    const inBulb = mk('Brass');
    bulbNode.add(inBulb);
    const brokenNode = new THREE.Group();
    brokenNode.name = 'broken';
    brokenNode.visible = false;
    const smoke = mk('Smoke');
    brokenNode.add(smoke);
    const textured = mk('Label');
    (textured.material as THREE.MeshStandardMaterial).map = new THREE.Texture();
    root.add(wood, iron, paint, glass, glow, lace, bulbNode, brokenNode, textured);
    for (const m of [wood, iron, paint, glow, lace]) expect(isBatchable(m, root), (m.material as THREE.Material).name).toBe(true);
    for (const m of [glass, inBulb, smoke, textured]) expect(isBatchable(m, root), (m.material as THREE.Material).name).toBe(false);
    // hosts: swap parts never batch; a mesh that IS a per-kid child is never batched
    expect(batchHost(inBulb, root)).toBeNull();
    // a mesh that is itself a dynamic part (GLB node = mesh named 'bulb' / 'serving_1') is animated → never batched
    const bulbMesh = mk('Lantern', { emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0 });
    bulbMesh.name = 'bulb';
    const servingMesh = mk('Brain');
    servingMesh.name = 'serving_1';
    root.add(bulbMesh, servingMesh);
    expect(batchHost(bulbMesh, root)).toBeNull();
    expect(batchHost(servingMesh, root)).toBeNull();
    expect(isBatchable(bulbMesh, root)).toBe(false);
    root.remove(bulbMesh, servingMesh);
    expect(batchHost(smoke, root)).toBeNull();
    expect(batchHost(wood, root)).toBe(root);
    const b = new StaticBatcher();
    const merged = b.batch('test_model', root);
    expect(merged).not.toBeNull();
    const info = infoOf(root)!;
    expect(info.root).toBe(merged);
    expect(findBatch(root)).toBe(merged);
    for (const m of [wood, iron, paint, glow, lace, glass]) expect(m.visible, (m.material as THREE.Material).name).toBe(false);
    for (const m of [inBulb, textured]) expect(m.visible).toBe(true);
    // 5 root meshes, the double-sided lace twice
    const g = merged!.geometry;
    expect(g.getAttribute('position').count).toBe(6 * BOX_V);
    expect(g.getAttribute('batchRM').count).toBe(6 * BOX_V);
    // per-vertex colour = material colour (linear); emissive radiance = colour × intensity
    expect(g.getAttribute('color').getX(0)).toBeCloseTo(new THREE.Color('#553311').r, 5);
    const glowStart = 3 * BOX_V;
    expect(g.getAttribute('batchE').getX(glowStart)).toBeCloseTo(new THREE.Color('#ffaa00').r * 2, 5);
    expect(g.getAttribute('batchE').getX(0)).toBe(0);
    // glass: one single-pass transparent mesh with vertex alpha, both faces baked
    const glassBatch = info.parts.find((p) => p.name === 'static-batch-glass')!;
    expect(glassBatch).toBeDefined();
    expect(glassBatch.material).toBe(b.glassMaterial);
    expect((glassBatch.material as THREE.Material).side).toBe(THREE.FrontSide);
    expect((glassBatch.material as THREE.Material).transparent).toBe(true);
    expect(glassBatch.castShadow).toBe(false);
    expect(glassBatch.geometry.getAttribute('color').itemSize).toBe(4);
    expect(glassBatch.geometry.getAttribute('color').getW(0)).toBeCloseTo(0.35, 5);
    expect(glassBatch.geometry.getAttribute('position').count).toBe(2 * BOX_V);
    // like three's two-pass DoubleSide transparency: the reversed (far-side) copy is drawn before the forward copy
    const gi = glassBatch.geometry.index!;
    const gn = glassBatch.geometry.getAttribute('normal');
    const firstTri = gi.getX(0);
    const lastTri = gi.getX(gi.count - 1);
    expect(firstTri).toBeGreaterThanOrEqual(BOX_V); // vertex of copy 1 (reversed)
    expect(lastTri).toBeLessThan(BOX_V); // vertex of copy 0 (forward)
    expect(gn.getX(BOX_V) * gn.getX(0) + gn.getY(BOX_V) * gn.getY(0) + gn.getZ(BOX_V) * gn.getZ(0)).toBeCloseTo(-1, 5);
    // merged copies are never raycast (picking hits the hidden originals precisely)
    const hits: THREE.Intersection[] = [];
    merged!.raycast(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)), hits);
    expect(hits.length).toBe(0);
    // batching twice is a no-op
    expect(b.batch('test_model', root)).toBeNull();
    b.dispose();
  });

  it('double-sided parts become two opposite-facing copies (both faces render single-pass)', () => {
    const root = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ name: 'Fern', side: THREE.DoubleSide }));
    root.add(leaf, mk('Pot'));
    const b = new StaticBatcher();
    const merged = b.batch('fern', root)!;
    const pos = merged.geometry.getAttribute('position');
    const nor = merged.geometry.getAttribute('normal');
    const idx = merged.geometry.index!;
    // plane: 4 verts / 2 tris, twice; pot: box
    expect(pos.count).toBe(8 + BOX_V);
    const facing: number[] = [];
    for (let t = 0; t < 12; t += 3) {
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t));
      const e1 = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + 1)).sub(v0);
      const e2 = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + 2)).sub(v0);
      const n = new THREE.Vector3().fromBufferAttribute(nor, idx.getX(t));
      // every triangle winds counter-clockwise around its own normal
      expect(e1.clone().cross(e2).dot(n)).toBeGreaterThan(0);
      facing.push(Math.sign(n.z));
    }
    expect(facing).toEqual([1, 1, -1, -1]);
    b.dispose();
  });

  it('meshes under moving / toggled dynamic nodes become one sub-batch per node (door leaf, servings, speaker kids)', () => {
    const root = new THREE.Group();
    const body = mk('Body');
    const door = new THREE.Group();
    door.name = 'door';
    door.position.set(0.3, 0, 0.2);
    const leaf = new THREE.Group();
    leaf.name = 'door_leaf';
    const l1 = mk('Paint');
    const l2 = mk('Chrome', { metalness: 0.9 });
    l2.position.y = 0.5;
    leaf.add(l1, l2);
    door.add(leaf);
    const serving = new THREE.Group();
    serving.name = 'serving_2';
    serving.add(mk('Brain'), mk('Loaf'));
    const speaker = new THREE.Group();
    speaker.name = 'speaker';
    const kid = new THREE.Group();
    kid.name = 'speaker_0';
    kid.add(mk('Rubber'), mk('Cone'));
    const lone = mk('Grille');
    speaker.add(kid, lone);
    root.add(body, door, serving, speaker);
    expect(batchHost(l1, root)).toBe(door);
    expect(batchHost(kid.children[0], root)).toBe(kid);
    expect(batchHost(lone, root)).toBeNull();
    const b = new StaticBatcher();
    b.minMeshes = 1;
    b.batch('fridge_test', root);
    const info = infoOf(root)!;
    const subs = info.parts.filter((p) => p.name === 'static-batch-part');
    expect(subs.length).toBe(3);
    expect(subs.map((p) => p.parent)).toEqual(expect.arrayContaining([door, serving, kid]));
    expect(l1.visible).toBe(false);
    expect(lone.visible).toBe(true);
    // the door sub-batch is in door-local space: opening the door moves the merged leaf with it
    const doorSub = subs.find((p) => p.parent === door)!;
    doorSub.geometry.computeBoundingBox();
    expect(doorSub.geometry.boundingBox!.max.y).toBeCloseTo(0.6, 5);
    expect(doorSub.geometry.boundingBox!.min.x).toBeCloseTo(-0.1, 5);
    // the Paint on the door leaf is tracked like root Paint
    expect(info.paint).toContain(l1);
    b.unbatch(root);
    expect(subs.every((p) => p.parent === null)).toBe(true);
    expect(l1.visible).toBe(true);
    expect(infoOf(root)).toBeUndefined();
    b.dispose();
  });

  it('Paint variant swaps are detected and re-baked; unbatch restores the originals', () => {
    const root = new THREE.Group();
    const wood = mk('Wood');
    const paint = mk('Paint', { color: '#ffffff' });
    root.add(wood, paint);
    const b = new StaticBatcher();
    const m1 = b.batch('sofa', root)!;
    expect(b.paintChanged(root)).toBe(false);
    const colorAt = (m: THREE.Mesh, i: number) => m.geometry.getAttribute('color').getX(i);
    expect(colorAt(m1, BOX_V + 1)).toBeCloseTo(1, 5);
    // the library swaps the hidden Paint mesh to a cached dirt variant
    const dirty = (paint.material as THREE.MeshStandardMaterial).clone();
    dirty.color.set('#402010');
    paint.material = dirty;
    expect(b.paintChanged(root)).toBe(true);
    const m2 = b.rebatch('sofa', root)!;
    expect(m2).not.toBe(m1);
    expect(m1.parent).toBeNull();
    expect(root.children.filter((c) => c.userData.staticBatch === true).length).toBe(1);
    expect(b.paintChanged(root)).toBe(false);
    expect(colorAt(m2, BOX_V + 1)).toBeCloseTo(new THREE.Color('#402010').r, 5);
    b.unbatch(root);
    expect(findBatch(root)).toBeNull();
    expect(wood.visible).toBe(true);
    expect(paint.visible).toBe(true);
    // unbatch / paintChanged on garbage never throw
    expect(() => b.unbatch(new THREE.Group())).not.toThrow();
    expect(() => b.unbatch(null)).not.toThrow();
    expect(b.paintChanged(null)).toBe(false);
    expect(b.paintChanged(new THREE.Mesh())).toBe(false);
    b.dispose();
  });

  it('cached geometry is reference counted: unused variants beyond the spare pool are disposed', () => {
    const b = new StaticBatcher();
    const disposed: string[] = [];
    const roots: THREE.Group[] = [];
    for (let i = 0; i < 60; i++) {
      const root = new THREE.Group();
      root.add(mk('Wood'), mk('Iron'));
      const merged = b.batch(`model_${i}`, root)!;
      merged.geometry.addEventListener('dispose', () => disposed.push(`model_${i}`));
      roots.push(root);
    }
    expect(b.cacheSize()).toBe(60);
    // a second instance with the SAME materials reuses the cached geometry
    const again = new THREE.Group();
    const src = roots[0].children as THREE.Mesh[];
    again.add(new THREE.Mesh(src[0].geometry, src[0].material), new THREE.Mesh(src[1].geometry, src[1].material));
    expect(b.batch('model_0', again)!.geometry).toBe(findBatch(roots[0])!.geometry);
    b.unbatch(again);
    for (const r of roots) b.unbatch(r);
    // 48 zero-ref spares kept for reuse, the oldest 12 freed
    expect(b.cacheSize()).toBe(48);
    expect(disposed.length).toBe(12);
    expect(disposed[0]).toBe('model_0');
    b.dispose();
  });

  it('mirrored transforms keep triangles front-facing; shadow flag follows the sources', () => {
    const root = new THREE.Group();
    const a = mk('A');
    a.scale.set(-1, 1, 1);
    const b2 = mk('B');
    b2.position.set(1, 0, 0);
    root.add(a, b2);
    const batcher = new StaticBatcher();
    const merged = batcher.batch('mirror', root)!;
    expect(infoOf(root)!.sources.length).toBe(2);
    expect(merged.castShadow).toBe(false);
    const pos = merged.geometry.getAttribute('position');
    const nor = merged.geometry.getAttribute('normal');
    const idx = merged.geometry.index!;
    for (let t = 0; t < idx.count; t += 3) {
      const [i0, i1, i2] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, i0);
      const e1 = new THREE.Vector3().fromBufferAttribute(pos, i1).sub(v0);
      const e2 = new THREE.Vector3().fromBufferAttribute(pos, i2).sub(v0);
      const n = new THREE.Vector3().fromBufferAttribute(nor, i0);
      expect(e1.cross(e2).dot(n)).toBeGreaterThan(0);
    }
    // a rug: library flags off → the batch never casts
    const rug = new THREE.Group();
    rug.add(mk('Wool'), mk('Fringe'));
    applyShadowFlags(rug, true);
    expect(batcher.batch('rug_test', rug)!.castShadow).toBe(false);
    // casting sources → casting batch
    const chair = new THREE.Group();
    const c1 = mk('Seat');
    c1.castShadow = true;
    chair.add(c1, mk('Leg'));
    expect(batcher.batch('chair_test', chair)!.castShadow).toBe(true);
    // minMeshes: a lone part is left alone at the default 2, batched at 1
    const lone = new THREE.Group();
    lone.add(mk('Only'));
    expect(batcher.batch('lone', lone)).toBeNull();
    batcher.minMeshes = 1;
    expect(infoOf(lone)).toBeUndefined();
    expect(batcher.batch('lone', lone)).not.toBeNull();
    batcher.dispose();
  });

  it('never throws on garbage trees', () => {
    const b = new StaticBatcher();
    const root = new THREE.Group();
    const weird = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    root.add(weird, new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.MeshStandardMaterial()]));
    expect(b.batch('weird', root)).toBeNull();
    expect(b.batch('weird', null as unknown as THREE.Object3D)).toBeNull();
    // vertexColors without a colour attribute is not batchable (would read garbage)
    const vc = new THREE.Group();
    vc.add(mk('VC', { vertexColors: true }), mk('VC2', { vertexColors: true }));
    expect(b.batch('vc', vc)).toBeNull();
    // alpha-tested foliage stays as authored
    const at = new THREE.Group();
    at.add(mk('Leaf', { alphaTest: 0.5 }), mk('Leaf2', { alphaTest: 0.5 }));
    expect(b.batch('at', at)).toBeNull();
    expect(batchHost(new THREE.Mesh(), root)).toBeNull();
    b.dispose();
  });
});

describe('shadow flags', () => {
  it('keeps library flags when present; rugs never cast', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    a.castShadow = true;
    b.castShadow = false; // e.g. a flame the library marked
    root.add(a, b);
    applyShadowFlags(root, false);
    expect([a.castShadow, b.castShadow, a.receiveShadow, b.receiveShadow]).toEqual([true, false, true, true]);
    applyShadowFlags(root, true);
    expect(a.castShadow).toBe(false);
  });

  it('tiny parts never cast (shadow-pass draw calls for nothing)', () => {
    const root = new THREE.Group();
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02), new THREE.MeshStandardMaterial());
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial());
    knob.castShadow = true;
    body.castShadow = true;
    root.add(knob, body);
    applyShadowFlags(root, false);
    expect([knob.castShadow, body.castShadow]).toEqual([false, true]);
  });

  it('falls back to opaque-non-emissive heuristics when the library set nothing', () => {
    const root = new THREE.Group();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 }));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: new THREE.Color('#fff'), emissiveIntensity: 1 }));
    root.add(solid, glass, glow);
    applyShadowFlags(root, false);
    expect([solid.castShadow, glass.castShadow, glow.castShadow]).toEqual([true, false, false]);
  });
});

describe('zombie shadow casters', () => {
  const part = (name: string, r: number, cast = true) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), new THREE.MeshStandardMaterial());
    m.name = name;
    m.castShadow = cast;
    return m;
  };

  it('small rig parts stop casting; the silhouette parts keep casting; nothing is switched on', () => {
    const root = new THREE.Group();
    const torso = part('Top_body', 0.37);
    const leg = part('Bottom_LegL', 0.42);
    const hair = part('Hair', 0.26);
    const hand = part('Hand_L', 0.1);
    const shoe = part('Shoe_L', 0.17);
    const eyes = part('Eyes', 0.1, false);
    const nested = new THREE.Group();
    const bottle = part('carry_bottle', 0.08);
    nested.add(bottle);
    root.add(torso, leg, hair, hand, shoe, eyes, nested);
    root.traverse(cullAgentShadowCasters);
    expect([torso, leg, hair].map((m) => m.castShadow)).toEqual([true, true, true]);
    expect([hand, shoe, eyes, bottle].map((m) => m.castShadow)).toEqual([false, false, false, false]);
    // idempotent, and a part grown past the threshold is not re-enabled by the renderer (the rig owns that)
    root.traverse(cullAgentShadowCasters);
    expect(hand.castShadow).toBe(false);
    expect(AGENT_SHADOW_MIN_RADIUS).toBeGreaterThan(0.17);
    expect(AGENT_SHADOW_MIN_RADIUS).toBeLessThan(0.26);
  });

  it('never throws on garbage nodes (no geometry, empty geometry, NaN bounds)', () => {
    const root = new THREE.Group();
    const empty = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    empty.castShadow = true;
    const nan = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    nan.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([NaN, NaN, NaN]), 3));
    nan.castShadow = true;
    const noGeo = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    (noGeo as unknown as { geometry: null }).geometry = null;
    noGeo.castShadow = true;
    root.add(empty, nan, noGeo, new THREE.Object3D());
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined); // three.js reports the NaN radius
    try {
      expect(() => root.traverse(cullAgentShadowCasters)).not.toThrow();
    } finally {
      quiet.mockRestore();
    }
    expect(noGeo.castShadow).toBe(true);
  });
});

describe('env props: batch then instance', () => {
  it('a multi-part neighbour prop collapses to one instanced batch + its non-batchable parts', () => {
    const tpl = new THREE.Group();
    const mk = (name: string, x: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name, ...opts }));
      m.position.x = x;
      return m;
    };
    // the window glass carries the renderer's night-glow clone (WindowGlow): it must stay a live, separate part
    const win = mk('Glass', 4, { transparent: true, opacity: 0.4 });
    (win.material as THREE.Material).userData.windowGlow = true;
    tpl.add(mk('Siding', 0), mk('Roof', 1), mk('Trim', 2), mk('Chimney', 3), win);
    const batcher = new StaticBatcher();
    expect(batcher.batch('env_house_test', tpl)).not.toBeNull();
    expect((tpl.userData.__staticBatch as BatchInfo).sources.length).toBe(4);
    expect(win.visible).toBe(true);
    const mats = [placeMatrix(-20, 0, 5, 0, 1), placeMatrix(-20, 0, 18, Math.PI, 1), placeMatrix(50, 0, 9, 0.5, 1.1)];
    const inst = instanceModel(tpl, mats, { castShadow: false, receiveShadow: true, name: 'env_house_test' });
    // 1 batch + 1 window instead of 5 draw calls per house
    expect(inst.meshes.length).toBe(2);
    expect(inst.meshes.every((m) => m.count === 3)).toBe(true);
    expect(inst.meshes.some((m) => m.name === 'static-batch')).toBe(true);
    // the batch keeps every part's world placement: instance 0 spans x ∈ [-20.5, -16.5]
    const batch = inst.meshes.find((m) => m.name === 'static-batch')!;
    batch.geometry.computeBoundingBox();
    const bb = batch.geometry.boundingBox!.clone();
    const m0 = new THREE.Matrix4();
    batch.getMatrixAt(0, m0);
    bb.applyMatrix4(m0);
    expect(bb.min.x).toBeCloseTo(-20.5, 5);
    expect(bb.max.x).toBeCloseTo(-16.5, 5);
    for (const m of inst.meshes) m.dispose();
    batcher.dispose();
  });
});

describe('decay level + spec resolution', () => {
  it('uses the decay system when available, else 1 − preservation/100, clamped', () => {
    const sys = (id: string) => (id === 'decay' ? { decayLevel: (a: string) => (a === 'x' ? 0.42 : NaN) } : undefined);
    expect(decayLevel(sys, 'x', { needs: { preservation: 90 } as never })).toBeCloseTo(0.42);
    expect(decayLevel(sys, 'y', { needs: { preservation: 30 } as never })).toBeCloseTo(0.7);
    expect(decayLevel(null, 'y', { needs: { preservation: 130 } as never })).toBe(0);
    expect(decayLevel(null, 'y', { needs: { preservation: NaN } as never })).toBe(0);
    expect(decayLevel(() => {
      throw new Error('boom');
    }, 'y', { needs: { preservation: 0 } as never })).toBe(1);
    expect(decayLevel(null, 'y', null as never)).toBe(0);
  });

  it('resolves catalog specs, sim content specs and falls back safely', () => {
    const r = new SpecResolver();
    expect(r.get('sofa_velvet')?.footprint).toEqual({ w: 3, d: 1 });
    expect(r.get('modded_thing')).toBeNull();
    expect(r.getOrFallback('modded_thing')).toBe(FALLBACK_SPEC);
    r.setSim({ content: { objects: { modded_thing: { ...FALLBACK_SPEC, id: 'modded_thing', footprint: { w: 2, d: 2 } } } } } as unknown as SimulationAPI);
    expect(r.get('modded_thing')?.footprint).toEqual({ w: 2, d: 2 });
    r.setSim({ get content(): never {
      throw new Error('not ready');
    } } as unknown as SimulationAPI);
    expect(r.get('other')).toBeNull();
    for (const g of [null, undefined, 3, '', {}]) expect(r.get(g)).toBeNull();
  });
});
