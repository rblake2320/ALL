/**
 * Build-script failure modes that destroy data or lie to CI:
 *
 *  - inline-build.mjs wipes its output folder (`rmSync(outDir, {recursive, force})`). With `--out` pointing at
 *    the input build, a parent of it, the project, the home folder or a drive root it would delete that
 *    tree. The output folder must be provably ours (the default dist-single, a new/empty folder, or one
 *    carrying our marker from an earlier run) — anything else is refused before a single file is touched.
 *  - verify-assets.mjs called process.exit() right after printing. stdout/stderr to a PIPE are asynchronous
 *    on POSIX, so large reports (--json, or thousands of errors) were cut off at the pipe buffer (64 KiB):
 *    CI saw truncated, unparsable output. The CLI must set process.exitCode and let output drain.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(__dirname, '../../..');
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (rel: string): Promise<Mod> => import(pathToFileURL(path.join(ROOT, rel)).href);

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-safety-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, content: string | Buffer) {
  const p = path.join(tmp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function singleBuild(rel: string): string {
  write(`${rel}/index.html`, '<!doctype html><html><head><script type="module" src="./assets/i.js"></script></head><body></body></html>');
  write(`${rel}/assets/i.js`, 'console.log(1)');
  write(`${rel}/assets/models/a.glb`, Buffer.from([1, 2, 3]));
  return path.join(tmp, ...rel.split('/'));
}

const quiet = () => undefined;

describe('inline-build.mjs never deletes what it does not own', () => {
  it('refuses --out == --in (the build it is about to read)', async () => {
    const m = await load('scripts/inline-build.mjs');
    const inDir = singleBuild('build');
    await expect(m.run({ skipBuild: true, inDir, outDir: inDir, inlineAssets: false, maxInlineMb: 12 }, quiet)).rejects.toThrow(/refus/i);
    expect(fs.existsSync(path.join(inDir, 'assets', 'models', 'a.glb'))).toBe(true);
  });

  it('refuses an --out that CONTAINS the input build', async () => {
    const m = await load('scripts/inline-build.mjs');
    const inDir = singleBuild('parent/build');
    await expect(m.run({ skipBuild: true, inDir, outDir: path.join(tmp, 'parent'), inlineAssets: false, maxInlineMb: 12 }, quiet)).rejects.toThrow(/refus/i);
    expect(fs.existsSync(path.join(inDir, 'index.html'))).toBe(true);
  });

  it('refuses a non-empty foreign folder (someone else\'s files), but reuses its own previous output', async () => {
    const m = await load('scripts/inline-build.mjs');
    const inDir = singleBuild('build');
    const foreign = path.join(tmp, 'project');
    write('project/package.json', '{"name":"not-ours"}');
    write('project/src/main.ts', 'precious');
    await expect(m.run({ skipBuild: true, inDir, outDir: foreign, inlineAssets: false, maxInlineMb: 12 }, quiet)).rejects.toThrow(/refus/i);
    expect(fs.readFileSync(path.join(foreign, 'src', 'main.ts'), 'utf8')).toBe('precious');

    const out = path.join(tmp, 'share');
    await m.run({ skipBuild: true, inDir, outDir: out, inlineAssets: false, maxInlineMb: 12 }, quiet); // new folder: fine
    expect(fs.existsSync(path.join(out, 'index.html'))).toBe(true);
    await m.run({ skipBuild: true, inDir, outDir: out, inlineAssets: false, maxInlineMb: 12 }, quiet); // our own output: fine again
    expect(fs.existsSync(path.join(out, 'assets', 'models', 'a.glb'))).toBe(true);
  });

  it('assertSafeOutDir refuses drive/filesystem roots, the home folder, the project and its ancestors', async () => {
    const m = await load('scripts/inline-build.mjs');
    const inDir = path.join(tmp, 'in');
    const bad = [path.parse(ROOT).root, os.homedir(), ROOT, path.dirname(ROOT), path.join(ROOT, 'src'), path.join(ROOT, 'public')];
    for (const outDir of bad) expect(() => m.assertSafeOutDir(outDir, { inDir, projectRoot: ROOT }), outDir).toThrow(/refus/i);
    expect(() => m.assertSafeOutDir(path.join(ROOT, 'dist-single'), { inDir, projectRoot: ROOT })).not.toThrow();
    expect(() => m.assertSafeOutDir(path.join(tmp, 'brand-new'), { inDir, projectRoot: ROOT })).not.toThrow();
  });
});

describe('verify-assets.mjs CLI output survives a pipe', () => {
  function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'verify-assets.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  function bigManifest(n: number): string {
    const entries: Record<string, { file: string; sha256: string }> = {};
    for (let i = 0; i < n; i++) entries[`obj${i}`] = { file: `models/objects/missing-${i}.glb`, sha256: '0'.repeat(64) };
    write('assets/manifest.objects.json', JSON.stringify({ version: 1, objects: entries }));
    return path.join(tmp, 'assets');
  }

  it('--json with thousands of errors prints complete, parseable JSON and exits 1', async () => {
    const root = bigManifest(3000);
    const r = await runCli(['--root', root, '--json']);
    expect(r.code).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(200_000);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; errors: string[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toHaveLength(3000);
  }, 60_000);

  it('text mode prints every error line and the summary', async () => {
    const root = bigManifest(3000);
    const r = await runCli(['--root', root]);
    expect(r.code).toBe(1);
    expect(r.stderr.split('\n').filter((l) => l.startsWith('ERROR: ')).length).toBe(3000);
    expect(r.stdout).toMatch(/FAILED: 0 asset\(s\) verified across 1 manifest\(s\), 3000 error\(s\)/);
  }, 60_000);
});
