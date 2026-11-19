import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { SaxesParser } from 'saxes';
import { z } from 'zod/v4';
import { verifyPack, PackRegistry, validateManifest, PACK_FORMAT, PACK_LIMITS, checkPackPath,
  canonicalJson, HOUSE_BRANDS, brandSkinFor, PHYSICAL_SPECS } from './generated/engine.mjs';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const kit = fileURLToPath(new URL('./', import.meta.url));
export const sha = data => createHash('sha256').update(data).digest('hex');
const loadedEngineSha256 = sha(fs.readFileSync(path.join(kit, 'generated/engine.mjs')));
const loadedKitInputs = Object.fromEntries(['build.mjs', 'engine.ts', 'core.mjs', 'cli.mjs', 'mcp.mjs', 'checks.mjs', 'privacy.mjs', 'demo.mjs', 'package.json', 'package-lock.json']
  .map(name => [name, sha(fs.readFileSync(path.join(kit, name)))]));
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/);
const shortText = max => z.string().min(1).max(max).regex(/^[^\u0000-\u001f\u007f<>]*$/u);
export const initSchema = z.strictObject({ id: identifier, author: shortText(80), brand: z.enum(HOUSE_BRANDS),
  displayName: shortText(60), flavorText: shortText(200) });
export const draftSchema = z.strictObject({ id: identifier });
export const artifactSchema = z.strictObject({ artifact: z.string().regex(/^[a-z0-9-]{2,180}$/) });
const decoder = new TextDecoder('utf-8', { fatal: true });
export function parseJson(bytes) {
  if (bytes.length > PACK_LIMITS.maxManifestBytes) throw new Error('JSON exceeds manifest size limit');
  const text = decoder.decode(bytes);
  return JSON.parse(text, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Reserved JSON key');
    return value;
  });
}

// Deliberately small, static SVG subset. No CSS, URL references, scripts, entities,
// processing instructions, embedded images or foreign content. Engine hash checks
// alone do not make artwork safe to preview in a browser.
export function validateSvg(bytes) {
  if (bytes.length > 256 * 1024) throw new Error('SVG exceeds 256 KiB');
  const parser = new SaxesParser({ xmlns: true });
  const numeric = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'font-size']);
  const tags = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'title', 'desc']);
  let depth = 0, elements = 0, textLength = 0;
  parser.on('error', error => { throw error; });
  parser.on('doctype', () => { throw new Error('SVG DOCTYPE is forbidden'); });
  parser.on('processinginstruction', () => { throw new Error('SVG processing instructions are forbidden'); });
  parser.on('opentag', node => {
    if (++elements > 1000 || ++depth > 32) throw new Error('SVG complexity limit');
    if (node.uri !== 'http://www.w3.org/2000/svg' || node.prefix || !tags.has(node.local) || (depth === 1 && node.local !== 'svg')) throw new Error('SVG element not allowed');
    for (const [name, attr] of Object.entries(node.attributes)) {
      const value = attr.value;
      if (name === 'xmlns' && value === 'http://www.w3.org/2000/svg' && depth === 1) continue;
      if (attr.prefix || attr.uri || value.length > 6144) throw new Error('SVG attribute not allowed');
      if (numeric.has(name) && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Math.abs(Number(value)) <= 4096 && (!['width', 'height'].includes(name) || Number(value) > 0)) continue;
      if (name === 'viewBox' && /^[-+\d.eE ,]+$/.test(value)) {
        const nums = value.trim().split(/[ ,]+/).map(Number);
        if (nums.length === 4 && nums.every(n => Number.isFinite(n) && Math.abs(n) <= 4096) && nums[2] > 0 && nums[3] > 0) continue;
      }
      if (['fill', 'stroke'].includes(name) && /^(#[0-9a-f]{6}|none)$/i.test(value)) continue;
      if (name === 'd' && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+., -]+$/.test(value)) continue;
      if (name === 'points' && /^[-+\d.eE ,]+$/.test(value)) continue;
      if (name === 'text-anchor' && ['start', 'middle', 'end'].includes(value)) continue;
      if (name === 'font-family' && ['serif', 'sans-serif', 'monospace'].includes(value)) continue;
      if (name === 'font-weight' && ['normal', 'bold', '400', '700'].includes(value)) continue;
      throw new Error(`SVG attribute not allowed: ${name}`);
    }
  });
  parser.on('closetag', () => { depth--; });
  parser.on('text', text => { if ((textLength += text.length) > 8000) throw new Error('SVG text limit'); });
  parser.on('cdata', () => { throw new Error('SVG CDATA is forbidden'); });
  parser.write(decoder.decode(bytes)).close();
  if (elements === 0) throw new Error('SVG root missing');
}

export function contract() {
  return { format: PACK_FORMAT, formatVersion: 1, supported: ['brandSkins'],
    notAdmitted: ['objects', 'quests', 'lots', 'bodies', 'creatures'], futureTask: 'W-084',
    brands: HOUSE_BRANDS, targetObjects: PHYSICAL_SPECS.map(p => p.id), limits: PACK_LIMITS, artwork: 'static SVG subset; see contributor guide',
    trust: 'Unsigned offline Creator mode only. No signing keys, online admission or publishing in this kit.' };
}

function checkedPath(root, relative = '') {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes creator workspace');
  let cursor = root;
  for (const part of ['', ...rel.split(path.sep).filter(Boolean)]) {
    if (part) cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) throw new Error('Workspace entry missing');
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Links and junctions are forbidden');
    const real = fs.realpathSync.native(cursor);
    const realRel = path.relative(root, real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error('Resolved path escapes workspace');
  }
  return target;
}

export function readPack(root, relative) {
  const base = checkedPath(root, relative), files = new Map();
  let total = 0, entries = 0;
  const visit = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (++entries > PACK_LIMITS.maxFiles) throw new Error('Too many pack filesystem entries');
      const p = prefix + name;
      const valid = checkPackPath(p);
      if (!valid.ok) throw new Error(valid.reason);
      const full = checkedPath(root, path.relative(root, path.join(dir, name)));
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) { visit(full, p + '/'); continue; }
      if (!stat.isFile()) throw new Error('Only regular files are allowed');
      if (stat.nlink !== 1) throw new Error('Hard links are forbidden');
      if (stat.size > PACK_LIMITS.maxFileBytes || (total += stat.size) > PACK_LIMITS.maxTotalBytes || files.size >= PACK_LIMITS.maxFiles) throw new Error('Pack exceeds resource limits');
      const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const after = fs.fstatSync(fd);
        if (after.nlink !== 1) throw new Error('Hard links are forbidden');
        if (!after.isFile() || after.size !== stat.size || after.ino !== stat.ino || after.dev !== stat.dev) throw new Error('File changed while opening');
        const data = Buffer.alloc(stat.size + 1);
        let length = 0, n;
        while (length < data.length && (n = fs.readSync(fd, data, length, data.length - length, null)) > 0) length += n;
        const final = fs.fstatSync(fd);
        if (final.nlink !== 1) throw new Error('Hard links are forbidden');
        if (length !== stat.size || final.size !== stat.size) throw new Error('File changed while reading');
        files.set(p, data.subarray(0, length));
      } finally { fs.closeSync(fd); }
    }
  };
  visit(base);
  return files;
}

export function fingerprint(files) {
  return sha(canonicalJson([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, data]) => [name, data.length, sha(data)])));
}

function artifactName(manifest, digest) {
  identifier.parse(manifest.id);
  return artifactSchema.parse({ artifact: `${manifest.id}-${manifest.version.replaceAll('.', '-')}-${digest}` }).artifact;
}

async function inspect(files) {
  const result = await verifyPack(files, { trustedKeys: [], creatorMode: true, engineVersion: '1.0.0' });
  if (!result.ok) throw new Error(`${result.stage}: ${result.error}`);
  if (result.pack.signed) throw new Error('This kit accepts unsigned author drafts only');
  const contents = result.pack.manifest.contents;
  if (!contents.brandSkins?.length || Object.keys(contents).some(k => k !== 'brandSkins')) throw new Error('Creator Kit admits brandSkins only; broader registrars are W-084');
  if (!contents.brandSkins.some(s => s.enabled)) throw new Error('Pack requires at least one enabled skin');
  const targets = new Set(PHYSICAL_SPECS.map(p => p.id));
  for (const skin of contents.brandSkins) {
    if (!skin.appliesTo.length || skin.appliesTo.some(id => !targets.has(id))) throw new Error('Every skin needs existing catalog targets; see creator_contract targetObjects');
    if (skin.appliesTo.some(object => !contents.brandSkins.some(s => s.enabled && s.appliesTo.includes(object)))) throw new Error('Every advertised target needs an enabled pack skin');
    if (!skin.appliesTo.some(object=>brandSkinFor(object,contents.brandSkins)?.id===skin.id)) throw new Error('Every skin needs at least one effective target; remove disabled or fully overridden skins');
  }
  for (const [name, bytes] of files) {
    if (name === 'pack.json') continue;
    if (!name.endsWith('.svg')) throw new Error('Creator Kit artwork must be static SVG');
    validateSvg(bytes);
  }
  return result.pack;
}

export class Creator {
  constructor(workspace) {
    if (!workspace || !path.isAbsolute(workspace)) throw new Error('An absolute --workspace directory is required');
    // Check every existing ancestor before canonicalizing; a link root must not silently become trusted.
    let cursor = path.resolve(workspace);
    while (true) {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Workspace ancestors may not be links/junctions');
      const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
    }
    this.root = fs.realpathSync.native(workspace);
    if (!fs.statSync(this.root).isDirectory()) throw new Error('Workspace must be a directory');
    for (const name of ['drafts', 'artifacts', 'receipts']) {
      const full = path.join(this.root, name);
      if (!fs.existsSync(full)) fs.mkdirSync(full);
      checkedPath(this.root, name);
      if (!fs.statSync(full).isDirectory()) throw new Error('Workspace layout must contain directories');
    }
    this.provenance();
  }

  async init(input) {
    this.provenance();
    const args = initSchema.parse(input);
    const skin = { id: args.id.replaceAll('-', '_'), brand: args.brand, licensed: false, appliesTo: ['fridge_humming'],
      displayName: args.displayName, flavorText: args.flavorText, enabled: true,
      livery: { Paint: '#184538' }, decals: { logo: 'art/logo.svg' } };
    const manifest = { format: PACK_FORMAT, formatVersion: 1, id: args.id, version: '1.0.0', author: args.author,
      publisher: 'creator-local', ageRating: 'E10+', requires: { engine: '>=1.0.0' }, contents: { brandSkins: [skin] }, assets: [] };
    const esc = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128" viewBox="0 0 256 128"><rect x="4" y="4" width="248" height="120" rx="12" fill="#184538"/><text x="128" y="72" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#f4e8c1">${esc(args.brand)}</text></svg>\n`;
    this.writeDirectory('drafts', args.id, new Map([['pack.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')], ['art/logo.svg', Buffer.from(svg)]]));
    return { draft: args.id, status: 'created', next: 'Edit drafts/<id>/pack.json and art, then build. assets are computed by build.' };
  }

  writeDirectory(parent, name, files) {
    const base = checkedPath(this.root, parent), final = path.join(base, name);
    const lock = path.join(base, `.${name}.lock`);
    const fd = fs.openSync(lock, 'wx');
    const stage = path.join(base, `.staging-${randomUUID()}`);
    try {
      if (fs.existsSync(final)) throw new Error('Destination exists; use a new id/version or retain the existing artifact');
      fs.mkdirSync(stage);
      for (const [relative, data] of files) {
        const valid = checkPackPath(relative); if (!valid.ok) throw new Error(valid.reason);
        const target = path.join(stage, ...relative.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data, { flag: 'wx' });
      }
      fs.renameSync(stage, final);
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
    // A failed stage is retained for inspection, never recursively removed.
  }

  async build(input) {
    this.provenance();
    const { id } = draftSchema.parse(input);
    const files = readPack(this.root, `drafts/${id}`);
    const manifest = parseJson(files.get('pack.json') ?? Buffer.alloc(0));
    if (manifest.id !== id) throw new Error('Draft id and manifest id differ');
    if (files.has('pack.sig')) throw new Error('No signing keys/signatures in author drafts');
    manifest.assets = [...files].filter(([name]) => name !== 'pack.json').map(([name, bytes]) => ({ path: name, sha256: sha(bytes), bytes: bytes.length }));
    const errors = validateManifest(manifest);
    if (errors.length) throw new Error(errors.slice(0, 5).join('; '));
    files.set('pack.json', Buffer.from(canonicalJson(manifest) + '\n'));
    await inspect(files);
    const packSha256 = fingerprint(files);
    const artifact = artifactName(manifest, packSha256);
    this.writeDirectory('artifacts', artifact, files);
    return { artifact, packSha256, files: files.size, signed: false, label: 'Unsigned — Creator mode', publication: 'requires publisher review and CI' };
  }

  async verify(input) {
    this.provenance();
    const { artifact } = artifactSchema.parse(input);
    const files = readPack(this.root, `artifacts/${artifact}`);
    const pack = await inspect(files);
    if (!files.get('pack.json').equals(Buffer.from(canonicalJson(pack.manifest) + '\n'))) throw new Error('Artifact requires canonical pack.json bytes');
    const packSha256 = fingerprint(files);
    if (artifact !== artifactName(pack.manifest, packSha256)) throw new Error('Artifact identity differs from canonical manifest and full SHA-256');
    const registry = new PackRegistry();
    const before = pack.manifest.contents.brandSkins.map(skin => skin.appliesTo.map(object => brandSkinFor(object)?.id ?? null));
    const applied = registry.register(pack);
    if (!applied.ok) throw new Error(`registry: ${applied.error}`);
    try {
      const resolved = pack.manifest.contents.brandSkins.map(skin => ({ skin: skin.id, enabled: skin.enabled,
        objects: skin.appliesTo.map(object => ({ object, resolvedSkin: brandSkinFor(object)?.id ?? null })) }));
      if(resolved.some(row=>!row.objects.some(object=>object.resolvedSkin===row.skin)))throw new Error('Every skin needs at least one effective target in the real registry');
      // Every advertised target of the winning enabled skin must resolve through the real game hook.
      const targetAssertions = [];
      for (const skin of pack.manifest.contents.brandSkins) for (const object of skin.appliesTo) {
        const expected = [...pack.manifest.contents.brandSkins].reverse().find(s => s.enabled && s.appliesTo.includes(object));
        const actual = brandSkinFor(object)?.id ?? null;
        if (!expected || actual !== expected.id) throw new Error('Runtime resolver did not apply the pack');
        targetAssertions.push({ skin: skin.id, object, expected: expected.id, actual });
      }
      const production = await verifyPack(files, { trustedKeys: [], creatorMode: false, engineVersion: '1.0.0' });
      if (production.ok || production.stage !== 'signature') throw new Error('Unsigned pack unexpectedly admitted without Creator mode');
      return { artifact, packSha256, manifest: pack.manifest, label: pack.label,
        registry: { registered: registry.list().map(p => p.manifest.id), resolved, before, targetAssertions },
        production: { admitted: false, stage: production.stage, reason: production.error }, engine: this.provenance() };
    } finally { registry.unregister(pack.manifest.id); }
  }

  provenance() {
    const data = parseJson(fs.readFileSync(path.join(kit, 'generated/provenance.json')));
    if (loadedEngineSha256 !== data.bundleSha256) throw new Error('Loaded engine bundle changed; restart Creator Kit');
    if (sha(fs.readFileSync(path.join(kit, 'generated/engine.mjs'))) !== data.bundleSha256) throw new Error('Engine bundle differs from build provenance; rebuild kit');
    // Resolve metafile input names relative to build cwd (scripts/creator).
    for (const [relative, hash] of Object.entries(data.inputs)) if (sha(fs.readFileSync(path.resolve(kit, relative))) !== hash) throw new Error('Engine source changed; rebuild Creator Kit');
    for (const [name, hash] of Object.entries(data.kitInputs)) if (loadedKitInputs[name] !== hash || sha(fs.readFileSync(path.join(kit, name))) !== hash) throw new Error('Creator code changed; rebuild and restart Creator Kit');
    return data;
  }

  async gate(input) {
    const verification = await this.verify(input);
    const receipt = { format: 'afterlife-creator-gate-v1', at: new Date().toISOString(), ...verification,
      gates: { packAndStaticArtwork: 'Worked', realRegistry: verification.registry.targetAssertions.length > 0 && verification.registry.targetAssertions.every(a => a.actual === a.expected) ? 'Worked' : 'Failed', unsignedProductionRejection: 'Worked',
        geometryAndBalanceChanges: 'none: strict brand-skin cosmetics only; no gameplay or mesh fields admitted',
        repositoryCI: 'Blocked: run repository checks and require green PR CI before admission' }, publicationReady: false };
    const name = `${input.artifact}-${randomUUID()}.json`;
    const target = path.join(checkedPath(this.root, 'receipts'), name);
    fs.writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { receipt: `receipts/${name}`, ...receipt };
  }
}
