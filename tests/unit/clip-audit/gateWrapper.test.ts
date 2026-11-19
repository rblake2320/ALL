/**
 * Negative controls for `npm run clip:gate` (scripts/clip-gate.mjs): an explicit full-gate run must FAIL CLOSED when
 * the assets the heavy suites need are absent or are Git LFS pointers. Without this the suites skip and vitest exits 0.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', '..', '..', 'scripts', 'clip-gate.mjs');
const REQUIRED = ['models/characters/zombie.glb', 'manifest.cast.json', 'models/objects/chair_creaky.glb', 'models/characters/cast/mascot.glb', 'manifest.premium.json',
  ...['sexton', 'lowside', 'waitress', 'patient', 'fisherman'].flatMap(id => [`models/characters/premium/${id}.glb`, `models/characters/premium/${id}_low.glb`])];
const dirs: string[] = [];
const sandbox = () => { const d = mkdtempSync(join(tmpdir(), 'clipgate-')); dirs.push(d); return d; };
const run = (cwd: string) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: { ...process.env, CLIP_GATE_FULL: '' } });
const put = (root: string, rel: string, body: string) => { const p = join(root, 'public', 'assets', rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('clip:gate wrapper fails closed', () => {
  it('exits 2 and names every missing asset in an empty checkout (vitest never starts)', () => {
    const r = run(sandbox());
    expect(r.status).toBe(2);
    for (const a of REQUIRED) expect(r.stderr).toContain(a);
  });

  it('exits 2 when the GLBs are Git LFS pointers (clone without `git lfs pull`)', () => {
    const d = sandbox();
    for (const a of REQUIRED) put(d, a, a.endsWith('.json') ? '{}' : 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n');
    const r = run(d);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/LFS pointers/);
    expect(r.stderr).toContain('models/characters/zombie.glb');
    expect(r.stderr).not.toContain('manifest.cast.json'); // a real (non-pointer) file is accepted
  });

  // Terra's W-111 false pass: ONLY chair_creaky.glb parked -> old wrapper exited 0 with the four full suites skipped.
  it.each(REQUIRED)('exits 2 when only %s is missing (each asset alone, incl. the chair false-pass case)', (missing) => {
    const d = sandbox();
    for (const a of REQUIRED) if (a !== missing) put(d, a, 'x'.repeat(2048));
    const r = run(d);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(missing);
    for (const a of REQUIRED) if (a !== missing) expect(r.stderr).not.toContain(a);
  });
});
