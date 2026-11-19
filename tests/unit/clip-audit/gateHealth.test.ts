import { describe, expect, it } from 'vitest';
import { judgeEvaluation } from '../../../tools/clip-audit/gate';
import type { Evaluation } from '../../../tools/clip-audit/audit';

describe('sampled gate measurement health', () => {
  it.each([NaN, Infinity, -Infinity])('rejects a nonfinite penetration (%s)', (value) => {
    const e: Evaluation = { key: 'floor:read+book', look: 'waitress@h0.5', clip: 'read', verdict: 'PASS', times: [0.1],
      checks: [{ name: 'pen:item-body', value, verdict: 'PASS', detail: '', t: 0.1 }] };
    expect(judgeEvaluation(e).failures).toHaveLength(1);
  });
  it('rejects an explicit error and an empty evaluation', () => {
    const e: Evaluation = { key: 'floor:read+book', look: 'waitress@h0.5', clip: '', verdict: 'FAIL', times: [], checks: [] };
    expect(judgeEvaluation(e).failures).toHaveLength(1);
    expect(judgeEvaluation({ ...e, times: [0.1], checks: [{ name: 'error', value: 0, verdict: 'FAIL', detail: 'loader failed', t: 0 }] }).failures).toHaveLength(1);
  });
  it('rejects nonfinite sample and check times', () => {
    const e: Evaluation = { key: 'floor:read+book', look: 'waitress@h0.5', clip: 'read', verdict: 'PASS', times: [NaN],
      checks: [{ name: 'pen:item-body', value: 0, verdict: 'PASS', detail: '', t: NaN }] };
    expect(judgeEvaluation(e).failures.length).toBeGreaterThan(0);
  });
});
