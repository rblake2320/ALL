/**
 * Tiny i18n layer. `t(key, params)` looks up a string, interpolates `{param}` placeholders and falls back to
 * the key itself (warning once per key) when a string is missing — it never throws.
 *
 * Plurals: pass a numeric `count`; if `<key>.one` / `<key>.other` exist they are used (`count === 1` → one).
 * Other modules (UI-HUD) can add their own strings with `registerStrings({ 'hud.funds': 'Funds' })`.
 */
import { en } from './en';

export type StringKey = keyof typeof en;
export type StringParams = Record<string, string | number | null | undefined>;
export type Language = 'en';

type Dict = Record<string, string>;

const base: Dict = en;
const extra: Dict = Object.create(null) as Dict;
const warned = new Set<string>();
let language: Language = 'en';
let warnHandler: (msg: string) => void = (msg) => {
  if (typeof console !== 'undefined') console.warn(msg);
};

function own(dict: Dict, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(dict, key)) return undefined;
  const v = dict[key];
  return typeof v === 'string' ? v : undefined;
}

function lookup(key: string): string | undefined {
  return own(extra, key) ?? own(base, key);
}

const PARAM_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Replace `{name}` with params.name; unknown/nullish params are left untouched so mistakes stay visible. */
export function interpolate(template: string, params?: StringParams): string {
  if (!params) return template;
  return template.replace(PARAM_RE, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return whole;
    const v = params[name];
    if (v === null || v === undefined) return whole;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
    return String(v);
  });
}

/** Translate `key`. Never throws; returns the key itself for unknown keys (and warns once). */
export function t(key: StringKey | (string & {}), params?: StringParams): string {
  const k = typeof key === 'string' ? key : String(key);
  let template: string | undefined;
  const count = params?.count;
  if (typeof count === 'number' && Number.isFinite(count)) {
    template = lookup(`${k}.${count === 1 ? 'one' : 'other'}`);
  }
  if (template === undefined) template = lookup(k);
  if (template === undefined) {
    if (!warned.has(k)) {
      warned.add(k);
      warnHandler(`[i18n] missing string "${k}" (${language})`);
    }
    return k;
  }
  return interpolate(template, params);
}

/** True when a string exists for `key` (including plural forms). */
export function hasString(key: string): boolean {
  return lookup(key) !== undefined || lookup(`${key}.other`) !== undefined;
}

/** Merge extra strings (later registrations win over earlier ones and over the base dictionary). */
export function registerStrings(dict: Record<string, string>): void {
  if (!dict || typeof dict !== 'object') return;
  for (const k of Object.keys(dict)) {
    const v = dict[k];
    if (typeof v === 'string') extra[k] = v;
  }
}

export function setLanguage(lang: Language): void {
  language = lang;
}

export function getLanguage(): Language {
  return language;
}

/** Test hooks. */
export function _resetI18nForTests(opts?: { warn?: (msg: string) => void }): void {
  warned.clear();
  for (const k of Object.keys(extra)) delete extra[k];
  if (opts?.warn) warnHandler = opts.warn;
}
