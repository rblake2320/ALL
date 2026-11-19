/**
 * Motion quality of the most-seen clips (finishing pass) + the runtime layers added with them:
 *  - walk: the classic half-raised zombie reach (wrists out in front at chest height), upright enough to read
 *    from the game camera, the right toe dragging while the left foot steps,
 *  - idle: the weight really shifts from leg to leg; talk: beats, a two-handed shrug and a jab; cook: tastes from
 *    the spoon; sitTV: aims the remote and nods off; sit: hands together on the lap,
 *  - mood carriage layer (ART_DIRECTION: happy = bouncy shoulders, sad = slump) - bounded, clip-gated, exactly
 *    reversible and drift-free on frozen clips,
 *  - per-zombie loop phases (a household loaded together does not idle in lockstep) and per-zombie blink seeds
 *    even for rigs upgraded from the capsule fallback.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANIM_STATES, EXPRESSIONS, defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import type { AnimState, Expression, ZombieAppearance } from '../../../src/shared/appearance';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import { POSTURE_SIZE, postureFor, postureGain } from '../../../src/render/characters/posture';
import type { GltfRig } from '../../../src/render/characters/rig';
import { loadGltf } from './helpers';

let gltf: GLTF;
beforeAll(async () => {
  gltf = await loadGltf();
});

/** Foot bone length (ankle -> toe tip along the bone's +Y, tools/blender/characters/lib/skeleton.py). */
const FOOT_LEN = 0.1446;

/** World positions of bones at time t of a clip (raw mixer on the shared parse; rig origin at the feet).
 * 'toe_L' / 'toe_R' are the toe tips (end of the foot bones). */
function sample(clipName: string, t: number, bones: string[]): Record<string, THREE.Vector3> {
  const scene = gltf.scene;
  const clip = gltf.animations.find((c) => c.name === clipName)!;
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.min(t, clip.duration - 1e-4));
  scene.updateMatrixWorld(true);
  const out: Record<string, THREE.Vector3> = {};
  for (const b of bones) {
    if (b.startsWith('toe_')) {
      out[b] = scene.getObjectByName(`foot_${b.slice(4)}`)!.localToWorld(new THREE.Vector3(0, FOOT_LEN, 0));
    } else out[b] = scene.getObjectByName(b)!.getWorldPosition(new THREE.Vector3());
  }
  action.stop();
  mixer.uncacheRoot(scene);
  return out;
}
const times = (clip: string, n: number) => {
  const d = gltf.animations.find((c) => c.name === clip)!.duration;
  return Array.from({ length: n }, (_, i) => (d * i) / n);
};
const duration = (clip: string) => gltf.animations.find((c) => c.name === clip)!.duration;

describe('most-seen clips read from the game camera', () => {
  it('walk: wrists held out in front at chest height, upright torso, the right toe drags', () => {
    let liftL = 0;
    let liftR = 0;
    for (const t of times('walk', 15)) {
      const p = sample('walk', t, ['hand_L', 'hand_R', 'head', 'pelvis', 'toe_L', 'toe_R']);
      for (const h of ['hand_L', 'hand_R']) {
        expect(p[h].z, `${h} forward @${t.toFixed(2)}`).toBeGreaterThan(0.4); // character front is +Z
        expect(p[h].y, `${h} height @${t.toFixed(2)}`).toBeGreaterThan(0.85);
        expect(p[h].y, `${h} height @${t.toFixed(2)}`).toBeLessThan(1.15);
      }
      // the head stays roughly over the hips (slight hunch, not bent double)
      expect(p.head.z - p.pelvis.z, `lean @${t.toFixed(2)}`).toBeLessThan(0.16);
      liftL = Math.max(liftL, p.toe_L.y);
      liftR = Math.max(liftR, p.toe_R.y);
    }
    expect(liftL, 'the good left foot steps (toe clears the floor)').toBeGreaterThan(0.07);
    expect(liftR, 'the bad right foot drags its toe').toBeLessThan(0.05);
  });

  it('idle: the weight shifts from one leg to the other within the loop', () => {
    const xs = times('idle', 16).map((t) => sample('idle', t, ['pelvis']).pelvis.x);
    expect(Math.max(...xs)).toBeGreaterThan(0.02);
    expect(Math.min(...xs)).toBeLessThan(-0.02);
  });

  it('talk: hands come up to gesture, spread wide for the shrug and jab toward the listener', () => {
    const shrug = sample('talk', 1.25, ['hand_L', 'hand_R']);
    expect(shrug.hand_L.x - shrug.hand_R.x, 'both hands out').toBeGreaterThan(0.6);
    expect(Math.min(shrug.hand_L.y, shrug.hand_R.y)).toBeGreaterThan(0.85);
    const jab = sample('talk', 1.72, ['hand_L', 'head']);
    expect(jab.hand_L.z, 'jab reaches forward').toBeGreaterThan(0.45);
    const beat = sample('talk', 0.42, ['hand_R']);
    expect(beat.hand_R.y).toBeGreaterThan(0.8);
  });

  it('cook: stirs at counter height, lifts the spoon to the mouth for a taste, seasons with the other hand', () => {
    expect(duration('cook')).toBeCloseTo(4.8, 2);
    const stir = sample('cook', 0.6, ['hand_R']);
    expect(stir.hand_R.y).toBeGreaterThan(0.95);
    expect(stir.hand_R.y).toBeLessThan(1.15);
    const taste = sample('cook', 3.0, ['hand_R', 'head']);
    expect(taste.hand_R.y, 'spoon up at the face').toBeGreaterThan(1.15);
    expect(taste.hand_R.distanceTo(taste.head), 'near the mouth').toBeLessThan(0.3);
    const season = sample('cook', 3.85, ['hand_L']);
    expect(season.hand_L.y, 'seasoning hand over the pot').toBeGreaterThan(1.15);
  });

  it('sitTV: aims the remote at the TV, then nods off and jerks awake', () => {
    const rest = sample('sitTV', 0.4, ['hand_R', 'head', 'neck']);
    const aim = sample('sitTV', 1.6, ['hand_R']);
    expect(aim.hand_R.z - rest.hand_R.z, 'remote raised toward the TV').toBeGreaterThan(0.12);
    const dozing = sample('sitTV', 4.33, ['head', 'neck']);
    // head drops forward relative to the neck while dozing
    const fwd = (p: Record<string, THREE.Vector3>) => p.head.z - p.neck.z;
    expect(fwd(dozing) - fwd(rest)).toBeGreaterThan(0.015);
    const awake = sample('sitTV', 4.9, ['head', 'neck']);
    expect(fwd(awake)).toBeLessThan(fwd(dozing));
  });

  it('sit: the hands rest together on the lap', () => {
    for (const t of times('sit', 4)) {
      const p = sample('sit', t, ['hand_L', 'hand_R', 'pelvis']);
      expect(p.hand_L.distanceTo(p.hand_R), `@${t}`).toBeLessThan(0.16);
      expect(p.hand_R.y, `@${t}`).toBeLessThan(0.75);
    }
  });
});

// ───────────────────────────── runtime layers

const quiet = () => undefined;
async function makeFactory() {
  const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(), warn: quiet });
  await f.ready;
  return f;
}
const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};
const bonePos = (rig: ZombieRigDebug, name: string) => {
  rig.root.updateMatrixWorld(true);
  return rig.root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
};

describe('mood carriage layer (pure)', () => {
  const buf = new Float32Array(POSTURE_SIZE);

  it('neutral is zero; every expression is finite and bounded at any time', () => {
    expect([...postureFor('neutral', 1.3, buf)].every((v) => v === 0)).toBe(true);
    for (const e of EXPRESSIONS) {
      for (const t of [0, 0.13, 0.5, 1.7, 3.3, 1e6, NaN, -5]) {
        postureFor(e, t, buf);
        for (const v of buf) {
          expect(Number.isFinite(v), e).toBe(true);
          expect(Math.abs(v), e).toBeLessThanOrEqual(15);
        }
      }
    }
  });

  it('sad slumps (chest/neck/head forward, shoulders dropped); happy bounces the shoulders up', () => {
    postureFor('sad', 0, buf);
    expect(buf[0]).toBeGreaterThan(0); // chest pitch
    expect(buf[6]).toBeGreaterThan(0); // head pitch (down)
    expect(buf[10]).toBeGreaterThan(0); // left shoulder dropped
    expect(buf[13]).toBe(-buf[10]); // right shoulder mirrors y
    const ys: number[] = [];
    for (let t = 0; t < 1; t += 0.05) ys.push(postureFor('happy', t, buf)[10]);
    expect(Math.min(...ys)).toBeLessThan(-5); // shoulders hitch up...
    expect(Math.max(...ys)).toBeCloseTo(0, 5); // ...and come back down: a bounce, not a hold
  });

  it('gain is 0 on lying / crawling clips, softened on clips that act the emotion, in [0,1] everywhere', () => {
    for (const a of ['sleep', 'beEmbalmed', 'bath', 'crawl', 'collapse'] as AnimState[]) expect(postureGain(a)).toBe(0);
    for (const a of ANIM_STATES) {
      expect(postureGain(a)).toBeGreaterThanOrEqual(0);
      expect(postureGain(a)).toBeLessThanOrEqual(1);
    }
    expect(postureGain('walk')).toBe(1);
    expect(postureGain('idle')).toBe(1);
    expect(postureGain('cry')).toBeLessThan(0.5);
  });
});

describe('mood carriage layer on the rig', () => {
  async function twins(anim: AnimState, app: ZombieAppearance = defaultAppearance()) {
    const f = await makeFactory();
    const a = f.create(app, intactLimbs()) as ZombieRigDebug;
    const b = f.create(app, intactLimbs()) as ZombieRigDebug;
    a.setAnim(anim);
    b.setAnim(anim);
    return { f, a, b };
  }

  it('a sad zombie hangs its head lower and further forward than its neutral twin', async () => {
    const { f, a, b } = await twins('idle');
    b.setExpression('sad');
    step(a, 2);
    step(b, 2);
    expect((b.impl as GltfRig).postureWeight('sad')).toBeGreaterThan(0.99);
    const ha = bonePos(a, 'head');
    const hb = bonePos(b, 'head');
    expect(ha.y - hb.y).toBeGreaterThan(0.015);
    expect(hb.z - ha.z).toBeGreaterThan(0.02);
    f.dispose();
  });

  it('is exactly reversible: back to neutral, the pose matches the neutral twin again', async () => {
    const { f, a, b } = await twins('talk');
    b.setExpression('angry');
    step(a, 1);
    step(b, 1);
    b.setExpression('neutral');
    step(a, 3);
    step(b, 3);
    for (const bone of ['head', 'neck', 'chest', 'shoulder_L', 'hand_R']) {
      expect(bonePos(a, bone).distanceTo(bonePos(b, bone)), bone).toBeLessThan(1e-4);
    }
    f.dispose();
  });

  it('never accumulates on a frozen clip (walk at move speed 0) and leaves lying clips alone', async () => {
    const { f, a, b } = await twins('walk');
    b.setExpression('sad');
    step(b, 2.5);
    expect((b.impl as GltfRig).postureWeight('sad')).toBe(1); // settles exactly
    b.setMoveSpeed(0);
    step(b, 0.2);
    const h0 = bonePos(b, 'head');
    step(b, 1);
    expect(bonePos(b, 'head').distanceTo(h0)).toBeLessThan(1e-6);
    a.setAnim('sleep');
    b.setAnim('sleep');
    b.setMoveSpeed(1);
    step(a, 1.5);
    step(b, 1.5);
    expect(bonePos(a, 'head').distanceTo(bonePos(b, 'head'))).toBeLessThan(1e-4);
    f.dispose();
  });

  it('every expression x common clip combination stays finite (no NaN poses)', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    for (const anim of ['idle', 'walk', 'sit', 'sitEat', 'talk', 'cook', 'sitTV', 'phone'] as AnimState[]) {
      rig.setAnim(anim);
      for (const e of EXPRESSIONS) {
        rig.setExpression(e as Expression);
        step(rig, 0.2);
        const top = rig.headTop(new THREE.Vector3());
        expect(Number.isFinite(top.x + top.y + top.z), `${anim}/${e}`).toBe(true);
      }
    }
    f.dispose();
  });
});

describe('per-zombie loop phases and blink seeds', () => {
  const lookA: ZombieAppearance = { ...defaultAppearance(), hairStyle: 'bob', topColor: '#6f8f5e', skinTone: 3 };
  const lookB: ZombieAppearance = { ...defaultAppearance(), hairStyle: 'afro', topColor: '#a5532f', skinTone: 6 };

  it('different zombies start the same loop at different phases; the same look is deterministic', async () => {
    const f = await makeFactory();
    const a = f.create(lookA, intactLimbs()) as ZombieRigDebug;
    const a2 = f.create(lookA, intactLimbs()) as ZombieRigDebug;
    const b = f.create(lookB, intactLimbs()) as ZombieRigDebug;
    for (const r of [a, a2, b]) {
      r.setAnim('walk');
      step(r, 0.5);
    }
    expect(bonePos(a, 'foot_L').distanceTo(bonePos(a2, 'foot_L'))).toBeLessThan(1e-6);
    expect(bonePos(a, 'foot_L').distanceTo(bonePos(b, 'foot_L'))).toBeGreaterThan(0.01);
    f.dispose();
  });

  it('one-shots still start at their first frame for everyone', async () => {
    const f = await makeFactory();
    const a = f.create(lookA, intactLimbs()) as ZombieRigDebug;
    const b = f.create(lookB, intactLimbs()) as ZombieRigDebug;
    for (const r of [a, b]) {
      r.setAnim('yawn');
      step(r, 1.0);
    }
    // same height scale + same clip time -> same arm pose relative to the rig
    expect(bonePos(a, 'hand_R').distanceTo(bonePos(b, 'hand_R'))).toBeLessThan(0.02);
    f.dispose();
  });

  it('rigs created before the GLB loads get their own phases and blink rhythm after the upgrade', async () => {
    let resolve!: (g: GLTF) => void;
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: new Promise<GLTF>((r) => (resolve = r)), warn: quiet });
    const a = f.create(lookA, intactLimbs()) as ZombieRigDebug;
    const b = f.create(lookB, intactLimbs()) as ZombieRigDebug;
    resolve(await loadGltf(true));
    await f.ready;
    expect(a.kind).toBe('gltf');
    for (const r of [a, b]) step(r, 0.5);
    expect(bonePos(a, 'pelvis').distanceTo(bonePos(b, 'pelvis'))).toBeGreaterThan(1e-3);
    const blinkA = (a.impl as unknown as { face: { nextBlinkIn: number } }).face.nextBlinkIn;
    const blinkB = (b.impl as unknown as { face: { nextBlinkIn: number } }).face.nextBlinkIn;
    expect(blinkA).not.toBeCloseTo(blinkB, 3);
    f.dispose();
  });
});
