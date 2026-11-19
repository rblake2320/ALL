import { describe, it, expect } from 'vitest';
import { sanitizeAlpha, lerpAngle, interpolateAgentPose, createAgentPose, moveSpeedScale, nominalMoveSpeed, TELEPORT_DISTANCE } from '../../../src/render/agents/interp';
import { angleDelta, wrapAngle } from '../../../src/render/core/math';

describe('alpha sanitising', () => {
  it('clamps and maps NaN to 1', () => {
    expect(sanitizeAlpha(0.3)).toBe(0.3);
    expect(sanitizeAlpha(-2)).toBe(0);
    expect(sanitizeAlpha(7)).toBe(1);
    expect(sanitizeAlpha(NaN)).toBe(1);
    expect(sanitizeAlpha(Infinity)).toBe(1);
    expect(sanitizeAlpha(-Infinity)).toBe(0);
    expect(sanitizeAlpha('0.5')).toBe(1);
    expect(sanitizeAlpha(undefined)).toBe(1);
  });
});

describe('shortest-arc facing', () => {
  it('interpolates across the ±PI seam the short way', () => {
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
    // a quarter of the way moves only 0.05 rad
    expect(Math.abs(angleDelta(a, lerpAngle(a, b, 0.25)))).toBeCloseTo(0.05, 9);
  });

  it('handles unwrapped inputs (multiple turns)', () => {
    expect(lerpAngle(0, 4 * Math.PI + 0.2, 1)).toBeCloseTo(0.2, 9);
    expect(lerpAngle(10 * Math.PI, 10 * Math.PI, 0.5)).toBeCloseTo(0, 9);
  });

  it('endpoints and wrap range', () => {
    for (let i = 0; i < 50; i++) {
      const a = (i * 0.77) % 7 - 3.5;
      const b = (i * 1.31) % 9 - 4.5;
      const r0 = lerpAngle(a, b, 0);
      const r1 = lerpAngle(a, b, 1);
      expect(Math.abs(angleDelta(r0, a))).toBeLessThan(1e-9);
      expect(Math.abs(angleDelta(r1, b))).toBeLessThan(1e-9);
      const m = lerpAngle(a, b, 0.5);
      expect(m).toBeGreaterThanOrEqual(-Math.PI);
      expect(m).toBeLessThan(Math.PI);
      // never travels more than half a turn
      expect(Math.abs(angleDelta(a, m))).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });

  it('garbage angles do not produce NaN', () => {
    expect(lerpAngle(NaN, 1, 0.5)).toBeCloseTo(1);
    expect(lerpAngle(1, NaN, 0.5)).toBeCloseTo(1);
    expect(lerpAngle(NaN, NaN, 0.5)).toBe(0);
    expect(wrapAngle(Infinity)).toBe(0);
  });
});

describe('agent pose interpolation', () => {
  it('lerps prevPos → pos and keeps posY', () => {
    const p = interpolateAgentPose({ x: 1, z: 1 }, { x: 2, z: 3 }, 0, Math.PI / 2, 0.42, 0.5, createAgentPose());
    expect(p.valid).toBe(true);
    expect(p.x).toBeCloseTo(1.5);
    expect(p.z).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(0.42);
    expect(p.facing).toBeCloseTo(Math.PI / 4);
  });

  it('snaps on teleports instead of gliding across the lot', () => {
    const p = interpolateAgentPose({ x: 0, z: 0 }, { x: TELEPORT_DISTANCE + 5, z: 0 }, 0, 0, 0, 0.1, createAgentPose());
    expect(p.x).toBe(TELEPORT_DISTANCE + 5);
  });

  it('missing/NaN prev values fall back to current values', () => {
    const p = interpolateAgentPose(null, { x: 4, z: 5 }, NaN, 1, undefined, 0.5, createAgentPose());
    expect([p.x, p.z, p.y]).toEqual([4, 5, 0]);
    expect(p.facing).toBeCloseTo(1);
    const q = interpolateAgentPose({ x: NaN, z: 2 }, { x: 4, z: 5 }, 0, 'east', 0, 0.5, createAgentPose());
    expect(q.x).toBe(4);
    expect(q.facing).toBe(0);
  });

  it('invalid current position reports valid=false and leaves out untouched', () => {
    const out = createAgentPose();
    out.x = 9;
    const p = interpolateAgentPose({ x: 1, z: 1 }, { x: NaN, z: 1 }, 0, 0, 0, 0.5, out);
    expect(p.valid).toBe(false);
    expect(p.x).toBe(9);
    expect(interpolateAgentPose({ x: 1, z: 1 }, null, 0, 0, 0, 0.5, createAgentPose()).valid).toBe(false);
  });
});

describe('walk-cycle speed scale', () => {
  it('follows the rig convention scale = actualSpeed / 1.3 for every locomotion anim', () => {
    expect(moveSpeedScale('walk', 1.3)).toBeCloseTo(1);
    expect(nominalMoveSpeed('limp')).toBe(1.3);
    expect(moveSpeedScale('limp', 1.3 * 0.6)).toBeCloseTo(0.6); // limping zombies move at 0.6x
    expect(moveSpeedScale('crawl', 1.3 * 0.3)).toBeCloseTo(0.3);
    expect(moveSpeedScale('walk', 3.9)).toBeCloseTo(3); // 3x game speed
  });

  it('non-locomotion anims stay at 1; garbage speeds freeze the cycle; huge speeds are capped', () => {
    expect(moveSpeedScale('sit', 10)).toBe(1);
    expect(moveSpeedScale('walk', 0)).toBe(0);
    expect(moveSpeedScale('walk', NaN)).toBe(0);
    expect(moveSpeedScale('walk', -1)).toBe(0);
    expect(moveSpeedScale('walk', 1e9)).toBe(6);
  });
});
