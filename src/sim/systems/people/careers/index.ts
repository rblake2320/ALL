/**
 * `careers` system: shift scheduling + at-work simulation (shift.ts), the `career` behaviour driving
 * career_goToWork, the `careerChoice` effect, requirements hasCareer/noCareer/sickDayAvailable, the
 * `careerLevel` condition and the CareersApi.
 */
import type { CareersApi, CareerView, InteractionBehavior, RequirementCheck, SimContext, SimSystem } from '../../../contracts';
import type { AgentId, AgentState } from '../../../types';
import { BEHAVIOR, COND, EFFECT, REQ, SYS } from '../../../content/people/ids';
import { bubble, num, safeSkill } from '../util';
import {
  CARPOOL_ARRIVES_MIN,
  careerDefOf,
  clockLabel,
  LATE_GRACE_MIN,
  levelDefOf,
  nextShift,
  scheduleLabel,
  whenLabel,
} from './schedule';
import {
  callInSick,
  canCallInSick,
  careerChoiceEffect,
  careersDayStart,
  careersHour,
  careersTick,
  completeDeparture,
  joinCareer,
  markDeparture,
  pendingWindow,
  quitCareer,
  sanitizeCareer,
} from './shift';
import { householdMembers, makeApi, minutesToTicks } from '../util';

export const careerBehavior: InteractionBehavior = {
  available(ctx, actor) {
    return careerDefOf(ctx, actor.career) ? true : 'No job to go to';
  },
  begin(ctx, actor) {
    if (!careerDefOf(ctx, actor.career)) return 'No job to go to';
    const w = pendingWindow(ctx, actor);
    if (!w) return 'No shift right now';
    if (ctx.state.tick >= w.startTick + minutesToTicks(LATE_GRACE_MIN)) return 'Too late — the carpool left';
    return null;
  },
  startStage(ctx, actor) {
    bubble(ctx, actor.id, 'work', 'thought');
    return null;
  },
  completeStage(ctx, actor, _run, def, stage) {
    const last = ctx.content.stagesOf(def.id).length - 1;
    if (stage >= last) markDeparture(ctx, actor);
  },
  end(ctx, actor, _run, _def, outcome) {
    if (outcome === 'complete') completeDeparture(ctx, actor);
  },
};

const hasCareer: RequirementCheck = (ctx, rc, params) => (careerDefOf(ctx, rc.actor.career) ? true : typeof params?.reason === 'string' ? params.reason : 'Not employed');

const noCareer: RequirementCheck = (ctx, rc, params) => {
  const def = careerDefOf(ctx, rc.actor.career);
  if (!def || !rc.actor.career) return true;
  return typeof params?.reason === 'string' ? params.reason : `Already works as a ${levelDefOf(def, rc.actor.career.level).title}`;
};

const sickDayAvailable: RequirementCheck = (ctx, rc, params) => {
  const r = canCallInSick(ctx, rc.actor);
  return r === true ? true : typeof params?.reason === 'string' ? params.reason : r;
};

function statusText(ctx: SimContext, a: AgentState): string {
  const c = a.career!;
  const def = careerDefOf(ctx, c)!;
  const lvl = levelDefOf(def, c.level);
  const today = ctx.time.day;
  if (a.presence === 'atWork') {
    const start = num(c.shiftStartTick, ctx.state.tick);
    return `At work until ${clockLabel(start + Math.round(num(lvl.hours, 8) * 240))}`;
  }
  const next = nextShift(ctx, a);
  const nextLabel = next ? whenLabel(ctx, next.startTick) : 'not scheduled';
  if (c.lastShiftDay === today) {
    if (c.shiftStatus === 'sick') return `Called in sick today — next shift ${nextLabel}`;
    if (c.shiftStatus === 'missed') return `Missed today’s shift — next shift ${nextLabel}`;
    if (c.shiftStatus === 'done') return `Shift done — next shift ${nextLabel}`;
  }
  const w = pendingWindow(ctx, a);
  if (w) {
    const carpool = w.startTick - minutesToTicks(CARPOOL_ARRIVES_MIN);
    if (ctx.state.tick >= carpool) return 'The carpool is waiting!';
    return `Next shift ${whenLabel(ctx, w.startTick)} (carpool ${clockLabel(carpool)})`;
  }
  return `Day off — next shift ${nextLabel}`;
}

export function careerView(ctx: SimContext, agentId: AgentId): CareerView | null {
  const a = typeof agentId === 'string' ? ctx.agent(agentId) : undefined;
  if (!a || !a.career) return null;
  const def = careerDefOf(ctx, a.career);
  if (!def) return null;
  const lvl = levelDefOf(def, a.career.level);
  const next = a.career.level < def.levels.length ? levelDefOf(def, a.career.level + 1) : null;
  return {
    trackId: def.id,
    trackName: def.name,
    level: Math.min(def.levels.length, Math.max(1, Math.floor(num(a.career.level, 1)))),
    title: lvl.title,
    wage: lvl.wage,
    schedule: scheduleLabel(lvl),
    performance: Math.round(num(a.career.performance, 0)),
    nextTitle: next ? next.title : null,
    promoteReq: (lvl.promoteReq ?? []).map((r) => ({ skill: r.skill, level: r.level, met: safeSkill(ctx, a, r.skill) >= r.level })),
    status: statusText(ctx, a),
    icon: def.icon,
  };
}

export function careersAvailable(ctx: SimContext): ReturnType<CareersApi['available']> {
  return Object.values(ctx.content.careers)
    .filter((d) => d && Array.isArray(d.levels) && d.levels.length > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      startTitle: d.levels[0].title,
      wage: d.levels[0].wage,
      schedule: scheduleLabel(d.levels[0]),
      icon: d.icon,
    }));
}

export function createCareersSystem(): SimSystem {
  let current: SimContext | null = null;
  const api = makeApi(() => current, {
    view: { fn: (c, agentId: AgentId) => careerView(c, agentId), fallback: () => null },
    available: { fn: (c) => careersAvailable(c), fallback: () => [] },
    join: { fn: (c, agentId: AgentId, trackId: string) => joinCareer(c, agentId, trackId), fallback: () => 'The careers office is closed' },
    quit: { fn: (c, agentId: AgentId) => quitCareer(c, agentId), fallback: () => 'The careers office is closed' },
    callInSick: { fn: (c, agentId: AgentId) => callInSick(c, agentId), fallback: () => 'The careers office is closed' },
    nextShiftTick: {
      fn: (c, agentId: AgentId) => {
        const a = typeof agentId === 'string' ? c.agent(agentId) : undefined;
        return a ? nextShift(c, a)?.startTick ?? null : null;
      },
      fallback: () => null,
    },
  }) satisfies Record<keyof CareersApi, unknown>;
  return {
    id: SYS.careers,
    init(ctx) {
      current = ctx;
      for (const a of householdMembers(ctx)) sanitizeCareer(ctx, a);
    },
    tick(ctx, dt) {
      current = ctx;
      careersTick(ctx, dt);
    },
    hour(ctx) {
      current = ctx;
      careersHour(ctx);
    },
    dayStart(ctx, day) {
      current = ctx;
      careersDayStart(ctx, day);
    },
    behaviors: { [BEHAVIOR.career]: careerBehavior },
    effects: { [EFFECT.careerChoice]: careerChoiceEffect },
    requirements: { [REQ.hasCareer]: hasCareer, [REQ.noCareer]: noCareer, [REQ.sickDayAvailable]: sickDayAvailable },
    conditions: {
      [COND.careerLevel]: (ctx, agent, params) => {
        if (!agent || !agent.career || !careerDefOf(ctx, agent.career)) return false;
        return num(agent.career.level, 0) >= num(params?.min, 1);
      },
    },
    api,
  };
}
