/** Read-only views for the UI (SimulationAPI). Delegates to systems with engine fallbacks. */
import type {
  AgentSummary,
  AspirationView,
  BillsView,
  BubbleIcon,
  CareerView,
  MoodView,
  MoodletView,
  NeedView,
  ObjectView,
  PartyView,
  QueueView,
  RelationshipView,
  SkillView,
  TownieView,
} from '../contracts';
import type { AgentState, CareerId, NeedId, Relationship } from '../types';
import { NEED_IDS, SKILL_IDS, SKILL_MAX_LEVEL, TICK_MINUTES } from '../types';
import { relativeLabel, WEEKDAY_SHORT, formatClock } from '../time';
import { FLOOR_STYLE_BY_ID, WALL_SEGMENT_PRICE } from '../../shared/styles';
import {
  AWAY_AT_WORK_PER_HOUR,
  CRITICAL_NEED,
  DIFFICULTY_PRESERVATION,
  GROUP_FUN_PER_HOUR,
  GROUP_MAX_OTHERS,
  GROUP_SOCIAL_PER_HOUR,
  NEED_LABELS,
  PRESERVATION_BASE_DECAY,
  SKILL_NAMES,
} from './constants';
import { fullName, isHouseholdAgent, isVisitorAgent, isWalkBy } from './agents';
import { recordFault } from './faults';
import { gerund, interactionLabel } from './labels';
import { MOOD_BAND_LABELS, decayRatePerHour, gainMultiplier, moodBand, moodBreakdown, needCap, skillLevel, xpTable } from './needs';
import { tryObjectDef } from './objects';
import { playerCancellable } from './queue';
import { stageOf } from './runner';
import { ENGINE_INTERACTIONS } from '../vocabulary';
import type { Engine } from './types';
import { clamp, compareIds, isNum, num } from './util';

/** Call a system api function if it exists; undefined when missing or throwing. */
export function sysCall<T>(eng: Engine, sysId: string, fn: string, ...args: unknown[]): T | undefined {
  const api = eng.ctx.sys(sysId);
  const f = api[fn];
  if (typeof f !== 'function') return undefined;
  try {
    return f(...args) as T;
  } catch (e) {
    recordFault(eng, `api:${sysId}.${fn}`, e);
    return undefined;
  }
}

export function activityOf(eng: Engine, agent: AgentState): { label: string | null; icon: BubbleIcon | null } {
  if (agent.presence === 'atWork') return { label: 'At work', icon: 'work' };
  if (agent.presence !== 'onLot') return { label: null, icon: null };
  const run = agent.active;
  if (!run) return { label: agent.status.feral ? 'Feral!' : null, icon: agent.status.feral ? 'brain' : null };
  const def = eng.content.interactions[run.interactionId];
  if (!def) return { label: null, icon: null };
  return { label: gerund(interactionLabel(eng, agent, def, run.target, run.params)), icon: def.icon };
}

export function criticalNeedOf(agent: AgentState): NeedId | null {
  let worst: NeedId | null = null;
  let wv = Infinity;
  for (const n of NEED_IDS) {
    const v = num(agent.needs?.[n], 50);
    if (v <= CRITICAL_NEED && v < wv) {
      wv = v;
      worst = n;
    }
  }
  return worst;
}

export function summaryOf(eng: Engine, agent: AgentState): AgentSummary {
  const m = moodBreakdown(eng, agent).value;
  const act = activityOf(eng, agent);
  return {
    id: agent.id,
    name: fullName(agent),
    firstName: agent.firstName,
    role: agent.role,
    presence: agent.presence,
    moodBand: moodBand(m),
    mood: Math.round(m),
    criticalNeed: criticalNeedOf(agent),
    activity: act.label,
    activityIcon: act.icon,
    isVisitor: isVisitorAgent(agent) && !isHouseholdAgent(eng, agent) && !isWalkBy(agent),
    appearance: agent.appearance,
  };
}

function stageRate(eng: Engine, agent: AgentState, need: NeedId): number {
  const run = agent.active;
  if (!run || run.phase !== 'run') return 0;
  const st = stageOf(eng, run);
  const def = eng.content.interactions[run.interactionId];
  if (!st || !def) return 0;
  let rate = 0;
  const raw = st.needsPerHour ? st.needsPerHour[need] : undefined;
  if (isNum(raw) && raw !== 0) {
    let scale = 1;
    const key = st.scaleByObjectParam ? st.scaleByObjectParam[need] : undefined;
    const obj = typeof run.data._uo === 'string' ? eng.state.objects[run.data._uo] : undefined;
    const od = obj ? tryObjectDef(eng, obj) : null;
    if (key && od && isNum(od.params[key])) scale = od.params[key] as number;
    const r = raw * scale;
    rate += r * gainMultiplier(eng, agent, need, r > 0);
  }
  if (def.joinable && (need === 'social' || need === 'fun')) {
    const sid = typeof run.data._ut === 'string' ? run.data._ut : typeof run.data._uo === 'string' ? run.data._uo : null;
    const obj = sid ? eng.state.objects[sid] : undefined;
    if (obj) {
      const others = obj.inUseBy.filter((id) => id !== agent.id && eng.state.agents[id]?.active?.interactionId === def.id).length;
      const n = Math.min(GROUP_MAX_OTHERS, others);
      rate += (need === 'social' ? GROUP_SOCIAL_PER_HOUR : GROUP_FUN_PER_HOUR) * n * gainMultiplier(eng, agent, need, true);
    }
  }
  return rate;
}

export function needTrend(eng: Engine, agent: AgentState, need: NeedId): number {
  if (agent.presence === 'atWork') {
    if (need === 'preservation') {
      const fromSys = sysCall<number>(eng, 'decay', 'preservationPerHour', agent.id);
      return isNum(fromSys) ? Math.round(fromSys * 100) / 100 : -PRESERVATION_BASE_DECAY * (DIFFICULTY_PRESERVATION[eng.state.settings.difficulty] ?? 1);
    }
    return num(AWAY_AT_WORK_PER_HOUR[need], 0);
  }
  if (agent.presence !== 'onLot') return 0;
  let t = 0;
  const decays = isHouseholdAgent(eng, agent) || (isVisitorAgent(agent) && !isWalkBy(agent));
  if (need === 'preservation') {
    const fromSys = sysCall<number>(eng, 'decay', 'preservationPerHour', agent.id);
    if (isNum(fromSys)) t += fromSys;
    else if (decays) t -= PRESERVATION_BASE_DECAY * (DIFFICULTY_PRESERVATION[eng.state.settings.difficulty] ?? 1) * gainMultiplier(eng, agent, need, false);
  } else if (decays) t -= decayRatePerHour(eng, agent, need);
  t += stageRate(eng, agent, need);
  return Math.round(t * 100) / 100;
}

export function needsView(eng: Engine, agent: AgentState): NeedView[] {
  return NEED_IDS.map((id) => {
    const value = clamp(num(agent.needs?.[id], 0), 0, 100);
    return { id, label: NEED_LABELS[id], value, cap: needCap(agent, id), trend: needTrend(eng, agent, id), critical: value <= CRITICAL_NEED };
  });
}

export function moodView(eng: Engine, agent: AgentState | undefined): MoodView {
  if (!agent) return { value: 0, band: 'fine', label: MOOD_BAND_LABELS.fine, contributors: [] };
  const b = moodBreakdown(eng, agent);
  const band = moodBand(b.value);
  return { value: Math.round(b.value * 10) / 10, band, label: MOOD_BAND_LABELS[band], contributors: b.contributors };
}

export function moodletsView(eng: Engine, agent: AgentState): MoodletView[] {
  const out: MoodletView[] = [];
  for (const m of Array.isArray(agent.moodlets) ? agent.moodlets : []) {
    const def = eng.content.moodlets[m.id];
    if (!def) continue;
    out.push({
      id: m.id,
      label: def.label,
      description: def.description,
      mood: def.mood * Math.max(1, num(m.stacks, 1)),
      stacks: Math.max(1, num(m.stacks, 1)),
      icon: def.icon,
      kind: def.kind,
      remaining: m.endTick === null ? null : Math.max(0, (m.endTick - eng.state.tick) * TICK_MINUTES),
    });
  }
  return out;
}

export function skillsView(eng: Engine, agent: AgentState): SkillView[] {
  return SKILL_IDS.map((id) => {
    const def = eng.content.skills[id];
    const level = skillLevel(agent, id);
    const need = xpTable(eng, id)[level];
    const xp = num(agent.skills?.[id]?.xp, 0);
    return {
      id,
      name: def?.name ?? SKILL_NAMES[id],
      icon: def?.icon ?? 'star',
      level,
      progress: level >= SKILL_MAX_LEVEL ? 1 : clamp(isNum(need) && need > 0 ? xp / need : 0, 0, 1),
    };
  });
}

export function queueViewOf(eng: Engine, agent: AgentState): QueueView[] {
  const out: QueueView[] = [];
  const run = agent.active;
  if (run) {
    const def = eng.content.interactions[run.interactionId];
    const stages = eng.content.stagesOf(run.interactionId);
    let frac = 0;
    if (run.phase === 'run' || run.phase === 'exit') {
      const st = stages[run.stage];
      if (st && st.stopWhen && isNum(run.data._sv)) {
        const need = st.stopWhen.need;
        const thr = Math.min(num(st.stopWhen.atLeast, 100), needCap(agent, need));
        const sv = run.data._sv;
        frac = thr > sv ? (num(agent.needs[need], 0) - sv) / (thr - sv) : 1;
      }
      if (run.duration > 0 && run.duration < 1e8) frac = Math.max(frac, run.elapsed / run.duration);
    }
    const progress = stages.length > 0 ? clamp((run.stage + clamp(frac, 0, 1)) / stages.length, 0, 1) : 0;
    out.push({
      uid: run.uid,
      label: def ? interactionLabel(eng, agent, def, run.target, run.params) : run.interactionId,
      icon: def ? def.icon : 'question',
      active: true,
      progress,
      cancellable: playerCancellable(eng, run),
      source: run.source,
    });
  }
  for (const q of agent.queue) {
    const def = eng.content.interactions[q.interactionId];
    out.push({
      uid: q.uid,
      label: def ? interactionLabel(eng, agent, def, q.target, q.params) : q.interactionId,
      icon: def ? def.icon : 'question',
      active: false,
      progress: 0,
      cancellable: !!def && q.interactionId !== ENGINE_INTERACTIONS.exitLot,
      source: q.source,
    });
  }
  return out;
}

export function objectViewOf(eng: Engine, id: string): ObjectView | null {
  const obj = typeof id === 'string' ? eng.state.objects[id] : undefined;
  if (!obj) return null;
  const def = tryObjectDef(eng, obj);
  const value = num(obj.value, 0);
  const dep = def ? clamp(num(def.depreciation, 0.15), 0, 1) : 0.15;
  const detail = sysCall<string | null>(eng, 'food', 'objectDetail', obj.id);
  return {
    id: obj.id,
    defId: obj.defId,
    name: def ? def.name : obj.defId,
    description: def ? def.description : '',
    value,
    sellValue: def && def.sellable === false ? 0 : Math.max(0, Math.round(value * (1 - dep))),
    broken: !!obj.condition.broken,
    powered: eng.ctx.powered(obj),
    inUse: obj.inUseBy.length > 0 || Object.keys(obj.reservedBy).length > 0,
    detail: typeof detail === 'string' ? detail : null,
  };
}

// ─────────────────────────────── fallbacks when systems are missing ───────────────────────────────

export function relationshipLabel(r: Relationship): string {
  if (r.married) return 'Spouse';
  if (r.engaged) return 'Fiancé(e)';
  if (r.partners) return 'Partner';
  if (r.bestFriends) return 'Best Friend';
  if (!r.met) return 'Stranger';
  if (r.friendship <= -70) return 'Nemesis';
  if (r.friendship <= -35) return 'Disliked';
  if (r.romance >= 30) return 'Crush';
  if (r.friendship >= 60) return 'Good Friend';
  if (r.friendship >= 35) return 'Friend';
  return 'Acquaintance';
}

export function relationshipsFallback(eng: Engine, agentId: string): RelationshipView[] {
  const out: RelationshipView[] = [];
  for (const r of Object.values(eng.state.relationships)) {
    if (r.a !== agentId && r.b !== agentId) continue;
    const otherId = r.a === agentId ? r.b : r.a;
    const o = eng.state.agents[otherId];
    if (!o) continue;
    out.push({
      otherId,
      name: fullName(o),
      friendship: r.friendship,
      romance: r.romance,
      label: relationshipLabel(r),
      inHousehold: isHouseholdAgent(eng, o),
      onLot: o.presence === 'onLot',
    });
  }
  out.sort((a, b) => b.friendship + b.romance - (a.friendship + a.romance) || compareIds(a.otherId, b.otherId));
  return out;
}

export function aspirationFallback(eng: Engine, agent: AgentState): AspirationView | null {
  const def = agent.aspiration ? eng.content.aspirations[agent.aspiration] : undefined;
  if (!def) return null;
  const points = num(agent.aspirationPoints, 0);
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    points,
    milestones: def.milestones.map((m) => ({ id: m.id, label: m.label, points: m.points, done: agent.aspirationMilestones.includes(m.id) })),
    rewards: Object.values(eng.content.rewards).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      cost: r.cost,
      owned: r.kind === 'trait' && !!r.traitId && agent.rewardTraits.includes(r.traitId),
      affordable: points >= r.cost,
      icon: r.icon,
    })),
  };
}

export function billsFallback(eng: Engine): BillsView {
  const tick = eng.state.tick;
  const bills = Array.isArray(eng.state.household.bills) ? eng.state.household.bills : [];
  let outstanding = 0;
  let overdue = 0;
  let nextDue: number | null = null;
  const list = bills.map((b) => {
    const paid = b.paidTick !== null;
    const od = !paid && b.dueTick < tick;
    if (!paid) {
      outstanding += b.amount;
      if (od) overdue += b.amount;
      if (nextDue === null || b.dueTick < nextDue) nextDue = b.dueTick;
    }
    return { id: b.id, amount: b.amount, dueLabel: relativeLabel(tick, b.dueTick), overdue: od, paid };
  });
  return { outstanding, overdue, nextDueLabel: nextDue === null ? null : relativeLabel(tick, nextDue), utilitiesOn: eng.state.household.utilitiesOn, bills: list };
}

function scheduleLabel(days: number[], startHour: number, hours: number): string {
  const ds = Array.isArray(days) ? days.slice().sort((a, b) => a - b) : [];
  const dayPart = ds.length === 0 ? '' : ds.length > 2 && ds[ds.length - 1] - ds[0] === ds.length - 1 ? `${WEEKDAY_SHORT[ds[0]]}–${WEEKDAY_SHORT[ds[ds.length - 1]]}` : ds.map((d) => WEEKDAY_SHORT[d]).join(', ');
  return `${dayPart} ${formatClock(startHour * 60)}, ${hours}h`.trim();
}

export function careersAvailableFallback(eng: Engine): { id: CareerId; name: string; description: string; startTitle: string; wage: number; schedule: string; icon: BubbleIcon }[] {
  return Object.values(eng.content.careers)
    .filter((c) => Array.isArray(c.levels) && c.levels.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      startTitle: c.levels[0].title,
      wage: c.levels[0].wage,
      schedule: scheduleLabel(c.levels[0].days, c.levels[0].startHour, c.levels[0].hours),
      icon: c.icon,
    }));
}

export function careerFallback(eng: Engine, agent: AgentState): CareerView | null {
  const cs = agent.career;
  if (!cs) return null;
  const def = eng.content.careers[cs.trackId];
  if (!def || !def.levels.length) return null;
  const li = clamp(Math.floor(num(cs.level, 1)), 1, def.levels.length) - 1;
  const lvl = def.levels[li];
  return {
    trackId: def.id,
    trackName: def.name,
    level: li + 1,
    title: lvl.title,
    wage: lvl.wage,
    schedule: scheduleLabel(lvl.days, lvl.startHour, lvl.hours),
    performance: num(cs.performance, 0),
    nextTitle: def.levels[li + 1] ? def.levels[li + 1].title : null,
    promoteReq: (lvl.promoteReq ?? []).map((r) => ({ skill: r.skill, level: r.level, met: skillLevel(agent, r.skill) >= r.level })),
    status: cs.shiftStatus,
    icon: def.icon,
  };
}

export function partyFallback(eng: Engine): PartyView | null {
  const p = eng.state.party;
  if (!p) return null;
  return { active: !p.ended, score: Math.round(num(p.score, 0)), endsLabel: relativeLabel(eng.state.tick, p.endTick), guests: Array.isArray(p.guestIds) ? p.guestIds.length : 0 };
}

export function towniesFallback(eng: Engine, forAgentId: string): TownieView[] {
  const out: TownieView[] = [];
  for (const a of Object.values(eng.state.agents)) {
    if (a.role !== 'townie' || a.id === forAgentId || a.presence === 'gone') continue;
    const r = eng.state.relationships[forAgentId < a.id ? `${forAgentId}|${a.id}` : `${a.id}|${forAgentId}`];
    out.push({
      id: a.id,
      name: fullName(a),
      occupation: a.occupation,
      friendship: r ? r.friendship : 0,
      romance: r ? r.romance : 0,
      met: r ? r.met : false,
      label: r ? relationshipLabel(r) : 'Stranger',
      available: a.presence === 'offLot',
    });
  }
  out.sort((x, y) => compareIds(x.id, y.id));
  return out;
}

export function lotValueFallback(eng: Engine): number {
  let v = 0;
  for (const o of Object.values(eng.state.objects)) v += num(o.value, 0);
  v += Object.keys(eng.state.lot.walls ?? {}).length * WALL_SEGMENT_PRICE;
  for (const f of Array.isArray(eng.state.lot.floors) ? eng.state.lot.floors : []) if (f) v += FLOOR_STYLE_BY_ID[f]?.price ?? 0;
  return Math.max(0, Math.round(v));
}
