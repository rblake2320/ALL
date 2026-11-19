/**
 * World view (W-025 S5, docs/DESIGN_WORLD_LEVELS.md §1.4 render tiers): draws every region of the walkable world
 * other than the home at its world placement, streams region meshes in and out of the render radius with hysteresis,
 * switches LOD between full detail (active) and low-detail shells (warm), and answers the renderer's world questions
 * (region frames for agents / objects, picking, signs, camera bounds, street lamps).
 *
 * Off (no regions, nothing drawn) for a HOME-ONLY world: no `town` block, or a migrated save whose streaming is still
 * frozen (`town.expandPending`). Such a world renders exactly the legacy scene (AC-1). The home itself is never drawn
 * here: the existing lot layers draw it at the scene origin (scene frame = home lot-local frame, worldFrame.ts).
 *
 * Streaming: tiers come from the camera focus (`computeRenderTiers`); cold regions are disposed at once (every
 * geometry / texture / material they own, Tracker), new ones are built at most `MAX_BUILDS_PER_FRAME` per frame so a
 * long pan never spikes a frame (§1.4 "≤ 4 ms of build work per frame"). Never throws out of its public methods.
 */
import * as THREE from 'three';
import type { ModelLibrary } from '../contracts';
import type { WindowGlow } from '../lighting/windowGlow';
import type { ThrottledWarn } from '../core/diagnostics';
import type { WorldState } from '../../sim/types';
import { buildWorldMap, regionsExtent } from '../../shared/mildewLane';
import { assignStartNeighbours } from '../../shared/startNeighbours';
import { homeRegionIdOf } from '../../shared/town';
import type { LotPlacement, RegionId, RenderTier, SignView, WorldMap, WorldPoint, WorldRect, WorldRegionDef } from '../../shared/world';
import { StaticBatcher } from '../objects/staticBatch';
import { HomeShellLibrary } from './homeShells';
import { computeRenderTiers, frameToScene, regionFrame, sceneToFrame, sceneToWorld, worldRectToScene, worldToScene, type RegionFrame, type RenderProfile, type TierRegion } from './worldFrame';
import { createRegionVisual, fallbackSignText, planTransform, WorldKit, LotVisual, type BaseVisual, type LotPlanTransform, type VisualContext } from './regionVisuals';
import { lotToWorld } from '../../shared/world';
import type { WallMode } from '../contracts';
import { FarAgents, type FarAgent } from './farAgents';

/** Region builds per frame (each ≈ 0.3–1.5 ms: a few merged geometries); the rest wait for the next frame. */
export const MAX_BUILDS_PER_FRAME = 2;

/** Identity frame of the home region (agents / objects without a transform). */
export interface HomeFrameMarker {
  home: true;
}

export interface WorldViewStats {
  /** World view on (the world is not home-only). */
  on: boolean;
  regions: number;
  active: number;
  warm: number;
  /** Region visuals currently built. */
  built: number;
  /** Lifetime counters (leak / churn tests, AC-2 "no full rebuild"). */
  createdTotal: number;
  disposedTotal: number;
  lodSwitches: number;
  /** World (re)builds: map changes (new world / attach). A walk never changes it. */
  worldBuilds: number;
  /** Builds deferred by the per-frame budget this frame. */
  deferred: number;
  profile: RenderProfile;
}

interface RegionEntry {
  def: WorldRegionDef;
  frame: RegionFrame;
  rect: WorldRect;
  sceneRect: WorldRect;
}

export class WorldView {
  readonly group = new THREE.Group();
  private map: WorldMap | null = null;
  private key = '';
  private home: LotPlacement | null = null;
  private homeId: RegionId = '';
  private seed = 0;
  private readonly entries = new Map<RegionId, RegionEntry>();
  private readonly visuals = new Map<RegionId, BaseVisual>();
  private tiers = new Map<RegionId, RenderTier>();
  private kit: WorldKit | null = null;
  private readonly batcher = new StaticBatcher();
  private readonly templates = new Map<string, { inst: THREE.Object3D; batch: THREE.Mesh | null }>();
  readonly shells: HomeShellLibrary;
  private profile: RenderProfile = 'desktop';
  private shellsDirty = false;
  private openRects: WorldRect[] = [];
  private focusRegion: RegionId | null = null;
  private wallMode: WallMode = 'cutaway';
  private readonly st: WorldViewStats = { on: false, regions: 0, active: 0, warm: 0, built: 0, createdTotal: 0, disposedTotal: 0, lodSwitches: 0, worldBuilds: 0, deferred: 0, profile: 'desktop' };
  private readonly ctx: VisualContext;
  private readonly tmp = { x: 0, z: 0 };
  private readonly lotTransforms = new Map<RegionId, LotPlanTransform>();
  /** Capsule LOD (1 draw) for agents standing in warm regions. */
  private readonly far = new FarAgents();
  private readonly farList: FarAgent[] = [];
  /** Translator for sign keys (S8 wires the i18n table; English fallback until then). */
  signText: (key: string) => string = fallbackSignText;

  constructor(
    private readonly models: ModelLibrary,
    private readonly glow: WindowGlow,
    private readonly warn: ThrottledWarn,
    shells: HomeShellLibrary,
    private anisotropy = 4,
  ) {
    this.group.name = 'world-regions';
    this.far.mesh.visible = false;
    this.batcher.minMeshes = 1;
    this.shells = shells;
    this.shells.onLoaded = () => {
      this.shellsDirty = true;
    };
    const self = this;
    this.ctx = {
      models,
      glow,
      shells,
      get kit() {
        return self.ensureKit();
      },
      batcher: this.batcher,
      template: (id) => this.template(id),
      get seed() {
        return self.seed;
      },
      get profile() {
        return self.profile;
      },
      get openRects() {
        return self.openRects;
      },
      toScene: (x, z) => ({ x, z }),
      lotTransform: (id) => this.lotTransforms.get(id) ?? null,
      signText: (k) => this.signText(k),
    } as VisualContext;
  }

  private ensureKit(): WorldKit {
    if (!this.kit) this.kit = new WorldKit(this.anisotropy);
    return this.kit;
  }

  /** True when the world view draws regions (the world is not home-only). */
  get on(): boolean {
    return this.map !== null;
  }

  /**
   * Follow the attached world: (re)build the region table when the world changes (new / loaded world, `townExpand`).
   * Returns whether the world view is on.
   */
  sync(state: WorldState | null): boolean {
    try {
      const town = state && state.town && typeof state.town === 'object' ? state.town : null;
      if (!town || town.expandPending !== false || !town.map) {
        if (this.map) this.clearWorld();
        return false;
      }
      const homeId = homeRegionIdOf(state);
      const lot = state!.lot;
      const key = `${town.map.genVersion}|${town.map.contentVersion}|${town.map.seed}|${homeId}|${town.start?.templateId ?? ''}|${town.start?.genVersion ?? 0}|${town.start?.neighbourSeed ?? 0}|${lot?.width}x${lot?.depth}`;
      if (key === this.key && this.map) return true;
      this.clearWorld();
      const map = buildWorldMap({ genVersion: town.map.genVersion, contentVersion: town.map.contentVersion, seed: town.map.seed }, { regionId: homeId, templateId: town.start?.templateId ?? null });
      assignStartNeighbours(map, homeId, town.start);
      const homeDef = map.regions.find((r) => r.id === homeId);
      if (!homeDef) return false;
      this.map = map;
      this.key = key;
      this.home = homeDef.placement;
      this.homeId = homeId;
      this.seed = town.map.seed >>> 0;
      for (const def of map.regions) {
        const frame = regionFrame(this.home, def.placement);
        const rect = placementRect(def.placement);
        const sceneRect = rect ? worldRectToScene(this.home, rect) : null;
        if (!frame || !rect || !sceneRect) continue;
        this.entries.set(def.id, { def, frame, rect, sceneRect });
      }
      this.group.add(this.far.mesh);
      this.openRects = [...this.entries.values()].filter((e) => e.def.kind !== 'unfinished').map((e) => e.rect);
      this.st.worldBuilds++;
      void this.shells.load();
      return true;
    } catch (e) {
      this.warn.warn('world-sync', 'world view sync failed', e);
      return false;
    }
  }

  /**
   * S7 seam: the plan transform (X mirror + translation) the start generator applied to each lot's built template
   * (PR #66 layout `mirrored`; the home's own walls are drawn by the lot layers). Regions whose transform changes are
   * rebuilt so every LOD and the placeholder use it. Garbage entries are sanitised to the identity.
   */
  setLotTransforms(t: ReadonlyMap<RegionId, Partial<LotPlanTransform>> | null): void {
    const next = new Map<RegionId, LotPlanTransform>();
    if (t) for (const [id, v] of t) next.set(id, planTransform(v));
    for (const id of new Set([...next.keys(), ...this.lotTransforms.keys()])) {
      const a = this.lotTransforms.get(id);
      const b = next.get(id);
      if (JSON.stringify(a) !== JSON.stringify(b)) this.drop(id);
    }
    this.lotTransforms.clear();
    for (const [id, v] of next) this.lotTransforms.set(id, v);
  }

  setProfile(p: RenderProfile): void {
    if (p === this.profile) return;
    this.profile = p;
    // shadows / radii differ: rebuild what is drawn on the next frames
    for (const id of [...this.visuals.keys()]) this.drop(id);
    this.tiers = new Map([...this.tiers].filter(([id]) => id === this.homeId));
  }

  getProfile(): RenderProfile {
    return this.profile;
  }

  setWallMode(m: WallMode): void {
    this.wallMode = m;
  }

  /**
   * Per frame: tiers from the camera focus (scene coordinates), stream visuals in / out, LOD, cutaway. `camera` (scene
   * position of the eye) lets the cutaway lower a neighbour's shell that stands between the eye and the focus.
   */
  update(focusX: number, focusZ: number, simActive: readonly RegionId[] | null, camera: { x: number; y: number; z: number } | null = null): void {
    if (!this.map || !this.home) return;
    try {
      const fw = sceneToWorld(this.home, Number.isFinite(focusX) ? focusX : 15, Number.isFinite(focusZ) ? focusZ : 15);
      if (!fw) return;
      const active = new Set(simActive ?? []);
      const regions: TierRegion[] = [];
      for (const e of this.entries.values()) regions.push({ id: e.def.id, kind: e.def.kind, rect: e.rect, simActive: active.has(e.def.id) });
      const next = computeRenderTiers({ regions, focus: fw, profile: this.profile, homeId: this.homeId, prev: this.tiers });
      this.focusRegion = this.regionAtWorld(fw.x, fw.z)?.def.id ?? null;
      if (this.shellsDirty) {
        // a shell (or the homes manifest) arrived: placeholder houses are rebuilt (layout depends on the footprint)
        this.shellsDirty = false;
        for (const [id, v] of [...this.visuals]) if (v instanceof LotVisual && v.isPlaceholder()) this.drop(id);
      }
      // dispose what left the radius
      for (const id of [...this.visuals.keys()]) if ((next.get(id) ?? 'cold') === 'cold') this.drop(id);
      // LOD switches + builds (nearest first)
      let builds = 0;
      let deferred = 0;
      const want = [...next.entries()].filter(([id, t]) => t !== 'cold' && id !== this.homeId);
      want.sort((a, b) => this.dist(a[0], fw) - this.dist(b[0], fw) || (a[0] < b[0] ? -1 : 1));
      const applied = new Map<RegionId, RenderTier>();
      applied.set(this.homeId, 'active');
      for (const [id, tier] of want) {
        const v = this.visuals.get(id);
        if (v) {
          if (v.tier !== tier) {
            v.setTier(tier);
            this.st.lodSwitches++;
          }
          applied.set(id, tier);
          continue;
        }
        if (builds >= MAX_BUILDS_PER_FRAME) {
          deferred++;
          continue;
        }
        if (this.build(id, tier)) {
          builds++;
          applied.set(id, tier);
        }
      }
      // tiers = what is actually drawn (a deferred region stays cold until built, so hysteresis sees the truth)
      this.tiers = applied;
      this.applyCutaway(focusX, focusZ, camera);
      this.st.deferred = deferred;
    } catch (e) {
      this.warn.warn('world-update', 'world view update failed', e);
    }
  }

  private dist(id: RegionId, fw: WorldPoint): number {
    const e = this.entries.get(id);
    if (!e) return Infinity;
    const r = e.rect;
    return Math.max(Math.max(r.x0 - fw.x, 0, fw.x - r.x1), Math.max(r.z0 - fw.z, 0, fw.z - r.z1));
  }

  private build(id: RegionId, tier: RenderTier): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    const frame = e.frame;
    const ctx: VisualContext = Object.create(this.ctx, { toScene: { value: (x: number, z: number) => frameToScene(frame, x, z, { x: 0, z: 0 }) } });
    const v = createRegionVisual(e.def, ctx);
    if (!v) return false;
    try {
      v.root.position.set(frame.x, 0, frame.z);
      v.root.rotation.y = frame.yaw;
      v.root.updateMatrix();
      this.group.add(v.root);
      v.root.updateMatrixWorld(true);
      v.build(tier);
      v.root.updateMatrixWorld(true);
      this.visuals.set(id, v);
      this.st.createdTotal++;
      return true;
    } catch (err) {
      this.warn.warn('world-build-' + id, `region ${id} build failed`, err);
      try {
        v.dispose();
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  private drop(id: RegionId): void {
    const v = this.visuals.get(id);
    if (!v) return;
    this.visuals.delete(id);
    try {
      v.dispose();
    } catch (e) {
      this.warn.warn('world-dispose', `region ${id} dispose failed`, e);
    }
    this.st.disposedTotal++;
  }

  /**
   * Shell cutaway per region (the home's walls keep their own cutaway): 'down' lowers every full-detail neighbour
   * shell; 'cutaway' lowers the shell of the lot under the camera focus and any shell standing between the eye and
   * the focus (so a zombie in a neighbour's yard, or the home seen across the street, is never hidden); 'up' none.
   */
  private applyCutaway(fx: number, fz: number, eye: { x: number; y: number; z: number } | null): void {
    const seg = this.segRay;
    let segLen = 0;
    if (eye && Number.isFinite(eye.x + eye.y + eye.z) && Number.isFinite(fx + fz)) {
      seg.origin.set(eye.x, eye.y, eye.z);
      seg.direction.set(fx - eye.x, 0.55 - eye.y, fz - eye.z);
      segLen = seg.direction.length();
      if (segLen > 1e-6) seg.direction.multiplyScalar(1 / segLen);
    }
    for (const [id, v] of this.visuals) {
      if (!(v instanceof LotVisual)) continue;
      let cut = false;
      if (v.tier === 'active') {
        if (this.wallMode === 'down') cut = true;
        else if (this.wallMode === 'cutaway') {
          cut = id === this.focusRegion;
          if (!cut && segLen > 1e-6)
            for (const b of v.pickBoxes()) {
              const hit = seg.intersectBox(b, this.segHit);
              if (hit && hit.distanceTo(seg.origin) < segLen) {
                cut = true;
                break;
              }
            }
        }
      }
      v.setCut(cut);
    }
  }
  private readonly segRay = new THREE.Ray();
  private readonly segHit = new THREE.Vector3();

  /** The late asset libraries arrived: rebuild templates and every built region (placeholders → real models). */
  assetsChanged(): void {
    this.releaseTemplates();
    for (const id of [...this.visuals.keys()]) this.drop(id);
    this.tiers = new Map([[this.homeId, 'active']]);
  }

  private template(id: string): THREE.Mesh | null {
    let t = this.templates.get(id);
    if (!t) {
      if (!safeHas(this.models, id)) return null;
      try {
        const inst = this.models.create(id, null);
        inst.updateMatrixWorld(true);
        const batch = this.batcher.batch(id, inst);
        t = { inst, batch };
        this.templates.set(id, t);
      } catch (e) {
        this.warn.warn('world-tpl-' + id, `world prop ${id} failed`, e);
        return null;
      }
    }
    return t.batch;
  }

  private releaseTemplates(): void {
    for (const t of this.templates.values()) {
      try {
        this.models.release?.(t.inst);
      } catch {
        /* optional */
      }
    }
    this.templates.clear();
  }

  // ───────────────────────────── queries ─────────────────────────────

  homeRegionId(): RegionId | null {
    return this.map ? this.homeId : null;
  }

  homePlacement(): LotPlacement | null {
    return this.home;
  }

  worldMap(): WorldMap | null {
    return this.map;
  }

  tierOf(id: RegionId): RenderTier {
    if (!this.map) return 'cold';
    return this.tiers.get(id) ?? 'cold';
  }

  /**
   * Frame of a region whose agents / objects are drawn now (render tier active), `'home'` for the home, null when
   * that region's contents are not drawn (warm: shell only; cold: nothing).
   */
  contentFrame(id: RegionId): RegionFrame | 'home' | null {
    if (!this.map || id === this.homeId) return 'home';
    if (this.tiers.get(id) !== 'active') return null;
    return this.entries.get(id)?.frame ?? null;
  }

  /** Scene frame of any region (drawn or not). */
  frameOf(id: RegionId): RegionFrame | null {
    return this.entries.get(id)?.frame ?? null;
  }

  private regionAtWorld(wx: number, wz: number): RegionEntry | null {
    for (const e of this.entries.values()) {
      const r = e.rect;
      if (wx >= r.x0 && wx < r.x1 && wz >= r.z0 && wz < r.z1) return e;
    }
    return null;
  }

  /** Region under a scene point and its lot-local position (any region, home included). */
  regionAtScene(sx: number, sz: number): { regionId: RegionId; kind: WorldRegionDef['kind']; local: WorldPoint; world: WorldPoint } | null {
    if (!this.home || !Number.isFinite(sx) || !Number.isFinite(sz)) return null;
    const w = sceneToWorld(this.home, sx, sz);
    if (!w) return null;
    const e = this.regionAtWorld(w.x, w.z);
    if (!e) return null;
    const l = sceneToFrame(e.frame, sx, sz, { x: 0, z: 0 });
    return { regionId: e.def.id, kind: e.def.kind, local: { x: l.x, z: l.z }, world: { x: w.x, z: w.z } };
  }

  /** Scene point of a region's lot-local point (any region). */
  toScene(regionId: RegionId, x: number, z: number): WorldPoint | null {
    const e = this.entries.get(regionId);
    if (!e) return null;
    const p = frameToScene(e.frame, x, z, this.tmp);
    return { x: p.x, z: p.z };
  }

  /** World point of a region's lot-local point. */
  toWorld(regionId: RegionId, x: number, z: number): WorldPoint | null {
    const e = this.entries.get(regionId);
    return e ? lotToWorld(e.def.placement, x, z) : null;
  }

  /** Scene point of a world point. */
  worldToSceneP(wx: number, wz: number): WorldPoint | null {
    return this.home ? worldToScene(this.home, wx, wz) : null;
  }

  /** Nearest structure (shell) hit along a scene ray. */
  pick(ray: THREE.Ray): { regionId: RegionId; t: number; point: THREE.Vector3 } | null {
    let best: { regionId: RegionId; t: number; point: THREE.Vector3 } | null = null;
    const p = new THREE.Vector3();
    for (const [id, v] of this.visuals) {
      for (const b of v.pickBoxes()) {
        const hit = ray.intersectBox(b, p);
        if (!hit) continue;
        const t = hit.distanceTo(ray.origin);
        if (!best || t < best.t) best = { regionId: id, t, point: hit.clone() };
      }
    }
    return best;
  }

  /** Union of drawn (active + warm) region rects and the home, scene coordinates (camera pan bounds). */
  sceneBounds(): WorldRect | null {
    let r: WorldRect | null = null;
    for (const [id, t] of this.tiers) {
      if (t === 'cold') continue;
      const e = this.entries.get(id);
      if (!e || e.def.kind === 'unfinished') continue;
      const s = e.sceneRect;
      r = r ? { x0: Math.min(r.x0, s.x0), z0: Math.min(r.z0, s.z0), x1: Math.max(r.x1, s.x1), z1: Math.max(r.z1, s.z1) } : { ...s };
    }
    return r;
  }

  /** Whole-world extent in scene coordinates (ground / backdrop sizing). */
  sceneExtent(): WorldRect | null {
    if (!this.map || !this.home) return null;
    const ext = regionsExtent(this.map.regions);
    return ext ? worldRectToScene(this.home, ext) : null;
  }

  /** Scene rect of a region. */
  sceneRectOf(id: RegionId): WorldRect | null {
    return this.entries.get(id)?.sceneRect ?? null;
  }

  /** Street lamps of drawn streets (scene positions). */
  lamps(): { obj: THREE.Object3D; x: number; y: number; z: number }[] {
    const out: { obj: THREE.Object3D; x: number; y: number; z: number }[] = [];
    for (const v of this.visuals.values()) for (const l of v.lamps) out.push(l);
    return out;
  }

  /** Every in-world sign of the map with its resolved text (DOM seam, §1.16 `SignView`), nearest to `focus` first. */
  signs(focusScene?: { x: number; z: number }): SignView[] {
    if (!this.map || !this.home) return [];
    const out: (SignView & { d: number })[] = [];
    const fw = focusScene ? sceneToWorld(this.home, focusScene.x, focusScene.z) : null;
    for (const def of this.map.regions) {
      const u = def.unfinished;
      if (!u) continue;
      u.signs.forEach((s, i) => {
        const e = this.entries.get(s.regionId);
        const w = e ? lotToWorld(e.def.placement, s.x, s.z) : null;
        if (!w) return;
        const d = fw ? Math.hypot(w.x - fw.x, w.z - fw.z) : 0;
        out.push({ id: `${u.id}#${i}`, regionId: s.regionId, textKey: u.signTextKey, text: this.signText(u.signTextKey), world: w, d });
      });
    }
    out.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
    return out.map(({ d: _d, ...s }) => s);
  }

  /** Built visual (tests / debug). */
  visual(id: RegionId): BaseVisual | null {
    return this.visuals.get(id) ?? null;
  }

  stats(): WorldViewStats {
    let a = 0;
    let w = 0;
    for (const [id, t] of this.tiers) {
      if (id === this.homeId) continue;
      if (t === 'active') a++;
      else if (t === 'warm') w++;
    }
    return { ...this.st, on: this.map !== null, regions: this.entries.size, active: a, warm: w, built: this.visuals.size, profile: this.profile };
  }

  /**
   * Per frame: agents standing in a WARM region become far-agent capsules (one draw, nearest FAR_AGENT_MAX to the
   * focus); active-region agents have full rigs (AgentManager), cold ones are not drawn. Returns the count drawn.
   */
  syncFarAgents(agents: WorldState['agents'] | null | undefined, focusX: number, focusZ: number, extra: readonly FarAgent[] = []): number {
    this.farList.length = 0;
    for (const x of extra) this.farList.push(x);
    if (this.map && agents && typeof agents === 'object') {
      for (const id in agents) {
        const a = agents[id];
        if (!a || a.presence !== 'onLot' || typeof a.regionId !== 'string' || a.regionId === this.homeId) continue;
        if (this.tiers.get(a.regionId) !== 'warm' || !a.pos) continue;
        const e = this.entries.get(a.regionId);
        if (!e) continue;
        const p = frameToScene(e.frame, a.pos.x, a.pos.z, this.tmp);
        this.farList.push({ id, x: p.x, z: p.z, color: a.appearance && typeof a.appearance.topColor === 'string' ? a.appearance.topColor : null });
      }
    }
    const n = this.far.set(this.farList, focusX, focusZ);
    this.far.mesh.visible = n > 0;
    return n;
  }

  /** Ids of agents drawn as far capsules this frame (tests / debug). */
  farAgents(): readonly string[] {
    return this.far.drawn();
  }

  /** Per frame: street lamp bulbs follow the lamps-on period. */
  updateLamps(lit: boolean, timeSec: number, state: import('../contracts').ObjectVisualState): void {
    state.lit = lit;
    for (const v of this.visuals.values())
      for (const l of v.lamps) {
        try {
          this.models.update(l.obj, state, timeSec);
        } catch {
          /* one lamp never breaks the frame */
        }
      }
  }

  private clearWorld(): void {
    this.far.set([], 0, 0);
    this.far.mesh.visible = false;
    this.far.mesh.removeFromParent();
    for (const id of [...this.visuals.keys()]) this.drop(id);
    this.entries.clear();
    this.tiers = new Map();
    this.map = null;
    this.home = null;
    this.homeId = '';
    this.key = '';
    this.openRects = [];
    this.focusRegion = null;
  }

  dispose(): void {
    this.clearWorld();
    this.releaseTemplates();
    this.kit?.dispose();
    this.kit = null;
    this.batcher.dispose();
    this.far.dispose();
    this.shells.dispose();
    this.group.removeFromParent();
  }
}

function placementRect(p: LotPlacement): WorldRect | null {
  const a = lotToWorld(p, 0, 0);
  const b = lotToWorld(p, p.width, p.depth);
  if (!a || !b) return null;
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
}

function safeHas(m: ModelLibrary, id: string): boolean {
  try {
    return m.has(id);
  } catch {
    return false;
  }
}
