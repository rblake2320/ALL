/**
 * Build tooling: single-file inliner, asset verifier, electron build checks, and static checks of
 * the PowerShell scripts (no PowerShell runtime exists in this Linux container — see PLATFORM.md).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(__dirname, '../../..');
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (rel: string): Promise<Mod> => import(pathToFileURL(path.join(ROOT, rel)).href);

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-scripts-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, content: string | Buffer) {
  const p = path.join(tmp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

describe('inline-build.mjs', () => {
  it('escapes sequences that would break out of inline <script>/<style>', async () => {
    const m = await load('scripts/inline-build.mjs');
    const js = 'const a="</script><script>alert(1)</script>";const b=`<!--`;const c=/<\\/SCRIPT/i;';
    const out = m.escapeInlineScript(js);
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toMatch(/<!--/);
    expect(out).not.toMatch(/<script/i);
    // Still evaluates to the same strings.
    const f = new Function(`${out.replace(/^const /, 'var ').replace(/;const /g, ';var ')} return [a,b,c.source];`);
    expect(f()).toEqual(['</script><script>alert(1)</script>', '<!--', '<\\/SCRIPT']);
    expect(m.escapeInlineStyle('a{content:"</style>"}')).not.toMatch(/<\/style/i);
  });

  it('re-bases relative CSS urls to the document folder', async () => {
    const m = await load('scripts/inline-build.mjs');
    const css = 'a{background:url(bg.png)}b{src:url("../fonts/x.woff2")}c{background:url(data:image/png;base64,AA==)}d{background:url(https://x/y.png)}';
    expect(m.rewriteCssUrls(css, 'assets')).toBe(
      'a{background:url(./assets/bg.png)}b{src:url("./fonts/x.woff2")}c{background:url(data:image/png;base64,AA==)}d{background:url(https://x/y.png)}',
    );
  });

  it('inlines a single-chunk build, copies assets, embeds them on request behind a fetch shim', async () => {
    const m = await load('scripts/inline-build.mjs');
    const build = path.join(tmp, 'build');
    write('build/index.html', '<!doctype html>\r\n<html><head>\r\n<link rel="modulepreload" href="./assets/x.js">\r\n<script type="module" crossorigin src="./assets/index-abc.js"></script>\r\n<link rel="stylesheet" crossorigin href="./assets/index-abc.css">\r\n</head><body></body></html>');
    write('build/assets/index-abc.js', 'console.log("</script>");fetch("assets/models/a.glb");');
    write('build/assets/index-abc.js.map', '{}');
    write('build/assets/index-abc.css', 'body{background:url(bg.png)}');
    write('build/assets/bg.png', Buffer.from([0x89, 0x50]));
    write('build/assets/models/a.glb', Buffer.from([1, 2, 3, 4]));
    const logs: string[] = [];
    const out1 = path.join(tmp, 'out1');
    const r1 = await m.run({ skipBuild: true, inDir: build, outDir: out1, inlineAssets: false, maxInlineMb: 12 }, (l: string) => logs.push(l));
    const html1 = fs.readFileSync(path.join(out1, 'index.html'), 'utf8');
    expect(html1).toContain('<script type="module">console.log("\\x3C/script>")');
    expect(html1).toContain('<style>body{background:url(./assets/bg.png)}</style>');
    expect(html1).not.toMatch(/src="\.\/assets\/index|modulepreload|index-abc\.css/);
    expect(r1.inlined.sort()).toEqual(['assets/index-abc.css', 'assets/index-abc.js']);
    expect(fs.existsSync(path.join(out1, 'assets', 'models', 'a.glb'))).toBe(true);
    expect(fs.existsSync(path.join(out1, 'assets', 'index-abc.js'))).toBe(false);
    expect(fs.existsSync(path.join(out1, 'assets', 'index-abc.js.map'))).toBe(false);

    const out2 = path.join(tmp, 'out2');
    const r2 = await m.run({ skipBuild: true, inDir: build, outDir: out2, inlineAssets: true, maxInlineMb: 12 }, () => undefined);
    const html2 = fs.readFileSync(path.join(out2, 'index.html'), 'utf8');
    expect(r2.embedded.sort()).toEqual(['assets/bg.png', 'assets/models/a.glb']);
    expect(html2).toContain(Buffer.from([1, 2, 3, 4]).toString('base64'));
    expect(html2.indexOf('window.fetch=')).toBeLessThan(html2.indexOf('<script type="module">'));
    expect(fs.existsSync(path.join(out2, 'assets'))).toBe(false); // nothing left beside index.html

    const out3 = path.join(tmp, 'out3');
    const r3 = await m.run({ skipBuild: true, inDir: build, outDir: out3, inlineAssets: true, maxInlineMb: 0.000001 }, (l: string) => logs.push(l));
    expect(r3.embedded).toEqual([]);
    expect(logs.join('\n')).toMatch(/keeping them as files/);
  });

  it('the fetch shim serves embedded assets and passes everything else through', async () => {
    const m = await load('scripts/inline-build.mjs');
    const shim = m.buildFetchShim({ 'assets/models/a.glb': ['model/gltf-binary', Buffer.from([9, 8, 7]).toString('base64')] });
    const calls: string[] = [];
    const win: Record<string, unknown> = { fetch: async (u: string) => (calls.push(String(u)), new Response('net')) };
    const doc = { baseURI: 'https://host.example/game/index.html' };
    new Function('window', 'document', shim)(win, doc);
    const f = win.fetch as (u: string) => Promise<Response>;
    const hit = await f('assets/models/a.glb?v=2');
    expect(hit.headers.get('content-type')).toBe('model/gltf-binary');
    expect(Array.from(new Uint8Array(await hit.arrayBuffer()))).toEqual([9, 8, 7]);
    expect(await (await f('https://host.example/game/assets/models/a.glb')).arrayBuffer()).toBeTruthy();
    expect(await (await f('assets/other.glb')).text()).toBe('net');
    expect(await (await f('https://elsewhere.example/assets/models/a.glb')).text()).toBe('net');
    expect(calls).toEqual(['assets/other.glb', 'https://elsewhere.example/assets/models/a.glb']);
  });

  it('refuses multi-chunk bundles instead of producing a broken single file', async () => {
    const m = await load('scripts/inline-build.mjs');
    write('b/index.html', '<script type="module" src="./assets/index.js"></script>');
    write('b/assets/index.js', 'import("./chunk-1.js").then(()=>{})');
    write('b/assets/chunk-1.js', 'export {}');
    await expect(m.run({ skipBuild: true, inDir: path.join(tmp, 'b'), outDir: path.join(tmp, 'o'), inlineAssets: false, maxInlineMb: 12 }, () => undefined)).rejects.toThrow(
      /imports another chunk/,
    );
    // a string that merely LOOKS like an import of a non-existent file is fine
    write('c/index.html', '<script type="module" src="./assets/index.js"></script>');
    write('c/assets/index.js', 'const doc="import(\\"./not-a-file.js\\")";');
    await expect(m.run({ skipBuild: true, inDir: path.join(tmp, 'c'), outDir: path.join(tmp, 'o2'), inlineAssets: false, maxInlineMb: 12 }, () => undefined)).resolves.toBeTruthy();
  });
});

describe('verify-assets.mjs', () => {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  function fixture() {
    const a = Buffer.from('glb-a');
    const c = Buffer.from('character');
    write('assets/models/objects/a.glb', a);
    write('assets/models/characters/z.glb', c);
    write('assets/manifest.objects.json', JSON.stringify({ version: 1, objects: { a: { file: 'models/objects/a.glb', bytes: a.length, sha256: sha(a) } } }));
    write('assets/manifest.characters.json', '\ufeff' + JSON.stringify({ version: 1, file: 'models/characters/z.glb', bytes: c.length, sha256: sha(c) }).replace(/,/g, ',\r\n'));
    return path.join(tmp, 'assets');
  }

  it('passes on a consistent tree (BOM + CRLF manifests tolerated)', async () => {
    const m = await load('scripts/verify-assets.mjs');
    const r = await m.verifyAssets({ root: fixture() });
    expect(r).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(r.checked.sort()).toEqual(['models/characters/z.glb', 'models/objects/a.glb']);
  });

  it('detects tampering, truncation, missing files, unsafe paths, bad hashes and orphans', async () => {
    const m = await load('scripts/verify-assets.mjs');
    const root = fixture();
    fs.writeFileSync(path.join(root, 'models', 'objects', 'a.glb'), 'glb-A'); // same size, different bytes
    let r = await m.verifyAssets({ root });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/sha256 mismatch/);
    fs.writeFileSync(path.join(root, 'models', 'objects', 'a.glb'), 'glb');
    r = await m.verifyAssets({ root });
    expect(r.errors.join('\n')).toMatch(/size 3 != manifest 5/);
    fs.rmSync(path.join(root, 'models', 'objects', 'a.glb'));
    r = await m.verifyAssets({ root });
    expect(r.errors.join('\n')).toMatch(/file is missing/);
    write('assets/manifest.evil.json', JSON.stringify({ x: { file: '../../etc/passwd', sha256: '0'.repeat(64) }, y: { file: 'C:\\x', sha256: '0'.repeat(64) }, z: { file: 'ok.glb', sha256: 'nothex' } }));
    write('assets/stray.glb', 'x');
    r = await m.verifyAssets({ root });
    expect(r.errors.filter((e: string) => /unsafe path/.test(e))).toHaveLength(2);
    expect(r.errors.join('\n')).toMatch(/malformed sha256/);
    expect(r.warnings.join('\n')).toMatch(/orphan asset not listed in any manifest: stray\.glb/);
    const strict = await m.verifyAssets({ root, strict: true });
    expect(strict.errors.join('\n')).toMatch(/orphan asset/);
    write('assets/manifest.broken.json', '{ nope');
    r = await m.verifyAssets({ root });
    expect(r.errors.join('\n')).toMatch(/unreadable manifest/);
  });

  it('a missing root is an error, not a crash', async () => {
    const m = await load('scripts/verify-assets.mjs');
    const r = await m.verifyAssets({ root: path.join(tmp, 'nope') });
    expect(r.ok).toBe(false);
  });

  // The real public/assets tree is verified by `npm run verify:assets` (and by build-windows.ps1 on both the
  // source and the built copy) rather than here: asset modules regenerate GLBs while other suites run.
});

describe('build-electron-main.mjs', () => {
  it('preload sandbox check: only require("electron") is allowed', async () => {
    const m = await load('scripts/build-electron-main.mjs');
    expect(m.checkPreload('"use strict";const e=require("electron");')).toBeNull();
    expect(m.checkPreload('const e=require("electron");const f=require("./fileStore");')).toMatch(/\.\/fileStore/);
    expect(m.checkPreload("const fs = require('node:fs');")).toMatch(/node:fs/);
    expect(m.checkPreload('import { x } from "electron";')).toMatch(/ESM/);
    expect(m.requiredModules('require("a"); require( \'b\' ); x.require("c")')).toEqual(['a', 'b', 'c']);
  });
});

describe('PowerShell scripts (static checks; no pwsh in this container)', () => {
  /** Minimal PowerShell lexer: strips comments/strings, then checks bracket balance. */
  function balance(src: string): string | null {
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '<' && src[i + 1] === '#') {
        const end = src.indexOf('#>', i + 2);
        if (end < 0) return 'unterminated block comment';
        i = end + 2;
        continue;
      }
      if (c === '#') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (c === "'") {
        i++;
        while (i < src.length && !(src[i] === "'" && src[i + 1] !== "'")) i += src[i] === "'" ? 2 : 1;
        if (i >= src.length) return 'unterminated single-quoted string';
        i++;
        continue;
      }
      if (c === '"') {
        i++;
        while (i < src.length && src[i] !== '"') i += src[i] === '`' ? 2 : 1;
        if (i >= src.length) return 'unterminated double-quoted string';
        i++;
        continue;
      }
      if (c === '`') {
        i += 2;
        continue;
      }
      if ('({['.includes(c)) stack.push(c);
      else if (')}]'.includes(c)) {
        if (stack.pop() !== pairs[c]) return `unbalanced ${c} at offset ${i}`;
      }
      i++;
    }
    return stack.length ? `unclosed ${stack.join('')}` : null;
  }

  for (const name of ['build-windows.ps1', 'dev-electron.ps1']) {
    it(`${name}: ASCII-only, CRLF, strict mode, stop-on-error, balanced`, () => {
      const buf = fs.readFileSync(path.join(ROOT, 'scripts', name));
      expect(buf.every((b) => b < 0x80), 'non-ASCII bytes break Windows PowerShell 5.1 without a BOM').toBe(true);
      const src = buf.toString('utf8');
      expect(src.split('\n').every((l, idx, all) => idx === all.length - 1 || l.endsWith('\r'))).toBe(true);
      expect(src).toMatch(/Set-StrictMode -Version Latest/);
      expect(src).toMatch(/\$ErrorActionPreference = 'Stop'/);
      expect(balance(src)).toBeNull();
      expect(src).not.toMatch(/\bnpx\b/); // always the locally pinned toolchain
    });
  }

  it('build-windows.ps1: native stderr never aborts a step (PS 5.1 NativeCommandError); locked release dir is retried', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-windows.ps1'), 'utf8').replace(/\r\n/g, '\n');
    const step = /function Invoke-Step \{([\s\S]*?)\n\}\n/.exec(src)?.[1] ?? '';
    // 'Continue' is set BEFORE the command runs and 'Stop' restored right after; success is the exit code.
    const iContinue = step.indexOf("$ErrorActionPreference = 'Continue'");
    const iRun = step.indexOf('& $Command');
    const iCode = step.indexOf('$code = $LASTEXITCODE');
    const iStop = step.indexOf("$ErrorActionPreference = 'Stop'");
    expect(iContinue).toBeGreaterThan(-1);
    expect(iContinue).toBeLessThan(iRun);
    expect(iRun).toBeLessThan(iCode);
    expect(iCode).toBeLessThan(iStop);
    expect(step).toMatch(/if \(\$code -ne 0\)/);
    expect(step).toMatch(/PSNativeCommandUseErrorActionPreference = \$false/); // PS 7.3+ opt-in stays off
    expect(src).toMatch(/function Remove-DirectoryWithRetry/);
    expect(src).toMatch(/Remove-DirectoryWithRetry -Path \$releaseDir/);
    expect(src).not.toMatch(/Remove-Item -LiteralPath \$releaseDir/); // only through the retrying helper
  });

  it('build-windows.ps1 checks exit codes of native commands and hashes the artifact', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-windows.ps1'), 'utf8');
    expect(src).toMatch(/\$code -ne 0|\$LASTEXITCODE -ne 0/);
    expect(src).toMatch(/Get-FileHash -LiteralPath \$installer\.FullName -Algorithm SHA256/);
    for (const step of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build', 'npm run electron:build-main', 'electron-builder/cli.js --win nsis --x64']) {
      expect(src).toContain(step);
    }
    expect(src).toMatch(/\[version\]'22\.12\.0'/);
  });

  it('the lexer itself catches breakage', () => {
    expect(balance('if ($a) { "x" ')).toMatch(/unclosed/);
    expect(balance("Write-Host 'it''s fine' { }")).toBeNull();
    expect(balance('"unterminated')).toMatch(/unterminated/);
    expect(balance('<# comment { #> ( )')).toBeNull();
  });
});

describe('package.json / config invariants', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  it('keeps the contract pins exactly', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(all).toMatchObject({
      three: '0.180.0',
      preact: '10.29.8',
      vite: '7.3.7',
      vitest: '3.2.7',
      typescript: '5.9.3',
      '@types/three': '0.180.0',
      '@types/node': '22.20.5',
    });
    for (const [name, v] of Object.entries(all)) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/); // exact versions only
  });
  it('exposes the platform scripts and the electron entry', () => {
    for (const s of ['electron:build-main', 'electron:dev', 'dist:win', 'build:single', 'typecheck', 'verify:assets']) expect(pkg.scripts[s], s).toBeTruthy();
    expect(pkg.main).toBe('electron/dist/main.js');
  });
  it('electron-builder config: per-user NSIS x64, asar, keeps saves on uninstall, ships only built files', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'electron-builder.json'), 'utf8'));
    expect(cfg.appId).toBe('com.afterlifelease.game');
    expect(cfg.productName).toBe('Afterlife Lease');
    expect(cfg.asar).toBe(true);
    expect(cfg.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(cfg.nsis.perMachine).toBe(false);
    expect(cfg.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(cfg.files).toEqual(expect.arrayContaining(['dist/**/*', 'electron/dist/**/*']));
    expect(cfg.electronFuses.runAsNode).toBe(false);
    expect(cfg.win.artifactName).toMatch(/\$\{version\}/);
  });
  it('ship-safety: per-user without elevation, fuses locked down, no auto-update, nothing from node_modules, icon present', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'electron-builder.json'), 'utf8'));
    expect(cfg.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: false });
    expect(cfg.win.requestedExecutionLevel).toBe('asInvoker');
    expect(cfg.electronFuses).toEqual({
      runAsNode: false,
      enableEmbeddedAsarIntegrityValidation: true,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    });
    // Auto-update is absent: nothing is published and no updater is shipped.
    expect(cfg.publish).toBeNull();
    expect(JSON.stringify(pkg)).not.toMatch(/electron-updater|update-electron-app/);
    // three/preact are bundled by Vite into dist/ and are real `dependencies` (so `npm audit --omit=dev` sees them —
    // security review D-8). electron-builder would copy production node_modules on its own; the leading "!**/*"
    // excludes every node-module file (tests/unit/electron/packaging.w106.test.ts proves it with electron-builder's
    // matchers). Source maps stay out of the package.
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['preact', 'three']);
    expect(cfg.files).toEqual(['!**/*', 'dist/**/*', '!dist/**/*.map', 'electron/dist/**/*', 'package.json']);
    expect(cfg.extraMetadata.main).toBe(pkg.main);
    // The icon electron-builder uses for the exe, installer and uninstaller exists and is a real ICO.
    for (const p of [cfg.win.icon, cfg.nsis.installerIcon, cfg.nsis.uninstallerIcon]) {
      expect(p).toBe('electron/build/icon.ico');
      const ico = fs.readFileSync(path.join(ROOT, p));
      expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    }
    expect(cfg.directories.buildResources).toBe('electron/build');
  });
  it("electron-builder's own schema validator accepts the config (and rejects a bogus option)", async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(path.join(ROOT, 'package.json'));
    const { validateConfiguration } = req('app-builder-lib/out/util/config/config.js');
    const { DebugLogger } = req('builder-util');
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'electron-builder.json'), 'utf8'));
    delete cfg.$schema;
    await expect(validateConfiguration(cfg, new DebugLogger(false))).resolves.toBeUndefined();
    await expect(validateConfiguration({ ...cfg, nsis: { ...cfg.nsis, bogus: 1 } }, new DebugLogger(false))).rejects.toThrow(/Invalid configuration/);
  });
});
