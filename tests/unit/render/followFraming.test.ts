/**
 * Sol P2 (S5 camera follow): a followed / recentred zombie must not sit behind a HUD panel. At 844×390 landscape the
 * agent panel (x 80–420, y 155–382, measured by Sol on d981020) covered 784 px² of the 0.6-tile × 1.6 m body box.
 *
 * The camera rig + follow offset run here exactly as the renderer runs them (recentre = focus(actor + offset),
 * follow = update(dt, actor + offset) each frame, re-solved on resize). HUD rects are fixtures per viewport: the
 * 844×390 agent panel is Sol's measurement; the others follow the HUD layout at those sizes ([data-hud-region]
 * panels: top bar, household bar, agent panel, phone queue slot).
 */
import { describe, it, expect } from 'vitest';
import { CameraRig } from '../../../src/render/camera/cameraRig';
import { actorHudOverlap, actorScreenBox, followFrameOffset } from '../../../src/render/camera/followFraming';
import type { FrameRect } from '../../../src/shared/framing';

const HUD: Record<string, FrameRect[]> = {
  '844x390': [
    { x: 0, y: 0, w: 844, h: 44 }, // top bar
    { x: 80, y: 155, w: 340, h: 227 }, // agent panel (Sol's measured rect)
    { x: 8, y: 52, w: 64, h: 330 }, // household bar
  ],
  '390x844': [
    { x: 0, y: 0, w: 390, h: 56 },
    { x: 0, y: 528, w: 390, h: 72 }, // phone queue slot
    { x: 0, y: 600, w: 390, h: 244 }, // agent panel
  ],
  '360x640': [
    { x: 0, y: 0, w: 360, h: 52 },
    { x: 0, y: 378, w: 360, h: 72 },
    { x: 0, y: 450, w: 360, h: 190 },
  ],
  '1280x720': [
    { x: 0, y: 0, w: 1280, h: 48 },
    { x: 8, y: 56, w: 64, h: 300 },
    { x: 16, y: 470, w: 380, h: 242 },
    { x: 400, y: 630, w: 480, h: 80 },
  ],
};

function vp(key: string) {
  const [w, h] = key.split('x').map(Number);
  return { w, h };
}

/** What the renderer does: offset per pose / viewport / HUD, recentre, then follow frames. */
function run(rig: CameraRig, key: string, actor: { x: number; z: number }, frames: number, walk: number) {
  const v = vp(key);
  rig.setAspect(v.w / v.h);
  const off = followFrameOffset(rig, v, HUD[key]);
  expect(off).not.toBeNull();
  return { off: off!, v };
}

describe('HUD-aware follow framing (Sol P2)', () => {
  for (const key of Object.keys(HUD)) {
    it(`${key}: the body box clears every HUD rect after recentre, after 60 follow frames and after a resize`, () => {
      const rig = new CameraRig();
      rig.setPanRect({ x0: -200, z0: -200, x1: 200, z1: 200 });
      // the angle the game opens at (W-116 home framing)
      rig.setState({ yaw: Math.PI / 4, pitch: 0.8, distance: 27 }, true);
      const actor = { x: 15, z: 15 };
      const { off, v } = run(rig, key, actor, 0, 0);
      // legacy: centring the actor
      rig.focus(actor.x, actor.z, true);
      const centred = actorHudOverlap(rig, v, actor.x, actor.z, HUD[key]);
      // recentre (snap, as with Reduce motion)
      rig.focus(actor.x + off.x, actor.z + off.z, true);
      expect(actorHudOverlap(rig, v, actor.x, actor.z, HUD[key])).toBe(0);
      const b = actorScreenBox(rig, v, actor.x, actor.z)!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(v.h);
      // 60 follow frames, walking east at 1× (1.3 tiles / real s)
      for (let i = 0; i < 60; i++) {
        actor.x += 1.3 / 60;
        rig.update(1 / 60, { x: actor.x + off.x, z: actor.z + off.z });
      }
      expect(actorHudOverlap(rig, v, actor.x, actor.z, HUD[key])).toBe(0);
      // resize: the other orientation of the same device (or desktop ↔ landscape), re-solved like the renderer does
      const other = key === '844x390' ? '390x844' : key === '390x844' ? '844x390' : key === '360x640' ? '844x390' : '360x640';
      const r2 = run(rig, other, actor, 0, 0);
      for (let i = 0; i < 60; i++) rig.update(1 / 60, { x: actor.x + r2.off.x, z: actor.z + r2.off.z });
      expect(actorHudOverlap(rig, r2.v, actor.x, actor.z, HUD[other])).toBe(0);
      if (key === '844x390') expect(centred).toBeGreaterThan(0); // the reported defect, reproduced without the offset
    });
  }

  it('nothing in the way: the offset is zero (the actor stays centred); garbage viewports give null', () => {
    const rig = new CameraRig();
    rig.setAspect(1280 / 720);
    expect(followFrameOffset(rig, { w: 1280, h: 720 }, [])).toEqual({ x: 0, z: 0, overlap: 0 });
    expect(followFrameOffset(rig, { w: 0, h: NaN }, [])).toBeNull();
  });
});
