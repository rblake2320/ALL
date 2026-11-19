import { describe, it, expect } from 'vitest';
import { carpoolOffset, nextCarpoolPhase, CarpoolHearse, type CarpoolPhase } from '../../../src/render/world/carpool';
import * as THREE from 'three';
import type { ModelLibrary } from '../../../src/render/contracts';
import { ThrottledWarn } from '../../../src/render/core/diagnostics';

describe('carpool hearse', () => {
  it('motion curve: arrives from upstream, stops at 0, leaves downstream', () => {
    expect(carpoolOffset('arriving', 0)).toBeLessThan(-10);
    expect(carpoolOffset('arriving', 1)).toBeCloseTo(0);
    expect(carpoolOffset('idle', 0.3)).toBe(0);
    expect(carpoolOffset('leaving', 0)).toBe(0);
    expect(carpoolOffset('leaving', 1)).toBeGreaterThan(10);
    // monotonic approach
    let prev = -Infinity;
    for (let s = 0; s <= 1; s += 0.05) {
      const x = carpoolOffset('arriving', s);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
    expect(Number.isFinite(carpoolOffset('arriving', NaN))).toBe(true);
  });

  it('phase machine', () => {
    const seq: [CarpoolPhase, boolean, boolean, CarpoolPhase][] = [
      ['away', false, true, 'away'],
      ['away', true, true, 'arriving'],
      ['arriving', true, false, 'arriving'],
      ['arriving', true, true, 'idle'],
      ['idle', true, false, 'idle'],
      ['idle', false, false, 'leaving'],
      ['leaving', false, false, 'leaving'],
      ['leaving', false, true, 'away'],
      ['arriving', false, false, 'leaving'],
      ['leaving', true, true, 'arriving'],
    ];
    for (const [p, active, done, want] of seq) expect(nextCarpoolPhase(p, active, done)).toBe(want);
  });

  it('drives in, idles at the stop by the entry point, drives off and hides', () => {
    const created: THREE.Object3D[] = [];
    const models = {
      create: () => {
        const o = new THREE.Group();
        created.push(o);
        return o;
      },
      update: () => undefined,
      release: () => undefined,
    } as unknown as ModelLibrary;
    const c = new CarpoolHearse(models, new ThrottledWarn(1e9, () => 0));
    c.update(0.1, 0, false, false, 0.5, 30);
    expect(c.group.visible).toBe(false);
    expect(created.length).toBe(0); // lazily created
    for (let i = 0; i < 80; i++) c.update(0.1, i * 0.1, true, true, 0.5, 30);
    expect(c.state).toBe('idle');
    expect(created[0].position.x).toBeCloseTo(1.5);
    expect(created[0].position.z).toBeGreaterThan(30);
    for (let i = 0; i < 80; i++) c.update(0.1, 8 + i * 0.1, false, true, 0.5, 30);
    expect(c.state).toBe('away');
    expect(c.group.visible).toBe(false);
    c.update(NaN, NaN, true, false, NaN, NaN); // garbage never throws
    c.dispose();
  });
});
