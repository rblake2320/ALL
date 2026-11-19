/**
 * CLIP-AUDIT evaluation: one scenario x one look -> sampled checks -> aggregated verdicts.
 *
 * Checks (mm; thresholds in thresholds.ts):
 *   pen:object      body vs furniture (slot object + companions), both directions; worst body part
 *   pen:item        carried item vs body (hands / forearms / prop bones excluded) and vs furniture
 *   pen:partner     body vs body (social pairs)
 *   pen:floor       deepest body vertex below the floor (y < 0)
 *   pen:self        forearm / hand vs torso + head, shin / foot vs the other leg (retargeted clips on bulky bodies)
 *   pen:wall-back   standing at an object: deepest body point past the face of a wall on the standing tile's back edge
 *   pen:wall-side   ... past a wall on either side edge (worst case: the zombie works in a corner / alcove)
 *   float:seat      pelvis / thigh to the seat (sit* clips on sit slots)          FAIL > floatFailMm (worst time)
 *   float:back      spine / chest to the backrest (when the seat has one)         WARN > floatFailMm
 *   float:bed       pelvis / spine / chest to the bed (lie slots, lying clips)    FAIL > floatFailMm
 *   float:bath      pelvis to the tub                                             FAIL > floatFailMm
 *   float:feet      lowest foot to the floor or furniture (on-feet clips)         FAIL > floatFailMm at every time
 *   float:dangle    seated feet to the floor                                       WARN > floatFailMm
 *   gap:hand-item   holding hand to the carried item                              FAIL > handItemFailMm (worst time)
 *   gap:work        hands to the used object (work clips)                         WARN > workGapWarnMm at every time
 *   gap:partner     hands / chest to the partner (hug, kiss, slow dance)          WARN > workGapWarnMm at every time
 */
import * as THREE from 'three';
import type { Rot } from '../../src/shared/dimensions';
import { OFF_FEET_ANIMS, SEATED_ANIMS } from '../../src/render/characters/plan';
import { DIM } from '../../src/shared/dimensions';
import { lyingLift, seatedOffset, socialOffset, standingOffset } from '../../src/render/agents/agents';
import type { Frame } from '../../src/sim/spatial/geometry';
import type { BodyId } from '../../src/shared/cast';
import type { AnimState } from '../../src/shared/appearance';
import { contactGap, lowestY, makeSolid, penetration, round1, type Penetration, type Solid } from './detect';
import { TriBvh, filterTriangles, mergeMeshes } from './geometry';
import { placeFloorObject, slotPose, SPEC_BY_ID, type PlacedObject } from './objects';
import { playingDuration, poseRig, rigFor, sampleRig, type Look, type Pose, type RigSample } from './rigs';
import type { Act, PairScenario, Scenario, SlotScenario } from './scenarios';
import { THRESHOLDS, floatVerdict, penVerdict, worst, type Verdict } from './thresholds';

export interface Check {
  name: string;
  /** mm (penetration depth or gap). */
  value: number;
  verdict: Verdict;
  /** Worst body part / object part / note. */
  detail: string;
  /** Time (s) of the worst sample. */
  t: number;
  at?: [number, number, number];
}

export interface Evaluation {
  key: string;
  look: string;
  clip: string;
  verdict: Verdict;
  checks: Check[];
  times: number[];
}

/** Bone of a vertex label ('forearm_L', or 'Stump_ArmL@upperarm_L' -> 'upperarm_L'). */
export function boneOf(label: string): string {
  const i = label.lastIndexOf('@');
  return i >= 0 ? label.slice(i + 1) : label;
}

const re = (r: RegExp) => (l: string) => r.test(boneOf(l));
export const SEL = {
  seat: re(/^(pelvis|thigh_[LR])$/),
  back: re(/^(spine|chest)$/),
  bed: re(/^(pelvis|spine|chest)$/),
  pelvis: re(/^pelvis$/),
  feet: re(/^foot_[LR]$/),
  hands: re(/^(hand|prop)_[LR]$/),
  holding: re(/^(hand|prop|forearm)_[LR]$/),
  torsoHead: re(/^(pelvis|spine|chest|neck|head|jaw)$/),
  armL: re(/^(forearm|hand|prop)_L$/),
  armR: re(/^(forearm|hand|prop)_R$/),
  legL: re(/^(shin|foot)_L$/),
  legR: re(/^(shin|foot)_R$/),
  thighL: re(/^thigh_L$/),
  thighR: re(/^thigh_R$/),
  hugParts: re(/^(hand|forearm|chest|head)_?[LR]?$/),
  any: () => true,
};

/** Clips whose hands work on the slot object. */
export const WORK_ANIMS: ReadonlySet<string> = new Set(['cook', 'clean', 'washHands', 'stitch', 'embalm', 'paint', 'pickup', 'sitComputer', 'sitChess']);
/** Socials where bodies should touch. */
export const TOUCH_ANIMS: ReadonlySet<string> = new Set(['hug', 'kiss', 'dance']);
const LYING_ANIMS: ReadonlySet<string> = new Set(['sleep', 'beEmbalmed', 'collapse']);

export function lookName(l: Look): string {
  const extra = l.limbs && Object.values(l.limbs).some((v) => v && v !== 'ok') ? `,${Object.entries(l.limbs).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}=${v}`).join(',')}` : '';
  return `${l.body}@h${l.height}${l.detail === 'low' ? ',low' : ''}${extra}`;
}

/** Sample times (s) for a clip of `duration`. */
export function sampleTimes(duration: number, n: number): number[] {
  if (n <= 1) return [duration * 0.5];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(+(duration * (0.08 + (0.84 * i) / (n - 1))).toFixed(4));
  return out;
}

// ───────────────────────────── object setups (cached) ─────────────────────────────

export const ORIGIN = { x: 10, z: 10 };
const setupCache = new Map<string, Promise<{ main: PlacedObject; all: PlacedObject[]; solid: Solid; backrest: boolean | null }>>();

export async function setupFor(s: SlotScenario, rot: Rot) {
  const k = `${s.objectId}|${rot}|${s.companions.map((c) => `${c.objectId}@${c.ox},${c.oz}`).join('+')}`;
  let p = setupCache.get(k);
  if (!p) {
    p = (async () => {
      const main = await placeFloorObject(s.objectId, ORIGIN.x, ORIGIN.z, rot);
      const all = [main];
      for (const c of s.companions) {
        // companion tile offsets are in the main object's local (rot 0) frame
        const spec = SPEC_BY_ID.get(c.objectId)!;
        const mw = main.spec.footprint.w;
        const md = main.spec.footprint.d;
        // rotate the companion's local min-corner rectangle with the main frame
        const corners = [
          [c.ox, c.oz], [c.ox + spec.footprint.w, c.oz + spec.footprint.d],
        ].map(([lx, lz]) => rotLocal(mw, md, rot, lx, lz));
        const ox = Math.round(Math.min(corners[0][0], corners[1][0]));
        const oz = Math.round(Math.min(corners[0][1], corners[1][1]));
        all.push(await placeFloorObject(c.objectId, ORIGIN.x + ox, ORIGIN.z + oz, rot, false));
      }
      // union for the inside test; visible surfaces composed per object (furniture pieces do not bury each other)
      const solid: Solid = all.length === 1 ? main.solid : {
        ...makeSolid(mergeMeshes(all.map((o) => o.solid.mesh)), { orient: false }),
        surf: new TriBvh(mergeMeshes(all.map((o) => o.solid.surf.mesh))),
      };
      return { main, all, solid, backrest: null };
    })();
    setupCache.set(k, p);
  }
  return p;
}

/** localToWorld offsets (relative to the frame origin) for the main frame's rotation. */
function rotLocal(w: number, d: number, r: Rot, px: number, pz: number): [number, number] {
  switch (r) {
    case 0: return [px, pz];
    case 1: return [d - pz, px];
    case 2: return [w - px, d - pz];
    case 3: return [pz, w - px];
  }
}

/** Renderer fits on/off (CLIP_AUDIT_FITS=0 measures the raw sim poses: the audit's "before" numbers). */
export const RENDER_FITS = process.env.CLIP_AUDIT_FITS !== '0';

/**
 * Rig root pose for a slot scenario exactly as the renderer computes it: the sim's slot pose plus the AgentManager's
 * seated root offset (src/render/agents/agents.ts seatedOffset: slide onto the backrest + lift onto the modelled
 * cushion for sit* clips on 'sit' slots that declare seat geometry), lying lift (lyingLift: back on the modelled
 * mattress) and standing fit (standingOffset: work stand-off, rest-slot approach). Classic zombies carry no `body` in
 * saves.
 */
export function rootPoseFor(sc: SlotScenario, look: Look, slotRoot: Pose, frame?: Frame): Pose {
  const placement = frame ? { kind: 'floor', x: frame.ox, z: frame.oz, rot: frame.rot } : undefined;
  const objects = { audit: { defId: sc.objectId, placement } } as unknown as Parameters<typeof seatedOffset>[2];
  const agent = {
    active: { stageTarget: { kind: 'object', id: 'audit' }, slot: sc.slotIndex },
    appearance: { body: look.body === 'classic' ? undefined : look.body, height: look.height },
    pos: { x: slotRoot.x, z: slotRoot.z },
  } as unknown as Parameters<typeof seatedOffset>[0] & Parameters<typeof standingOffset>[0];
  if (!RENDER_FITS) return { ...slotRoot };
  const so = seatedOffset(agent, sc.act.anim, objects, { forward: 0, lift: 0 });
  const st = standingOffset(agent, sc.act.anim, slotRoot.facing, objects, { dx: 0, dz: 0, dy: 0, facing: NaN });
  const facing = Number.isFinite(st.facing) ? st.facing : slotRoot.facing;
  return {
    x: slotRoot.x + Math.sin(facing) * so.forward + st.dx,
    y: slotRoot.y + so.lift + lyingLift(agent, sc.act.anim, objects) + (st.dy ?? 0),
    z: slotRoot.z + Math.cos(facing) * so.forward + st.dz,
    facing,
  };
}

/**
 * Social pair root poses as the renderer shows them: the sim stands them `spacing` apart facing each other (A at the
 * origin facing +z, B ahead facing -z); socialOffset moves each apart.
 */
export function pairPoses(sc: PairScenario, la: Look, lb: Look): { a: Pose; b: Pose; spacing: number } {
  const pa: Pose = { x: ORIGIN.x, y: 0, z: ORIGIN.z, facing: 0 };
  const pb: Pose = { x: ORIGIN.x, y: 0, z: ORIGIN.z + sc.spacing, facing: Math.PI };
  if (!RENDER_FITS) return { a: pa, b: pb, spacing: sc.spacing };
  const ag = (body: BodyId, height: number, x: number, z: number, anim: string, partner: string) => ({
    presence: 'onLot', anim, pos: { x, z },
    appearance: { body: body === 'classic' ? undefined : body, height },
    active: { partnerId: partner, stageTarget: { kind: 'agent', id: partner } },
  });
  const agents = {
    A: ag(la.body, la.height, pa.x, pa.z, sc.a.anim, 'B'),
    B: ag(lb.body, lb.height, pb.x, pb.z, sc.b.anim, 'A'),
  } as unknown as NonNullable<Parameters<typeof socialOffset>[3]>;
  const oa = socialOffset('A', agents.A, sc.a.anim, agents, { dx: 0, dz: 0, facing: NaN });
  const ob = socialOffset('B', agents.B, sc.b.anim, agents, { dx: 0, dz: 0, facing: NaN });
  const a = { ...pa, x: pa.x + oa.dx, z: pa.z + oa.dz };
  const b = { ...pb, x: pb.x + ob.dx, z: pb.z + ob.dz };
  return { a, b, spacing: Math.hypot(b.x - a.x, b.z - a.z) };
}

// ───────────────────────────── evaluation ─────────────────────────────

interface Ctx {
  checks: Check[];
}

function push(c: Ctx, name: string, value: number, verdict: Verdict, detail: string, t: number, at?: [number, number, number]): void {
  c.checks.push({ name, value: round1(value), verdict, detail, t, at });
}

function penCheck(c: Ctx, name: string, p: Penetration, t: number): void {
  const d = p.maxDepthMm;
  const part = p.worstPart ? `${p.worstPart}${p.deepest ? ` (deepest ${p.deepest.aLabel} in ${p.deepest.bLabel})` : ''}` : '-';
  push(c, name, d, penVerdict(d), `${part}; ${p.pctInside}% verts inside`, t, p.deepest?.at);
}

/** Aggregate per check name: max for penetration / FAIL-at-worst gaps, min for "at some time" gaps. */
export function aggregate(checks: Check[]): Check[] {
  const MIN_OVER_TIME = new Set(['float:feet', 'gap:work', 'gap:partner']);
  const by = new Map<string, Check>();
  for (const ch of checks) {
    const prev = by.get(ch.name);
    if (!prev) {
      by.set(ch.name, { ...ch });
      continue;
    }
    const better = MIN_OVER_TIME.has(ch.name) ? ch.value < prev.value : ch.value > prev.value;
    if (better) by.set(ch.name, { ...ch });
  }
  // "at every time" checks: re-evaluate the verdict on the aggregated (min) value
  for (const ch of by.values()) {
    if (ch.name === 'float:feet') ch.verdict = floatVerdict(ch.value);
    if (ch.name === 'gap:work' || ch.name === 'gap:partner') ch.verdict = ch.value > THRESHOLDS.workGapWarnMm ? 'WARN' : 'PASS';
  }
  return [...by.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

function itemChecks(c: Ctx, body: Solid, s: RigSample, t: number, others: Solid[]): void {
  if (!s.item) return;
  const item = makeSolid(s.item);
  // hand to item: the item is parented to the hand's prop bone, so a gap means it hovers off the palm
  const g = contactGap(body, item, SEL.holding, 0.5);
  push(c, 'gap:hand-item', g.gapMm, g.gapMm > THRESHOLDS.handItemFailMm ? 'FAIL' : 'PASS', `${g.label ?? '-'}`, t, g.at ?? undefined);
  const p = penetration(body, item, { aFilter: (l) => !SEL.holding(l) });
  penCheck(c, 'pen:item-body', p, t);
  for (const o of others) {
    const q = penetration(item, o);
    if (q.maxDepthMm > 0) penCheck(c, 'pen:item-object', q, t);
  }
}

/** Requested props cannot disappear and leave only unrelated floor/self checks. Explicit arm-loss looks may
 * intentionally omit a hand's anchored item. Pickup's authored reveal window (Opus2 PR98) can hide an ATTACHED
 * newly acquired item before 0.45 s; absence of the actual attachment is always an error for intact gate looks.
 */
function carryCoverage(c: Ctx, act: Act, look: Look, s: RigSample, t: number, participant: string): void {
  if (!act.carry || look.limbs?.armL === 'missing' || look.limbs?.armR === 'missing') return;
  const revealWindow = act.anim === 'pickup' && t < 0.45;
  if (!s.carryAttached || (!s.item && !revealWindow)) {
    push(c, `error:missing-carry:${participant}`, 1, 'FAIL', `${act.anim}+${act.carry}: ${s.carryAttached ? 'attached but invisible' : 'not attached'}`, t);
  }
}

function floorChecks(c: Ctx, body: Solid, anim: AnimState, t: number, supports: Solid | null, seated: boolean): void {
  const low = lowestY(body, SEL.any);
  const below = -low.y * 1000;
  push(c, 'pen:floor', Math.max(0, below), penVerdict(below), low.label ?? '-', t);
  if (!OFF_FEET_ANIMS.has(anim)) {
    const f = lowestY(body, SEL.feet);
    let gap = f.y * 1000;
    if (supports) {
      const g = contactGap(body, supports, SEL.feet, 0.5);
      gap = Math.min(gap, g.gapMm);
    }
    push(c, 'float:feet', Math.max(gap, 0), floatVerdict(gap), f.label ?? '-', t);
  } else if (seated) {
    const f = lowestY(body, SEL.feet);
    const gap = f.y * 1000;
    push(c, 'float:dangle', Math.max(0, gap), gap > THRESHOLDS.floatFailMm ? 'WARN' : 'PASS', f.label ?? '-', t);
  }
}

/** Arms through the torso / head, legs through each other. */
export function selfChecks(c: Ctx, body: Solid, t: number): void {
  const torso = makeSolid(filterTriangles(body.mesh, SEL.torsoHead));
  if (torso.mesh.tri.length === 0) return;
  // one-way: only the forearm / hand vertices of `body` are tested against the torso + head shell
  const p = penetration(body, torso, { aFilter: (l) => SEL.armL(l) || SEL.armR(l), oneWay: true });
  penCheck(c, 'pen:self-arm', p, t);
  const legL = makeSolid(filterTriangles(body.mesh, SEL.legL));
  if (legL.mesh.tri.length) {
    const q = penetration(body, legL, { aFilter: SEL.legR, oneWay: true });
    penCheck(c, 'pen:self-leg', q, t);
  }
}

export interface EvalOptions {
  times: number;
  rot: Rot;
  /** Skip the object-in-body sampling direction (faster sweep). */
  oneWay?: boolean;
  spacing?: number;
  self?: boolean;
}

function clipDuration(lr: Awaited<ReturnType<typeof rigFor>>, anim: AnimState): number {
  // duration of the clip the rig actually plays (mirrored / substituted variants share it)
  void anim;
  return playingDuration(lr);
}

/** Yield to the event loop between samples (keeps a vitest worker's RPC heartbeat alive on a loaded machine). */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function evaluate(sc: Scenario, look: Look, opt: EvalOptions, lookB?: Look): Promise<Evaluation> {
  const c: Ctx = { checks: [] };
  let clip = '';
  let times: number[] = [];
  if (sc.kind === 'slot') {
    const setup = await setupFor(sc, opt.rot);
    const pose = rootPoseFor(sc, look, slotPose(setup.main.spec, setup.main.frame, sc.slotIndex, sc.approach), setup.main.frame);
    const lr = await rigFor(look);
    poseRig(lr, sc.act, pose, 0);
    times = sampleTimes(clipDuration(lr, sc.act.anim), opt.times);
    for (const t of times) {
      await tick();
      poseRig(lr, sc.act, pose, t);
      const s = sampleRig(lr);
      clip = s.clip;
      carryCoverage(c, sc.act, look, s, t, 'A');
      slotSample(c, sc, setup, pose, s, t, opt);
    }
  } else if (sc.kind === 'pair') {
    const lb = lookB ?? look;
    const ra = await rigFor(look, 'A');
    const rb = await rigFor(lb, 'B');
    const { a: pa, b: pb } = pairPoses(sc, look, lb);
    poseRig(ra, sc.a, pa, 0);
    times = sampleTimes(clipDuration(ra, sc.a.anim), opt.times);
    for (const t of times) {
      await tick();
      poseRig(ra, sc.a, pa, t);
      poseRig(rb, sc.b, pb, t);
      const sa = sampleRig(ra);
      const sb = sampleRig(rb);
      clip = `${sa.clip}~${sb.clip}`;
      carryCoverage(c, sc.a, look, sa, t, 'A');
      carryCoverage(c, sc.b, lb, sb, t, 'B');
      pairSample(c, sc, sa, sb, t, opt);
    }
  } else {
    const lr = await rigFor(look);
    const pose: Pose = { x: ORIGIN.x, y: 0, z: ORIGIN.z, facing: 0 };
    poseRig(lr, sc.act, pose, 0);
    times = sampleTimes(clipDuration(lr, sc.act.anim), opt.times);
    for (const t of times) {
      await tick();
      poseRig(lr, sc.act, pose, t);
      const s = sampleRig(lr);
      clip = s.clip;
      carryCoverage(c, sc.act, look, s, t, 'A');
      const body = makeSolid(s.body);
      floorChecks(c, body, sc.act.anim, t, null, false);
      itemChecks(c, body, s, t, []);
      if (opt.self !== false) selfChecks(c, body, t);
    }
  }
  const checks = aggregate(c.checks);
  return { key: sc.key, look: lookB ? `${lookName(look)}+${lookName(lookB)}` : lookName(look), clip, verdict: worst(...checks.map((x) => x.verdict)), checks, times };
}

function slotSample(c: Ctx, sc: SlotScenario, setup: Awaited<ReturnType<typeof setupFor>>, pose: Pose, s: RigSample, t: number, opt: EvalOptions): void {
  const body = makeSolid(s.body);
  const anim = sc.act.anim;
  const slot = setup.main.spec.slots[sc.slotIndex];
  const p = penetration(body, setup.solid, { oneWay: opt.oneWay, spacing: opt.spacing });
  penCheck(c, 'pen:object', p, t);
  const seated = slot.kind === 'sit' && SEATED_ANIMS.has(anim);
  if (seated) {
    const g = contactGap(body, setup.main.solid, SEL.seat, 0.6);
    push(c, 'float:seat', g.gapMm, floatVerdict(g.gapMm), g.label ?? '-', t, g.at ?? undefined);
    if (hasBackrest(setup.main.solid, pose)) {
      const b = contactGap(body, setup.main.solid, SEL.back, 0.6);
      push(c, 'float:back', b.gapMm, b.gapMm > THRESHOLDS.floatFailMm ? 'WARN' : 'PASS', b.label ?? '-', t, b.at ?? undefined);
    }
  }
  if (slot.kind === 'lie' && LYING_ANIMS.has(anim)) {
    const g = contactGap(body, setup.main.solid, SEL.bed, 0.6);
    push(c, 'float:bed', g.gapMm, floatVerdict(g.gapMm), g.label ?? '-', t, g.at ?? undefined);
  }
  if (slot.kind === 'bath' && anim === 'bath') {
    const g = contactGap(body, setup.main.solid, SEL.pelvis, 0.6);
    push(c, 'float:bath', g.gapMm, floatVerdict(g.gapMm), g.label ?? '-', t, g.at ?? undefined);
  }
  floorChecks(c, body, anim, t, setup.solid, seated);
  if (!OFF_FEET_ANIMS.has(anim)) wallChecks(c, body, pose, t);
  if (WORK_ANIMS.has(anim)) {
    const g = contactGap(body, setup.main.solid, SEL.hands, 3);
    push(c, 'gap:work', g.gapMm, g.gapMm > THRESHOLDS.workGapWarnMm ? 'WARN' : 'PASS', g.label ?? '-', t, g.at ?? undefined);
  }
  itemChecks(c, body, s, t, [setup.solid]);
}

/** Wall face inset from a tile edge (walls are centred on the grid lines). */
const HALF_WALL = DIM.WALL_THICKNESS / 2;

/**
 * A standing zombie's body vs walls on the edges of the tile its root stands in (back: the edge behind it; sides: half a
 * tile either side of the root; the edge it faces is the object). Depth = how far a vertex lies past the wall face (the
 * wall body starts HALF_WALL inside the edge). Worst-case geometry: a zombie working in a 1-tile alcove / corridor.
 */
export function wallChecks(c: Ctx, body: Solid, pose: Pose, t: number): void {
  const tx = Math.floor(pose.x);
  const tz = Math.floor(pose.z);
  const fx = Math.sin(pose.facing);
  const fz = Math.cos(pose.facing);
  const axisX = Math.abs(fx) > Math.abs(fz);
  // side faces: the two edges parallel to the facing; back face: the edge behind
  const back = axisX ? (fx > 0 ? { ax: 0, face: tx + HALF_WALL, sign: -1 } : { ax: 0, face: tx + 1 - HALF_WALL, sign: 1 })
    : (fz > 0 ? { ax: 2, face: tz + HALF_WALL, sign: -1 } : { ax: 2, face: tz + 1 - HALF_WALL, sign: 1 });
  // side walls: half a tile either side of the root (a root on a grid line — the centred stand slot of a 2-wide
  // object — stands between two approach tiles; a wall cannot run between them)
  const sideAx = axisX ? 2 : 0;
  const lat = axisX ? pose.z : pose.x;
  const sideLo = lat - 0.5 + HALF_WALL;
  const sideHi = lat + 0.5 - HALF_WALL;
  const m = body.mesh;
  let bd = 0;
  let bl = '-';
  let sd = 0;
  let sl = '-';
  for (let i = 0; i < m.pos.length / 3; i++) {
    if (m.pos[i * 3 + 1] > DIM.WALL_HEIGHT) continue;
    const v = m.pos[i * 3 + back.ax];
    const d = back.sign > 0 ? v - back.face : back.face - v;
    if (d > bd) {
      bd = d;
      bl = m.labels[m.vLabel[i]];
    }
    const s = m.pos[i * 3 + sideAx];
    const e = Math.max(sideLo - s, s - sideHi);
    if (e > sd) {
      sd = e;
      sl = m.labels[m.vLabel[i]];
    }
  }
  push(c, 'pen:wall-back', bd * 1000, penVerdict(bd * 1000), bl, t);
  push(c, 'pen:wall-side', sd * 1000, penVerdict(sd * 1000), sl, t);
}

const backCache = new WeakMap<Solid, Map<string, boolean>>();
/** Does the seat have a backrest behind the slot (ray from 0.25 m above the seat surface backwards, 0.45 m)? */
function hasBackrest(seat: Solid, pose: Pose): boolean {
  let m = backCache.get(seat);
  if (!m) backCache.set(seat, (m = new Map()));
  const k = `${pose.x.toFixed(3)},${pose.z.toFixed(3)},${pose.facing.toFixed(3)}`;
  let v = m.get(k);
  if (v === undefined) {
    const dx = -Math.sin(pose.facing);
    const dz = -Math.cos(pose.facing);
    const y = 0.46 + 0.25;
    v = seat.bvh.raycast(pose.x - dx * 0.1, y, pose.z - dz * 0.1, dx, 0, dz, 0.55) < Infinity;
    m.set(k, v);
  }
  return v;
}

function pairSample(c: Ctx, sc: PairScenario, sa: RigSample, sb: RigSample, t: number, opt: EvalOptions): void {
  const A = makeSolid(sa.body);
  const B = makeSolid(sb.body);
  // bodies are dense closed skins: vertex tests in both directions (no surface resampling needed)
  const ab = penetration(A, B, { oneWay: true });
  const ba = penetration(B, A, { oneWay: true });
  penCheck(c, 'pen:partner', ab.maxDepthMm >= ba.maxDepthMm ? ab : ba, t);
  if (TOUCH_ANIMS.has(sc.a.anim) && TOUCH_ANIMS.has(sc.b.anim)) {
    const g = contactGap(A, B, SEL.hugParts, 1.5);
    push(c, 'gap:partner', g.gapMm, g.gapMm > THRESHOLDS.workGapWarnMm ? 'WARN' : 'PASS', g.label ?? '-', t, g.at ?? undefined);
  }
  floorChecks(c, A, sc.a.anim, t, null, false);
  itemChecks(c, A, sa, t, [B]);
  itemChecks(c, B, sb, t, [A]);
}
