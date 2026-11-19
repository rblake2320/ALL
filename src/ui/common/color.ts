/** Colour helpers: hex parsing, mixing, WCAG contrast, need ramp and mood-band colours. Pure + total. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** '#abc', '#aabbcc', 'aabbcc', '#aabbccdd' → Rgb; anything else → null. */
export function parseHex(hex: unknown): Rgb | null {
  if (typeof hex !== 'string') return null;
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).replace(/./g, (c) => c + c);
  else h = h.slice(0, 6);
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex(c: Rgb): string {
  const ch = (v: number) => {
    const x = Math.round(Number.isFinite(v) ? Math.min(255, Math.max(0, v)) : 0);
    return x.toString(16).padStart(2, '0');
  };
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

/** Safe colour: returns a valid '#rrggbb' or the fallback. */
export function safeHex(hex: unknown, fallback: string): string {
  const c = parseHex(hex);
  return c ? toHex(c) : fallback;
}

/** Linear interpolation between two hex colours (t clamped 0..1). Invalid inputs fall back to grey. */
export function mixHex(a: string, b: string, tt: number): string {
  const ca = parseHex(a) ?? { r: 128, g: 128, b: 128 };
  const cb = parseHex(b) ?? { r: 128, g: 128, b: 128 };
  const k = Number.isFinite(tt) ? Math.min(1, Math.max(0, tt)) : 0;
  return toHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k });
}

/** Darken (amount < 0) or lighten (amount > 0) toward black/white. */
export function shadeHex(hex: string, amount: number): string {
  return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#000000', -amount);
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0..1). */
export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two colours (1..21). Invalid input → 1. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const ca = typeof a === 'string' ? parseHex(a) : a;
  const cb = typeof b === 'string' ? parseHex(b) : b;
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a translucent colour over an opaque background. */
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
}

/** Dark ink or bone text, whichever reads better on `bg`. */
export function readableOn(bg: string): '#15101c' | '#f6f0dd' {
  const c = parseHex(bg);
  if (!c) return '#f6f0dd';
  return contrastRatio(c, '#15101c') >= contrastRatio(c, '#f6f0dd') ? '#15101c' : '#f6f0dd';
}

/** Need bar ramp stops (ART_DIRECTION: low candle orange → high teal, colour-blind safe). */
export const NEED_RAMP = [
  { at: 0, color: '#ff9a4a' },
  { at: 0.5, color: '#e3cf6a' },
  { at: 1, color: '#55d6be' },
] as const;

/** Need value 0..100 → ramp colour. NaN → low end. */
export function needColor(value: number): string {
  const v = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : 0;
  for (let i = 1; i < NEED_RAMP.length; i++) {
    const a = NEED_RAMP[i - 1];
    const b = NEED_RAMP[i];
    if (v <= b.at) return mixHex(a.color, b.color, (v - a.at) / (b.at - a.at));
  }
  return NEED_RAMP[NEED_RAMP.length - 1].color;
}

export type NeedBand = 'low' | 'mid' | 'high';

/** Pattern band for colour-blind mode: low ≤ 30 < mid < 70 ≤ high. */
export function needBand(value: number): NeedBand {
  const v = Number.isFinite(value) ? value : 0;
  return v <= 30 ? 'low' : v < 70 ? 'mid' : 'high';
}

export type MoodBand = 'miserable' | 'uneasy' | 'fine' | 'good' | 'great';

const MOOD_COLORS: Record<MoodBand, string> = {
  miserable: '#e2566a',
  uneasy: '#ff9a4a',
  fine: '#d9cfb8',
  good: '#55d6be',
  great: '#9fe870',
};

/** Ring colour for a mood band (unknown → 'fine'). */
export function moodBandColor(band: string | null | undefined): string {
  return (band && Object.prototype.hasOwnProperty.call(MOOD_COLORS, band) ? MOOD_COLORS[band as MoodBand] : MOOD_COLORS.fine);
}

/** Mood value (−100..100) → band, mirroring GDD §3. */
export function moodBandOf(value: number): MoodBand {
  const v = Number.isFinite(value) ? value : 0;
  if (v <= -50) return 'miserable';
  if (v <= -15) return 'uneasy';
  if (v < 15) return 'fine';
  if (v < 50) return 'good';
  return 'great';
}
