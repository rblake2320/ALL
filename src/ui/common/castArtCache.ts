/**
 * Offline-safe cast thumbnails (W-050). Portraits of cast bodies draw public/assets/ui/cast/<id>.webp; a portrait that
 * mounts for the first time while the browser is offline used to request it anyway, which fails with a console error
 * and a failed request. This cache:
 *
 *  - preloads the thumbnails the CURRENT world uses (household + zombies on the lot, see `usedCastBodies`) into
 *    blob: URLs while online, so those portraits never touch the network again;
 *  - answers `castArtHref(id)` with that blob URL, else the network URL while online, else null — the Portrait then
 *    draws its procedural face instead of issuing a request that can only fail.
 *
 * Failures are silent by design (the procedural portrait is the fallback) and counted for diagnostics only.
 */
import { isLocalAssetUrl } from '../../shared/assetOrigin';
import { CAST_BODY_IDS, SCULPTED_BODY_IDS, isCastBodyId, type CastBodyId } from '../../shared/cast';
import { castBodyOf, castThumbUrl } from './castArt';

type Entry = { state: 'loading'; promise: Promise<void> } | { state: 'ready'; href: string } | { state: 'failed' };

const cache = new Map<CastBodyId, Entry>();
let failures = 0;

export interface CastArtEnv {
  online: () => boolean;
  fetchBlob: (url: string) => Promise<Blob>;
  objectUrl: (b: Blob) => string;
}

const defaultEnv = (): CastArtEnv => ({
  // thumbnails served from local files (the desktop app's app:// protocol) need no network and are never gated
  online: () => isLocalAssetUrl(castThumbUrl(CAST_BODY_IDS[0])) || typeof navigator === 'undefined' || navigator.onLine !== false,
  fetchBlob: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  },
  objectUrl: (b) => URL.createObjectURL(b),
});

let env: CastArtEnv | null = null;
const getEnv = (): CastArtEnv => (env ??= defaultEnv());

/** Tests: swap the environment (null = browser defaults) and clear the cache. */
export function setCastArtEnv(e: CastArtEnv | null): void {
  env = e;
  cache.clear();
  failures = 0;
}

/** Where a portrait should load `id` from right now, or null = draw the procedural face (offline, not cached). */
export function castArtHref(id: CastBodyId): string | null {
  const e = cache.get(id);
  if (e?.state === 'ready') return e.href;
  return getEnv().online() ? castThumbUrl(id) : null;
}

/** Cache `ids` as blob URLs (online only; never rejects). Resolves when every requested id settled. */
export function preloadCastArt(ids: Iterable<unknown>): Promise<void> {
  const ev = getEnv();
  const jobs: Promise<void>[] = [];
  for (const raw of ids) {
    if (!isCastBodyId(raw)) continue;
    const id = raw;
    const have = cache.get(id);
    if (have?.state === 'ready') continue;
    if (have?.state === 'loading') {
      jobs.push(have.promise);
      continue;
    }
    if (!ev.online()) continue; // offline: nothing to gain, and the request could only fail
    const promise = (async () => {
      try {
        const blob = await ev.fetchBlob(castThumbUrl(id));
        cache.set(id, { state: 'ready', href: ev.objectUrl(blob) });
      } catch {
        failures++;
        // offline mid-download: forget it (retry later); a real failure is remembered so it is not refetched
        cache.set(id, { state: 'failed' });
        if (!ev.online()) cache.delete(id);
      }
    })();
    cache.set(id, { state: 'loading', promise });
    jobs.push(promise);
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Cast bodies used by a set of appearances (household + zombies on the lot), deduplicated, in catalogue order. */
export function usedCastBodies(appearances: Iterable<unknown>): CastBodyId[] {
  const set = new Set<CastBodyId>();
  for (const a of appearances) {
    const b = castBodyOf(a && typeof a === 'object' ? (a as object) : null);
    if (b) set.add(b);
  }
  return SCULPTED_BODY_IDS.filter((id) => set.has(id));
}

/** Diagnostics: cache state for the report. */
export function castArtStats(): { ready: number; loading: number; failed: number; failures: number } {
  let ready = 0;
  let loading = 0;
  let failed = 0;
  for (const e of cache.values()) {
    if (e.state === 'ready') ready++;
    else if (e.state === 'loading') loading++;
    else failed++;
  }
  return { ready, loading, failed, failures };
}
