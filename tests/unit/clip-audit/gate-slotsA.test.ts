/** W-073 clipping gate, part 'slotsA' (see gate.ts): fails on any penetration deeper than 15 mm not covered by allowlist.ts. */
import { describe, expect, it } from 'vitest';
import { describeFailures, fullGate, gateScenarios, runGate } from './gate';

describe.skipIf(!fullGate)('clipping gate: object slots (even) × classic / mascot / five premium bodies high + low (real GLBs, real clips)', () => {
  it('no interaction penetrates deeper than the threshold outside the allow-list', async () => {
    const sc = gateScenarios('slotsA');
    expect(sc.length).toBeGreaterThan(0);
    const r = await runGate(sc);
    console.log(`[clip-gate:slotsA] ${r.evaluated} evaluations, ${r.allowed.length} allow-listed, ${r.failures.length} failures`);
    expect(r.failures, describeFailures(r.failures)).toEqual([]);
  }, 1800000);
});
