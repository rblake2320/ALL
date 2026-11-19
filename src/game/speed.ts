/**
 * Game speed rules.
 *
 * The player's chosen speed (`chosen`) is separate from automatic pause "holds" (a pending choice popup, a system
 * dialog, the tab being hidden, entering buy/build mode, a screen transition). The effective speed is 0 while any
 * hold is active. An explicit player speed change clears every hold (the player always wins).
 *
 * Ultra speed (4) is only allowed while every household member on the lot is asleep (or passed out); members at
 * work / off the lot never block it, crumbled / gone members are ignored. See GDD §2.
 */
import type { AgentState, Speed } from '../sim/types';

export type PauseHold = 'choice' | 'dialog' | 'hidden' | 'build' | 'transition';

export const ULTRA: Speed = 4;
export const FASTEST_NON_ULTRA: Speed = 3;

export function isSpeed(v: unknown): v is Speed {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

export interface MemberLike {
  presence: AgentState['presence'];
  anim: AgentState['anim'] | string;
  status?: { passedOut?: boolean } | null;
}

export function isAsleep(a: MemberLike): boolean {
  return a.anim === 'sleep' || a.status?.passedOut === true;
}

/** True when ultra speed is permitted for this household. */
export function ultraAllowed(members: readonly (MemberLike | null | undefined)[]): boolean {
  for (const m of members) {
    if (!m) continue;
    if (m.presence === 'onLot' && !isAsleep(m)) return false;
  }
  return true;
}

/** Applies the ultra gate to a requested speed. */
export function gateSpeed(requested: Speed, allowUltra: boolean): { speed: Speed; clamped: boolean } {
  if (requested === ULTRA && !allowUltra) return { speed: FASTEST_NON_ULTRA, clamped: true };
  return { speed: requested, clamped: false };
}

export class SpeedState {
  private base: Speed = 1;
  private lastRunning: Exclude<Speed, 0> = 1;
  private readonly holds = new Set<PauseHold>();

  /** Speed the simulation actually runs at. */
  get effective(): Speed {
    return this.holds.size > 0 ? 0 : this.base;
  }

  /** Speed the player picked (ignoring holds). */
  get chosen(): Speed {
    return this.base;
  }

  get resumeSpeed(): Exclude<Speed, 0> {
    return this.lastRunning;
  }

  hasHold(h: PauseHold): boolean {
    return this.holds.has(h);
  }

  get holdList(): PauseHold[] {
    return Array.from(this.holds);
  }

  /** Returns true if the effective speed changed. */
  addHold(h: PauseHold): boolean {
    const before = this.effective;
    this.holds.add(h);
    return before !== this.effective;
  }

  /** Returns true if the effective speed changed. */
  releaseHold(h: PauseHold): boolean {
    const before = this.effective;
    this.holds.delete(h);
    return before !== this.effective;
  }

  /** Explicit player choice: clears all holds. Invalid values are ignored. */
  set(s: Speed): void {
    if (!isSpeed(s)) return;
    this.holds.clear();
    this.base = s;
    if (s !== 0) this.lastRunning = s;
  }

  /** Pause ⇄ resume. Resuming clears holds and restores the last running speed. */
  toggle(): Speed {
    if (this.effective === 0) {
      this.holds.clear();
      if (this.base === 0) this.base = this.lastRunning;
    } else {
      this.base = 0;
    }
    return this.effective;
  }

  /** Lower the chosen speed without touching holds (used when ultra stops being allowed). */
  demote(s: Exclude<Speed, 0>): void {
    this.base = s;
    this.lastRunning = s;
  }

  reset(s: Speed = 1): void {
    this.holds.clear();
    this.base = isSpeed(s) ? s : 1;
    this.lastRunning = this.base === 0 ? 1 : this.base;
  }
}
