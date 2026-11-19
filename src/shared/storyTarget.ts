/**
 * Story-step targets (W-116, D-065, owner playtest #1): which world object the CURRENT Act 1 step is about — the crooked
 * mailbox for "Check the crooked mailbox", the busted coffin for "Sleep in the coffin", … — so the renderer can float a
 * marker over it, the quest panel can offer "Show me", and the camera can frame it clear of the HUD.
 *
 * PURE and read-only: (world state, object tags) → target. It never touches the sim. Steps whose action is buying or
 * building something (fridge, shower, walls, furniture, decor), the room score and the friendly chats have no single
 * object to point at and return null.
 */
import type { WorldState } from '../sim/types';
import { ACT1_QUESTS } from '../sim/content/quests/act1';

/** `<questId>#<stepId>` → object tags the step's target carries (first tag that matches any placed object wins). */
export const STORY_STEP_TARGETS: Readonly<Record<string, readonly string[]>> = {
  'act1_claim#mail': ['mailbox'],
  'act1_rest#sleep': ['coffin'],
  // a hot meal: the microwave or the stove (the fridge cooks too, at the stove)
  'act1_hunger#eat': ['microwave', 'stove', 'fridge'],
  'act1_scrub#wash': ['shower'],
  // the preservative spray lives in the fridge (home_grabSpray)
  'act1_scrub#preserve': ['fridge'],
  // bills are paid at the mailbox
  'act1_lease#bill': ['mailbox'],
};

export interface StoryTarget {
  questId: string;
  stepId: string;
  /** The world object to point at. */
  objectId: string;
  defId: string;
}

const STEP_IDS = new Map(ACT1_QUESTS.map((q) => [q.id, q.steps.map((s) => s.id)]));

/** `<questId>#<stepId>` of the running Act 1 step (null when no Act 1 quest runs or its step is already done). */
export function activeStoryStep(state: WorldState | null | undefined): { questId: string; stepId: string } | null {
  try {
    if (!state || !state.flags || state.flags.storyArc !== 'act1') return null;
    const active = state.quests && Array.isArray(state.quests.active) ? state.quests.active : [];
    for (const inst of active) {
      const steps = inst && STEP_IDS.get(inst.questId);
      if (!steps) continue;
      const stepId = steps[inst.stepIndex];
      if (typeof stepId !== 'string' || (inst.step && inst.step.done === true)) continue;
      return { questId: inst.questId, stepId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The object the running Act 1 step points at, or null. `tagsOf(defId)` reads the object's content tags (the sim's
 * content registry). Among several matching objects the lowest id (the oldest) wins — deterministic.
 */
export function storyTargetOf(state: WorldState | null | undefined, tagsOf: (defId: string) => readonly string[] | null | undefined): StoryTarget | null {
  const step = activeStoryStep(state);
  if (!step || !state) return null;
  const want = STORY_STEP_TARGETS[`${step.questId}#${step.stepId}`];
  if (!want) return null;
  try {
    const objs = state.objects && typeof state.objects === 'object' ? Object.values(state.objects) : [];
    const num = (id: string) => {
      const m = /^o(\d+)$/.exec(id);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    for (const tag of want) {
      let best: { id: string; defId: string } | null = null;
      for (const o of objs) {
        if (!o || typeof o.id !== 'string' || !o.placement || o.placement.kind === 'held' || o.placement.kind === 'loose') continue;
        const tags = tagsOf(o.defId);
        if (!Array.isArray(tags) || !tags.includes(tag)) continue;
        if (!best || num(o.id) < num(best.id)) best = { id: o.id, defId: o.defId };
      }
      if (best) return { questId: step.questId, stepId: step.stepId, objectId: best.id, defId: best.defId };
    }
  } catch {
    return null;
  }
  return null;
}
