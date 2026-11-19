/**
 * Act 1 — "The Condemned Shack" (W-113, docs/systems/story-start.md). The story start for NEW games on the `derelict`
 * lot: the world carries `flags.storyArc = 'act1'` from creation, and only there are these quests offered. They replace
 * the generic opening of the classic chain (`supersedes`): in an Act 1 world story_firstMeal / story_freshen /
 * story_decorate / story_bills are never offered and count as done for `requires` once their Act 1 beat is done, so
 * the rest of the classic chain (job, friends, repairs, skills, embalming, party) follows the arc unchanged.
 * Worlds without the flag (old saves, the starter and empty lots) run the classic chain exactly as before (D-019).
 *
 * A strict line (each beat requires the previous one): claim → rest → hunger → scrub → patch → curb → neighbour →
 * lease. Rewards are Bones only (quests never move household funds — src/sim/systems/quests/README.md); every one is
 * one-off (no `repeat`), so the profile ledger pays it once per profile (src/economy/grantPolicy.ts).
 * Completing `act1_lease` is the hook for Renovation level 2 (docs/systems/housing-progression.md, W-042).
 *
 * Text lives in src/i18n/en.ts (`story.act1.*`) — one source for the sim defs and the UI.
 */
import type { BubbleIcon, ObjectiveDef, QuestDef } from '../../contracts';
import { en } from '../../../i18n/en';

export const ACT1_ARC = 'act1';

type Act1Key = 'claim' | 'rest' | 'hunger' | 'scrub' | 'patch' | 'curb' | 'neighbour' | 'lease';

const str = (k: string): string => {
  const v = (en as Record<string, string>)[k];
  if (typeof v !== 'string') throw new Error(`act1: missing string ${k}`);
  return v;
};

interface BeatSpec {
  key: Act1Key;
  icon: BubbleIcon;
  bones: number;
  steps: { id: string; objective: ObjectiveDef }[];
  supersedes?: string[];
}

/** Furniture the "patch" beat accepts (any one tag): something to sit on, a surface, a light, a decoration or a bed. */
export const FURNITURE_TAGS = ['seat', 'surface', 'table', 'light', 'decor', 'bed'];

const BEATS: BeatSpec[] = [
  { key: 'claim', icon: 'mail', bones: 20, steps: [{ id: 'mail', objective: { kind: 'interaction', ids: ['home_checkMail'], count: 1 } }] },
  { key: 'rest', icon: 'coffin', bones: 20, steps: [{ id: 'sleep', objective: { kind: 'interaction', tags: ['sleep'], targetTags: ['coffin'], count: 1 } }] },
  {
    key: 'hunger',
    icon: 'plate',
    bones: 40,
    supersedes: ['story_firstMeal'],
    steps: [
      { id: 'fridge', objective: { kind: 'own', tags: ['fridge'], count: 1, fresh: false, holdMin: 15 } },
      { id: 'cooker', objective: { kind: 'own', tags: ['stove', 'microwave'], count: 1, fresh: false, holdMin: 15 } },
      // A hot meal: a served dish (cooked at the stove) or a microwaved burrito — not cold jerky from the fridge.
      { id: 'eat', objective: { kind: 'interaction', tags: ['eat'], targetTags: ['meal', 'microwave'], count: 1 } },
    ],
  },
  {
    key: 'scrub',
    icon: 'soap',
    bones: 40,
    supersedes: ['story_freshen'],
    steps: [
      { id: 'shower', objective: { kind: 'own', tags: ['shower'], count: 1, fresh: false, holdMin: 15 } },
      { id: 'wash', objective: { kind: 'interaction', ids: ['home_shower'], count: 1 } },
      { id: 'preserve', objective: { kind: 'interaction', tags: ['preserve'], count: 1 } },
    ],
  },
  {
    key: 'patch',
    icon: 'wrench',
    bones: 50,
    steps: [
      { id: 'walls', objective: { kind: 'walls', count: 4, holdMin: 15 } },
      { id: 'furnish', objective: { kind: 'own', tags: FURNITURE_TAGS, count: 3, fresh: true, holdMin: 15 } },
    ],
  },
  {
    key: 'curb',
    icon: 'house',
    bones: 50,
    supersedes: ['story_decorate'],
    steps: [
      { id: 'decor', objective: { kind: 'own', tags: ['decor'], count: 1, fresh: true, holdMin: 15 } },
      { id: 'room', objective: { kind: 'roomEnv', atLeast: 4, holdMin: 60 } },
    ],
  },
  { key: 'neighbour', icon: 'chat', bones: 40, steps: [{ id: 'friendly', objective: { kind: 'interaction', tags: ['friendly'], count: 2 } }] },
  { key: 'lease', icon: 'money', bones: 80, supersedes: ['story_bills'], steps: [{ id: 'bill', objective: { kind: 'billsOnTime', count: 1 } }] },
];

export const ACT1_QUEST_IDS: readonly string[] = BEATS.map((b) => `act1_${b.key}`);
/** The last beat: completing it unlocks the Renovation level 2 hook (housing progression, W-042). */
export const ACT1_FINALE_ID = 'act1_lease';

export const ACT1_QUESTS: QuestDef[] = BEATS.map((b, i) => {
  const def: QuestDef = {
    id: `act1_${b.key}`,
    // Ahead of every classic quest (orders 1..10), so an Act 1 beat always gets a story slot first.
    order: (i + 1) / 10,
    category: 'story',
    arc: ACT1_ARC,
    title: str(`story.act1.${b.key}.title`),
    description: str(`story.act1.${b.key}.beat`),
    icon: b.icon,
    steps: b.steps.map((s) => ({ id: s.id, label: str(`story.act1.${b.key}.step.${s.id}`), objective: s.objective })),
    reward: { bones: b.bones },
  };
  if (i > 0) def.requires = [`act1_${BEATS[i - 1].key}`];
  if (b.supersedes) def.supersedes = b.supersedes.slice();
  return def;
});
