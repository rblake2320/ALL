import { describe, expect, it } from 'vitest';
import { bundleHead, parseArguments, requireAncestor, validateInputs } from '../../../tools/verification/spark-runner.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const sha = '81ad2a8cac6c35e3ee4e18f5ab762793cc0306a6';
describe('W-111 Spark verification runner input boundary', () => {
  it('accepts a full pin and simple host alias', () => {
    expect(() => validateInputs(sha, 'spark2')).not.toThrow();
    expect(bundleHead(`${sha} refs/remotes/origin/ship/final-phase\n`)).toBe(sha);
  });
  it('selects the nightly sweep explicitly and rejects extra flags', () => {
    expect(parseArguments([sha])).toEqual({commit: sha, host: 'spark2', nightly: false});
    expect(parseArguments([sha, '--nightly'])).toEqual({commit: sha, host: 'spark2', nightly: true});
    expect(parseArguments([sha, 'spark2', '--nightly'])).toEqual({commit: sha, host: 'spark2', nightly: true});
    expect(() => parseArguments([sha, '--nightly', '--nightly'])).toThrow();
    expect(() => parseArguments([sha, 'spark2', '--oops'])).toThrow();
  });
  it.each(['81ad2a8', sha.toUpperCase(), `${sha};whoami`, '../checkout'])('refuses unpinned or unsafe commit %s', pin => {
    expect(() => validateInputs(pin, 'spark2')).toThrow();
  });
  it.each(['spark2;touch /tmp/x', '-oProxyCommand=bad', 'spark 2', ''])('refuses unsafe host %s', host => {
    expect(() => validateInputs(sha, host)).toThrow();
  });
  it('refuses missing, wrong or multiple bundle refs', () => {
    expect(() => bundleHead('')).toThrow();
    expect(() => bundleHead(`${sha} refs/heads/main`)).toThrow();
    expect(() => bundleHead(`${sha} refs/remotes/origin/ship/final-phase\n${sha} refs/heads/main`)).toThrow();
  });
  it('accepts an older real ancestor but rejects an unrelated real commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spark-runner-ancestry-'));
    const git = (...args: string[]) => {
      const r = spawnSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-q');
      writeFileSync(join(dir, 'item.txt'), 'first'); git('add', 'item.txt'); git('commit', '-qm', 'first');
      const first = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'item.txt'), 'second'); git('commit', '-qam', 'second');
      const tip = git('rev-parse', 'HEAD');
      const unrelated = git('commit-tree', git('rev-parse', 'HEAD^{tree}'), '-m', 'unrelated');
      expect(() => requireAncestor(first, tip, dir)).not.toThrow();
      expect(() => requireAncestor(unrelated, tip, dir)).toThrow(/not an available ancestor/);
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir(), 'spark-runner-ancestry-'))) throw new Error('Unexpected fixture path');
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects an unsafe CLI request before attempting SSH or file transfer', () => {
    const script = resolve('tools/verification/spark-runner.mjs');
    const result = spawnSync(process.execPath, [script, sha, 'spark2;unexpected'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Expected a simple SSH host alias');
  });
});
