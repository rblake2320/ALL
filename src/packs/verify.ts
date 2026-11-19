/**
 * Content-pack loader/verifier (docs/MONETIZATION.md §5). Order is fixed and every failure rejects the WHOLE pack
 * with a clear message — nothing is registered until every check passed:
 *   1. container: zip (src/packs/zip.ts limits) or directory map; safe paths only; size/count limits
 *   2. pack.json: strict JSON (size/depth caps) → schema (src/packs/schema.ts)
 *   3. every file present is listed, every listed asset is present, byte length + SHA-256 match
 *   4. signature: Ed25519 (WebCrypto) over utf8(canonicalJson(manifest)) with an ALLOWED publisher key; unsigned packs
 *      only when `creatorMode` is on (dev/offline), and then flagged `signed: false` ("Unsigned — Creator mode")
 *   5. content rules: engine version satisfied, brand skins are original house brands (no licensed marks), content
 *      kinds this build cannot register are refused instead of half-loaded
 */
import { base64ToBytes, utf8DecodeStrict, utf8Encode } from '../persistence/bytes';
import { canonicalJson } from '../persistence/canonicalJson';
import { sha256Hex } from '../persistence/sha256';
import { HOUSE_BRANDS } from '../economy/brands';
import type { PublisherKey } from './keys';
import { PACK_LIMITS, checkPackPath } from './limits';
import { MANIFEST_FILE, SIGNATURE_FILE, compareSemver, validateManifest, validateSignature, type PackManifest } from './schema';
import { PackFormatError, readZip } from './zip';

export interface VerifiedPack {
  manifest: PackManifest;
  files: ReadonlyMap<string, Uint8Array>;
  signed: boolean;
  /** Publisher key id that verified it (null when unsigned). */
  keyId: string | null;
  /** Player-facing label ("Signed by Afterlife Lease (first party)", "Unsigned — Creator mode"). */
  label: string;
}

export type VerifyResult = { ok: true; pack: VerifiedPack } | { ok: false; error: string; stage: 'container' | 'manifest' | 'assets' | 'signature' | 'content' };

export interface VerifyOptions {
  trustedKeys: readonly PublisherKey[];
  /** Allow unsigned packs (dev/offline Creator mode only; never online/shared towns). */
  creatorMode?: boolean;
  /** Engine (game) version, e.g. GAME_VERSION. */
  engineVersion: string;
}

/** Content kinds this build can register (others are refused, never half-loaded). */
const REGISTRABLE = new Set(['brandSkins']);

type Subtle = {
  importKey(f: 'raw', k: Uint8Array<ArrayBuffer>, alg: { name: 'Ed25519' }, ext: boolean, use: ['verify']): Promise<unknown>;
  verify(alg: { name: 'Ed25519' }, key: unknown, sig: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<boolean>;
};

function subtle(): Subtle | null {
  try {
    const s = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle as Subtle | undefined;
    return s && typeof s.verify === 'function' ? s : null;
  } catch {
    return null;
  }
}

/** Ed25519 verify via WebCrypto; false on any failure (fail closed). */
export async function verifyEd25519(publicKeyB64: string, sigB64: string, data: Uint8Array): Promise<boolean> {
  const s = subtle();
  const pub = base64ToBytes(publicKeyB64);
  const sig = base64ToBytes(sigB64);
  if (!s || !pub || pub.byteLength !== 32 || !sig || sig.byteLength !== 64) return false;
  try {
    const key = await s.importKey('raw', new Uint8Array(pub), { name: 'Ed25519' }, false, ['verify']);
    return await s.verify({ name: 'Ed25519' }, key, new Uint8Array(sig), new Uint8Array(data));
  } catch {
    return false;
  }
}

function parseJson(bytes: Uint8Array, what: string): unknown {
  if (bytes.byteLength > PACK_LIMITS.maxManifestBytes) throw new PackFormatError(`${what} is too large`);
  let text: string;
  try {
    text = utf8DecodeStrict(bytes);
  } catch {
    throw new PackFormatError(`${what} is not valid UTF-8`);
  }
  if (/"__proto__"|"constructor"|"prototype"/.test(text)) throw new PackFormatError(`${what} contains a reserved key`);
  try {
    return JSON.parse(text);
  } catch {
    throw new PackFormatError(`${what} is not valid JSON`);
  }
}

/** Verify a pack given as zip bytes or as a path → bytes map (directory form). Never throws. */
export async function verifyPack(source: Uint8Array | ReadonlyMap<string, Uint8Array>, opts: VerifyOptions): Promise<VerifyResult> {
  // 1. container
  let files: Map<string, Uint8Array>;
  try {
    if (source instanceof Uint8Array) files = await readZip(source);
    else {
      if (source.size > PACK_LIMITS.maxFiles) return { ok: false, stage: 'container', error: 'too many files in pack' };
      files = new Map();
      let total = 0;
      for (const [p, b] of source) {
        const c = checkPackPath(p);
        if (!c.ok) return { ok: false, stage: 'container', error: c.reason };
        if (!(b instanceof Uint8Array)) return { ok: false, stage: 'container', error: `"${p}" is not a file` };
        if (b.byteLength > PACK_LIMITS.maxFileBytes) return { ok: false, stage: 'container', error: `"${p}" is too large` };
        total += b.byteLength;
        if (total > PACK_LIMITS.maxTotalBytes) return { ok: false, stage: 'container', error: 'pack is too large' };
        files.set(p, b);
      }
    }
  } catch (e) {
    return { ok: false, stage: 'container', error: e instanceof PackFormatError ? e.message : 'the pack could not be read' };
  }

  // 2. manifest
  const mBytes = files.get(MANIFEST_FILE);
  if (!mBytes) return { ok: false, stage: 'manifest', error: 'pack.json is missing' };
  let manifestRaw: unknown;
  try {
    manifestRaw = parseJson(mBytes, 'pack.json');
  } catch (e) {
    return { ok: false, stage: 'manifest', error: (e as Error).message };
  }
  const errs = validateManifest(manifestRaw);
  if (errs.length > 0) return { ok: false, stage: 'manifest', error: `pack.json: ${errs.slice(0, 5).join('; ')}` };
  const manifest = manifestRaw as PackManifest;

  // 3. assets: exact set + hashes
  const listed = new Map(manifest.assets.map((a) => [a.path, a]));
  for (const p of files.keys()) {
    if (p === MANIFEST_FILE || p === SIGNATURE_FILE) continue;
    if (!listed.has(p)) return { ok: false, stage: 'assets', error: `"${p}" is in the pack but not listed in pack.json` };
  }
  for (const a of manifest.assets) {
    const b = files.get(a.path);
    if (!b) return { ok: false, stage: 'assets', error: `asset "${a.path}" is missing` };
    if (b.byteLength !== a.bytes) return { ok: false, stage: 'assets', error: `asset "${a.path}" has the wrong size` };
    if ((await sha256Hex(b)) !== a.sha256) return { ok: false, stage: 'assets', error: `asset "${a.path}" was altered (SHA-256 mismatch)` };
  }

  // 4. signature
  const payload = utf8Encode(canonicalJson(manifest));
  const sBytes = files.get(SIGNATURE_FILE);
  let signed = false;
  let keyId: string | null = null;
  let label: string;
  if (!sBytes) {
    if (!opts.creatorMode) return { ok: false, stage: 'signature', error: 'the pack is not signed (unsigned packs need Creator mode)' };
    label = 'Unsigned — Creator mode';
  } else {
    let sigRaw: unknown;
    try {
      sigRaw = parseJson(sBytes, 'pack.sig');
    } catch (e) {
      return { ok: false, stage: 'signature', error: (e as Error).message };
    }
    const sig = validateSignature(sigRaw);
    if (!sig) return { ok: false, stage: 'signature', error: 'pack.sig is malformed' };
    if (sig.keyId !== manifest.publisher) return { ok: false, stage: 'signature', error: 'pack.sig was made with a different key than pack.json names' };
    const key = opts.trustedKeys.find((k) => k.keyId === sig.keyId);
    if (!key) return { ok: false, stage: 'signature', error: `publisher "${sig.keyId}" is not on the allowed list` };
    if (!(await verifyEd25519(key.publicKey, sig.sig, payload))) return { ok: false, stage: 'signature', error: 'the signature does not match (tampered pack or wrong key)' };
    signed = true;
    keyId = key.keyId;
    label = `Signed by ${key.label}`;
  }

  // 5. content rules
  if (compareSemver(opts.engineVersion, manifest.requires.engine.slice(2)) < 0) return { ok: false, stage: 'content', error: `needs game version ${manifest.requires.engine.slice(2)} or newer` };
  for (const [k, v] of Object.entries(manifest.contents)) {
    if (Array.isArray(v) && v.length > 0 && !REGISTRABLE.has(k)) return { ok: false, stage: 'content', error: `this version cannot load "${k}" from packs yet` };
  }
  for (const s of manifest.contents.brandSkins ?? []) {
    if (s.licensed) return { ok: false, stage: 'content', error: `brand skin "${s.id}" claims a licensed mark; no license is on file` };
    if (!HOUSE_BRANDS.includes(s.brand)) return { ok: false, stage: 'content', error: `brand "${s.brand}" is not an approved house brand` };
  }
  return { ok: true, pack: { manifest, files, signed, keyId, label } };
}
