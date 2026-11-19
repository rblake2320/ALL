import { describe, it, expect } from 'vitest';
import { FxSystem } from '../../../src/render/fx/fx';
import { MAX_ANCHORS, DEFAULT_KIND_CAPS } from '../../../src/render/fx/fxPool';
import { FX_KINDS } from '../../../src/sim/contracts';

/** FxSystem without a DOM: inject a stand-in atlas (textures only upload when rendered). */
const fakeAtlas = () => ({ width: 512, height: 256 }) as unknown as HTMLCanvasElement;
const Q = { particleCapacity: 1024, particleScale: 1 };

describe('FxSystem (persistent emitters + instancing)', () => {
  it('bursts write instances; update never exceeds the pool capacity', () => {
    const fx = new FxSystem({ particleCapacity: 200, particleScale: 1 }, fakeAtlas);
    for (let i = 0; i < 50; i++) for (const k of FX_KINDS) fx.burst(k, 5, 0, 5);
    fx.update(1 / 60, 0);
    expect(fx.count()).toBeLessThanOrEqual(200);
    expect(fx.drawnInstances()).toBe(fx.count());
    fx.dispose();
  });

  it('persistent emitters spawn steadily while active and stop when inactive', () => {
    const fx = new FxSystem(Q, fakeAtlas);
    const h = fx.acquire('fireEmbers');
    h.active = true;
    h.x = 3;
    h.y = 0.9;
    h.z = 3;
    for (let i = 0; i < 60; i++) fx.update(1 / 60, i / 60);
    const live = fx.count();
    expect(live).toBeGreaterThan(5);
    expect(live).toBeLessThanOrEqual(DEFAULT_KIND_CAPS.fire);
    h.active = false;
    for (let i = 0; i < 200; i++) fx.update(1 / 30, 1 + i / 30);
    expect(fx.count()).toBe(0);
    fx.release(h);
    expect(fx.emitterCount()).toBe(0);
    fx.dispose();
  });

  it('fly-swarm anchors are recycled on release and their flies removed at once', () => {
    const fx = new FxSystem(Q, fakeAtlas);
    const free0 = fx.freeAnchorCount();
    expect(free0).toBe(MAX_ANCHORS);
    const a = fx.acquire('flySwarm');
    a.active = true;
    a.x = 1;
    a.y = 1.5;
    a.z = 1;
    fx.update(1 / 60, 0);
    expect(fx.count()).toBeGreaterThan(0); // prewarmed swarm
    expect(fx.freeAnchorCount()).toBe(free0 - 1);
    fx.release(a);
    expect(fx.count()).toBe(0);
    expect(fx.freeAnchorCount()).toBe(free0);
    fx.release(a); // double release is a no-op
    expect(fx.freeAnchorCount()).toBe(free0);
    fx.dispose();
  });

  it('more swarms than anchors degrade gracefully (no anchor → static centre)', () => {
    const fx = new FxSystem(Q, fakeAtlas);
    const hs = [];
    for (let i = 0; i < MAX_ANCHORS + 10; i++) {
      const h = fx.acquire('flySwarm');
      h.active = true;
      h.x = i;
      h.y = 1;
      h.z = 0;
      hs.push(h);
    }
    expect(() => {
      for (let i = 0; i < 30; i++) fx.update(1 / 60, i / 60);
    }).not.toThrow();
    expect(fx.count()).toBeLessThanOrEqual(DEFAULT_KIND_CAPS.flies);
    for (const h of hs) fx.release(h);
    expect(fx.freeAnchorCount()).toBe(MAX_ANCHORS);
    fx.dispose();
  });

  it('adversarial: NaN emitter positions, garbage dt, quality reconfigure', () => {
    const fx = new FxSystem(Q, fakeAtlas);
    const h = fx.acquire('stenchWisps');
    h.active = true;
    h.x = NaN;
    h.y = 1;
    h.z = 0;
    fx.update(NaN, NaN);
    fx.update(-1, 0);
    fx.update(1e9, 0);
    expect(fx.count()).toBe(0);
    expect(fx.burst('nope', 0, 0, 0)).toBe(false);
    expect(fx.burst('puff', Infinity, 0, 0)).toBe(false);
    fx.configure({ particleCapacity: 64, particleScale: 0.5 });
    for (const k of FX_KINDS) fx.burst(k, 1, 0, 1);
    fx.update(1 / 60, 0);
    expect(fx.count()).toBeLessThanOrEqual(64);
    fx.setView(NaN, 0);
    fx.setView(32, 720);
    fx.dispose();
  });
});
