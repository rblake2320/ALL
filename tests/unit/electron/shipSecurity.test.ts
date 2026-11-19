/**
 * Ship/security review additions (docs/SECURITY.md): the web-build CSP <meta> tag (one source of truth with the
 * Electron header policy), the single-file build's inline-script hashes, and the generated desktop icon.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCsp, buildMetaCsp } from '../../../electron/csp';
import viteConfig, { cspMetaPlugin } from '../../../vite.config';
import { resolveAppRequest } from '../../../electron/appProtocol';

const ROOT = path.resolve(__dirname, '..', '..', '..');
type HtmlHook = { handler: (html: string) => string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = Record<string, any>;
/** The build scripts are plain .mjs (no declarations): load them by URL, like scripts.test.ts does. */
const load = (rel: string): Promise<Mod> => import(pathToFileURL(path.join(ROOT, rel)).href);

function runPlugin(html: string): string {
  const p = cspMetaPlugin();
  expect(p.apply).toBe('build'); // never on the dev server (Vite's HMR client is inline)
  return (p.transformIndexHtml as unknown as HtmlHook).handler(html);
}

const policyOf = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? null;
const directive = (policy: string, name: string) => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? null;

describe('CSP — one policy for Electron (header) and the web build (meta)', () => {
  it('meta policy = header policy minus frame-ancestors (ignored in <meta>); no unsafe script sources anywhere', () => {
    const header = buildCsp();
    const meta = buildMetaCsp();
    expect(header).toContain("frame-ancestors 'none'");
    expect(meta).not.toContain('frame-ancestors');
    expect(header.replace(/; frame-ancestors 'none'$/, '')).toBe(meta);
    for (const p of [header, meta]) {
      const script = directive(p, 'script-src')!;
      expect(script).toBe("script-src 'self'");
      expect(p).not.toMatch(/unsafe-eval|https?:|\*/);
      expect(directive(p, 'object-src')).toBe("object-src 'none'");
      expect(directive(p, 'base-uri')).toBe("base-uri 'self'");
    }
  });

  it('script hashes are validated before they reach a policy', () => {
    const h = `'sha256-${createHash('sha256').update('x').digest('base64')}'`;
    expect(directive(buildMetaCsp({ scriptHashes: [h] }), 'script-src')).toBe(`script-src 'self' ${h}`);
    for (const bad of ["'unsafe-inline'", "'sha256-abc'", `${h}; script-src *`, 'https://evil.example']) {
      expect(() => buildMetaCsp({ scriptHashes: [bad] }), bad).toThrow(/invalid CSP script hash/);
    }
  });

  it('the Vite plugin puts the meta tag right after <meta charset> of the real index.html (before any script)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(src).not.toMatch(/http-equiv\s*=\s*["']?content-security-policy/i); // single source of truth: the plugin
    const out = runPlugin(src);
    expect(policyOf(out)).toBe(buildMetaCsp());
    const metaAt = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(metaAt).toBeGreaterThan(out.indexOf('<meta charset'));
    expect(metaAt).toBeLessThan(out.indexOf('<script'));
    expect(metaAt).toBeLessThan(out.indexOf('<style'));
    expect(metaAt).toBeLessThan(1024); // charset + CSP both inside the first 1 KiB
    // index.html itself has no inline <script> (they would be blocked by script-src 'self').
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) expect(m[1]).toMatch(/\bsrc=/);
  });

  it('a second CSP source is a build error, not two diverging policies', () => {
    expect(() => runPlugin('<head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>')).toThrow(/already declares a CSP/);
    expect(policyOf(runPlugin('<html><head><title>x</title></head></html>'))).toBe(buildMetaCsp()); // no charset: head-prepend
  });
});

describe('third-party license notices', () => {
  it('every build (normal and single-file) emits the bundled dependencies\' licenses at a path app:// can serve', () => {
    for (const mode of ['production', 'single']) {
      const cfg = (viteConfig as unknown as (e: { mode: string; command: string }) => { build: { license: unknown }; plugins: { name: string }[] })({ mode, command: 'build' });
      expect(cfg.build.license).toEqual({ fileName: 'THIRD_PARTY_LICENSES.md' });
      expect(cfg.plugins.map((p) => p.name)).toContain('afterlife-csp-meta');
    }
    const r = resolveAppRequest('/app/dist', 'app://game/THIRD_PARTY_LICENSES.md');
    expect(r.ok).toBe(true);
  });
});

describe('single-file build — inline scripts allowed by exact SHA-256 only', () => {
  it('adds the hash of every inline script (and only inline ones) to script-src; scripts still run unchanged', async () => {
    const { addCspScriptHashes } = await load('scripts/inline-build.mjs');
    const js1 = 'console.log("game")';
    const js2 = '(()=>{window.fetch=window.fetch})();';
    const html = runPlugin(`<html><head><meta charset="utf-8"><script>${js2}</script></head><body><script type="module">${js1}</script><script src="./x.js"></script><script></script></body></html>`);
    const { html: out, hashes } = addCspScriptHashes(html);
    const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
    expect(hashes).toEqual([sha(js2), sha(js1)]);
    expect(directive(policyOf(out)!, 'script-src')).toBe(`script-src 'self' ${sha(js2)} ${sha(js1)}`);
    expect(directive(policyOf(out)!, 'script-src')).not.toMatch(/unsafe/);
    // Everything except the policy is untouched (a hash covers the exact bytes).
    expect(out.replace(/content="[^"]*"/, '')).toBe(html.replace(/content="[^"]*"/, ''));
    // Every other directive is preserved verbatim.
    for (const d of buildMetaCsp().split('; ')) if (!d.startsWith('script-src')) expect(policyOf(out)).toContain(d);
  });

  it('no CSP meta: unchanged; two CSP metas: refused', async () => {
    const { addCspScriptHashes } = await load('scripts/inline-build.mjs');
    const plain = '<html><head></head><body><script>1</script></body></html>';
    expect(addCspScriptHashes(plain)).toEqual({ html: plain, hashes: [] });
    const two = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><meta http-equiv="content-security-policy" content="x"><script>1</script>';
    expect(() => addCspScriptHashes(two)).toThrow(/more than one CSP/);
  });
});

describe('desktop icon (electron/build/icon.ico)', () => {
  it('is a valid multi-size ICO of PNG entries whose pixels match a fresh render of the design', async () => {
    const icon = await load('scripts/make-icon.mjs');
    const { ico } = icon.iconPaths(ROOT);
    const entries = icon.parseIco(fs.readFileSync(ico));
    expect(entries.map((e: { size: number }) => e.size)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    for (const e of entries as { size: number; png: Uint8Array }[]) {
      const { size, pixels } = icon.decodeOwnPng(e.png);
      expect(size).toBe(e.size);
      expect(Buffer.from(pixels).equals(Buffer.from(icon.renderIcon(e.size)))).toBe(true);
    }
  });

  it('the 256 px render is opaque in the middle, transparent in the rounded corners, and uses the palette', async () => {
    const { renderIcon } = await load('scripts/make-icon.mjs');
    const px: Uint8Array = renderIcon(256);
    const at = (x: number, y: number) => Array.from(px.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4));
    expect(at(0, 0)[3]).toBe(0); // corner outside the rounded tile
    expect(at(128, 20)).toEqual([0x1d, 0x17, 0x26, 255]); // dark tile above the roof
    expect(at(128, 136)).toEqual([0x9f, 0xe8, 0x70, 255]); // green glow (zombie head)
    expect(at(70, 180)).toEqual([0xe8, 0xe0, 0xc8, 255]); // bone wall
  });
});
