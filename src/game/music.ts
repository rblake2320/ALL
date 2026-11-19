/**
 * Music direction: which mood should play right now, given the screen, mode and world state.
 *
 * Priority in game: buy/build → 'build'; active party → 'party'; tension (overdue bills or a fire) → 'tense';
 * a recent sim mood event (sad/romance/tense/party, expires) → that; night → 'night'; otherwise 'live'.
 * The director only calls audio.music() when the chosen mood actually changes (idempotent).
 */
import type { MusicMood } from '../shared/audioIds';
import type { Screen } from './contracts';
import type { ViewMode } from '../render/contracts';

export type MusicEventMood = 'normal' | 'tense' | 'party' | 'sad' | 'romance';
export type MusicChoice = MusicMood | 'none';

export interface MusicContext {
  screen: Screen;
  mode: ViewMode;
  fatal: boolean;
  isNight: boolean;
  partyActive: boolean;
  tense: boolean;
  override: Exclude<MusicEventMood, 'normal'> | null;
}

/** How long a sim music event colours the soundtrack (real ms). */
export const MUSIC_OVERRIDE_MS = 90_000;

export function chooseMusic(c: MusicContext): MusicChoice {
  if (c.fatal) return 'none';
  switch (c.screen) {
    case 'boot':
      return 'none';
    case 'loading':
    case 'menu':
      return 'menu';
    case 'newGame':
    case 'caz':
      return 'caz';
    case 'gameOver':
      return 'sad';
    case 'game':
      break;
  }
  if (c.mode === 'buy' || c.mode === 'build') return 'build';
  if (c.partyActive) return 'party';
  if (c.tense) return 'tense';
  if (c.override) return c.override;
  return c.isNight ? 'night' : 'live';
}

export class MusicDirector {
  private current: MusicChoice | null = null;
  private override: { mood: Exclude<MusicEventMood, 'normal'>; until: number } | null = null;

  get playing(): MusicChoice | null {
    return this.current;
  }

  onEvent(mood: unknown, now: number): void {
    if (mood === 'normal') this.override = null;
    else if (mood === 'tense' || mood === 'party' || mood === 'sad' || mood === 'romance') this.override = { mood, until: now + MUSIC_OVERRIDE_MS };
  }

  /** Returns the mood that was started, or null if nothing changed. */
  update(ctx: Omit<MusicContext, 'override'>, now: number, play: (m: MusicChoice) => void): MusicChoice | null {
    if (this.override && this.override.until <= now) this.override = null;
    const next = chooseMusic({ ...ctx, override: this.override?.mood ?? null });
    if (next === this.current) return null;
    this.current = next;
    play(next);
    return next;
  }

  reset(): void {
    this.override = null;
  }

  /** Forget what is playing (e.g. after audio was re-created) so the next update re-issues it. */
  invalidate(): void {
    this.current = null;
  }
}
