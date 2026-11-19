/** Needs, traits, mood, moodlets and skills (README §6). */
import type { TraitDef, MoodView } from '../contracts';
import { NEED_IDS, SKILL_IDS, SKILL_MAX_LEVEL, TICK_MINUTES } from '../types';
import type { AgentState, MoodletId, NeedId, SkillId, TraitId } from '../types';
import {
  CRITICAL_NEED,
  DIFFICULTY_DECAY,
  ENGINE_DECAYED_NEEDS,
  ENGINE_DECAY_PER_HOUR,
  MOOD_WEIGHTS,
  NEED_LABELS,
  SKILL_NAMES,
  SKILL_XP_PER_LEVEL,
  SLEEP_DECAY_MULT,
} from './constants';
import { guardSystem, recordFault } from './faults';
import type { Engine } from './types';
import { clamp, isNum, num } from './util';
import { homeNeedGainMult, homeSkillGainMult } from './homeBonus';

const NEED_SET = new Set<string>(NEED_IDS);
const SKILL_SET = new Set<string>(SKILL_IDS);

export function isNeedId(v: unknown): v is NeedId {
  return typeof v === 'string' && NEED_SET.has(v);
}
export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && SKILL_SET.has(v);
}

// ─────────────────────────────── traits ───────────────────────────────

export function traitIds(agent: AgentState): TraitId[] {
  const a = Array.isArray(agent.traits) ? agent.traits : [];
  const b = Array.isArray(agent.rewardTraits) ? agent.rewardTraits : [];
  return b.length === 0 ? a : a.concat(b);
}

export function traitDefs(eng: Engine, agent: AgentState): TraitDef[] {
  const out: TraitDef[] = [];
  for (const id of traitIds(agent)) {
    const d = eng.content.traits[id];
    if (d) out.push(d);
  }
  return out;
}

export function hasTrait(agent: AgentState, trait: TraitId): boolean {
  return traitIds(agent).includes(trait);
}

function multOver(eng: Engine, ids: readonly string[] | undefined, key: string): number {
  let m = 1;
  if (!Array.isArray(ids)) return m;
  for (let i = 0; i < ids.length; i++) {
    const t = eng.content.traits[ids[i]];
    const v = t && t.mult ? t.mult[key] : undefined;
    if (isNum(v) && v >= 0) m *= v;
  }
  return m;
}

export function traitMult(eng: Engine, agent: AgentState, key: string): number {
  return multOver(eng, agent.traits, key) * multOver(eng, agent.rewardTraits, key);
}

function gainOver(eng: Engine, ids: readonly string[] | undefined, need: NeedId, positive: boolean): number {
  let m = 1;
  if (!Array.isArray(ids)) return m;
  for (let i = 0; i < ids.length; i++) {
    const t = eng.content.traits[ids[i]];
    if (!t) continue;
    const table = positive ? t.needGain : t.needDecay;
    const v = table ? table[need] : undefined;
    if (isNum(v) && v >= 0) m *= v;
  }
  return m;
}

function gainMult(eng: Engine, agent: AgentState, need: NeedId, positive: boolean): number {
  const base = gainOver(eng, agent.traits, need, positive) * gainOver(eng, agent.rewardTraits, need, positive);
  // the home's LIFE bonuses (furniture sets, Hearth wards): faster Rest while asleep, more Fun
  return positive && (need === 'energy' || need === 'fun') ? base * homeNeedGainMult(eng.state, need, need === 'energy' && isSleepingRun(eng, agent)) : base;
}

// ─────────────────────────────── needs ───────────────────────────────

export function needCap(agent: AgentState, need: NeedId): number {
  if (need === 'preservation') return clamp(num(agent.vitality, 100), 0, 100);
  return 100;
}

/** Applies trait multipliers unless raw, clamps to [0, cap], returns the applied delta. Self-heals NaN values. */
export function changeNeed(eng: Engine, agent: AgentState, need: NeedId, delta: number, raw = false): number {
  if (!isNeedId(need) || !isNum(delta) || !agent || !agent.needs) return 0;
  const cap = needCap(agent, need);
  const cur0 = agent.needs[need];
  const cur = isNum(cur0) ? clamp(cur0, 0, cap) : Math.min(50, cap);
  let d = delta;
  if (!raw && d !== 0) d *= gainMult(eng, agent, need, d > 0);
  const next = clamp(cur + d, 0, cap);
  agent.needs[need] = next;
  return next - (isNum(cur0) ? cur0 : cur);
}

export function isSleepingRun(eng: Engine, agent: AgentState): boolean {
  const run = agent.active;
  if (!run || run.phase !== 'run') return false;
  const def = eng.content.interactions[run.interactionId];
  if (!def) return false;
  if (def.tags && def.tags.includes('sleep')) return true;
  const st = eng.content.stagesOf(def.id)[run.stage];
  return !!st && st.anim === 'sleep';
}

/** Sleep slow-down factor for a need's engine decay (1 when awake; energy never decays asleep). */
function sleepFactor(need: NeedId, sleeping: boolean): number {
  if (!sleeping) return 1;
  if (need === 'energy') return 0;
  const m = SLEEP_DECAY_MULT[need];
  return isNum(m) && m >= 0 ? m : 1;
}

/** Engine base decay for hunger/energy/social/fun/hygiene (never preservation). Asleep: SLEEP_DECAY_MULT. */
export function decayNeeds(eng: Engine, agent: AgentState, dtMin: number): void {
  const diff = DIFFICULTY_DECAY[eng.state.settings.difficulty] ?? 1;
  const sleeping = isSleepingRun(eng, agent);
  const hours = dtMin / 60;
  for (const need of ENGINE_DECAYED_NEEDS) {
    let rate = (ENGINE_DECAY_PER_HOUR[need] ?? 0) * diff * sleepFactor(need, sleeping);
    if (need === 'energy' && eng.time.isNight) rate *= traitMult(eng, agent, 'nightEnergyDecay');
    if (rate > 0) changeNeed(eng, agent, need, -rate * hours, false);
  }
}

/** Per-hour engine decay estimate for the trend view (trait multiplier and sleep slow-down included). */
export function decayRatePerHour(eng: Engine, agent: AgentState, need: NeedId): number {
  if (!ENGINE_DECAYED_NEEDS.includes(need)) return 0;
  const diff = DIFFICULTY_DECAY[eng.state.settings.difficulty] ?? 1;
  let rate = (ENGINE_DECAY_PER_HOUR[need] ?? 0) * diff * gainMult(eng, agent, need, false) * sleepFactor(need, isSleepingRun(eng, agent));
  if (need === 'energy' && eng.time.isNight) rate *= traitMult(eng, agent, 'nightEnergyDecay');
  return rate;
}

export function gainMultiplier(eng: Engine, agent: AgentState, need: NeedId, positive: boolean): number {
  return gainMult(eng, agent, need, positive);
}

export function isCritical(v: number): boolean {
  return v <= CRITICAL_NEED;
}

export function needLabel(need: NeedId): string {
  return NEED_LABELS[need];
}

// ─────────────────────────────── mood ───────────────────────────────

export function needMoodContribution(need: NeedId, value: number): number {
  const v = isNum(value) ? clamp(value, 0, 100) : 50;
  const W = MOOD_WEIGHTS[need];
  return v >= 50 ? ((v - 50) / 50) * W : -Math.pow((50 - v) / 50, 1.4) * W * 1.6;
}

function systemMoodParts(eng: Engine, agent: AgentState): { label: string; value: number }[] {
  const hit = eng.moodModCache.get(agent.id);
  if (hit && hit.tick === eng.state.tick) return hit.parts;
  const parts: { label: string; value: number }[] = [];
  for (const entry of eng.systems) {
    const fn = entry.sys.moodModifiers;
    if (!fn || entry.disabled) continue;
    guardSystem(eng, entry, 'moodModifiers', () => {
      const res = fn.call(entry.sys, eng.ctx, agent);
      if (!Array.isArray(res)) return;
      for (const p of res) {
        if (p && isNum(p.value) && p.value !== 0) parts.push({ label: String(p.label ?? 'Mood'), value: clamp(p.value, -100, 100) });
      }
    });
  }
  eng.moodModCache.set(agent.id, { tick: eng.state.tick, parts });
  return parts;
}

export function moodBreakdown(eng: Engine, agent: AgentState): { value: number; contributors: { label: string; value: number }[] } {
  const contributors: { label: string; value: number }[] = [];
  let total = 0;
  for (const need of NEED_IDS) {
    const c = needMoodContribution(need, agent.needs ? agent.needs[need] : 50);
    total += c;
    if (Math.abs(c) >= 0.5) contributors.push({ label: NEED_LABELS[need], value: Math.round(c * 10) / 10 });
  }
  for (const m of Array.isArray(agent.moodlets) ? agent.moodlets : []) {
    const def = eng.content.moodlets[m.id];
    if (!def || !isNum(def.mood)) continue;
    const v = def.mood * Math.max(1, num(m.stacks, 1));
    total += v;
    if (v !== 0) contributors.push({ label: def.label, value: v });
  }
  for (const t of traitDefs(eng, agent)) {
    if (isNum(t.baseMood) && t.baseMood !== 0) {
      total += t.baseMood;
      contributors.push({ label: t.name, value: t.baseMood });
    }
  }
  for (const p of systemMoodParts(eng, agent)) {
    total += p.value;
    contributors.push(p);
  }
  contributors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { value: clamp(total, -100, 100), contributors };
}

/** Mood value only (no contributor list) — the hot path used by systems and autonomy. */
export function mood(eng: Engine, agent: AgentState): number {
  let total = 0;
  for (const need of NEED_IDS) total += needMoodContribution(need, agent.needs ? agent.needs[need] : 50);
  const ms = agent.moodlets;
  if (Array.isArray(ms)) {
    for (let i = 0; i < ms.length; i++) {
      const def = eng.content.moodlets[ms[i].id];
      if (def && isNum(def.mood)) total += def.mood * Math.max(1, num(ms[i].stacks, 1));
    }
  }
  for (const ids of [agent.traits, agent.rewardTraits]) {
    if (!Array.isArray(ids)) continue;
    for (let i = 0; i < ids.length; i++) {
      const t = eng.content.traits[ids[i]];
      if (t && isNum(t.baseMood)) total += t.baseMood;
    }
  }
  const parts = systemMoodParts(eng, agent);
  for (let i = 0; i < parts.length; i++) total += parts[i].value;
  return clamp(total, -100, 100);
}

export function moodBand(value: number): MoodView['band'] {
  if (value <= -50) return 'miserable';
  if (value <= -15) return 'uneasy';
  if (value < 15) return 'fine';
  if (value < 50) return 'good';
  return 'great';
}

export const MOOD_BAND_LABELS: Record<MoodView['band'], string> = {
  miserable: 'Miserable',
  uneasy: 'Uneasy',
  fine: 'Fine',
  good: 'Good',
  great: 'Undead and Loving It',
};

// ─────────────────────────────── moodlets ───────────────────────────────

export function addMoodlet(
  eng: Engine,
  agent: AgentState,
  id: MoodletId,
  opts?: { sourceId?: string | null; durationMin?: number; stacks?: number },
): void {
  const def = eng.content.moodlets[id];
  if (!def) {
    recordFault(eng, 'moodlet', `unknown moodlet '${String(id)}'`);
    return;
  }
  if (!Array.isArray(agent.moodlets)) agent.moodlets = [];
  let dur: number | null = def.durationMin;
  if (opts && isNum(opts.durationMin) && opts.durationMin >= 0) dur = opts.durationMin;
  if (dur !== null) {
    dur *= traitMult(eng, agent, `moodletDuration:${id}`);
    if (!isNum(dur) || dur < 0) dur = def.durationMin ?? 0;
  }
  const tick = eng.state.tick;
  const endTick = dur === null ? null : tick + Math.max(1, Math.round(dur / TICK_MINUTES));
  const addStacks = opts && isNum(opts.stacks) && opts.stacks >= 1 ? Math.floor(opts.stacks) : 1;
  const max = Math.max(1, Math.floor(num(def.maxStacks, 1)));
  const existing = agent.moodlets.find((m) => m.id === id);
  if (existing) {
    existing.stacks = Math.min(max, Math.max(1, num(existing.stacks, 1)) + addStacks);
    existing.endTick = existing.endTick === null || endTick === null ? null : Math.max(existing.endTick, endTick);
    existing.startTick = tick;
    if (opts && opts.sourceId !== undefined) existing.sourceId = opts.sourceId;
    return;
  }
  agent.moodlets.push({ id, startTick: tick, endTick, stacks: Math.min(max, addStacks), sourceId: opts?.sourceId ?? null });
}

export function removeMoodlet(agent: AgentState, id: MoodletId): void {
  if (!Array.isArray(agent.moodlets)) return;
  const i = agent.moodlets.findIndex((m) => m.id === id);
  if (i >= 0) agent.moodlets = agent.moodlets.filter((m) => m.id !== id);
}

export function hasMoodlet(agent: AgentState, id: MoodletId): boolean {
  return Array.isArray(agent.moodlets) && agent.moodlets.some((m) => m.id === id);
}

export function expireMoodlets(eng: Engine, agent: AgentState): void {
  const list = agent.moodlets;
  if (!Array.isArray(list) || list.length === 0) return;
  const tick = eng.state.tick;
  let expired = false;
  for (const m of list) if (m.endTick !== null && m.endTick <= tick) expired = true;
  if (expired) agent.moodlets = list.filter((m) => m.endTick === null || m.endTick > tick);
}

// ─────────────────────────────── skills ───────────────────────────────

export function xpTable(eng: Engine, skill: SkillId): number[] {
  const def = eng.content.skills[skill];
  return def && Array.isArray(def.xpPerLevel) && def.xpPerLevel.length >= SKILL_MAX_LEVEL ? def.xpPerLevel : SKILL_XP_PER_LEVEL;
}

export function skillLevel(agent: AgentState, skill: SkillId): number {
  const s = agent.skills ? agent.skills[skill] : undefined;
  return s && isNum(s.level) ? clamp(Math.floor(s.level), 0, SKILL_MAX_LEVEL) : 0;
}

export function addXp(eng: Engine, agent: AgentState, skill: SkillId, xp: number): void {
  if (!isSkillId(skill) || !isNum(xp) || xp <= 0 || !agent.skills) return;
  let amount = xp * homeSkillGainMult(eng.state);
  for (const t of traitDefs(eng, agent)) {
    const m = t.skillGain ? t.skillGain[skill] : undefined;
    if (isNum(m) && m >= 0) amount *= m;
  }
  let s = agent.skills[skill];
  if (!s) s = agent.skills[skill] = { level: 0, xp: 0 };
  if (!isNum(s.level)) s.level = 0;
  if (!isNum(s.xp) || s.xp < 0) s.xp = 0;
  s.level = clamp(Math.floor(s.level), 0, SKILL_MAX_LEVEL);
  if (s.level >= SKILL_MAX_LEVEL) {
    s.xp = 0;
    return;
  }
  s.xp += amount;
  const table = xpTable(eng, skill);
  let guardLoops = 0;
  while (s.level < SKILL_MAX_LEVEL && guardLoops++ < SKILL_MAX_LEVEL + 1) {
    const need = Math.max(1, num(table[s.level], SKILL_XP_PER_LEVEL[s.level] ?? 100));
    if (s.xp < need) break;
    s.xp -= need;
    s.level++;
    onLevelUp(eng, agent, skill, s.level);
  }
  if (s.level >= SKILL_MAX_LEVEL) s.xp = 0;
}

function onLevelUp(eng: Engine, agent: AgentState, skill: SkillId, level: number): void {
  const name = eng.content.skills[skill]?.name ?? SKILL_NAMES[skill];
  eng.ctx.emit({ type: 'skillUp', agentId: agent.id, skill, level });
  eng.ctx.emit({ type: 'fx', kind: 'skillUp', agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
  eng.ctx.emit({ type: 'sfx', id: 'skillUp', agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
  eng.ctx.notify({
    kind: 'skill',
    title: `${agent.firstName} reached ${name} ${level}`,
    text: level >= SKILL_MAX_LEVEL ? `${agent.firstName} has mastered ${name}. Truly unholy talent.` : `${name} is now level ${level}.`,
    agentId: agent.id,
  });
}
