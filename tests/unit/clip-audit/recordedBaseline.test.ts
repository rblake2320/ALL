import { describe, expect, it } from 'vitest';
import BASELINE from '../../../tools/clip-audit/premiumBaseline.json';
import { allowFor, RECORDED_ALLOW } from '../../../tools/clip-audit/allowlist';
import { GATE_LOOKS, GATE_OPTIONS, GATE_PARTS, gateScenarios, judgeEvaluation } from '../../../tools/clip-audit/gate';
import { lookName, type Evaluation } from '../../../tools/clip-audit/audit';

describe('recorded premium baseline stays narrow', () => {
  it('records the complete frozen coverage and exact numerical caps', () => {
    expect(BASELINE.options).toEqual(GATE_OPTIONS);
    const keys = new Set(GATE_PARTS.flatMap((p) => gateScenarios(p).map((s) => s.key)));
    const looks = new Set(GATE_LOOKS.map(lookName));
    expect(BASELINE.evaluated).toBe(keys.size * looks.size);
    expect(BASELINE.reports).toHaveLength(4);
    expect(BASELINE.rows.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const row of BASELINE.rows) {
      const [, check, key, look, measured, cap] = row;
      expect(keys.has(String(key)), String(key)).toBe(true);
      expect(looks.has(String(look)), String(look)).toBe(true);
      const id = JSON.stringify([check, key, look]);
      expect(seen.has(id), id).toBe(false); seen.add(id);
      expect(cap).toBe(Math.ceil(Number(measured) * 1.1 + 3));
      expect(allowFor(String(check), String(key), String(look))!.maxMm, id).toBe(cap);
    }
  });

  it('a deeper penetration, fresh scenario, different height or representation cannot borrow an exception', () => {
    for (const row of BASELINE.rows) {
      const [, check, key, look, , cap] = row;
      const e: Evaluation = { key: String(key), look: String(look), clip: '', verdict: 'FAIL', times: [0.1],
        checks: [{ name: String(check), value: Number(cap) + 0.1, verdict: 'FAIL', detail: 'boundary control', t: 0.1 }] };
      expect(judgeEvaluation(e).failures, JSON.stringify(row)).toHaveLength(1);
      expect(allowFor(String(check), `${key}:new`, String(look), RECORDED_ALLOW)).toBeNull();
      expect(allowFor(String(check), String(key), `${look},new`, RECORDED_ALLOW)).toBeNull();
    }
    for (const look of GATE_LOOKS.filter((l) => l.body !== 'classic' && l.body !== 'mascot')) {
      for (const key of ['floor:standEat+plate', 'floor:read+book']) {
        expect(allowFor('pen:item-body', key, lookName(look))).toBeNull();
      }
    }
  });
});
