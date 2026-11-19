import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mimeTypeFor, resolveAppRequest, responseHeaders } from '../../../electron/appProtocol';
import { buildCsp } from '../../../electron/csp';

const ROOT = path.resolve('/srv/app/dist');

describe('app:// path resolution', () => {
  it('maps URLs to files inside the build', () => {
    expect(resolveAppRequest(ROOT, 'app://game/index.html')).toEqual({ ok: true, filePath: path.join(ROOT, 'index.html'), relPath: 'index.html' });
    expect(resolveAppRequest(ROOT, 'app://game/')).toMatchObject({ ok: true, relPath: 'index.html' });
    expect(resolveAppRequest(ROOT, 'app://game/assets/models/objects/chair%20creaky.glb?v=1#x')).toMatchObject({
      ok: true,
      filePath: path.join(ROOT, 'assets', 'models', 'objects', 'chair creaky.glb'),
    });
  });

  it('dot segments are normalized by the URL parser and stay INSIDE the root', () => {
    for (const u of ['app://game/../../etc/passwd', 'app://game/%2e%2e/%2e%2e/etc/passwd', 'app://game/a/./../../b']) {
      const r = resolveAppRequest(ROOT, u);
      if (r.ok) {
        const rel = path.relative(ROOT, r.filePath);
        expect(rel.startsWith('..') || path.isAbsolute(rel), u).toBe(false);
      }
    }
  });

  const attacks = [
    'app://game/assets/%2e%2e%2f%2e%2e%2fsecret',
    'app://game/..%5c..%5cWindows%5cwin.ini',
    'app://game/assets%5c..%5c..%5cboot.ini',
    'app://game/C:%5cWindows%5cwin.ini',
    'app://game/c%3a/windows/win.ini',
    'app://game/index.html%00.png',
    'app://game/index.html::$DATA',
    'app://game/CON',
    'app://game/assets/nul.txt',
    'app://game/com1.glb',
    'app://game/.env',
    'app://game/assets/.hidden',
    'app://game/trailing.',
    'app://game/trailing%20',
    'app://game/%E0%A4%A',
    'app://other/index.html',
    'app://user:pass@game/index.html',
    'file:///etc/passwd',
    'https://game/index.html',
    'not a url',
  ];
  for (const a of attacks) {
    it(`refuses ${a}`, () => {
      const r = resolveAppRequest(ROOT, a);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error(`resolved to ${r.filePath}`);
    });
  }

  it('never resolves outside the root (fuzz)', () => {
    const parts = ['..', '.', '%2e', '%2e%2e', '%2f', '%5c', 'a', 'b.glb', '%00', ':', 'con', '~', '%252e%252e'];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) {
      const p = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => parts[Math.floor(rnd() * parts.length)]).join(rnd() < 0.7 ? '/' : '');
      const r = resolveAppRequest(ROOT, `app://game/${p}`);
      if (r.ok) {
        const rel = path.relative(ROOT, r.filePath);
        expect(rel.startsWith('..') || path.isAbsolute(rel), `${p} -> ${r.filePath}`).toBe(false);
      }
    }
  });
});

describe('MIME types and headers', () => {
  it('serves correct types (wasm must be application/wasm for streaming compile)', () => {
    expect(mimeTypeFor('a/index.HTML')).toMatch(/^text\/html/);
    expect(mimeTypeFor('x.js')).toMatch(/^text\/javascript/);
    expect(mimeTypeFor('x.wasm')).toBe('application/wasm');
    expect(mimeTypeFor('x.glb')).toBe('model/gltf-binary');
    expect(mimeTypeFor('x.ogg')).toBe('audio/ogg');
    expect(mimeTypeFor('x.unknownext')).toBe('application/octet-stream');
  });

  it('documents get the CSP; assets get nosniff and long caching', () => {
    const csp = buildCsp();
    const html = responseHeaders('index.html', csp);
    expect(html['content-security-policy']).toBe(csp);
    expect(html['cache-control']).toBe('no-cache');
    const glb = responseHeaders('m.glb', csp);
    expect(glb['content-security-policy']).toBeUndefined();
    expect(glb['x-content-type-options']).toBe('nosniff');
  });
});

describe('CSP', () => {
  it('production policy is strict', () => {
    const csp = buildCsp();
    const d = Object.fromEntries(csp.split('; ').map((x) => [x.split(' ')[0], x.slice(x.indexOf(' ') + 1)]));
    expect(d['default-src']).toBe("'self'");
    expect(d['script-src']).toBe("'self'"); // no WebAssembly shipped -> no 'wasm-unsafe-eval'
    expect(d['object-src']).toBe("'none'");
    expect(d['frame-ancestors']).toBe("'none'");
    expect(d['form-action']).toBe("'none'");
    expect(d['img-src']).toBe("'self' data: blob:");
    expect(csp.replace(/'wasm-unsafe-eval'/g, '')).not.toContain('unsafe-eval');
    expect(d['style-src']).toBe("'self' 'unsafe-inline'"); // unsafe-inline only for styles
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false);
    expect(csp).not.toMatch(/https?:/);
    expect(csp).not.toMatch(/\*/);
    expect(buildCsp({ allowWasm: false })).toMatch(/script-src 'self';/);
    expect(buildCsp({ allowWasm: true })).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
  });

  it("no shipped model needs a WebAssembly decoder (else the CSP must opt into 'wasm-unsafe-eval')", () => {
    const root = path.resolve(__dirname, '../../../public/assets');
    const walk = (d: string): string[] =>
      fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [];
    const glbs = walk(root).filter((f) => f.toLowerCase().endsWith('.glb'));
    const needing: string[] = [];
    for (const f of glbs) {
      let b: Buffer;
      try {
        b = fs.readFileSync(f);
      } catch {
        continue; // an asset module may be regenerating it right now
      }
      if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) continue; // not (yet) a complete GLB
      const jsonLen = b.readUInt32LE(12);
      const json = b.subarray(20, 20 + jsonLen).toString('utf8');
      if (/KHR_draco_mesh_compression|EXT_meshopt_compression|KHR_texture_basisu|KHR_mesh_quantization_wasm/.test(json)) needing.push(path.relative(root, f));
    }
    expect(needing, `these assets need a WASM decoder; build the CSP with allowWasm: true in electron/main.ts`).toEqual([]);
  });

  it('dev policy adds only the dev origin and its websocket', () => {
    const csp = buildCsp({ devOrigin: 'http://localhost:5173' });
    expect(csp).toContain("script-src 'self' http://localhost:5173;");
    expect(csp).toContain('ws://localhost:5173');
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });
});
