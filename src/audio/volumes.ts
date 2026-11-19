/** Pure volume / spatial sanitising. Everything coming through the public API is treated as untrusted. */
import type { AudioVolumes, SpatialHint } from './contracts';

export const VOLUME_KEYS = ['master', 'music', 'sfx', 'voice', 'ambient', 'ui'] as const;
export type VolumeKey = (typeof VOLUME_KEYS)[number];

/** Mirrors DEFAULT_SETTINGS.volumes in src/game/contracts.ts. */
export const DEFAULT_VOLUMES: Readonly<AudioVolumes> = Object.freeze({
  master: 0.8,
  music: 0.55,
  sfx: 0.8,
  voice: 0.75,
  ambient: 0.5,
  ui: 0.6,
});

/** Clamp to [0, 1]. NaN / non-numbers fall back; ±Infinity clamp to the nearest bound. */
export function sanitizeVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export function copyVolumes(v: Readonly<AudioVolumes>): AudioVolumes {
  return { master: v.master, music: v.music, sfx: v.sfx, voice: v.voice, ambient: v.ambient, ui: v.ui };
}

/** Apply an untrusted partial patch. Unknown keys are ignored; invalid values keep the current value. */
export function mergeVolumes(current: Readonly<AudioVolumes>, patch: unknown): AudioVolumes {
  const out = copyVolumes(current);
  if (patch === null || typeof patch !== 'object') return out;
  const p = patch as Record<string, unknown>;
  for (let i = 0; i < VOLUME_KEYS.length; i++) {
    const k = VOLUME_KEYS[i];
    let raw: unknown;
    try {
      raw = p[k];
    } catch {
      continue; // hostile getter
    }
    if (raw === undefined) continue;
    out[k] = sanitizeVolume(raw, out[k]);
  }
  return out;
}

/**
 * Slider position (0..1) -> linear gain. Squared taper: 50% ≈ -12 dB, 80% ≈ -4 dB, which feels even
 * across the slider for game mixes.
 */
export function volumeToGain(v: number): number {
  const x = sanitizeVolume(v, 0);
  return x * x;
}

export function sanitizePan(p: unknown): number {
  if (typeof p !== 'number' || Number.isNaN(p)) return 0;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

/** Distance gain from the caller: NaN (e.g. 0/0) means "no attenuation info" -> 1. */
export function sanitizeSpatialGain(g: unknown): number {
  if (typeof g !== 'number' || Number.isNaN(g)) return 1;
  return g < 0 ? 0 : g > 1 ? 1 : g;
}

/** Positive multiplier (pitch/volume option). NaN/≤0/non-number -> fallback; clamped to [min, max]. */
export function sanitizeMultiplier(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !(v > 0)) return fallback;
  return v < min ? min : v > max ? max : v;
}

/** Read an untrusted SpatialHint into a reusable object (no allocation on the hot path). */
export function readSpatial(s: unknown, out: { pan: number; gain: number }): void {
  out.pan = 0;
  out.gain = 1;
  if (s === null || typeof s !== 'object') return;
  try {
    const h = s as Partial<SpatialHint>;
    out.pan = sanitizePan(h.pan);
    out.gain = sanitizeSpatialGain(h.gain);
  } catch {
    out.pan = 0;
    out.gain = 1;
  }
}

/** Finite number or fallback. */
export function finite(v: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
