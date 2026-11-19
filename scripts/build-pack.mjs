#!/usr/bin/env node
/**
 * Build + sign the first-party `house-brands` content pack (docs/MONETIZATION.md §4–§5).
 *
 *   node scripts/build-pack.mjs (--key <private-key.json> | --dev) [--out <dir>] [--zip]
 *
 * Output (default dist-packs/house-brands/, gitignored): pack.json, pack.sig, assets/decals/*.svg, assets/ads/*.svg
 * (plus house-brands.zip with --zip). Brand data comes from src/economy/data/houseBrands.json — the same list the game
 * ships built in, so the pack and the code can never disagree.
 *
 * Signing: Ed25519 over utf8(canonicalJson(pack.json)) (sorted keys, no whitespace — identical to
 * src/persistence/canonicalJson.ts for this plain data). Key file = { keyId, publicKey (raw b64), privateKey (pkcs8 b64) }.
 *   - The signing key is ALWAYS explicit (security review L-8): with neither --key nor --dev the script refuses to sign
 *     (exit code 2, nothing written) instead of silently falling back to the dev key.
 *   - DEV: --dev signs with .keys/dev-publisher.ed25519.json (generated on first run; gitignored, NEVER commit it) with
 *     keyId 'afterlife-dev'. Start `vite dev` with VITE_DEV_PACK_PUBKEY=<publicKey> to trust it. Production builds
 *     never trust it.
 *   - PRODUCTION: pass --key <path> to the release key from the signing environment (keyId 'afterlife-first-party');
 *     its public key goes into src/packs/keys.ts PRODUCTION_PUBLISHER_KEYS (placeholder until generated).
 */
import { createHash, generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const USAGE = 'usage: node scripts/build-pack.mjs (--key <private-key.json> | --dev) [--out <dir>] [--zip]';
function refuse(msg) {
  console.error(`[build-pack] ${msg}\n${USAGE}`);
  process.exit(2);
}
const KEY = opt('--key');
const DEV = args.includes('--dev');
if (args.includes('--key') && (KEY === undefined || KEY.startsWith('--'))) refuse('--key needs a path to a key file.');
if (KEY !== undefined && DEV) refuse('pass either --key or --dev, not both.');
if (KEY === undefined && !DEV) refuse('refusing to sign without an explicit key: pass --key <release key> or --dev (dev key; never shipped).');
const OUT = resolve(opt('--out') ?? join(ROOT, 'dist-packs', 'house-brands'));
const ZIP = args.includes('--zip');
const DEV_KEY = join(ROOT, '.keys', 'dev-publisher.ed25519.json');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(ROOT, 'src/economy/data/houseBrands.json'), 'utf8'));

function canonical(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Deterministic text-logo SVG (original artwork — house brands only). */
function logoSvg(brand, [bg, fg], w = 256, h = 128) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="18" fill="${bg}" stroke="${fg}" stroke-width="6"/><text x="${w / 2}" y="${h / 2 + 10}" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.round(h / 4)}" font-weight="700" fill="${fg}">${esc(brand)}</text></svg>\n`;
}

function loadKey() {
  const path = KEY !== undefined ? resolve(KEY) : DEV_KEY;
  if (DEV) console.warn('[build-pack] WARNING: signing with the DEV key (--dev) — this pack is for local testing only; production builds reject it.');
  if (!existsSync(path)) {
    if (KEY) throw new Error(`key file not found: ${path}`);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const rec = { keyId: 'afterlife-dev', publicKey: raw.toString('base64'), privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), note: 'DEV ONLY — never commit, never ship.' };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
    console.log(`[build-pack] generated a dev signing key at ${path}`);
  }
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof rec.keyId !== 'string' || typeof rec.privateKey !== 'string' || typeof rec.publicKey !== 'string') throw new Error('bad key file');
  return { ...rec, key: createPrivateKey({ key: Buffer.from(rec.privateKey, 'base64'), format: 'der', type: 'pkcs8' }) };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

/** Minimal deterministic zip writer (deflate, fixed timestamp). */
function zip(files) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nameBuf);
    off += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

function main() {
  const key = loadKey();
  const assets = new Map();
  for (const s of data.brandSkins) for (const p of Object.values(s.decals ?? {})) assets.set(p, Buffer.from(logoSvg(s.brand, data.colors[s.brand] ?? ['#222222', '#eeeeee'])));
  for (const c of data.adCreatives) assets.set(c.image, Buffer.from(logoSvg(c.brand, data.colors[c.brand] ?? ['#222222', '#eeeeee'], c.surface === 'billboard' ? 512 : 256, c.surface === 'billboard' ? 192 : 128)));
  const sorted = [...assets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manifest = {
    format: 'afterlife-lease-pack',
    formatVersion: 1,
    id: 'house-brands',
    version: pkg.version,
    author: 'Afterlife Lease Developers',
    publisher: key.keyId,
    ageRating: 'E10+',
    requires: { engine: `>=${pkg.version}` },
    contents: { brandSkins: data.brandSkins },
    assets: sorted.map(([path, buf]) => ({ path, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length })),
  };
  const payload = Buffer.from(canonical(manifest), 'utf8');
  const sig = { alg: 'Ed25519', keyId: key.keyId, sig: sign(null, payload, key.key).toString('base64') };
  const files = [['pack.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')], ['pack.sig', Buffer.from(JSON.stringify(sig) + '\n')], ...sorted];

  // Build into a temp dir, then swap in (a half-written pack is never left behind).
  const tmp = `${OUT}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  for (const [p, buf] of files) {
    mkdirSync(dirname(join(tmp, p)), { recursive: true });
    writeFileSync(join(tmp, p), buf);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(dirname(OUT), { recursive: true });
  renameSync(tmp, OUT);
  if (ZIP) writeFileSync(`${OUT}.zip`, zip(files));
  console.log(`[build-pack] ${manifest.id}@${manifest.version}: ${sorted.length} assets, signed by ${key.keyId} → ${OUT}${ZIP ? ` (+ ${OUT}.zip)` : ''}`);
  console.log(`[build-pack] public key (${key.keyId}): ${key.publicKey}`);
}

main();
