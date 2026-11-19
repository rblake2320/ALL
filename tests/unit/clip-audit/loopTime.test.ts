/**
 * W-120 audit fix: the harness samples a clip at the time the RENDERER would show. A looping clip (LoopRepeat) wraps
 * (t mod duration) and a one-shot (LoopOnce + clampWhenFinished) holds its end pose - exactly what three's
 * AnimationMixer does with the loop mode the rigs give each clip (rig.ts / castRig.ts: ONE_SHOT_ANIMS). Before
 * W-120 every t beyond the clip clamped to its last frame, so t = 2 on the 1.6 s crawl loop showed t = 1.6 instead of 0.4.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ONE_SHOT_ANIMS } from '../../../src/render/characters/plan';
import { ONE_SHOT_END_EPS, auditClipTime, internals, poseRig, rigFor, sampleRig } from '../../../tools/clip-audit/rigs';
import { published } from './gate';

/** A clip whose animated value equals its own clip time (x = t), driven through a real AnimationMixer. */
function mixerTime(duration: number, loop: THREE.AnimationActionLoopStyles, t: number): number {
  const o = new THREE.Object3D();
  const clip = new THREE.AnimationClip('ramp', duration, [new THREE.NumberKeyframeTrack('.position[x]', [0, duration], [0, duration])]);
  const mixer = new THREE.AnimationMixer(o);
  const a = mixer.clipAction(clip);
  a.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
  a.clampWhenFinished = true;
  a.play();
  // advance in renderer-sized frames (the mixer wraps / clamps per update)
  let left = t;
  mixer.update(0);
  while (left > 1e-12) {
    const dt = Math.min(1 / 60, left);
    mixer.update(dt);
    left -= dt;
  }
  return o.position.x;
}

describe('auditClipTime mirrors the AnimationMixer loop modes', () => {
  const D = 1.6;
  it('LoopRepeat wraps: t mod duration (t = 2 on the 1.6 s crawl is 0.4, not the last frame)', () => {
    expect(auditClipTime(2, D, THREE.LoopRepeat)).toBeCloseTo(0.4, 10);
    expect(auditClipTime(0.4, D, THREE.LoopRepeat)).toBeCloseTo(0.4, 10);
    expect(auditClipTime(3.3, D, THREE.LoopRepeat)).toBeCloseTo(0.1, 10);
    expect(auditClipTime(D, D, THREE.LoopRepeat)).toBeCloseTo(0, 10);
    expect(auditClipTime(-0.2, D, THREE.LoopRepeat)).toBeCloseTo(1.4, 10);
    for (const t of [0, 0.25, 0.4, 1.1, 1.59, 2, 2.75, 4.05, 7.3]) {
      expect(auditClipTime(t, D, THREE.LoopRepeat), `t=${t}`).toBeCloseTo(mixerTime(D, THREE.LoopRepeat, t), 4);
    }
  });

  it('LoopOnce clamps to the held end pose (and to 0 below the start)', () => {
    expect(auditClipTime(2, D, THREE.LoopOnce)).toBeCloseTo(D - ONE_SHOT_END_EPS, 10);
    expect(auditClipTime(0.4, D, THREE.LoopOnce)).toBeCloseTo(0.4, 10);
    expect(auditClipTime(-1, D, THREE.LoopOnce)).toBe(0);
    for (const t of [0, 0.4, 1.2, 1.6, 2, 5]) {
      expect(Math.abs(auditClipTime(t, D, THREE.LoopOnce) - mixerTime(D, THREE.LoopOnce, t)), `t=${t}`).toBeLessThanOrEqual(ONE_SHOT_END_EPS + 1e-9);
    }
  });

  it('degenerate input never yields NaN', () => {
    expect(auditClipTime(NaN, D, THREE.LoopRepeat)).toBe(0);
    expect(auditClipTime(1, 0, THREE.LoopRepeat)).toBe(0);
    expect(auditClipTime(Infinity, D, THREE.LoopOnce)).toBe(0);
  });
});

describe.skipIf(!published)('poseRig samples what the renderer shows (real rigs)', () => {
  const ORIGIN = { x: 0, y: 0, z: 0, facing: 0 };
  const signature = (lr: Awaited<ReturnType<typeof rigFor>>) => {
    const s = sampleRig(lr);
    return Object.values(s.bones).flat();
  };

  it('the rigs give crawl LoopRepeat and pickup LoopOnce, matching ONE_SHOT_ANIMS', async () => {
    const lr = await rigFor({ body: 'classic', height: 0.5 }, 'loop');
    for (const anim of ['crawl', 'walk', 'pickup', 'collapse'] as const) {
      poseRig(lr, { anim }, ORIGIN, 0);
      const a = internals(lr.rig).actions.get(anim)!;
      expect(a.loop, anim).toBe(ONE_SHOT_ANIMS.has(anim) ? THREE.LoopOnce : THREE.LoopRepeat);
    }
  });

  it('looping crawl: t = 2 equals t = 0.4 and differs from the clip end (classic and shield, legless)', async () => {
    for (const body of ['classic', 'shield'] as const) {
      const lr = await rigFor({ body, height: 1, limbs: { legL: 'missing', legR: 'missing' } }, 'loop');
      poseRig(lr, { anim: 'crawl' }, ORIGIN, 2);
      const at2 = signature(lr);
      poseRig(lr, { anim: 'crawl' }, ORIGIN, 0.4);
      const at04 = signature(lr);
      poseRig(lr, { anim: 'crawl' }, ORIGIN, 1.6 - ONE_SHOT_END_EPS);
      const atEnd = signature(lr);
      for (let i = 0; i < at2.length; i++) expect(Math.abs(at2[i] - at04[i]), `${body} ${i}`).toBeLessThan(1e-5);
      expect(Math.max(...at2.map((v, i) => Math.abs(v - atEnd[i]))), body).toBeGreaterThan(0.01);
    }
  });

  it('one-shot pickup: any t past the clip holds the end pose', async () => {
    const lr = await rigFor({ body: 'classic', height: 0.5 }, 'loop');
    poseRig(lr, { anim: 'pickup' }, ORIGIN, 0);
    const d = internals(lr.rig).actions.get('pickup')!.getClip().duration;
    poseRig(lr, { anim: 'pickup' }, ORIGIN, d - ONE_SHOT_END_EPS);
    const end = signature(lr);
    poseRig(lr, { anim: 'pickup' }, ORIGIN, d + 5);
    const past = signature(lr);
    for (let i = 0; i < end.length; i++) expect(Math.abs(end[i] - past[i])).toBeLessThan(1e-6);
    poseRig(lr, { anim: 'pickup' }, ORIGIN, d * 0.3);
    const mid = signature(lr);
    expect(Math.max(...mid.map((v, i) => Math.abs(v - end[i])))).toBeGreaterThan(0.01);
  });
});
