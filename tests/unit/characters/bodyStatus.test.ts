/**
 * W-130: Create-a-Zombie must never show Classic for a chosen cast body without saying why. The factory answers
 * bodyStatus(body); the game's guarded preview passes it through behind a fault barrier. Cases:
 *  1. classic is always 'ready'; a loaded cast body is 'ready';
 *  2. while the GLB is being fetched: 'loading'; once it lands: 'ready';
 *  3. offline and not cached: 'offline' (no request made); back online and loaded: 'ready';
 *  4. a GLB that fails to load: 'unavailable' (and stays so — no retry loop);
 *  5. adversarial: the guarded preview returns 'ready' (never throws into the UI) when the stage's bodyStatus throws,
 *     and after dispose.
 */
import { describe, expect, it } from 'vitest';
import { defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import type { ZombieAppearance } from '../../../src/shared/appearance';
import { createCharacterFactory } from '../../../src/render/characters/index';
import { guardedPreview } from '../../../src/game/cazFlow';
import type { PreviewStage } from '../../../src/render/contracts';
import { castGltf } from './castFixture';
import { loadGltf } from './helpers';

const look = (body: string): ZombieAppearance => ({ ...defaultAppearance(), body } as ZombieAppearance);

function setup(mode: 'ok' | 'fail' | 'slow' = 'ok') {
  const net = { online: true };
  let release: (() => void) | null = null;
  let fire: (() => void) | null = null;
  const f = createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGltf(),
    warn: () => {},
    online: () => net.online,
    onOnline: (fn) => {
      fire = fn;
      return () => void (fire = null);
    },
    loadCast: async () => {
      if (mode === 'fail') throw new Error('404');
      if (mode === 'slow') await new Promise<void>((r) => (release = r));
      return castGltf({});
    },
    loadCastManifest: async () => ({ version: 1, bodies: [{ id: 'walker' }, { id: 'sneezer' }] }),
  });
  return { f, net, started: () => release !== null, release: () => release?.(), goOnline: () => ((net.online = true), fire?.()) };
}

describe('W-130 cast body status for the CAZ preview', () => {
  it('classic is always ready; a loaded cast body is ready', async () => {
    const h = setup();
    await h.f.ready;
    expect(h.f.bodyStatus('classic')).toBe('ready');
    h.f.create(look('sneezer'), intactLimbs());
    await h.f.castSettled();
    expect(h.f.bodyStatus('sneezer')).toBe('ready');
  });

  it('loading while the GLB downloads, ready once it lands', async () => {
    const h = setup('slow');
    await h.f.ready;
    h.f.create(look('sneezer'), intactLimbs());
    // the manifest loads first; wait until the GLB fetch itself has started
    for (let i = 0; i < 200 && !h.started(); i++) await new Promise((r) => setTimeout(r, 1));
    expect(h.started()).toBe(true);
    expect(h.f.bodyStatus('sneezer')).toBe('loading');
    h.release();
    await h.f.castSettled();
    expect(h.f.bodyStatus('sneezer')).toBe('ready');
  });

  it('offline and not cached: offline (nothing fetched); back online: ready', async () => {
    const h = setup();
    await h.f.ready;
    h.net.online = false;
    h.f.create(look('sneezer'), intactLimbs());
    await h.f.castSettled();
    expect(h.f.bodyStatus('sneezer')).toBe('offline');
    h.goOnline();
    await h.f.castSettled();
    expect(h.f.bodyStatus('sneezer')).toBe('ready');
  });

  it('a GLB that fails: unavailable, and it stays unavailable', async () => {
    const h = setup('fail');
    await h.f.ready;
    h.f.create(look('sneezer'), intactLimbs());
    await h.f.castSettled();
    expect(h.f.bodyStatus('sneezer')).toBe('unavailable');
    await h.f.castSettled();
    expect(h.f.bodyStatus('sneezer')).toBe('unavailable');
  });
});

describe('W-130 guarded preview bodyStatus (fault barrier)', () => {
  const stage = (impl: Partial<PreviewStage>): PreviewStage => ({
    setAppearance() {}, setLimbs() {}, setAnim() {}, setExpression() {}, setYaw() {}, resize() {}, dispose() {}, ...impl,
  });

  it('passes the stage status through', () => {
    const g = guardedPreview(stage({ bodyStatus: () => 'offline' }), () => {}, () => {});
    expect(g.bodyStatus?.()).toBe('offline');
  });

  it('a throwing stage reports the fault and answers ready (the UI never breaks)', () => {
    const faults: string[] = [];
    const g = guardedPreview(stage({ bodyStatus: () => { throw new Error('boom'); } }), (w) => faults.push(w), () => {});
    expect(g.bodyStatus?.()).toBe('ready');
    expect(faults).toEqual(['preview.bodyStatus']);
  });

  it('a stage without bodyStatus, and any stage after dispose, answer ready', () => {
    expect(guardedPreview(stage({}), () => {}, () => {}).bodyStatus?.()).toBe('ready');
    const g = guardedPreview(stage({ bodyStatus: () => 'loading' }), () => {}, () => {});
    g.dispose();
    expect(g.bodyStatus?.()).toBe('ready');
  });
});
