/**
 * Fixed-timestep simulation loop.
 *
 *   accumulator += realDt × SPEED_MINUTES_PER_SECOND[speed] / TICK_MINUTES      (units: ticks)
 *
 * Up to MAX_TICKS_PER_FRAME whole ticks run per frame; any excess is DROPPED (never carried), so a long stall can
 * never snowball into a spiral of ever-longer frames. The fractional remainder is the interpolation alpha ∈ [0, 1)
 * handed to renderer.frame(). A per-frame CPU budget adds a second guard on slow machines.
 *
 * `FrameDriver` runs the callback on requestAnimationFrame and keeps the game alive with a slow timer when frames
 * stop arriving (hidden tab, minimised window) so "pause when unfocused = off" still simulates in the background.
 */
import { SPEED_MINUTES_PER_SECOND, TICK_MINUTES, type Speed } from '../sim/types';
import type { GameEnv, TimerHandle } from './env';
import { isSpeed } from './speed';

export const MAX_TICKS_PER_FRAME = 400;
/** Real seconds of a single frame we are willing to account for (larger gaps are treated as this long). */
export const MAX_FRAME_SECONDS = 1;
/** CPU time per frame spent stepping before we give up and drop the rest of this frame's ticks. */
export const TICK_BUDGET_MS = 28;

export function ticksPerSecond(speed: Speed): number {
  if (!isSpeed(speed)) return 0;
  return SPEED_MINUTES_PER_SECOND[speed] / TICK_MINUTES;
}

/** Game minutes that pass per real second at a speed (0 when paused). */
export function minutesPerSecond(speed: Speed): number {
  return isSpeed(speed) ? SPEED_MINUTES_PER_SECOND[speed] : 0;
}

export interface AdvanceResult {
  /** Whole ticks to run this frame (≤ maxTicks). */
  ticks: number;
  /** Whole ticks discarded because of the cap. */
  dropped: number;
  /** New accumulator (fractional ticks, [0,1)). */
  accumulator: number;
  /** Interpolation factor for the renderer, [0,1). */
  alpha: number;
}

export function sanitizeDt(realDtSec: number): number {
  if (!Number.isFinite(realDtSec) || realDtSec <= 0) return 0;
  return Math.min(realDtSec, MAX_FRAME_SECONDS);
}

export function advanceAccumulator(accumulator: number, realDtSec: number, speed: Speed, maxTicks: number = MAX_TICKS_PER_FRAME): AdvanceResult {
  let acc = Number.isFinite(accumulator) && accumulator > 0 ? accumulator : 0;
  const dt = sanitizeDt(realDtSec);
  acc += dt * ticksPerSecond(speed);
  const whole = Math.floor(acc);
  const cap = Number.isFinite(maxTicks) && maxTicks > 0 ? Math.floor(maxTicks) : 0;
  const ticks = Math.min(whole, cap);
  const dropped = whole - ticks;
  acc -= whole;
  if (!(acc >= 0 && acc < 1)) acc = 0; // float noise / NaN guard
  return { ticks, dropped, accumulator: acc, alpha: acc };
}

export interface TickRunResult {
  ran: number;
  /** Stopped early because the CPU budget ran out. */
  overBudget: boolean;
  /** Errors thrown by step() (the contract says it never throws; this is the fault barrier if it does). */
  errors: unknown[];
}

/**
 * Run up to `count` ticks, stopping when `budgetMs` of CPU time is spent. The first tick always runs so the
 * game never freezes outright on a slow machine.
 */
export function runTicks(step: () => void, count: number, budgetMs: number, now: () => number): TickRunResult {
  const errors: unknown[] = [];
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n === 0) return { ran: 0, overBudget: false, errors };
  const t0 = now();
  let ran = 0;
  let overBudget = false;
  for (let i = 0; i < n; i++) {
    try {
      step();
    } catch (e) {
      if (errors.length < 3) errors.push(e);
    }
    ran++;
    if (ran < n && (ran & 3) === 0 && now() - t0 > budgetMs) {
      overBudget = true;
      break;
    }
    if (errors.length >= 3) break; // a consistently throwing step is not worth repeating 400×
  }
  return { ran, overBudget, errors };
}

export type FrameCallback = (dtSec: number, nowMs: number, info: { background: boolean }) => void;

export interface FrameDriverOptions {
  /** How often the background timer checks for stalled frames. */
  fallbackIntervalMs?: number;
  /** Frames are considered stalled after this long without a rAF callback. */
  stallMs?: number;
  onError?(err: unknown): void;
}

export class FrameDriver {
  private rafId: number | null = null;
  private timer: TimerHandle | null = null;
  private last = 0;
  private lastFrameAt = 0;
  private active = false;
  private inCallback = false;
  private readonly fallbackIntervalMs: number;
  private readonly stallMs: number;

  constructor(
    private readonly env: GameEnv,
    private readonly cb: FrameCallback,
    private readonly opts: FrameDriverOptions = {},
  ) {
    this.fallbackIntervalMs = opts.fallbackIntervalMs ?? 500;
    this.stallMs = opts.stallMs ?? 1000;
  }

  get running(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.last = this.env.now();
    this.lastFrameAt = this.last;
    this.schedule();
    this.timer = this.env.setInterval(() => this.onTimer(), this.fallbackIntervalMs);
  }

  stop(): void {
    this.active = false;
    if (this.rafId !== null) this.env.cancelFrame(this.rafId);
    this.rafId = null;
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.active) return;
    const id = this.env.requestFrame(() => {
      this.rafId = null;
      this.tick(false);
      this.schedule();
    });
    this.rafId = id;
  }

  private onTimer(): void {
    if (!this.active) return;
    const now = this.env.now();
    if (now - this.lastFrameAt >= this.stallMs) this.tick(true);
    // Recover a lost rAF chain (e.g. requestFrame returned null earlier).
    if (this.rafId === null && !this.inCallback) this.schedule();
  }

  private tick(background: boolean): void {
    if (!this.active || this.inCallback) return;
    const now = this.env.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.lastFrameAt = now;
    this.inCallback = true;
    try {
      this.cb(dt, now, { background });
    } catch (e) {
      this.opts.onError?.(e);
    } finally {
      this.inCallback = false;
    }
  }
}
