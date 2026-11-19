/**
 * Pure colour math for zombie recolouring (no three.js dependency; values are sRGB 0..1).
 * Every function tolerates garbage input (non-strings, NaN, out-of-range) and falls back safely.
 */
import { SKIN_TONES } from '../../shared/appearance';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Sickly green-grey the skin drifts toward as preservation drops. */
export const ROT_TINT = '#7c8a5c';
/** Colour of the darker decay blotches (shader overlay). */
export const BLOTCH_COLOR = '#4b4a2f';
/** How far the skin tone moves toward ROT_TINT at decay = 1. */
export const ROT_TINT_AMOUNT = 0.55;

export function clamp01(x: number): number {
  return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
}

/** Finite number or the fallback. */
export function finiteOr(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

/** Parse '#rgb' / '#rrggbb' (with or without '#'). Invalid input returns the parsed fallback (or mid grey). */
export function parseHex(v: unknown, fallback = '#808080'): Rgb {
  const src = isHexColor(v) ? v.trim() : isHexColor(fallback) ? fallback : '#808080';
  let h = src.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function toHex(c: Rgb): string {
  const f = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');
  return `#${f(c.r)}${f(c.g)}${f(c.b)}`;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k };
}

/** Index into SKIN_TONES, clamped; NaN / non-numbers -> 0. Fractions round to the nearest tone. */
export function skinToneIndex(i: unknown): number {
  const n = finiteOr(i, 0);
  const r = Math.round(n);
  return r < 0 ? 0 : r >= SKIN_TONES.length ? SKIN_TONES.length - 1 : r;
}

/** Final skin colour for a tone index and decay level (0 fresh .. 1 rotting). */
export function skinColor(tone: unknown, decay: unknown): Rgb {
  const base = parseHex(SKIN_TONES[skinToneIndex(tone)]);
  return mixRgb(base, parseHex(ROT_TINT), clamp01(finiteOr(decay, 0)) * ROT_TINT_AMOUNT);
}

/** Opacity of the blotch overlay for a decay level (none when fresh, eases in from ~0.15). */
export function blotchStrength(decay: unknown): number {
  const d = clamp01(finiteOr(decay, 0));
  const t = clamp01((d - 0.12) / 0.88);
  return t * t * (3 - 2 * t);
}

/** sRGB -> linear (for shader uniforms that bypass three's colour management). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
