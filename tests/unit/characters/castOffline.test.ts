/**
 * W-050 offline play: a cast body that is not loaded yet is never fetched while the browser is offline (that request
 * could only fail — a console error + failed request in the e2e offline step). The zombie keeps the classic body, no
 * warning is logged, and the swap happens once the 'online' event fires. A download cut by the connection dropping
 * is forgotten (retried later) instead of marking the body failed for the session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import type { ZombieAppearance } from '../../../src/shared/appearance';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import { APP_ENTRY_URL } from '../../../electron/appProtocol';
import { castGltf } from './castFixture';
import { loadGltf } from './helpers';

const look = (body: string): ZombieAppearance => ({ ...defaultAppearance(), body } as ZombieAppearance);

function setup(opts: { failWhileOffline?: boolean } = {}) {
  const net = { online: true };
  const urls: string[] = [];
  const warnings: string[] = [];
  let fire: (() => void) | null = null;
  const f = createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGltf(),
    warn: (m) => warnings.push(m),
    online: () => net.online,
    onOnline: (fn) => {
      fire = fn;
      return () => {
        if (fire === fn) fire = null;
      };
    },
    loadCast: async (url) => {
      urls.push(url);
      if (opts.failWhileOffline) {
        net.online = false;
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      }
      return castGltf({});
    },
    loadCastManifest: async () => ({ version: 1, bodies: [{ id: 'walker' }, { id: 'sneezer' }] }),
  });
  return { f, net, urls, warnings, goOnline: () => {
    net.online = true;
    fire?.();
  }, hasListener: () => fire !== null };
}

describe('cast bodies while offline (W-050)', () => {
  it('offline: no request, no warning, classic body; swaps in when the network returns', async () => {
    const h = setup();
    await h.f.ready;
    h.net.online = false;
    const r = h.f.create(look('sneezer'), intactLimbs()) as ZombieRigDebug;
    await h.f.castSettled();
    expect(h.urls).toEqual([]);
    expect(h.warnings).toEqual([]);
    expect(r.body).toBe('classic');
    expect(r.wantedBody).toBe('sneezer');
    expect(h.hasListener()).toBe(true);
    h.goOnline();
    await h.f.castSettled();
    expect(h.urls).toHaveLength(1);
    expect(r.body).toBe('sneezer');
    expect(r.kind).toBe('cast');
    expect(h.hasListener()).toBe(false);
  });

  it('online: loads normally (the guard is a no-op)', async () => {
    const h = setup();
    const r = h.f.create(look('walker'), intactLimbs()) as ZombieRigDebug;
    await h.f.ready;
    await h.f.castSettled();
    expect(r.body).toBe('walker');
    expect(h.hasListener()).toBe(false);
  });

  it('a download cut by going offline is not marked failed and is retried when back online', async () => {
    const h = setup({ failWhileOffline: true });
    const r = h.f.create(look('walker'), intactLimbs()) as ZombieRigDebug;
    await h.f.ready;
    await h.f.castSettled();
    expect(h.warnings).toEqual([]);
    expect(h.f.castStats().failed).toEqual([]);
    expect(r.body).toBe('classic');
    expect(h.hasListener()).toBe(true);
  });

  it('dispose removes the pending online listener', async () => {
    const h = setup();
    await h.f.ready;
    h.net.online = false;
    h.f.create(look('sneezer'), intactLimbs());
    expect(h.hasListener()).toBe(true);
    h.f.dispose();
    expect(h.hasListener()).toBe(false);
  });
});

/**
 * The installed desktop app serves its GLBs from local files (electron/appProtocol.ts: app://game/<path> -> dist/),
 * so a computer with no network must still get its cast bodies. The factory is built the way src/main.tsx builds it:
 * no `online` / `onOnline` injected, vite's relative asset base. Only the page the base resolves against differs.
 */
describe('cast bodies when the computer is offline: decided by where the assets are served from', () => {
  afterEach(() => vi.unstubAllGlobals());

  function shipped(pageUrl: string) {
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'test' }); // (three's GLTF parser, used by castGltf, reads userAgent)
    vi.stubGlobal('location', { href: pageUrl });
    const urls: string[] = [];
    const warnings: string[] = [];
    const f = createCharacterFactory({
      baseUrl: './assets/',
      gltf: loadGltf(),
      warn: (m) => warnings.push(m),
      loadCast: async (url) => {
        urls.push(url);
        return castGltf({});
      },
      loadCastManifest: async () => ({ version: 1, bodies: [{ id: 'walker' }, { id: 'sneezer' }] }),
    });
    return { f, urls, warnings };
  }

  it('desktop app (app://): the body is a local file, so it loads and is never reported as needing a connection', async () => {
    const h = shipped(APP_ENTRY_URL);
    await h.f.ready;
    const r = h.f.create(look('sneezer'), intactLimbs()) as ZombieRigDebug;
    expect(h.f.bodyStatus('sneezer')).not.toBe('offline');
    await h.f.castSettled();
    expect(h.urls).toHaveLength(1);
    expect(h.warnings).toEqual([]);
    expect(r.body).toBe('sneezer');
    expect(r.kind).toBe('cast');
    expect(h.f.bodyStatus('sneezer')).toBe('ready');
  });

  it('web build (https://): an offline browser still defers the download (W-050 unchanged)', async () => {
    const h = shipped('https://play.example/afterlife/index.html');
    await h.f.ready;
    const r = h.f.create(look('sneezer'), intactLimbs()) as ZombieRigDebug;
    await h.f.castSettled();
    expect(h.urls).toEqual([]);
    expect(h.warnings).toEqual([]);
    expect(r.body).toBe('classic');
    expect(h.f.bodyStatus('sneezer')).toBe('offline');
  });
});
