/**
 * The clip-audit CLI must not exit 0 on a FAIL (Terra, Spark2 pilot at 81ad2a8: floor:admire / classic → FAIL with
 * exit 0). `matrix` / `summary` exit 1 on any penetration FAIL outside the allow-list, 0 with --report-only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOW, allowFor, unallowedFails, type AllowEntry } from '../../../tools/clip-audit/allowlist';
import { ROOT } from '../../../tools/clip-audit/assets';
import { published } from './gate';

const ev = (checks: { name: string; value: number; verdict: string }[]) => [{ key: 'floor:admire', look: 'classic@h0.5', checks }];

// Windows: `npx` is `npx.cmd`, which spawnSync cannot start without a shell (stdout came back undefined on the
// windows-latest push run at b971cad). Same rule as scripts/clip-gate.mjs.
const IS_WIN = process.platform === 'win32';
const npx = (args: string[], env: NodeJS.ProcessEnv) => {
  const r = spawnSync(IS_WIN ? 'npx.cmd' : 'npx', args, { cwd: ROOT, env, encoding: 'utf8', timeout: 240000, shell: IS_WIN });
  if (r.error) throw r.error; // a spawn failure must fail loudly, never as "stdout undefined"
  return r;
};

describe('clip-audit verdict -> exit code', () => {
  it('penetration FAILs outside the allow-list count; allowed ones (within maxMm), WARNs and float / gap FAILs do not', () => {
    const fail = ev([{ name: 'pen:self-arm', value: 61.7, verdict: 'FAIL' }]);
    expect(unallowedFails(fail, [])).toEqual([{ key: 'floor:admire', look: 'classic@h0.5', check: 'pen:self-arm', mm: 61.7 }]);
    const allow: AllowEntry[] = [{ check: 'pen:self-*', key: /^floor:admire/, maxMm: 70, finding: 't', cause: 't', owner: 't', reason: 't' }];
    expect(allowFor('pen:self-arm', 'floor:admire', 'classic@h0.5', allow)).toBe(allow[0]);
    expect(unallowedFails(fail, allow)).toEqual([]);
    expect(unallowedFails(ev([{ name: 'pen:self-arm', value: 80, verdict: 'FAIL' }]), allow)).toHaveLength(1); // deeper than maxMm
    expect(unallowedFails(ev([{ name: 'pen:object', value: 12, verdict: 'WARN' }, { name: 'float:seat', value: 90, verdict: 'FAIL' }]), [])).toEqual([]);
    expect(ALLOW.every((a) => a.maxMm > 15 && a.owner && a.reason && a.finding)).toBe(true);
  });

  it.skipIf(!published)('the real CLI exits 1 on a FAIL and 0 with --report-only', () => {
    const run = 'cli-exit-test';
    const file = resolve(ROOT, `dev/out/clip-audit/results/${run}-1of1.jsonl`);
    const args = ['vite-node', 'tools/clip-audit/run.ts', 'matrix', '--bodies', 'classic', '--filter', '^floor:admire$', '--times', '2', '--one-way', '--run', run];
    const env = { ...process.env, CLIP_AUDIT_NO_ALLOW: '1' };
    try {
      const a = npx(args, env);
      expect(a.stdout).toMatch(/FAIL pen:self-arm .* floor:admire {2}classic@h0\.5/);
      expect(a.status).toBe(1);
      const b = npx([...args, '--report-only'], env);
      expect(b.status).toBe(0);
    } finally {
      if (existsSync(file)) rmSync(file);
    }
  }, 600000);
});
