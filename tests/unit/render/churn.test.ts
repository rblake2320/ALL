/**
 * Resource bookkeeping under churn (node, no WebGL): objects added/moved/re-tinted/removed and zombies spawned/
 * despawned thousands of times must leave no instances unreleased, no rigs undisposed, no chunk meshes, FX emitters
 * or scene nodes behind — the CPU-side half of the "renderer.info stays flat over 2 minutes of churn" check (the
 * GPU-side half runs in the browser: dev/render.leak.cjs).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectManager, type ObjectsContext } from '../../../src/render/objects/objects';
import { AgentManager, doorTrafficFor, DOORWAY_RADIUS, DOOR_APPROACH_RADIUS, agentCullSphere, AGENT_CULL_RADIUS, AGENT_MAX_SHADOW } from '../../../src/render/agents/agents';
import { FxSystem } from '../../../src/render/fx/fx';
import { WindowGlow } from '../../../src/render/lighting/windowGlow';
import { SpecResolver } from '../../../src/render/core/specs';
import { ThrottledWarn } from '../../../src/render/core/diagnostics';
import type { CharacterFactory, ModelLibrary, ObjectVisualState, ZombieRig } from '../../../src/render/contracts';
import type { AgentState, ObjectState, WorldState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';

const fakeAtlas = () => ({ width: 512, height: 256 }) as unknown as HTMLCanvasElement;
const quietWarn = () => new ThrottledWarn(1e9, () => 0);

/** A ModelLibrary stand-in that counts instances and swaps Paint for a dirt variant like the real one. */
function fakeModels() {
  const live = new Set<THREE.Object3D>();
  let created = 0;
  let released = 0;
  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const wood = new THREE.MeshStandardMaterial({ name: 'Wood', color: '#6b4a2b' });
  const paint = new THREE.MeshStandardMaterial({ name: 'Paint', color: '#7a6a8a' });
  const dirty = new THREE.MeshStandardMaterial({ name: 'Paint', color: '#3a2a20' });
  const bulbMat = new THREE.MeshStandardMaterial({ name: 'Bulb', emissive: new THREE.Color('#ffcc88'), emissiveIntensity: 2 });
  const lib: ModelLibrary = {
    ready: Promise.resolve(),
    progress: () => 1,
    has: () => true,
    create(id: string) {
      created++;
      const root = new THREE.Group();
      root.name = id;
      const a = new THREE.Mesh(geo, wood);
      a.castShadow = true;
      const b = new THREE.Mesh(geo, paint);
      b.position.x = 0.3;
      b.castShadow = true;
      const bulb = new THREE.Group();
      bulb.name = 'bulb';
      bulb.add(new THREE.Mesh(geo, bulbMat));
      root.add(a, b, bulb);
      live.add(root);
      return root;
    },
    update(instance: THREE.Object3D, s: ObjectVisualState) {
      // the real library swaps the Paint material for a cached variant when the dirt level changes
      const p = instance.children[1] as THREE.Mesh;
      p.material = s.dirt > 0.5 ? dirty : paint;
    },
    bounds: () => new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)),
    release(instance: THREE.Object3D) {
      if (live.delete(instance)) released++;
    },
    dispose() {},
  };
  return { lib, live, stats: () => ({ created, released }) };
}

function obj(id: string, defId: string, x: number, z: number, rev = 1, extra: Partial<ObjectState> = {}): ObjectState {
  return {
    id,
    defId,
    placement: { kind: 'floor', x, z, rot: 0 },
    value: 10,
    purchasedTick: 0,
    tint: null,
    condition: { dirt: 0, broken: false, burning: false } as ObjectState['condition'],
    data: {},
    reservedBy: {},
    inUseBy: [],
    rev,
    ...extra,
  };
}

function ctxFor(state: Partial<WorldState>): ObjectsContext {
  return {
    state: { tick: 0, objects: {}, agents: {}, ...state } as unknown as WorldState,
    env: { utilitiesOn: true, lampsOn: false, billsOutstanding: false },
    timeSec: 0,
    wallHeight: () => 0,
    hasWall: () => false,
  };
}

describe('object manager churn', () => {
  it('2,000 add / move / re-tint / dirty / hide / remove operations leave nothing behind', () => {
    const m = fakeModels();
    const fx = new FxSystem({ particleCapacity: 256, particleScale: 1 }, fakeAtlas);
    const om = new ObjectManager(m.lib, new SpecResolver(), fx, new WindowGlow(), quietWarn());
    const baseChildren = om.group.children.length;
    const objects: Record<string, ObjectState> = {};
    const ctx = ctxFor({ objects });
    let seed = 1234;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ids = ['sofa_velvet', 'chair_creaky', 'lamp_skull', 'item_dish', 'rug_round', 'item_fire', 'stereo_gramophone'];
    let maxChunks = 0;
    for (let step = 0; step < 2000; step++) {
      const id = `o${Math.floor(rnd() * 40)}`;
      const r = rnd();
      if (!objects[id] || r < 0.25) {
        objects[id] = obj(id, ids[Math.floor(rnd() * ids.length)], Math.floor(rnd() * 28) + 1, Math.floor(rnd() * 26) + 1, step);
      } else if (r < 0.45) {
        const o = objects[id];
        o.placement = { kind: 'floor', x: Math.floor(rnd() * 28) + 1, z: Math.floor(rnd() * 26) + 1, rot: 1 };
        o.rev++;
      } else if (r < 0.55) {
        objects[id].tint = rnd() < 0.5 ? '#224466' : null;
      } else if (r < 0.65) {
        objects[id].condition.dirt = rnd();
      } else if (r < 0.7) {
        objects[id].placement = { kind: 'held', agentId: 'a1' };
        objects[id].rev++;
      } else if (r < 0.75) {
        om.setHidden(rnd() < 0.5 ? id : null);
      } else if (r < 0.8) {
        objects[id].condition.burning = rnd() < 0.5;
      } else {
        delete objects[id];
      }
      ctx.timeSec = step / 60;
      om.sync(ctx, 1 / 60);
      maxChunks = Math.max(maxChunks, om.chunkMeshes());
      fx.update(1 / 60, step / 60);
    }
    // a 30×30 lot has at most 16 chunks × (casting + shadowless) meshes
    expect(maxChunks).toBeLessThanOrEqual(32);
    expect(om.count()).toBe(Object.keys(objects).length);
    // everything goes away
    for (const k of Object.keys(objects)) delete objects[k];
    om.sync(ctx, 1 / 60);
    expect(om.count()).toBe(0);
    expect(om.chunkMeshes()).toBe(0);
    expect(m.live.size).toBe(0);
    expect(m.stats().created).toBe(m.stats().released);
    expect(om.group.children.length).toBe(baseChildren);
    expect(fx.emitterCount()).toBe(0);
    om.dispose();
    fx.dispose();
  });

  it('floor objects are merged into chunks: their own batches hide, wall items and held items never merge', () => {
    const m = fakeModels();
    const fx = new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas);
    const om = new ObjectManager(m.lib, new SpecResolver(), fx, new WindowGlow(), quietWarn());
    const objects: Record<string, ObjectState> = {
      a: obj('a', 'sofa_velvet', 2, 2),
      b: obj('b', 'chair_creaky', 3, 2),
      c: obj('c', 'chair_creaky', 20, 20),
      w: { ...obj('w', 'painting_ancestor', 0, 0), placement: { kind: 'wall', edge: 'h:4:5', side: 1 } },
      h: { ...obj('h', 'item_dish', 0, 0), placement: { kind: 'held', agentId: 'z' } },
    };
    const ctx = ctxFor({ objects });
    om.sync(ctx, 1 / 60);
    expect(om.chunkMeshes()).toBe(2);
    const holder = (id: string) => om.group.children.find((c) => c.userData.objectId === id)!;
    const batchOf = (id: string) => holder(id).children[0].children.find((c) => c.userData.staticBatch === true) as THREE.Mesh;
    expect(batchOf('a').visible).toBe(false);
    expect(batchOf('w').visible).toBe(true);
    // dirt swaps Paint → rebatch with the dirty colour, chunk rebuilt, still exactly one batch per instance
    objects.a.condition.dirt = 0.9;
    om.sync(ctx, 1 / 60);
    om.sync(ctx, 1 / 60);
    const inst = holder('a').children[0];
    expect(inst.children.filter((c) => c.userData.staticBatch === true).length).toBe(1);
    expect(batchOf('a').visible).toBe(false);
    // hiding an object (moving it in buy mode) takes it out of its chunk; un-hiding puts it back
    om.setHidden('a');
    om.sync(ctx, 1 / 60);
    expect(holder('a').visible).toBe(false);
    om.setHidden(null);
    om.sync(ctx, 1 / 60);
    expect(holder('a').visible).toBe(true);
    expect(batchOf('a').visible).toBe(false);
    om.dispose();
    fx.dispose();
  });

  it('hover rim shells survive chunking (attached beside the hidden batch) and are removed on clear', () => {
    const m = fakeModels();
    const fx = new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas);
    const om = new ObjectManager(m.lib, new SpecResolver(), fx, new WindowGlow(), quietWarn());
    const objects: Record<string, ObjectState> = { a: obj('a', 'sofa_velvet', 2, 2) };
    const ctx = ctxFor({ objects });
    om.sync(ctx, 1 / 60);
    om.setHover('a');
    const inst = om.group.children.find((c) => c.userData.objectId === 'a')!.children[0];
    const shells: THREE.Object3D[] = [];
    inst.traverse((o) => {
      if (o.userData.__rimShell) shells.push(o);
    });
    // one shell for the batch (on the instance root, visible) + one for the live bulb part; none for hidden originals
    expect(shells.length).toBe(2);
    expect(shells.some((s) => s.parent === inst)).toBe(true);
    om.setHover(null);
    let left = 0;
    inst.traverse((o) => {
      if (o.userData.__rimShell) left++;
    });
    expect(left).toBe(0);
    om.dispose();
    fx.dispose();
  });
});

/** Rig stand-in that counts disposals. */
function fakeCharacters() {
  let created = 0;
  let disposed = 0;
  const factory: CharacterFactory = {
    ready: Promise.resolve(),
    progress: () => 1,
    create(): ZombieRig {
      created++;
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.3), new THREE.MeshStandardMaterial()));
      let dead = false;
      return {
        root,
        setAppearance() {},
        setLimbs() {},
        setDecay() {},
        setAnim() {},
        setExpression() {},
        setTalking() {},
        setCarry() {},
        setHighlight() {},
        setMoveSpeed() {},
        update() {},
        headTop: (out: THREE.Vector3) => out.set(root.position.x, root.position.y + 1.78, root.position.z),
        dispose() {
          if (!dead) disposed++;
          dead = true;
        },
      };
    },
    dispose() {},
  };
  return { factory, stats: () => ({ created, disposed }) };
}

function agent(id: string, x: number, z: number, presence: AgentState['presence'] = 'onLot', anim = 'walk'): AgentState {
  return {
    id,
    presence,
    appearance: defaultAppearance(),
    limbs: { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' },
    pos: { x, z },
    prevPos: { x, z },
    posY: 0,
    facing: 0,
    prevFacing: 0,
    anim,
    expression: 'neutral',
    carrying: null,
    needs: { hunger: 80, energy: 80, preservation: 70, social: 50, fun: 50, hygiene: 9 },
  } as unknown as AgentState;
}

describe('agent manager churn', () => {
  it('spawn / despawn / presence flips 3,000 times: every rig disposed, emitters released, group empty', () => {
    const c = fakeCharacters();
    const fx = new FxSystem({ particleCapacity: 256, particleScale: 1 }, fakeAtlas);
    const am = new AgentManager(c.factory, fx, quietWarn());
    const agents: Record<string, AgentState> = {};
    const state = { tick: 0, agents, objects: {} } as unknown as WorldState;
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let step = 0; step < 3000; step++) {
      const id = `z${Math.floor(rnd() * 12)}`;
      const r = rnd();
      if (!agents[id] || r < 0.3) agents[id] = agent(id, rnd() * 30, rnd() * 30, 'onLot', rnd() < 0.5 ? 'walk' : 'sleep');
      else if (r < 0.5) agents[id].presence = rnd() < 0.5 ? 'atWork' : 'onLot';
      else if (r < 0.7) {
        agents[id].prevPos = agents[id].pos;
        agents[id].pos = { x: rnd() * 30, z: rnd() * 30 };
      } else if (r < 0.75) am.talk(id, 500);
      else delete agents[id];
      am.sync(state, 0.5, 1 / 60);
      fx.update(1 / 60, step / 60);
    }
    for (const k of Object.keys(agents)) delete agents[k];
    am.sync(state, 1, 1 / 60);
    expect(am.count()).toBe(0);
    expect(am.group.children.length).toBe(0);
    expect(c.stats().created).toBe(c.stats().disposed);
    expect(fx.emitterCount()).toBe(0);
    am.dispose();
    fx.dispose();
  });

  it('frustum culling hides off-screen rigs only (sphere covers body + shadow)', () => {
    const c = fakeCharacters();
    const fx = new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas);
    const am = new AgentManager(c.factory, fx, quietWarn());
    const agents: Record<string, AgentState> = { near: agent('near', 15, 15), edge: agent('edge', 15, 15), far: agent('far', 200, 200) };
    const state = { tick: 0, agents, objects: {} } as unknown as WorldState;
    am.sync(state, 1, 1 / 60);
    const cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.3, 1200);
    cam.position.set(15, 20, 35);
    cam.lookAt(15, 0, 15);
    cam.updateMatrixWorld();
    expect(am.cull(cam)).toBe(1);
    const rootOf = (id: string) => am.group.children.find((o) => o.name === `agent:${id}`)!;
    expect(rootOf('near').visible).toBe(true);
    expect(rootOf('far').visible).toBe(false);
    // culled rigs are not pickable; sync makes them visible again for the next cull
    const ray = new THREE.Ray(new THREE.Vector3(200, 1, 210), new THREE.Vector3(0, 0, -1));
    expect(am.pick(ray)).toBeNull();
    am.dispose();
    fx.dispose();
  });
});

describe('rig culling sphere covers the zombie and its shadow', () => {
  const sph = () => new THREE.Sphere();
  it('without a light: body sphere at hip height', () => {
    const s = agentCullSphere(3, 0, 4, null, sph());
    expect(s.center.toArray()).toEqual([3, 0.9, 4]);
    expect(s.radius).toBe(AGENT_CULL_RADIUS);
  });

  it('a low dusk sun stretches the sphere over the long shadow, away from the light', () => {
    // light from +X, 0.24 rad above the horizon (≈ 18:45)
    const el = 0.24;
    const light = { x: Math.cos(el), y: Math.sin(el), z: 0 };
    const s = agentCullSphere(10, 0, 10, light, sph());
    const len = 1.9 / Math.tan(el);
    expect(s.center.x).toBeCloseTo(10 - len / 2, 5);
    expect(s.center.z).toBeCloseTo(10, 5);
    // the whole shadow (feet → tip) is inside the sphere
    expect(Math.abs(10 - len - s.center.x)).toBeLessThanOrEqual(s.radius);
    expect(Math.abs(10 - s.center.x)).toBeLessThanOrEqual(s.radius);
    expect(s.radius).toBeGreaterThan(AGENT_CULL_RADIUS);
  });

  it('noon sun barely stretches it; grazing / below-horizon / garbage lights are bounded', () => {
    const noon = agentCullSphere(0, 0, 0, { x: 0.2, y: 0.98, z: 0 }, sph());
    expect(noon.radius).toBe(AGENT_CULL_RADIUS);
    const graze = agentCullSphere(0, 0, 0, { x: 1, y: 1e-4, z: 0 }, sph());
    expect(graze.radius).toBeLessThanOrEqual(AGENT_MAX_SHADOW / 2 + 1.6 + 1e-9);
    for (const bad of [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: NaN, y: 1, z: 0 }, { x: 1, y: Infinity, z: 0 }]) {
      const s = agentCullSphere(1, 0, 1, bad, sph());
      expect(Number.isFinite(s.radius) && Number.isFinite(s.center.x) && Number.isFinite(s.center.z)).toBe(true);
    }
  });
});

describe('door traffic rule (decision #14d)', () => {
  it('anyone in the doorway keeps it open; walkers within reach swing it; idle bystanders do not', () => {
    expect(doorTrafficFor(0.2, 0.1, 'idle')).toBe(true);
    expect(doorTrafficFor(DOORWAY_RADIUS, 0, 'sit')).toBe(true);
    expect(doorTrafficFor(0.8, 0, 'walk')).toBe(true);
    expect(doorTrafficFor(0.8, 0, 'limp')).toBe(true);
    expect(doorTrafficFor(0.8, 0, 'crawl')).toBe(true);
    expect(doorTrafficFor(0.8, 0, 'idle')).toBe(false);
    expect(doorTrafficFor(DOOR_APPROACH_RADIUS + 0.01, 0, 'walk')).toBe(false);
  });

  it('adversarial: NaN offsets never open doors; unknown anims behave like standing', () => {
    expect(doorTrafficFor(NaN, 0, 'walk')).toBe(false);
    expect(doorTrafficFor(0, Infinity, 'walk')).toBe(false);
    expect(doorTrafficFor(0.7, 0, 'not-an-anim')).toBe(false);
  });
});

describe('object picking sees only what is drawn', () => {
  it('hidden dynamic parts never catch the cursor; batched (hidden) originals still do', () => {
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const lib: ModelLibrary = {
      ready: Promise.resolve(),
      progress: () => 1,
      has: () => true,
      create(id: string) {
        const root = new THREE.Group();
        root.name = id;
        const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'Wood' }));
        body.position.y = 0.2;
        const lid = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'Paint' }));
        lid.position.y = 0.5;
        // a hidden 'broken' debris part sticking far out to the side (like smoke above a broken fridge)
        const broken = new THREE.Group();
        broken.name = 'broken';
        broken.visible = false;
        const debris = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ name: 'Smoke', transparent: true, opacity: 0.5 }));
        debris.position.set(0, 1.4, 0);
        broken.add(debris);
        root.add(body, lid, broken);
        return root;
      },
      update: () => undefined,
      bounds: () => new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 2, 0.5)),
      release: () => undefined,
      dispose: () => undefined,
    };
    const fx = new FxSystem({ particleCapacity: 32, particleScale: 1 }, fakeAtlas);
    const om = new ObjectManager(lib, new SpecResolver(), fx, new WindowGlow(), quietWarn());
    const objects: Record<string, ObjectState> = { a: obj('a', 'fridge_humming', 4, 4) };
    om.sync(ctxFor({ objects }), 1 / 60);
    const cx = 4.5;
    const cz = 4.5;
    // straight down through the (batched, hidden-original) body: picked
    const down = new THREE.Ray(new THREE.Vector3(cx, 5, cz), new THREE.Vector3(0, -1, 0));
    const hit = om.pick(down);
    expect(hit?.objectId).toBe('a');
    expect(hit!.point.y).toBeCloseTo(0.7, 3);
    // a horizontal ray through the hidden debris only (inside the object's bounds box): not picked
    const side = new THREE.Ray(new THREE.Vector3(cx - 3, 1.4, cz), new THREE.Vector3(1, 0, 0));
    expect(om.pick(side)).toBeNull();
    om.dispose();
    fx.dispose();
  });
});

describe('sleep FX follow the sim, not just the anim', () => {
  it('a sofa nap (sitTV + sleep-tagged interaction) gets zzz; an awake TV watcher does not', () => {
    const c = fakeCharacters();
    const fx = new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas);
    const am = new AgentManager(c.factory, fx, quietWarn());
    const content = { interactions: { home_nap: { tags: ['sleep', 'nap'] }, home_watchTV: { tags: ['fun'] } } };
    am.setSim({ content } as unknown as import('../../../src/sim/contracts').SimulationAPI);
    const napper = agent('n', 5, 5, 'onLot', 'sitTV');
    (napper as unknown as { active: unknown }).active = { interactionId: 'home_nap', phase: 'run' };
    const watcher = agent('w', 8, 5, 'onLot', 'sitTV');
    (watcher as unknown as { active: unknown }).active = { interactionId: 'home_watchTV', phase: 'run' };
    const routing = agent('r', 9, 5, 'onLot', 'walk');
    (routing as unknown as { active: unknown }).active = { interactionId: 'home_nap', phase: 'route' };
    for (const a of [napper, watcher, routing]) a.needs.hygiene = 80;
    const state = { tick: 0, agents: { n: napper, w: watcher, r: routing }, objects: {} } as unknown as WorldState;
    am.sync(state, 1, 1 / 60);
    // exactly one emitter (the napper's zzz)
    expect(fx.emitterCount()).toBe(1);
    // garbage content never throws and means "not asleep"
    am.setSim({ get content() { throw new Error('boom'); } } as unknown as import('../../../src/sim/contracts').SimulationAPI);
    expect(() => am.sync(state, 1, 1 / 60)).not.toThrow();
    am.dispose();
    fx.dispose();
  });
});
