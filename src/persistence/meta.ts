/**
 * SaveMeta / slot-name sanitation. Meta is displayed in the load menu and travels inside exported
 * files, so it is treated as untrusted: types coerced, lengths capped, thumbnail restricted to small
 * base64 PNG/JPEG/WebP data URLs (anything else, e.g. `javascript:` or remote URLs, becomes null).
 */
import type { SaveMeta } from './contracts';

export const MAX_NAME_CHARS = 64;
export const MAX_MEMBERS = 8;
export const MAX_THUMBNAIL_CHARS = 64 * 1024;
const THUMB_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function cleanString(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // Strip control characters (incl. bidi overrides that could garble the UI) and trim.
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim();
  if (s.length === 0) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function sanitizeThumbnail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > MAX_THUMBNAIL_CHARS) return null;
  return THUMB_RE.test(v) ? v : null;
}

export interface MetaSanitizeResult {
  meta: SaveMeta;
  warnings: string[];
}

/** Always returns a fresh, valid SaveMeta (never aliases the input). */
export function sanitizeMeta(raw: unknown): MetaSanitizeResult {
  const warnings: string[] = [];
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (r !== raw) warnings.push('save meta was missing or not an object');
  const members = Array.isArray(r.memberNames) ? r.memberNames : [];
  const memberNames = members
    .slice(0, MAX_MEMBERS)
    .map((n) => cleanString(n, MAX_NAME_CHARS, ''))
    .filter((n) => n.length > 0);
  const thumbnail = sanitizeThumbnail(r.thumbnail);
  if (r.thumbnail != null && thumbnail === null) warnings.push('save thumbnail dropped (not a small PNG/JPEG/WebP data URL)');
  const dayRaw = finiteOr(r.day, 0);
  const meta: SaveMeta = {
    householdName: cleanString(r.householdName, MAX_NAME_CHARS, 'Household'),
    memberNames,
    day: Math.max(0, Math.min(1_000_000, Math.floor(dayRaw))),
    timeLabel: cleanString(r.timeLabel, 32, ''),
    funds: Math.round(finiteOr(r.funds, 0)),
    lotValue: Math.round(finiteOr(r.lotValue, 0)),
    thumbnail,
  };
  return { meta, warnings };
}

export function sanitizeSlotName(name: unknown, fallback: string): string {
  return cleanString(name, MAX_NAME_CHARS, fallback);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && ISO_RE.test(v) && Number.isFinite(Date.parse(v));
}

/** File-name-safe household fragment for exports: lowercase ascii, dashes, <= 40 chars. */
export function filenameFragment(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length > 0 ? s : 'household';
}

export function exportFilename(meta: SaveMeta): string {
  const day = Number.isFinite(meta.day) ? Math.max(0, Math.floor(meta.day)) : 0;
  return `afterlife-${filenameFragment(meta.householdName)}-day${day}.alsave`;
}
