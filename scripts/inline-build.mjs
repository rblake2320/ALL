#!/usr/bin/env node
/**
 * Single-file web build for sharing: dist-single/index.html with ALL JavaScript and CSS inlined.
 *
 *   node scripts/inline-build.mjs                    vite build --mode single (one JS chunk, one CSS
 *                                                    file) into a temp dir, then inline into dist-single/
 *   node scripts/inline-build.mjs --skip-build --in <dir>   inline an existing single-mode build
 *   node scripts/inline-build.mjs --inline-assets    ALSO embed assets (GLB/textures/audio) as base64
 *                                                    behind a fetch() shim when they total < 12 MB
 *                                                    (--max-inline-mb N); otherwise they stay files
 *
 * Without --inline-assets, public assets stay as files next to index.html (dist-single/assets/...),
 * referenced relatively — zip the folder to share it. With it (and under the cap) index.html alone is
 * the whole game. Inline <script>/<style> contents are escaped so '</script', '<!--' or '</style'
 * inside the bundle cannot terminate or corrupt the element.
 *
 * The output folder is DELETED and rebuilt, so it must provably be ours (assertSafeOutDir): the default
 * dist-single/, a new or empty folder, or one carrying our marker file from an earlier run. Drive roots,
 * the home folder, the project (or any ancestor), the input build (or anything containing it / inside it)
 * and non-empty foreign folders are refused before a single file is touched.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, parse, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Written into every output folder: proves a later run may delete and rebuild it. */
export const OUTPUT_MARKER = '.afterlife-single-build';

const isInside = (child, parent) => {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

/**
 * Throw unless `outDir` may be wiped and rebuilt (see module doc). Returns the resolved path.
 * `inDir` is the build being inlined (null while it is still being produced in a temp folder).
 */
export function assertSafeOutDir(outDir, { inDir = null, projectRoot = root } = {}) {
  const out = resolve(outDir);
  const refuse = (why) => {
    throw new Error(`refusing to use ${out} as the output folder: ${why} (it would be deleted and rebuilt)`);
  };
  if (parse(out).root === out) refuse('it is a drive / file-system root');
  const home = homedir();
  if (home && isInside(resolve(home), out)) refuse('it is (or contains) your home folder');
  if (isInside(resolve(projectRoot), out)) refuse('it is (or contains) the project');
  if (inDir) {
    const input = resolve(inDir);
    if (isInside(input, out)) refuse('it is (or contains) the build being inlined');
    if (isInside(out, input)) refuse('it is inside the build being inlined');
  }
  const defaultOut = join(resolve(projectRoot), 'dist-single');
  if (existsSync(out)) {
    if (!statSync(out).isDirectory()) refuse('it is a file');
    const ours = out === defaultOut || readdirSync(out).length === 0 || existsSync(join(out, OUTPUT_MARKER));
    if (!ours) refuse('it is a non-empty folder this tool did not create');
  }
  return out;
}

export const INLINE_ASSET_TYPES = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

/** Make JS safe inside <script>...</script>: the HTML tokenizer must never see '</script', '<!--' or '<script'. */
export function escapeInlineScript(js) {
  // \x3C is '<' in every JS context where these sequences can legally appear (strings, template
  // literals, regular expressions, comments); outside them they are syntax errors in a module anyway.
  return js.replace(/<(\/?script|!--)/gi, '\\x3C$1');
}

/** Make CSS safe inside <style>...</style>. */
export function escapeInlineStyle(css) {
  return css.replace(/<\/style/gi, '\\3C /style');
}

/** Re-base relative url(...) references from the CSS file's folder to the HTML document's folder. */
export function rewriteCssUrls(css, cssDirFromHtml) {
  if (!cssDirFromHtml || cssDirFromHtml === '.') return css;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, q, ref) => {
    if (/^(data:|blob:|https?:|\/|#)/i.test(ref)) return whole;
    const joined = posix.normalize(posix.join(cssDirFromHtml, ref));
    return `url(${q}${joined.startsWith('.') ? joined : `./${joined}`}${q})`;
  });
}

/** Tiny fetch() shim serving embedded assets for same-folder relative URLs. */
export function buildFetchShim(assets) {
  const table = JSON.stringify(assets);
  return `(()=>{const A=${table};const F=window.fetch.bind(window);const B=new URL('.',document.baseURI).href;` +
    `window.fetch=function(i,o){try{const u=new URL(typeof i==='string'?i:(i&&i.url)||String(i),document.baseURI);` +
    `if(u.href.startsWith(B)){const k=decodeURIComponent(u.href.slice(B.length).split(/[?#]/)[0]);const h=A[k];` +
    `if(h){const s=atob(h[1]);const b=new Uint8Array(s.length);for(let n=0;n<s.length;n++)b[n]=s.charCodeAt(n);` +
    `return Promise.resolve(new Response(b,{status:200,headers:{'content-type':h[0]}}));}}}catch(e){}return F(i,o);};})();`;
}

/**
 * The built index.html carries the web CSP as a <meta> tag (vite.config.ts cspMetaPlugin, script-src 'self'),
 * which would block every script this tool inlines. Add the exact SHA-256 of each inline <script> body to
 * script-src — those scripts and nothing else may run (no 'unsafe-inline'). A page without a CSP meta tag is
 * returned unchanged. Must run LAST: any later change to an inline script invalidates its hash.
 */
export function addCspScriptHashes(html) {
  const metaRe = /<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi;
  const metas = html.match(metaRe) ?? [];
  if (metas.length === 0) return { html, hashes: [] };
  if (metas.length > 1) throw new Error('index.html has more than one CSP meta tag');
  const hashes = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1]) || m[2].length === 0) continue;
    const h = `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`;
    if (!hashes.includes(h)) hashes.push(h);
  }
  if (hashes.length === 0) return { html, hashes };
  const out = html.replace(metaRe, (tag) =>
    tag.replace(/\bcontent\s*=\s*"([^"]*)"/i, (_w, policy) => {
      const parts = policy.split(';').map((d) => d.trim()).filter(Boolean);
      const i = parts.findIndex((d) => /^script-src\s/i.test(d));
      if (i < 0) throw new Error('CSP meta tag has no script-src directive');
      parts[i] = `${parts[i]} ${hashes.join(' ')}`;
      return `content="${parts.join('; ')}"`;
    }),
  );
  return { html: out, hashes };
}

const ATTR = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(tag);
  return m ? m[2] : null;
};
const isLocal = (ref) => !!ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
const normRef = (ref) => posix.normalize(ref.replace(/^\.\//, '').split(/[?#]/)[0]);

/** Relative module specifiers (static/dynamic imports) in bundled JS. */
export function relativeImports(js) {
  const out = [];
  const re = /\bimport\s*\(\s*(["'`])(\.{1,2}\/[^"'`]+)\1|\bfrom\s*(["'])(\.{1,2}\/[^"']+)\3|\bimport\s*(["'])(\.{1,2}\/[^"']+)\5/g;
  let m;
  while ((m = re.exec(js)) !== null) out.push(m[2] ?? m[4] ?? m[6]);
  return out;
}

/**
 * Inline local module scripts and stylesheets of `html`. `read(relPath)` returns file text,
 * `exists(relPath)` whether the build contains that file. Returns { html, inlined: [relPaths] }.
 * Throws if the bundle imports another chunk that exists in the build (it would not load inline).
 */
export function inlineHtml(html, read, exists = () => false) {
  const inlined = [];
  let out = html.replace(/<link\b[^>]*\brel\s*=\s*(["'])modulepreload\1[^>]*>\s*/gi, '');
  out = out.replace(/<script\b([^>]*)>\s*<\/script>/gi, (whole, attrs) => {
    const src = ATTR(whole, 'src');
    if (!isLocal(src)) return whole;
    const rel = normRef(src);
    const js = read(rel);
    const chunk = relativeImports(js)
      .map((spec) => posix.normalize(posix.join(posix.dirname(rel), spec)))
      .find((target) => exists(target));
    if (chunk) throw new Error(`${rel} imports another chunk (${chunk}); build with --mode single so the bundle is one chunk`);
    inlined.push(rel);
    const type = ATTR(whole, 'type');
    return `<script${type ? ` type="${type}"` : ''}>${escapeInlineScript(js)}</script>`;
  });
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if ((ATTR(tag, 'rel') ?? '').toLowerCase() !== 'stylesheet') return tag;
    const href = ATTR(tag, 'href');
    if (!isLocal(href)) return tag;
    const rel = normRef(href);
    const css = rewriteCssUrls(read(rel), posix.dirname(rel));
    inlined.push(rel);
    return `<style>${escapeInlineStyle(css)}</style>`;
  });
  return { html: out, inlined };
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function parseArgs(argv) {
  const opts = { skipBuild: false, inDir: null, outDir: join(root, 'dist-single'), inlineAssets: false, maxInlineMb: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-build') opts.skipBuild = true;
    else if (a === '--in') opts.inDir = resolve(argv[++i]);
    else if (a === '--out') opts.outDir = resolve(argv[++i]);
    else if (a === '--inline-assets') opts.inlineAssets = true;
    else if (a === '--max-inline-mb') opts.maxInlineMb = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (opts.skipBuild && !opts.inDir) throw new Error('--skip-build requires --in <dir>');
  if (!(opts.maxInlineMb > 0)) throw new Error('--max-inline-mb must be a positive number');
  return opts;
}

export async function run(opts, log = console.log) {
  let inDir = opts.inDir;
  let staging = null;
  // Before ANY work (and before any deletion): the output folder must provably be ours.
  assertSafeOutDir(opts.outDir, { inDir: opts.skipBuild ? inDir : null });
  if (!opts.skipBuild) {
    staging = mkdtempSync(join(tmpdir(), 'afterlife-single-'));
    const { build } = await import('vite');
    log('[single] vite build --mode single');
    await build({ root, mode: 'single', logLevel: 'warn', build: { outDir: staging, emptyOutDir: true } });
    inDir = staging;
  }
  try {
    const htmlPath = join(inDir, 'index.html');
    if (!existsSync(htmlPath)) throw new Error(`${htmlPath} not found`);
    const { html: inlinedHtml, inlined } = inlineHtml(
      readFileSync(htmlPath, 'utf8'),
      (rel) => {
        const p = join(inDir, ...rel.split('/'));
        if (!existsSync(p)) throw new Error(`referenced file ${rel} is missing from the build`);
        return readFileSync(p, 'utf8');
      },
      (rel) => !rel.startsWith('..') && existsSync(join(inDir, ...rel.split('/'))),
    );
    let html = inlinedHtml;
    assertSafeOutDir(opts.outDir, { inDir }); // re-checked against the real input (staging) right before deleting
    rmSync(opts.outDir, { recursive: true, force: true });
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, OUTPUT_MARKER), 'Created by scripts/inline-build.mjs; this folder is deleted and rebuilt on every run.\n');
    const skip = new Set(['index.html', OUTPUT_MARKER, ...inlined]);
    const files = walk(inDir).filter((f) => !skip.has(f) && !f.endsWith('.map'));
    let embedded = [];
    if (opts.inlineAssets) {
      const candidates = files.filter((f) => INLINE_ASSET_TYPES[extname(f).toLowerCase()]);
      const total = candidates.reduce((n, f) => n + statSync(join(inDir, ...f.split('/'))).size, 0);
      const cap = opts.maxInlineMb * 1024 * 1024;
      if (total > cap) {
        log(`[single] assets total ${(total / 1048576).toFixed(1)} MB > ${opts.maxInlineMb} MB: keeping them as files`);
      } else {
        const table = {};
        for (const f of candidates) table[f] = [INLINE_ASSET_TYPES[extname(f).toLowerCase()], readFileSync(join(inDir, ...f.split('/'))).toString('base64')];
        const shim = `<script>${escapeInlineScript(buildFetchShim(table))}</script>`;
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}\n${shim}`) : shim + html;
        embedded = candidates;
        log(`[single] embedded ${candidates.length} asset(s), ${(total / 1048576).toFixed(1)} MB`);
      }
    }
    const csp = addCspScriptHashes(html);
    html = csp.html;
    if (csp.hashes.length > 0) log(`[single] CSP: allowed ${csp.hashes.length} inline script(s) by SHA-256`);
    const embeddedSet = new Set(embedded);
    let copied = 0;
    for (const f of files) {
      if (embeddedSet.has(f)) continue;
      const dest = join(opts.outDir, ...f.split('/'));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(inDir, ...f.split('/')), dest);
      copied++;
    }
    writeFileSync(join(opts.outDir, 'index.html'), html);
    const size = Buffer.byteLength(html);
    log(`[single] wrote ${relative(root, join(opts.outDir, 'index.html')) || 'index.html'} (${(size / 1048576).toFixed(2)} MB, inlined ${inlined.length} file(s), ${copied} asset file(s) alongside)`);
    return { html, inlined, copied, embedded };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // exitCode (not process.exit): output written to a pipe must drain before the process ends.
  Promise.resolve()
    .then(() => run(parseArgs(process.argv.slice(2))))
    .catch((e) => {
      console.error(`[single] failed: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    });
}
