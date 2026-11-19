/**
 * W-151 held prop vs its own body: for a look with a sculpted held prop (heldProps.ts HELD_PROP_RULES) and one clip,
 * how deep the prop's vertices sit inside the rest of the body (everything but the prop and the arm that holds it).
 * CPU-skinned on the real runtime rig (stow + floor clamp applied), sampled over the whole clip.
 *
 * `chooseFit` picks, per played clip, the first place that keeps the prop out of the body (heldPropFit.ts).
 */
import { ANIM_STATES, EXTRA_ANIM_STATES, type AnimState } from '../../src/shared/appearance';
import type { BodyId, CastBodyId } from '../../src/shared/cast';
import type { AnyAnimState } from '../../src/shared/appearance';
import { HELD_PROP_RULES, type StowSpot } from '../../src/render/characters/heldProps';
import { HANDS_DOWN_PRONE_ANIMS, HANDS_DOWN_SUPINE_ANIMS } from '../../src/render/characters/plan';
import { filterTriangles } from './geometry';
import { makeSolid, penetration } from './detect';
import { playingDuration, poseRig, rigFor, sampleRig } from './rigs';

export const ALL_CLIPS: readonly AnimState[] = [...ANIM_STATES, ...EXTRA_ANIM_STATES] as AnimState[];
const ORIGIN = { x: 0, y: 0, z: 0, facing: 0 };

export interface PropSelf {
  /** Deepest prop vertex inside the body over the samples (mm). */
  mm: number;
  /** Body part it is deepest in, and the clip time (s). */
  part: string;
  t: number;
  /** Prop vertices sampled (0 = put away / no prop). */
  verts: number;
}

/** `side` = 'L' | 'R' of the holding hand. */
export async function propSelf(body: BodyId, anim: AnimState, side: 'L' | 'R', samples = 6, height = 0.5, withArm = false): Promise<PropSelf & { clip: string }> {
  const lr = await rigFor({ body, height });
  const isProp = (l: string): boolean => l === `heldProp_${side}`;
  const arm = new RegExp(`^(upperarm|upper_arm|arm|forearm|hand|prop|shoulder|clavicle)_${side}$`);
  const out: PropSelf & { clip: string } = { mm: 0, part: '-', t: 0, verts: 0, clip: anim };
  poseRig(lr, { anim }, ORIGIN, 0);
  const dur = playingDuration(lr);
  for (let i = 0; i < samples; i++) {
    const t = (dur * (i + 0.5)) / samples;
    poseRig(lr, { anim }, ORIGIN, t);
    const s = sampleRig(lr);
    out.clip = s.clip;
    // a prop in the hand touches the arm that holds it; a stowed one must clear that arm too (`withArm`)
    const rest = makeSolid(filterTriangles(s.body, (l) => !isProp(l) && (withArm || !arm.test(l))));
    if (rest.mesh.tri.length === 0) continue;
    const p = penetration(makeSolid(s.body, false), rest, { aFilter: isProp, oneWay: true });
    out.verts = Math.max(out.verts, p.aTested);
    if (p.maxDepthMm > out.mm) {
      out.mm = p.maxDepthMm;
      out.part = p.deepest?.bLabel ?? '-';
      out.t = t;
    }
  }
  return out;
}

/** Deepest the prop may sit in its own body (mm): the audit's penetration FAIL threshold. */
export const PROP_SELF_MAX_MM = 15;

export type Spot = 'hand' | StowSpot;
export interface FitRow {
  spot: Spot;
  /** Measured depth at the chosen spot (mm; 0 for 'away'). */
  mm: number;
  /** Depth in the hand (mm): what the clip looked like before. */
  handMm: number;
}

/**
 * The fit of every played clip for `body` (first HELD_PROP_RULES rule). Candidates in order:
 *   hands-down prone -> back, away · supine -> chest, away · seated (sit*) -> away (a chair, a table or a vehicle is
 *   around the body) · every other clip -> hand, back (worn props only), away - but the idle's spot first, so a prop
 *   that cannot hang in the idle hand is worn the same way in every standing clip instead of swapping at each one.
 * A candidate is accepted when the prop stays within PROP_SELF_MAX_MM of the body surface over the whole clip.
 * Measuring mutates the rule's live stow map; it is left holding the chosen table.
 */
export async function chooseFit(body: BodyId, samples = 6): Promise<Record<string, FitRow>> {
  const rule = HELD_PROP_RULES[body as CastBodyId]?.[0];
  if (!rule) return {};
  const side = rule.hand.slice(-1) as 'L' | 'R';
  const live = rule.stow as Map<AnyAnimState, StowSpot>;
  const out: Record<string, FitRow> = {};
  const measure = async (anim: AnimState, clip: string, spot: Spot): Promise<number> => {
    if (spot === 'away') return 0;
    if (spot === 'hand') live.delete(clip as AnyAnimState);
    else live.set(clip as AnyAnimState, spot);
    return (await propSelf(body, anim, side, samples, 0.5, spot !== 'hand')).mm;
  };
  const order: AnimState[] = ['idle' as AnimState, ...ALL_CLIPS.filter((a) => a !== 'idle')];
  for (const anim of order) {
    await new Promise<void>((r) => setImmediate(r)); // long CPU sweep: let the test worker answer its runner
    live.delete(anim as AnyAnimState);
    const first = await propSelf(body, anim, side, 1);
    const clip = first.clip;
    if (out[clip]) continue;
    live.delete(clip as AnyAnimState);
    const handMm = (await propSelf(body, anim, side, samples)).mm;
    let cands: Spot[];
    if (HANDS_DOWN_PRONE_ANIMS.has(clip as AnyAnimState)) cands = ['back', 'away'];
    else if (HANDS_DOWN_SUPINE_ANIMS.has(clip as AnyAnimState)) cands = ['chest', 'away'];
    else if (clip.startsWith('sit')) cands = ['away'];
    else {
      cands = rule.wear === false ? ['hand', 'away'] : ['hand', 'back', 'away'];
      const idle = out.idle?.spot;
      if (idle && idle !== 'hand') cands = [idle, ...cands.filter((c) => c !== idle)];
    }
    let row: FitRow = { spot: 'away', mm: 0, handMm };
    for (const spot of cands) {
      const mm = spot === 'hand' ? handMm : await measure(anim, clip, spot);
      if (mm <= PROP_SELF_MAX_MM) {
        row = { spot, mm, handMm };
        break;
      }
    }
    if (row.spot === 'hand') live.delete(clip as AnyAnimState);
    else live.set(clip as AnyAnimState, row.spot);
    out[clip] = row;
  }
  return out;
}
