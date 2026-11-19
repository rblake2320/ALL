/** Small pure helpers shared by the engine (no state, no randomness). */
import type { TargetRef, Vec2 } from '../types';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Finite number or the fallback. */
export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

const idNumCache = new Map<string, number>();

/** Numeric suffix of ids like 'a12' / 'o57' (NaN when there is none). Memoised (ids are few and immutable). */
export function idNumber(id: string): number {
  const hit = idNumCache.get(id);
  if (hit !== undefined) return hit;
  const m = /^[a-z]+(\d+)$/i.exec(id);
  const n = m ? Number(m[1]) : NaN;
  if (idNumCache.size > 50000) idNumCache.clear();
  idNumCache.set(id, n);
  return n;
}

/** Deterministic ordering of ids: numeric suffix first, then plain string compare. */
export function compareIds(a: string, b: string): number {
  const na = idNumber(a);
  const nb = idNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 'diningTable' -> 'dining table', 'item_meal' -> 'item meal'. */
export function humanize(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

export function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 'a' / 'an' + noun. */
export function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** JSON deep copy that maps non-finite numbers to null (what JSON would do anyway) and drops undefined. */
export function jsonCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function tileCenter(t: { x: number; z: number }): Vec2 {
  return { x: t.x + 0.5, z: t.z + 0.5 };
}

export function sameTarget(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'object':
    case 'agent':
      return a.id === (b as { id: string }).id;
    case 'tile':
      return a.x === (b as { x: number }).x && a.z === (b as { z: number }).z;
    case 'self':
      return true;
  }
}

export function targetKey(t: TargetRef): string {
  switch (t.kind) {
    case 'object':
      return `o:${t.id}`;
    case 'agent':
      return `a:${t.id}`;
    case 'tile':
      return `t:${t.x},${t.z}`;
    case 'self':
      return 'self';
  }
}

/** Validates the structural shape of a TargetRef coming from outside (commands, saves). */
export function isTargetRef(v: unknown): v is TargetRef {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  switch (t.kind) {
    case 'object':
    case 'agent':
      return typeof t.id === 'string' && t.id.length > 0;
    case 'tile':
      return isNum(t.x) && isNum(t.z);
    case 'self':
      return true;
    default:
      return false;
  }
}

/** Plain JSON-safe params (string|number|boolean values only). */
export function cleanParams(p: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}

/** Format an hour (0..24) as '9 AM'. */
export function hourLabel(h: number): string {
  const hh = ((Math.floor(h) % 24) + 24) % 24;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${hh < 12 ? 'AM' : 'PM'}`;
}

/** Hour window test that wraps midnight. from === to means "always". */
export function hourInWindow(hour: number, from: number, to: number): boolean {
  if (from === to) return true;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}
