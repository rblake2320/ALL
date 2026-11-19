/**
 * docs/MONETIZATION.md §3: "A DevWallet exists only in dev builds (import.meta.env.DEV), stripped from production
 * bundles (test asserts)". Builds the real production bundle (vite build) into a temp dir and scans every emitted file
 * (JS, CSS, HTML, source maps) for DevWallet code/strings, while checking the ServerWallet path IS present.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('production bundle', () => {
  it('contains no DevWallet code or strings (and does contain the ServerWallet)', () => {
    const out = mkdtempSync(join(tmpdir(), 'al-bundle-'));
    try {
      execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });
      const all = files(out).filter((f) => /\.(js|mjs|css|html|map)$/.test(f));
      expect(all.some((f) => f.endsWith('.js'))).toBe(true);
      const forbidden = ['__afterlife_dev_wallet__', 'createDevWallet', 'DevWallet', 'devWallet', 'real-money checkout is not simulated', 'Not enough (dev) Grave Gold'];
      let server = false;
      for (const f of all) {
        const text = readFileSync(f, 'utf8');
        if (f.endsWith('.map')) {
          // Source maps carry the ORIGINAL text of bundled modules (wallet.ts documents the DEV branch), so check the
          // module list instead: devWallet.ts itself must not be part of the bundle, and no code chunk may map to it.
          const map = JSON.parse(text) as { sources?: string[] };
          expect((map.sources ?? []).some((src) => /devWallet/.test(src)), `devWallet module bundled (${f})`).toBe(false);
          continue;
        }
        for (const s of forbidden) expect(text.includes(s), `${s} found in ${f}`).toBe(false);
        if (text.includes('Sign in to buy (coming soon)')) server = true;
      }
      expect(all.some((f) => /devWallet/i.test(f))).toBe(false); // no separate dev chunk either
      // Security review L-3: a release build ships no public source maps (no .map files, no sourceMappingURL).
      expect(all.filter((f) => f.endsWith('.map'))).toEqual([]);
      for (const f of all.filter((x) => /\.(js|mjs|css)$/.test(x))) expect(readFileSync(f, 'utf8').includes('sourceMappingURL'), f).toBe(false);
      expect(server).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 240_000);
});
