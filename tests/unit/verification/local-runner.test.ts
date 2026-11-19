import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('local verification process evidence', () => {
  it('preserves a real child failure and both output streams, while recording later checks', async () => {
    // @ts-expect-error JavaScript command runner intentionally has no declaration file.
    const { runSteps } = await import('../../../scripts/verify-local.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'afterlife-local-'));
    try {
      const result = await runSteps([
        { id: 'failure', command: process.execPath, args: ['-e', 'console.log("stdout evidence"); console.error("stderr evidence"); process.exit(7)'] },
        { id: 'success', command: process.execPath, args: ['-e', 'console.log("later check")'] },
      ], dir);
      expect(result.passed).toBe(false);
      expect(result.steps.map((s: { code: number }) => s.code)).toEqual([7, 0]);
      expect(readFileSync(join(dir, 'failure.log'), 'utf8')).toContain('stdout evidence');
      expect(readFileSync(join(dir, 'failure.log'), 'utf8')).toContain('stderr evidence');
      expect(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).passed).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('fails closed when a command cannot start or the plan is empty', async () => {
    // @ts-expect-error JavaScript command runner intentionally has no declaration file.
    const { runSteps } = await import('../../../scripts/verify-local.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'afterlife-local-'));
    try {
      const result = await runSteps([{ id: 'missing', command: join(dir, 'does-not-exist'), args: [] }], dir);
      expect(result.passed).toBe(false);
      expect(result.steps[0].error).toBeTruthy();
      expect((await runSteps([], dir)).passed).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('browser preflight names the install command when the Playwright browser is missing', async () => {
    // @ts-expect-error JavaScript command runner intentionally has no declaration file.
    const { browserPreflight } = await import('../../../scripts/verify-local.mjs');
    const missing = await browserPreflight(async () => {
      throw new Error("browserType.launch: Executable doesn't exist at C:\\ms-playwright\\chromium_headless_shell-1243\\chrome-headless-shell.exe");
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('npx playwright install chromium');
    const other = await browserPreflight(async () => {
      throw new Error('spawn EACCES\nmore lines');
    });
    expect(other.ok).toBe(false);
    expect(other.message).toBe('Playwright Chromium could not start: spawn EACCES');
    let closed = false;
    const ok = await browserPreflight(async () => ({ close: async () => { closed = true; } }));
    expect(ok.ok).toBe(true);
    expect(closed).toBe(true);
  });
  it('axe preflight fails closed and names the install command when axe-core is absent', async () => {
    // @ts-expect-error JavaScript command runner intentionally has no declaration file.
    const { axePreflight } = await import('../../../scripts/verify-local.mjs');
    const missing = await axePreflight(() => null);
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('npm install --no-save playwright@1.63.0 axe-core@4.10.3');
    // The default lookup is the accessibility suite's own, so AXE_CORE=<axe.min.js> counts as installed.
    const dir = mkdtempSync(join(tmpdir(), 'afterlife-local-'));
    const before = process.env.AXE_CORE;
    try {
      process.env.AXE_CORE = join(dir, 'axe.min.js');
      writeFileSync(process.env.AXE_CORE, '');
      expect(await axePreflight()).toEqual({ ok: true, message: `axe-core: ${process.env.AXE_CORE}` });
    } finally {
      if (before === undefined) delete process.env.AXE_CORE;
      else process.env.AXE_CORE = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
