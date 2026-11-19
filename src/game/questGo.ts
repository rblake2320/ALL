/**
 * W-123 (D-070): the controller side of "Go do it" on quest / daily-task / weekly-challenge rows. Looks the row's
 * current step up (sim quest state, profile daily state), resolves it with the pure resolver
 * (src/shared/questAction.ts) and carries the result out with the ordinary controller commands — a `queue` command
 * through GameSession.dispatch (journaled like a menu click), or a mode / tool / dialog switch. No new sim state.
 *
 *   selection   the selected household member when they are home; otherwise the best available one, who becomes
 *               selected;
 *   feedback    a toast ("Gravelyn is heading to the Morbid Easel"); the UI frames the camera on the target clear of
 *               the HUD (storyFraming.frameObjectClear), callers without a DOM get a plain centring;
 *   repeat      the same action already queued or running is never queued twice (double click);
 *   log         the W-117 session log records `quest.go` with `<step key>:<kind>` (closed vocabulary, no names).
 */
import type { SimulationAPI } from '../sim/contracts';
import type { ObjectiveDef } from '../sim/contracts';
import type { Core } from './core';
import { ALL_QUESTS, DAILY_TASK_POOL } from '../sim/content/quests';
import { WEEKLY_POOL } from '../economy/daily';
import { DEFAULT_INTERIOR_WALL } from '../shared/styles';
import { resolveQuestAction, type QuestAction, type QuestStepInput } from '../shared/questAction';

export type QuestRowSource = 'quest' | 'daily' | 'weekly';

/** Which row was clicked: a quest (its current step, or `stepId`), a daily task or the weekly challenge. */
export interface QuestRowRef {
  source: QuestRowSource;
  id: string;
  stepId?: string | null;
}

export type QuestGoResult = QuestAction & {
  /** `<questId>.<stepId>` | `daily.<taskId>` | `weekly.<challengeId>` (session-log key; ids only). */
  key: string;
  /** queue: the command went through (false when it was already queued, or the sim refused it). */
  queued?: boolean;
};

const QUEST_DEFS = new Map(ALL_QUESTS.map((q) => [q.id, q]));
const DAILY_DEFS = new Map(DAILY_TASK_POOL.map((d) => [d.id, d]));
const WEEKLY_DEFS = new Map(WEEKLY_POOL.map((d) => [d.id, d]));

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,48}$/;

/** The step a row stands for, or null for an unknown / malformed row. */
export function questStepOf(sim: SimulationAPI | null, econ: Core['economy'], ref: QuestRowRef | null | undefined): { key: string; step: QuestStepInput } | null {
  if (!ref || typeof ref !== 'object' || typeof ref.id !== 'string' || !SAFE_ID.test(ref.id)) return null;
  try {
    if (ref.source === 'quest') {
      const def = QUEST_DEFS.get(ref.id);
      if (!def) return null;
      const q = sim?.state?.quests;
      const inst = q && Array.isArray(q.active) ? q.active.find((a) => a && a.questId === ref.id) : undefined;
      let index = inst && Number.isInteger(inst.stepIndex) ? inst.stepIndex : 0;
      if (typeof ref.stepId === 'string') {
        const i = def.steps.findIndex((s) => s.id === ref.stepId);
        if (i < 0) return null;
        index = i;
      }
      const s = def.steps[index];
      if (!s) return null;
      const doneBefore = !!inst && index < inst.stepIndex;
      const doneNow = !!inst && index === inst.stepIndex && !!inst.step && inst.step.done === true;
      const doneQuest = !inst && !!q && !!q.completions && (q.completions[ref.id] ?? 0) > 0;
      return { key: `${def.id}.${s.id}`, step: { objective: s.objective as ObjectiveDef, done: doneBefore || doneNow || doneQuest } };
    }
    if (ref.source === 'daily') {
      const d = DAILY_DEFS.get(ref.id);
      if (!d) return null;
      const v = econ?.daily?.tasks?.find((t) => t.id === ref.id);
      return { key: `daily.${d.id}`, step: { objective: d.objective, done: !!v && v.done === true } };
    }
    if (ref.source === 'weekly') {
      const d = WEEKLY_DEFS.get(ref.id);
      if (!d) return null;
      const v = econ?.daily?.weekly;
      return { key: `weekly.${d.id}`, step: { objective: d.objective, done: !!v && v.id === ref.id && v.done === true } };
    }
  } catch {
    return null;
  }
  return null;
}

/** The agent to plan for: the selected member when at home, else null (the resolver picks the best one). */
function plannedAgent(c: Core, sim: SimulationAPI): string | null {
  const id = c.play.selectedAgentId;
  const a = id ? sim.state.agents?.[id] : undefined;
  return a && a.presence === 'onLot' ? id : null;
}

const preview = new WeakMap<Core, { stamp: string; byKey: Map<string, QuestGoResult> }>();

/** Read-only preview of what a row's Go would do (cached until the world or the selection changes). Never throws. */
export function questActionFor(c: Core, ref: QuestRowRef): QuestGoResult {
  const sim = c.inGame() ? c.session?.sim ?? null : null;
  const found = questStepOf(sim, c.economy, ref);
  if (!found) return { kind: 'blocked', reason: 'Nothing to do for this one', code: 'invalid', key: 'none' };
  if (!sim) return { kind: 'blocked', reason: 'No game in progress', code: 'invalid', key: found.key };
  const s = sim.state;
  const stamp = `${s.tick}|${s.nextId}|${c.play.selectedAgentId ?? ''}|${s.household?.funds}|${Object.keys(s.objects ?? {}).length}|${found.step.done ? 1 : 0}`;
  let cache = preview.get(c);
  if (!cache || cache.stamp !== stamp) {
    cache = { stamp, byKey: new Map() };
    preview.set(c, cache);
  }
  const hit = cache.byKey.get(`${ref.source}:${found.key}`);
  if (hit) return hit;
  const a: QuestGoResult = { ...resolveQuestAction(found.step, sim, plannedAgent(c, sim)), key: found.key };
  cache.byKey.set(`${ref.source}:${found.key}`, a);
  return a;
}

function firstNameOf(sim: SimulationAPI, id: string): string {
  const a = sim.state.agents?.[id];
  return a && typeof a.firstName === 'string' && a.firstName ? a.firstName : 'Your zombie';
}

/** Carry a row's Go out. `frame: false` = the caller frames the camera itself (the HUD frames clear of its panels). */
export function questGo(c: Core, ref: QuestRowRef, opts: { frame?: boolean } = {}): QuestGoResult {
  const sim = c.inGame() ? c.session?.sim ?? null : null;
  const session = c.session;
  const found = questStepOf(sim, c.economy, ref);
  const key = found ? found.key : 'none';
  let out: QuestGoResult;
  if (!found) out = { kind: 'blocked', reason: 'Nothing to do for this one', code: 'invalid', key };
  else if (!sim || !session) out = { kind: 'blocked', reason: 'No game in progress', code: 'invalid', key };
  else out = { ...resolveQuestAction(found.step, sim, plannedAgent(c, sim)), key };
  if (sim && session) {
    try {
      out = carryOut(c, sim, out, opts.frame !== false);
    } catch (e) {
      c.report('questGo', e);
      out = { kind: 'blocked', reason: 'Something went wrong', code: 'invalid', key };
    }
  }
  if (c.sessionLog) c.guard('sessionLog.questGo', () => c.sessionLog!.questGo(key, out.kind));
  preview.delete(c);
  c.changed(true);
  return out;
}

function carryOut(c: Core, sim: SimulationAPI, a: QuestGoResult, frame: boolean): QuestGoResult {
  const session = c.session!;
  switch (a.kind) {
    case 'queue': {
      if (c.play.mode !== 'live') c.play.setMode('live');
      if (c.play.selectedAgentId !== a.agentId) c.play.selectAgent(a.agentId, false, true);
      const name = firstNameOf(sim, a.agentId);
      let queued = false;
      if (!a.already) {
        const r = session.dispatch({ type: 'queue', actorId: a.agentId, interactionId: a.interactionId, target: a.target, params: { ...a.extra } });
        if (!r.ok) {
          c.toast('warning', a.label, r.reason ?? "Couldn't do that right now.", { agentId: a.agentId, mergeKey: `questGo:${a.key}` });
          c.sfx('uiError');
          return { kind: 'blocked', reason: r.reason ?? "Couldn't do that right now.", code: 'agent', key: a.key };
        }
        queued = true;
        session.facts.queuedAction = true;
      }
      const where = a.target.kind === 'self' ? `${name} is getting on the phone` : a.target.kind === 'agent' ? `${name} is heading over to ${a.targetName ?? 'them'}` : `${name} is heading to the ${a.targetName ?? 'spot'}`;
      const title = a.already ? `${name} is already on it` : where;
      const text = a.wait === 'asleep' ? `${a.label} — right after waking up.` : a.wait === 'busy' ? `${a.label} — after what they're doing now.` : a.label;
      c.toast('info', title, text, { agentId: a.agentId, mergeKey: `questGo:${a.key}` });
      c.sfx('uiClick');
      if (frame) {
        if (a.objectId) c.play.frameObject(a.objectId);
        else c.guard('renderer.focus', () => c.renderer.focus(a.target.kind === 'agent' ? (a.target as { id: string }).id : a.agentId));
      } else if (!a.objectId) {
        c.guard('renderer.focus', () => c.renderer.focus(a.target.kind === 'agent' ? (a.target as { id: string }).id : a.agentId));
      }
      return { ...a, queued };
    }
    case 'mode': {
      c.play.closeMenu();
      if (a.mode === 'build') {
        c.trail.push('mode', 'build');
        c.play.setMode('build');
        c.input.build.setTool({ kind: 'wall', style: DEFAULT_INTERIOR_WALL });
      } else if (a.mode === 'buy') {
        c.trail.push('mode', 'buy');
        c.play.setMode('buy');
        c.input.buy.setCategory(a.category);
      } else {
        c.play.openDialog('careers');
      }
      c.toast('info', a.mode === 'build' ? 'Build mode: walls' : a.mode === 'buy' ? 'Buy mode' : 'Find a job', a.hint, { mergeKey: `questGo:${a.key}` });
      c.sfx('uiClick');
      return a;
    }
    case 'missing': {
      c.play.closeMenu();
      c.trail.push('mode', 'buy');
      c.play.setMode('buy');
      c.input.buy.setCategory(a.buyFilter.category);
      const need = a.need.charAt(0).toUpperCase() + a.need.slice(1);
      c.toast('info', `Needs ${a.need}`, `${need} is in the Buy catalog.`, { mergeKey: `questGo:${a.key}` });
      c.sfx('uiClick');
      return a;
    }
    case 'blocked':
      c.toast('warning', a.code === 'done' ? 'Already done' : "Can't do that yet", a.reason, { mergeKey: `questGo:${a.key}` });
      c.sfx('uiError');
      return a;
  }
}
