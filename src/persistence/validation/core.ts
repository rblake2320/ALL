/**
 * Tiny schema DSL for STRUCTURAL validation + conservative repair of untrusted JSON.
 *
 * A Check<T> returns either a value of type T (possibly repaired, recorded as an issue) or INVALID.
 * Leaves that have a sensible default repair themselves ("repaired"); containers drop entries that
 * cannot be repaired ("dropped"); the caller decides what an INVALID root means ("fatal").
 * The innermost failure reason is kept in ctx.lastError so the dropping/fatal report can name it.
 *
 * Shapes are typed `{ [K in keyof T]-?: Check<T[K]> }`, so adding a field to a contract type without
 * teaching the validator about it is a COMPILE error, not a silent data loss.
 *
 * Defence in depth (validateWorld is exported and may see input that did not come through the hardened
 * parser): reserved keys ('__proto__', 'constructor', 'prototype') are dropped from every map and every
 * kept-extra field — `out[key] = value` with key '__proto__' would otherwise REPLACE the prototype of the
 * output record — and "already present" checks use own properties, never `in` (which would silently drop
 * forward-compatible extras named like Object.prototype members, e.g. 'toString').
 */
import { RESERVED_KEYS } from '../sanitize';

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export const INVALID: unique symbol = Symbol('invalid');
export type Invalid = typeof INVALID;
export type Check<T> = (v: unknown, ctx: VCtx) => T | Invalid;

export type IssueKind = 'repaired' | 'dropped' | 'fatal';
export interface Issue {
  kind: IssueKind;
  path: string;
  message: string;
}

export class VCtx {
  readonly issues: Issue[] = [];
  suppressed = 0;
  lastError: { path: string; message: string } = { path: '$', message: 'invalid' };
  private readonly segs: (string | number)[] = [];
  constructor(readonly maxIssues = 200) {}

  path(): string {
    let p = '';
    for (const s of this.segs) p += typeof s === 'number' ? `[${s}]` : p ? `.${s}` : s;
    return p || '$';
  }
  enter(seg: string | number): void {
    this.segs.push(seg);
  }
  leave(): void {
    this.segs.pop();
  }
  report(kind: IssueKind, message: string, path = this.path()): void {
    if (this.issues.length < this.maxIssues) this.issues.push({ kind, path, message });
    else this.suppressed++;
  }
  fail(message: string): Invalid {
    this.lastError = { path: this.path(), message };
    return INVALID;
  }
  count(kind: IssueKind): number {
    return this.issues.filter((i) => i.kind === kind).length;
  }
}

export function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function short(v: unknown): string {
  try {
    const s = typeof v === 'string' ? JSON.stringify(v) : String(v);
    return s.length > 40 ? s.slice(0, 37) + '...' : s;
  } catch {
    return typeName(v);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export interface NumOpts {
  min?: number;
  max?: number;
  int?: boolean;
  def?: number;
  /** Out-of-range values are INVALID instead of clamped. */
  strict?: boolean;
}

export function num(o: NumOpts = {}): Check<number> {
  return (v, ctx) => {
    let n: number;
    if (typeof v === 'number' && Number.isFinite(v)) n = v;
    else if (o.def !== undefined) {
      ctx.report('repaired', v === undefined ? `missing; set to ${o.def}` : `expected a number, got ${typeName(v)}; set to ${o.def}`);
      return o.def;
    } else return ctx.fail(v === undefined ? 'missing number' : `expected a number, got ${typeName(v)}`);
    if (o.int && !Number.isInteger(n)) {
      if (o.strict) return ctx.fail(`expected an integer, got ${n}`);
      ctx.report('repaired', `expected an integer, got ${n}; rounded`);
      n = Math.round(n);
    }
    if (o.min !== undefined && n < o.min) {
      if (o.strict) return ctx.fail(`${n} is below the minimum ${o.min}`);
      ctx.report('repaired', `${n} below minimum ${o.min}; clamped`);
      n = o.min;
    }
    if (o.max !== undefined && n > o.max) {
      if (o.strict) return ctx.fail(`${n} is above the maximum ${o.max}`);
      ctx.report('repaired', `${n} above maximum ${o.max}; clamped`);
      n = o.max;
    }
    return n;
  };
}

export interface StrOpts {
  max?: number;
  def?: string;
  re?: RegExp;
  nonEmpty?: boolean;
}

export function str(o: StrOpts = {}): Check<string> {
  return (v, ctx) => {
    const bad = (why: string): string | Invalid => {
      if (o.def !== undefined) {
        ctx.report('repaired', `${why}; set to ${short(o.def)}`);
        return o.def;
      }
      return ctx.fail(why);
    };
    if (typeof v !== 'string') return bad(v === undefined ? 'missing string' : `expected a string, got ${typeName(v)}`);
    if (o.nonEmpty && v.length === 0) return bad('empty string');
    if (o.re && !o.re.test(v)) return bad(`malformed value ${short(v)}`);
    if (o.max !== undefined && v.length > o.max) {
      ctx.report('repaired', `string longer than ${o.max} chars; truncated`);
      return v.slice(0, o.max);
    }
    return v;
  };
}

export function bool(def?: boolean): Check<boolean> {
  return (v, ctx) => {
    if (typeof v === 'boolean') return v;
    if (def !== undefined) {
      ctx.report('repaired', v === undefined ? `missing; set to ${def}` : `expected a boolean, got ${typeName(v)}; set to ${def}`);
      return def;
    }
    return ctx.fail(v === undefined ? 'missing boolean' : `expected a boolean, got ${typeName(v)}`);
  };
}

export function lit<T extends string | number>(values: readonly T[], def?: T): Check<T> {
  const set = new Set<unknown>(values);
  return (v, ctx) => {
    if (set.has(v)) return v as T;
    if (def !== undefined) {
      ctx.report('repaired', `unknown value ${short(v)}; set to ${short(def)}`);
      return def;
    }
    return ctx.fail(`unknown value ${short(v)} (expected one of ${values.slice(0, 8).join(', ')}${values.length > 8 ? ', ...' : ''})`);
  };
}

/** null stays null; a missing or invalid value becomes null (repaired) unless `strict`. */
export function nullable<T>(check: Check<T>, o: { strict?: boolean } = {}): Check<T | null> {
  return (v, ctx) => {
    if (v === null) return null;
    if (v === undefined) {
      if (o.strict) return ctx.fail('missing value');
      ctx.report('repaired', 'missing; set to null');
      return null;
    }
    const r = check(v, ctx);
    if (r !== INVALID) return r;
    if (o.strict) return INVALID;
    ctx.report('repaired', `${ctx.lastError.message}; set to null`);
    return null;
  };
}

export interface ArrOpts<T> {
  max?: number;
  /** Which end to keep when trimming to `max` (default 'first'). */
  keep?: 'first' | 'last';
  def?: () => T[];
  /** Drop invalid elements (default) or make the whole array INVALID. */
  dropInvalid?: boolean;
  /** Remove duplicate primitive values. */
  unique?: boolean;
}

export function arr<T>(item: Check<T>, o: ArrOpts<T> = {}): Check<T[]> {
  return (v, ctx) => {
    if (!Array.isArray(v)) {
      if (o.def) {
        ctx.report('repaired', v === undefined ? 'missing list; set to empty' : `expected a list, got ${typeName(v)}; reset`);
        return o.def();
      }
      return ctx.fail(v === undefined ? 'missing list' : `expected a list, got ${typeName(v)}`);
    }
    let src: unknown[] = v;
    let offset = 0;
    if (o.max !== undefined && src.length > o.max) {
      ctx.report('repaired', `list has ${src.length} entries (limit ${o.max}); trimmed`);
      if (o.keep === 'last') {
        offset = src.length - o.max;
        src = src.slice(offset);
      } else src = src.slice(0, o.max);
    }
    const out: T[] = [];
    const seen = o.unique ? new Set<unknown>() : null;
    for (let i = 0; i < src.length; i++) {
      ctx.enter(i + offset);
      const r = item(src[i], ctx);
      if (r === INVALID) {
        if (o.dropInvalid === false) {
          ctx.leave();
          return INVALID;
        }
        ctx.report('dropped', `${ctx.lastError.message} (at ${ctx.lastError.path}); entry removed`);
      } else if (seen && seen.has(r)) {
        ctx.report('repaired', `duplicate ${short(r)} removed`);
      } else {
        seen?.add(r);
        out.push(r);
      }
      ctx.leave();
    }
    return out;
  };
}

export interface RecOpts<T> {
  maxKeys?: number;
  keyRe?: RegExp;
  def?: () => Record<string, T>;
  dropInvalid?: boolean;
}

export function rec<T>(item: Check<T>, o: RecOpts<T> = {}): Check<Record<string, T>> {
  return (v, ctx) => {
    if (!isRecord(v)) {
      if (o.def) {
        ctx.report('repaired', v === undefined ? 'missing map; set to empty' : `expected a map, got ${typeName(v)}; reset`);
        return o.def();
      }
      return ctx.fail(v === undefined ? 'missing map' : `expected a map, got ${typeName(v)}`);
    }
    const out: Record<string, T> = {};
    let n = 0;
    for (const key of Object.keys(v)) {
      ctx.enter(key);
      if (RESERVED_KEYS.has(key)) {
        ctx.report('dropped', `reserved key ${short(key)} removed`);
        ctx.leave();
        continue;
      }
      if (o.maxKeys !== undefined && n >= o.maxKeys) {
        ctx.report('dropped', `map exceeds ${o.maxKeys} entries; entry removed`);
        ctx.leave();
        continue;
      }
      if (o.keyRe && !o.keyRe.test(key)) {
        ctx.report('dropped', `malformed key ${short(key)}; entry removed`);
        ctx.leave();
        continue;
      }
      const r = item(v[key], ctx);
      if (r === INVALID) {
        if (o.dropInvalid === false) {
          ctx.leave();
          return INVALID;
        }
        ctx.report('dropped', `${ctx.lastError.message} (at ${ctx.lastError.path}); entry removed`);
      } else {
        out[key] = r;
        n++;
      }
      ctx.leave();
    }
    return out;
  };
}

/** Object with exactly `keys` (e.g. needs, skills, limbs): missing/invalid -> default, extras removed. */
export function fixedRec<K extends string, T>(keys: readonly K[], item: Check<T>, def: (k: K) => T): Check<Record<K, T>> {
  return (v, ctx) => {
    const src: Record<string, unknown> = isRecord(v) ? v : {};
    if (!isRecord(v)) ctx.report('repaired', v === undefined ? 'missing; filled with defaults' : `expected a map, got ${typeName(v)}; filled with defaults`);
    const out = {} as Record<K, T>;
    for (const k of keys) {
      ctx.enter(k);
      if (!hasOwn(src, k)) {
        if (isRecord(v)) ctx.report('repaired', 'missing; set to default');
        out[k] = def(k);
      } else {
        const r = item(src[k], ctx);
        if (r === INVALID) {
          ctx.report('repaired', `${ctx.lastError.message}; set to default`);
          out[k] = def(k);
        } else out[k] = r;
      }
      ctx.leave();
    }
    for (const k of Object.keys(src)) {
      if (!(keys as readonly string[]).includes(k)) ctx.report('dropped', `unknown key ${short(k)} removed`);
    }
    return out;
  };
}

export type Shape<T> = { [K in keyof T]-?: Check<T[K]> };

export interface ObjOpts<T> {
  /** Value used (with a 'repaired' note) when the input is missing or not an object. */
  def?: () => T;
  /** Runs on the raw input before field checks (e.g. derive a missing field from a sibling). */
  pre?: (raw: Record<string, unknown>, ctx: VCtx) => void;
  /** Cross-field checks on the validated value. */
  post?: (value: T, ctx: VCtx) => T | Invalid;
  /** Keep unknown keys (default true — forward-compatible data is not destroyed). */
  keepExtra?: boolean;
}

export function obj<T>(shape: Shape<T>, o: ObjOpts<T> = {}): Check<T> {
  const keys = Object.keys(shape) as (keyof T & string)[];
  return (v, ctx) => {
    if (!isRecord(v)) {
      if (o.def) {
        ctx.report('repaired', v === undefined ? 'missing; set to default' : `expected an object, got ${typeName(v)}; set to default`);
        return o.def();
      }
      return ctx.fail(v === undefined ? 'missing object' : `expected an object, got ${typeName(v)}`);
    }
    if (o.pre) o.pre(v, ctx);
    const out = {} as Record<string, unknown>;
    const omitted = new Set<string>();
    for (const k of keys) {
      ctx.enter(k);
      const r = (shape[k] as Check<unknown>)(v[k], ctx);
      ctx.leave();
      if (r === INVALID) return INVALID;
      // an optional field that is absent stays ABSENT (an undefined value is not canonical JSON and would break save hashing);
      // a field the shape handled and repaired to undefined is still handled: its raw value is not copied back as an "extra"
      if (r !== undefined) out[k] = r;
      else omitted.add(k);
    }
    if (o.keepExtra !== false) {
      for (const k of Object.keys(v)) {
        if (hasOwn(out, k) || omitted.has(k)) continue;
        if (RESERVED_KEYS.has(k)) {
          ctx.report('dropped', `reserved key ${short(k)} removed`, `${ctx.path()}${ctx.path() === '$' ? '' : '.'}${k}`);
          continue;
        }
        out[k] = v[k];
      }
    }
    return o.post ? o.post(out as T, ctx) : (out as T);
  };
}

/** Discriminated union on `field` (e.g. ObjectPlacement.kind). */
export function tagged<T>(field: string, variants: Record<string, Check<T>>): Check<T> {
  return (v, ctx) => {
    if (!isRecord(v)) return ctx.fail(v === undefined ? 'missing object' : `expected an object, got ${typeName(v)}`);
    const tag = v[field];
    const variant = typeof tag === 'string' && Object.prototype.hasOwnProperty.call(variants, tag) ? variants[tag] : undefined;
    if (!variant) return ctx.fail(`unknown ${field} ${short(tag)}`);
    return variant(v, ctx);
  };
}

export function tuple2<A, B>(a: Check<A>, b: Check<B>): Check<[A, B]> {
  return (v, ctx) => {
    if (!Array.isArray(v) || v.length !== 2) return ctx.fail(`expected a pair, got ${typeName(v)}`);
    ctx.enter(0);
    const ra = a(v[0], ctx);
    ctx.leave();
    if (ra === INVALID) return INVALID;
    ctx.enter(1);
    const rb = b(v[1], ctx);
    ctx.leave();
    if (rb === INVALID) return INVALID;
    return [ra, rb];
  };
}

/** JSON scalar (string | finite number | boolean | null), as used by ObjectState.data etc. */
export function scalar(allowNull: true): Check<string | number | boolean | null>;
export function scalar(allowNull: false): Check<string | number | boolean>;
export function scalar(allowNull: boolean): Check<string | number | boolean | null> {
  return (v, ctx) => {
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v === null && allowNull) return null;
    return ctx.fail(`expected a JSON scalar, got ${typeName(v)}`);
  };
}
