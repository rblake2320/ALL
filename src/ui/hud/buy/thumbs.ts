/**
 * Catalog thumbnails via game.renderer.thumbnail(defId, tint) — cached per (def, tint), at most 3 renders in
 * flight so opening the catalog never stalls a frame. A failure (model still loading, a context hiccup) is
 * remembered for RETRY_MS only: the next catalog visit after that tries again instead of showing the fallback
 * glyph for the rest of the session.
 */
import type { GameController } from '../../../game/contracts';

export const THUMB_RETRY_MS = 15_000;
const cache = new Map<string, string>();
/** key → time of the last failure (performance.now / Date.now ms). */
const failed = new Map<string, number>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Whether a failure recorded at `at` still blocks a retry at `now`. */
export function failureBlocks(at: number | undefined, now: number, retryMs = THUMB_RETRY_MS): boolean {
  if (at === undefined || !Number.isFinite(at)) return false;
  if (!Number.isFinite(now)) return true;
  const window = Number.isFinite(retryMs) && retryMs > 0 ? retryMs : THUMB_RETRY_MS;
  return now - at >= 0 && now - at < window;
}
const pending = new Map<string, Promise<string>>();
const queue: (() => void)[] = [];
let active = 0;
const MAX_ACTIVE = 3;

function pump() {
  while (active < MAX_ACTIVE && queue.length > 0) {
    const next = queue.shift()!;
    active++;
    next();
  }
}

function schedule(run: () => Promise<string>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    queue.push(() => {
      let p: Promise<string>;
      try {
        p = Promise.resolve(run());
      } catch (err) {
        p = Promise.reject(err);
      }
      p.then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    });
    pump();
  });
}

export function thumbKey(defId: string, tint: string | null | undefined): string {
  return `${defId}|${tint ?? ''}`;
}

export function cachedThumb(defId: string, tint?: string | null): string | null {
  return cache.get(thumbKey(defId, tint)) ?? null;
}

export function thumbFailed(defId: string, tint?: string | null): boolean {
  return failureBlocks(failed.get(thumbKey(defId, tint)), nowMs());
}

export function loadThumb(game: GameController, defId: string, tint?: string | null): Promise<string> {
  const key = thumbKey(defId, tint);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  if (failureBlocks(failed.get(key), nowMs())) return Promise.reject(new Error('thumbnail failed recently'));
  const p = schedule(() => game.renderer.thumbnail(defId, tint ?? null)).then(
    (url) => {
      pending.delete(key);
      if (typeof url !== 'string' || url.length === 0) {
        failed.set(key, nowMs());
        throw new Error('empty thumbnail');
      }
      failed.delete(key);
      cache.set(key, url);
      return url;
    },
    (err) => {
      pending.delete(key);
      failed.set(key, nowMs());
      throw err;
    },
  );
  pending.set(key, p);
  return p;
}

/** Test/dev hook. */
export function _resetThumbs(): void {
  cache.clear();
  failed.clear();
  pending.clear();
}
