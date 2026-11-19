/**
 * BALANCE targets (backlog "Balance", decision #13; method + numbers in docs/BALANCE.md, final tuning in docs/GDD.md).
 *
 *   fast subset (always; CI via tests/unit/balance/fast.test.ts):   ≈ 30 game days, ≤ 60 s
 *     A  unattended starter household, 9 days: nobody crumbles, stay-home needs < 15 in < 5 % of on-lot hours,
 *        no non-essential action > 6 runs/zombie/day, no non-sleep interaction > 25 % of waking time,
 *        0 faults, 0 invariant violations (checked hourly)
 *     Cg the same household on grim: measurably harder (lower mean freshness)
 *     B  reasonable player, 12 days: nobody crumbles, the worker's Amusement < 15 in < 5 % of on-lot hours,
 *        0 repo visits / power cuts, funds grow from day 4 on, 0 faults / violations
 *   full sweep (`npm run balance` → BALANCE_FULL=1): every scenario × 5 seeds with the GDD targets, plus a
 *     printed per-run + per-scenario report.
 *
 * Runs are sequential (one world at a time) and yield to the event loop every 2 game hours (vitest heartbeat).
 */
import { describe, expect, it } from 'vitest';
import {
  critShare,
  DEFAULT_SEEDS,
  formatRun,
  formatSummary,
  fundsSlope,
  runScenario,
  SCENARIOS,
  SPAM_LIMIT,
  summarize,
  worstCritShare,
  type RunMetrics,
  type ScenarioSpec,
} from './harness';

const FULL = process.env.BALANCE_FULL === '1';
const FAST_TIMEOUT = 180_000;
const FULL_TIMEOUT = 3_600_000;

function healthy(m: RunMetrics): void {
  expect(m.faults, 'faults').toEqual([]);
  expect(m.violations, 'invariant violations').toEqual([]);
  expect(m.spam, `non-essential actions > ${SPAM_LIMIT}/zombie/day`).toEqual([]);
  // backlog (a 'normal' target): no single non-sleep interaction takes > 25 % of a zombie's on-lot waking time — on
  // grim, faster Amusement decay legitimately means more TV (up to ~34 %)
  if (m.difficulty === 'normal') for (const a of m.agents) expect(a.topAwakeShare, `${a.name}: ${a.topAwakeInteraction}`).toBeLessThan(0.25);
}

const meanPres = (m: RunMetrics): number => {
  const t = m.stayHome.hours + m.workers.hours;
  return t > 0 ? (m.stayHome.sum.preservation + m.workers.sum.preservation) / t : 0;
};

describe('balance — fast subset', () => {
  let normal: RunMetrics | null = null;

  it('A unattended (normal, 9 days): nobody crumbles, stay-home needs rarely critical, no spam, clean', { timeout: FAST_TIMEOUT }, async () => {
    const m = await runScenario(SCENARIOS.A, DEFAULT_SEEDS[1], { days: 9 });
    normal = m;
    healthy(m);
    expect(m.daysSurvived).toBe(9);
    expect(m.firstCrumbleDay).toBeNull();
    expect(worstCritShare(m.stayHome).share, formatRun(m)).toBeLessThan(0.05);
  });

  it('Cg grim is measurably harder than normal (same household, 9 days)', { timeout: FAST_TIMEOUT }, async () => {
    const g = await runScenario(SCENARIOS.Cg, DEFAULT_SEEDS[1], { days: 9 });
    healthy(g);
    expect(normal, 'run the A test first').not.toBeNull();
    // Autonomy compensates (more sprays, more sleep), so grim shows up as lower freshness AND a faster money burn.
    expect(meanPres(g), `grim ${meanPres(g).toFixed(1)} vs normal ${meanPres(normal!).toFixed(1)}`).toBeLessThan(meanPres(normal!));
    expect(g.funds.at(-1)!, 'grim burns money faster').toBeLessThan(normal!.funds.at(-1)! - 100);
  });

  it('B reasonable player (normal, 12 days): nobody crumbles, the worker stays amused, bills paid, funds grow', { timeout: FAST_TIMEOUT }, async () => {
    const m = await runScenario(SCENARIOS.B, DEFAULT_SEEDS[0], { days: 12 });
    healthy(m);
    expect(m.firstCrumbleDay).toBeNull();
    expect(m.workers.hours, 'the worker spends evenings at home').toBeGreaterThan(100);
    expect(critShare(m.workers, 'fun'), formatRun(m)).toBeLessThan(0.05);
    expect(m.bills.repoVisits).toBe(0);
    expect(m.bills.powerCuts).toBe(0);
    expect(fundsSlope(m.funds, 4), formatRun(m)).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────── full sweep ─────────────────────────────────────────

async function sweep(spec: ScenarioSpec): Promise<RunMetrics[]> {
  const runs: RunMetrics[] = [];
  for (const seed of DEFAULT_SEEDS) {
    const m = await runScenario(spec, seed);
    console.log(formatRun(m));
    runs.push(m);
  }
  console.log(formatSummary(summarize(runs)));
  return runs;
}

describe.skipIf(!FULL)('balance — full sweep (BALANCE_FULL=1)', () => {
  const results: Partial<Record<keyof typeof SCENARIOS, RunMetrics[]>> = {};

  it('A unattended: ≥ 10 days in ≥ 4/5 seeds, nobody crumbles before day 8, stay-home needs < 15 in < 5 % of hours', { timeout: FULL_TIMEOUT }, async () => {
    const runs = (results.A = await sweep(SCENARIOS.A));
    const s = summarize(runs);
    expect(s.survived10).toBeGreaterThanOrEqual(4);
    expect(s.noCrumbleBefore8).toBe(runs.length);
    expect(s.stayHomeWorst.share).toBeLessThan(0.05);
    for (const m of runs) healthy(m);
  });

  it('B reasonable player: nobody crumbles in 21 days, worker Amusement < 15 in < 5 %, funds trend up after day 7, no repo', { timeout: FULL_TIMEOUT }, async () => {
    const runs = (results.B = await sweep(SCENARIOS.B));
    const s = summarize(runs);
    expect(s.noCrumble).toBe(runs.length);
    expect(s.workerFun).toBeLessThan(0.05);
    expect(s.fundsSlopeMin).toBeGreaterThan(0);
    expect(s.repoVisits).toBe(0);
    for (const m of runs) healthy(m);
  });

  it('Bc other careers (evening / night / weekend): nobody crumbles, worker Amusement < 15 in < 5 %, no repo', { timeout: FULL_TIMEOUT }, async () => {
    const runs = (results.Bc = await sweep(SCENARIOS.Bc));
    const s = summarize(runs);
    expect(s.noCrumble).toBe(runs.length);
    expect(s.workerFun).toBeLessThan(0.05);
    expect(s.repoVisits).toBe(0);
    for (const m of runs) healthy(m);
  });

  it('D Empty Plot + reasonable player: nobody crumbles in 21 days, no repo', { timeout: FULL_TIMEOUT }, async () => {
    const runs = (results.D = await sweep(SCENARIOS.D));
    const s = summarize(runs);
    expect(s.noCrumble).toBe(runs.length);
    expect(s.workerFun).toBeLessThan(0.05);
    expect(s.repoVisits).toBe(0);
    for (const m of runs) healthy(m);
  });

  it('Cg grim is harder and Cr relaxed is easier than normal (same households)', { timeout: FULL_TIMEOUT }, async () => {
    const grim = (results.Cg = await sweep(SCENARIOS.Cg));
    const relaxed = (results.Cr = await sweep(SCENARIOS.Cr));
    const normal = results.A ?? (results.A = await sweep(SCENARIOS.A));
    const mean = (runs: RunMetrics[]): number => runs.reduce((s, m) => s + meanPres(m), 0) / runs.length;
    const limbs = (runs: RunMetrics[]): number => runs.reduce((s, m) => s + m.limbsLost, 0);
    const endFunds = (runs: RunMetrics[]): number => runs.reduce((s, m) => s + m.funds.at(-1)!, 0) / runs.length;
    console.log(`difficulty: mean freshness grim ${mean(grim).toFixed(1)} / normal ${mean(normal).toFixed(1)} / relaxed ${mean(relaxed).toFixed(1)} · ` +
      `limbs ${limbs(grim)} / ${limbs(normal)} / ${limbs(relaxed)} · day-14 funds ${endFunds(grim).toFixed(0)} / ${endFunds(normal).toFixed(0)} / ${endFunds(relaxed).toFixed(0)}`);
    // Autonomy compensates for faster decay (more sprays and naps), so difficulty shows in freshness, limbs AND money.
    expect(mean(grim)).toBeLessThan(mean(normal) - 1);
    expect(mean(relaxed)).toBeGreaterThan(mean(normal) + 1);
    expect(limbs(grim)).toBeGreaterThan(limbs(normal));
    // normal lost 0 limbs in the post-skeptic sweep (5 seeds × 14 days), so relaxed can only tie it there
    expect(limbs(relaxed)).toBeLessThanOrEqual(limbs(normal));
    expect(endFunds(grim)).toBeLessThan(endFunds(normal) - 200);
    // Since Chill Out (review round 2, BALANCE.md §5.9) low freshness is mended with free coffin time instead of $15
    // sprays, so money separates relaxed from normal less (+$147 in the final sweep): relaxed must still end richer.
    expect(endFunds(relaxed)).toBeGreaterThan(endFunds(normal));
    for (const m of [...grim, ...relaxed]) healthy(m);
  });
});
