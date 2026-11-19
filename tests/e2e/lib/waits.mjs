/**
 * Waits keyed to GAME PROGRESS instead of wall-clock time (W-115).
 *
 * Why: headless Chromium renders WebGL with SwiftShader (software). On a loaded 4-core CI runner one game frame takes
 * 2–10 s, and the first frame that uses a new material / tool / ghost (shader compilation) can block the page for
 * 20 s or more. While the page's main thread is inside such a frame it processes no input and answers no evaluate,
 * so a fixed `timeout: 15_000` expired although the game had rendered fewer than two frames since the key / click —
 * the input was not dropped, it simply had not been processed yet (the failure screenshots, taken seconds later,
 * show the state the wait asked for). Those timeouts were reported as "timed out waiting for …" on random steps.
 *
 * A frame-budgeted wait fails only when BOTH hold:
 *   - at least `minMs` of wall-clock time passed (fast machines keep the old latency budget), and
 *   - the game rendered at least `minFrames` frames since the wait started (the game had a fair chance to react),
 * or when the hard cap `capMs` passed (a hung page still fails, never hangs CI). The frame count comes from the
 * renderer's own counter (`renderer.stats().frames`, a test hook), so "the game had N frames" is game state, not a
 * guess about how slow the machine is.
 */

/** Default number of rendered frames a state change may take before a wait fails (see waitFor below). */
export const MIN_FRAMES = 12;
/** Hard cap for any single frame-budgeted wait (a page that renders nothing for this long is hung). */
export const CAP_MS = 8 * 60_000;

/**
 * Pure decision (unit-tested): may a frame-budgeted wait give up now?
 * @param {{ elapsedMs: number, frames: number, minMs: number, minFrames: number, capMs: number }} s
 */
export function budgetExpired({ elapsedMs, frames, minMs, minFrames, capMs }) {
  if (elapsedMs >= capMs) return true;
  return elapsedMs >= minMs && frames >= minFrames;
}

/** In page: the renderer's frame counter and the state of the things picking depends on. */
export function renderProgress() {
  const g = window.__afterlife && window.__afterlife.game;
  if (!g || !g.renderer || typeof g.renderer.stats !== 'function') return { frames: 0, lastFrameMs: 0, wallsSettled: true, programs: 0, progress: 0 };
  const s = g.renderer.stats();
  return { frames: s.frames ?? 0, lastFrameMs: Math.round(s.lastFrameMs ?? 0), wallsSettled: s.wallsSettled !== false, programs: s.programs ?? 0, progress: g.renderer.loadProgress() };
}

/**
 * Wait until `fn(arg)` is true in the page, budgeted in rendered frames (see the module comment).
 * Returns normally on success; throws an Error whose message carries the frame evidence on failure.
 * @param {import('playwright').Page} page
 * @param {string} what label for the error
 * @param {Function} fn in-page predicate
 * @param {unknown} arg
 * `log`: called when the wait succeeded only AFTER `minMs` (the old fixed timeout would have failed it) — evidence.
 * @param {{ minMs?: number, minFrames?: number, capMs?: number, describe?: () => Promise<unknown>, log?: (s: string) => void }} [o]
 */
export async function waitFor(page, what, fn, arg, { minMs = 15_000, minFrames = MIN_FRAMES, capMs = CAP_MS, describe, log } = {}) {
  const t0 = Date.now();
  const p0 = await page.evaluate(renderProgress);
  let p = p0;
  let lastFrameMax = 0;
  for (;;) {
    const left = Math.max(1_000, minMs - (Date.now() - t0));
    const ok = await page
      .waitForFunction(fn, arg, { polling: 100, timeout: Math.min(left, 30_000) })
      .then(
        () => true,
        () => false,
      );
    if (ok) {
      const ms = Date.now() - t0;
      if (log && ms > minMs) {
        const pe = await page.evaluate(renderProgress).catch(() => p);
        log(`    (slow wait: ${what} took ${(ms / 1000).toFixed(1)} s / ${pe.frames - p0.frames} rendered frames — over the old fixed ${(minMs / 1000).toFixed(0)} s timeout)`);
      }
      return { ms, frames: p.frames - p0.frames };
    }
    p = await page.evaluate(renderProgress).catch(() => p);
    lastFrameMax = Math.max(lastFrameMax, p.lastFrameMs);
    const frames = p.frames - p0.frames;
    const elapsedMs = Date.now() - t0;
    if (budgetExpired({ elapsedMs, frames, minMs, minFrames, capMs })) {
      const s = describe ? await describe().catch(() => null) : null;
      throw new Error(
        `timed out waiting for ${what} after ${(elapsedMs / 1000).toFixed(1)} s and ${frames} rendered frame(s) ` +
          `(budget: ≥${(minMs / 1000).toFixed(0)} s and ≥${minFrames} frames; slowest sampled frame ${lastFrameMax} ms); ${JSON.stringify(s)}`,
      );
    }
  }
}

/** Wait until the renderer has drawn `n` more frames (state changes are visible to picking after a drawn frame). */
export async function waitFrames(page, n = 2, capMs = CAP_MS) {
  const f0 = (await page.evaluate(renderProgress)).frames;
  await page.waitForFunction(
    ({ f, n: k }) => {
      const g = window.__afterlife && window.__afterlife.game;
      return !g || !g.renderer || typeof g.renderer.stats !== 'function' || (g.renderer.stats().frames ?? 0) >= f + k;
    },
    { f: f0, n },
    { polling: 50, timeout: capMs },
  );
}

/**
 * Shader / asset warm-up settled: assets fully loaded, walls not animating, and no new shader program was compiled
 * during the last `stableFrames` rendered frames. Returns { frames, programs, ms } once settled.
 */
export async function waitRenderSettled(page, { stableFrames = 4, capMs = CAP_MS } = {}) {
  const t0 = Date.now();
  let last = await page.evaluate(renderProgress);
  let stable = 0;
  while (Date.now() - t0 < capMs) {
    await waitFrames(page, 1, capMs);
    const p = await page.evaluate(renderProgress);
    stable = p.programs === last.programs && p.progress >= 1 && p.wallsSettled ? stable + 1 : 0;
    last = p;
    if (stable >= stableFrames) return { frames: p.frames, programs: p.programs, ms: Date.now() - t0, lastFrameMs: p.lastFrameMs };
  }
  throw new Error(`render did not settle within ${(capMs / 1000).toFixed(0)} s: ${JSON.stringify(last)}`);
}
