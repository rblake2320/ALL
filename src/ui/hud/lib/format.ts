/**
 * Pure formatting helpers for the HUD. No DOM, no Preact — unit tested in tests/unit/ui-hud/format.test.ts.
 * Every function tolerates garbage input (NaN, Infinity, undefined smuggled through `any`) and never throws.
 */
import { TICK_MINUTES } from '../../../sim/types';

/** Typographic minus (U+2212) — reads better than a hyphen next to currency. */
export const MINUS = '−';
/** Shown for values we cannot format (NaN, Infinity, missing). */
export const UNKNOWN = '—';

export function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Finite number or the fallback. */
export function num(n: unknown, fallback = 0): number {
  return isNum(n) ? n : fallback;
}

/** Clamp with sane behaviour for non-finite input: NaN → lo, +∞ → hi, −∞ → lo. */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

/** 1234567 → "1,234,567" (deterministic; no Intl/locale dependency). */
export function groupThousands(n: number): string {
  if (!isNum(n)) return UNKNOWN;
  const abs = Math.floor(Math.abs(n));
  // Number#toString switches to exponent notation at 1e21 ("1e+21"); BigInt keeps every digit.
  const s = abs < 1e21 ? abs.toString() : BigInt(abs).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return out;
}

function compactAbs(abs: number): string {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const v = abs / size;
      const digits = v >= 100 ? 0 : 1;
      let txt = v.toFixed(digits);
      if (txt.endsWith('.0')) txt = txt.slice(0, -2);
      return txt + suffix;
    }
  }
  return groupThousands(abs);
}

/**
 * Dollars → "$6,500" / "−$45". Rounds to whole dollars (funds are integers).
 * `compact` abbreviates large values ("$12.5K", "$1.2M") — used where space is tight.
 */
export function formatMoney(n: unknown, opts: { compact?: boolean } = {}): string {
  if (!isNum(n)) return '$' + UNKNOWN;
  const r = Math.round(n);
  const abs = Math.abs(r);
  const body = opts.compact && abs >= 10_000 ? compactAbs(abs) : groupThousands(abs);
  return (r < 0 ? MINUS : '') + '$' + body;
}

/** Signed delta for floaters/ledgers: "+$240", "−$45", "$0". */
export function formatSignedMoney(delta: unknown, opts: { compact?: boolean } = {}): string {
  if (!isNum(delta)) return '$' + UNKNOWN;
  const r = Math.round(delta);
  if (r === 0) return '$0';
  return (r > 0 ? '+' : '') + formatMoney(r, opts);
}

/** Signed plain number: "+12", "−5", "0". */
export function formatSigned(n: unknown, digits = 0): string {
  if (!isNum(n)) return UNKNOWN;
  const f = Math.pow(10, Math.max(0, Math.min(4, Math.floor(digits))));
  const r = Math.round(n * f) / f;
  if (r === 0) return '0';
  const body = Math.abs(r).toFixed(Math.max(0, Math.min(4, Math.floor(digits))));
  return (r > 0 ? '+' : MINUS) + body;
}

/**
 * Game minutes → compact duration. null = indefinite ("∞").
 *   0.4 → "<1m", 45 → "45m", 135 → "2h 15m", 120 → "2h", 1500 → "1d 1h", 2880 → "2d".
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '∞';
  if (Number.isNaN(minutes)) return '0m';
  if (minutes === Infinity) return '∞';
  if (minutes <= 0) return '0m';
  if (minutes < 1) return '<1m';
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Ticks until `targetTick` from `nowTick`, in game minutes (never negative). */
export function minutesUntil(nowTick: number, targetTick: number): number {
  if (!isNum(nowTick) || !isNum(targetTick)) return 0;
  return Math.max(0, (targetTick - nowTick) * TICK_MINUTES);
}

/** 0..1 → "62%". */
export function formatPercent(fraction: unknown): string {
  if (!isNum(fraction)) return UNKNOWN;
  return `${Math.round(fraction * 100)}%`;
}

/** "Mortimer Grimsby" → "MG"; "  " → "?"; handles astral-plane characters. */
export function initials(name: unknown): string {
  if (typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

/** "1 guest" / "3 guests". */
export function plural(n: number, one: string, many: string): string {
  return `${isNum(n) ? n : 0} ${n === 1 ? one : many}`;
}

/** Hex "#rrggbb" or "#rgb" → [r,g,b] (0..255). Invalid input → null. */
export function parseHex(hex: unknown): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Linear sRGB-space mix of two hex colours (t = 0 → a, 1 → b). Bad input falls back to `a` or grey. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca && !cb) return '#808080';
  if (!ca) return toHex(cb!);
  if (!cb) return toHex(ca);
  const k = clamp01(num(t));
  return toHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}

/** Relative luminance (WCAG) of a hex colour; invalid → 0. */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const lin = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Readable ink (dark plum or bone) for text drawn on top of a colour swatch. */
export function inkFor(bgHex: string): string {
  return contrastRatio(bgHex, '#15101c') >= contrastRatio(bgHex, '#f6f0dd') ? '#15101c' : '#f6f0dd';
}

export const NEED_LOW = '#ff9a4a';
export const NEED_MID = '#e3cf6a';
export const NEED_HIGH = '#55d6be';

/** Need bar ramp (ART_DIRECTION: low candle orange → high teal, via a warm mid so the middle never looks muddy). */
export function needColor(value: unknown): string {
  const t = clamp01(num(value) / 100);
  if (t <= 0.5) return mixHex(NEED_LOW, NEED_MID, t / 0.5);
  return mixHex(NEED_MID, NEED_HIGH, (t - 0.5) / 0.5);
}

/**
 * Trend (net change per game hour) → arrow count, signed: −3..3.
 * |trend| < 0.75 → 0 (steady), < 5 → 1, < 15 → 2, else 3.
 */
export function trendLevel(trend: unknown): -3 | -2 | -1 | 0 | 1 | 2 | 3 {
  if (!isNum(trend)) return 0;
  const a = Math.abs(trend);
  const lvl = a < 0.75 ? 0 : a < 5 ? 1 : a < 15 ? 2 : 3;
  if (lvl === 0) return 0;
  return (trend < 0 ? -lvl : lvl) as -3 | -2 | -1 | 0 | 1 | 2 | 3;
}

/** Career performance −100..100 → bar fraction 0..1 (0.5 = neutral). */
export function performanceFraction(p: unknown): number {
  return clamp01((num(p) + 100) / 200);
}

/** Friendship −100..100 → { fraction 0..1 of |value|, negative }. */
export function signedFraction(v: unknown, range = 100): { fraction: number; negative: boolean } {
  const n = num(v);
  const r = isNum(range) && range > 0 ? range : 100;
  return { fraction: clamp01(Math.abs(n) / r), negative: n < 0 };
}

/** Party score band (GDD §11): ≤ 30 lame, ≥ 70 legendary. */
export function partyBand(score: unknown): 'lame' | 'okay' | 'legendary' {
  const s = num(score);
  if (s >= 70) return 'legendary';
  if (s <= 30) return 'lame';
  return 'okay';
}

/** Simple `{name}` interpolation; unknown placeholders are left intact; non-string params are stringified. */
export function interpolate(template: string, params?: Record<string, unknown>): string {
  if (typeof template !== 'string') return '';
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_.:]+)\}/g, (whole, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) return whole;
    const v = params[key];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}

/** Ease-out cubic (0..1 → 0..1). */
export function easeOutCubic(t: number): number {
  const k = clamp01(num(t));
  return 1 - Math.pow(1 - k, 3);
}

/** Count-up tween value between `from` and `to` at progress t (rounded to whole dollars). */
export function tweenInt(from: number, to: number, t: number): number {
  const a = num(from);
  const b = num(to, a);
  return Math.round(a + (b - a) * easeOutCubic(t));
}

/** Number of game minutes represented by the given tick count. */
export function ticksToMinutes(ticks: number): number {
  return num(ticks) * TICK_MINUTES;
}

/**
 * PartyView.endsLabel arrives in two shapes: SIM-PEOPLE's party system reports a complete phrase ("Ends 1:16 AM",
 * "Party’s over"), the engine fallback a bare time ("Today 1:16 AM", "Tomorrow 1:16 AM", "Mon 1:16 AM"). Returns
 * `null` for a complete phrase (show it verbatim) or the time to put in the HUD's own "Ends {when}" template —
 * never "Ends Ends 1:16 AM".
 */
export function partyEndsTime(raw: unknown): { phrase: string } | { when: string } {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!s) return { when: UNKNOWN };
  const ends = /^ends\b[\s:,-]*(.*)$/i.exec(s);
  if (ends) return ends[1] ? { when: ends[1] } : { phrase: s };
  // anything that does not start with a time / day word is already a sentence ("Party’s over", "Winding down")
  if (/^(today|tonight|tomorrow|yesterday|in\b|at\b|mon|tue|wed|thu|fri|sat|sun|\d)/i.test(s)) return { when: s };
  return { phrase: s };
}

/**
 * Activity / queue labels come from the engine's gerund() of a menu label; a label that ends in an ellipsis
 * ("Cook…") turns into "Cook…ing". Repair that ("Cooking") and collapse stray whitespace; otherwise verbatim.
 */
export function cleanActivityLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/([A-Za-z])(?:…|\.\.\.)(ing\b)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}
