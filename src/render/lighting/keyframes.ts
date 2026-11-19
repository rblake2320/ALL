/**
 * Day/night lighting keyframes (ART_DIRECTION: soft warm-grey overcast day, lilac/orange dusk, deep blue-plum
 * night with a big pale moon, full-moon nights tinted slightly green). Pure; unit-tested.
 *
 * Colours are sRGB triplets in [0,1]; the lighting module converts to linear when applying.
 * The key light is the sun by day and the moon by night (one shadow-casting directional light); its direction
 * is keyed by azimuth (facing convention: 0 = from +Z/street, PI/2 = from +X/east) and elevation (radians).
 */
import { clamp, mod, smooth01 } from '../core/math';

export type RGB = [number, number, number];

export interface LightKey {
  /** Minute of day 0..1439. */
  t: number;
  keyColor: RGB;
  keyIntensity: number;
  keyAzimuth: number;
  keyElevation: number;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  fogColor: RGB;
  /** Relative fog thickness (1 = default range; >1 = thicker/closer fog). */
  fogDensity: number;
  skyZenith: RGB;
  skyHorizon: RGB;
  stars: number;
  moon: number;
  /** 0..1 how strongly lit windows glow. */
  windowGlow: number;
  /** 0..1 lamps switched on (≥ 0.5 → lamps count as lit). */
  lamps: number;
  exposure: number;
  /** 0 = full day .. 1 = deep night (drives full-moon tint, stars, etc.). */
  night: number;
}

export interface LightingSample extends LightKey {
  /** 0..1 full-moon tint actually applied. */
  moonTint: number;
  /** Moon disc size multiplier (bigger on full moon). */
  moonSize: number;
}

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const NIGHT: Omit<LightKey, 't'> = {
  keyColor: hex('#9db0e0'),
  keyIntensity: 0.75,
  keyAzimuth: -0.55,
  keyElevation: 0.78,
  hemiSky: hex('#3b3866'),
  hemiGround: hex('#241c2c'),
  hemiIntensity: 0.85,
  fogColor: hex('#221f3a'),
  fogDensity: 1.2,
  skyZenith: hex('#0c0b1d'),
  skyHorizon: hex('#2a2648'),
  stars: 1,
  moon: 1,
  windowGlow: 1,
  lamps: 1,
  exposure: 1.18,
  night: 1,
};

/** Keyframes sorted by time; the table wraps at midnight. */
export const LIGHT_KEYS: readonly LightKey[] = [
  { t: 0, ...NIGHT },
  { t: 300, ...NIGHT },
  {
    t: 340,
    keyColor: hex('#7f7cb8'),
    keyIntensity: 0.45,
    keyAzimuth: 0.6,
    keyElevation: 0.4,
    hemiSky: hex('#4d4777'),
    hemiGround: hex('#2a2230'),
    hemiIntensity: 0.75,
    fogColor: hex('#45405e'),
    fogDensity: 1.25,
    skyZenith: hex('#1f2044'),
    skyHorizon: hex('#6b5878'),
    stars: 0.55,
    moon: 0.6,
    windowGlow: 0.9,
    lamps: 1,
    exposure: 1.14,
    night: 0.85,
  },
  {
    t: 380,
    keyColor: hex('#ffb38e'),
    keyIntensity: 1.15,
    keyAzimuth: 1.4,
    keyElevation: 0.13,
    hemiSky: hex('#8a7fa6'),
    hemiGround: hex('#45333b'),
    hemiIntensity: 0.8,
    fogColor: hex('#9d8a9c'),
    fogDensity: 1.15,
    skyZenith: hex('#55598c'),
    skyHorizon: hex('#e8aa8e'),
    stars: 0.1,
    moon: 0.15,
    windowGlow: 0.35,
    lamps: 0.4,
    exposure: 1.05,
    night: 0.35,
  },
  {
    t: 480,
    keyColor: hex('#ffe3c2'),
    keyIntensity: 2.4,
    keyAzimuth: 1.1,
    keyElevation: 0.42,
    hemiSky: hex('#b8c1c3'),
    hemiGround: hex('#59564a'),
    hemiIntensity: 0.88,
    fogColor: hex('#a6ada2'),
    fogDensity: 1,
    skyZenith: hex('#8a9cb0'),
    skyHorizon: hex('#c6c8bd'),
    stars: 0,
    moon: 0,
    windowGlow: 0,
    lamps: 0,
    exposure: 1,
    night: 0,
  },
  {
    t: 750,
    keyColor: hex('#fff0dc'),
    keyIntensity: 2.7,
    keyAzimuth: 0.45,
    keyElevation: 0.78,
    hemiSky: hex('#c2c8c6'),
    hemiGround: hex('#5a5848'),
    hemiIntensity: 0.9,
    fogColor: hex('#9aa39a'),
    fogDensity: 1,
    skyZenith: hex('#8e9fae'),
    skyHorizon: hex('#c3c7bb'),
    stars: 0,
    moon: 0,
    windowGlow: 0,
    lamps: 0,
    exposure: 1,
    night: 0,
  },
  {
    t: 990,
    keyColor: hex('#ffd6a3'),
    keyIntensity: 2.4,
    keyAzimuth: -0.75,
    keyElevation: 0.45,
    hemiSky: hex('#bdb6b2'),
    hemiGround: hex('#575043'),
    hemiIntensity: 0.88,
    fogColor: hex('#a8a294'),
    fogDensity: 1,
    skyZenith: hex('#8b93a8'),
    skyHorizon: hex('#d3c4ab'),
    stars: 0,
    moon: 0,
    windowGlow: 0,
    lamps: 0,
    exposure: 1,
    night: 0,
  },
  {
    t: 1125,
    keyColor: hex('#ff9a66'),
    keyIntensity: 2.2,
    keyAzimuth: -1.3,
    keyElevation: 0.24,
    hemiSky: hex('#9a78a8'),
    hemiGround: hex('#4a3542'),
    hemiIntensity: 0.98,
    fogColor: hex('#a07f92'),
    fogDensity: 1.05,
    skyZenith: hex('#4c4a7c'),
    skyHorizon: hex('#f09a6c'),
    stars: 0.1,
    moon: 0.2,
    windowGlow: 0.65,
    lamps: 1,
    exposure: 1.16,
    night: 0.4,
  },
  {
    t: 1170,
    keyColor: hex('#7d77b4'),
    keyIntensity: 0.5,
    keyAzimuth: -1.0,
    keyElevation: 0.4,
    hemiSky: hex('#4f4676'),
    hemiGround: hex('#291f2d'),
    hemiIntensity: 0.8,
    fogColor: hex('#3f3858'),
    fogDensity: 1.15,
    skyZenith: hex('#1d1b3c'),
    skyHorizon: hex('#5d4b7a'),
    stars: 0.6,
    moon: 0.75,
    windowGlow: 1,
    lamps: 1,
    exposure: 1.14,
    night: 0.85,
  },
  { t: 1215, ...NIGHT },
];

const FULL_MOON_KEY = hex('#b4ffbc');
const FULL_MOON_SKY = hex('#35604c');
const FULL_MOON_GROUND = hex('#1f3326');
const FULL_MOON_FOG = hex('#1e3a30');
const FULL_MOON_HORIZON = hex('#2f5a48');

export function createLightingSample(): LightingSample {
  const s: LightingSample = {
    t: 0,
    ...NIGHT,
    keyColor: [0, 0, 0],
    hemiSky: [0, 0, 0],
    hemiGround: [0, 0, 0],
    fogColor: [0, 0, 0],
    skyZenith: [0, 0, 0],
    skyHorizon: [0, 0, 0],
    moonTint: 0,
    moonSize: 1,
  };
  return s;
}

function mixRGB(a: RGB, b: RGB, t: number, out: RGB): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

function mixAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Index of the keyframe at or before `minute` (minute already in [0,1440)). */
export function keyIndexAt(minute: number): number {
  let i = LIGHT_KEYS.length - 1;
  for (let k = 0; k < LIGHT_KEYS.length; k++) {
    if (LIGHT_KEYS[k].t <= minute) i = k;
    else break;
  }
  return i;
}

/**
 * Sample the lighting at a (fractional) minute of day. Wraps at midnight (1439.9 → 0 blends smoothly),
 * non-finite minutes are treated as noon. `fullMoon` (0..1) blends in the green full-moon tint, scaled by
 * how deep into the night it is.
 */
export function sampleLighting(minuteOfDay: number, fullMoon: number, out: LightingSample = createLightingSample()): LightingSample {
  const m = Number.isFinite(minuteOfDay) ? mod(minuteOfDay, 1440) : 720;
  const i = keyIndexAt(m);
  const a = LIGHT_KEYS[i];
  const b = LIGHT_KEYS[(i + 1) % LIGHT_KEYS.length];
  const tb = b.t <= a.t ? b.t + 1440 : b.t;
  const span = tb - a.t;
  const raw = span > 0 ? (m - a.t) / span : 0;
  const t = smooth01(raw);

  out.t = m;
  mixRGB(a.keyColor, b.keyColor, t, out.keyColor);
  out.keyIntensity = a.keyIntensity + (b.keyIntensity - a.keyIntensity) * t;
  out.keyAzimuth = mixAngle(a.keyAzimuth, b.keyAzimuth, t);
  out.keyElevation = a.keyElevation + (b.keyElevation - a.keyElevation) * t;
  mixRGB(a.hemiSky, b.hemiSky, t, out.hemiSky);
  mixRGB(a.hemiGround, b.hemiGround, t, out.hemiGround);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  mixRGB(a.fogColor, b.fogColor, t, out.fogColor);
  out.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  mixRGB(a.skyZenith, b.skyZenith, t, out.skyZenith);
  mixRGB(a.skyHorizon, b.skyHorizon, t, out.skyHorizon);
  out.stars = a.stars + (b.stars - a.stars) * t;
  out.moon = a.moon + (b.moon - a.moon) * t;
  out.windowGlow = a.windowGlow + (b.windowGlow - a.windowGlow) * t;
  out.lamps = a.lamps + (b.lamps - a.lamps) * t;
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
  out.night = a.night + (b.night - a.night) * t;

  const fm = clamp(Number.isFinite(fullMoon) ? fullMoon : 0, 0, 1) * out.night;
  out.moonTint = fm;
  out.moonSize = 1 + 0.45 * fm;
  if (fm > 0) {
    // "slightly green": a tint, not a colour cast
    mixRGB(out.keyColor, FULL_MOON_KEY, fm * 0.4, out.keyColor);
    out.keyIntensity *= 1 + 0.28 * fm;
    mixRGB(out.hemiSky, FULL_MOON_SKY, fm * 0.3, out.hemiSky);
    mixRGB(out.hemiGround, FULL_MOON_GROUND, fm * 0.25, out.hemiGround);
    mixRGB(out.fogColor, FULL_MOON_FOG, fm * 0.4, out.fogColor);
    mixRGB(out.skyHorizon, FULL_MOON_HORIZON, fm * 0.4, out.skyHorizon);
  }
  return out;
}

/** Lamps count as switched on when the keyed lamp factor is at least half. */
export function lampsOn(sample: Pick<LightKey, 'lamps'>): boolean {
  return sample.lamps >= 0.5;
}

/**
 * Smooth full-moon factor for a world tick: 1 on full-moon nights (evening of every 7th day through the next
 * dawn, matching src/sim/time.ts), 0 otherwise. Callers multiply by the night factor for a soft fade.
 */
export function fullMoonTonight(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes)) return 0;
  const dayIndex = Math.floor(totalMinutes / 1440);
  const minuteOfDay = totalMinutes - dayIndex * 1440;
  const day = dayIndex + 1;
  if (minuteOfDay >= 720) return day % 7 === 0 ? 1 : 0;
  return day > 1 && (day - 1) % 7 === 0 ? 1 : 0;
}
