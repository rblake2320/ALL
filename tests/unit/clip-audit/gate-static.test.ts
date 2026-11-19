/**
 * W-073 clipping gate, static part (see gate.ts): furniture vs its footprint / walls / floor, wall items behind the
 * wall, surface heights vs the model, catalog lie heights vs the modelled mattress, loose item bases, pet clips vs
 * the floor, level-kit bounds (tools/clip-audit/static.ts), and every body (classic + 25 cast) walking through a
 * DOOR_WIDTH doorway. FAIL rows must be covered by allowlist.ts ('static:<check>' / 'doorway', key = id / body).
 */
import { describe, expect, it } from 'vitest';
import { CAST_BODY_IDS, type BodyId } from '../../../src/shared/cast';
import { DIM } from '../../../src/shared/dimensions';
import { runStatic } from '../../../tools/clip-audit/static';
import { bodyReach } from '../../../tools/clip-audit/reach';
import { penVerdict } from '../../../tools/clip-audit/thresholds';
import { allowFor, describeFailures, published, type GateFailure } from './gate';

describe.skipIf(!published)('clipping gate: static + doorways', () => {
  it('no static FAIL outside the allow-list', async () => {
    const rows = await runStatic(false);
    expect(rows.length).toBeGreaterThan(150);
    const failures: GateFailure[] = [];
    for (const r of rows) {
      if (r.verdict !== 'FAIL') continue;
      const f = { key: r.id, look: '-', check: `static:${r.check}`, mm: r.value, detail: r.detail };
      const a = allowFor(f.check, f.key, f.look);
      if (!a || r.value > a.maxMm) failures.push(f);
    }
    // every lie slot declares its surface and it matches the GLB (the renderer's lie lift reads it)
    expect(rows.filter((r) => r.check === 'lie-surface').length).toBeGreaterThanOrEqual(6);
    expect(failures, describeFailures(failures)).toEqual([]);
  }, 300000);

  it('every body walks through a doorway without its walk swinging through the jambs (outside the allow-list)', async () => {
    const clear = DIM.DOOR_WIDTH / 2;
    const failures: GateFailure[] = [];
    for (const body of ['classic', ...CAST_BODY_IDS] as BodyId[]) {
      const r = await bodyReach({ body, height: 0.5 }, 'walk', 6);
      const mm = Math.max(0, Math.round((r.half - clear) * 1000));
      if (penVerdict(mm) !== 'FAIL') continue;
      const f = { key: body, look: `${body}@h0.5`, check: 'doorway', mm, detail: `walk half-width ${Math.round(r.half * 1000)} mm (no arms ${Math.round(r.halfCore * 1000)}) vs ${clear * 1000} mm` };
      const a = allowFor(f.check, f.key, f.look);
      if (!a || mm > a.maxMm) failures.push(f);
    }
    expect(failures, describeFailures(failures)).toEqual([]);
  }, 300000);
});
