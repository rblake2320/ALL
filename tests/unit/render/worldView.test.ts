/**
 * W-025 S5 renderer world view (node, no WebGL): region frames vs the world.ts transforms, render tiers with
 * hysteresis, region add / remove streaming, LOD switch, disposal of every owned geometry / texture / material, camera
 * follow across a region boundary, picking in a non-home region, and the AC-1 rule that a home-only world draws no
 * region at all (the legacy scene; the browser half compares draw calls, docs/DESIGN_WORLD_LEVELS.md §1.19).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldView, MAX_BUILDS_PER_FRAME } from '../../../src/render/world/worldView';
import { HomeShellLibrary, parseHomesManifest } from '../../../src/render/world/homeShells';
import { LotVisual, openEdges, planTransform, worldResourceCounts, WORMWOOD_SHELLS, shellIdFor } from '../../../src/render/world/regionVisuals';
import { computeRenderTiers, frameToScene, regionFrame, sceneToFrame, RENDER_RADII, rectDistance, type TierRegion } from '../../../src/render/world/worldFrame';
import { WindowGlow } from '../../../src/render/lighting/windowGlow';
import { ThrottledWarn } from '../../../src/render/core/diagnostics';
import { AgentManager } from '../../../src/render/agents/agents';
import { ObjectManager, type ObjectsContext } from '../../../src/render/objects/objects';
import { FxSystem } from '../../../src/render/fx/fx';
import { SpecResolver } from '../../../src/render/core/specs';
import { CameraRig } from '../../../src/render/camera/cameraRig';
import { buildWorldMap, regionDef } from '../../../src/shared/mildewLane';
import { START_TEMPLATE_BOUNDS_V1 } from '../../../src/shared/startNeighbours';
import { canonicalStartPick, legacyTown, newTown } from '../../../src/shared/town';
import { lotToWorld, worldToLot, type LotPlacement, type RenderTier } from '../../../src/shared/world';
import type { CharacterFactory, ModelLibrary, ZombieRig } from '../../../src/render/contracts';
import type { AgentState, ObjectState, WorldState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { readFileSync } from 'node:fs';
import { backdropLayout, BACKDROP_MARGIN, envLayout } from '../../../src/render/world/dressing';

const quiet = () => new ThrottledWarn(1e9, () => 0);
const fakeAtlas = () => ({ width: 512, height: 256 }) as unknown as HTMLCanvasElement;

/** ModelLibrary stand-in: one box mesh per model (batchable), counts live instances. */
function fakeModels() {
  const geo = new THREE.BoxGeometry(0.5, 1, 0.5);
  const mat = new THREE.MeshStandardMaterial({ name: 'Wood' });
  let live = 0;
  const lib: ModelLibrary & { live(): number } = {
    ready: Promise.resolve(),
    progress: () => 1,
    has: () => true,
    create(id: string) {
      live++;
      const g = new THREE.Group();
      g.name = id;
      g.add(new THREE.Mesh(geo, mat));
      return g;
    },
    update: () => undefined,
    bounds: () => new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)),
    release: () => {
      live--;
    },
    dispose: () => undefined,
    live: () => live,
  };
  return lib;
}

function shellLib(withProtos = true): HomeShellLibrary {
  const lib = new HomeShellLibrary('', null);
  lib.setManifest(parseHomesManifest(JSON.parse(readFileSync('public/assets/manifest.homes.json', 'utf8'))));
  if (withProtos) {
    for (const id of WORMWOOD_SHELLS)
      for (const lod of [0, 1] as const) {
        const shell = new THREE.BoxGeometry(10, 6 - lod, 10).translate(0, 3, 0);
        const glass = new THREE.PlaneGeometry(1, 1).translate(0, 2, 5.01);
        lib.setProto(id, lod, [
          { geometry: shell, material: new THREE.MeshStandardMaterial({ name: 'Shell', vertexColors: true }), glass: false },
          { geometry: glass, material: new THREE.MeshStandardMaterial({ name: 'Glass' }), glass: true },
        ]);
      }
  }
  return lib;
}

function townWorld(slot = 'mildew_n2', seed = 7): WorldState {
  const lot = { width: 30, depth: 30, sidewalkZ: 28, version: 1, walls: {}, floors: [], entryPoints: [{ x: 0.5, z: 28.5 }] };
  return { seed, tick: 0, lot, objects: {}, agents: {}, town: newTown(seed, { ...canonicalStartPick('starter'), slotId: slot }) } as unknown as WorldState;
}

function makeView(models = fakeModels(), shells = shellLib()): WorldView {
  return new WorldView(models, new WindowGlow(), quiet(), shells);
}

/** Run frames until the per-frame build budget has drained. */
function settle(v: WorldView, x: number, z: number, frames = 30): void {
  for (let i = 0; i < frames; i++) v.update(x, z, null);
}

describe('region frames: scene = home lot-local frame (worldFrame.ts)', () => {
  const map = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
  for (const homeId of ['wormwood:mildew_n2', 'wormwood:mildew_s3', 'wormwood:corner_park', 'graveyard:old_graveyard']) {
    it(`every region point maps like lotToWorld ∘ worldToLot (home ${homeId})`, () => {
      const home = regionDef(map, homeId)!.placement;
      for (const r of map.regions) {
        const f = regionFrame(home, r.placement)!;
        expect(f).not.toBeNull();
        for (const [x, z] of [[0, 0], [0.5, 0.5], [29.5, 28.5], [r.placement.width, r.placement.depth], [3.25, 7.75]]) {
          const w = lotToWorld(r.placement, x, z)!;
          const want = worldToLot(home, w.x, w.z)!;
          const got = frameToScene(f, x, z);
          expect(got.x).toBeCloseTo(want.x, 9);
          expect(got.z).toBeCloseTo(want.z, 9);
          const back = sceneToFrame(f, got.x, got.z);
          expect(back.x).toBeCloseTo(x, 9);
          expect(back.z).toBeCloseTo(z, 9);
        }
        // facing: local +Z turns by the frame yaw (three.js rotation.y convention)
        const obj = new THREE.Object3D();
        obj.position.set(f.x, 0, f.z);
        obj.rotation.y = f.yaw;
        obj.updateMatrixWorld();
        const p = new THREE.Vector3(2, 0, 5).applyMatrix4(obj.matrixWorld);
        const want = frameToScene(f, 2, 5);
        expect(p.x).toBeCloseTo(want.x, 9);
        expect(p.z).toBeCloseTo(want.z, 9);
      }
    });
  }

  it('the home frame is the identity', () => {
    const home = regionDef(map, 'wormwood:mildew_n2')!.placement;
    const f = regionFrame(home, home)!;
    expect([f.x, f.z, f.yaw, f.cos, f.sin]).toEqual([0, 0, 0, 1, 0]);
  });

  it('invalid placements give no frame', () => {
    const home = regionDef(map, 'wormwood:mildew_n2')!.placement;
    expect(regionFrame(home, { ...home, rot: 7 } as unknown as LotPlacement)).toBeNull();
    expect(regionFrame({ ...home, width: NaN }, home)).toBeNull();
  });
});

describe('render tiers (§1.4) with hysteresis', () => {
  const map = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
  const regions: TierRegion[] = map.regions.map((r) => {
    const a = lotToWorld(r.placement, 0, 0)!;
    const b = lotToWorld(r.placement, r.placement.width, r.placement.depth)!;
    return { id: r.id, kind: r.kind, rect: { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) }, simActive: r.id === 'wormwood:mildew_n2' };
  });
  const home = 'wormwood:mildew_n2';
  const tiers = (x: number, z: number, prev: Map<string, RenderTier> = new Map(), profile: 'desktop' | 'phone' = 'desktop') => computeRenderTiers({ regions, focus: { x, z }, profile, homeId: home, prev });

  it('from the home: home + ≤ 6 active lots, streets near are active, the rest of Mildew Lane warm, unfinished never active', () => {
    const t = tiers(85, 15);
    expect(t.get(home)).toBe('active');
    const activeLots = map.regions.filter((r) => r.kind === 'lot' && t.get(r.id) === 'active');
    expect(activeLots.length).toBeLessThanOrEqual(RENDER_RADII.activeLots);
    expect(activeLots.map((r) => r.id)).toEqual(expect.arrayContaining(['wormwood:mildew_n1', 'wormwood:mildew_n3', 'wormwood:mildew_s2']));
    expect(t.get('street:mildew:2')).toBe('active');
    for (const r of map.regions) if (r.kind === 'unfinished') expect(t.get(r.id)).not.toBe('active');
    expect(t.get('graveyard:old_graveyard')).toBe('warm');
  });

  it('warm enter / leave radii by profile (desktop 120/140, phone 75/90)', () => {
    const g = regions.find((r) => r.id === 'graveyard:old_graveyard')!;
    // a focus 100 tiles west of the graveyard: desktop warm, phone cold
    const fx = g.rect.x0 - 100;
    expect(tiers(fx, 35).get(g.id)).toBe('warm');
    expect(tiers(fx, 35, new Map(), 'phone').get(g.id)).toBeUndefined();
    // hysteresis: 130 away stays warm only if it was warm
    const far = g.rect.x0 - 130;
    expect(tiers(far, 35).get(g.id)).toBeUndefined();
    expect(tiers(far, 35, new Map([[g.id, 'warm' as RenderTier]])).get(g.id)).toBe('warm');
    expect(tiers(g.rect.x0 - 141, 35, new Map([[g.id, 'warm' as RenderTier]])).get(g.id)).toBeUndefined();
  });

  it('pacing across the active band does not thrash: active 45 / leave 60', () => {
    const n4 = regions.find((r) => r.id === 'wormwood:mildew_n4')!;
    let prev = new Map<string, RenderTier>();
    let changes = 0;
    let last: RenderTier | undefined;
    for (let i = 0; i < 400; i++) {
      // focus oscillates 40..58 tiles west of n4 (inside the hysteresis band after the first entry)
      const d = 49 + 9 * Math.sin(i / 7);
      const t = tiers(n4.rect.x0 - d, 15, prev);
      const now = t.get(n4.id);
      if (last !== undefined && now !== last) changes++;
      last = now;
      prev = t;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('garbage focus / regions never throw; rectDistance is Chebyshev (0 inside)', () => {
    expect(() => computeRenderTiers({ regions: [null as never, ...regions], focus: { x: NaN, z: Infinity }, profile: 'desktop', homeId: home, prev: new Map() })).not.toThrow();
    expect(rectDistance({ x0: 0, z0: 0, x1: 10, z1: 10 }, 5, 5)).toBe(0);
    expect(rectDistance({ x0: 0, z0: 0, x1: 10, z1: 10 }, 13, -4)).toBe(4);
  });
});

describe('world view streaming (region add / remove, LOD, disposal)', () => {
  it('AC-1: a home-only world (no town, or a migrated save before townExpand) draws no region', () => {
    const v = makeView();
    const w = townWorld();
    delete (w as { town?: unknown }).town;
    expect(v.sync(w)).toBe(false);
    settle(v, 15, 15);
    expect(v.group.children.length).toBe(0);
    expect(v.stats().built).toBe(0);
    const migrated = { ...townWorld(), town: legacyTown(7, 100) };
    expect(migrated.town!.expandPending).toBe(true);
    expect(v.sync(migrated)).toBe(false);
    settle(v, 15, 15);
    expect(v.group.children.length).toBe(0);
    expect(v.contentFrame('wormwood:mildew_n1')).toBe('home');
    v.dispose();
  });

  it('regions stream in at most MAX_BUILDS_PER_FRAME per frame and stream out when the focus leaves', () => {
    const models = fakeModels();
    const v = makeView(models);
    expect(v.sync(townWorld())).toBe(true);
    v.update(15, 15, null);
    expect(v.stats().built).toBe(MAX_BUILDS_PER_FRAME);
    settle(v, 15, 15);
    const near = v.stats();
    expect(near.built).toBeGreaterThan(10);
    expect(near.active).toBeGreaterThan(0);
    expect(v.visual('wormwood:mildew_n1')).not.toBeNull();
    expect(v.visual('wormwood:mildew_n2')).toBeNull(); // the home is the legacy layers' job
    // walk the camera far east (past the graveyard): the west end drops out
    settle(v, 15 + 260, 15);
    expect(v.visual('wormwood:corner_park')).toBeNull();
    expect(v.stats().disposedTotal).toBeGreaterThan(0);
    // and back: rebuilt
    settle(v, 15, 15);
    expect(v.visual('wormwood:corner_park')).not.toBeNull();
    v.dispose();
    expect(models.live()).toBe(0);
  });

  it('LOD: a neighbour lot switches LOD0 (active) ↔ LOD1 (warm) as the focus moves; shells cut away per region', () => {
    const v = makeView();
    v.sync(townWorld());
    settle(v, 15, 15);
    const n1 = v.visual('wormwood:mildew_n1') as LotVisual;
    expect(n1.tier).toBe('active');
    expect(n1.currentLod()).toBe(0);
    expect(n1.isPlaceholder()).toBe(false);
    // move the focus ~100 tiles east of the home: n1 is beyond the active radius but within the warm one
    settle(v, 15 + 100, 15);
    const again = v.visual('wormwood:mildew_n1') as LotVisual;
    expect(again).toBe(n1);
    expect(n1.tier).toBe('warm');
    expect(n1.currentLod()).toBe(1);
    expect(v.stats().lodSwitches).toBeGreaterThan(0);
    // cutaway: the lot under the camera focus is cut (walls-down look); 'down' cuts every active neighbour
    settle(v, 15, 15);
    const n1b = v.visual('wormwood:mildew_n1') as LotVisual;
    v.setWallMode('cutaway');
    settle(v, -15, 15, 2); // scene −15 = world 55: inside n1
    expect(n1b.isCut()).toBe(true);
    settle(v, 15, 15, 2);
    expect(n1b.isCut()).toBe(false);
    v.setWallMode('down');
    settle(v, 15, 15, 2);
    expect(n1b.isCut()).toBe(true);
    v.setWallMode('up');
    settle(v, 15, 15, 2);
    expect(n1b.isCut()).toBe(false);
    v.dispose();
  });

  it('no leaks: every geometry / texture / material a region owns is disposed (dispose events) after 20 stream cycles', () => {
    const before = { ...worldResourceCounts };
    const disposed = new Set<string>();
    const created = new Set<string>();
    const origGeo = THREE.BufferGeometry.prototype.dispose;
    const v = makeView();
    v.sync(townWorld());
    const spy = (g: THREE.BufferGeometry) => disposed.add(g.uuid);
    THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
      spy(this);
      return origGeo.call(this);
    };
    try {
      for (let c = 0; c < 20; c++) {
        settle(v, 15, 15, 12);
        v.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry && !m.geometry.userData.shared) created.add(m.geometry.uuid);
        });
        settle(v, 15 + 600, 15, 4);
      }
      expect(v.stats().built).toBe(0);
      // owned counts are back where they started (kit materials / textures excluded: they live with the view)
      const kitShare = { ...worldResourceCounts };
      v.dispose();
      expect(worldResourceCounts).toEqual(before);
      expect(kitShare.geometries - before.geometries).toBeLessThanOrEqual(2); // the kit's two placeholder geometries
    } finally {
      THREE.BufferGeometry.prototype.dispose = origGeo;
    }
    expect(v.stats().createdTotal).toBe(v.stats().disposedTotal);
    expect(created.size).toBeGreaterThan(0);
  });

  it('late shells: a placeholder house is swapped for the real shell when the GLB lands', () => {
    const shells = shellLib(false);
    const v = makeView(fakeModels(), shells);
    v.sync(townWorld());
    settle(v, 15, 15);
    const n3 = v.visual('wormwood:mildew_n3') as LotVisual;
    expect(n3.isPlaceholder()).toBe(true);
    const id = n3.shellId;
    shells.setProto(id, 0, [{ geometry: new THREE.BoxGeometry(8, 5, 8), material: new THREE.MeshStandardMaterial({ name: 'Shell' }), glass: false }]);
    shells.onLoaded?.(id, 0);
    settle(v, 15, 15, 10);
    // the placeholder region was disposed and rebuilt with the real shell (the footprint drives the yard layout)
    const again = v.visual('wormwood:mildew_n3') as LotVisual;
    expect(again).not.toBe(n3);
    expect(again.isPlaceholder()).toBe(false);
    expect(v.stats().createdTotal - v.stats().disposedTotal).toBe(v.stats().built);
    v.dispose();
  });

  it('a phone viewport rebuilds with the phone radii (fewer regions drawn)', () => {
    const v = makeView();
    v.sync(townWorld());
    settle(v, 15, 15);
    const desk = v.stats().built;
    v.setProfile('phone');
    settle(v, 15, 15);
    expect(v.stats().profile).toBe('phone');
    expect(v.stats().built).toBeLessThan(desk);
    v.dispose();
  });

  it('a south-side home (rot 2) puts the street in front of it (+Z local) and n-slot lots across it', () => {
    const v = makeView();
    v.sync(townWorld('mildew_s3'));
    const street = v.sceneRectOf('street:mildew:3')!;
    expect(street.z0).toBe(30);
    expect(street.z1).toBe(40);
    const across = v.sceneRectOf('wormwood:mildew_n3')!;
    expect(across).toEqual({ x0: 0, z0: 40, x1: 30, z1: 70 });
    v.dispose();
  });

  it('shell choice is deterministic per seed and slot, and follows a known template', () => {
    const shells = shellLib();
    const map = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 9 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
    const n1 = regionDef(map, 'wormwood:mildew_n1')!;
    expect(shellIdFor(shells, n1, 9)).toBe(shellIdFor(shells, n1, 9));
    expect(WORMWOOD_SHELLS).toContain(shellIdFor(shells, n1, 9) as (typeof WORMWOOD_SHELLS)[number]);
    expect(shellIdFor(shells, { ...n1, templateId: 'wormwood_bungalow' }, 9)).toBe('shell_wormwood_bungalow');
    const ids = new Set(map.regions.filter((r) => r.kind === 'lot' && r.templateId === null).map((r) => shellIdFor(shells, r, 9)));
    expect(ids.size).toBeGreaterThan(1);
  });

  it('unfinished areas: fenced only where they face open land; signs are DOM text with world positions', () => {
    const v = makeView();
    v.sync(townWorld());
    const map = v.worldMap()!;
    const open = map.regions.filter((r) => r.kind !== 'unfinished').map((r) => {
      const a = lotToWorld(r.placement, 0, 0)!;
      const b = lotToWorld(r.placement, r.placement.width, r.placement.depth)!;
      return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
    });
    const north = openEdges({ x0: 0, z0: -30, x1: 200, z1: 0 }, open);
    expect(north).toEqual([{ x0: 40, z0: 0, x1: 160, z1: 0, side: 's' }]);
    const signs = v.signs({ x: 15, z: 15 });
    expect(signs.length).toBe(4);
    for (const s of signs) {
      expect(s.text.length).toBeGreaterThan(10);
      expect(s.textKey.startsWith('world.unfinished.')).toBe(true);
      expect(Number.isFinite(s.world.x)).toBe(true);
    }
    // nearest first: the north sign (world 100.5, −0.5) is nearest to the home centre (world 85, 15)
    expect(signs[0].regionId).toBe('unfinished:wormwood_north');
    settle(v, 15, 15);
    const boards: THREE.Object3D[] = [];
    v.group.traverse((o) => {
      if (o.name.startsWith('sign:')) boards.push(o);
    });
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards) expect(typeof b.userData.signText).toBe('string');
    v.dispose();
  });
});

// ───────────────────────────── agents / camera / picking across regions ─────────────────────────────

function fakeCharacters(): CharacterFactory {
  return {
    ready: Promise.resolve(),
    progress: () => 1,
    create(): ZombieRig {
      const root = new THREE.Group();
      return {
        root,
        setAppearance: () => undefined,
        setLimbs: () => undefined,
        setDecay: () => undefined,
        setAnim: () => undefined,
        setExpression: () => undefined,
        setTalking: () => undefined,
        setCarry: () => undefined,
        setHighlight: () => undefined,
        setMoveSpeed: () => undefined,
        update: () => undefined,
        headTop: (out: THREE.Vector3) => out.set(root.position.x, root.position.y + 1.7, root.position.z),
        dispose: () => undefined,
      };
    },
    dispose: () => undefined,
  };
}

function walker(id: string, x: number, z: number, regionId?: string, prev?: { x: number; z: number }): AgentState {
  return {
    id,
    role: 'household',
    presence: 'onLot',
    regionId,
    pos: { x, z },
    prevPos: prev ?? { x, z },
    facing: Math.PI / 2,
    prevFacing: Math.PI / 2,
    posY: 0,
    anim: 'walk',
    expression: 'neutral',
    appearance: defaultAppearance(),
    limbs: { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' },
    needs: { hunger: 50, energy: 50, preservation: 50, social: 50, fun: 50, hygiene: 50 },
    active: null,
  } as unknown as AgentState;
}

describe('camera follow + agents across a region boundary', () => {
  it('a member walking east along the sidewalk crosses home → n3 with no jump; the camera follows past the lot bounds', () => {
    const v = makeView();
    const w = townWorld();
    v.sync(w);
    settle(v, 15, 15);
    const am = new AgentManager(fakeCharacters(), new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas), quiet());
    am.regionFrames = (id) => v.contentFrame(id);
    const cam = new CameraRig();
    cam.followId = 'a1';
    const n3 = v.worldMap()!.regions.find((r) => r.id === 'wormwood:mildew_n3')!.placement;
    const home = v.homePlacement()!;
    let lastX = -Infinity;
    const xs: number[] = [];
    // walk from home local x 27 to n3 local x 3 along z 28.5, 0.25 tiles per tick; the sim switches region at the
    // portal (x = 30 world 100) and transforms pos / prevPos through world coordinates (§1.5)
    for (let wx = 97; wx <= 103.01; wx += 0.25) {
      const inN3 = wx >= 100;
      const p = inN3 ? worldToLot(n3, wx, 28.5)! : worldToLot(home, wx, 28.5)!;
      const pp = inN3 ? worldToLot(n3, wx - 0.25, 28.5)! : worldToLot(home, wx - 0.25, 28.5)!;
      w.agents = { a1: walker('a1', p.x, p.z, inN3 ? 'wormwood:mildew_n3' : undefined, pp) };
      for (const alpha of [0.25, 0.5, 0.75, 1]) {
        am.sync(w, alpha, 1 / 60);
        const pos = am.positionOf('a1')!;
        expect(pos).not.toBeNull();
        expect(pos.x).toBeGreaterThanOrEqual(lastX - 1e-9);
        if (lastX > -Infinity) expect(pos.x - lastX).toBeLessThan(0.26);
        lastX = pos.x;
        xs.push(pos.x);
        cam.setPanRect(v.sceneBounds());
        for (let k = 0; k < 4; k++) cam.update(1 / 60, pos);
      }
    }
    // drawn in the scene frame: home local x == scene x; n3 continues past 30
    expect(xs[xs.length - 1]).toBeCloseTo(33, 6);
    // the camera followed beyond the home lot's bounds + margin (30 + 4): the pan rect is the drawn world
    for (let k = 0; k < 600; k++) cam.update(1 / 60, am.positionOf('a1'));
    expect(cam.getState().target.x).toBeCloseTo(33, 3);
    am.dispose();
    v.dispose();
  });

  it('agents in a warm / cold region are not drawn; without a world view everything is home content', () => {
    const v = makeView();
    const w = townWorld();
    v.sync(w);
    settle(v, 15, 15);
    const am = new AgentManager(fakeCharacters(), new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas), quiet());
    am.regionFrames = (id) => v.contentFrame(id);
    w.agents = { near: walker('near', 10, 28.5, 'wormwood:mildew_n1'), far: walker('far', 10, 10, 'graveyard:old_graveyard'), home: walker('home', 5, 5) };
    am.sync(w, 1, 1 / 60);
    expect(am.positionOf('near')).not.toBeNull();
    expect(am.positionOf('far')).toBeNull();
    expect(am.positionOf('home')!.x).toBeCloseTo(5, 9);
    expect(am.positionOf('near')!.x).toBeCloseTo(-20, 9); // n1 local 10 → world 50 → home local −20
    am.dispose();
    v.dispose();
  });
});

describe('picking in a non-home region', () => {
  it('ground and shells resolve to (regionId, lot-local tile); objects of another region are drawn there and pickable', () => {
    const v = makeView();
    const w = townWorld();
    v.sync(w);
    settle(v, 15, 15);
    // ground under scene (−15.5, 28.5) = world (54.5, 28.5) = n1 local (14.5, 28.5)
    const at = v.regionAtScene(-15.5, 28.5)!;
    expect(at.regionId).toBe('wormwood:mildew_n1');
    expect(at.local).toEqual({ x: 14.5, z: 28.5 });
    // across the street (s2, rot 2): scene (15.5, 45.5) = world (85.5, 45.5) = s2 local (14.5, 24.5)
    const s2 = v.regionAtScene(15.5, 45.5)!;
    expect(s2.regionId).toBe('wormwood:mildew_s2');
    expect(s2.local.x).toBeCloseTo(14.5, 9);
    expect(s2.local.z).toBeCloseTo(24.5, 9);
    // a ray down onto n3's shell hits the shell box first
    const ray = new THREE.Ray(new THREE.Vector3(45, 40, 17), new THREE.Vector3(0, -1, 0));
    const hit = v.pick(ray)!;
    expect(hit.regionId).toBe('wormwood:mildew_n3');
    expect(hit.point.y).toBeGreaterThan(1);
    // a sim object in n3 (lot-local (15, 25)) is drawn at its world place and picks by id
    const objects = new ObjectManager(fakeModels(), new SpecResolver(), new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas), new WindowGlow(), quiet());
    objects.regionFrames = (id) => v.contentFrame(id);
    const o = { id: 'o1', defId: 'chair_creaky', regionId: 'wormwood:mildew_n3', placement: { kind: 'floor', x: 15, z: 25, rot: 0 }, value: 1, purchasedTick: 0, tint: null, condition: { dirt: 0, broken: false, burning: false }, data: {}, reservedBy: {}, inUseBy: [], rev: 1 } as unknown as ObjectState;
    w.objects = { o1: o };
    const ctx: ObjectsContext = { state: w, env: { utilitiesOn: true, lampsOn: false, billsOutstanding: false }, timeSec: 0, wallHeight: () => 0, hasWall: () => false };
    objects.sync(ctx, 1 / 60);
    const c = objects.centerOf('o1', new THREE.Vector3())!;
    expect(c.x).toBeGreaterThan(30); // n3 starts at scene x 30
    const p = objects.pick(new THREE.Ray(new THREE.Vector3(c.x, 20, c.z), new THREE.Vector3(0, -1, 0)), Infinity);
    expect(p?.objectId).toBe('o1');
    expect(objects.chunkMeshes()).toBe(0); // other regions never join the home's lot chunks
    objects.dispose();
    v.dispose();
  });
});

describe('mirrored / rotated starts (S7 plan transform, PR #66) and template-matched shells (PR #65)', () => {
  /** Scene position of a shell-local point (front door etc.). */
  const scenePoint = (o: THREE.Object3D, x: number, z: number) => {
    o.updateWorldMatrix(true, false);
    return new THREE.Vector3(x, 0, z).applyMatrix4(o.matrixWorld);
  };

  it('a mirrored + shifted neighbour lot applies the same transform to its shell at every LOD and to the placeholder', () => {
    const v = makeView();
    v.sync(townWorld());
    settle(v, 15, 15);
    const plain = v.visual('wormwood:mildew_n3') as LotVisual;
    const info = v.shells.info(plain.shellId)!;
    const bounds = START_TEMPLATE_BOUNDS_V1[v.worldMap()!.regions.find(r => r.id === 'wormwood:mildew_n3')!.templateId!];
    const centre = (bounds.x0 + bounds.x1) / 2;
    const doorX = info.doors[0].x;
    const plainDoor = scenePoint(plain.shellObject()!, doorX, info.footprint.d / 2);
    v.setLotTransforms(new Map([['wormwood:mildew_n3', { mirrored: true, dx: 2, dz: -1 }]]));
    expect(v.visual('wormwood:mildew_n3')).toBeNull(); // rebuilt with the transform
    settle(v, 15, 15);
    const n3 = v.visual('wormwood:mildew_n3') as LotVisual;
    expect(n3.planOf()).toEqual({ mirrored: true, dx: 2, dz: -1 });
    for (const tier of ['active', 'warm'] as const) {
      settle(v, tier === 'active' ? 15 : -85, 15);
      expect(n3.tier).toBe(tier);
      const shell = n3.shellObject()!;
      expect(shell.scale.x).toBe(-1);
      // Mirror the authored centre across the lot, then translate (n3: scene x = local x + 30).
      const door = scenePoint(shell, doorX, info.footprint.d / 2);
      expect(door.x).toBeCloseTo(30 + (30 - centre) + 2 - doorX, 9);
      expect(door.z).toBeCloseTo(plainDoor.z - 1, 9);
      expect(new THREE.Matrix4().copy(shell.matrixWorld).determinant()).toBeLessThan(0);
    }
    // the placeholder house (shell missing / late) gets the same transform
    const bare = makeView(fakeModels(), shellLib(false));
    bare.sync(townWorld());
    bare.setLotTransforms(new Map([['wormwood:mildew_n3', { mirrored: true, dx: -3, dz: 1 }]]));
    settle(bare, 15, 15);
    const ph = bare.visual('wormwood:mildew_n3') as LotVisual;
    expect(ph.isPlaceholder()).toBe(true);
    expect(ph.shellObject()!.scale.x).toBe(-1);
    expect(ph.shellObject()!.position.x).toBe(30 - centre - 3);
    bare.dispose();
    v.dispose();
  });

  it('a rotated (south, rot 2) lot faces its street, mirrored or not; garbage transforms are the identity', () => {
    const v = makeView();
    v.sync(townWorld());
    // S7 includes a genuinely vacant slot, which has no shell. Exercise two furnished south lots.
    const ids = v.worldMap()!.regions.filter(r => r.id.startsWith('wormwood:mildew_s') && r.templateId !== 'empty').slice(0, 2).map(r => r.id);
    expect(ids).toHaveLength(2);
    v.setLotTransforms(new Map([[ids[0], { mirrored: true, dx: 1, dz: 0 }], [ids[1], { mirrored: 'yes', dx: 99, dz: NaN } as never]]));
    settle(v, 15, 15);
    for (const id of ids) {
      const shell = (v.visual(id) as LotVisual).shellObject()!;
      const back = scenePoint(shell, 0, -1);
      const front = scenePoint(shell, 0, 1);
      // the street is at scene z 30..40, the south lots at 40..70: the front (+Z local) points to −Z in the scene
      expect(front.z).toBeLessThan(back.z);
    }
    expect((v.visual(ids[1]) as LotVisual).planOf()).toEqual({ mirrored: false, dx: 0, dz: 0 });
    expect(planTransform({ dx: 2.5, dz: -9 } as never)).toEqual({ mirrored: false, dx: 0, dz: 0 });
    v.dispose();
  });

  it('shells match by template id (manifest `template`, else `lot` = bare template id), never by slot; missing → placeholder', () => {
    const lib = shellLib();
    lib.setManifest(
      parseHomesManifest({
        shells: {
          ...JSON.parse(readFileSync('public/assets/manifest.homes.json', 'utf8')).shells,
          shell_derelict: { lot: 'derelict', tileFootprint: { w: 8, d: 6 }, doors: [{ x: 0, z: 3 }], lods: [{ lod: 0, file: 'models/homes/shell_derelict.glb' }, { lod: 1, file: 'models/homes/shell_derelict_lod1.glb' }] },
        },
      }),
    );
    expect(lib.forTemplate('derelict')?.id).toBe('shell_derelict');
    expect(lib.forTemplate('starter')?.id).toBe('shell_starter');
    expect(lib.forTemplate('mildew_n3')).toBeNull();
    const map = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 3 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
    const n1 = { ...regionDef(map, 'wormwood:mildew_n1')!, templateId: 'derelict' };
    expect(shellIdFor(lib, n1, 3)).toBe('shell_derelict');
    // shell_derelict has no prototype here (its GLB is not on this branch): the lot draws the placeholder in its 8 × 6 footprint
    const v = makeView(fakeModels(), lib);
    v.sync(townWorld());
    const ctx = Object.assign(Object.create((v as unknown as { ctx: object }).ctx), { toScene: (x: number, z: number) => ({ x, z }) });
    const vis = new LotVisual('wormwood:mildew_n1', ctx, n1);
    vis.build('warm');
    expect(vis.shellId).toBe('shell_derelict');
    expect(vis.isPlaceholder()).toBe(true);
    expect(vis.shellObject()!.position.z).toBe(22 - 3);
    vis.dispose();
    v.dispose();
  });
});

describe('world backdrop (the fake ring only beyond the world extent)', () => {
  it('every backdrop prop stands outside the world extent, and the legacy layout is untouched', () => {
    const ext = { x0: -100, z0: -30, x1: 160, z1: 100 };
    const ring = backdropLayout(ext);
    expect(ring.length).toBeGreaterThan(8);
    for (const p of ring) {
      const inside = p.x > ext.x0 - (BACKDROP_MARGIN - 5) && p.x < ext.x1 + (BACKDROP_MARGIN - 5) && p.z > ext.z0 - (BACKDROP_MARGIN - 5) && p.z < ext.z1 + (BACKDROP_MARGIN - 5);
      expect(inside, `${p.id} @ ${p.x},${p.z}`).toBe(false);
    }
    expect(backdropLayout(ext)).toEqual(ring);
    // the legacy single-lot dressing still places its 11 fake neighbour houses (home-only worlds, AC-1)
    expect(envLayout({ width: 30, depth: 30, sidewalkZ: 28 }).filter((p) => p.id.startsWith('env_house')).length).toBe(11);
  });
});

describe('agent LOD across regions (§1.4: full rigs near the focus, 1-draw capsules farther / in warm regions)', () => {
  it('other-region agents beyond the full-detail radius become capsules; the selected one keeps its rig; home agents always do', () => {
    const v = makeView();
    const w = townWorld();
    v.sync(w);
    settle(v, 15, 15);
    const am = new AgentManager(fakeCharacters(), new FxSystem({ particleCapacity: 64, particleScale: 1 }, fakeAtlas), quiet());
    am.regionFrames = (id) => v.contentFrame(id);
    am.lodCenter = { x: 15, z: 15 };
    w.agents = {
      nearN3: walker('nearN3', 2, 20, 'wormwood:mildew_n3'), // scene (32, 20): 17.7 tiles from the focus
      farN1: walker('farN1', 2, 28.5, 'wormwood:mildew_n1'), // scene (−28, 28.5): 45 tiles
      homeFar: walker('homeFar', 29, 29), // home agents are never LOD'd
      warmG: walker('warmG', 15, 15, 'graveyard:old_graveyard'),
    };
    am.sync(w, 1, 1 / 60);
    expect(am.positionOf('nearN3')).not.toBeNull();
    expect(am.positionOf('farN1')).toBeNull();
    expect(am.positionOf('homeFar')).not.toBeNull();
    expect(am.farAgents.map((a) => a.id)).toEqual(['farN1']);
    expect(am.farAgents[0].x).toBeCloseTo(-28, 9);
    // the world view draws them as capsules: farN1 (LOD) + warmG (the graveyard is warm) in one instanced draw
    expect(v.tierOf('graveyard:old_graveyard')).toBe('warm');
    expect(v.syncFarAgents(w.agents, 15, 15, am.farAgents)).toBe(2);
    expect([...v.farAgents()].sort()).toEqual(['farN1', 'warmG']);
    // selecting the far one gives it its rig back
    am.setSelection('farN1');
    am.sync(w, 1, 1 / 60);
    expect(am.positionOf('farN1')).not.toBeNull();
    expect(am.farAgents.length).toBe(0);
    am.dispose();
    v.dispose();
  });
});
