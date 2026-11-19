/**
 * validateContent(registry, systems) — static checks over all content so typos fail tests, not players.
 * Returns human-readable problems (empty = valid).
 */
import type { ContentRegistry, EffectRef, InteractionDef, MoodletGrant, RequirementRef, SimSystem, StageDef, StageTarget } from '../contracts';
import { BUBBLE_ICONS } from '../contracts';
import { NEED_IDS, SKILL_IDS } from '../types';
import { ANIM_STATES, CARRY_ITEMS, EXPRESSIONS } from '../../shared/appearance';
import { SFX_IDS, VOICE_EMOTIONS } from '../../shared/audioIds';
import { ENGINE_BEHAVIORS, ENGINE_EFFECTS, ENGINE_REQUIREMENTS } from '../vocabulary';
import { ENGINE_INTERNAL_BEHAVIORS } from './content';
import type { EngineRegistry } from './registry';

const ANIMS = new Set<string>(ANIM_STATES);
const EXPR = new Set<string>(EXPRESSIONS);
const CARRY = new Set<string>(CARRY_ITEMS);
const SFX = new Set<string>(SFX_IDS);
const VOICE = new Set<string>(VOICE_EMOTIONS);
const ICONS = new Set<string>(BUBBLE_ICONS);
const NEEDS = new Set<string>(NEED_IDS);
const SKILLS = new Set<string>(SKILL_IDS);
const ENGINE_CONDITION_KINDS = ['always', 'never', 'funds', 'skill', 'stat', 'moodlet', 'trait', 'flag', 'and', 'or', 'not'];
const STAGE_KINDS = new Set(['target', 'nearestTag', 'seat', 'tileNear', 'agentAdjacent', 'here', 'exit']);
const TARGET_KINDS = new Set(['object', 'agent', 'self', 'tile']);

export function validateContent(registry: ContentRegistry, systems: readonly SimSystem[] = []): string[] {
  const out: string[] = [];
  const reg = registry as Partial<EngineRegistry> & ContentRegistry;
  if (Array.isArray(reg.problems)) out.push(...reg.problems);

  const effects = new Set<string>(Object.values(ENGINE_EFFECTS));
  const reqs = new Set<string>(Object.values(ENGINE_REQUIREMENTS));
  const behaviors = new Set<string>([...Object.values(ENGINE_BEHAVIORS), ...Object.values(ENGINE_INTERNAL_BEHAVIORS)]);
  const conditions = new Set<string>(ENGINE_CONDITION_KINDS);
  const sysIds = new Set<string>();
  for (const s of systems) {
    if (!s || typeof s.id !== 'string') {
      out.push('system without an id');
      continue;
    }
    if (sysIds.has(s.id)) out.push(`duplicate system id '${s.id}'`);
    sysIds.add(s.id);
    const reg2 = (kind: string, set: Set<string>, rec: Record<string, unknown> | undefined) => {
      for (const id of Object.keys(rec ?? {})) {
        if (set.has(id)) out.push(`system '${s.id}': ${kind} id '${id}' is already registered`);
        set.add(id);
      }
    };
    reg2('effect', effects, s.effects);
    reg2('requirement', reqs, s.requirements);
    reg2('behavior', behaviors, s.behaviors);
    reg2('condition', conditions, s.conditions);
  }

  const objectTags = new Set<string>();
  for (const o of Object.values(registry.objects)) for (const t of o.tags ?? []) objectTags.add(t);

  const checkEffect = (where: string, e: EffectRef | undefined) => {
    if (!e || typeof e.id !== 'string') {
      out.push(`${where}: malformed effect`);
      return;
    }
    if (!effects.has(e.id)) out.push(`${where}: unknown effect '${e.id}'`);
    const p = (e.params ?? {}) as Record<string, unknown>;
    if ((e.id === ENGINE_EFFECTS.moodlet || e.id === ENGINE_EFFECTS.removeMoodlet) && (typeof p.id !== 'string' || !registry.moodlets[p.id])) {
      out.push(`${where}: effect '${e.id}' references unknown moodlet '${String(p.id)}'`);
    }
    if (e.id === ENGINE_EFFECTS.spawnItem && (typeof p.defId !== 'string' || !registry.objects[p.defId])) {
      out.push(`${where}: spawnItem references unknown object '${String(p.defId)}'`);
    }
    if (e.id === ENGINE_EFFECTS.queue && (typeof p.interactionId !== 'string' || !registry.interactions[p.interactionId])) {
      out.push(`${where}: queue effect references unknown interaction '${String(p.interactionId)}'`);
    }
    if (e.id === ENGINE_EFFECTS.xp && (typeof p.skill !== 'string' || !SKILLS.has(p.skill))) out.push(`${where}: xp effect has unknown skill '${String(p.skill)}'`);
    if (e.id === ENGINE_EFFECTS.sfx && (typeof p.id !== 'string' || !SFX.has(p.id))) out.push(`${where}: sfx effect has unknown sfx '${String(p.id)}'`);
    if (e.id === ENGINE_EFFECTS.needs && p.deltas && typeof p.deltas === 'object') {
      for (const n of Object.keys(p.deltas)) if (!NEEDS.has(n)) out.push(`${where}: needs effect has unknown need '${n}'`);
    }
  };
  const checkReq = (where: string, r: RequirementRef | undefined) => {
    if (!r || typeof r.id !== 'string') out.push(`${where}: malformed requirement`);
    else if (!reqs.has(r.id)) out.push(`${where}: unknown requirement '${r.id}'`);
  };
  const checkGrant = (where: string, g: MoodletGrant | undefined) => {
    if (!g || typeof g.id !== 'string' || !registry.moodlets[g.id]) out.push(`${where}: unknown moodlet '${String(g && g.id)}'`);
  };
  const checkCond = (where: string, c: { kind?: unknown } | undefined) => {
    if (!c || typeof c.kind !== 'string') out.push(`${where}: malformed condition`);
    else if (!conditions.has(c.kind)) out.push(`${where}: unknown condition kind '${c.kind}'`);
  };
  const checkTarget = (where: string, t: StageTarget | undefined) => {
    if (!t || typeof t !== 'object' || !STAGE_KINDS.has((t as { kind: string }).kind)) {
      out.push(`${where}: invalid stage target`);
      return;
    }
    if (t.kind === 'nearestTag') {
      if (!objectTags.has(t.tag)) out.push(`${where}: nearestTag '${t.tag}' matches no object`);
      else if (t.slots && t.slots.length) {
        const ok = Object.values(registry.objects).some((o) => o.tags.includes(t.tag) && t.slots!.every((sid) => o.slots.some((s) => s.id === sid)));
        if (!ok) out.push(`${where}: no '${t.tag}' object has slots ${t.slots.join(', ')}`);
      }
    }
    if ((t.kind === 'seat' || t.kind === 'tileNear') && !(typeof t.radius === 'number' && t.radius > 0)) out.push(`${where}: ${t.kind} needs a positive radius`);
  };
  const checkStage = (where: string, st: StageDef) => {
    checkTarget(`${where}.target`, st.target);
    if (st.fallback) checkTarget(`${where}.fallback`, st.fallback);
    if (!(typeof st.duration === 'number' && st.duration >= 0 && Number.isFinite(st.duration))) out.push(`${where}: duration must be a finite number >= 0`);
    if (!ANIMS.has(st.anim)) out.push(`${where}: anim '${String(st.anim)}' is not in ANIM_STATES`);
    if (st.expression !== undefined && !EXPR.has(st.expression)) out.push(`${where}: unknown expression '${st.expression}'`);
    if (st.carry !== undefined && st.carry !== null && !CARRY.has(st.carry)) out.push(`${where}: unknown carry item '${st.carry}'`);
    for (const n of Object.keys(st.needsPerHour ?? {})) if (!NEEDS.has(n)) out.push(`${where}: unknown need '${n}' in needsPerHour`);
    for (const n of Object.keys(st.scaleByObjectParam ?? {})) if (!NEEDS.has(n)) out.push(`${where}: unknown need '${n}' in scaleByObjectParam`);
    for (const k of Object.keys(st.skillXpPerHour ?? {})) if (!SKILLS.has(k)) out.push(`${where}: unknown skill '${k}' in skillXpPerHour`);
    if (st.stopWhen && !NEEDS.has(st.stopWhen.need)) out.push(`${where}: stopWhen has unknown need '${st.stopWhen.need}'`);
    if (st.sfxLoop && !SFX.has(st.sfxLoop)) out.push(`${where}: unknown sfxLoop '${st.sfxLoop}'`);
    if (st.sfxStart && !SFX.has(st.sfxStart)) out.push(`${where}: unknown sfxStart '${st.sfxStart}'`);
    if (st.bubble && !ICONS.has(st.bubble)) out.push(`${where}: unknown bubble icon '${st.bubble}'`);
    if (st.voice && !VOICE.has(st.voice)) out.push(`${where}: unknown voice '${st.voice}'`);
    (st.effectsOnStart ?? []).forEach((e, i) => checkEffect(`${where}.effectsOnStart[${i}]`, e));
    (st.effectsOnComplete ?? []).forEach((e, i) => checkEffect(`${where}.effectsOnComplete[${i}]`, e));
  };

  for (const [id, def] of Object.entries(registry.interactions)) {
    const where = `interaction '${id}'`;
    if (def.id !== id) out.push(`${where}: id mismatch '${def.id}'`);
    if (!TARGET_KINDS.has(def.targetKind)) out.push(`${where}: invalid targetKind '${String(def.targetKind)}'`);
    if (!ICONS.has(def.icon)) out.push(`${where}: unknown icon '${String(def.icon)}'`);
    if (typeof def.label !== 'string' || !def.label.trim()) out.push(`${where}: missing label`);
    const bkey = typeof def.behavior === 'string' && def.behavior ? def.behavior : ENGINE_BEHAVIORS.standard;
    if (!behaviors.has(bkey)) out.push(`${where}: unknown behavior '${bkey}'`);
    const stages = registry.stagesOf(id);
    if (stages.length === 0) out.push(`${where}: has no stages`);
    stages.forEach((st, i) => checkStage(`${where} stage ${i}`, st));
    (def.requires ?? []).forEach((r, i) => checkReq(`${where}.requires[${i}]`, r));
    (def.moodletsOnComplete ?? []).forEach((g, i) => checkGrant(`${where}.moodletsOnComplete[${i}]`, g));
    for (const n of Object.keys(def.advertise ?? {})) if (!NEEDS.has(n)) out.push(`${where}: advertise has unknown need '${n}'`);
    if (def.social) {
      if (def.targetKind !== 'agent') out.push(`${where}: social interactions must target agents`);
      if (!ANIMS.has(def.social.targetAnim)) out.push(`${where}: social.targetAnim '${String(def.social.targetAnim)}' is not in ANIM_STATES`);
      if (def.social.failAnim !== undefined && !ANIMS.has(def.social.failAnim)) out.push(`${where}: social.failAnim '${def.social.failAnim}' is not in ANIM_STATES`);
      if (!VOICE.has(def.social.voice)) out.push(`${where}: social.voice '${String(def.social.voice)}' unknown`);
      if (def.social.targetVoice !== undefined && !VOICE.has(def.social.targetVoice)) out.push(`${where}: social.targetVoice '${def.social.targetVoice}' unknown`);
      (def.social.successMoodlets ?? []).forEach((g, i) => checkGrant(`${where}.social.successMoodlets[${i}]`, g));
      (def.social.failMoodlets ?? []).forEach((g, i) => checkGrant(`${where}.social.failMoodlets[${i}]`, g));
    }
    if (def.pair) {
      const p = registry.interactions[def.pair.partnerInteraction];
      if (!p) out.push(`${where}: pair partner interaction '${def.pair.partnerInteraction}' unknown`);
      else if (def.pair.partnerTarget === 'actor' && p.targetKind !== 'agent') out.push(`${where}: pair partner '${p.id}' must target an agent`);
      else if (def.pair.partnerTarget === 'sameObject' && p.targetKind !== 'object') out.push(`${where}: pair partner '${p.id}' must target an object`);
    }
    for (const k of ['recipeId', 'recipe'] as const) {
      const v = def.params ? def.params[k] : undefined;
      if (typeof v === 'string' && !registry.recipes[v]) out.push(`${where}: unknown recipe '${v}'`);
    }
    for (const t of Object.keys(def.traitAd ?? {})) if (Object.keys(registry.traits).length > 0 && !registry.traits[t]) out.push(`${where}: traitAd references unknown trait '${t}'`);
  }

  for (const [id, o] of Object.entries(registry.objects)) {
    const where = `object '${id}'`;
    for (const iid of o.interactions ?? []) {
      const def = registry.interactions[iid];
      if (!def) {
        out.push(`${where}: unknown interaction '${iid}'`);
        continue;
      }
      if (def.targetKind !== 'object') out.push(`${where}: interaction '${iid}' does not target objects`);
      for (const [i, st] of registry.stagesOf(iid).entries()) {
        const targets = [st.target, st.fallback].filter((t): t is StageTarget => !!t);
        for (const t of targets) {
          if (t.kind !== 'target' || !t.slots) continue;
          for (const sid of t.slots) if (!o.slots.some((s) => s.id === sid)) out.push(`${where}: interaction '${iid}' stage ${i} uses slot '${sid}' the object doesn't have`);
        }
      }
    }
  }

  for (const [id, m] of Object.entries(registry.moodlets)) {
    if (!ICONS.has(m.icon)) out.push(`moodlet '${id}': unknown icon '${String(m.icon)}'`);
    if (!(typeof m.maxStacks === 'number' && m.maxStacks >= 1)) out.push(`moodlet '${id}': maxStacks must be >= 1`);
    if (m.durationMin !== null && !(typeof m.durationMin === 'number' && m.durationMin >= 0)) out.push(`moodlet '${id}': invalid durationMin`);
    if (typeof m.mood !== 'number' || !Number.isFinite(m.mood)) out.push(`moodlet '${id}': mood must be a number`);
  }

  for (const [id, t] of Object.entries(registry.traits)) {
    for (const c of t.conflicts ?? []) {
      const other = registry.traits[c];
      if (!other) out.push(`trait '${id}': conflicts with unknown trait '${c}'`);
      else if (!(other.conflicts ?? []).includes(id)) out.push(`trait '${id}': conflict with '${c}' is not symmetric`);
    }
    for (const n of [...Object.keys(t.needDecay ?? {}), ...Object.keys(t.needGain ?? {})]) if (!NEEDS.has(n)) out.push(`trait '${id}': unknown need '${n}'`);
    for (const k of Object.keys(t.skillGain ?? {})) if (!SKILLS.has(k)) out.push(`trait '${id}': unknown skill '${k}'`);
  }

  for (const sk of SKILL_IDS) {
    const d = registry.skills[sk];
    if (!d) out.push(`skill '${sk}' is not defined`);
    else if (!Array.isArray(d.xpPerLevel) || d.xpPerLevel.length < 10 || !d.xpPerLevel.every((x) => typeof x === 'number' && x > 0)) out.push(`skill '${sk}': xpPerLevel must list 10 positive numbers`);
  }

  for (const [id, r] of Object.entries(registry.recipes)) {
    if (r.requiresTag && !objectTags.has(r.requiresTag)) out.push(`recipe '${id}': requiresTag '${r.requiresTag}' matches no object`);
  }

  for (const [id, c] of Object.entries(registry.careers)) {
    if (!SKILLS.has(c.skill)) out.push(`career '${id}': unknown skill '${c.skill}'`);
    if (!Array.isArray(c.levels) || c.levels.length === 0) out.push(`career '${id}': has no levels`);
    for (const [i, l] of (c.levels ?? []).entries()) for (const r of l.promoteReq ?? []) if (!SKILLS.has(r.skill)) out.push(`career '${id}' level ${i + 1}: unknown skill '${r.skill}'`);
    for (const ev of c.workEvents ?? []) for (const [i, o] of (ev.options ?? []).entries()) if (!effects.has(o.effect)) out.push(`career '${id}' event '${ev.id}' option ${i}: unknown effect '${o.effect}'`);
  }
  for (const [id, a] of Object.entries(registry.aspirations)) for (const m of a.milestones ?? []) checkCond(`aspiration '${id}' milestone '${m.id}'`, m.condition);
  for (const [id, r] of Object.entries(registry.rewards)) {
    if (r.kind === 'trait' && (!r.traitId || !registry.traits[r.traitId])) out.push(`reward '${id}': unknown trait '${String(r.traitId)}'`);
    if (r.effect) checkEffect(`reward '${id}'`, r.effect);
  }
  for (const ev of registry.lifeEvents) {
    checkCond(`lifeEvent '${ev.id}'`, ev.condition);
    if (ev.effect) checkEffect(`lifeEvent '${ev.id}'`, ev.effect);
    for (const [i, o] of (ev.choice?.options ?? []).entries()) if (!effects.has(o.effect)) out.push(`lifeEvent '${ev.id}' option ${i}: unknown effect '${o.effect}'`);
  }
  return out;
}

/** Interactions that no object offers and nothing else could reach (informational; not an error). */
export function unreachableInteractions(registry: ContentRegistry): InteractionDef[] {
  const offered = new Set<string>();
  for (const o of Object.values(registry.objects)) for (const i of o.interactions) offered.add(i);
  return Object.values(registry.interactions).filter((d) => d.targetKind === 'object' && !offered.has(d.id) && !d.hidden);
}
