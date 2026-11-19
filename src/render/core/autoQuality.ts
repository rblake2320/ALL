/**
 * Auto quality (W-039, pure: no three.js, no DOM).
 *
 *  1. GPU tier: WEBGL_debug_renderer_info strings -> a ceiling level (low / medium / high; Auto never picks Ultra).
 *     Software rasterisers (SwiftShader, llvmpipe, WARP...) and mobile GPUs -> low; integrated Intel / AMD -> low;
 *     Apple M-series base chips -> medium, Pro / Max / Ultra -> high; discrete NVIDIA / AMD / Intel Arc -> high
 *     (older / entry discrete -> medium); unknown -> medium.
 *  2. First-run probe: ~3 s of real frame intervals at the ceiling (after a warm-up that absorbs shader compiles);
 *     p95 <= 33.3 ms keeps it, <= 50 ms drops one level, worse drops two. Never above the ceiling.
 *  3. Runtime watch: tumbling 10 s windows of frame intervals; a window whose p95 exceeds 33.3 ms drops ONE level,
 *     then a fresh warm-up + window at the new level. Auto never upgrades by itself (no oscillation possible); the
 *     only ways back up are the player choosing a level, or Reset Settings (which re-probes).
 *
 * Thresholds come from Sol's W-022 AMD-iGPU run (docs/desktop-reports/perf-lowend.md on desktop/sol-perf): Radeon(TM)
 * Graphics iGPU at 1080p, Low 45-60 fps, Medium 35.7 fps / p95 54.5 ms, High 25.8 fps / p95 72.8 ms, Ultra
 * 12.7 fps / p95 157.7 ms. A probe at High on that machine (p95 ~73 ms) lands on Low, Medium (p95 ~55 ms) on Low.
 */
import type { AutoQualityLevel, QualityLevel } from '../contracts';

/**
 * Levels Auto may pick, ordered low -> high (stepDown / minLevel / the probe all index into this list). W-107 Ultra
 * extension point: append 'ultra' here and to AutoQualityLevel (render/contracts.ts), then give the strong-GPU rule(s)
 * below tier 'ultra'. Nothing else in the governor hard-codes the top level.
 */
export const AUTO_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly AutoQualityLevel[];
export type AutoLevel = (typeof AUTO_LEVELS)[number];
// compile-time: AUTO_LEVELS lists every AutoQualityLevel (adding one to the contract without the list fails tsc)
const AUTO_LEVELS_COMPLETE: AutoQualityLevel extends AutoLevel ? true : never = true;
void AUTO_LEVELS_COMPLETE;
export type GpuKind = 'software' | 'mobile' | 'integrated' | 'apple' | 'discrete' | 'unknown';

export interface GpuClass {
  tier: AutoLevel;
  kind: GpuKind;
  /** The string that was classified (renderer, else vendor), trimmed; '' when unavailable. */
  gpu: string;
  /** Which rule matched (diagnostics / tests). */
  rule: string;
}

/** 30 fps frame budget. */
export const FRAME_BUDGET_MS = 1000 / 30;
/** p95 beyond this at the probe level drops two levels instead of one (Medium on Sol's iGPU: 54.5 ms -> Low). */
export const PROBE_TWO_STEP_MS = 50;
export const PROBE_WARMUP_MS = 600;
export const PROBE_MS = 3000;
export const WATCH_WARMUP_MS = 2000;
export const WATCH_WINDOW_MS = 10_000;
/**
 * Intervals longer than this are pauses (debugger, modal OS dialog, a sleeping laptop), not frames: dropped and the
 * window restarts. Generous on purpose: a software rasteriser draws the game at ~1-2 fps (SwiftShader measured at
 * 2 fps in headless Chromium), and those slow frames are exactly what the probe must see. Hidden tabs do not render,
 * and the controller turns sampling off behind loading screens, so neither reaches here.
 */
export const MAX_SAMPLE_MS = 5000;
/** A window needs at least this many frames to be judged (a p95 of a handful of frames is noise). */
export const MIN_WINDOW_FRAMES = 20;

export function isAutoLevel(v: unknown): v is AutoLevel {
  return typeof v === 'string' && (AUTO_LEVELS as readonly string[]).includes(v);
}

export function stepDown(level: AutoLevel, steps = 1): AutoLevel {
  const n = Number.isFinite(steps) ? Math.max(0, Math.floor(steps)) : 0;
  const i = Math.max(0, AUTO_LEVELS.indexOf(level) - n);
  return AUTO_LEVELS[i];
}

export function minLevel(a: AutoLevel, b: AutoLevel): AutoLevel {
  return AUTO_LEVELS.indexOf(a) <= AUTO_LEVELS.indexOf(b) ? a : b;
}

const RULES: readonly { re: RegExp; tier: AutoLevel; kind: GpuKind; rule: string }[] = [
  // software rasterisers first: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)...), SwiftShader driver)"
  { re: /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|\bwarp\b|software ?(renderer|rasterizer)|mesa offscreen|google .*subzero/, tier: 'low', kind: 'software', rule: 'software' },
  // mobile / SoC GPUs
  { re: /\bmali\b|mali-|adreno|powervr|videocore|\btegra\b|apple a\d{1,2}\b|immortalis|xclipse/, tier: 'low', kind: 'mobile', rule: 'mobile' },
  // Apple silicon: base M-chips are mid-range (TEAM_PLAN §8 "GTX 1660 / M1"), Pro / Max / Ultra are high
  { re: /apple m\d+ ?(pro|max|ultra)\b/, tier: 'high', kind: 'apple', rule: 'apple-m-pro' },
  { re: /apple m\d+\b/, tier: 'medium', kind: 'apple', rule: 'apple-m' },
  { re: /apple (gpu|paravirtual)/, tier: 'medium', kind: 'apple', rule: 'apple-masked' },
  // Intel: Arc A-/B-series discrete cards vs. everything else (UHD / Iris / HD / integrated "Arc(TM) Graphics")
  { re: /intel.*\barc(\(tm\))? ?[ab]\d{3}/, tier: 'high', kind: 'discrete', rule: 'intel-arc-discrete' },
  { re: /intel|\biris\b|\buhd graphics\b|\bhd graphics\b/, tier: 'low', kind: 'integrated', rule: 'intel-integrated' },
  // AMD integrated: "AMD Radeon(TM) Graphics", "Radeon Vega 8 Graphics", "Radeon 780M", "Radeon 680M"...
  { re: /radeon(\(tm\))? graphics|radeon(\(tm\))? vega( \d+)? graphics|\bvega \d+\b(?! ?(56|64))|radeon(\(tm\))? \d{3}m\b|radeon r\d graphics/, tier: 'low', kind: 'integrated', rule: 'amd-integrated' },
  // AMD discrete
  { re: /radeon(\(tm\))? (rx|pro w)\s?\d{3,4}|radeon rx|\brx ?\d{3,4}\b|radeon vii|vega ?(56|64)/, tier: 'high', kind: 'discrete', rule: 'amd-discrete' },
  { re: /radeon|\bamd\b|\bati\b/, tier: 'medium', kind: 'discrete', rule: 'amd-other' },
  // NVIDIA: entry parts (GT / MX / old GTX) vs. GTX 16xx / RTX
  { re: /geforce (gt|mx) ?\d{3}|\bmx ?\d{3}\b|\b\d{3}mx\b|geforce \d{3}m?\b|\bgt \d{3,4}\b/, tier: 'low', kind: 'discrete', rule: 'nvidia-entry' },
  { re: /gtx ?(9\d{2}|10[5-8]0)/, tier: 'medium', kind: 'discrete', rule: 'nvidia-gtx-old' },
  { re: /rtx|gtx ?16\d{2}|titan|quadro rtx|nvidia (a|l)\d{2,4}/, tier: 'high', kind: 'discrete', rule: 'nvidia-modern' },
  { re: /nvidia|geforce|quadro/, tier: 'medium', kind: 'discrete', rule: 'nvidia-other' },
];

/**
 * Classify a GPU from WEBGL_debug_renderer_info (UNMASKED_RENDERER_WEBGL, UNMASKED_VENDOR_WEBGL) or the masked
 * RENDERER / VENDOR strings. Total: any input (null, numbers, huge strings) yields a class.
 */
export function classifyGpu(renderer: unknown, vendor?: unknown): GpuClass {
  const r = typeof renderer === 'string' ? renderer.slice(0, 512).trim() : '';
  const v = typeof vendor === 'string' ? vendor.slice(0, 256).trim() : '';
  const s = `${r} ${v}`.toLowerCase();
  const gpu = r || v;
  if (!s.trim()) return { tier: 'medium', kind: 'unknown', gpu, rule: 'empty' };
  for (const rule of RULES) {
    if (rule.re.test(s)) return { tier: rule.tier, kind: rule.kind, gpu, rule: rule.rule };
  }
  return { tier: 'medium', kind: 'unknown', gpu, rule: 'unknown' };
}

/** 95th percentile (nearest-rank) of finite positive samples; NaN when there are none. */
export function p95(samples: ArrayLike<number>): number {
  const xs: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    if (Number.isFinite(x) && x > 0) xs.push(x);
  }
  if (!xs.length) return NaN;
  xs.sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)];
}

/** Probe result: the level to run given the ceiling it was measured at and the probe's p95 frame time. */
export function probeDecision(ceiling: AutoLevel, p95Ms: number): AutoLevel {
  if (!isAutoLevel(ceiling)) ceiling = 'medium';
  if (!Number.isFinite(p95Ms) || p95Ms <= 0) return ceiling; // nothing measured: keep the tier's choice
  if (p95Ms <= FRAME_BUDGET_MS) return ceiling;
  return stepDown(ceiling, p95Ms > PROBE_TWO_STEP_MS ? 2 : 1);
}

export type AutoPhase = 'probe' | 'watch';

export interface AutoQualityState {
  level: AutoLevel;
  phase: AutoPhase;
  /** GPU ceiling. */
  ceiling: AutoLevel;
  /** p95 (ms) of the last judged probe / window; NaN before the first. */
  lastP95: number;
  /** Runtime downgrades so far this session. */
  downgrades: number;
}

/**
 * Probe + runtime governor. Feed it every rendered frame's interval with `sample(ms)`; it returns the new level when
 * the level must change (else null). Pure and deterministic: time is the sum of accepted intervals.
 */
export class AutoQualityGovernor {
  private level: AutoLevel;
  private phase: AutoPhase;
  private readonly ceiling: AutoLevel;
  private warm: number;
  private elapsed = 0;
  private buf: number[] = [];
  private lastP95 = NaN;
  private downgrades = 0;

  /**
   * @param ceiling GPU tier (classifyGpu().tier).
   * @param stored  Level a previous session settled on (skips the probe); clamped to the ceiling.
   */
  constructor(ceiling: AutoLevel, stored: AutoLevel | null = null) {
    this.ceiling = isAutoLevel(ceiling) ? ceiling : 'medium';
    if (isAutoLevel(stored)) {
      this.level = minLevel(stored, this.ceiling);
      this.phase = 'watch';
      this.warm = WATCH_WARMUP_MS;
    } else {
      this.level = this.ceiling;
      this.phase = 'probe';
      this.warm = PROBE_WARMUP_MS;
    }
  }

  state(): AutoQualityState {
    return { level: this.level, phase: this.phase, ceiling: this.ceiling, lastP95: this.lastP95, downgrades: this.downgrades };
  }

  get current(): AutoLevel {
    return this.level;
  }

  /** Forget the partial window (e.g. sampling paused behind a loading screen): the next frames warm up again. */
  interrupt(): void {
    this.buf = [];
    this.elapsed = 0;
    this.warm = Math.max(this.warm, this.phase === 'probe' ? PROBE_WARMUP_MS : WATCH_WARMUP_MS);
  }

  sample(frameMs: number): AutoLevel | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return null;
    if (frameMs > MAX_SAMPLE_MS) {
      this.interrupt();
      return null;
    }
    if (this.warm > 0) {
      this.warm -= frameMs;
      return null;
    }
    this.buf.push(frameMs);
    this.elapsed += frameMs;
    const span = this.phase === 'probe' ? PROBE_MS : WATCH_WINDOW_MS;
    if (this.elapsed < span) return null;
    const p = this.buf.length >= MIN_WINDOW_FRAMES ? p95(this.buf) : Math.max(...this.buf);
    this.lastP95 = p;
    this.buf = [];
    this.elapsed = 0;
    if (this.phase === 'probe') {
      const next = probeDecision(this.ceiling, p);
      this.phase = 'watch';
      this.warm = WATCH_WARMUP_MS;
      if (next === this.level) return null;
      this.level = next;
      return next;
    }
    if (p > FRAME_BUDGET_MS && this.level !== 'low') {
      this.level = stepDown(this.level);
      this.downgrades++;
      this.warm = WATCH_WARMUP_MS; // new shaders / shadow maps compile at the new level: never judge those frames
      return this.level;
    }
    return null;
  }
}

/** Render level for a quality setting: an explicit level as-is, 'auto' -> the governor's level. */
export function resolveQuality(setting: unknown, auto: AutoLevel | null): QualityLevel {
  if (setting === 'low' || setting === 'medium' || setting === 'high' || setting === 'ultra') return setting;
  return isAutoLevel(auto) ? auto : 'medium';
}
