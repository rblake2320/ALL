/**
 * Shared town, step 1: which page may connect to what. Only the built town page gets one extra connection origin,
 * and only a well-formed one; the game's own page never does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { buildCsp, buildMetaCsp } from '../../../electron/csp';
import { cspMetaPlugin, townServerOrigin } from '../../../vite.config';
import { isTownServerUrl } from '../../../src/town/connection';

type HtmlHook = { handler: (html: string, ctx?: { filename?: string }) => string };
const run = (html: string, filename?: string): string => (cspMetaPlugin().transformIndexHtml as unknown as HtmlHook).handler(html, filename === undefined ? undefined : { filename });
const PAGE = '<!doctype html><html><head><meta charset="UTF-8" /><title>x</title></head><body></body></html>';
const connectOf = (html: string): string => /connect-src ([^;"]*)/.exec(html)?.[1] ?? '';

const saved = process.env.VITE_TOWN_SERVER;
afterEach(() => {
  if (saved === undefined) delete process.env.VITE_TOWN_SERVER;
  else process.env.VITE_TOWN_SERVER = saved;
});

describe('the policy accepts one kind of extra connection origin', () => {
  it('adds a town server to connect-src and to nothing else', () => {
    const base = buildMetaCsp();
    const town = buildMetaCsp({ connect: ['wss://town.example'] });
    expect(town).toContain("connect-src 'self' data: blob: wss://town.example;");
    expect(town.replace(' wss://town.example', '')).toBe(base);
    expect(buildCsp({ connect: ['ws://127.0.0.1:8787'] })).toContain("connect-src 'self' data: blob: ws://127.0.0.1:8787;");
  });
  const bad = ['https://town.example', 'wss://town.example/path', 'wss://*', '*', "'unsafe-inline'", 'wss://a.example; script-src *', 'wss://a.example wss://b.example', 'WSS://TOWN.EXAMPLE', 'wss://', '', 'wss://town.example:999999'];
  for (const origin of bad) it(`refuses ${JSON.stringify(origin)}`, () => expect(() => buildMetaCsp({ connect: [origin] })).toThrow(/invalid CSP connect origin/));
});

describe('the build reads the town server from VITE_TOWN_SERVER', () => {
  it('unset or empty means no town server', () => {
    expect(townServerOrigin(undefined)).toBeNull();
    expect(townServerOrigin('')).toBeNull();
  });
  it('keeps the origin, drops the path, lower-cases the host', () => {
    expect(townServerOrigin('wss://Town.Example')).toBe('wss://town.example');
    expect(townServerOrigin('wss://town.example:8443/rooms/1')).toBe('wss://town.example:8443');
    expect(townServerOrigin('ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787');
  });
  for (const v of ['https://town.example', 'town.example', 'wss://town.example/?q=1', 'wss://a b', 'wss://a.example; script-src *', 'javascript:alert(1)']) {
    it(`stops the build on ${JSON.stringify(v)}`, () => expect(() => townServerOrigin(v)).toThrow(/VITE_TOWN_SERVER must look like/));
  }
  it('the page and the build agree on what a server address is', () => {
    for (const v of ['wss://town.example', 'ws://127.0.0.1:8787', 'wss://town.example:8443/rooms/1']) {
      expect(isTownServerUrl(v)).toBe(true);
      expect(townServerOrigin(v)).not.toBeNull();
    }
    for (const v of ['https://town.example', 'wss://a b', 'wss://town.example/?q=1', '', null, 42]) expect(isTownServerUrl(v)).toBe(false);
  });
});

describe('only the town page gets the extra origin', () => {
  it('a production env file configures both the client and the generated CSP', async () => {
    delete process.env.VITE_TOWN_SERVER;
    const root = mkdtempSync(path.join(tmpdir(), 'town-csp-'));
    try {
      writeFileSync(path.join(root, '.env'), 'VITE_TOWN_SERVER=wss://base.example\n');
      writeFileSync(path.join(root, '.env.production'), 'VITE_TOWN_SERVER=wss://production.example/ws\n');
      writeFileSync(path.join(root, 'index.html'), PAGE);
      writeFileSync(path.join(root, 'town.html'), PAGE.replace('</body>', '<script type="module" src="/client.js"></script></body>'));
      writeFileSync(path.join(root, 'client.js'), 'console.log(import.meta.env.VITE_TOWN_SERVER);');
      const result = await build({ root, configFile: false, logLevel: 'silent', plugins: [cspMetaPlugin()], build: {
        write: false, rollupOptions: { input: { main: path.join(root, 'index.html'), town: path.join(root, 'town.html') } },
      } });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => 'output' in r ? r.output : []);
      const html = (name: string): string => {
        const asset = outputs.find(o => o.fileName === name);
        return asset?.type === 'asset' ? String(asset.source) : '';
      };
      expect(connectOf(html('town.html'))).toContain('wss://production.example');
      expect(connectOf(html('town.html'))).not.toContain('base.example');
      expect(connectOf(html('index.html'))).toBe("'self' data: blob:");
      expect(outputs.some(o => o.type === 'chunk' && o.code.includes('wss://production.example/ws'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('town.html gets it when a server is configured', () => {
    process.env.VITE_TOWN_SERVER = 'wss://town.example/ws';
    expect(connectOf(run(PAGE, '/repo/town.html'))).toBe("'self' data: blob: wss://town.example");
    expect(connectOf(run(PAGE, 'C:\\repo\\town.html'))).toBe("'self' data: blob: wss://town.example");
  });
  it("the game's page never gets it, configured or not", () => {
    process.env.VITE_TOWN_SERVER = 'wss://town.example';
    for (const name of ['/repo/index.html', '/repo/downtown.html', '/repo/town.html.bak', undefined]) expect(connectOf(run(PAGE, name))).toBe("'self' data: blob:");
  });
  it('town.html built with no server configured connects to nothing', () => {
    delete process.env.VITE_TOWN_SERVER;
    expect(connectOf(run(PAGE, '/repo/town.html'))).toBe("'self' data: blob:");
  });
  it('a malformed setting stops the town page build and leaves the game page alone', () => {
    process.env.VITE_TOWN_SERVER = 'https://not-a-websocket.example';
    expect(() => run(PAGE, '/repo/town.html')).toThrow(/VITE_TOWN_SERVER/);
    expect(connectOf(run(PAGE, '/repo/index.html'))).toBe("'self' data: blob:");
  });
});
