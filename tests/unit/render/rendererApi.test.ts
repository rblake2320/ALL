/**
 * RendererAPI robustness without a GPU (node): every contract method accepts garbage, before init(), with a
 * garbage / half-built simulation attached, and after dispose() — nothing throws, nothing returns NaN.
 * (frame()/consumeEvents() under a real WebGL context are exercised in the browser by dev/render.leak.cjs.)
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createRenderer, rendererDebug } from '../../../src/render/index';
import type { CharacterFactory, ModelLibrary, RendererAPI } from '../../../src/render/contracts';
import type { SimulationAPI } from '../../../src/sim/contracts';
import { AgentMaterialWarmupGate } from '../../../src/render/core/agentMaterialWarmup';

function libs(): { models: ModelLibrary; characters: CharacterFactory } {
  const models: ModelLibrary = {
    ready: Promise.resolve(),
    progress: () => 1,
    has: () => true,
    create: () => new THREE.Group(),
    update: () => undefined,
    bounds: () => new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)),
    release: () => undefined,
    dispose: () => undefined,
  };
  const characters: CharacterFactory = {
    ready: Promise.resolve(),
    progress: () => 1,
    create: () => {
      throw new Error('no rigs in this test');
    },
    dispose: () => undefined,
  };
  return { models, characters };
}

const GARBAGE: unknown[] = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1e12, '', 'bogus', {}, [], () => 1, Symbol('x'), true];

function hammer(r: RendererAPI): void {
  const any = r as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const g of GARBAGE) {
    any.attach(g);
    any.frame(g, g);
    any.consumeEvents(g);
    any.consumeEvents([g, { type: g }, { type: 'fx', kind: g, pos: g }, { type: 'voice', agentId: g, durationMs: g }, { type: 'lot', what: g }]);
    any.resize(g, g);
    any.setPixelRatio(g);
    any.setQuality(g);
    any.setViewMode(g);
    any.setWallMode(g);
    any.rotateCamera(g);
    any.orbit(g, g);
    any.zoom(g);
    any.pan(g, g);
    any.panWorld(g, g);
    any.focus(g, g);
    any.follow(g);
    any.setCamera(g, g);
    any.setCamera({ target: g, yaw: g, pitch: g, distance: g }, true);
    any.pick(g, g, g);
    any.pickGrid(g, g);
    any.worldToScreen(g, g, g);
    any.setSelection(g);
    any.setHover(g);
    any.setHover({ kind: 'object', id: g });
    any.setPlacementGhost(g);
    any.setPlacementGhost({ defId: g, x: g, z: g, rot: g, valid: g, tiles: g, blockedSlots: g, edge: g, side: g });
    any.setBuildOverlay(g);
    any.setBuildOverlay({ edges: g, edgeMode: g, tiles: g, tileMode: g, valid: g, styleId: g, hoverEdge: g, label: g });
    any.setHiddenObject(g);
    void (any.thumbnail(g, g) as Promise<string>).catch(() => undefined);
    expect(typeof any.snapshot(g, g)).toBe('string');
  }
  const cam = r.getCamera();
  for (const v of [cam.target.x, cam.target.z, cam.yaw, cam.pitch, cam.distance]) expect(Number.isFinite(v)).toBe(true);
  expect(['up', 'cutaway', 'down']).toContain(r.getWallMode());
  const p = r.loadProgress();
  expect(p).toBeGreaterThanOrEqual(0);
  expect(p).toBeLessThanOrEqual(1);
  expect(Number.isFinite(r.fps())).toBe(true);
  expect(Array.isArray(r.bubbleAnchors())).toBe(true);
  const w = r.worldToScreen(NaN, 0, 0);
  expect(w.visible).toBe(false);
  expect(Number.isFinite(w.x) && Number.isFinite(w.y)).toBe(true);
}

describe('RendererAPI robustness (no GPU)', () => {
  it('createRenderer rejects missing libraries but nothing else', () => {
    expect(() => createRenderer(undefined as never)).toThrow();
    expect(() => createRenderer({ models: null, characters: null } as never)).toThrow();
    const r = createRenderer(libs());
    expect(rendererDebug(r)).not.toBeNull();
    r.dispose();
  });

  it('every method survives garbage before init()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = createRenderer(libs());
    expect(() => hammer(r)).not.toThrow();
    // camera API semantics without a context
    r.setCamera({ yaw: 1, pitch: 0.9, distance: 20, target: { x: 10, z: 12 } }, true);
    const c = r.getCamera();
    expect(c.distance).toBeCloseTo(20, 5);
    expect(c.pitch).toBeCloseTo(0.9, 5);
    r.setCamera({ pitch: 99, distance: -5 }, true);
    expect(r.getCamera().pitch).toBeLessThanOrEqual(1.25);
    expect(r.getCamera().distance).toBeGreaterThanOrEqual(6);
    // +1 from an off-grid yaw snaps onto the next 45° step clockwise (yaw 1 rad → π/4)
    r.rotateCamera(1);
    expect(r.getCamera().yaw).toBeCloseTo(Math.PI / 4, 5);
    r.rotateCamera(1);
    expect(r.getCamera().yaw).toBeCloseTo(0, 5);
    // a ray straight down the middle of the default view hits the lot ground (tile) or nothing — never throws
    const pk = r.pick(640, 360);
    expect(['tile', 'none']).toContain(pk.kind);
    r.dispose();
    warn.mockRestore();
  });

  it('a half-built / hostile simulation never breaks attach, pick, events or bubbles', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = createRenderer(libs());
    const hostile = {
      get state() {
        throw new Error('state exploded');
      },
      spatial: {
        roomAt: () => {
          throw new Error('rooms exploded');
        },
      },
    } as unknown as SimulationAPI;
    expect(() => r.attach(hostile)).not.toThrow();
    expect(() => hammer(r)).not.toThrow();
    const weird = { state: { lot: { width: NaN, depth: -3, walls: null, floors: 'x' }, agents: { a: null, b: { pos: { x: NaN } } }, objects: { o: { defId: 7 } }, tick: 'x' } } as unknown as SimulationAPI;
    expect(() => r.attach(weird)).not.toThrow();
    expect(() => r.focus('b')).not.toThrow();
    expect(() => r.consumeEvents([{ type: 'fx', kind: 'puff', agentId: 'b' }, { type: 'fx', kind: 'puff', objectId: 'o' }] as never)).not.toThrow();
    expect(r.pickGrid(NaN, 5)).toBeNull();
    r.dispose();
    warn.mockRestore();
  });

  it('W-039 / D-025 surface: auto quality, explicit pixel ratio and graphicsInfo() survive garbage before init()', () => {
    const r = createRenderer(libs());
    const any = r as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const g of GARBAGE) {
      any.setQuality(g, g);
      any.setQuality('auto', g);
      any.setPixelRatio(g, g);
      any.setAutoQualitySampling(g);
    }
    r.setQuality('auto', null);
    const info = r.graphicsInfo!();
    expect(info.auto).toMatchObject({ phase: 'probe', level: 'medium', gpuKind: 'unknown' }); // no GL yet: unknown GPU
    expect(Number.isFinite(info.pixelRatio)).toBe(true);
    r.setQuality('auto', 'low'); // a stored result resumes without probing
    expect(r.graphicsInfo!().auto).toMatchObject({ phase: 'watch', level: 'low' });
    r.setQuality('ultra');
    expect(r.graphicsInfo!()).toMatchObject({ level: 'ultra', auto: null });
    r.setPixelRatio(1, true);
    expect(r.graphicsInfo!()).toMatchObject({ pixelRatioExplicit: true, supersampled: false });
    r.setPixelRatio(1);
    expect(r.graphicsInfo!().pixelRatioExplicit).toBe(false);
    r.dispose();
  });

  it('dispose() is idempotent and the renderer stays inert afterwards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = createRenderer(libs());
    r.dispose();
    r.dispose();
    expect(() => hammer(r)).not.toThrow();
    await expect(r.init({} as HTMLCanvasElement, { quality: 'high', pixelRatio: 1 })).rejects.toThrow();
    // thumbnails after dispose resolve (to the fallback icon) instead of hanging
    const url = await r.thumbnail('sofa_velvet');
    expect(typeof url).toBe('string');
    warn.mockRestore();
  });

  it('createPreview() without a GPU degrades to an inert stage (no throw, setters safe, dispose idempotent)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = createRenderer(libs());
    const canvas = { clientWidth: 360, clientHeight: 480, width: 360, height: 480, getContext: () => null, addEventListener: () => undefined, removeEventListener: () => undefined, style: {} } as unknown as HTMLCanvasElement;
    const stage = r.createPreview(canvas);
    for (const g of GARBAGE) {
      const s = stage as unknown as Record<string, (...a: unknown[]) => unknown>;
      expect(() => {
        s.setAppearance(g);
        s.setLimbs(g);
        s.setAnim(g);
        s.setExpression(g);
        s.setYaw(g);
        s.resize(g, g);
      }).not.toThrow();
    }
    stage.setAnim('dance');
    stage.dispose();
    stage.dispose();
    r.dispose();
    warn.mockRestore();
  });
});

describe('renderer material warm-up (fake WebGL)', () => {
  it('compiles once per revision with the live group, camera and scene; skips unchanged and empty collections', () => {
    const renderer = createRenderer(libs());
    const debug = rendererDebug(renderer)!;
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const empty = new THREE.Group();
    const compile = vi.fn();
    const gl = { compile } as unknown as THREE.WebGLRenderer;
    const gate = new AgentMaterialWarmupGate();
    const internal = renderer as unknown as {
      sceneRoot: THREE.Scene | null;
      warmupMaterials(g: AgentMaterialWarmupGate, revision: string, renderer: THREE.WebGLRenderer, objects: THREE.Object3D, kind: string): void;
    };
    internal.sceneRoot = scene;
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10).mockReturnValueOnce(13)
      .mockReturnValueOnce(20).mockReturnValueOnce(24)
      .mockReturnValueOnce(30).mockReturnValueOnce(37);

    try {
      internal.warmupMaterials(gate, 'r1', gl, group, 'agent');
      internal.warmupMaterials(gate, 'r1', gl, group, 'agent');
      internal.warmupMaterials(gate, 'r2', gl, group, 'agent');
      internal.warmupMaterials(gate, 'r3', gl, empty, 'agent');
      internal.warmupMaterials(gate, 'r3', gl, group, 'agent');

      expect(compile).toHaveBeenCalledTimes(3);
      expect(compile).toHaveBeenNthCalledWith(1, group, debug.camera(), scene);
      expect(compile).toHaveBeenNthCalledWith(2, group, debug.camera(), scene);
      expect(compile).toHaveBeenNthCalledWith(3, group, debug.camera(), scene);
      expect(debug.stats()).toMatchObject({ precompileCalls: 3, precompileMs: 14 });
      expect(now).toHaveBeenCalledTimes(6);
    } finally {
      now.mockRestore();
      renderer.dispose();
    }
  });
});
