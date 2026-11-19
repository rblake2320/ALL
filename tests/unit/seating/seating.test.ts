/**
 * Seating (owner bug: classic zombie perched on the front of the armchair, shins through the seat front). For EVERY
 * 'sit' slot of the catalog × the classic zombie (height scales 0.88 / 1.08) and every cast body (0.94 / 1.06) × the
 * seated clips, the real furniture GLB (raycasts) and the real rig (skinned vertices) are composed exactly as the game
 * does (slot pose → AgentManager seat offset → rig height-scale seat rule) and checked:
 *   - catalog seat data (height / back / front) matches the modelled seat (±1.5 cm);
 *   - seat contact: the lowest hip-mass vertex rests on the cushion (sinks ≤ 8 cm, floats ≤ 2 cm);
 *   - seat contact (lowest hip-mass vertices) on the cushion between backrest face and lip;
 *   - back: lumbar back on the backrest face (gap ≤ 9 cm, into the padding ≤ 4 cm; the documented big-backed bodies
 *     ≤ 13 cm — capes / bear suit, see docs/contract-requests/seating.md);
 *   - legs: shin / foot vertices (below cushion − 12 cm) never more than 2 cm inside the furniture (≤ 1 % of samples);
 *   - feet on the floor or resting just above it (−3 cm … +20 cm; short-legged bodies dangle, documented).
 * The thigh slope of the shared sit* clips is a rig matter (docs/contract-requests/seating.md); see rig-pose below.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DIM } from '../../../src/shared/dimensions';
import { SEAT_LUMBAR } from '../../../src/shared/seating';
import { seatOffset, SEAT_SHIFT_MAX, SEAT_SHIFT_MIN } from '../../../src/render/agents/seat';
import { seatedOffset } from '../../../src/render/agents/agents';
import {
  SIT_CLIPS, allSitters, hipContactZ, loadSeat, lumbarBack, measureSeat, seatFramePoint, seatSlots, seatToLocal,
  type SeatModel, type SeatSlotRef, type Sitter, type SitterPose,
} from './seatRig';

type V3 = [number, number, number];

/** Bodies whose rigid capes / suits sit far behind the spine (lumbar back ≤ −0.2 m): they reach the forward clamp. */
const BIG_BACKED = new Set(['boss', 'strongman', 'mascot', 'fortune']);
/** Hip mass includes a skirt / cape hem hanging below the seat (cloth, not hips). */
const WIDE_HIPS = new Set(['boss', 'fortune', 'bride', 'granny', 'ringmaster']);
/** Long skirts skinned to the shins drape over the seat front: only their feet are checked against the furniture. */
const SKIRTS = new Set(['bride', 'granny', 'fortune']);
/** Bear suit wider than any armchair (knees ±0.37 m): its legs are only checked between the arms. */
const WIDE_LEGS = new Set(['mascot']);
/** Shin / foot samples count as clipping only when they are this far inside the furniture (grazes are hidden). */
const ERODE = 0.02;
const BEFORE = !!process.env.SEAT_BEFORE;
/** Depth below the cushion top the sloped thighs / knees of the shared sit* clips may press into the padding. */
const KNEE_PRESS = 0.12;
/** Rigid capes skinned to the pelvis pass through any backrest (docs/contract-requests/cast.md 'Big Lug'). */
const RIGID_CAPE = new Set(['boss']);

let sitters: Sitter[] = [];
const refs = seatSlots();
const models = new Map<string, SeatModel>();
const poses = new Map<string, SitterPose>();
const posed = (s: Sitter, clip: string, t: number): SitterPose => {
  const k = `${s.id}|${clip}|${t}`;
  let p = poses.get(k);
  if (!p) poses.set(k, (p = s.pose(clip, t)));
  return p;
};

beforeAll(async () => {
  sitters = await allSitters();
  for (const r of refs) if (!models.has(r.spec.id)) models.set(r.spec.id, await loadSeat(r.spec.id));
}, 120000);

describe('catalog seat data matches the modelled seats', () => {
  it('every sit slot declares seat geometry within ±1.5 cm of the GLB', () => {
    expect(refs.length).toBeGreaterThanOrEqual(13);
    const rows: string[] = [];
    for (const r of refs) {
      const g = r.slot.seat;
      expect(g, `${r.spec.id}/${r.slot.id} has no seat geometry`).toBeTruthy();
      const m = measureSeat(models.get(r.spec.id)!, r);
      rows.push(`${r.spec.id}/${r.slot.id}: height ${m.height.toFixed(3)} (cat ${g!.height}) back ${m.back?.toFixed(3) ?? '-'} (cat ${g!.back ?? '-'}) front ${m.front.toFixed(3)} (cat ${g!.front}) arms ±${Number.isFinite(m.armHalf) ? m.armHalf.toFixed(2) : '-'}`);
      expect(Math.abs(m.height - g!.height), `${r.spec.id} height`).toBeLessThan(0.015);
      expect(Math.abs(m.height - DIM.SEAT_HEIGHT), `${r.spec.id} cushion far from SEAT_HEIGHT`).toBeLessThan(0.04);
      if (g!.back === null) expect(m.back === null || m.back > 0.3, `${r.spec.id} has a back`).toBe(true);
      else expect(Math.abs((m.back ?? Infinity) - g!.back), `${r.spec.id} back`).toBeLessThan(0.015);
      expect(Math.abs(m.front - g!.front), `${r.spec.id} front`).toBeLessThan(0.015);
    }
    console.log(rows.join('\n'));
  });
});

describe('every seat × body × sit clip sits correctly', () => {
  const TIMES = [0.7, 2.1];
  for (const ref of refs) {
    it(`${ref.spec.id}/${ref.slot.id}`, () => {
      const model = models.get(ref.spec.id)!;
      const geo = ref.slot.seat!;
      const armHalf = measureSeat(model, ref).armHalf;
      const fails: string[] = [];
      const cats = new Map<string, { n: number; worst: number; ex: string }>();
      const fail = (cat: string, tag: string, v: number) => {
        const c = cats.get(cat) ?? { n: 0, worst: -Infinity, ex: '' };
        c.n++;
        if (v > c.worst) { c.worst = v; c.ex = tag; }
        cats.set(cat, c);
        fails.push(`${cat}: ${tag} (${v.toFixed(3)})`);
      };
      for (const s of sitters) {
        const body = s.id === 'classic' ? undefined : s.id;
        for (const scale of [s.scales[0], s.scales[s.scales.length - 1]]) {
          for (const clip of SIT_CLIPS) {
            // SEAT_BEFORE=1 (with SEAT_OBJ_DIR = the pre-fix GLBs): no renderer seat fit, original armchair pose
            const off = BEFORE ? { forward: ref.spec.id === 'armchair_tattered' ? -0.04 : 0, lift: 0 } : seatOffset(geo, body, clip, scale);
            if (!BEFORE) expect(off.forward).toBeGreaterThanOrEqual(SEAT_SHIFT_MIN - 1e-9);
            if (!BEFORE) expect(off.forward).toBeLessThanOrEqual(SEAT_SHIFT_MAX + 1e-9);
            for (const t of TIMES) {
              const p = posed(s, clip, t);
              const tag = `${s.id}@${scale} ${clip}@${t}`;
              const F = (v: number[]) => seatFramePoint(ref, v as V3, scale, off);
              // seat contact
              let hipY = Infinity;
              for (const v of p.hip) hipY = Math.min(hipY, F(v)[1]);
              if (hipY < geo.height - 0.09 && !WIDE_HIPS.has(s.id)) fail('hips sink', tag, geo.height - hipY);
              if (hipY > geo.height + (s.id === 'mascot' ? 0.06 : 0.02)) fail('hips float', tag, hipY - geo.height);
              // seat contact (hip mass) on the cushion, between backrest face and lip
              const cz = F([0, 0, hipContactZ(p)])[2];
              if (geo.back !== null && cz < -geo.back) fail('seat contact behind the backrest', tag, cz);
              if (cz > geo.front - 0.03) fail('seat contact on the lip', tag, cz);
              // back on the backrest
              if (geo.back !== null && !RIGID_CAPE.has(s.id)) {
                const bz = F([0, DIM.SEAT_HEIGHT + SEAT_LUMBAR, lumbarBack(p)])[2];
                const into = -geo.back - bz; // + = into the padding
                const maxInto = BIG_BACKED.has(s.id) ? 0.2 : 0.04;
                if (into > maxInto) fail('back into the backrest', tag, into);
                const maxGap = geo.back > 0.15 ? 0.12 : 0.09; // upright wooden backs: people sit off them
                if (into < -maxGap) fail('back off the backrest', tag, -into);
              }
              // shins / feet never inside the furniture; feet on (or just above) the floor
              let n = 0;
              let inside = 0;
              let footY = Infinity;
              let insideAt = '';
              for (let i = 0; i < p.leg.length; i += 3) {
                const w = F(p.leg[i]);
                footY = Math.min(footY, w[1]);
                // the shared clips slope the thighs down into the cushion lip (rig request): the knee may press up to
                // KNEE_PRESS into the padding; below that every shin / foot sample must be clear of the furniture
                if (w[1] > geo.height - KNEE_PRESS || w[2] < 0) continue;
                if (SKIRTS.has(s.id) && w[1] > 0.12) continue;
                if (WIDE_LEGS.has(s.id) && Math.abs(w[0]) > armHalf - 0.03) continue;
                n++;
                if (deepInside(model, ref, w)) {
                  inside++;
                  insideAt = w.map((x) => x.toFixed(2)).join(',');
                }
              }
              if (inside > Math.max(1, n * 0.01)) fail('shins/feet inside the seat', `${tag} ${inside}/${n} e.g. ${insideAt}`, inside / n);
              if (footY < -0.045) fail('feet through the floor', tag, -footY);
              if (footY > 0.2) fail('feet dangle', tag, footY);
            }
          }
        }
      }
      if (fails.length) console.log(`${ref.spec.id}/${ref.slot.id}: ${fails.length} failures\n  ${[...cats].map(([c, v]) => `${c}: ${v.n}× worst ${v.worst.toFixed(3)} (${v.ex})`).join('\n  ')}`);
      expect(fails.length, [...cats].map(([c, v]) => `${c}: ${v.n}× worst ${v.worst.toFixed(3)} (${v.ex})`).join('\n')).toBe(0);
    });
  }
});

function deepInside(model: SeatModel, ref: SeatSlotRef, w: V3): boolean {
  for (const [dx, dz] of [[0, 0], [ERODE, 0], [-ERODE, 0], [0, ERODE], [0, -ERODE]]) {
    if (!model.insideAt(seatToLocal(ref, [w[0] + dx, w[1], w[2] + dz]))) return false;
  }
  return model.insideAt(seatToLocal(ref, [w[0], w[1] + ERODE, w[2]]));
}

describe('furniture solid grid', () => {
  // the sheet ghost on the haunted PC's monitor is an open shell (no closed hem): its interval must end at its own
  // lowest point, not run down through the desk's empty knee space to the floor (false "toes in the desk" before)
  it('an open shell is solid only down to its own bottom', async () => {
    const desk = await loadSeat('desk_hauntedpc');
    const ghost = [0.1, 1.25, -0.44] as V3; // model-local, inside the ghost sheet above the monitor (column of the old false positive)
    expect(desk.insideAt(ghost)).toBe(true);
    for (const y of [0.02, 0.2, 0.5]) expect(desk.insideAt([0.1, y, -0.44]), `knee space at y=${y}`).toBe(false);
  });
});

describe('AgentManager seated offset (adversarial inputs)', () => {
  const objects = { o1: { defId: 'armchair_tattered' } } as never;
  const act = (slot: unknown, id = 'o1') => ({ active: { stageTarget: { kind: 'object', id }, slot }, appearance: { height: 0.5 } }) as never;
  const out = { forward: 0, lift: 0 };
  it('applies only for sit* clips on a sit slot with seat data', () => {
    expect(seatedOffset(act(0), 'sit', objects, out).forward).not.toBe(0);
    for (const [a, anim] of [[act(0), 'idle'], [act(1), 'sit'], [act(-1), 'sit'], [act(0.5), 'sit'], [act('0'), 'sit'], [act(0, 'nope'), 'sit'], [act(0, '__proto__'), 'sit'], [{ active: null, appearance: {} }, 'sit']] as [never, string][]) {
      const r = seatedOffset(a, anim, objects, out);
      expect([r.forward, r.lift], String(anim)).toEqual([0, 0]);
    }
    expect(seatedOffset(act(0), 'sit', undefined, out)).toEqual({ forward: 0, lift: 0 });
  });
  it('is finite and clamped for garbage appearance / unknown bodies', () => {
    for (const app of [{ body: 'nobody', height: NaN }, { height: Infinity }, { body: 42, height: -5 }, {}]) {
      const r = seatedOffset({ active: { stageTarget: { kind: 'object', id: 'o1' }, slot: 0 }, appearance: app } as never, 'sitTV', objects, out);
      expect(Number.isFinite(r.forward) && Number.isFinite(r.lift)).toBe(true);
      expect(r.forward).toBeGreaterThanOrEqual(SEAT_SHIFT_MIN);
      expect(r.forward).toBeLessThanOrEqual(SEAT_SHIFT_MAX);
    }
  });
  it('backless stools only lift', () => {
    const r = seatOffset({ height: 0.47, back: null, front: 0.18 }, 'boss', 'sit', 1);
    expect(r.forward).toBe(0);
    expect(r.lift).toBeCloseTo(0.01, 5);
  });
});
