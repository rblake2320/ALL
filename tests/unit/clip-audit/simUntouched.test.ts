/**
 * W-073 fixes are render / data only: the deterministic sim must stay byte-identical (saves and journals replay the
 * same). The catalog's render-only slot geometry (`seat`, `lie`) must never be read by src/sim, and the sim must not
 * import the renderer's fit modules. (The audit also compared serialize() hashes of real-content runs with the old and
 * new catalog — identical; docs/audits/clipping-W073.md §Determinism.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM = resolve(__dirname, '../../../src/sim');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('sim untouched by the clipping fits', () => {
  it('src/sim never reads slot.seat / slot.lie and never imports the render fits', () => {
    const bad: string[] = [];
    for (const f of files(SIM)) {
      const s = readFileSync(f, 'utf8');
      if (/\.(seat|lie)\b(?!\s*:)/.test(s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) bad.push(`${f}: reads .seat/.lie`);
      if (/render\/agents\/(reach|seat|agents)/.test(s)) bad.push(`${f}: imports a render fit`);
    }
    expect(bad).toEqual([]);
  });
});
