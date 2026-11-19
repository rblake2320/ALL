/**
 * "Miniature set" look (ART_DIRECTION: a hand-painted miniature set / dollhouse of the undead).
 *
 * One full-screen pass that replaces the plain vignette on high/ultra:
 *  1. TILT-SHIFT FOCUS — a sharp horizontal band (60 % of the view) around the focus line (the selected zombie, else the screen centre);
 *     above and below it the picture softens with a 12-tap disc blur whose radius grows with distance from the band.
 *     Run before tone mapping on the HDR buffer, so lamps and candles bloom into soft discs like a real macro lens.
 *  2. SPLIT-TONE GRADE — shadows lean plum, highlights lean candle (the two anchor colours of the palette).
 *  3. VIGNETTE — the same plum-tinted vignette as before (same maths as VignetteShader).
 *
 * Rules:
 *  - purely cosmetic and renderer-only: nothing here touches the simulation or saves;
 *  - off while the build/buy grid is up (placement needs a sharp picture edge to edge): strength = 1 - grid level;
 *  - Reduce motion: the focus line does not track the zombie, it stays at the centre;
 *  - the player can switch it off (Settings → Miniature focus); low/medium never run it (no composer).
 *
 * The functions below are the pure maths, mirrored one-to-one in the GLSL so they can be unit-tested.
 */
import * as THREE from 'three';

export const DIORAMA = {
  /** Half-height of the fully sharp band, in screen heights. */
  band: 0.3,
  /** Distance past the band (screen heights) over which blur ramps to full. */
  ramp: 0.3,
  /** Maximum blur radius in CSS pixels on a 720-px-tall view; scaled with the view height (blurPxFor). */
  maxBlurPx: 4.5,
  /** The focus line may sit only inside this window, so the HUD edges are never the sharpest part. */
  focusMin: 0.34,
  focusMax: 0.66,
  /** Focus follow speed (1/s): higher = snappier. */
  followRate: 2.2,
  /** Split-tone amount, 0..1. */
  grade: 0.55,
  taps: 12,
} as const;

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Blur amount 0..1 at screen height `y` (0 bottom, 1 top) for a focus line at `focusY`. 0 inside the band. */
export function tiltShiftAmount(y: number, focusY: number, band: number = DIORAMA.band, ramp: number = DIORAMA.ramp): number {
  const d = Math.abs(fin(y, 0.5) - fin(focusY, 0.5));
  const b = Math.max(0, fin(band, DIORAMA.band));
  return smoothstep(b, b + Math.max(1e-4, fin(ramp, DIORAMA.ramp)), d);
}

/** Where the focus line should sit for a target at screen height `y01` (null / off-screen / garbage → centre). */
export function focusTarget(y01: number | null | undefined): number {
  if (typeof y01 !== 'number' || !Number.isFinite(y01) || y01 < -0.25 || y01 > 1.25) return 0.5;
  return Math.min(DIORAMA.focusMax, Math.max(DIORAMA.focusMin, y01));
}

/** Frame-rate independent follow: moves `prev` toward `target`; never overshoots; garbage dt → no move. */
export function smoothFocus(prev: number, target: number, dt: number, rate: number = DIORAMA.followRate): number {
  const p = fin(prev, 0.5);
  const tg = fin(target, 0.5);
  const d = fin(dt, 0);
  if (d <= 0) return p;
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.min(d, 0.25));
  const next = p + (tg - p) * k;
  return Math.abs(tg - next) < 0.0005 ? tg : next;
}

/** Blur radius in CSS px for a view `cssHeight` tall: the same fraction of the picture on a phone and a 4K screen. */
export function blurPxFor(cssHeight: number): number {
  const h = fin(cssHeight, 720);
  return DIORAMA.maxBlurPx * Math.min(3, Math.max(0.4, h / 720));
}

/** Overall effect strength 0..1: off while the build grid is showing (grid level 0..1), off when disabled. */
export function dioramaStrength(enabled: boolean, gridLevel: number): number {
  return enabled === true ? clamp01(1 - clamp01(fin(gridLevel, 0))) : 0;
}

export const DioramaShader = {
  name: 'AfterlifeDiorama',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uFocusY: { value: 0.5 },
    uBand: { value: DIORAMA.band as number },
    uRamp: { value: DIORAMA.ramp as number },
    uBlurPx: { value: DIORAMA.maxBlurPx as number },
    uAmount: { value: 1 },
    uGrade: { value: DIORAMA.grade as number },
    uShadowTint: { value: new THREE.Color(0.93, 0.89, 1.07) },
    uHighTint: { value: new THREE.Color(1.06, 1.0, 0.91) },
    uStrength: { value: 0.32 },
    uAspect: { value: 16 / 9 },
    uTint: { value: new THREE.Color(0.62, 0.56, 0.72) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uFocusY;
    uniform float uBand;
    uniform float uRamp;
    uniform float uBlurPx;
    uniform float uAmount;
    uniform float uGrade;
    uniform vec3 uShadowTint;
    uniform vec3 uHighTint;
    uniform float uStrength;
    uniform float uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = base.rgb;
      // 1. tilt-shift: 12 taps on a golden-angle disc, radius grows away from the focus band
      float amt = smoothstep(uBand, uBand + uRamp, abs(vUv.y - uFocusY)) * uAmount;
      float r = amt * uBlurPx;
      if (r > 0.3) {
        vec3 acc = col;
        for (int i = 0; i < ${DIORAMA.taps}; i++) {
          float fi = float(i);
          float a = fi * 2.39996323;
          float rr = sqrt((fi + 0.5) / ${DIORAMA.taps}.0) * r;
          acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr * uTexel).rgb;
        }
        col = acc / ${DIORAMA.taps + 1}.0;
      }
      // 2. split-tone: plum shadows, candle highlights (HDR-safe luminance)
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float lt = l / (1.0 + l);
      vec3 toned = col * mix(uShadowTint, uHighTint, smoothstep(0.08, 0.6, lt));
      col = mix(col, toned, uGrade * uAmount);
      // 3. vignette (identical to VignetteShader)
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0) * 2.0;
      float v = smoothstep(0.45, 1.25, length(d)) * uStrength;
      col *= mix(vec3(1.0), uTint, v);
      gl_FragColor = vec4(col, base.a);
    }
  `,
};
