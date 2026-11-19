/**
 * Security review 2026-11-05 D-8: the libraries bundled into the game (three, preact) are real `dependencies` (so
 * `npm audit --omit=dev` examines them), yet the Electron package still ships NO node_modules. electron-builder copies
 * production dependencies on its own, filtered only by the EXCLUDE patterns of `files` relative to each module's
 * directory, so the config starts with "!**\/*" — inert for the app's own files (an exclude is only re-tested once
 * something matched) and excluding every file of every node module. Checked with electron-builder's own matchers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const req = createRequire(path.join(ROOT, 'package.json'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'electron-builder.json'), 'utf8')) as { files: string[]; directories: { output: string; buildResources: string } };

/** Every bare module the shipped source imports (src/**, excluding dev-only harnesses is not needed: all are bundled). */
function bundledPackages(): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/^\s*import[^'";]*?from\s+'([^'.][^']*)'/gm)) {
          if (m[0].includes('import type')) continue;
          const id = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
          if (!id.startsWith('node:')) out.add(id);
        }
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

describe('D-8 runtime libraries are dependencies; the Electron package ships no node_modules', () => {
  it('every library imported by the shipped source is a production dependency (exact pin), none are dev-only', () => {
    const libs = bundledPackages();
    expect([...libs].sort()).toEqual(['preact', 'three']);
    for (const l of libs) {
      expect(pkg.dependencies?.[l], l).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkg.devDependencies?.[l], l).toBeUndefined();
    }
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean; dependencies?: Record<string, string> }> };
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
    for (const l of libs) {
      expect(lock.packages[`node_modules/${l}`].dev, l).toBeUndefined();
      expect(lock.packages[`node_modules/${l}`].version).toBe(pkg.dependencies![l]);
    }
  });

  it("electron-builder's own file matchers: app files ship, maps do not, and no file of any dependency is copied", () => {
    const { getMainFileMatchers, getNodeModuleFileMatcher, FileMatcher } = req('app-builder-lib/out/fileMatcher.js');
    const macro = (s: string) => s.replace('${version}', '1.0.0');
    const config = { ...cfg, files: [...cfg.files] };
    const info = { config, projectDir: ROOT, buildResourcesDir: cfg.directories.buildResources, isPrepackedAppAsar: false, debugLogger: { isEnabled: false } };
    const platformPackager = { info };
    const dest = '/out/resources/app';
    const [main] = getMainFileMatchers(ROOT, dest, macro, {}, platformPackager, path.join(ROOT, 'release/1.0.0'), false);
    const mainFilter = main.createFilter();
    const file = { isDirectory: () => false } as fs.Stats;
    for (const f of ['dist/index.html', 'dist/assets/index-abc.js', 'electron/dist/main.js', 'electron/dist/preload.js', 'package.json']) expect(mainFilter(path.join(ROOT, f), file), f).toBe(true);
    for (const f of ['dist/assets/index-abc.js.map', 'src/main.ts', 'node_modules/three/build/three.module.js', '.keys/dev-publisher.ed25519.json', 'tests/unit/x.test.ts']) expect(mainFilter(path.join(ROOT, f), file), f).toBe(false);

    const nm = getNodeModuleFileMatcher(ROOT, dest, macro, {}, info);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      const dir = path.join(ROOT, 'node_modules', dep);
      const depFilter = new FileMatcher(dir, path.join(dest, 'node_modules', dep), macro, nm.patterns).createFilter();
      const files: string[] = [];
      const walk = (d: string) => {
        for (const n of fs.readdirSync(d)) {
          const p = path.join(d, n);
          if (fs.statSync(p).isDirectory()) walk(p);
          else files.push(p);
        }
      };
      walk(dir);
      expect(files.length, dep).toBeGreaterThan(0);
      const shipped = files.filter((p) => depFilter(p, file));
      expect(shipped, dep).toEqual([]);
      expect(depFilter(path.join(dir, 'package.json'), file)).toBe(false);
      // The leading "!**/*" is load-bearing: without it electron-builder would copy the dependency into the asar.
      const nmWithout = getNodeModuleFileMatcher(ROOT, dest, macro, {}, { ...info, config: { ...config, files: cfg.files.filter((f) => f !== '!**/*') } });
      const leaky = new FileMatcher(dir, path.join(dest, 'node_modules', dep), macro, nmWithout.patterns).createFilter();
      expect(files.filter((p) => leaky(p, file)).length, `${dep} without the guard`).toBeGreaterThan(0);
    }
  });
});
