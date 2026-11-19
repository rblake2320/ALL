/**
 * W-116 (owner playtest #1) pure helpers:
 *  - storyTargetOf: the running Act 1 step → the world object it is about (mailbox, coffin, …), null for buy/build
 *    steps, classic worlds, finished steps; deterministic among several matches; never throws on junk;
 *  - pickFramePoint: a spot for the target + marker box that covers no HUD panel (nearest the centre), least overlap
 *    when nothing is free; solveFocus: the camera focus putting a world point on that spot (perspective projection).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { WorldState } from '../../../src/sim/types';
import { ACT1_QUESTS } from '../../../src/sim/content/quests';
import { activeStoryStep, STORY_STEP_TARGETS, storyTargetOf } from '../../../src/shared/storyTarget';
import { anchorInBox, pickFramePoint, rectOverlap, solveFocus, STORY_FRAME_BOX, type FrameRect } from '../../../src/shared/framing';
import { storyFramePoint } from '../../../src/ui/hud/lib/storyFraming';

const TAGS: Record<string, string[]> = {
  mailbox_crooked: ['mailbox'],
  coffin_pine: ['bed', 'coffin'],
  fridge_humming: ['fridge', 'appliance'],
  microwave_nuke: ['microwave', 'appliance'],
  stove_greasefire: ['stove', 'appliance'],
  shower_drizzle: ['shower', 'plumbing'],
  chair_creaky: ['seat'],
};
const tagsOf = (d: string) => TAGS[d];

function world(questId: string, stepIndex: number, objects: [string, string][], over: Partial<WorldState> = {}): WorldState {
  const objs: Record<string, unknown> = {};
  for (const [id, defId] of objects) objs[id] = { id, defId, placement: { kind: 'floor', x: 1, z: 1, rot: 0 } };
  return {
    flags: { storyArc: 'act1' },
    objects: objs,
    quests: { version: 1, worldId: 'w', active: [{ questId, instance: 1, startedTick: 0, stepIndex, step: { progress: 0, baseline: 0, heldMin: 0, startTick: 0, startDay: 1, seen: [], worldId: 'w', done: false } }], completions: {}, lastEndedDay: {}, grants: [], pinned: null },
    ...over,
  } as unknown as WorldState;
}

describe('storyTargetOf (step → target object)', () => {
  it('maps every pointable Act 1 step to its object: mailbox, coffin, cooker, shower, fridge (spray), mailbox (bill)', () => {
    const all: [string, string][] = [
      ['o3', 'mailbox_crooked'],
      ['o4', 'coffin_pine'],
      ['o9', 'fridge_humming'],
      ['o10', 'microwave_nuke'],
      ['o11', 'shower_drizzle'],
    ];
    const at = (q: string, i: number) => storyTargetOf(world(q, i, all), tagsOf)?.defId ?? null;
    expect(at('act1_claim', 0)).toBe('mailbox_crooked');
    expect(at('act1_rest', 0)).toBe('coffin_pine');
    expect(at('act1_hunger', 2)).toBe('microwave_nuke');
    expect(at('act1_scrub', 1)).toBe('shower_drizzle');
    expect(at('act1_scrub', 2)).toBe('fridge_humming');
    expect(at('act1_lease', 0)).toBe('mailbox_crooked');
    // buy / build / room / chat steps have no single object: no marker, no "Show me"
    for (const [q, i] of [['act1_hunger', 0], ['act1_hunger', 1], ['act1_scrub', 0], ['act1_patch', 0], ['act1_patch', 1], ['act1_curb', 0], ['act1_curb', 1], ['act1_neighbour', 0]] as const) expect(at(q, i), `${q}#${i}`).toBeNull();
    expect(storyTargetOf(world('act1_claim', 0, all), tagsOf)).toEqual({ questId: 'act1_claim', stepId: 'mail', objectId: 'o3', defId: 'mailbox_crooked' });
  });

  it('every mapped key is a real Act 1 step (no typo silently hides a marker)', () => {
    const real = new Set(ACT1_QUESTS.flatMap((q) => q.steps.map((s) => `${q.id}#${s.id}`)));
    for (const k of Object.keys(STORY_STEP_TARGETS)) expect(real.has(k), k).toBe(true);
  });

  it('the stove counts when there is no microwave; among several matches the lowest id wins (deterministic)', () => {
    expect(storyTargetOf(world('act1_hunger', 2, [['o20', 'stove_greasefire'], ['o9', 'fridge_humming']]), tagsOf)?.defId).toBe('stove_greasefire');
    expect(storyTargetOf(world('act1_claim', 0, [['o12', 'mailbox_crooked'], ['o7', 'mailbox_crooked'], ['o100', 'mailbox_crooked']]), tagsOf)?.objectId).toBe('o7');
  });

  it('ADVERSARIAL: no target for classic worlds, a finished step, a missing / held object, or junk state', () => {
    const base: [string, string][] = [['o3', 'mailbox_crooked']];
    expect(storyTargetOf(world('act1_claim', 0, base, { flags: {} } as never), tagsOf)).toBeNull();
    const w = world('act1_claim', 0, base);
    w.quests!.active[0].step.done = true;
    expect(storyTargetOf(w, tagsOf)).toBeNull();
    expect(storyTargetOf(world('act1_claim', 0, []), tagsOf)).toBeNull();
    const held = world('act1_claim', 0, base);
    (held.objects.o3 as unknown as { placement: unknown }).placement = { kind: 'held', agentId: 'a1' };
    expect(storyTargetOf(held, tagsOf)).toBeNull();
    expect(storyTargetOf(world('story_firstMeal', 0, base), tagsOf)).toBeNull();
    expect(storyTargetOf(world('act1_claim', 99, base), tagsOf)).toBeNull();
    for (const junk of [null, undefined, {}, { flags: { storyArc: 'act1' } }, { flags: { storyArc: 'act1' }, quests: { active: 'x' } }]) expect(storyTargetOf(junk as never, tagsOf)).toBeNull();
    expect(storyTargetOf(world('act1_claim', 0, base), () => {
      throw new Error('boom');
    })).toBeNull();
    expect(activeStoryStep(world('act1_rest', 0, base))).toEqual({ questId: 'act1_rest', stepId: 'sleep' });
  });
});

describe('pickFramePoint (target box clear of the HUD)', () => {
  const VP = { w: 1280, h: 720 };
  const clear = (p: { x: number; y: number }, avoid: FrameRect[], box = STORY_FRAME_BOX) => avoid.every((r) => rectOverlap({ x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h }, r) === 0);

  it('nothing in the way → the viewport centre', () => {
    expect(pickFramePoint(VP, [], STORY_FRAME_BOX)).toEqual({ x: 640, y: 360, overlap: 0 });
  });

  it('desktop W-113 layout: agent panel bottom-left, quests top-right, story card top-centre → a free spot, nearest the centre', () => {
    const avoid: FrameRect[] = [
      { x: 0, y: 0, w: 1280, h: 56 }, // top bar
      { x: 12, y: 420, w: 520, h: 290 }, // agent panel
      { x: 980, y: 70, w: 290, h: 420 }, // quests panel
      { x: 420, y: 90, w: 440, h: 200 }, // story card
      { x: 560, y: 600, w: 300, h: 110 }, // action queue
    ];
    const p = pickFramePoint(VP, avoid, STORY_FRAME_BOX);
    expect(p.overlap).toBe(0);
    expect(clear(p, avoid)).toBe(true);
    // and it is the NEAREST clear spot: every point closer to the centre is covered
    const d = Math.hypot(p.x - 640, p.y - 360);
    for (let y = 113; y < 610; y += 8) for (let x = 83; x < 1200; x += 8) if (Math.hypot(x - 640, y - 360) < d - 12) expect(clear({ x, y }, avoid), `${x},${y}`).toBe(false);
  });

  it('phone portrait 390×844: household column, top bar, bottom agent panel + queue → between them', () => {
    const avoid: FrameRect[] = [
      { x: 0, y: 0, w: 390, h: 100 },
      { x: 8, y: 108, w: 64, h: 220 },
      { x: 0, y: 560, w: 390, h: 284 },
      { x: 8, y: 500, w: 374, h: 52 },
    ];
    const p = pickFramePoint({ w: 390, h: 844 }, avoid, STORY_FRAME_BOX);
    expect(p.overlap).toBe(0);
    expect(clear(p, avoid)).toBe(true);
    expect(p.y).toBeGreaterThan(100);
    expect(p.y).toBeLessThan(500);
  });

  it('ADVERSARIAL: fully covered → least overlap (never throws); junk input is ignored; tiny viewport clamps the box', () => {
    const p = pickFramePoint(VP, [{ x: 0, y: 0, w: 1280, h: 720 }], STORY_FRAME_BOX);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(p.overlap).toBeGreaterThan(0);
    const half = pickFramePoint(VP, [{ x: 0, y: 0, w: 1280, h: 600 }], STORY_FRAME_BOX);
    expect(half.overlap).toBeLessThan(STORY_FRAME_BOX.w * STORY_FRAME_BOX.h); // slid down as far as it goes
    expect(pickFramePoint(VP, [null as never, { x: NaN, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: -5, h: 4 }], STORY_FRAME_BOX)).toMatchObject({ x: 640, y: 360 });
    const tiny = pickFramePoint({ w: 100, h: 80 }, [], STORY_FRAME_BOX);
    expect(tiny.x).toBeGreaterThan(0);
    expect(tiny.y).toBeGreaterThan(0);
    expect(pickFramePoint({ w: NaN, h: -1 } as never, [], STORY_FRAME_BOX)).toMatchObject({ overlap: 0 });
  });

  it('360×640 with the story card up: no room for the roomy box → the compact box (object + marker) fits the free band', () => {
    const avoid: FrameRect[] = [
      { x: 72, y: 0, w: 216, h: 236 }, // story card (padded)
      { x: 0, y: 0, w: 360, h: 120 }, // top bar
      { x: 4, y: 170, w: 76, h: 100 }, // household portrait
      { x: 20, y: 317, w: 320, h: 48 }, // queue bubble
      { x: 0, y: 360, w: 360, h: 280 }, // agent panel
    ];
    const roomy = pickFramePoint({ w: 360, h: 640 }, avoid, STORY_FRAME_BOX);
    expect(roomy.overlap).toBeGreaterThan(0);
    const p = storyFramePoint(avoid, { w: 360, h: 640 });
    expect(p.overlap).toBe(0);
    expect(p.y).toBeGreaterThan(236);
    expect(p.y).toBeLessThan(317);
  });

  it('the target point sits below the box centre (the marker floats above it); canvas offset is applied', () => {
    const a = anchorInBox({ x: 100, y: 100 });
    expect(a.x).toBe(100);
    expect(a.y).toBeGreaterThan(100);
    const p = storyFramePoint([], { w: 1280, h: 720 }, { x: 10, y: 20 });
    expect(p.x).toBe(630);
    expect(p.y).toBeCloseTo(anchorInBox({ x: 640, y: 360 }).y - 20, 6);
  });
});

describe('solveFocus (camera focus → screen point)', () => {
  /** A real THREE perspective camera orbiting a focus at a fixed yaw/pitch/distance, like the game's rig. */
  function rig(yaw: number, pitch: number, dist: number, vw = 1280, vh = 720) {
    const cam = new THREE.PerspectiveCamera(40, vw / vh, 0.5, 400);
    return (world: THREE.Vector3) => (fx: number, fz: number) => {
      cam.position.set(fx + Math.sin(yaw) * Math.cos(pitch) * dist, 1 + Math.sin(pitch) * dist, fz + Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.lookAt(fx, 1, fz);
      cam.updateMatrixWorld();
      const v = world.clone().project(cam);
      if (v.z < -1 || v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * vw, y: ((1 - v.y) / 2) * vh };
    };
  }

  it('puts the mailbox exactly on an off-centre spot (perspective, several camera angles)', () => {
    for (const [yaw, pitch, dist] of [[0, 0.72, 20], [Math.PI / 4, 0.68, 24], [-2.1, 0.9, 14]] as const) {
      const project = rig(yaw, pitch, dist)(new THREE.Vector3(14.5, 0.6, 26.5));
      for (const want of [{ x: 640, y: 360 }, { x: 900, y: 250 }, { x: 200, y: 600 }]) {
        const r = solveFocus(project, { x: 15, z: 15 }, want)!;
        expect(r, `${yaw}`).not.toBeNull();
        const got = project(r.x, r.z)!;
        expect(Math.hypot(got.x - want.x, got.y - want.y), `${yaw} ${want.x},${want.y}`).toBeLessThan(1.5);
      }
    }
  });

  it('ADVERSARIAL: an unusable projection (behind the camera / degenerate) returns null instead of a wild pan', () => {
    expect(solveFocus(() => null, { x: 0, z: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(solveFocus(() => ({ x: 5, y: 5 }), { x: 0, z: 0 }, { x: 100, y: 100 })).toBeNull(); // singular Jacobian
    expect(solveFocus(() => ({ x: NaN, y: 0 }), { x: 0, z: 0 }, { x: 1, y: 1 })).toBeNull();
    // already on target: no move
    const r = solveFocus(() => ({ x: 50, y: 50 }), { x: 3, z: 4 }, { x: 50, y: 50 })!;
    expect(r).toMatchObject({ x: 3, z: 4, error: 0 });
  });
});
