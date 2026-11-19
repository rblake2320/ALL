/**
 * W-120 (request F) crawl floor contact, adversarial, on the REAL runtime + shipped GLBs (docs/research/crawl-diagnostic.md):
 *  - every look x appearance.height 0 / 0.5 / 1 x the whole crawl cycle at 120 Hz (+ the end epsilon and t = 2,
 *    which now wraps to 0.4 s like the renderer), through both crawl paths: legless 'walk' (resolved to crawl) and
 *    a direct legless 'crawl' - both must sample identically;
 *  - the lowest visible mesh vertex stays >= -5 mm; the Lid Guard's lid (re-skinned to heldProp_L) and every stump
 *    cap stay above the floor; the hand bones stay exactly where they were before W-120 except for the documented
 *    floor-contact lift (plan.ts FLOOR_CONTACT_LIFT: millimetres - no float);
 *  - the lid never goes below the floor in ANY clip (prone / supine stow + floor clamp), also mid-crossfade and with
 *    intact legs, and it stays in the hand outside the stow clips.
 * The classic + shield sweep (request F's looks) always runs with the assets; the 26-look sweep is part of
 * `npm run clip:gate` (CLIP_GATE_FULL=1).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ANIM_STATES, EXTRA_ANIM_STATES } from '../../../src/shared/appearance';
import type { AnimState, LimbState } from '../../../src/shared/appearance';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import type { CastKitBodyId } from '../../../src/shared/cast';
/** This suite sweeps the classic body and the 25-body cast kit (the premium bodies are not in the clip gate yet). */
type BodyId = 'classic' | CastKitBodyId;
import { castHeightScale, floorContactLift, heightScale } from '../../../src/render/characters/plan';
import { HELD_PROP_RULES } from '../../../src/render/characters/heldProps';
import { HELD_PROP_FIT } from '../../../src/render/characters/heldPropFit';
import { internals, poseRig, rigFor, sampleRig } from '../../../tools/clip-audit/rigs';
import type { LiveRig } from '../../../tools/clip-audit/rigs';
import { fullGate, published } from './gate';

const HEIGHTS = [0, 0.5, 1] as const;
const LEGLESS: Partial<LimbState> = { legL: 'missing', legR: 'missing' };
/** Lowest visible vertex allowed (mm). */
const FLOOR_TOL_MM = -5;
const ORIGIN = { x: 0, y: 0, z: 0, facing: 0 };

/**
 * Hand-bone minima (mm, both hands, whole legless crawl cycle) at h0 / h0.5 / h1 measured on c7df1b4 BEFORE W-120
 * (Astra's PR #51 table for classic / shield). After W-120 they may move only by the look's floor-contact lift.
 */
const HANDS_BEFORE_MM: Record<BodyId, [number, number, number]> = {
  classic: [35.0, 39.0, 43.0], walker: [111.3, 118.4, 125.5], cone: [118.8, 126.3, 133.9], hardhat: [125.9, 133.9, 141.9],
  runner: [84.9, 90.3, 95.7], thief: [73.0, 77.7, 82.3], gold: [186.8, 198.7, 210.6], bride: [289.9, 308.4, 327.0],
  nurse: [221.9, 236.1, 250.3], granny: [122.6, 130.5, 138.3], screamer: [116.1, 123.5, 130.9], clown: [153.0, 162.8, 172.6],
  shield: [83.8, 89.1, 94.5], sneezer: [136.8, 145.5, 154.2], boss: [389.5, 414.4, 439.2], strongman: [266.9, 283.9, 300.9],
  ringmaster: [188.6, 200.7, 212.7], fortune: [133.9, 142.5, 151.0], mascot: [281.0, 299.0, 316.9], civilian: [113.3, 120.5, 127.7],
  business: [143.3, 152.4, 161.6], gamer: [151.4, 161.0, 170.7], jogger: [125.8, 133.8, 141.9], pizza: [125.0, 133.0, 140.9],
  streamer: [132.6, 141.1, 149.5], tourist: [144.0, 153.2, 162.4],
};

/**
 * Looks whose crawl still reaches below the floor for causes W-120 cannot fix at runtime (sculpt / GLB work, reported
 * in docs/audits/clipping-W073.md §W-120). Only vertices whose dominant bone matches `labels` are exempt from the
 * -5 mm floor: everything else on these bodies (stumps, other limbs, the trunk) is held to it like every other look.
 */
const ASSET_RESIDUAL: Partial<Record<BodyId, { labels: RegExp; reason: string }>> = {
  bride: { labels: /^(pelvis|thigh_[LR])$/, reason: 'long dress skinned rigid to pelvis / thighs' },
  granny: { labels: /^(pelvis|thigh_[LR])$/, reason: 'long skirt skinned rigid to pelvis / thighs' },
  fortune: { labels: /^(pelvis|thigh_[LR])$/, reason: 'long robe skinned rigid to pelvis / thighs' },
  boss: { labels: /^hand_L$/, reason: 'held prop welded into the hand surface (no separable island)' },
  ringmaster: { labels: /^(hand_L|spine|pelvis)$/, reason: 'held prop welded into the hand surface (no separable island); tailcoat tails skinned rigid to spine / pelvis hang ~0.3 m below the pelvis bone' },
  gamer: { labels: /^hand_L$/, reason: 'held prop welded into the hand surface (no separable island)' },
  tourist: { labels: /^hand_R$/, reason: 'held prop welded into the hand surface (no separable island)' },
};

interface CycleStats {
  clip: string;
  duration: number;
  /** Lowest visible vertex (m), its label and time. */
  minY: number;
  minLabel: string;
  minT: number;
  /** Lowest non-exempt vertex (m). */
  gatedMinY: number;
  gatedLabel: string;
  /** Lowest held-prop / stump-cap vertex (m; Infinity when the look has none). */
  propMinY: number;
  stumpMinY: number;
  /** Lowest hand bone origin (m). */
  handMinY: number;
  /** Per-sample signature (for path equality). */
  trace: number[];
}

function cycleTimes(duration: number): number[] {
  const ts: number[] = [];
  for (let i = 0; i / 120 < duration - 1e-4; i++) ts.push(i / 120);
  ts.push(duration - 1e-4, 2);
  return ts;
}

function settledClip(lr: LiveRig): THREE.AnimationAction {
  const name = lr.rig.stats().clip.split(' ')[0];
  const a = internals(lr.rig).actions.get(name);
  if (!a) throw new Error(`no action for ${name}`);
  return a;
}

/** Yield to the event loop (keeps the vitest worker's RPC heartbeat alive during long sweeps). */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

async function sweep(lr: LiveRig, anim: AnimState, exempt: RegExp | null, times?: number[]): Promise<CycleStats> {
  poseRig(lr, { anim }, ORIGIN, 0);
  const action = settledClip(lr);
  const duration = action.getClip().duration;
  const st: CycleStats = {
    clip: action.getClip().name, duration, minY: Infinity, minLabel: '', minT: 0, gatedMinY: Infinity, gatedLabel: '',
    propMinY: Infinity, stumpMinY: Infinity, handMinY: Infinity, trace: [],
  };
  let n = 0;
  for (const t of times ?? cycleTimes(duration)) {
    if (n++ % 8 === 0) await tick();
    poseRig(lr, { anim }, ORIGIN, t);
    const s = sampleRig(lr);
    const m = s.body;
    let sampleMin = Infinity;
    for (let i = 0; i < m.pos.length / 3; i++) {
      const y = m.pos[i * 3 + 1];
      const label = m.labels[m.vLabel[i]];
      if (y < st.minY) {
        st.minY = y;
        st.minLabel = label;
        st.minT = t;
      }
      if (y < sampleMin) sampleMin = y;
      if (!(exempt && exempt.test(label)) && y < st.gatedMinY) {
        st.gatedMinY = y;
        st.gatedLabel = label;
      }
      if (label.startsWith('heldProp_')) st.propMinY = Math.min(st.propMinY, y);
      if (label.startsWith('Stump_Leg')) st.stumpMinY = Math.min(st.stumpMinY, y);
    }
    const hand = Math.min(s.bones.hand_L?.[1] ?? Infinity, s.bones.hand_R?.[1] ?? Infinity);
    st.handMinY = Math.min(st.handMinY, hand);
    st.trace.push(sampleMin, hand, s.bones.pelvis?.[1] ?? NaN);
  }
  return st;
}

const mm = (m: number) => Math.round(m * 10000) / 10;
const scaleOf = (body: BodyId, h: number) => (body === 'classic' ? heightScale(h) : castHeightScale(h));

/** Full adversarial check of one look at one height (both legless crawl paths); violations go to `fails`. */
async function checkLook(body: BodyId, hi: number, rows: string[], fails: string[]): Promise<void> {
  const height = HEIGHTS[hi];
  const lr = await rigFor({ body, height, limbs: LEGLESS }, 'w120');
  const exempt = ASSET_RESIDUAL[body]?.labels ?? null;
  const viaWalk = await sweep(lr, 'walk', exempt);
  const direct = await sweep(lr, 'crawl', exempt);
  const id = `${body}@h${height}`;
  const check = (ok: boolean, msg: string) => {
    if (!ok) fails.push(`${id}: ${msg}`);
  };
  check(viaWalk.clip === 'crawl' && direct.clip === 'crawl', `clips ${viaWalk.clip} / ${direct.clip} (expected crawl)`);
  // the two paths are the same clip + layers: identical samples
  check(direct.trace.length === viaWalk.trace.length && direct.trace.every((v, i) => Math.abs(v - viaWalk.trace[i]) < 1e-6), 'legless walk and direct crawl sample differently');
  for (const [path, st] of [['walk', viaWalk], ['crawl', direct]] as const) {
    if (!exempt) check(mm(st.minY) >= FLOOR_TOL_MM, `${path}: lowest visible vertex ${mm(st.minY)} mm (${st.minLabel} @ ${st.minT.toFixed(3)} s)`);
    check(mm(st.gatedMinY) >= FLOOR_TOL_MM, `${path}: lowest non-exempt vertex ${mm(st.gatedMinY)} mm (${st.gatedLabel})`);
    if (Number.isFinite(st.stumpMinY)) check(mm(st.stumpMinY) >= FLOOR_TOL_MM, `${path}: stump caps ${mm(st.stumpMinY)} mm`);
    if (Number.isFinite(st.propMinY)) check(mm(st.propMinY) >= 0, `${path}: held prop ${mm(st.propMinY)} mm`);
    // hands: exactly the pre-W-120 minimum + the documented floor-contact lift (no float)
    const expected = HANDS_BEFORE_MM[body][hi] + floorContactLift(body, 'crawl') * scaleOf(body, height) * 1000;
    check(Math.abs(mm(st.handMinY) - expected) <= 1, `${path}: hand minimum ${mm(st.handMinY)} mm vs ${expected.toFixed(1)} mm`);
    check(st.handMinY > 0, `${path}: hand bone below the floor`);
  }
  if (HELD_PROP_RULES[body as keyof typeof HELD_PROP_RULES]) check(Number.isFinite(viaWalk.propMinY), 'held prop not re-skinned');
  rows.push(`| ${body} | ${height} | ${mm(viaWalk.minY)} (${viaWalk.minLabel}) | ${mm(viaWalk.gatedMinY)} | ${mm(viaWalk.handMinY)} | ${Number.isFinite(viaWalk.propMinY) ? mm(viaWalk.propMinY) : '-'} | ${Number.isFinite(viaWalk.stumpMinY) ? mm(viaWalk.stumpMinY) : '-'} |`);
}

const HEADER = '| look | h | lowest visible (label) | lowest non-exempt | hand bones min | held prop min | stump caps min |';

describe.skipIf(!published)('W-120 crawl floor contact: classic + shield (request F looks)', () => {
  it('every height, both legless crawl paths, whole 120 Hz cycle: >= -5 mm, lid above the floor, hands unmoved', async () => {
    const rows = [HEADER];
    const fails: string[] = [];
    for (const body of ['classic', 'shield'] as const) for (let hi = 0; hi < HEIGHTS.length; hi++) await checkLook(body, hi, rows, fails);
    console.log(`[W-120] crawl minima (mm)\n${rows.join('\n')}`);
    expect(fails).toEqual([]);
  }, 600000);

  it('the shield lid is a re-skinned rigid island and never goes below the floor in ANY clip (intact legs, h1)', async () => {
    const lr = await rigFor({ body: 'shield', height: 1 }, 'w120-clips');
    const bad: string[] = [];
    for (const anim of [...ANIM_STATES, ...EXTRA_ANIM_STATES] as AnimState[]) {
      poseRig(lr, { anim }, ORIGIN, 0);
      const d = settledClip(lr).getClip().duration;
      const ts: number[] = [];
      for (let i = 0; i / 30 < d; i++) ts.push(i / 30);
      ts.push(d - 1e-4);
      const st = await sweep(lr, anim, null, ts);
      expect(Number.isFinite(st.propMinY), `${anim}: lid vertices present`).toBe(true);
      if (st.propMinY < 0) bad.push(`${anim} (${st.clip}): lid ${mm(st.propMinY)} mm`);
    }
    expect(bad).toEqual([]);
  }, 600000);

  it('direct crawl with intact legs and the idle -> crawl crossfade keep the lid above the floor; idle wears it on the back (W-151)', async () => {
    const lr = await rigFor({ body: 'shield', height: 1 }, 'w120-fade');
    const st = await sweep(lr, 'crawl', null);
    expect(mm(st.propMinY)).toBeGreaterThanOrEqual(0);
    // crossfade frame by frame (60 Hz) from idle into crawl and back
    const r = lr.rig;
    poseRig(lr, { anim: 'idle' }, ORIGIN, 0.5);
    const lid = () => {
      const s = sampleRig(lr);
      let y = Infinity;
      for (let i = 0; i < s.body.pos.length / 3; i++) if (s.body.labels[s.body.vLabel[i]] === 'heldProp_L') y = Math.min(y, s.body.pos[i * 3 + 1]);
      return y;
    };
    // W-151: in the idle hand the lid hung 56 mm inside the shin, so the idle now wears it on the back (heldPropFit.ts:
    // fully stowed, full size); the crawl puts it away. Before W-151 this asserted the identity under hand_L.
    const bone = r.root.getObjectByName('heldProp_L')!;
    expect(HELD_PROP_FIT.shield.idle).toBe('back');
    expect(HELD_PROP_FIT.shield.crawl).toBe('away');
    expect(bone.position.length()).toBeGreaterThan(0.1);
    expect(bone.scale.toArray()).toEqual([1, 1, 1]);
    for (const anim of ['crawl', 'idle'] as const) {
      r.setAnim(anim);
      for (let i = 0; i < 60; i++) {
        r.update(1 / 60);
        r.root.updateMatrixWorld(true);
        expect(mm(lid()), `${anim} fade frame ${i}`).toBeGreaterThanOrEqual(0);
      }
    }
    // a lost left arm takes the lid with the collapsed hand, as before (never stowed, never under the floor)
    const armless = await rigFor({ body: 'shield', height: 1, limbs: { ...LEGLESS, armL: 'missing' } }, 'w120-arm');
    const sa = await sweep(armless, 'crawl', null);
    expect(mm(sa.propMinY)).toBeGreaterThanOrEqual(0);
    expect(armless.rig.root.getObjectByName('heldProp_L')!.position.length()).toBeLessThan(1e-9);
  }, 600000);
});

describe.skipIf(!fullGate)('W-120 crawl floor contact: every look (clip gate)', () => {
  it('26 looks x 3 heights x both legless crawl paths x the whole 120 Hz cycle', async () => {
    const rows = [HEADER];
    const fails: string[] = [];
    for (const body of CAST_BODY_IDS) {
      if (body === 'shield') continue; // covered above
      for (let hi = 0; hi < HEIGHTS.length; hi++) await checkLook(body, hi, rows, fails);
    }
    console.log(`[W-120] crawl minima, every cast look (mm)\n${rows.join('\n')}`);
    for (const [body, r] of Object.entries(ASSET_RESIDUAL)) console.log(`[W-120] asset residual ${body}: ${r!.reason}`);
    expect(fails).toEqual([]);
  }, 1800000);
});
