/**
 * W-124 jobs state: creation and SEMANTIC healing of WorldState.jobs (structure is the save validator's job,
 * src/persistence/validation/jobsSchema.ts). Garbage or tampered assignments are dropped, never trusted: unknown or
 * "coming later" categories, agents outside the household, untilDone on open-ended work, bad scopes / modes /
 * priorities, duplicate ids, over-limit lists. Runtime bookkeeping that points nowhere is reset.
 */
import type { ContentRegistry } from '../../contracts';
import type { JobAssignment, JobsState, WorldState } from '../../types';
import { NEED_IDS } from '../../types';
import { homeRegionIdOf } from '../../../shared/town';
import { AGENT_ID, JOB_ID, LOT_ID, MAX_JOB_SKIPS, MAX_JOBS, MAX_JOBS_PER_AGENT, jobCategory, jobCategoryStatuses, parseMode, parsePriority, parseScope } from '../../../shared/jobs';

export const JOB_STATUSES = ['waiting', 'working', 'break', 'blocked', 'resting', 'paused', 'away'] as const;

export function createJobsState(): JobsState {
  return { version: 1, nextId: 1, list: [] };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** Available category ids for this content (the honesty rule). */
export function availableCategories(content: Pick<ContentRegistry, 'interactions' | 'objects'>): Set<string> {
  return new Set(jobCategoryStatuses(content).filter((c) => c.available).map((c) => c.id));
}

/**
 * Heal a jobs block in place against the world (returns human-readable notes for what was dropped / reset). Pure
 * function of (state, content): the live world and a reload of it heal identically.
 */
export function healJobsState(state: WorldState, content: Pick<ContentRegistry, 'interactions' | 'objects'>): string[] {
  const notes: string[] = [];
  const raw = (state as { jobs?: unknown }).jobs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as JobsState).version !== 1 || !Array.isArray((raw as JobsState).list)) {
    if (raw !== undefined) notes.push('job assignments were unreadable and were cleared');
    state.jobs = createJobsState();
    return notes;
  }
  const js = raw as JobsState;
  const members = new Set(Array.isArray(state.household?.memberIds) ? state.household.memberIds : []);
  const ok = availableCategories(content);
  const seen = new Set<string>();
  const perAgent = new Map<string, number>();
  const w = isNum(state.lot?.width) ? state.lot.width : 4096;
  const d = isNum(state.lot?.depth) ? state.lot.depth : 4096;
  let maxId = 0;
  const kept: JobAssignment[] = [];
  for (const j of js.list) {
    const why = invalidReason(j, members, ok, seen, perAgent, w, d, homeRegionIdOf(state));
    if (why) {
      notes.push(`job ${typeof j?.id === 'string' ? j.id.slice(0, 16) : '?'} dropped: ${why}`);
      continue;
    }
    seen.add(j.id);
    perAgent.set(j.agentId, (perAgent.get(j.agentId) ?? 0) + 1);
    maxId = Math.max(maxId, Number(j.id.slice(1)));
    healRuntime(j, state);
    kept.push(j);
    if (kept.length >= MAX_JOBS) break;
  }
  if (kept.length !== js.list.length) js.list = kept;
  if (!isNum(js.nextId) || !Number.isInteger(js.nextId) || js.nextId <= maxId) js.nextId = maxId + 1;
  return notes;
}

function invalidReason(j: JobAssignment, members: Set<string>, ok: Set<string>, seen: Set<string>, perAgent: Map<string, number>, w: number, d: number, homeId: string): string | null {
  if (!j || typeof j !== 'object') return 'not an object';
  if (typeof j.id !== 'string' || !JOB_ID.test(j.id) || seen.has(j.id)) return 'bad or duplicate id';
  if (typeof j.agentId !== 'string' || !AGENT_ID.test(j.agentId) || !members.has(j.agentId)) return 'not a household member';
  if ((perAgent.get(j.agentId) ?? 0) >= MAX_JOBS_PER_AGENT) return 'too many jobs for one zombie';
  const cat = jobCategory(j.category);
  if (!cat || !ok.has(cat.id)) return 'unknown or unavailable category';
  const scope = parseScope(j.scope, w, d);
  if (!scope) return 'bad scope';
  if (cat.agentTargets && scope.kind === 'object') return 'bad scope';
  const mode = parseMode(j.mode);
  if (!mode) return 'bad mode';
  if (mode.kind === 'untilDone' && cat.openEnded) return 'open-ended work has no "until done"';
  if (parsePriority(j.priority, 'normal') === null || j.priority === undefined) return 'bad priority';
  if (typeof j.paused !== 'boolean') return 'bad paused flag';
  if (!(j.lotId === null || (typeof j.lotId === 'string' && (LOT_ID.test(j.lotId) || j.lotId === homeId)))) return 'bad lot id';
  j.scope = scope;
  j.mode = mode;
  return null;
}

/** Reset runtime bookkeeping that is out of range (never trusted from a file). */
function healRuntime(j: JobAssignment, state: WorldState): void {
  if (!(JOB_STATUSES as readonly string[]).includes(j.status)) j.status = 'waiting';
  if (j.paused) j.status = 'paused';
  else if (j.status === 'paused') j.status = 'waiting';
  j.reason = str(j.reason, 200);
  if (!isNum(j.createdTick) || j.createdTick < 0) j.createdTick = 0;
  if (!isNum(j.done) || j.done < 0 || !Number.isInteger(j.done)) j.done = 0;
  if (!isNum(j.nextCheckTick) || j.nextCheckTick < 0) j.nextCheckTick = 0;
  if (!isNum(j.restKey) || !Number.isInteger(j.restKey)) j.restKey = -1;
  if (!(j.breakNeed === null || (NEED_IDS as readonly string[]).includes(j.breakNeed as string))) j.breakNeed = null;
  j.reached = j.reached === true;
  j.skips = Array.isArray(j.skips)
    ? j.skips.filter((s) => !!s && typeof s.key === 'string' && s.key.length <= 32 && isNum(s.until) && typeof s.reason === 'string' && s.reason.length <= 200).slice(-MAX_JOB_SKIPS)
    : [];
  // A run uid that is not a number is cleared. One that names no live item is left alone ON PURPOSE: the runtime's
  // settle step forgets it on the next tick exactly as it would have in the live game (heal must be a no-op on a
  // world the game itself wrote, or a reload would not continue byte-identically).
  void state;
  if (!(isNum(j.runUid) && Number.isInteger(j.runUid) && j.runUid >= 0)) {
    j.runUid = null;
    j.interactionId = null;
    j.targetKey = null;
    j.targetName = null;
    j.before = null;
    j.reached = false;
    if (j.status === 'working') j.status = 'waiting';
  } else {
    j.interactionId = str(j.interactionId, 64);
    j.targetKey = str(j.targetKey, 32);
    j.targetName = str(j.targetName, 120);
    if (!isNum(j.before)) j.before = null;
  }
}
