import { describe, expect, it } from 'vitest';
import { previewFraming } from '../../../src/render/thumbs/previewStage';
import { defaultAppearance } from '../../../src/shared/appearance';

describe('CAZ preview framing for cast bodies', () => {
  it('keeps the classic framing for classic zombies and normal-height cast bodies', () => {
    const base = previewFraming(defaultAppearance());
    expect(base).toEqual({ y: 1.45, z: 4.3, lookY: 0.95 });
    expect(previewFraming({ ...defaultAppearance(), height: 1 })).toEqual(base);
    expect(previewFraming({ ...defaultAppearance(), body: 'walker' })).toEqual(base);
  });
  it('pulls back / raises for tall bosses so the head stays in frame; total on garbage', () => {
    const boss = previewFraming({ ...defaultAppearance(), body: 'boss', height: 1 });
    expect(boss.z).toBeGreaterThan(4.3);
    expect(boss.lookY).toBeGreaterThan(0.95);
    // top of the figure (plinth + 2.0 m x 1.06 + clearance) inside the vertical half-FOV
    const top = 0.2 + 2.0 * 1.06;
    const ang = Math.atan2(top - boss.y, boss.z) - Math.atan2(boss.lookY - boss.y, boss.z);
    expect(ang).toBeLessThan((14 * Math.PI) / 180);
    for (const j of [null, undefined, 7, 'x', { body: 'nope', height: NaN }]) {
      const f = previewFraming(j);
      expect(Number.isFinite(f.z + f.y + f.lookY)).toBe(true);
    }
  });
});
