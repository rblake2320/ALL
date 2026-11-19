import { describe, expect, it } from 'vitest';
import BASELINE from '../../../tools/clip-audit/pickupRiseBaseline.json';
import { PICKUP_RISE_TIMES, pickupCarries, pickupRise } from '../../../tools/clip-audit/pickupRise';
import { GATE_LOOKS } from '../../../tools/clip-audit/gate';
import { lookName } from '../../../tools/clip-audit/audit';
import { fullGate } from './gate';

describe('pickup rise phase (Opus2 temporal finding)', () => {
  it('records every current pickup carry and all 12 looks at 60 Hz over the missed window', () => {
    expect(BASELINE.times).toEqual(PICKUP_RISE_TIMES);
    expect(PICKUP_RISE_TIMES).toHaveLength(13);
    expect(PICKUP_RISE_TIMES[0]).toBe(0.65);
    expect(PICKUP_RISE_TIMES[12]).toBe(0.85);
    const ids = GATE_LOOKS.flatMap((l) => pickupCarries().map((c) => `${lookName(l)}|${c}`)).sort();
    expect(BASELINE.rows.map((r) => `${r.look}|${r.carry}`).sort()).toEqual(ids);
    for (const r of BASELINE.rows) {
      expect(r.samples).toBe(13);
      expect(Number.isFinite(r.mm)).toBe(true);
      expect(r.maxMm).toBe(r.mm > 15 ? Math.ceil(r.mm * 1.1 + 3) : 15);
    }
  });

  it.skipIf(!fullGate)('keeps each measured rise depth within its own cap, independent of the early pickup exception', async () => {
    const rows = await pickupRise();
    expect(rows.map((r) => `${r.look}|${r.carry}`).sort()).toEqual(BASELINE.rows.map((r) => `${r.look}|${r.carry}`).sort());
    const failures = rows.filter((r) => r.mm > BASELINE.rows.find((b) => b.look === r.look && b.carry === r.carry)!.maxMm);
    console.log(`[pickup-rise] ${rows.length} body/item cases, ${rows.reduce((n, r) => n + r.samples, 0)} poses at 60 Hz, ${failures.length} regressions`);
    expect(failures).toEqual([]);
  }, 600_000);
});
