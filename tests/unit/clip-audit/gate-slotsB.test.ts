/** W-073 clipping gate, part 'slotsB' (see gate.ts): fails on any penetration deeper than 15 mm not covered by allowlist.ts. */
import { describe, expect, it } from 'vitest';
import { describeFailures, fullGate, gateScenarios, runGate } from './gate';

describe.skipIf(!fullGate)('clipping gate: object slots (odd) × classic / mascot / five premium bodies high + low (real GLBs, real clips)', () => {
  it('no interaction penetrates deeper than the threshold outside the allow-list', async () => {
    const sc = gateScenarios('slotsB');
    expect(sc.length).toBeGreaterThan(0);
    const r = await runGate(sc);
    console.log(`[clip-gate:slotsB] ${r.evaluated} evaluations, ${r.allowed.length} allow-listed, ${r.failures.length} failures`);
    expect(r.failures, describeFailures(r.failures)).toEqual([]);
  }, 1800000);
});
