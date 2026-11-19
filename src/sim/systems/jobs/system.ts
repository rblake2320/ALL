/**
 * W-124 (D-071) household jobs — the runtime. A job is a persistent assignment (WorldState.jobs): "Mort, clean the
 * kitchen until it is done", "Ghoulia, play every evening 6 PM–9 PM". Deterministic: every decision is a function of
 * the saved world (no ctx.rng, no wall clock, no transient caches), so replay, save/reload and journals continue
 * byte-identically.
 *
 *   picking      when the zombie is idle (SimSystem.beforeAutonomy: right before free will, whatever the free-will
 *                setting) the first runnable job — priority, then the player's order — asks the W-124 core
 *                `resolveActivity({category}, world, agent, {all: true})` for ranked candidates (validated by the
 *                engine's own menu, nearest reachable first, objects other members queued / use already skipped);
 *                agent targets another member queued are skipped too, then the job's scope, skipped targets and the
 *                money rule filter them. The run is an ordinary `auto` queue item marked `params.jobId`.
 *   completion   only a COMPLETED run whose measured state changed is credited (dirt / trash / dishes / spoiled food
 *                down, broken → fixed, fun / company up, skill XP up). A run that completes without changing anything
 *                is not progress: that target is skipped for a while ("Made no difference").
 *   urgency      the engine's urgency thresholds (home autonomy URGENT_HELP) interrupt the job (graceful cancel); the
 *                zombie's free will looks after the need and the job resumes once it recovered (hysteresis). With free
 *                will OFF only the engine's own critical overrides (feral hunger, passing out) interrupt — the player
 *                is in charge — and the job resumes afterwards.
 *   ends         once: one credited completion; untilDone: nothing remains (toast); recurring: idles politely outside
 *                its daily window and when nothing remains inside it (one "done for today" toast per window).
 *   blocked      unreachable / removed targets are skipped with a reason; nothing runnable → `blocked` + reason,
 *                re-checked every RECHECK_MIN game minutes.
 *   money        never buys anything: costly interactions are never picked, and the engine refuses any spend made by
 *                a job run (context.spend, D-071).
 *   lots         home lot only; `lotId` stays null until W-025 town state exists (a job of another lot never runs);
 *                scopes and places are lot-local tiles, never neighbourhood-map coordinates.
 */
import type { JobCommand, JobScopeOption, JobView, JobsView, SimContext, SimEvent, SimSystem } from '../../contracts';
import type { AgentState, JobAssignment, JobsState, NeedId, ObjectState, TargetRef } from '../../types';
import { NEED_IDS, SKILL_IDS, TICK_MINUTES } from '../../types';
import { PRIORITY } from '../../vocabulary';
import { resolveActivity, type ActivityCandidate, type QuestWorldView } from '../../../shared/questAction';
import {
  MAX_JOB_SKIPS,
  MAX_JOBS,
  MAX_JOBS_PER_AGENT,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  hourLabel,
  inWindow,
  jobCategory,
  jobCategoryStatuses,
  jobInteractionAllowed,
  modeLabel,
  parseMode,
  parsePriority,
  parseScope,
  windowKey,
  type JobCategoryDef,
} from '../../../shared/jobs';
import { URGENT_HELP, needsHelped } from '../home/autonomy';
import { VITALITY_NEGLECT_BELOW } from '../home/decay/rates';
import { spoiledCount } from '../home/food/leftovers';
import { availableCategories, createJobsState, healJobsState } from './state';
import { homeRegionIdOf } from '../../../shared/town';

export const JOBS_SYSTEM_ID = 'jobs';
/** Game minutes between looks for work while blocked / nothing to do. */
export const RECHECK_MIN = 30;
/** Game minutes a target is skipped after it could not be reached / made no difference. */
export const SKIP_MIN = 60;
/** A break ends once the need is this many points above its urgency threshold. */
export const RESUME_MARGIN = 20;
/** Queue params key that marks a job run (the engine's spend guard reads the same key). */
export const JOB_PARAM = 'jobId';

const ticksOf = (min: number) => Math.max(1, Math.round(min / TICK_MINUTES));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const BREAK_WORD: Readonly<Record<NeedId, string>> = {
  hunger: 'hungry',
  energy: 'tired',
  preservation: 'needs freshening up',
  social: 'lonely',
  fun: 'bored',
  hygiene: 'needs a wash',
};

const STATUS_LABEL: Readonly<Record<JobAssignment['status'], string>> = {
  waiting: 'Waiting for a free moment',
  working: 'Working',
  break: 'Taking a break',
  blocked: 'Blocked',
  resting: 'Resting',
  paused: 'Paused',
  away: 'Away',
};

// ───────────────────────────── helpers ─────────────────────────────

function jobsOf(ctx: SimContext): JobsState {
  const s = ctx.state;
  if (!s.jobs || typeof s.jobs !== 'object' || !Array.isArray(s.jobs.list)) s.jobs = createJobsState();
  return s.jobs;
}

/** An agent's jobs in run order: priority, then the player's order. */
function agentJobs(js: JobsState, agentId: string): JobAssignment[] {
  const mine = js.list.filter((j) => j.agentId === agentId);
  return mine
    .map((j, i) => ({ j, i }))
    .sort((a, b) => PRIORITY_RANK[a.j.priority] - PRIORITY_RANK[b.j.priority] || a.i - b.i)
    .map((x) => x.j);
}

function lotIdOf(ctx: SimContext): string | null {
  return ctx.state.town ? homeRegionIdOf(ctx.state) : null;
}

function agentAtHome(ctx: SimContext, agent: AgentState): boolean {
  return agent.presence === 'onLot' && (agent.regionId ?? homeRegionIdOf(ctx.state)) === homeRegionIdOf(ctx.state);
}

function objectAtHome(ctx: SimContext, object: ObjectState): boolean {
  const holder = object.placement?.kind === 'held' ? ctx.agent(object.placement.agentId) : undefined;
  return holder ? agentAtHome(ctx, holder) : (object.regionId ?? homeRegionIdOf(ctx.state)) === homeRegionIdOf(ctx.state);
}

function worldOf(ctx: SimContext): QuestWorldView {
  return {
    state: ctx.state,
    content: ctx.content,
    spatial: ctx.spatial,
    menu: (actorId, target) => (typeof ctx.menu === 'function' ? ctx.menu(actorId, target) : []),
  };
}

function objOf(ctx: SimContext, key: string | null): ObjectState | undefined {
  return key && !key.startsWith('a:') ? ctx.state.objects[key] : undefined;
}

function emit(ctx: SimContext, j: JobAssignment, what: 'assign' | 'done' | 'blocked', reason: string | null): void {
  const e: SimEvent = { type: 'job', what, jobId: j.id, agentId: j.agentId, category: j.category, reason };
  ctx.emit(e);
}

function setStatus(ctx: SimContext, j: JobAssignment, status: JobAssignment['status'], reason: string | null): void {
  const wasBlocked = j.status === 'blocked' && j.reason === reason;
  j.status = status;
  j.reason = reason;
  if (status === 'blocked' && !wasBlocked) emit(ctx, j, 'blocked', reason);
}

function clearRun(j: JobAssignment): void {
  j.runUid = null;
  j.interactionId = null;
  j.targetKey = null;
  j.targetName = null;
  j.before = null;
  j.reached = false;
}

function addSkip(ctx: SimContext, j: JobAssignment, key: string | null, reason: string): void {
  if (!key) return;
  j.skips = j.skips.filter((s) => s.key !== key && s.until > ctx.state.tick);
  j.skips.push({ key, until: ctx.state.tick + ticksOf(SKIP_MIN), reason });
  if (j.skips.length > MAX_JOB_SKIPS) j.skips.splice(0, j.skips.length - MAX_JOB_SKIPS);
}

function remove(js: JobsState, j: JobAssignment): void {
  const i = js.list.indexOf(j);
  if (i >= 0) js.list.splice(i, 1);
}

/** Stop the job's run right away (graceful engine cancel) and forget it. */
function stopRun(ctx: SimContext, j: JobAssignment, reason: string): void {
  const a = ctx.agent(j.agentId);
  if (a && j.runUid !== null) {
    if (a.active && a.active.uid === j.runUid) ctx.interrupt(a, reason);
    else ctx.cancel(a, j.runUid, reason);
  }
  clearRun(j);
}

// ───────────────────────────── measuring real change ─────────────────────────────

function skillTotal(a: AgentState): number {
  let t = 0;
  for (const s of SKILL_IDS) {
    const v = a.skills?.[s];
    if (v) t += (isNum(v.level) ? v.level : 0) * 1e4 + (isNum(v.xp) ? v.xp : 0);
  }
  return t;
}

/** Mess left on an object: grime + trash fill + spoiled food + "it is a dish / ash / plate lying about". 0 when gone. */
function messOf(o: ObjectState | undefined): number {
  if (!o) return 0;
  const dirt = isNum(o.condition?.dirt) ? Math.max(0, o.condition.dirt) : 0;
  const fill = isNum(o.data?.fill) ? Math.max(0, o.data.fill as number) : 0;
  const loose = o.placement && (o.placement.kind === 'loose' || o.placement.kind === 'held') ? 1 : 0;
  let spoiled = 0;
  try {
    spoiled = spoiledCount(o);
  } catch {
    spoiled = 0;
  }
  return dirt + fill + spoiled + loose;
}

/** The measured state a job is meant to change (lower is better for mess / broken, higher for the rest). */
export function measureJob(ctx: SimContext, cat: JobCategoryDef, agent: AgentState, targetKey: string | null): number {
  switch (cat.metric) {
    case 'fun':
      return isNum(agent.needs?.fun) ? agent.needs.fun : 0;
    case 'social':
      return isNum(agent.needs?.social) ? agent.needs.social : 0;
    case 'skill':
      return skillTotal(agent);
    case 'broken': {
      const o = objOf(ctx, targetKey);
      return o ? (o.condition?.broken ? 1 : 0) : 1;
    }
    case 'mess':
      return messOf(objOf(ctx, targetKey));
  }
}

/** Smallest need gain that counts as real progress (a show that ends after one tick is not "playing"). */
export const MIN_NEED_GAIN = 1;

function improved(cat: JobCategoryDef, before: number, after: number): boolean {
  if (cat.metric === 'mess' || cat.metric === 'broken') return after < before - 1e-9;
  if (cat.metric === 'fun' || cat.metric === 'social') return after >= before + MIN_NEED_GAIN;
  return after > before + 1e-6;
}

// ───────────────────────────── scope ─────────────────────────────

function roomAt(ctx: SimContext, x: number, z: number): number | null {
  try {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    return ctx.spatial.inBounds(fx, fz) ? ctx.spatial.roomAt(fx, fz) : null;
  } catch {
    return null;
  }
}

function inScope(ctx: SimContext, j: JobAssignment, c: ActivityCandidate): boolean {
  const target = c.action.target;
  if (target.kind === 'object') {
    const o = ctx.state.objects[target.id];
    if (!o || !objectAtHome(ctx, o)) return false;
  } else if (target.kind === 'agent') {
    const a = ctx.agent(target.id);
    if (!a || !agentAtHome(ctx, a)) return false;
  }
  const s = j.scope;
  if (s.kind === 'lot') return true;
  if (s.kind === 'object') return c.action.objectId === s.id;
  const p = c.place;
  if (!p || p.x === null || p.z === null) return false;
  const want = roomAt(ctx, s.x, s.z);
  return want !== null && roomAt(ctx, p.x, p.z) === want;
}

function objectInScope(ctx: SimContext, j: JobAssignment, o: ObjectState): boolean {
  if (!objectAtHome(ctx, o)) return false;
  const s = j.scope;
  if (s.kind === 'lot') return true;
  if (s.kind === 'object') return o.id === s.id;
  const p = o.placement as { x?: unknown; z?: unknown };
  if (!isNum(p.x) || !isNum(p.z)) return false;
  const want = roomAt(ctx, s.x, s.z);
  return want !== null && roomAt(ctx, p.x, p.z) === want;
}

/** Agent targets another household member has queued / is with (social jobs never pile onto one visitor). */
function claimedAgents(ctx: SimContext, actor: AgentState): Set<string> {
  const out = new Set<string>();
  for (const m of ctx.householdMembers()) {
    if (m.id === actor.id) continue;
    for (const q of [m.active, ...(Array.isArray(m.queue) ? m.queue : [])]) if (q && q.target && q.target.kind === 'agent') out.add(q.target.id);
  }
  return out;
}

// ───────────────────────────── is there work left? ─────────────────────────────

const byId = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1)) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * A chore the engine's menu refuses for one of these reasons still has its work left: the object is busy, or THIS
 * zombie cannot do it (state reasons such as "Already spotless" mean there is nothing to do).
 */
const STILL_WORK = /^(In use|Someone else has it|Needs (an arm|\d+ arms)|The .+ is on fire!)$/;

/**
 * Objects with work left (mess / broken categories), in id order: in scope, hosting one of the category's chores, and
 * either broken (repairs) or offered by the engine's own menu (cleaning: available, or refused only because it is
 * busy / this zombie cannot do it) — independent of reachability, claims and who does it.
 */
function workTargets(ctx: SimContext, j: JobAssignment, cat: JobCategoryDef, agent: AgentState, interactions: readonly string[], first = false): ObjectState[] {
  const out: ObjectState[] = [];
  for (const id of Object.keys(ctx.state.objects).sort(byId)) {
    const o = ctx.state.objects[id];
    if (!o || !o.placement || !objectInScope(ctx, j, o)) continue;
    const od = ctx.content.objects[o.defId];
    if (!od || !Array.isArray(od.interactions)) continue;
    const here = interactions.filter((i) => od.interactions.includes(i));
    if (here.length === 0) continue;
    let work: boolean;
    if (cat.metric === 'broken') work = !!o.condition?.broken;
    else if (typeof ctx.menu !== 'function') work = messOf(o) > 0;
    else work = ctx.menu(agent.id, { kind: 'object', id }).some((e) => here.includes(e.interactionId) && (e.available || STILL_WORK.test(e.reason ?? '')));
    if (!work) continue;
    out.push(o);
    if (first) break;
  }
  return out;
}

/** True while the job's work is not finished (independent of reachability / claims / who is doing it). */
function workRemains(ctx: SimContext, j: JobAssignment, cat: JobCategoryDef, agent: AgentState, interactions: readonly string[]): boolean {
  if (cat.metric === 'skill') return true; // open-ended (only Once / Daily are offered)
  if (cat.metric === 'fun' || cat.metric === 'social') {
    const v = cat.metric === 'fun' ? agent.needs?.fun : agent.needs?.social;
    return !(isNum(v) && v >= (cat.full ?? 92));
  }
  return workTargets(ctx, j, cat, agent, interactions, true).length > 0;
}

/** Objects other household members have queued / are using (target or current stage target). */
function claimedObjects(ctx: SimContext, actor: AgentState): Set<string> {
  const out = new Set<string>();
  for (const m of ctx.householdMembers()) {
    if (m.id === actor.id) continue;
    for (const q of [m.active, ...(Array.isArray(m.queue) ? m.queue : [])]) {
      if (!q) continue;
      if (q.target && q.target.kind === 'object') out.add(q.target.id);
      const st = (q as { stageTarget?: TargetRef }).stageTarget;
      if (st && st.kind === 'object') out.add(st.id);
    }
  }
  return out;
}

// ───────────────────────────── picking ─────────────────────────────

type Pick = { cand: ActivityCandidate } | { none: true } | { blocked: string };

function pickFor(ctx: SimContext, j: JobAssignment, cat: JobCategoryDef, agent: AgentState, interactions: readonly string[]): Pick {
  const s = j.scope;
  if (s.kind === 'object' && !ctx.state.objects[s.id]) return { blocked: 'It’s gone' };
  // a need that is already full has nothing left to raise (checked BEFORE picking: the menu would still offer the TV)
  if ((cat.metric === 'fun' || cat.metric === 'social') && !workRemains(ctx, j, cat, agent, interactions)) return { none: true };
  const r = resolveActivity({ category: j.category }, worldOf(ctx), agent.id, { all: true });
  const now = ctx.state.tick;
  const skips = j.skips.filter((x) => x.until > now);
  const taken = claimedAgents(ctx, agent);
  let skippedReason: string | null = null;
  let outOfScope = false;
  for (const c of r.candidates) {
    const a = c.action;
    if (a.agentId !== agent.id) continue;
    if (!jobInteractionAllowed(ctx.content.interactions[a.interactionId]) || !interactions.includes(a.interactionId)) continue;
    if (!inScope(ctx, j, c)) {
      outOfScope = true;
      continue;
    }
    const key = a.target.kind === 'agent' ? `a:${a.target.id}` : a.objectId;
    if (a.target.kind === 'agent' && taken.has(a.target.id)) {
      skippedReason = skippedReason ?? 'Someone else is already on it';
      continue;
    }
    const sk = skips.find((x) => x.key === key);
    if (sk) {
      skippedReason = skippedReason ?? sk.reason;
      continue;
    }
    if (a.already) continue;
    return { cand: c };
  }
  if (cat.metric === 'mess' || cat.metric === 'broken') {
    // say WHY the remaining work cannot be done (the resolver's own answer is about the nearest refusal, which may be
    // a spotless table next to the unreachable dirty one)
    const targets = workTargets(ctx, j, cat, agent, interactions);
    if (targets.length === 0) return { none: true };
    const claimed = claimedObjects(ctx, agent);
    const free = targets.filter((o) => !claimed.has(o.id));
    const fresh = free.filter((o) => !skips.some((x) => x.key === o.id));
    const nameOf = (o: ObjectState) => ctx.content.objects[o.defId]?.name ?? 'spot';
    if (fresh.length > 0) {
      const b = r.best;
      if (cat.metric === 'broken' && b.kind === 'blocked' && b.code === 'agent' && !/get there/i.test(b.reason)) return { blocked: b.reason };
      // work that is left only because the engine refuses the chore here (in use by a visitor, no arm): say that
      const chores = cat.metric === 'mess' && typeof ctx.menu === 'function' ? ctx.menu(agent.id, { kind: 'object', id: fresh[0].id }).filter((e) => interactions.includes(e.interactionId)) : [];
      const refused = chores.some((e) => e.available) ? undefined : chores.find((e) => STILL_WORK.test(e.reason ?? ''));
      if (refused && refused.reason) return { blocked: refused.reason };
      return { blocked: `Can’t get to the ${nameOf(fresh[0])}` };
    }
    if (free.length > 0) return { blocked: skips.find((x) => x.key === free[0].id)?.reason ?? 'Nothing to do right now' };
    return { blocked: 'Someone else is already on it' };
  }
  if (!workRemains(ctx, j, cat, agent, interactions)) return { none: true };
  if (skippedReason) return { blocked: skippedReason };
  const b = r.best;
  if (b.kind === 'blocked' && b.code !== 'none' && b.code !== 'invalid' && b.code !== 'unknown') return { blocked: b.reason };
  if (b.kind === 'missing') return { blocked: `Needs ${b.need}` };
  if (outOfScope) return { blocked: s.kind === 'room' ? 'Nothing to do in that room right now' : 'Nothing to do there right now' };
  return { blocked: b.kind === 'blocked' ? b.reason : 'Nothing to do right now' };
}

function start(ctx: SimContext, j: JobAssignment, cat: JobCategoryDef, agent: AgentState, c: ActivityCandidate): boolean {
  const a = c.action;
  const params: Record<string, string | number | boolean> = { ...a.extra, [JOB_PARAM]: j.id };
  const qi = ctx.queue(agent, { interactionId: a.interactionId, target: a.target as TargetRef, params, source: 'auto', priority: PRIORITY.auto });
  if (!qi) return false;
  const key = a.target.kind === 'agent' ? `a:${a.target.id}` : a.objectId;
  j.runUid = qi.uid;
  j.interactionId = a.interactionId;
  j.targetKey = key;
  j.targetName = a.targetName;
  j.before = measureJob(ctx, cat, agent, key);
  j.reached = false;
  j.status = 'working';
  j.reason = null;
  return true;
}

/** A job run that ended without being credited: forget it; skip its target unless the zombie was pulled away. */
function settle(ctx: SimContext, j: JobAssignment, agent: AgentState | undefined): void {
  if (j.runUid === null) return;
  let uid = j.runUid;
  if (agent && !(agent.active && agent.active.uid === uid) && !agent.queue.some((q) => q.uid === uid)) {
    // the engine suspended the run (a social respond / pair partner) and re-queued it under a NEW uid: follow the copy
    const copy = [agent.active, ...agent.queue].find((q) => !!q && q.params?.[JOB_PARAM] === j.id && q.params._origUid !== undefined);
    if (copy) uid = j.runUid = copy.uid;
  }
  if (agent && agent.active && agent.active.uid === uid) {
    if (agent.active.phase === 'run') j.reached = true;
    return;
  }
  if (agent && agent.queue.some((q) => q.uid === uid)) return;
  const pulledAway =
    !agent ||
    !agentAtHome(ctx, agent) ||
    j.status === 'break' ||
    j.paused ||
    agent.status.passedOut ||
    agent.status.feral ||
    [agent.active, ...agent.queue].some((q) => !!q && q.uid !== uid && (q.source !== 'auto' || q.priority > PRIORITY.auto));
  if (!pulledAway) {
    const gone = j.targetKey !== null && !j.targetKey.startsWith('a:') && !ctx.state.objects[j.targetKey];
    const who = j.targetKey && j.targetKey.startsWith('a:') ? ctx.agent(j.targetKey.slice(2)) : undefined;
    const name = j.targetName ?? 'spot';
    if (!gone && !(who && who.presence !== 'onLot')) addSkip(ctx, j, j.targetKey, j.reached ? `Couldn’t finish at the ${name}` : who ? `Can’t get to ${name}` : `Can’t get to the ${name}`);
  }
  clearRun(j);
  if (j.status === 'working') j.status = 'waiting';
}

/** The urgent need the agent should look after first (null = none). Free will off: the player is in charge. */
function urgentNeed(ctx: SimContext, agent: AgentState, cat: JobCategoryDef, held: NeedId | null, runDef: string | null): NeedId | null {
  if (ctx.state.settings?.autonomy === 'off') return null;
  const helps = new Set<NeedId>(cat.helps);
  const def = runDef ? ctx.content.interactions[runDef] : undefined;
  if (def) for (const n of needsHelped(ctx, def)) helps.add(n);
  const val = (n: NeedId) => (isNum(agent.needs?.[n]) ? agent.needs[n] : 100);
  // a need capped under its threshold (freshness under a low vitality) could never clear it: for that need only, break
  // just above the neglect line instead, so the zombie can work at its cap and is not worked into neglect
  const thOf = (n: NeedId) => {
    const th = URGENT_HELP[n];
    if (th === undefined) return undefined;
    const cap = ctx.needCap(agent, n);
    return cap > th ? th : Math.min(VITALITY_NEGLECT_BELOW + 1, cap - 1);
  };
  if (held && !helps.has(held)) {
    const th = thOf(held);
    if (th !== undefined && val(held) < Math.min(th + RESUME_MARGIN, ctx.needCap(agent, held) - 1)) return held;
  }
  for (const n of NEED_IDS) {
    if (helps.has(n)) continue;
    const th = thOf(n);
    if (th !== undefined && val(n) < th) return n;
  }
  return null;
}

function finish(ctx: SimContext, js: JobsState, j: JobAssignment, reason: string): void {
  stopRun(ctx, j, 'Job done');
  remove(js, j);
  emit(ctx, j, 'done', reason);
}

/** A free zombie looks for its next job run (the beforeAutonomy hook). */
function runJobs(ctx: SimContext, agent: AgentState): void {
  const js = ctx.state.jobs;
  if (!js || !Array.isArray(js.list) || js.list.length === 0 || !agentAtHome(ctx, agent)) return;
  const mine = agentJobs(js, agent.id);
  if (mine.length === 0) return;
  for (const j of mine) settle(ctx, j, agent);
  if (mine.some((j) => j.runUid !== null)) return;
  const live = mine.filter((j) => !j.paused);
  if (live.length === 0) return;
  const held = live.find((j) => j.breakNeed)?.breakNeed ?? null;
  const t = ctx.time;
  const tick = ctx.state.tick;
  const lot = lotIdOf(ctx);
  const ok = availableCategories(ctx.content);
  for (const j of live) {
    // judged per job, against the job's OWN category — the same test tickJobs applies to its run (a run that would
    // be interrupted on the next tick is never started)
    const own = jobCategory(j.category);
    const urgent = own ? urgentNeed(ctx, agent, own, held, null) : null;
    if (urgent) {
      j.breakNeed = urgent;
      setStatus(ctx, j, 'break', `Taking a break — ${BREAK_WORD[urgent]}`);
      continue;
    }
    if (j.breakNeed) {
      j.breakNeed = null;
      if (j.status === 'break') setStatus(ctx, j, 'waiting', null);
    }
    const cat = jobCategory(j.category);
    if (!cat || !ok.has(cat.id)) {
      setStatus(ctx, j, 'blocked', 'This job isn’t available');
      continue;
    }
    if (j.lotId !== null && j.lotId !== lot) {
      setStatus(ctx, j, 'blocked', 'This job belongs to another lot');
      continue;
    }
    if (tick < j.nextCheckTick) continue;
    if (j.mode.kind === 'recurring' && !inWindow(t.hour, j.mode.from, j.mode.to)) {
      setStatus(ctx, j, 'resting', `Starts at ${hourLabel(j.mode.from)}`);
      j.nextCheckTick = tick + ticksOf(60 - (t.minute % 60));
      continue;
    }
    const interactions = jobCategoryStatuses(ctx.content).find((c) => c.id === cat.id)?.interactions ?? [];
    const p = pickFor(ctx, j, cat, agent, interactions);
    if ('cand' in p) {
      if (start(ctx, j, cat, agent, p.cand)) return;
      setStatus(ctx, j, 'blocked', 'Queue is full');
      j.nextCheckTick = tick + ticksOf(RECHECK_MIN);
      continue;
    }
    if ('none' in p) {
      if (j.mode.kind === 'recurring') {
        const wk = windowKey(t.day, t.hour, j.mode.from, j.mode.to);
        setStatus(ctx, j, 'resting', 'All done for now');
        if (j.restKey !== wk) {
          j.restKey = wk;
          emit(ctx, j, 'done', 'recurring');
        }
        j.nextCheckTick = tick + ticksOf(RECHECK_MIN);
        continue;
      }
      finish(ctx, js, j, j.done > 0 ? 'finished' : 'nothing');
      continue;
    }
    setStatus(ctx, j, 'blocked', p.blocked);
    j.nextCheckTick = tick + ticksOf(RECHECK_MIN);
  }
}

/** Every tick: settle ended runs, take urgent breaks mid-run, keep "away" honest, drop jobs of departed members. */
function tickJobs(ctx: SimContext): void {
  const js = ctx.state.jobs;
  if (!js || !Array.isArray(js.list) || js.list.length === 0) return;
  for (const j of js.list.slice()) {
    const a = ctx.agent(j.agentId);
    if (!a || !ctx.isHousehold(a) || a.presence === 'gone') {
      clearRun(j);
      remove(js, j);
      continue;
    }
    settle(ctx, j, a);
    if (j.paused) {
      if (j.status !== 'paused') setStatus(ctx, j, 'paused', null);
      continue;
    }
    if (!agentAtHome(ctx, a)) {
      if (j.runUid !== null) stopRun(ctx, j, 'Not home');
      if (j.status !== 'away') setStatus(ctx, j, 'away', a.presence === 'atWork' ? 'At work' : 'Not home');
      continue;
    }
    if (j.status === 'away') setStatus(ctx, j, 'waiting', null);
    if (j.mode.kind === 'recurring' && !inWindow(ctx.time.hour, j.mode.from, j.mode.to)) {
      // Idle admission alone cannot stop a run already queued or playing at closing time.
      stopRun(ctx, j, 'Daily job window ended');
      j.breakNeed = null;
      setStatus(ctx, j, 'resting', `Starts at ${hourLabel(j.mode.from)}`);
      j.nextCheckTick = ctx.state.tick + ticksOf(60 - (ctx.time.minute % 60));
      continue;
    }
    const run = j.runUid !== null && a.active && a.active.uid === j.runUid ? a.active : null;
    if (!run || run.phase === 'exit' || run.canceled) continue;
    const cat = jobCategory(j.category);
    const def = ctx.content.interactions[run.interactionId];
    if (!cat || (def && def.interruptible === false && run.phase === 'run')) continue;
    const urgent = urgentNeed(ctx, a, cat, null, run.interactionId);
    if (urgent) {
      j.breakNeed = urgent;
      setStatus(ctx, j, 'break', `Taking a break — ${BREAK_WORD[urgent]}`);
      ctx.interrupt(a, 'Taking a break');
    }
  }
}

/** A completed run: credit it only when the measured state really changed. */
function onCompleted(ctx: SimContext, e: Extract<SimEvent, { type: 'interactionCompleted' }>): void {
  const js = ctx.state.jobs;
  if (!js || !Array.isArray(js.list) || js.list.length === 0) return;
  const j = js.list.find((x) => x.runUid === e.uid && x.agentId === e.agentId);
  if (!j) return;
  const cat = jobCategory(j.category);
  const a = ctx.agent(j.agentId);
  const key = j.targetKey;
  if (cat && a && isNum(j.before)) {
    const after = measureJob(ctx, cat, a, key);
    if (improved(cat, j.before, after)) {
      j.done += 1;
      clearRun(j);
      if (j.status === 'working') j.status = 'waiting';
      j.skips = j.skips.filter((s) => s.key !== key);
      if (j.mode.kind === 'once') finish(ctx, js, j, 'finished');
      return;
    }
  }
  addSkip(ctx, j, key, 'Made no difference');
  clearRun(j);
  if (j.status === 'working') j.status = 'waiting';
}

/** A household member who just got (or got back) a job leaves pure free-will idling at once ("between interactions"). */
function kick(ctx: SimContext, agentId: string): void {
  const a = ctx.agent(agentId);
  const run = a ? a.active : null;
  if (!a || !run || run.source !== 'auto' || run.priority > PRIORITY.auto || run.phase === 'exit') return;
  if (typeof run.params?.[JOB_PARAM] === 'string') return;
  const def = ctx.content.interactions[run.interactionId];
  if (!def || def.interruptible === false || (Array.isArray(def.tags) && def.tags.includes('sleep'))) return;
  const cat = jobCategory(ctx.state.jobs?.list.find((j) => j.agentId === agentId && !j.paused)?.category);
  if (cat && urgentNeed(ctx, a, cat, null, run.interactionId)) return;
  // only leisure / idling: an activity that is helping an urgent need is left alone above
  ctx.interrupt(a, 'Off to a job');
}

// ───────────────────────────── commands ─────────────────────────────

type CmdResult = { ok: true; id?: string } | string;

function command(ctx: SimContext, raw: unknown): CmdResult {
  if (!raw || typeof raw !== 'object') return 'Invalid job';
  const cmd = raw as JobCommand & Record<string, unknown>;
  const js = jobsOf(ctx);
  if (cmd.action === 'assign') return assign(ctx, js, cmd);
  const j = typeof cmd.jobId === 'string' ? js.list.find((x) => x.id === cmd.jobId) : undefined;
  if (!j) return 'That job is gone';
  switch (cmd.action) {
    case 'cancel':
      stopRun(ctx, j, 'Job canceled');
      remove(js, j);
      return { ok: true };
    case 'pause':
      if (j.paused) return { ok: true };
      j.paused = true;
      stopRun(ctx, j, 'Job paused');
      j.breakNeed = null;
      setStatus(ctx, j, 'paused', null);
      return { ok: true };
    case 'resume':
      if (!j.paused) return { ok: true };
      j.paused = false;
      j.nextCheckTick = 0;
      setStatus(ctx, j, 'waiting', null);
      kick(ctx, j.agentId);
      return { ok: true };
    case 'priority': {
      const p = parsePriority(cmd.priority, 'normal');
      if (!p || cmd.priority === undefined) return 'Invalid priority';
      j.priority = p;
      j.nextCheckTick = 0;
      return { ok: true };
    }
    case 'move': {
      // moves in RUN order (priority, then the player's order); passing a job of another priority takes its priority
      if (cmd.dir !== -1 && cmd.dir !== 1) return 'Invalid move';
      const mine = agentJobs(js, j.agentId);
      const i = mine.indexOf(j);
      const k = i + cmd.dir;
      if (k < 0 || k >= mine.length) return 'Can’t move it further';
      const other = mine[k];
      j.priority = other.priority;
      const a = js.list.indexOf(j);
      const b = js.list.indexOf(other);
      if ((cmd.dir === -1 && a > b) || (cmd.dir === 1 && a < b)) {
        js.list[a] = other;
        js.list[b] = j;
      }
      j.nextCheckTick = 0;
      return { ok: true };
    }
    default:
      return 'Unknown job command';
  }
}

function assign(ctx: SimContext, js: JobsState, cmd: Record<string, unknown>): CmdResult {
  const agent = typeof cmd.agentId === 'string' ? ctx.agent(cmd.agentId) : undefined;
  if (!agent || !ctx.isHousehold(agent) || agent.presence === 'gone' || agent.presence === 'crumbled') return 'Not in your household';
  const cat = jobCategory(cmd.category);
  if (!cat) return 'Unknown job';
  const status = jobCategoryStatuses(ctx.content).find((c) => c.id === cat.id);
  if (!status || !status.available) return status?.reason ? `Coming later — ${status.reason}` : 'Coming later';
  const scope = parseScope(cmd.scope, ctx.state.lot.width, ctx.state.lot.depth);
  if (!scope) return 'Pick where to work';
  if (scope.kind === 'object') {
    if (cat.agentTargets) return 'Pick the whole lot or a room';
    const o = ctx.state.objects[scope.id];
    const od = o ? ctx.content.objects[o.defId] : undefined;
    if (!o || !objectAtHome(ctx, o) || !od || !od.interactions.some((i) => status.interactions.includes(i))) return 'That can’t be used for this job';
  }
  const mode = parseMode(cmd.mode);
  if (!mode) return 'Pick once, until done or daily';
  if (mode.kind === 'untilDone' && cat.openEnded) return 'This job never runs out — pick Once or Daily';
  const priority = parsePriority(cmd.priority, 'normal');
  if (!priority) return 'Invalid priority';
  if (js.list.length >= MAX_JOBS) return 'The household has too many jobs';
  const mine = js.list.filter((j) => j.agentId === agent.id);
  if (mine.length >= MAX_JOBS_PER_AGENT) return `${agent.firstName} already has ${MAX_JOBS_PER_AGENT} jobs`;
  const same = (x: JobAssignment) => x.category === cat.id && JSON.stringify(x.scope) === JSON.stringify(scope) && JSON.stringify(x.mode) === JSON.stringify(mode);
  if (mine.some(same)) return 'Already assigned';
  const j: JobAssignment = {
    id: `j${js.nextId}`,
    agentId: agent.id,
    category: cat.id,
    scope,
    mode,
    priority,
    paused: false,
    lotId: lotIdOf(ctx),
    createdTick: ctx.state.tick,
    status: agentAtHome(ctx, agent) ? 'waiting' : 'away',
    reason: null,
    runUid: null,
    interactionId: null,
    targetKey: null,
    targetName: null,
    before: null,
    reached: false,
    done: 0,
    breakNeed: null,
    nextCheckTick: 0,
    skips: [],
    restKey: -1,
  };
  js.nextId += 1;
  js.list.push(j);
  emit(ctx, j, 'assign', null);
  kick(ctx, agent.id);
  return { ok: true, id: j.id };
}

// ───────────────────────────── view (read-only) ─────────────────────────────

const ROOM_NAMES: readonly [string, string][] = [
  ['fridge', 'Kitchen'],
  ['stove', 'Kitchen'],
  ['coffin', 'Bedroom'],
  ['bed', 'Bedroom'],
  ['shower', 'Bathroom'],
  ['tub', 'Bathroom'],
  ['toilet', 'Bathroom'],
  ['tv', 'Living room'],
  ['sofa', 'Living room'],
];

function scopeOptions(ctx: SimContext, catId: string, interactions: readonly string[], agentTargets: boolean): JobScopeOption[] {
  const out: JobScopeOption[] = [{ scope: { kind: 'lot' }, label: 'Whole lot' }];
  let rooms: { id: number; indoor: boolean; tiles: number[] }[] = [];
  try {
    rooms = ctx.spatial.rooms();
  } catch {
    rooms = [];
  }
  const w = ctx.state.lot.width;
  const objs = Object.keys(ctx.state.objects)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || (a < b ? -1 : 1))
    .map((id) => ctx.state.objects[id])
    .filter((o): o is ObjectState => !!o && objectAtHome(ctx, o) && o.placement && o.placement.kind === 'floor');
  const hosts = objs.filter((o) => (ctx.content.objects[o.defId]?.interactions ?? []).some((i) => interactions.includes(i)));
  const used = new Map<string, number>();
  for (const r of [...rooms].filter((x) => x.indoor && x.tiles.length > 0).sort((a, b) => a.tiles[0] - b.tiles[0])) {
    const inRoom = objs.filter((o) => roomAt(ctx, (o.placement as { x: number }).x, (o.placement as { z: number }).z) === r.id);
    if (!agentTargets && !inRoom.some((o) => hosts.includes(o))) continue;
    let name = 'Room';
    for (const [tag, label] of ROOM_NAMES) if (inRoom.some((o) => (ctx.content.objects[o.defId]?.tags ?? []).includes(tag))) {
      name = label;
      break;
    }
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    const t = r.tiles[0];
    out.push({ scope: { kind: 'room', x: t % w, z: Math.floor(t / w) }, label: n > 1 ? `${name} ${n}` : name });
  }
  if (!agentTargets) {
    const seen = new Map<string, number>();
    for (const o of hosts) {
      const nm = ctx.content.objects[o.defId]?.name ?? 'Object';
      const n = (seen.get(nm) ?? 0) + 1;
      seen.set(nm, n);
      out.push({ scope: { kind: 'object', id: o.id }, label: n > 1 ? `${nm} ${n}` : nm });
    }
  }
  void catId;
  return out;
}

function scopeLabel(ctx: SimContext, j: JobAssignment, options: JobScopeOption[] | undefined): string {
  const s = j.scope;
  if (s.kind === 'lot') return 'Whole lot';
  const hit = options?.find((o) => JSON.stringify(o.scope) === JSON.stringify(s));
  if (hit) return hit.label;
  if (s.kind === 'object') {
    const o = ctx.state.objects[s.id];
    return o ? ctx.content.objects[o.defId]?.name ?? 'Object' : 'Removed object';
  }
  return 'Room';
}

function view(ctx: SimContext): JobsView {
  const js = ctx.state.jobs;
  const statuses = jobCategoryStatuses(ctx.content);
  const scopes: Record<string, JobScopeOption[]> = {};
  for (const c of statuses) if (c.available) scopes[c.id] = scopeOptions(ctx, c.id, c.interactions, c.agentTargets);
  const list: JobView[] = [];
  const all = js && Array.isArray(js.list) ? js.list : [];
  const byAgent = new Map<string, JobAssignment[]>();
  for (const j of all) if (!byAgent.has(j.agentId)) byAgent.set(j.agentId, agentJobs(js!, j.agentId));
  for (const [, mine] of byAgent) {
    mine.forEach((j, index) => {
      const cat = jobCategory(j.category);
      const a = ctx.agent(j.agentId);
      const status = !j.paused && a && !agentAtHome(ctx, a) ? 'away' : j.status;
      let progress: number | null = null;
      let progressLabel = `${j.done} done`;
      if (cat && a && (cat.metric === 'fun' || cat.metric === 'social')) {
        const v = Math.round(measureJob(ctx, cat, a, null));
        const full = cat.full ?? 92;
        progress = Math.max(0, Math.min(1, v / full));
        progressLabel = `${cat.metric === 'fun' ? 'Fun' : 'Company'} ${Math.min(v, full)} / ${full} · ${j.done} done`;
      }
      list.push({
        id: j.id,
        agentId: j.agentId,
        category: j.category,
        label: cat?.label ?? j.category,
        icon: cat?.icon ?? 'dots',
        scope: j.scope,
        scopeLabel: scopeLabel(ctx, j, scopes[j.category]),
        mode: j.mode,
        modeLabel: modeLabel(j.mode),
        priority: j.priority,
        paused: j.paused,
        status,
        statusLabel: STATUS_LABEL[status] ?? 'Waiting',
        reason: status === 'away' ? (a?.presence === 'atWork' ? 'At work' : 'Not home') : j.reason,
        targetName: status === 'working' ? j.targetName : null,
        done: j.done,
        progressLabel,
        progress,
        index,
        count: mine.length,
      });
    });
  }
  return {
    list,
    categories: statuses.map((c) => ({ id: c.id, label: c.label, icon: c.icon, available: c.available, reason: c.reason, openEnded: c.openEnded, agentTargets: c.agentTargets })),
    scopes,
  };
}

// ───────────────────────────── the system ─────────────────────────────

export function createJobsSystem(): SimSystem {
  return {
    id: JOBS_SYSTEM_ID,
    init(ctx, loaded) {
      if (!loaded) {
        jobsOf(ctx);
        return;
      }
      healJobsState(ctx.state, ctx.content);
    },
    beforeAutonomy(ctx, agent) {
      runJobs(ctx, agent);
    },
    tick(ctx) {
      tickJobs(ctx);
    },
    onEvent(ctx, e) {
      if (e && e.type === 'interactionCompleted') onCompleted(ctx, e);
      if (e && e.type === 'regionCrossed') {
        const agent = ctx.agent(e.agentId);
        if (!agent) return;
        for (const j of ctx.state.jobs?.list ?? []) if (j.agentId === agent.id && !j.paused) {
          if (!agentAtHome(ctx, agent)) {
            // Drop the transient home run before the next dequeue in this region. Assignment/order/done survive.
            if (j.runUid !== null) stopRun(ctx, j, 'Not home');
            setStatus(ctx, j, 'away', 'Not home');
          } else if (j.status === 'away') setStatus(ctx, j, 'waiting', null);
        }
      }
    },
    api: {
      command: (cmd: unknown, ctx: SimContext) => command(ctx, cmd),
      view: (ctx: SimContext) => view(ctx),
      priorityLabel: (p: string) => PRIORITY_LABEL[p as keyof typeof PRIORITY_LABEL] ?? 'Normal',
    },
  };
}

export const jobsSystem = createJobsSystem();
