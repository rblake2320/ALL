/**
 * Story-start intro (W-113, docs/systems/story-start.md §5): the first time a NEW game on the derelict lot is entered,
 * a short narrative card is shown through the tutorial-hint callout (it is not a tutorial tip, so it shows even with
 * tips turned off) and the camera frames the zombie and the shack. The card never blocks input: it is a callout, Esc /
 * "Let's go" skip it, and it hides by itself after STORY_INTRO_MS. Loading a save never shows it again.
 */
import type { SimulationAPI } from '../sim/contracts';
import type { Vec2, WorldState } from '../sim/types';
import { TICKS_PER_HOUR } from '../sim/types';
import { en } from '../i18n/en';
import type { VisibleHint } from './hints';

export const STORY_INTRO_ID = 'story:intro';
/** Real milliseconds before the card hides on its own. */
export const STORY_INTRO_MS = 45_000;

export interface StoryIntroState {
  hint: VisibleHint;
  shownAt: number;
}

/** Story arc of a world (`flags.storyArc`), null for classic worlds. Never throws. */
export function storyArcOf(state: WorldState | null | undefined): string | null {
  try {
    const v = state && state.flags ? (state.flags as Record<string, unknown>).storyArc : undefined;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** The intro card for a session, or null. Only a brand-new world (not loaded) on the Act 1 arc, in its first game hour. */
export function storyIntroFor(state: WorldState | null | undefined, loadedFrom: string | null): VisibleHint | null {
  if (loadedFrom !== null || storyArcOf(state) !== 'act1') return null;
  const tick = state && typeof state.tick === 'number' && Number.isFinite(state.tick) ? state.tick : Infinity;
  if (tick >= TICKS_PER_HOUR) return null;
  return { id: STORY_INTRO_ID, title: en['story.intro.title'], text: en['story.intro.text'], anchor: null };
}

/** Camera target framing the first household zombie and the shack (midpoint), else `house`. */
export function storyFocus(sim: SimulationAPI, house: Vec2): Vec2 {
  try {
    const id = sim.state.household.memberIds[0];
    const a = id ? sim.state.agents[id] : undefined;
    if (!a || !Number.isFinite(a.pos?.x) || !Number.isFinite(a.pos?.z)) return house;
    return { x: (a.pos.x + house.x) / 2, z: (a.pos.z + house.z) / 2 };
  } catch {
    return house;
  }
}
