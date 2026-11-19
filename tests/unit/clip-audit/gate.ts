/**
 * W-073 clipping CI gate (shared by the gate*.test.ts files, split so vitest runs them in parallel).
 *
 * Every scenario of the audit matrix (every interaction stage × object slot, every social pair, every clip on the
 * floor — tools/clip-audit/scenarios.ts) is evaluated with the real GLBs and the real clips (CPU-skinned at 2 clip
 * times, renderer fits applied) for classic, mascot and all five premium bodies at high and low detail.
 * Dining composites are gated with one table per seat. The wider cast sweep is the audit (`npx vite-node tools/clip-audit/run.ts matrix`, report docs/audits/clipping-W073.md);
 * the gate keeps what it fixed fixed.
 *
 * A penetration check (pen:*) deeper than THRESHOLDS.penFailMm (15 mm) fails the gate unless an ALLOW entry covers
 * it — each entry names the root cause, the owner and the request, and caps the depth it accepts (`maxMm`), so a
 * regression beyond the documented exception still fails.
 */
import type { Scenario } from '../../../tools/clip-audit/scenarios';
import { evaluate, lookName } from '../../../tools/clip-audit/audit';
import { hasAsset } from '../../../tools/clip-audit/assets';
import { allowFor } from '../../../tools/clip-audit/allowlist';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT } from '../../../tools/clip-audit/shots';

import { GATE_LOOKS, GATE_OPTIONS, judgeEvaluation, type GateFailure } from '../../../tools/clip-audit/gate';
export { GATE_LOOKS, gateScenarios, type GateFailure } from '../../../tools/clip-audit/gate';

export const published = hasAsset('models/characters/zombie.glb') && hasAsset('manifest.cast.json') && hasAsset('models/objects/chair_creaky.glb');
/**
 * The full sampled sweep (floor / object slots / social pairs × 12 body representations) is CPU intensive, so it is
 * opt-in: `npm run clip:gate` (CI's e2e-free nightly on Spark2, W-111) sets CLIP_GATE_FULL=1. The fast gates
 * (static footprints, rest/lie slots with no allow-list, CLI exit code, sim-untouched) always run in `npm test`.
 */
export const fullGate = published && process.env.CLIP_GATE_FULL === '1';

export { allowFor };

/** Evaluate scenarios × GATE_LOOKS; returns penetration failures not covered (or exceeding) the allow-list. */
export async function runGate(scenarios: Scenario[]): Promise<{ evaluated: number; failures: GateFailure[]; allowed: GateFailure[] }> {
  const failures: GateFailure[] = [];
  const allowed: GateFailure[] = [];
  let evaluated = 0;
  for (const look of GATE_LOOKS) {
    for (const sc of scenarios) {
      const e = await evaluate(sc, look, GATE_OPTIONS);
      evaluated++;
      // yield so the vitest worker's RPC heartbeat is not starved on a loaded machine
      await new Promise<void>((r) => setImmediate(r));
      const judged = judgeEvaluation(e);
      failures.push(...judged.failures);
      allowed.push(...judged.allowed);
    }
  }
  console.log(`[clip-gate:coverage] looks=${GATE_LOOKS.map(lookName).join(',')} scenarios=${scenarios.length}; carry=${scenarios.filter(s => s.key === 'floor:standEat+plate' || s.key === 'floor:read+book').map(s => s.key).join(',')}`);
  // CLIP_GATE_DUMP=1: write every penetration over the threshold (allowed or not) for allow-list maintenance
  if (process.env.CLIP_GATE_DUMP) {
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(resolve(OUT, `gate-${scenarios[0]?.kind ?? 'none'}-${scenarios.length}.json`), JSON.stringify([...failures, ...allowed], null, 1));
  }
  return { evaluated, failures, allowed };
}

export function describeFailures(fs: GateFailure[]): string {
  return fs.map((f) => `${f.check} ${f.mm} mm  ${f.key}  ${f.look}  (${f.detail})${allowFor(f.check, f.key, f.look) ? ' [allow-listed but deeper than its maxMm]' : ''}`).join('\n');
}
