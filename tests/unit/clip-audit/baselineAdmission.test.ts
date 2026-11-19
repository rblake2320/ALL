import { describe, expect, it } from 'vitest';
import { sameDistinctSet, validateRawCoverage } from '../../../tools/clip-audit/baselineAdmission';
import type { Evaluation } from '../../../tools/clip-audit/audit';

const raw: Evaluation = { key: 'floor:walk', look: 'classic@h0.5', clip: 'walk', verdict: 'PASS', times: [0.1, 0.9],
  checks: [{ name: 'pen:floor', value: 0, verdict: 'PASS', detail: '-', t: 0.1 }] };
const report = () => ({ scenarios: [raw.key], looks: [{ body: 'classic', height: 0.5 }], evaluated: 1, failures: [] });
describe('baseline evidence coverage admission', () => {
  it('rejects duplicate identities even when their advertised cardinality matches', () => {
    expect(() => sameDistinctSet(['A', 'A'], ['A', 'B'], 'looks')).toThrow(/duplicate/);
    expect(() => validateRawCoverage({ ...report(), scenarios: [raw.key, raw.key], evaluated: 2 }, [raw, raw], [raw.key, 'floor:read'], [raw.look])).toThrow();
  });
  it('reconciles the exact checks to raw measurements and rejects fabricated failures or missing records', () => {
    expect(() => validateRawCoverage(report(), [raw], [raw.key], [raw.look])).not.toThrow();
    expect(() => validateRawCoverage({ ...report(), failures: [{ key: raw.key, look: raw.look, check: 'pen:floor', measuredMm: 99999 }] }, [raw], [raw.key], [raw.look])).toThrow(/failures/);
    expect(() => validateRawCoverage(report(), [], [raw.key], [raw.look])).toThrow(/coverage/);
    expect(() => validateRawCoverage(report(), [{ ...raw, times: [NaN, 0.9] }], [raw.key], [raw.look])).toThrow(/samples/);
  });
});
