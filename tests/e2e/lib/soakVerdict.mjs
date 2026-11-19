/**
 * The soak run's verdict as a pure function of its samples (unit-tested in tests/unit/e2e/soakVerdict.test.ts), so
 * the rule that decides "leak" is itself under test and not buried in a 30-minute browser script.
 *
 * Samples are split in four equal parts by index. Q1 is warm-up (asset loading, shader compiles, first purchases)
 * and is ignored. A BOUNDED counter fails when the mean of Q4 exceeds the mean of Q2 by more than BOTH its ratio and
 * its absolute limit. A GROWTH metric may rise with game time but not faster than its cap per game day.
 */

/** Counters that must level off. `ratio` and `abs` must BOTH be exceeded to fail (noise on small numbers passes). */
export const BOUNDED = {
  domNodes: { ratio: 1.25, abs: 400, why: 'DOM nodes held by the page (CDP): detached trees are leaks' },
  listeners: { ratio: 1.25, abs: 150, why: 'JS event listeners (CDP): handlers added and never removed' },
  documents: { ratio: 1.01, abs: 1, why: 'documents / iframes' },
  canvases: { ratio: 1.01, abs: 1, why: 'canvas elements (each owns GPU memory)' },
  geometries: { ratio: 1.3, abs: 60, why: 'WebGL geometries (renderer.info.memory): undisposed meshes' },
  textures: { ratio: 1.3, abs: 20, why: 'WebGL textures: undisposed materials / thumbnails' },
  programs: { ratio: 1.3, abs: 8, why: 'compiled shader programs' },
  drawCalls: { ratio: 1.5, abs: 60, why: 'draw calls per frame for the same house' },
  toasts: { ratio: 2, abs: 20, why: 'the controller caps its toast list at 20' },
  notifications: { ratio: 1.5, abs: 60, why: 'the sim notification log must be capped' },
  txLog: { ratio: 1.5, abs: 60, why: 'the household transaction log must be capped' },
  queueMax: { ratio: 2, abs: 8, why: 'no agent queue grows without bound' },
};

/** Metrics that legitimately grow with game days, with a cap on the rate (per game day, measured Q2 → Q4). */
export const GROWTH = {
  heapBytes: { perDay: 24 * 1048576, why: 'JS heap after a forced GC: > 24 MB per game day is a leak, not history' },
  worldBytes: { perDay: 256 * 1024, why: 'serialised world: > 256 kB per game day means a list in the save is unbounded' },
};

export const MIN_SAMPLES = 8;
/** The sim may not slow below this fraction of its Q2 tick rate at the same speed setting. */
export const MIN_TICK_RATE_RATIO = 0.6;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Index ranges [from, to] (inclusive) of the second and fourth quarter, and how many samples are warm-up. */
export function quarters(samples) {
  const n = samples.length;
  const q = Math.floor(n / 4);
  return { warmupCount: q, q2: [q, 2 * q - 1], q4: [n - q, n - 1] };
}

/**
 * @param {Array<Record<string, any>>} samples in time order; each has the metric fields plus `tick`, `ticksPerSec`,
 *   `faults`, `fatal`, `contextLost`, `lastSaveFailed`
 * @param {{ errors?: string[], saves?: number, saveFailures?: number, actions?: Record<string, number> }} [run]
 * @returns {{ ok: boolean, rows: Array<{ metric: string, q2: number, q4: number, ratio: number, ok: boolean, note: string }>, checks: Array<{ name: string, ok: boolean, detail: string }> }}
 */
export function judge(samples, run = {}) {
  const rows = [];
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  if (!Array.isArray(samples) || samples.length < MIN_SAMPLES) {
    check(`at least ${MIN_SAMPLES} samples`, false, `${Array.isArray(samples) ? samples.length : 0} sample(s): the run is too short to judge`);
    return { ok: false, rows, checks };
  }
  const { q2, q4 } = quarters(samples);
  const part = ([a, b]) => samples.slice(a, b + 1);
  const s2 = part(q2);
  const s4 = part(q4);
  const days = (mean(s4.map((s) => num(s.tick))) - mean(s2.map((s) => num(s.tick)))) / 5760;

  for (const [metric, lim] of Object.entries(BOUNDED)) {
    const a = mean(s2.map((s) => num(s[metric])));
    const b = mean(s4.map((s) => num(s[metric])));
    const ratio = a > 0 ? b / a : b > 0 ? Infinity : 1;
    const ok = !(b - a > lim.abs && ratio > lim.ratio);
    rows.push({ metric, q2: a, q4: b, ratio, ok, note: ok ? '' : `still climbing (+${Math.round(b - a)}, limit +${lim.abs} and ${lim.ratio}×): ${lim.why}` });
  }
  for (const [metric, lim] of Object.entries(GROWTH)) {
    const a = mean(s2.map((s) => num(s[metric])));
    const b = mean(s4.map((s) => num(s[metric])));
    const ratio = a > 0 ? b / a : b > 0 ? Infinity : 1;
    const perDay = days > 0 ? (b - a) / days : b > a ? Infinity : 0;
    const ok = !(perDay > lim.perDay);
    const rate = Number.isFinite(perDay) ? `${Math.round(perDay / 1024) + 0} kB per game day` : 'grew while game time stood still';
    rows.push({ metric, q2: a, q4: b, ratio, ok, note: ok ? rate : `${rate} (limit ${(lim.perDay / 1024).toFixed(0)} kB): ${lim.why}` });
  }

  check('game time advanced between the compared quarters', days > 0, `${days.toFixed(2)} game days`);
  const r2 = mean(s2.map((s) => num(s.ticksPerSec)));
  const r4 = mean(s4.map((s) => num(s.ticksPerSec)));
  check(`the sim did not slow down (last quarter ≥ ${MIN_TICK_RATE_RATIO * 100} % of the second quarter's tick rate)`, r2 > 0 && r4 >= r2 * MIN_TICK_RATE_RATIO, `${r2.toFixed(1)} → ${r4.toFixed(1)} ticks/s`);
  const last = samples[samples.length - 1];
  const faults = Math.max(...samples.map((s) => num(s.faults)));
  check('no sim faults', faults === 0 && samples.every((s) => num(s.faults) >= 0), faults > 0 ? `${faults} contained fault(s) in the engine's fault log` : samples.some((s) => num(s.faults) < 0) ? 'the fault log could not be read' : '');
  // 'gameOver' is a legitimate end of a world (soak.mjs then starts a new game); any other screen means the run fell out of play.
  const off = samples.find((s) => s.fatal || (s.screen !== 'game' && s.screen !== 'gameOver'));
  check('no fatal error, never fell out of play', !off, off ? (off.fatal ? String(off.fatal) : `screen ${off.screen}`) : '');
  check('the WebGL context was never lost', samples.every((s) => !s.contextLost));
  const errors = run.errors ?? [];
  check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const saves = run.saves ?? 0;
  check('every manual save succeeded', saves > 0 && (run.saveFailures ?? 0) === 0 && samples.every((s) => !s.lastSaveFailed), `${saves} save(s), ${run.saveFailures ?? 0} failed`);
  if (run.actions) {
    // The scripted player must really have exercised the churn paths, or a pass means nothing.
    const did = (re) => Object.entries(run.actions).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
    const need = { 'go-here orders': /^goHere$/, purchases: /^buy:/, sales: /^sell$/, 'rooms built': /^room$/, undos: /^undo/ };
    const missing = Object.entries(need).filter(([, re]) => did(re) === 0).map(([k]) => k);
    check('the scripted player exercised orders, buy, sell, build and undo', missing.length === 0, missing.length ? `never happened: ${missing.join(', ')}` : '');
    const errs = did(/^ERR:/);
    check('no player action threw', errs === 0, errs ? `${errs} action(s) threw` : '');
  }
  return { ok: rows.every((r) => r.ok) && checks.every((c) => c.ok), rows, checks };
}
