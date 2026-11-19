/**
 * pack.json schema (docs/MONETIZATION.md §5). Strict: unknown top-level keys, wrong types, out-of-range values and
 * oversize strings are errors — never coerced. The SIGNED payload is canonicalJson(manifest) (sorted keys, no
 * whitespace), which already contains the SHA-256 of every asset, so the signature covers "manifest + asset hashes".
 */
import type { BrandSkin } from '../shared/economy';
import { SHA256_HEX_RE } from '../persistence/sha256';
import { checkPackPath, PACK_LIMITS } from './limits';

export const PACK_FORMAT = 'afterlife-lease-pack';
export const MANIFEST_FILE = 'pack.json';
export const SIGNATURE_FILE = 'pack.sig';
export const AGE_RATINGS = ['E', 'E10+'] as const;
export type PackAgeRating = (typeof AGE_RATINGS)[number];

export interface PackAsset {
  path: string;
  sha256: string;
  bytes: number;
}

export interface PackContents {
  objects?: unknown[];
  brandSkins?: BrandSkin[];
  quests?: unknown[];
  lots?: unknown[];
  bodies?: unknown[];
}

export interface PackManifest {
  format: typeof PACK_FORMAT;
  formatVersion: 1;
  id: string;
  version: string;
  author: string;
  /** Key id the pack claims to be signed with (must match pack.sig and an allowed publisher key). */
  publisher: string;
  ageRating: PackAgeRating;
  requires: { engine: string };
  contents: PackContents;
  assets: PackAsset[];
}

export interface PackSignature {
  alg: 'Ed25519';
  keyId: string;
  /** Base64 detached signature over utf8(canonicalJson(manifest)). */
  sig: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SEMVER_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const RANGE_RE = /^>=(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const KEYID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SKIN_ID_RE = /^[a-z0-9_]{1,48}$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const SAFE_TEXT_RE = /^[^\u0000-\u001f\u007f<>]*$/;

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && SAFE_TEXT_RE.test(v);

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

function jsonDepth(v: unknown, d = 0): number {
  if (d > PACK_LIMITS.maxJsonDepth) return d;
  if (Array.isArray(v)) return Math.max(d, ...v.map((x) => jsonDepth(x, d + 1)));
  if (isRec(v)) return Math.max(d, ...Object.values(v).map((x) => jsonDepth(x, d + 1)));
  return d;
}

function validateSkin(s: unknown, i: number, errors: string[], assetPaths: ReadonlySet<string>): void {
  const at = `contents.brandSkins[${i}]`;
  if (!isRec(s)) return void errors.push(`${at} must be an object`);
  const allowed = new Set(['id', 'brand', 'licensed', 'appliesTo', 'displayName', 'flavorText', 'livery', 'decals', 'enabled']);
  for (const k of Object.keys(s)) if (!allowed.has(k)) errors.push(`${at}.${k} is not a brand-skin field`);
  if (typeof s.id !== 'string' || !SKIN_ID_RE.test(s.id)) errors.push(`${at}.id is invalid`);
  if (!text(s.brand, 40)) errors.push(`${at}.brand is invalid`);
  if (typeof s.licensed !== 'boolean') errors.push(`${at}.licensed must be true/false`);
  if (!Array.isArray(s.appliesTo) || s.appliesTo.length > 32 || !s.appliesTo.every((x) => typeof x === 'string' && /^[a-z0-9_]{1,48}$/.test(x))) errors.push(`${at}.appliesTo is invalid`);
  if (!text(s.displayName, 60)) errors.push(`${at}.displayName is invalid`);
  if (!text(s.flavorText, 200)) errors.push(`${at}.flavorText is invalid`);
  if (typeof s.enabled !== 'boolean') errors.push(`${at}.enabled must be true/false`);
  if (s.livery !== undefined) {
    if (!isRec(s.livery) || Object.keys(s.livery).length > 8 || !Object.entries(s.livery).every(([k, v]) => /^[A-Za-z_]{1,24}$/.test(k) && typeof v === 'string' && HEX_COLOR_RE.test(v))) errors.push(`${at}.livery is invalid`);
  }
  if (s.decals !== undefined) {
    if (!isRec(s.decals) || Object.keys(s.decals).length > 8) errors.push(`${at}.decals is invalid`);
    else
      for (const [k, v] of Object.entries(s.decals)) {
        if (!/^[A-Za-z_]{1,24}$/.test(k) || typeof v !== 'string') errors.push(`${at}.decals.${k} is invalid`);
        else if (!assetPaths.has(v)) errors.push(`${at}.decals.${k} points at "${v}", which is not a listed asset`);
      }
  }
}

/** Validate a parsed manifest. Returns errors (empty = valid). */
export function validateManifest(m: unknown): string[] {
  const errors: string[] = [];
  if (!isRec(m)) return ['pack.json must be a JSON object'];
  if (jsonDepth(m) > PACK_LIMITS.maxJsonDepth) return ['pack.json is nested too deeply'];
  const allowed = new Set(['format', 'formatVersion', 'id', 'version', 'author', 'publisher', 'ageRating', 'requires', 'contents', 'assets']);
  for (const k of Object.keys(m)) if (!allowed.has(k)) errors.push(`unknown field "${k}"`);
  if (m.format !== PACK_FORMAT) errors.push('not an Afterlife Lease content pack');
  if (m.formatVersion !== 1) errors.push('unsupported pack format version');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push('id must be 2–48 lowercase letters, digits or dashes');
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) errors.push('version must be x.y.z');
  if (!text(m.author, 80)) errors.push('author is missing or invalid');
  if (typeof m.publisher !== 'string' || !KEYID_RE.test(m.publisher)) errors.push('publisher key id is invalid');
  if (typeof m.ageRating !== 'string' || !(AGE_RATINGS as readonly string[]).includes(m.ageRating)) errors.push('ageRating must be E or E10+ (the game is rated E10+)');
  if (!isRec(m.requires) || typeof m.requires.engine !== 'string' || !RANGE_RE.test(m.requires.engine) || Object.keys(m.requires).length !== 1) errors.push('requires.engine must look like ">=1.0.0"');
  const paths = new Set<string>();
  if (!Array.isArray(m.assets)) errors.push('assets must be a list');
  else {
    if (m.assets.length > PACK_LIMITS.maxFiles) errors.push('too many assets');
    let total = 0;
    m.assets.forEach((a, i) => {
      if (!isRec(a) || Object.keys(a).some((k) => !['path', 'sha256', 'bytes'].includes(k))) return void errors.push(`assets[${i}] is invalid`);
      const pc = checkPackPath(a.path);
      if (!pc.ok) errors.push(`assets[${i}]: ${pc.reason}`);
      else if (pc.path === 'pack.json' || pc.path === 'pack.sig') errors.push(`assets[${i}] may not list ${pc.path}`);
      else if (paths.has(pc.path)) errors.push(`assets[${i}] duplicates "${pc.path}"`);
      else paths.add(pc.path);
      if (typeof a.sha256 !== 'string' || !SHA256_HEX_RE.test(a.sha256)) errors.push(`assets[${i}].sha256 must be lowercase hex SHA-256`);
      if (!Number.isSafeInteger(a.bytes) || (a.bytes as number) < 0 || (a.bytes as number) > PACK_LIMITS.maxFileBytes) errors.push(`assets[${i}].bytes is invalid`);
      else total += a.bytes as number;
    });
    if (total > PACK_LIMITS.maxTotalBytes) errors.push('pack assets are too large in total');
  }
  if (!isRec(m.contents)) errors.push('contents must be an object');
  else {
    const c = m.contents;
    for (const k of Object.keys(c)) if (!['objects', 'brandSkins', 'quests', 'lots', 'bodies'].includes(k)) errors.push(`contents.${k} is not a content kind`);
    for (const k of ['objects', 'quests', 'lots', 'bodies'] as const) {
      if (c[k] !== undefined && (!Array.isArray(c[k]) || (c[k] as unknown[]).length > 256)) errors.push(`contents.${k} must be a list`);
    }
    if (c.brandSkins !== undefined) {
      if (!Array.isArray(c.brandSkins) || c.brandSkins.length > 64) errors.push('contents.brandSkins must be a list');
      else c.brandSkins.forEach((s, i) => validateSkin(s, i, errors, paths));
    }
  }
  return errors;
}

export function validateSignature(s: unknown): PackSignature | null {
  if (!isRec(s) || Object.keys(s).length !== 3) return null;
  if (s.alg !== 'Ed25519' || typeof s.keyId !== 'string' || !KEYID_RE.test(s.keyId) || typeof s.sig !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(s.sig)) return null;
  return { alg: 'Ed25519', keyId: s.keyId, sig: s.sig };
}
