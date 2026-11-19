/**
 * Careers runtime (GDD §10): joining/quitting, per-day shift scheduling, carpool, departure, the at-work
 * simulation (needs drift — the engine does not touch away agents), pay (idempotent per agent+day), daily
 * performance, promotion, firing, missed shifts, sick days and mid-shift work events.
 */
import type { CareerDef, EffectHandler, SimContext } from '../../../contracts';
import type { AgentId, AgentState, CareerState, NeedId } from '../../../types';
import { ENGINE_INTERACTIONS, PRIORITY } from '../../../vocabulary';
import { CAREER_IDS, HOME_SYS, MOODLET as M, STAT } from '../../../content/people/ids';
import { checkMilestones } from '../aspirations';
import {
  bubble,
  cancelAll,
  clamp,
  delFlag,
  difficultyDecay,
  difficultyPreservation,
  firstName,
  flagNum,
  fullName,
  fx,
  grantMoodlet,
  hasQueued,
  householdMembers,
  isHousehold,
  isNum,
  isSleeping,
  minutesToTicks,
  needOf,
  num,
  pickOne,
  round1,
  safeMood,
  safeSkill,
  setFlag,
  sfx,
  TICKS_PER_HOUR,
  traitMult,
  voice,
} from '../util';
import { entryPoints } from '../townies/visitorOps';
import {
  CARPOOL_ARRIVES_MIN,
  CARPOOL_NOTICE_MIN,
  careerDefOf,
  clockLabel,
  isWorkday,
  LATE_GRACE_MIN,
  levelDefOf,
  MAX_SICK_DAYS,
  nextShift,
  shiftWindow,
  whenLabel,
  type ShiftWindow,
} from './schedule';

/**
 * GDD §10 needs per hour while away at work (decays scale with difficulty). Amusement −2 (was −4) is the backlog balance lever "careers' away-rate
 * for fun" (sim-people H2 / backlog #12): at −4 a day-job worker came home at Amusement ~0 and slept the evening away
 * below 15 (29 % of their on-lot hours in 4-day probes); at −2 it is 0 % across 5 seeds. Rest −5 (was −6) is the 21-day
 * balance pass (docs/BALANCE.md): at −6 a worker still came home at Rest ~25 and went straight to bed bored (7 % in one
 * of five 21-day runs); at −5 there is time for an evening TV session first.
 */
export const AWAY_RATES: Partial<Record<NeedId, number>> = { hunger: -4, energy: -5, fun: -2, social: 3, hygiene: -3 };
export const WORK_EVENT_CHANCE = 0.25;
export const WORK_EVENT_EXPIRE_MIN = 120;
export const MISSED_PENALTY = 25;
export const SICK_PENALTY = 5;
export const FIRE_AT = -80;
export const MISSED_STREAK_FIRE = 3;
export const PROMOTE_AT = 100;
export const PROMOTED_RESET = 20;
export const START_PERFORMANCE = 20;
const REQUEUE_COOLDOWN_MIN = 10;

const K = {
  notified: (id: AgentId) => `car:notified:${id}`,
  honked: (id: AgentId) => `car:honked:${id}`,
  requeue: (id: AgentId) => `car:requeue:${id}`,
  arrive: (id: AgentId) => `car:arrive:${id}`,
  pen: (id: AgentId) => `car:pen:${id}`,
  event: (id: AgentId) => `car:event:${id}`,
  departing: (id: AgentId) => `car:departing:${id}`,
  capNote: (id: AgentId) => `car:capNote:${id}`,
};
export const CARPOOL_FLAG = 'carpool:until';

function clearShiftFlags(ctx: SimContext, id: AgentId): void {
  for (const k of [K.arrive(id), K.pen(id), K.event(id), K.departing(id)]) delFlag(ctx, k);
}

export function freshCareer(trackId: string): CareerState {
  return {
    trackId,
    level: 1,
    performance: START_PERFORMANCE,
    daysAtLevel: 0,
    missedStreak: 0,
    lastShiftDay: -1,
    shiftStatus: 'none',
    shiftStartTick: null,
    moodSum: 0,
    moodSamples: 0,
    sickDaysUsed: 0,
  };
}

/** Repair a loaded/corrupted CareerState in place; drops careers whose track no longer exists. */
export function sanitizeCareer(ctx: SimContext, a: AgentState): CareerDef | null {
  const c = a.career;
  if (!c) return null;
  const def = careerDefOf(ctx, c);
  if (!def) {
    a.career = null;
    return null;
  }
  c.level = clamp(Math.floor(num(c.level, 1)), 1, def.levels.length);
  c.performance = clamp(num(c.performance, START_PERFORMANCE), -100, 100);
  c.daysAtLevel = Math.max(0, Math.floor(num(c.daysAtLevel, 0)));
  c.missedStreak = Math.max(0, Math.floor(num(c.missedStreak, 0)));
  c.lastShiftDay = Math.floor(num(c.lastShiftDay, -1));
  c.moodSum = num(c.moodSum, 0);
  c.moodSamples = Math.max(0, Math.floor(num(c.moodSamples, 0)));
  c.sickDaysUsed = clamp(Math.floor(num(c.sickDaysUsed, 0)), 0, MAX_SICK_DAYS);
  if (c.shiftStartTick !== null && !isNum(c.shiftStartTick)) c.shiftStartTick = null;
  const statuses: CareerState['shiftStatus'][] = ['none', 'pending', 'atWork', 'done', 'missed', 'sick'];
  if (!statuses.includes(c.shiftStatus)) c.shiftStatus = 'none';
  if (c.shiftStatus === 'atWork' && a.presence !== 'atWork') c.shiftStatus = 'done';
  return def;
}

/** Today's shift if it hasn't been resolved (worked / missed / sick) yet. */
export function pendingWindow(ctx: SimContext, a: AgentState): ShiftWindow | null {
  const c = a.career;
  const def = careerDefOf(ctx, c);
  if (!c || !def) return null;
  const today = ctx.time.day;
  if (c.lastShiftDay === today) return null;
  return shiftWindow(levelDefOf(def, c.level), today);
}

// ───────────────────────────── join / quit / sick ─────────────────────────────

export function joinCareer(ctx: SimContext, agentId: AgentId, trackId: string): true | string {
  const a = typeof agentId === 'string' ? ctx.agent(agentId) : undefined;
  if (!a) return 'Unknown zombie';
  if (!isHousehold(ctx, a)) return 'Only household members can take a job';
  if (a.presence === 'crumbled' || a.presence === 'gone') return 'Too dead to work, even for retail';
  const def = typeof trackId === 'string' ? ctx.content.careers[trackId] : undefined;
  if (!def || !Array.isArray(def.levels) || def.levels.length === 0) return 'No such career';
  const existing = careerDefOf(ctx, a.career);
  if (existing && a.career) return `Already works as ${levelDefOf(existing, a.career.level).title} — quit first`;
  const c = freshCareer(def.id);
  a.career = c;
  const lvl = def.levels[0];
  const today = ctx.time.day;
  const w = shiftWindow(lvl, today);
  if (w && ctx.state.tick > w.startTick - minutesToTicks(CARPOOL_NOTICE_MIN)) {
    c.lastShiftDay = today; // too late for today's carpool: start tomorrow-ish
    c.shiftStatus = 'none';
  } else c.shiftStatus = w ? 'pending' : 'none';
  grantMoodlet(ctx, a, M.newJob);
  const next = nextShift(ctx, a);
  ctx.notify({
    kind: 'career',
    title: 'New job!',
    text: `${firstName(a)} joined ${def.name} as a ${lvl.title} ($${lvl.wage}/h). First shift: ${next ? whenLabel(ctx, next.startTick) : 'soon'}.`,
    agentId: a.id,
  });
  return true;
}

export function quitCareer(ctx: SimContext, agentId: AgentId): true | string {
  const a = typeof agentId === 'string' ? ctx.agent(agentId) : undefined;
  if (!a) return 'Unknown zombie';
  const def = careerDefOf(ctx, a.career);
  if (!a.career || !def) return 'Not employed';
  if (a.presence === 'atWork') return 'Can’t quit while at work';
  const title = levelDefOf(def, a.career.level).title;
  a.career = null;
  cancelAll(ctx, a, CAREER_IDS.goToWork, 'Quit the job');
  clearShiftFlags(ctx, a.id);
  grantMoodlet(ctx, a, M.quitJob);
  ctx.notify({ kind: 'career', title: 'Quit!', text: `${firstName(a)} quit being a ${title} at ${def.name}. They took a stapler.`, agentId: a.id });
  return true;
}

export function canCallInSick(ctx: SimContext, a: AgentState): true | string {
  const c = a.career;
  if (!c || !careerDefOf(ctx, c)) return 'Not employed';
  if (num(c.sickDaysUsed, 0) >= MAX_SICK_DAYS) return 'No sick days left this week';
  const w = pendingWindow(ctx, a);
  if (!w) return 'No shift to skip today';
  if (ctx.state.tick >= w.startTick + minutesToTicks(LATE_GRACE_MIN)) return 'Too late — the shift already started';
  return true;
}

export function callInSick(ctx: SimContext, agentId: AgentId): true | string {
  const a = typeof agentId === 'string' ? ctx.agent(agentId) : undefined;
  if (!a) return 'Unknown zombie';
  if (a.presence !== 'onLot') return `${firstName(a)} isn’t home`;
  const ok = canCallInSick(ctx, a);
  if (ok !== true) return ok;
  const c = a.career!;
  const w = pendingWindow(ctx, a)!;
  c.shiftStatus = 'sick';
  c.lastShiftDay = w.day;
  c.sickDaysUsed = num(c.sickDaysUsed, 0) + 1;
  c.performance = clamp(num(c.performance, 0) - SICK_PENALTY, -100, 100);
  cancelAll(ctx, a, CAREER_IDS.goToWork, 'Called in sick');
  grantMoodlet(ctx, a, M.playingHooky);
  const left = MAX_SICK_DAYS - c.sickDaysUsed;
  ctx.notify({ kind: 'career', title: 'Called in sick', text: `${firstName(a)} called in sick. *Cough cough.* Very convincing. (${left} sick day${left === 1 ? '' : 's'} left this week)`, agentId: a.id });
  return true;
}

// ───────────────────────────── firing / promotion ─────────────────────────────

export function fire(ctx: SimContext, a: AgentState, why: string): void {
  const def = careerDefOf(ctx, a.career);
  const title = def && a.career ? levelDefOf(def, a.career.level).title : 'job';
  a.career = null;
  cancelAll(ctx, a, CAREER_IDS.goToWork, 'Fired');
  clearShiftFlags(ctx, a.id);
  grantMoodlet(ctx, a, M.fired);
  ctx.stat(STAT.firings, 1, null);
  ctx.stat(STAT.firings, 1, a.id);
  sfx(ctx, 'sadSting', { agentId: a.id });
  ctx.notify({ kind: 'career', title: 'Fired!', text: `${fullName(a)} was fired from their ${title} position${def ? ` at ${def.name}` : ''}. ${why}`, agentId: a.id });
}

function promote(ctx: SimContext, a: AgentState, def: CareerDef): void {
  const c = a.career!;
  c.level = Math.min(def.levels.length, c.level + 1);
  c.performance = PROMOTED_RESET;
  c.daysAtLevel = 0;
  delFlag(ctx, K.capNote(a.id));
  const lvl = levelDefOf(def, c.level);
  grantMoodlet(ctx, a, M.promoted);
  ctx.stat(STAT.promotions, 1, null);
  ctx.stat(STAT.promotions, 1, a.id);
  ctx.emit({ type: 'promotion', agentId: a.id, level: c.level, title: lvl.title });
  sfx(ctx, 'promotion', { agentId: a.id });
  if (a.presence === 'onLot') fx(ctx, 'confetti', { agentId: a.id });
  ctx.notify({ kind: 'career', title: 'Promoted!', text: `${firstName(a)} is now a ${lvl.title} at ${def.name}! New wage: $${lvl.wage}/h.`, agentId: a.id });
  checkMilestones(ctx, a.id);
}

/** Promotion (performance ≥ 100 + requirements) and firing (≤ −80 or 3 missed in a row). */
export function reviewPerformance(ctx: SimContext, a: AgentState): void {
  const c = a.career;
  const def = careerDefOf(ctx, c);
  if (!c || !def) return;
  if (c.missedStreak >= MISSED_STREAK_FIRE) return fire(ctx, a, 'Three no-shows in a row. Even the undead are expected to show up.');
  if (c.performance <= FIRE_AT) return fire(ctx, a, 'Performance had sunk lower than six feet.');
  if (c.performance < PROMOTE_AT) return;
  c.performance = PROMOTE_AT;
  if (c.level >= def.levels.length) return;
  const lvl = levelDefOf(def, c.level);
  const missing = (lvl.promoteReq ?? []).filter((r) => safeSkill(ctx, a, r.skill) < r.level);
  if (missing.length === 0) return promote(ctx, a, def);
  if (flagNum(ctx, K.capNote(a.id), -1) !== c.level) {
    setFlag(ctx, K.capNote(a.id), c.level);
    const need = missing.map((r) => `${ctx.content.skills[r.skill]?.name ?? r.skill} ${r.level}`).join(' and ');
    ctx.notify({ kind: 'career', title: 'Ready for promotion', text: `${firstName(a)} is ready for a promotion but needs ${need} first.`, agentId: a.id });
  }
}

// ───────────────────────────── departure ─────────────────────────────

function honk(ctx: SimContext, a: AgentState, w: ShiftWindow): void {
  const pts = entryPoints(ctx);
  const curb = pts[0];
  sfx(ctx, 'carpoolHonk', { pos: { x: curb.x, z: curb.z } });
  fx(ctx, 'puff', { pos: { x: curb.x, z: curb.z } });
  setFlag(ctx, CARPOOL_FLAG, Math.max(flagNum(ctx, CARPOOL_FLAG, 0), w.startTick + minutesToTicks(LATE_GRACE_MIN)));
  bubble(ctx, a.id, 'work', 'thought');
}

function ensureGoToWork(ctx: SimContext, a: AgentState, w: ShiftWindow): void {
  if (hasQueued(a, CAREER_IDS.goToWork)) return;
  const now = ctx.state.tick;
  if (now - flagNum(ctx, K.requeue(a.id), -1e12) < minutesToTicks(REQUEUE_COOLDOWN_MIN)) return;
  setFlag(ctx, K.requeue(a.id), now);
  if (isSleeping(ctx, a) && a.active && a.active.interactionId !== ENGINE_INTERACTIONS.passOut && !a.status?.passedOut) {
    ctx.interrupt(a, 'The carpool is here!');
    bubble(ctx, a.id, 'exclamation', 'shout');
    voice(ctx, a.id, 'yawn', 1200);
  }
  ctx.queue(a, { interactionId: CAREER_IDS.goToWork, target: { kind: 'self' }, params: { shiftDay: w.day }, source: 'system', priority: PRIORITY.system, front: true });
}

/** Called when career_goToWork reaches the lot exit (completeStage). */
export function markDeparture(ctx: SimContext, a: AgentState): void {
  const c = a.career;
  const def = careerDefOf(ctx, c);
  if (!c || !def) return;
  const w = pendingWindow(ctx, a);
  if (!w) return;
  const now = ctx.state.tick;
  if (now >= w.startTick + minutesToTicks(LATE_GRACE_MIN)) {
    missShift(ctx, a, w, 'The carpool gave up and left.', true);
    return;
  }
  const lvl = levelDefOf(def, c.level);
  c.shiftStatus = 'atWork';
  c.lastShiftDay = w.day;
  c.shiftStartTick = w.startTick;
  c.moodSum = safeMood(ctx, a);
  c.moodSamples = 1;
  const pen = (needOf(a, 'preservation') < 30 ? 1 : 0) | (needOf(a, 'hygiene') < 20 ? 2 : 0);
  setFlag(ctx, K.pen(a.id), pen);
  setFlag(ctx, K.arrive(a.id), now);
  if (ctx.rng.chance(WORK_EVENT_CHANCE) && def.workEvents.length > 0) {
    const shiftMin = Math.max(60, Math.round(num(lvl.hours, 8) * 60));
    const at = Math.max(now, w.startTick) + minutesToTicks(60 + Math.floor(ctx.rng.next() * Math.max(1, shiftMin - 120)));
    setFlag(ctx, K.event(a.id), at);
  } else delFlag(ctx, K.event(a.id));
  if (num(ctx.statValue(STAT.shiftsWorked, a.id), 0) <= 0 && c.level === 1) grantMoodlet(ctx, a, M.firstDayJitters);
  setFlag(ctx, K.departing(a.id), w.day);
  setFlag(ctx, CARPOOL_FLAG, now + minutesToTicks(2));
}

/** Called from the behaviour's end('complete'): actually leave the lot (re-entrancy safe in the engine). */
export function completeDeparture(ctx: SimContext, a: AgentState): void {
  if (!isNum(flagNum(ctx, K.departing(a.id), NaN))) return;
  delFlag(ctx, K.departing(a.id));
  if (a.presence === 'onLot' && a.career?.shiftStatus === 'atWork') ctx.despawnAgent(a.id, 'atWork');
}

export function missShift(ctx: SimContext, a: AgentState, w: ShiftWindow, why: string, keepActive = false): void {
  const c = a.career;
  const def = careerDefOf(ctx, c);
  if (!c || !def) return;
  c.shiftStatus = 'missed';
  c.lastShiftDay = w.day;
  c.performance = clamp(num(c.performance, 0) - MISSED_PENALTY, -100, 100);
  c.missedStreak = num(c.missedStreak, 0) + 1;
  if (keepActive) {
    for (const q of a.queue.slice()) if (q.interactionId === CAREER_IDS.goToWork) ctx.cancel(a, q.uid, 'Missed the carpool');
  } else cancelAll(ctx, a, CAREER_IDS.goToWork, 'Missed the carpool');
  clearShiftFlags(ctx, a.id);
  ctx.stat(STAT.shiftsMissed, 1, a.id);
  ctx.notify({ kind: 'career', title: 'Missed work', text: `${firstName(a)} missed today’s shift at ${def.name}. ${why} (performance −${MISSED_PENALTY})`, agentId: a.id });
  reviewPerformance(ctx, a);
}

// ───────────────────────────── at work ─────────────────────────────

function preservationHandledByDecay(ctx: SimContext): boolean {
  // HOME's `decay` system owns preservation for every living zombie (incl. atWork). If it is missing we keep the
  // GDD "preservation normal" promise ourselves so freshness never freezes while away.
  const api = ctx.sys(HOME_SYS.decay);
  return !!api && Object.keys(api).length > 0;
}

function driftAtWork(ctx: SimContext, a: AgentState, dtMin: number): void {
  const hours = num(dtMin, 0) / 60;
  if (!(hours > 0)) return;
  const diff = difficultyDecay(ctx);
  for (const [need, rate] of Object.entries(AWAY_RATES) as [NeedId, number][]) {
    const r = rate < 0 ? rate * diff : rate;
    ctx.changeNeed(a, need, r * hours);
  }
  if (!preservationHandledByDecay(ctx)) {
    const rate = 1.3 * difficultyPreservation(ctx) * traitMult(ctx, a, 'decay');
    ctx.changeNeed(a, 'preservation', -rate * hours, { raw: true });
  }
}

function offerWorkEvent(ctx: SimContext, a: AgentState, def: CareerDef): void {
  const ev = pickOne(ctx, def.workEvents);
  if (!ev || !Array.isArray(ev.options) || ev.options.length === 0) return;
  const safe = ev.options.findIndex((o) => o && o.params && o.params.safe === true);
  ctx.offerChoice({
    title: `${firstName(a)} at work: ${ev.title}`,
    text: ev.text,
    agentId: a.id,
    options: ev.options.map((o) => ({ label: o.label, effect: o.effect, params: { ...(o.params ?? {}), agentId: a.id, careerId: def.id }, tooltip: o.tooltip ?? null })),
    expiresTick: ctx.state.tick + minutesToTicks(WORK_EVENT_EXPIRE_MIN),
    defaultOption: safe >= 0 ? safe : 0,
  });
  sfx(ctx, 'notify');
}

export function endShift(ctx: SimContext, a: AgentState): void {
  const c = a.career;
  const def = careerDefOf(ctx, c);
  if (!c || !def) {
    if (a.presence === 'atWork') ctx.spawnAgent(a.id);
    return;
  }
  const lvl = levelDefOf(def, c.level);
  const now = ctx.state.tick;
  const start = isNum(c.shiftStartTick) ? c.shiftStartTick : now - Math.round(num(lvl.hours, 8) * TICKS_PER_HOUR);
  const shiftTicks = Math.max(1, Math.round(num(lvl.hours, 8) * TICKS_PER_HOUR));
  const arrived = flagNum(ctx, K.arrive(a.id), start);
  const worked = clamp(start + shiftTicks - Math.max(arrived, start), 0, shiftTicks);
  const pay = Math.max(0, Math.round(num(lvl.wage, 0) * num(lvl.hours, 8) * (worked / shiftTicks)));
  ctx.earn(pay, `${lvl.title} wages`, `career:pay:${a.id}:${c.lastShiftDay}`);

  const moodAvg = c.moodSamples > 0 ? c.moodSum / c.moodSamples : safeMood(ctx, a);
  const req = Math.max(1, num(lvl.promoteReq?.[0]?.level, num(def.levels[Math.max(0, c.level - 2)]?.promoteReq?.[0]?.level, 1)));
  const ratio = clamp(safeSkill(ctx, a, def.skill) / req, 0, 4);
  let gain = 8 + moodAvg / 10 + 2 * ratio;
  if (gain > 0) gain *= traitMult(ctx, a, 'careerPerf');
  const pen = flagNum(ctx, K.pen(a.id), 0);
  const notes: string[] = [];
  if (pen & 1) {
    gain -= 10;
    notes.push('Coworkers complained about the smell.');
  }
  if (pen & 2) {
    gain -= 6;
    notes.push('Someone left an anonymous bar of soap on their desk.');
  }
  if (arrived > start + minutesToTicks(5)) {
    gain -= 3;
    notes.push('Showed up late.');
  }
  const delta = round1(gain);
  c.performance = clamp(num(c.performance, 0) + delta, -100, 100);
  c.daysAtLevel = num(c.daysAtLevel, 0) + 1;
  c.missedStreak = 0;
  c.shiftStatus = 'done';
  c.shiftStartTick = null;
  c.moodSum = 0;
  c.moodSamples = 0;
  clearShiftFlags(ctx, a.id);
  ctx.stat(STAT.shiftsWorked, 1, null);
  ctx.stat(STAT.shiftsWorked, 1, a.id);
  ctx.stat(STAT.wagesEarned, pay, null);
  ctx.stat(STAT.wagesEarned, pay, a.id);

  if (a.presence === 'atWork') ctx.spawnAgent(a.id);
  if (delta >= 15) grantMoodlet(ctx, a, M.goodDayAtWork);
  else if (delta <= 3) grantMoodlet(ctx, a, M.badDayAtWork);
  ctx.notify({
    kind: 'money',
    title: `${firstName(a)} is home from work`,
    text: `Earned $${pay} as a ${lvl.title}. Performance ${delta >= 0 ? '+' : ''}${delta}.${notes.length ? ' ' + notes.join(' ') : ''}`,
    agentId: a.id,
  });
  reviewPerformance(ctx, a);
}

// ───────────────────────────── drivers ─────────────────────────────

function scheduleOnLot(ctx: SimContext, a: AgentState): void {
  const c = a.career!;
  const w = pendingWindow(ctx, a);
  const now = ctx.state.tick;
  const today = ctx.time.day;
  if (!w) {
    if (c.lastShiftDay !== today && c.shiftStatus !== 'none') c.shiftStatus = 'none';
    return;
  }
  if (c.shiftStatus !== 'pending') c.shiftStatus = 'pending';
  if (now >= w.startTick + minutesToTicks(LATE_GRACE_MIN)) {
    if (a.active?.interactionId === CAREER_IDS.goToWork && a.active.phase !== 'route') return; // finishing up at the exit
    missShift(ctx, a, w, 'They never got in the carpool.');
    return;
  }
  const noticeAt = w.startTick - minutesToTicks(CARPOOL_NOTICE_MIN);
  const carpoolAt = w.startTick - minutesToTicks(CARPOOL_ARRIVES_MIN);
  if (now >= noticeAt && flagNum(ctx, K.notified(a.id), -1) !== w.day) {
    setFlag(ctx, K.notified(a.id), w.day);
    if (now < carpoolAt) {
      const def = careerDefOf(ctx, c)!;
      ctx.notify({ kind: 'career', title: 'Carpool soon', text: `The ${def.name} carpool picks up ${firstName(a)} at ${clockLabel(carpoolAt)}.`, agentId: a.id });
      sfx(ctx, 'carpoolHonk', { volume: 0.4 });
    }
  }
  if (now >= carpoolAt) {
    if (flagNum(ctx, K.honked(a.id), -1) !== w.day) {
      setFlag(ctx, K.honked(a.id), w.day);
      honk(ctx, a, w);
    }
    ensureGoToWork(ctx, a, w);
  }
}

function tickAtWork(ctx: SimContext, a: AgentState, dtMin: number): void {
  const c = a.career;
  const def = careerDefOf(ctx, c);
  if (!c || !def) {
    ctx.spawnAgent(a.id); // job vanished while away: come home
    return;
  }
  if (c.shiftStatus !== 'atWork') c.shiftStatus = 'atWork';
  if (!isNum(c.shiftStartTick)) c.shiftStartTick = ctx.state.tick;
  driftAtWork(ctx, a, dtMin);
  const evAt = flagNum(ctx, K.event(a.id), NaN);
  if (isNum(evAt) && ctx.state.tick >= evAt) {
    delFlag(ctx, K.event(a.id));
    offerWorkEvent(ctx, a, def);
  }
  const lvl = levelDefOf(def, c.level);
  if (ctx.state.tick >= c.shiftStartTick + Math.round(num(lvl.hours, 8) * TICKS_PER_HOUR)) endShift(ctx, a);
}

export function careersTick(ctx: SimContext, dtMin: number): void {
  for (const a of householdMembers(ctx)) {
    if (!a.career) {
      if (a.presence === 'atWork') ctx.spawnAgent(a.id);
      continue;
    }
    if (!careerDefOf(ctx, a.career)) {
      sanitizeCareer(ctx, a);
      continue;
    }
    if (a.presence === 'atWork') tickAtWork(ctx, a, dtMin);
    else if (a.presence === 'onLot') scheduleOnLot(ctx, a);
    else {
      // crumbled / away: excuse the shift quietly once its carpool time passes
      const w = pendingWindow(ctx, a);
      if (w && ctx.state.tick >= w.startTick - minutesToTicks(CARPOOL_ARRIVES_MIN)) {
        a.career.lastShiftDay = w.day;
        a.career.shiftStatus = 'sick';
      }
    }
  }
}

export function careersHour(ctx: SimContext): void {
  for (const a of householdMembers(ctx)) {
    const c = a.career;
    if (!c || a.presence !== 'atWork') continue;
    c.moodSum = num(c.moodSum, 0) + safeMood(ctx, a);
    c.moodSamples = num(c.moodSamples, 0) + 1;
  }
}

export function careersDayStart(ctx: SimContext, day: number): void {
  const monday = (((day - 1) % 7) + 7) % 7 === 0;
  for (const a of householdMembers(ctx)) {
    const def = sanitizeCareer(ctx, a);
    const c = a.career;
    if (!c || !def) continue;
    if (monday) c.sickDaysUsed = 0;
    if (a.presence === 'atWork') continue;
    if (c.lastShiftDay !== day) c.shiftStatus = isWorkday(levelDefOf(def, c.level), day) ? 'pending' : 'none';
  }
}

// ───────────────────────────── work-event effect ─────────────────────────────

const NEED_KEYS: NeedId[] = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'preservation'];

/** `careerChoice` — see EFFECT.careerChoice in content/people/ids.ts for the param shape. */
export const careerChoiceEffect: EffectHandler = (ctx, ec, params) => {
  const p = params && typeof params === 'object' ? params : {};
  const id = typeof p.agentId === 'string' ? p.agentId : ec?.choice?.agentId ?? null;
  const a = ec?.actor ?? (id ? ctx.agent(id) : undefined);
  if (!a) return;
  const gamble = isNum(p.chance);
  const win = gamble ? ctx.rng.chance(clamp(p.chance, 0, 1)) : true;
  const val = (key: string): unknown => (win ? p[key] : p[`fail${key[0].toUpperCase()}${key.slice(1)}`]);
  const title = ec?.choice?.title ?? 'Work';

  const perf = val('perf');
  if (isNum(perf) && a.career) a.career.performance = clamp(num(a.career.performance, 0) + perf, -100, 100);
  const funds = val('funds');
  const key = `careerChoice:${ec?.choice?.id ?? `${a.id}:${ctx.state.tick}`}:funds`;
  let broke = false;
  if (isNum(funds) && funds > 0) ctx.earn(funds, title, key);
  else if (isNum(funds) && funds < 0 && !ctx.spend(-funds, title, key)) broke = true;
  for (const n of NEED_KEYS) {
    const v = val(n);
    if (isNum(v) && v !== 0) ctx.changeNeed(a, n, v, n === 'preservation' ? { raw: true } : undefined);
  }
  const xp = val('xp');
  if (isNum(xp) && xp > 0) {
    const def = careerDefOf(ctx, a.career) ?? (typeof p.careerId === 'string' ? ctx.content.careers[p.careerId] : undefined);
    const skill = typeof p.skill === 'string' ? p.skill : def?.skill;
    if (skill && skill in a.skills) ctx.addXp(a, skill as keyof AgentState['skills'], xp);
  }
  const moodlet = val('moodlet');
  if (typeof moodlet === 'string') grantMoodlet(ctx, a, moodlet);
  const text = val('text');
  if (typeof text === 'string' && text) {
    const good = !gamble || win;
    ctx.notify({ kind: good ? 'career' : 'bad', title: `${firstName(a)}: ${title.replace(/^.*?: /, '')}`, text: broke ? `${text} (Couldn’t afford it, though.)` : text, agentId: a.id });
  }
  if (a.career && a.presence !== 'atWork') reviewPerformance(ctx, a);
};
