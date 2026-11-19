/**
 * Agent manager: one ZombieRig per on-lot agent (characters.create), pose interpolation (prevPos → pos by
 * alpha, shortest-arc facing, root y = posY), anim + measured walk-cycle speed, expression, carry, decay,
 * limbs, talking (from 'voice' events), hover/selection highlight, persistent FX (fly swarm & stench for
 * reeking zombies, zzz over sleepers, notes around dancers) and capsule colliders for picking.
 */
import * as THREE from 'three';
import { frameToScene, type ContentFrameLookup, type RegionFrame } from '../world/worldFrame';
import type { CharacterFactory, ZombieRig } from '../contracts';
import type { AgentState, WorldState } from '../../sim/types';
import type { SimulationAPI } from '../../sim/contracts';
import { ANIM_STATES, EXTRA_ANIM_STATES, EXPRESSIONS, CARRY_ITEMS, LIMB_IDS, type AnimState, type AnyAnimState, type Expression, type CarryItem, type LimbState } from '../../shared/appearance';
import { DIM } from '../../shared/dimensions';
import { createAgentPose, interpolateAgentPose, moveSpeedScale } from './interp';
import type { FxSystem, EmitterHandle } from '../fx/fx';
import type { ThrottledWarn } from '../core/diagnostics';
import { rayCapsule } from '../picking/rayMath';
import { dampFactor } from '../core/math';
import { applyShadowFlags } from '../objects/objects';
import { isSeatedClip, seatOffset, slotSeat, type SeatOffset } from './seat';
import { castHeightScale, heightScale, OFF_FEET_ANIMS } from '../characters/plan';
import { catalogSlot, isPosedRestSlot, lieLift, socialPush, socialSpacing, workFaceDist, workStandoff, workTop, WORK_FACE_DIST } from './reach';
import { faceObjectPose, frameCentre, frameLocalTile } from '../../sim/spatial/geometry';

/**
 * Rig parts smaller than this (geometry bounding radius) skip the shadow pass: hands, shoes, mouth, accessories and
 * carried props — about 6 of a zombie's ~14 caster draws. Head, torso, sleeves, legs and hair carry the silhouette.
 */
export const AGENT_SHADOW_MIN_RADIUS = 0.25;

/** Traverse visitor (allocation free): drop castShadow on small rig parts; never turns shadows on. */
export function cullAgentShadowCasters(o: THREE.Object3D): void {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.castShadow || !m.geometry) return;
  const g = m.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const r = g.boundingSphere ? g.boundingSphere.radius : Infinity;
  if (Number.isFinite(r) && r < AGENT_SHADOW_MIN_RADIUS) m.castShadow = false;
}

/**
 * Rig culling sphere (renderer-side frustum culling: the character library disables per-mesh culling because skinned
 * bounds lag the animation). Centred at hip height; the radius covers the body plus margin. With a key light the
 * sphere is stretched over the zombie's shadow (long at dusk/dawn) so a zombie just off-screen still casts into view.
 */
export const AGENT_CULL_CENTER_Y = 0.9;
export const AGENT_CULL_RADIUS = 2.6;
/** Height used to size the shadow a zombie throws (head top + hair). */
const CASTER_HEIGHT = 1.9;
/** Longest shadow considered (very low sun): beyond this the shadow is too faint to matter. */
export const AGENT_MAX_SHADOW = 14;

/**
 * Culling sphere for a zombie at (x, y, z) lit from `light` (unit vector toward the light; null = no shadow
 * stretch). Writes centre + radius into `out` (allocation free). Pure; exported for tests.
 */
export function agentCullSphere(x: number, y: number, z: number, light: { x: number; y: number; z: number } | null, out: THREE.Sphere): THREE.Sphere {
  out.center.set(x, y + AGENT_CULL_CENTER_Y, z);
  out.radius = AGENT_CULL_RADIUS;
  if (!light || !Number.isFinite(light.x) || !Number.isFinite(light.y) || !Number.isFinite(light.z)) return out;
  const h = Math.hypot(light.x, light.z);
  if (!(light.y > 0) || h < 1e-6) return out;
  // shadow length on the ground for the caster height, capped; the shadow points away from the light
  const len = Math.min(AGENT_MAX_SHADOW, (CASTER_HEIGHT * h) / light.y);
  const half = len / 2;
  out.center.x -= (light.x / h) * half;
  out.center.z -= (light.z / h) * half;
  out.center.y = y + AGENT_CULL_CENTER_Y * 0.5;
  out.radius = Math.max(AGENT_CULL_RADIUS, half + 1.6);
  return out;
}

/** Core + extra states (W-056): an extra reaches the rig, which plays its clip or EXTRA_ANIM_FALLBACK. */
const ANIMS = new Set<string>([...ANIM_STATES, ...EXTRA_ANIM_STATES]);
const EXPRS = new Set<string>(EXPRESSIONS);
const CARRIES = new Set<string>(CARRY_ITEMS);
const FAIL_RETRY_SEC = 5;

interface AgentEntry {
  id: string;
  rig: ZombieRig;
  appearanceRef: unknown;
  appearanceKey: string;
  limbs: LimbState;
  anim: string;
  expr: string;
  carry: string | null;
  highlight: 'none' | 'hover' | 'selected';
  decay: number;
  talkUntil: number;
  talking: boolean;
  speed: number;
  lastX: number;
  lastZ: number;
  moveScale: number;
  readonly pose: ReturnType<typeof createAgentPose>;
  readonly head: THREE.Vector3;
  flies: EmitterHandle | null;
  stench: EmitterHandle | null;
  zzz: EmitterHandle | null;
  notes: EmitterHandle | null;
  seen: number;
  checkTick: number;
  /** Smoothed seated root offset (seat.ts): forward along the facing + lift. */
  seatFwd: number;
  seatLift: number;
  observedRenderRevision: number;
  /** Damped standing-fit offset (reach.ts: social spacing, work stand-off, rest-slot approach), world metres. */
  offX: number;
  offY: number;
  offZ: number;
}

export interface AgentPick {
  agentId: string;
  t: number;
  point: THREE.Vector3;
}

type SysFn = (id: string) => Record<string, unknown> | undefined;

export class AgentManager {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, AgentEntry>();
  private readonly failed = new Map<string, number>();
  private gen = 0;
  private clock = 0;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private hiddenId: string | null = null;
  private readonly drawnPose = { x: 0, y: 0, z: 0, facing: 0 };
  private readonly pendingTalk = new Map<string, number>();
  private sys: SysFn | null = null;
  /** Interaction id → is it a sleep (tagged 'sleep': beds, coffins, sofa naps)? Resolved once from the content. */
  private readonly sleepIx = new Map<string, boolean>();
  private content: SimulationAPI['content'] | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  /**
   * W-025 S5: where agents of other regions are drawn (null = every agent is home content, the legacy behaviour).
   * An agent whose region is not drawn now (warm / cold) gets no rig.
   */
  regionFrames: ContentFrameLookup | null = null;
  private readonly frameTmp = { x: 0, z: 0 };
  /**
   * W-025 S5 agent LOD (§1.4 budget rows), on only while `lodCenter` is set (the walkable-world view; a home-only world
   * never sets it, so its scene is unchanged): an agent gets a full rig when it is among the `fullCap` nearest to
   * `lodCenter` AND within AGENT_FULL_DETAIL tiles of it (AGENT_FULL_DETAIL_LEAVE once it has a rig; a rigged agent
   * also ranks LOD_RANK_SLACK tiles closer, so nobody flickers between LODs), plus the selected / followed agent
   * always. Everyone else is listed in `farAgents` for the 1-draw capsule LOD (measured: a classic rig costs ≈ 28 draw
   * calls with its shadow pass, not the ≈ 10 the design assumed — A3, DESIGN §1.19).
   */
  lodCenter: { x: number; z: number } | null = null;
  keepFull: string | null = null;
  /** Full-rig cap while the LOD is on (the renderer sets desktop / phone values). */
  fullCap = AGENT_FULL_DETAIL_MAX;
  readonly farAgents: { id: string; x: number; z: number; color: string | null }[] = [];
  private readonly fullDetail = new Set<string>();
  private readonly lodCands: { id: string; d: number; rank: number; a: AgentState; frame: RegionFrame | null }[] = [];
  /** Rigs hidden by the last cull() (diagnostics). */
  culled = 0;
  /** Frustum culling on/off (profiling A/B; on by default). */
  cullEnabled = true;
  private renderRevision = 0;

  /** Stable identity/revision string for shader-bearing rigs, including asynchronous body upgrades. */
  get materialRevision(): string {
    return this.entries.size ? String(this.renderRevision) : '';
  }

  constructor(
    private readonly characters: CharacterFactory,
    private readonly fx: FxSystem,
    private readonly warn: ThrottledWarn,
  ) {
    this.group.name = 'agents';
  }

  setSelection(id: string | null): void {
    this.selectedId = typeof id === 'string' ? id : null;
  }

  setHover(id: string | null): void {
    this.hoverId = typeof id === 'string' ? id : null;
  }

  /** 'voice' event: flap the mouth for durationMs (capped at 10 s). */
  talk(agentId: string, durationMs: number): void {
    if (typeof agentId !== 'string') return;
    const ms = Number.isFinite(durationMs) ? Math.min(Math.max(durationMs, 0), 10000) : 800;
    const until = this.clock + ms / 1000;
    const e = this.entries.get(agentId);
    if (e) e.talkUntil = Math.max(e.talkUntil, until);
    else this.pendingTalk.set(agentId, until);
  }

  /** Rendered root position of an agent (for focus/follow/FX); null when not on lot. */
  positionOf(id: string): { x: number; y: number; z: number } | null {
    const e = this.entries.get(id);
    if (!e || !e.pose.valid) return null;
    return e.pose;
  }

  /**
   * Where the body is DRAWN, with its facing (the camera's subject in shoulder / first person): the rig root, i.e.
   * the pose plus the seat / lying / standing fits, so the camera stays on a zombie that sits down or lies in its
   * coffin. Null when not on lot.
   */
  poseOf(id: string): { x: number; y: number; z: number; facing: number } | null {
    const e = this.entries.get(id);
    if (!e || !e.pose.valid) return null;
    const p = e.rig.root.position;
    const out = this.drawnPose;
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.facing = e.rig.root.rotation.y;
    return out;
  }

  /** W-136: one rig that is never drawn (the zombie whose eyes the camera is in); null = none. */
  setHidden(id: string | null): void {
    this.hiddenId = typeof id === 'string' ? id : null;
  }

  /** Head-top world position (bubbles / FX anchors). */
  headOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const e = this.entries.get(id);
    if (!e || !e.pose.valid) return null;
    return out.copy(e.head);
  }

  /** Is any on-lot zombie within r tiles of (x, z)? */
  anyNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const e of this.entries.values()) {
      if (!e.pose.valid) continue;
      const dx = e.pose.x - x;
      const dz = e.pose.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /**
   * Door swing (decision #14d): a zombie stands in the doorway, or is walking (limping, crawling) within reach of it.
   * Uses the sim's locomotion anim rather than measured speed so a paused game doesn't slam doors in faces.
   */
  doorTraffic(x: number, z: number): boolean {
    for (const e of this.entries.values()) {
      if (!e.pose.valid) continue;
      if (doorTrafficFor(e.pose.x - x, e.pose.z - z, e.anim)) return true;
    }
    return false;
  }

  ids(): IterableIterator<string> {
    return this.entries.keys();
  }

  count(): number {
    return this.entries.size;
  }

  /** Bind the simulation (caches its optional `sys()` accessor for decay levels). */
  setSim(sim: SimulationAPI | null): void {
    this.sys = resolveSys(sim);
    this.sleepIx.clear();
    try {
      this.content = sim && sim.content && typeof sim.content === 'object' ? sim.content : null;
    } catch {
      this.content = null;
    }
  }

  /** Is the agent asleep (sleep / collapse anims, or running any 'sleep'-tagged interaction such as a sofa nap)? */
  private asleep(a: AgentState, anim: string): boolean {
    if (anim === 'sleep' || anim === 'collapse') return true;
    const act = a.active;
    if (!act || act.phase !== 'run' || typeof act.interactionId !== 'string') return false;
    let v = this.sleepIx.get(act.interactionId);
    if (v === undefined) {
      v = false;
      try {
        const def = this.content?.interactions?.[act.interactionId];
        v = !!def && Array.isArray(def.tags) && def.tags.includes('sleep');
      } catch {
        v = false;
      }
      this.sleepIx.set(act.interactionId, v);
    }
    return v;
  }

  sync(state: WorldState, alpha: number, dt: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    this.clock += step;
    const gen = ++this.gen;
    const agents = state && state.agents && typeof state.agents === 'object' ? state.agents : {};
    const sys = this.sys;
    this.farAgents.length = 0;
    this.lodCands.length = 0;
    for (const id in agents) {
      const a = agents[id];
      if (!a || typeof a !== 'object' || a.presence !== 'onLot') continue;
      let frame: RegionFrame | null = null;
      if (this.regionFrames && typeof a.regionId === 'string') {
        const f = this.regionFrames(a.regionId);
        if (f === null) continue;
        if (f !== 'home') frame = f;
      }
      if (this.lodCenter && a.pos && Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z)) {
        // decided below, nearest first
        if (frame) frameToScene(frame, a.pos.x, a.pos.z, this.frameTmp);
        else {
          this.frameTmp.x = a.pos.x;
          this.frameTmp.z = a.pos.z;
        }
        const d = Math.hypot(this.frameTmp.x - this.lodCenter.x, this.frameTmp.z - this.lodCenter.z);
        this.lodCands.push({ id, d, rank: d - (this.fullDetail.has(id) ? LOD_RANK_SLACK : 0), a, frame });
        continue;
      }
      try {
        this.syncOne(id, a, alpha, step, gen, sys, state.objects, agents, frame);
        const entry = this.entries.get(id);
        if (entry) {
          const revision = entry.rig.renderRevision ?? 0;
          if (entry.observedRenderRevision !== revision) {
            entry.observedRenderRevision = revision;
            this.renderRevision++;
          }
        }
      } catch (err) {
        this.warn.warn('agent-sync', `agent ${id} sync failed`, err);
      }
    }
    if (this.lodCands.length) {
      this.lodCands.sort((p, q) => p.rank - q.rank || (p.id < q.id ? -1 : 1));
      let full = 0;
      const cap = Number.isFinite(this.fullCap) ? Math.max(0, this.fullCap) : AGENT_FULL_DETAIL_MAX;
      for (const c of this.lodCands) {
        const keep = c.id === this.keepFull || c.id === this.selectedId;
        const r = this.fullDetail.has(c.id) ? AGENT_FULL_DETAIL_LEAVE : AGENT_FULL_DETAIL;
        if (keep || (c.d <= r && full < cap)) {
          if (!keep) full++;
          this.fullDetail.add(c.id);
          try {
            this.syncOne(c.id, c.a, alpha, step, gen, sys, state.objects, agents, c.frame);
          } catch (err) {
            this.warn.warn('agent-sync', `agent ${c.id} sync failed`, err);
          }
        } else {
          this.fullDetail.delete(c.id);
          if (c.frame) frameToScene(c.frame, c.a.pos.x, c.a.pos.z, this.frameTmp);
          else {
            this.frameTmp.x = c.a.pos.x;
            this.frameTmp.z = c.a.pos.z;
          }
          const top = c.a.appearance && typeof c.a.appearance.topColor === 'string' ? c.a.appearance.topColor : null;
          this.farAgents.push({ id: c.id, x: this.frameTmp.x, z: this.frameTmp.z, color: top });
        }
      }
    } else if (this.fullDetail.size) this.fullDetail.clear();
    for (const [id, e] of this.entries) if (e.seen !== gen) this.remove(id, e);
    if (this.pendingTalk.size > 64) this.pendingTalk.clear();
  }

  private syncOne(id: string, a: AgentState, alpha: number, dt: number, gen: number, sys: SysFn | null, objects: WorldState['objects'] | undefined, agents: WorldState['agents'], frame: RegionFrame | null = null): void {
    let e = this.entries.get(id);
    if (!e) {
      const failedAt = this.failed.get(id);
      if (failedAt !== undefined && this.clock - failedAt < FAIL_RETRY_SEC) return;
      e = this.create(id, a) ?? undefined;
      if (!e) {
        this.failed.set(id, this.clock);
        return;
      }
      this.failed.delete(id);
    }
    e.seen = gen;
    const rig = e.rig;
    // appearance / limbs (cheap reference check; deep check about once a second)
    if (a.appearance !== e.appearanceRef || ++e.checkTick % 60 === 0) {
      // the factory swaps in the skinned GLB rig asynchronously and outfits toggle meshes: re-apply the caster policy
      rig.root.traverse(cullAgentShadowCasters);
      e.appearanceRef = a.appearance;
      const key = safeKey(a.appearance);
      if (key !== e.appearanceKey) {
        e.appearanceKey = key;
        rig.setAppearance(a.appearance);
      }
    }
    const limbs = a.limbs;
    if (limbs && typeof limbs === 'object') {
      let changed = false;
      for (let i = 0; i < LIMB_IDS.length; i++) {
        const l = LIMB_IDS[i];
        const v = limbs[l] === 'missing' || limbs[l] === 'prosthetic' ? limbs[l] : 'ok';
        if (v !== e.limbs[l]) {
          e.limbs[l] = v;
          changed = true;
        }
      }
      if (changed) rig.setLimbs({ ...e.limbs });
    }
    // pose
    const pose = interpolateAgentPose(a.prevPos, a.pos, a.prevFacing, a.facing, a.posY, alpha, e.pose);
    // seated on a catalog seat: rest the body's back on the backrest and the seat contact on the cushion (seat.ts)
    const seatAnim = typeof a.anim === 'string' && ANIMS.has(a.anim) ? a.anim : 'idle';
    const so = seatedOffset(a, seatAnim, objects, SEAT_TMP);
    const k = e.anim === '' ? 1 : dampFactor(10, dt);
    e.seatFwd += (so.forward - e.seatFwd) * k;
    e.seatLift += (so.lift + lyingLift(a, seatAnim, objects) - e.seatLift) * k;
    // standing fits (reach.ts): social partners apart, working bodies out of the counter, nobody standing in a bed
    const st = standingOffset(a, seatAnim, pose.facing, objects, STAND_TMP);
    const sc = socialOffset(id, a, seatAnim, agents, SOCIAL_TMP);
    e.offX += (st.dx + sc.dx - e.offX) * k;
    e.offZ += (st.dz + sc.dz - e.offZ) * k;
    e.offY += ((st.dy ?? 0) - e.offY) * k;
    let facing = Number.isFinite(st.facing) ? st.facing : pose.facing;
    if (pose.valid) {
      let rx = pose.x + Math.sin(facing) * e.seatFwd + e.offX;
      let rz = pose.z + Math.cos(facing) * e.seatFwd + e.offZ;
      if (frame) {
        // W-025 S5: the agent stands in another region — everything above is lot-local to it; draw it in its place
        frameToScene(frame, rx, rz, this.frameTmp);
        rx = this.frameTmp.x;
        rz = this.frameTmp.z;
        frameToScene(frame, pose.x, pose.z, this.frameTmp);
        pose.x = this.frameTmp.x;
        pose.z = this.frameTmp.z;
        pose.facing += frame.yaw;
        facing += frame.yaw;
      }
      rig.root.position.set(rx, pose.y + e.seatLift + e.offY, rz);
      rig.root.rotation.set(0, facing, 0);
      rig.root.visible = true;
    } else rig.root.visible = false;
    // measured locomotion speed (tiles per real second, smoothed)
    if (dt > 0 && pose.valid) {
      const d = Math.hypot(pose.x - e.lastX, pose.z - e.lastZ);
      const inst = d > 2 ? 0 : d / dt;
      e.speed += (inst - e.speed) * dampFactor(10, dt);
      e.lastX = pose.x;
      e.lastZ = pose.z;
    }
    const anim = typeof a.anim === 'string' && ANIMS.has(a.anim) ? a.anim : 'idle';
    if (anim !== e.anim) {
      e.anim = anim;
      rig.setAnim(anim as AnyAnimState);
    }
    const ms = moveSpeedScale(anim, e.speed);
    if (Math.abs(ms - e.moveScale) > 0.02) {
      e.moveScale = ms;
      rig.setMoveSpeed(ms);
    }
    const expr = typeof a.expression === 'string' && EXPRS.has(a.expression) ? a.expression : 'neutral';
    if (expr !== e.expr) {
      e.expr = expr;
      rig.setExpression(expr as Expression);
    }
    const carry = typeof a.carrying === 'string' && CARRIES.has(a.carrying) ? a.carrying : null;
    if (carry !== e.carry) {
      e.carry = carry;
      rig.setCarry(carry as CarryItem | null);
    }
    const decay = decayLevel(sys, id, a);
    if (Math.abs(decay - e.decay) > 0.01) {
      e.decay = decay;
      rig.setDecay(decay);
    }
    const talking = this.clock < e.talkUntil;
    if (talking !== e.talking) {
      e.talking = talking;
      rig.setTalking(talking);
    }
    const hl = id === this.selectedId ? 'selected' : id === this.hoverId ? 'hover' : 'none';
    if (hl !== e.highlight) {
      e.highlight = hl;
      rig.setHighlight(hl);
    }
    rig.update(dt);
    try {
      rig.headTop(e.head);
      if (!Number.isFinite(e.head.x + e.head.y + e.head.z)) e.head.set(pose.x, pose.y + DIM.HEAD_TOP, pose.z);
    } catch {
      e.head.set(pose.x, pose.y + DIM.HEAD_TOP, pose.z);
    }
    this.syncFx(e, a, pose.valid);
  }

  private syncFx(e: AgentEntry, a: AgentState, visible: boolean): void {
    const hyg = typeof a.needs?.hygiene === 'number' ? a.needs.hygiene : 100;
    const reeking = visible && hyg < 15;
    e.flies = this.toggle(e.flies, reeking, 'flySwarm', e.head.x, e.head.y - 0.25, e.head.z);
    e.stench = this.toggle(e.stench, visible && hyg < 10, 'stenchWisps', e.pose.x, e.pose.y + 0.5, e.pose.z);
    const sleeping = visible && this.asleep(a, e.anim);
    e.zzz = this.toggle(e.zzz, sleeping, 'sleepZ', e.head.x, e.head.y, e.head.z);
    e.notes = this.toggle(e.notes, visible && e.anim === 'dance', 'musicNotes', e.pose.x, e.pose.y + 1.0, e.pose.z);
  }

  private toggle(h: EmitterHandle | null, on: boolean, type: Parameters<FxSystem['acquire']>[0], x: number, y: number, z: number): EmitterHandle | null {
    if (on) {
      const em = h ?? this.fx.acquire(type);
      em.active = true;
      em.x = x;
      em.y = y;
      em.z = z;
      return em;
    }
    if (h) this.fx.release(h);
    return null;
  }

  private create(id: string, a: AgentState): AgentEntry | null {
    let rig: ZombieRig;
    const limbs: LimbState = { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' };
    if (a.limbs && typeof a.limbs === 'object') for (const l of LIMB_IDS) if (a.limbs[l] === 'missing' || a.limbs[l] === 'prosthetic') limbs[l] = a.limbs[l];
    try {
      rig = this.characters.create(a.appearance, { ...limbs });
    } catch (err) {
      this.warn.warn('agent-create', `characters.create failed for ${id}`, err);
      return null;
    }
    if (!rig || !rig.root || !(rig.root as THREE.Object3D).isObject3D) {
      this.warn.warn('agent-create', `characters.create returned an invalid rig for ${id}`);
      return null;
    }
    rig.root.name = `agent:${id}`;
    rig.root.userData.agentId = id;
    applyShadowFlags(rig.root, false);
    rig.root.traverse(cullAgentShadowCasters);
    const x = Number.isFinite(a.pos?.x) ? a.pos.x : 0;
    const z = Number.isFinite(a.pos?.z) ? a.pos.z : 0;
    const e: AgentEntry = {
      id,
      rig,
      appearanceRef: a.appearance,
      appearanceKey: safeKey(a.appearance),
      limbs,
      anim: '',
      expr: '',
      carry: null,
      highlight: 'none',
      decay: -1,
      talkUntil: this.pendingTalk.get(id) ?? 0,
      talking: false,
      speed: 0,
      lastX: x,
      lastZ: z,
      moveScale: 1,
      pose: createAgentPose(),
      head: new THREE.Vector3(x, DIM.HEAD_TOP, z),
      flies: null,
      stench: null,
      zzz: null,
      notes: null,
      seen: 0,
      checkTick: 0,
      seatFwd: 0,
      seatLift: 0,
      offX: 0,
      offY: 0,
      offZ: 0,
      observedRenderRevision: rig.renderRevision ?? 0,
    };
    this.pendingTalk.delete(id);
    this.entries.set(id, e);
    this.renderRevision++;
    this.group.add(rig.root);
    return e;
  }

  private remove(id: string, e: AgentEntry): void {
    this.entries.delete(id);
    this.renderRevision++;
    this.group.remove(e.rig.root);
    for (const h of [e.flies, e.stench, e.zzz, e.notes]) if (h) this.fx.release(h);
    try {
      e.rig.dispose();
    } catch (err) {
      this.warn.warn('agent-dispose', `rig dispose failed for ${id}`, err);
    }
  }

  /**
   * Hide rigs whose culling sphere is outside the camera frustum (both passes skip them; animation keeps running in
   * sync()). Call after the camera has been updated for the frame. Allocation free.
   */
  cull(camera: THREE.Camera, light: { x: number; y: number; z: number } | null = null): number {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    let n = 0;
    const hidden = this.hiddenId ? this.entries.get(this.hiddenId) : undefined;
    for (const e of this.entries.values()) {
      if (!e.pose.valid) continue;
      if (e === hidden) {
        e.rig.root.visible = false;
        continue;
      }
      if (!this.cullEnabled) {
        e.rig.root.visible = true;
        continue;
      }
      agentCullSphere(e.pose.x, e.pose.y, e.pose.z, light, this.sphere);
      const inView = this.frustum.intersectsSphere(this.sphere);
      e.rig.root.visible = inView;
      if (!inView) n++;
    }
    this.culled = n;
    return n;
  }

  /** Ray vs agent capsules (feet → head; lying poses use a horizontal capsule). */
  pick(ray: THREE.Ray): AgentPick | null {
    let best: AgentPick | null = null;
    const o = ray.origin;
    const d = ray.direction;
    for (const e of this.entries.values()) {
      if (!e.pose.valid || !e.rig.root.visible) continue;
      const px = e.pose.x;
      const py = e.pose.y;
      const pz = e.pose.z;
      const hx = e.head.x;
      const hy = e.head.y;
      const hz = e.head.z;
      const vertical = hy - py > 0.8 * Math.hypot(hx - px, hz - pz);
      let t: number;
      if (vertical) t = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, px, py + 0.3, pz, hx, hy - 0.22, hz, 0.34);
      else {
        // lying/sitting low: capsule from the head through the body
        const bx = px - (hx - px) * 0.9;
        const bz = pz - (hz - pz) * 0.9;
        t = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, bx, py + 0.15, bz, hx, Math.max(hy - 0.1, py + 0.15), hz, 0.3);
      }
      if (t < Infinity && (!best || t < best.t)) best = { agentId: e.id, t, point: ray.at(t, new THREE.Vector3()) };
    }
    return best;
  }

  /** Iterate head anchors for bubbles. */
  forEachHead(fn: (id: string, head: THREE.Vector3) => void): void {
    for (const e of this.entries.values()) if (e.pose.valid) fn(e.id, e.head);
  }

  clear(): void {
    for (const [id, e] of this.entries) this.remove(id, e);
    this.failed.clear();
    this.pendingTalk.clear();
  }

  dispose(): void {
    this.clear();
  }
}

const SEAT_TMP: SeatOffset = { forward: 0, lift: 0 };

/** W-025 S5: other-region agents within this many tiles of the camera focus get a full rig (leave at the second). */
export const AGENT_FULL_DETAIL = 28;
export const AGENT_FULL_DETAIL_LEAVE = 34;
/** Full rigs while the world LOD is on (desktop; the phone profile uses AGENT_FULL_DETAIL_MAX_PHONE). */
export const AGENT_FULL_DETAIL_MAX = 12;
export const AGENT_FULL_DETAIL_MAX_PHONE = 7;
/** A rigged agent ranks this many tiles closer than a capsule one (LOD hysteresis). */
export const LOD_RANK_SLACK = 4;
const STAND_TMP: StandOffset = { dx: 0, dz: 0, dy: 0, facing: NaN };
const SOCIAL_TMP: StandOffset = { dx: 0, dz: 0, facing: NaN };

/** World root offset (m) and facing override (NaN = keep) of a standing fit. */
export interface StandOffset {
  dx: number;
  dz: number;
  /** Root height change (m): a standing clip on a raised rest slot stands on the approach tile's floor, not the lining. */
  dy?: number;
  facing: number;
}

const NOT_STANDING: ReadonlySet<string> = new Set(['walk', 'limp', 'crawl']);

function agentScale(app: unknown): { body: string | undefined; scale: number } {
  const ap = (app ?? {}) as { body?: unknown; height?: unknown };
  const body = typeof ap.body === 'string' && ap.body ? ap.body : undefined;
  return { body, scale: body ? castHeightScale(ap.height) : heightScale(ap.height) };
}

/**
 * Standing fit at an object (reach.ts), pure apart from writing `out`:
 *   - a standing clip on a posed rest slot (sit / lie / bath: e.g. repairing a bed) is shown on the slot's first
 *     approach tile facing the object;
 *   - a standing clip at a standing work slot moves back along the facing until the body clears the footprint edge
 *     below the object's work surface (workStandoff).
 */
export function standingOffset(a: Pick<AgentState, 'active' | 'appearance' | 'pos'>, anim: string, facing: number, objects: WorldState['objects'] | undefined, out: StandOffset): StandOffset {
  out.dx = 0;
  out.dz = 0;
  out.dy = 0;
  out.facing = NaN;
  if (OFF_FEET_ANIMS.has(anim as AnimState) || NOT_STANDING.has(anim)) return out;
  const act = a.active;
  const t = act && act.stageTarget;
  if (!act || !t || t.kind !== 'object' || typeof act.slot !== 'number' || !objects) return out;
  const o = Object.prototype.hasOwnProperty.call(objects, t.id) ? objects[t.id] : undefined;
  const pl = o && o.placement;
  if (!o || !pl || pl.kind !== 'floor') return out;
  const cs = catalogSlot(o.defId, act.slot);
  if (!cs) return out;
  const { body, scale } = agentScale(a.appearance);
  let f = Number.isFinite(facing) ? facing : 0;
  let face = workFaceDist(cs.spec, cs.slot);
  if (isPosedRestSlot(cs.slot)) {
    const ap = cs.slot.approach[0];
    const pos = a.pos;
    if (!ap || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return out;
    const frame = { w: cs.spec.footprint.w, d: cs.spec.footprint.d, ox: pl.x, oz: pl.z, rot: pl.rot };
    const p = faceObjectPose(frameLocalTile(frame, Math.floor(ap.x), Math.floor(ap.z)), frameCentre(frame));
    out.dx = p.x - pos.x;
    out.dz = p.z - pos.z;
    // the sim pose is raised to the lining / seat / tub (slot pose.y); a standing body steps off onto the floor
    // (W-111: classic standing at sarcophagus_cryo#lie floated 335 mm after the #31 relocation)
    const py = cs.slot.pose && Number.isFinite(cs.slot.pose.y) ? cs.slot.pose.y : 0;
    out.dy = -py;
    out.facing = p.facing;
    f = p.facing;
    face = WORK_FACE_DIST;
  }
  if (face === null) return out;
  const so = workStandoff(body, anim, scale, workTop(cs.spec), face);
  out.dx -= Math.sin(f) * so;
  out.dz -= Math.cos(f) * so;
  return out;
}

/**
 * Lying lift (reach.ts lieLift): a lying clip on a 'lie' slot with lie geometry rests the back on the modelled
 * mattress / lining instead of the sim's pose height. 0 otherwise.
 */
export function lyingLift(a: Pick<AgentState, 'active' | 'appearance'>, anim: string, objects: WorldState['objects'] | undefined): number {
  if (anim !== 'sleep' && anim !== 'beEmbalmed') return 0;
  const act = a.active;
  const t = act && act.stageTarget;
  if (!act || !t || t.kind !== 'object' || typeof act.slot !== 'number' || !objects) return 0;
  const o = Object.prototype.hasOwnProperty.call(objects, t.id) ? objects[t.id] : undefined;
  const cs = o ? catalogSlot(o.defId, act.slot) : null;
  if (!cs || cs.slot.kind !== 'lie' || !cs.slot.pose) return 0;
  const { body, scale } = agentScale(a.appearance);
  return lieLift(cs.slot.lie, cs.slot.pose.y, body, anim, scale);
}

/**
 * Social spacing (reach.ts), pure apart from writing `out`: two on-lot agents running a social / pair with each other
 * (mutual partnerId), both standing and not at an object, are moved apart (each by half the deficit) until their
 * front profiles no longer overlap.
 */
export function socialOffset(id: string, a: Pick<AgentState, 'active' | 'appearance' | 'pos'>, anim: string, agents: WorldState['agents'] | undefined, out: StandOffset): StandOffset {
  out.dx = 0;
  out.dz = 0;
  out.facing = NaN;
  const act = a.active;
  const pid = act && act.partnerId;
  if (!act || typeof pid !== 'string' || !agents || !Object.prototype.hasOwnProperty.call(agents, pid)) return out;
  if (act.stageTarget && act.stageTarget.kind === 'object') return out;
  const p = agents[pid];
  if (!p || p.presence !== 'onLot' || !p.active || p.active.partnerId !== id) return out;
  if (p.active.stageTarget && p.active.stageTarget.kind === 'object') return out;
  const pAnim = typeof p.anim === 'string' ? p.anim : 'idle';
  if (OFF_FEET_ANIMS.has(anim as AnimState) || OFF_FEET_ANIMS.has(pAnim as AnimState) || NOT_STANDING.has(anim) || NOT_STANDING.has(pAnim)) return out;
  const pa = a.pos;
  const pb = p.pos;
  if (!pa || !pb || !Number.isFinite(pa.x + pa.z + pb.x + pb.z)) return out;
  const me = agentScale(a.appearance);
  const them = agentScale(p.appearance);
  const dx = pa.x - pb.x;
  const dz = pa.z - pb.z;
  const dist = Math.hypot(dx, dz);
  if (!(dist > 1e-6)) return out;
  const push = socialPush(socialSpacing(me.body, anim, me.scale, them.body, pAnim, them.scale), dist);
  out.dx = (dx / dist) * push;
  out.dz = (dz / dist) * push;
  return out;
}

/**
 * Seated root offset for an agent playing `anim` (seat.ts): only for sit* clips while running an interaction on a
 * catalog 'sit' slot that declares its seat geometry; zero otherwise. Pure apart from writing `out`.
 */
export function seatedOffset(a: Pick<AgentState, 'active' | 'appearance'>, anim: string, objects: WorldState['objects'] | undefined, out: SeatOffset): SeatOffset {
  out.forward = 0;
  out.lift = 0;
  if (!isSeatedClip(anim)) return out;
  const act = a.active;
  const t = act && act.stageTarget;
  if (!act || !t || t.kind !== 'object' || typeof act.slot !== 'number' || !objects) return out;
  const o = Object.prototype.hasOwnProperty.call(objects, t.id) ? objects[t.id] : undefined;
  if (!o) return out;
  const seat = slotSeat(o.defId, act.slot);
  if (!seat) return out;
  const app = (a.appearance ?? {}) as { body?: unknown; height?: unknown };
  const body = typeof app.body === 'string' && app.body ? app.body : undefined;
  const scale = body ? castHeightScale(app.height) : heightScale(app.height);
  return seatOffset(seat, body, anim, scale, out);
}

/** Doorway radius (tiles): anyone this close keeps the door open. */
export const DOORWAY_RADIUS = 0.45;
/** Approach radius: zombies walking this close swing the door open ahead of them. */
export const DOOR_APPROACH_RADIUS = 1.0;
const LOCOMOTION = new Set(['walk', 'limp', 'crawl']);

/** Pure door-traffic rule for one zombie at offset (dx, dz) from the door centre. */
export function doorTrafficFor(dx: number, dz: number, anim: string): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
  const d2 = dx * dx + dz * dz;
  if (d2 <= DOORWAY_RADIUS * DOORWAY_RADIUS) return true;
  return d2 <= DOOR_APPROACH_RADIUS * DOOR_APPROACH_RADIUS && LOCOMOTION.has(anim);
}

function safeKey(app: unknown): string {
  try {
    return JSON.stringify(app) ?? '';
  } catch {
    return '';
  }
}

function resolveSys(sim: SimulationAPI | null): SysFn | null {
  if (!sim) return null;
  // preferred: the contract's optional SimulationAPI.decayLevel; legacy: a duck-typed sys('decay')
  const dl = (sim as unknown as { decayLevel?: unknown }).decayLevel;
  if (typeof dl === 'function') {
    const bound = (dl as (id: string) => number).bind(sim);
    const api = { decayLevel: bound };
    return (id: string) => (id === 'decay' ? api : undefined);
  }
  const s = (sim as unknown as { sys?: unknown }).sys;
  return typeof s === 'function' ? (s.bind(sim) as SysFn) : null;
}

/** Decay level: the decay system's view if available (duck-typed), else 1 − preservation/100. */
export function decayLevel(sys: SysFn | null, id: string, a: Pick<AgentState, 'needs'>): number {
  if (sys) {
    try {
      const api = sys('decay');
      const f = api && (api as { decayLevel?: unknown }).decayLevel;
      if (typeof f === 'function') {
        const v = (f as (id: string) => unknown)(id);
        if (typeof v === 'number' && Number.isFinite(v)) return Math.min(1, Math.max(0, v));
      }
    } catch {
      /* fall through */
    }
  }
  const p = a && a.needs && typeof a.needs.preservation === 'number' && Number.isFinite(a.needs.preservation) ? a.needs.preservation : 100;
  return Math.min(1, Math.max(0, 1 - p / 100));
}
