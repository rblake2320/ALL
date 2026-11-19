/**
 * Quality presets (pure). low: no shadows/bloom, pixel ratio 1 · medium: 1024 PCF shadows · high: 2048 PCFSoft
 * shadows + bloom + vignette + miniature look (core/diorama.ts) · ultra: 4096 shadows + supersampled pixel ratio.
 */
import type { QualityLevel } from '../contracts';

export interface QualitySettings {
  level: QualityLevel;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  /** EffectComposer pipeline (bloom + vignette + output). */
  post: boolean;
  bloom: boolean;
  vignette: boolean;
  /** Miniature-set look: tilt-shift focus + split-tone (core/diorama.ts). Needs `post`. */
  diorama: boolean;
  /** Max render pixel ratio (applied to devicePixelRatio), min for ultra supersampling. */
  pixelRatioMin: number;
  pixelRatioMax: number;
  /** MSAA samples for the composer render target. */
  msaa: number;
  /** PointLights in the lamp pool. */
  lampLights: number;
  /** Particle pool capacity and per-kind cap scale. */
  particleCapacity: number;
  particleScale: number;
  /** Image-based ambient from the sky dome. */
  environment: boolean;
  anisotropy: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

const PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    shadows: false,
    shadowMapSize: 0,
    softShadows: false,
    post: false,
    bloom: false,
    vignette: false,
    diorama: false,
    pixelRatioMin: 1,
    pixelRatioMax: 1,
    msaa: 0,
    lampLights: 4,
    particleCapacity: 384,
    particleScale: 0.5,
    environment: false,
    anisotropy: 1,
  },
  medium: {
    level: 'medium',
    shadows: true,
    shadowMapSize: 1024,
    softShadows: false,
    post: false,
    bloom: false,
    vignette: false,
    diorama: false,
    pixelRatioMin: 1,
    pixelRatioMax: 1.5,
    msaa: 0,
    lampLights: 6,
    particleCapacity: 640,
    particleScale: 0.75,
    environment: true,
    anisotropy: 4,
  },
  high: {
    level: 'high',
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    post: true,
    bloom: true,
    vignette: true,
    diorama: true,
    pixelRatioMin: 1,
    pixelRatioMax: 2,
    msaa: 4,
    lampLights: 8,
    particleCapacity: 1024,
    particleScale: 1,
    environment: true,
    anisotropy: 8,
  },
  ultra: {
    level: 'ultra',
    shadows: true,
    shadowMapSize: 4096,
    softShadows: true,
    post: true,
    bloom: true,
    vignette: true,
    diorama: true,
    pixelRatioMin: 1.5,
    pixelRatioMax: 2.5,
    msaa: 4,
    lampLights: 8,
    particleCapacity: 1536,
    particleScale: 1.25,
    environment: true,
    anisotropy: 16,
  },
};

export function isQualityLevel(q: unknown): q is QualityLevel {
  return q === 'low' || q === 'medium' || q === 'high' || q === 'ultra';
}

/** Preset for a level; unknown values fall back to 'high'. Returns a copy (safe to mutate). */
export function qualitySettings(q: unknown): QualitySettings {
  return { ...PRESETS[isQualityLevel(q) ? q : 'high'] };
}

/**
 * Effective render pixel ratio. Auto (the player has not set Pixel Ratio): devicePixelRatio clamped into the preset
 * window (Ultra supersamples 1x displays up to 1.5). Explicit (D-025): the player's ratio wins over every preset,
 * Ultra's supersampling included (clamped to 0.5..4). Garbage ratios read as 1. Always capped so the drawing buffer
 * stays <= ~16.7M pixels.
 */
export function effectivePixelRatio(q: unknown, devicePixelRatio: unknown, cssWidth = 0, cssHeight = 0, explicit = false): number {
  const s = qualitySettings(q);
  const dpr = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  let pr = explicit === true ? Math.min(4, Math.max(0.5, dpr)) : Math.min(Math.max(dpr, s.pixelRatioMin), s.pixelRatioMax);
  const area = (Number.isFinite(cssWidth) ? cssWidth : 0) * (Number.isFinite(cssHeight) ? cssHeight : 0);
  if (area > 0) {
    const maxPr = Math.sqrt(16_777_216 / area);
    if (pr > maxPr) pr = Math.max(0.5, maxPr);
  }
  return pr;
}

/** Drawing-buffer size for a CSS size and pixel ratio (what three.js allocates: floor(css * ratio)). */
export function internalResolution(cssWidth: number, cssHeight: number, pixelRatio: number): { width: number; height: number } {
  const w = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0;
  const h = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 0;
  const pr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return { width: Math.floor(w * pr), height: Math.floor(h * pr) };
}
