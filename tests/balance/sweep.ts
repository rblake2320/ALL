/**
 * CLI sweep (scratch/dev): `npx vite-node tests/balance/sweep.ts -- A,B 11,22 [days]` prints per-run + summary lines.
 * The canonical entry is `npm run balance` (vitest, BALANCE_FULL=1); this is the same harness without vitest.
 */
import { DEFAULT_SEEDS, formatRun, formatSummary, runScenario, SCENARIOS, summarize, type RunMetrics } from './harness';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const scen = (args[0] ?? 'A,B,Cg,Cr,D').split(',') as (keyof typeof SCENARIOS)[];
  const seeds = args[1] ? args[1].split(',').map(Number) : [...DEFAULT_SEEDS];
  const days = args[2] ? Number(args[2]) : undefined;
  for (const s of scen) {
    const runs: RunMetrics[] = [];
    for (const seed of seeds) {
      const m = await runScenario(SCENARIOS[s], seed, { days });
      runs.push(m);
      console.log(formatRun(m));
    }
    console.log(formatSummary(summarize(runs)));
  }
}
void main();
