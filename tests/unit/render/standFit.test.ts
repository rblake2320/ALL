/**
 * W-073 renderer standing fits (src/render/agents/reach.ts + agents.ts): pure placement rules, sim untouched.
 *   - social spacing: mutual partners, both standing, not at an object, pushed apart symmetrically (≤ SOCIAL_PUSH_MAX);
 *   - work stand-off: standing clip at a standing work slot moves back along the facing (≤ WORK_STANDOFF_MAX);
 *   - rest-slot approach: a standing clip on a lie / sit slot is shown on the slot's first approach tile;
 *   - lie lift: lying clips rest the back on the catalog lie surface.
 */
import { describe, expect, it } from 'vitest';
import { lyingLift, socialOffset, standingOffset, type StandOffset } from '../../../src/render/agents/agents';
import {
  isPosedRestSlot, lieLift, socialSpacing, workFaceDist, workStandoff, workTop, LIE_LIFT_MAX, SOCIAL_PUSH_MAX, WORK_FACE_DIST, WORK_STANDOFF_MAX,
} from '../../../src/render/agents/reach';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';

const out = (): StandOffset => ({ dx: 0, dz: 0, facing: NaN });

function agent(id: string, partner: string | null, x: number, z: number, anim: string, body?: string, extra: Record<string, unknown> = {}) {
  return {
    id, presence: 'onLot', anim, pos: { x, z },
    appearance: { body, height: 0.5 },
    active: { partnerId: partner, stageTarget: { kind: 'agent', id: partner ?? '' }, ...extra },
  };
}

describe('social spacing', () => {
  it('pushes mutual partners apart symmetrically along their line, never pulls them in', () => {
    const agents = { a: agent('a', 'b', 5, 5, 'talk', 'mascot'), b: agent('b', 'a', 5, 5.55, 'talk', 'mascot') } as never;
    const oa = socialOffset('a', (agents as Record<string, never>).a, 'talk', agents, out());
    const ob = socialOffset('b', (agents as Record<string, never>).b, 'talk', agents, out());
    expect(oa.dz).toBeLessThan(0);
    expect(ob.dz).toBeGreaterThan(0);
    expect(oa.dz).toBeCloseTo(-ob.dz, 9);
    expect(Math.abs(oa.dx)).toBeLessThan(1e-9);
    expect(-oa.dz).toBeLessThanOrEqual(SOCIAL_PUSH_MAX + 1e-9);
    const need = socialSpacing('mascot', 'talk', 1, 'mascot', 'talk', 1)!;
    expect(0.55 + 2 * -oa.dz).toBeCloseTo(Math.min(need, 0.55 + 2 * SOCIAL_PUSH_MAX), 6);
    // already far enough apart: nothing
    const far = { a: agent('a', 'b', 5, 5, 'talk'), b: agent('b', 'a', 5, 8, 'talk') } as never;
    expect(Math.abs(socialOffset('a', (far as Record<string, never>).a, 'talk', far, out()).dz)).toBe(0);
  });

  it('only for mutual, standing, not-at-an-object partners', () => {
    const oneWay = { a: agent('a', 'b', 5, 5, 'talk'), b: agent('b', null, 5, 5.5, 'talk') } as never;
    expect(socialOffset('a', (oneWay as Record<string, never>).a, 'talk', oneWay, out()).dz).toBe(0);
    const seated = { a: agent('a', 'b', 5, 5, 'sitTalk'), b: agent('b', 'a', 5, 5.5, 'sitTalk') } as never;
    expect(socialOffset('a', (seated as Record<string, never>).a, 'sitTalk', seated, out()).dz).toBe(0);
    const atObj = { a: agent('a', 'b', 5, 5, 'talk', undefined, { stageTarget: { kind: 'object', id: 'o' } }), b: agent('b', 'a', 5, 5.5, 'talk') } as never;
    expect(socialOffset('a', (atObj as Record<string, never>).a, 'talk', atObj, out()).dz).toBe(0);
  });
});

describe('work stand-off', () => {
  const objects = { o: { defId: 'counter_slab', placement: { kind: 'floor', x: 4, z: 4, rot: 0 } } } as never;
  it('moves a body leaning into a counter back along its facing, clamped to its approach tile', () => {
    const spec = PHYSICAL_BY_ID.counter_slab;
    expect(workFaceDist(spec, spec.slots[0])).toBeCloseTo(0.22, 6);
    expect(workTop(spec)).toBeCloseTo(spec.surfaces![0].y, 6);
    const a = { active: { stageTarget: { kind: 'object', id: 'o' }, slot: 0 }, appearance: { body: 'mascot', height: 0.5 }, pos: { x: 4.5, z: 5.22 } };
    const facing = Math.PI; // facing -z (toward the counter)
    const o = standingOffset(a as never, 'clean', facing, objects, out());
    expect(o.dz).toBeGreaterThan(0); // back = +z
    expect(o.dz).toBeLessThanOrEqual(WORK_STANDOFF_MAX + 1e-9);
    expect(Math.abs(o.dx)).toBeLessThan(1e-9);
    expect(Number.isNaN(o.facing)).toBe(true);
    // seated / locomotion clips: no stand-off
    expect(standingOffset(a as never, 'walk', facing, objects, out()).dz).toBe(0);
    expect(standingOffset(a as never, 'sit', facing, objects, out()).dz).toBe(0);
  });
  it('stand-off is 0 when the clip stays behind the footprint edge, unknown clips get none', () => {
    expect(workStandoff('classic', 'no-such-clip', 1, 0.9)).toBe(0);
    expect(workStandoff('classic', 'clean', 1, 0)).toBe(0); // nothing below a zero-height top
  });
});

describe('rest-slot approach', () => {
  it('a standing clip on a lie slot is shown on the first approach tile facing the object', () => {
    const spec = PHYSICAL_BY_ID.sarcophagus_cryo;
    const i = spec.slots.findIndex((s) => s.kind === 'lie');
    expect(isPosedRestSlot(spec.slots[i])).toBe(true);
    const objects = { o: { defId: 'sarcophagus_cryo', placement: { kind: 'floor', x: 10, z: 10, rot: 0 } } } as never;
    const pose = spec.slots[i].pose!;
    const a = { active: { stageTarget: { kind: 'object', id: 'o' }, slot: i }, appearance: { height: 0.5 }, pos: { x: 10 + pose.x, z: 10 + pose.z } };
    const o = standingOffset(a as never, 'clean', 0, objects, out());
    const ap = spec.slots[i].approach[0];
    // root ends inside the approach tile (x 9..10 for approach x -1), facing +x (toward the object)
    const x = a.pos.x + o.dx;
    const z = a.pos.z + o.dz;
    expect(Math.floor(x)).toBe(10 + ap.x);
    expect(Math.floor(z)).toBe(10 + ap.z);
    expect(Math.sin(o.facing)).toBeGreaterThan(0.5); // faces the object (+x side of the approach tile)
    expect(WORK_FACE_DIST).toBeGreaterThan(0);
    // ...and on the FLOOR, not at the raised lining height (W-111 float:feet 335 mm regression)
    expect(pose.y).toBeGreaterThan(0.1);
    expect(o.dy).toBeCloseTo(-pose.y, 9);
    // lying clip on the same slot: no relocation, no height change
    const ly = standingOffset(a as never, 'sleep', 0, objects, out());
    expect(ly.dx).toBe(0);
    expect(ly.dy ?? 0).toBe(0);
  });
});

describe('lie lift', () => {
  it('rests a lying back on the catalog lie surface; double bed mattress sits above its sim pose', () => {
    const bed = PHYSICAL_BY_ID.bed_normal.slots[0];
    expect(bed.lie).toBeTruthy();
    const up = lieLift(bed.lie, bed.pose!.y, undefined, 'sleep', 0.98);
    expect(up).toBeGreaterThan(0.04);
    expect(up).toBeLessThanOrEqual(LIE_LIFT_MAX);
    expect(lieLift(bed.lie, bed.pose!.y, undefined, 'idle', 1)).toBe(0);
    expect(lieLift(undefined, 0.5, undefined, 'sleep', 1)).toBe(0);
    const objects = { o: { defId: 'bed_normal', placement: { kind: 'floor', x: 0, z: 0, rot: 0 } } } as never;
    const a = { active: { stageTarget: { kind: 'object', id: 'o' }, slot: 0 }, appearance: { height: 0.5 } };
    expect(lyingLift(a as never, 'sleep', objects)).toBeCloseTo(up, 9);
    expect(lyingLift(a as never, 'sit', objects)).toBe(0);
  });
  it('every lie slot in the catalog declares its surface', () => {
    for (const spec of Object.values(PHYSICAL_BY_ID)) for (const s of spec.slots) if (s.kind === 'lie') expect(s.lie, `${spec.id}/${s.id}`).toBeTruthy();
  });
});

describe('standing height', () => {
  it('a standing clip at a standing work slot keeps its height (dy 0); every raised rest slot drops to the floor', () => {
    let rest = 0;
    for (const [id, spec] of Object.entries(PHYSICAL_BY_ID)) {
      spec.slots.forEach((s, i) => {
        const objects = { o: { defId: id, placement: { kind: 'floor', x: 10, z: 10, rot: 0 } } } as never;
        const p = s.pose ?? { x: 0, z: 0, y: 0 };
        const a = { active: { stageTarget: { kind: 'object', id: 'o' }, slot: i }, appearance: { height: 0.5 }, pos: { x: 10 + (p.x ?? 0), z: 10 + (p.z ?? 0) } };
        const o = standingOffset(a as never, 'clean', 0, objects, out());
        if (isPosedRestSlot(s) && s.approach.length > 0) {
          rest++;
          expect(o.dy, `${id}#${i}`).toBeCloseTo(-(p.y ?? 0), 9);
        } else expect(o.dy ?? 0, `${id}#${i}`).toBe(0);
      });
    }
    expect(rest).toBeGreaterThan(5);
  });
});
