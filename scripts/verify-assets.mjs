#!/usr/bin/env node
/**
 * Verify game assets against their manifests' SHA-256 (and byte size) entries.
 *
 * Discovers every `manifest*.json` directly under the assets root (default public/assets; use
 * `--root dist/assets` to verify a finished build) and checks every entry shaped like
 * { file: "<path relative to the manifest>", sha256: "<64 hex>", bytes?: <n> } anywhere inside it
 * (manifest.objects.json -> objects.<id>, manifest.characters.json -> top level, future manifests
 * alike). Fails on missing files, size/hash mismatches, unsafe paths (absolute, '..', backslashes)
 * and unreadable manifests. Model/texture/audio files that no manifest lists are reported as
 * orphans (an error with --strict).
 *
 * Usage: node scripts/verify-assets.mjs [--root <dir>] [--strict] [--json]
 * Exit code: 0 ok, 1 verification failed, 2 usage error.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKED_EXT = /\.(glb|gltf|bin|ktx2|png|jpe?g|webp|ogg|mp3|wav|m4a|opus|flac|hdr)$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

export function sha256File(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('hex')));
  });
}

/** Collect { file, sha256, bytes?, where } entries from any JSON structure. */
export function collectEntries(json, where = '$') {
  const out = [];
  const visit = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      if (typeof v.file === 'string' && typeof v.sha256 === 'string') {
        out.push({ file: v.file, sha256: v.sha256, bytes: typeof v.bytes === 'number' ? v.bytes : null, where: path });
      }
      for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') visit(x, `${path}.${k}`);
    }
  };
  visit(json, where);
  return out;
}

export function unsafePath(p) {
  return p.length === 0 || p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').some((s) => s === '..' || s === '');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export async function verifyAssets({ root = join(projectRoot, 'public', 'assets'), strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const checked = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { ok: false, errors: [`assets root ${root} does not exist`], warnings, checked, manifests: [] };
  }
  const manifests = readdirSync(root).filter((n) => /^manifest.*\.json$/i.test(n)).sort();
  if (manifests.length === 0) warnings.push(`no manifest*.json found in ${root}`);
  const referenced = new Set();
  for (const m of manifests) {
    const mPath = join(root, m);
    let json;
    try {
      json = JSON.parse(readFileSync(mPath, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      errors.push(`${m}: unreadable manifest (${e instanceof Error ? e.message : e})`);
      continue;
    }
    const entries = collectEntries(json);
    if (entries.length === 0) warnings.push(`${m}: no {file, sha256} entries`);
    for (const e of entries) {
      const label = `${m} ${e.where} (${e.file})`;
      if (unsafePath(e.file)) {
        errors.push(`${label}: unsafe path`);
        continue;
      }
      if (!HEX64.test(e.sha256)) {
        errors.push(`${label}: malformed sha256`);
        continue;
      }
      const full = join(dirname(mPath), ...e.file.split('/'));
      referenced.add(resolve(full));
      if (!existsSync(full) || !statSync(full).isFile()) {
        errors.push(`${label}: file is missing`);
        continue;
      }
      const size = statSync(full).size;
      if (e.bytes !== null && e.bytes !== size) {
        errors.push(`${label}: size ${size} != manifest ${e.bytes}`);
        continue;
      }
      const actual = await sha256File(full);
      if (actual.toLowerCase() !== e.sha256.toLowerCase()) errors.push(`${label}: sha256 mismatch (got ${actual})`);
      else checked.push(e.file);
    }
  }
  for (const f of walk(root)) {
    if (!TRACKED_EXT.test(f) || referenced.has(resolve(f))) continue;
    const rel = relative(root, f).split(sep).join('/');
    (strict ? errors : warnings).push(`orphan asset not listed in any manifest: ${rel}`);
  }
  return { ok: errors.length === 0, errors, warnings, checked, manifests };
}

/** CLI entry: returns the exit code (0 ok, 1 verification failed, 2 usage error). */
export async function cli(argv) {
  const opts = { root: undefined, strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') opts.root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--strict') opts.strict = true;
    else if (argv[i] === '--json') opts.json = true;
    else {
      console.error(`unknown argument ${argv[i]}`);
      return 2;
    }
  }
  const r = await verifyAssets({ root: opts.root, strict: opts.strict });
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else {
    // One write per stream: thousands of small writes to a pipe are slow and easy to interleave.
    if (r.warnings.length > 0) console.warn(r.warnings.map((w) => `warning: ${w}`).join('\n'));
    if (r.errors.length > 0) console.error(r.errors.map((e) => `ERROR: ${e}`).join('\n'));
    console.log(`${r.ok ? 'OK' : 'FAILED'}: ${r.checked.length} asset(s) verified across ${r.manifests.length} manifest(s), ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // process.exitCode, never process.exit(): stdout/stderr to a PIPE are asynchronous on POSIX, and exiting
  // right after printing truncates large reports (CI logs, --json consumers) at the pipe buffer.
  cli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`verify-assets crashed: ${e instanceof Error ? e.stack : e}`);
      process.exitCode = 1;
    },
  );
}
