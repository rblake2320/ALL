/**
 * Decay-system behaviours: sleep, embalm / beEmbalmed, stitch / beStitched / pickUpLimb, fitProsthetic,
 * reanimate / kitReanimate, mourn, mirror. Every hook validates its inputs and fails with a reason (never throws).
 * Objects that are the run's own queued target are only removed in `end()` (removing them earlier would make the
 * engine fail the very run that is consuming them).
 */
import type { InteractionBehavior, InteractionDef, SimContext } from '../../../contracts';
import type { ActiveInteraction, AgentState } from '../../../types';
import { TICK_MINUTES } from '../../../types';
import { IX, MOOD, STAT } from '../../../content/home/ids';
import {
  defOf,
  firstName,
  getAgent,
  getObj,
  isNum,
  num,
  objectsWithTag,
  queuedObject,
  runData,
  safeDt,
  stageObject,
  str,
  targetAgent,
  targetObject,
} from '../util';
import { leisureScore, NEVER } from '../autonomy';
import { crumbleHoursLeft, reanimate, reanimatableMembers, reanimateHoursLeft } from './death';
import { armCount, canReattach, fitProsthetic, heldLimb, limbData, limbLossChance, limbName, missingLimbs, ONE_ARM_SLOWDOWN, rollStitch, safeSkill } from './limbs';
import { preservationDecayPerHour, safePowered, setVitality, traitMultSafe } from './rates';

function mode(def: InteractionDef): string {
  return str(def.params?.mode, '');
}

function isLastStage(ctx: SimContext, def: InteractionDef, stage: number): boolean {
  const n = ctx.content.stagesOf(def.id).length;
  return stage >= n - 1;
}

/** Pair partner: engine sets run.partnerId; else the queued target agent. */
function partnerOf(ctx: SimContext, run: ActiveInteraction): AgentState | null {
  return getAgent(ctx, run.partnerId) ?? targetAgent(ctx, run.target);
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// ─────────────────────────────── sleep ───────────────────────────────

export const sleepBehavior: InteractionBehavior = {
  startStage(ctx, actor, run) {
    const d = runData(run);
    const bed = stageObject(ctx, run);
    d.bedId = bed ? bed.id : null;
    if (!isNum(d.sleptMin)) d.sleptMin = 0;
    if (!isNum(d.poweredMin)) d.poweredMin = 0;
    return null;
  },
  tick(ctx, actor, run, _def, dt) {
    const d = runData(run);
    const m = safeDt(dt);
    d.sleptMin = num(d.sleptMin, 0) + m;
    const bed = getObj(ctx, d.bedId);
    const bdef = defOf(ctx, bed);
    if (bed && bdef?.needsPower && safePowered(ctx, bed)) d.poweredMin = num(d.poweredMin, 0) + m;
  },
  end(ctx, actor, run, _def, outcome) {
    const d = runData(run);
    const slept = num(d.sleptMin, 0);
    if (slept <= 0) return;
    const bed = getObj(ctx, d.bedId);
    const bdef = defOf(ctx, bed);
    const tags = bdef?.tags ?? [];
    let restful = true;
    if (slept >= 60 && tags.includes('humanBed')) {
      ctx.addMoodlet(actor, MOOD.tooFluffy, { sourceId: bed ? bed.id : null });
      restful = false;
    }
    if (slept >= 60 && tags.includes('dirtBed')) ctx.addMoodlet(actor, MOOD.sleptInDirt, { sourceId: bed ? bed.id : null });
    const energy = num(actor.needs?.energy, 0);
    if (restful && ((outcome === 'complete' && slept >= 240) || (slept >= 360 && energy >= 85))) {
      ctx.addMoodlet(actor, MOOD.wellRested);
    } else if (outcome !== 'complete' && slept >= 10 && slept < 240 && energy < 60) {
      ctx.addMoodlet(actor, MOOD.rudeAwakening);
    }
    const vitBonus = num(bdef?.params?.vitalityPerSleep, 0);
    const poweredEnough = !bdef?.needsPower || num(d.poweredMin, 0) >= slept * 0.8;
    if (vitBonus > 0 && slept >= 360 && poweredEnough) {
      const before = num(actor.vitality, 100);
      setVitality(actor, before + vitBonus);
      if (actor.vitality > before) {
        ctx.emit({ type: 'fx', kind: 'frost', agentId: actor.id });
        ctx.notify({
          kind: 'decay',
          title: 'Cryo-sleep',
          text: `${firstName(actor)} spent the night in the Cryo Sarcophagus and woke up with +${Math.round((actor.vitality - before) * 10) / 10} vitality. Frosty and fabulous.`,
          agentId: actor.id,
        });
      }
    }
  },
  adjustScore(ctx, actor, _def, target, score) {
    const bed = targetObject(ctx, target);
    const bdef = defOf(ctx, bed);
    if (!bdef) return score;
    let s = score;
    const restore = num(bdef.params?.preservationPerHour, 0);
    if (restore > 0 && (!bdef.needsPower || safePowered(ctx, bed))) {
      const pres = num(actor.needs?.preservation, 100);
      const cap = num(actor.vitality, 100);
      s += Math.max(0, cap - pres) * 0.12 * (restore / 4);
    }
    if (bdef.tags.includes('humanBed')) s -= 4;
    if (bdef.tags.includes('coffin')) s += 2;
    // Zombies keep (inverted, for Night Owls) hours: bedtime is for sleeping, daytime only when exhausted.
    const h = num(ctx.time?.hour, 12);
    const night = h >= 21 || h < 6;
    const bedtime = night !== ctx.hasTrait(actor, 'nightOwl');
    const energy = num(actor.needs?.energy, 100);
    if (bedtime) s *= 1.2;
    else if (energy > 30) s *= 0.45;
    // A 5–8 h sleep costs 25–45 hunger: eat first unless about to keel over (used to wake up feral).
    const hunger = num(actor.needs?.hunger, 100);
    if (energy > SLEEP_ANYWAY_ENERGY && hunger < SLEEP_HUNGRY_BELOW) s *= hunger < 30 ? 0.2 : 0.5;
    return s;
  },
};

/** Sleep is put off for food while hunger is below this… */
export const SLEEP_HUNGRY_BELOW = 60;
/** …unless energy is already this low. */
export const SLEEP_ANYWAY_ENERGY = 15;

// ─────────────────────────────── embalming ───────────────────────────────

function partnerInRun(ctx: SimContext, run: ActiveInteraction): AgentState | null {
  const p = partnerOf(ctx, run);
  if (!p || p.presence !== 'onLot') return null;
  if (!p.active || p.active.interactionId !== IX.beEmbalmed || p.active.phase !== 'run') return null;
  return p;
}

export const embalmBehavior: InteractionBehavior = {
  begin(ctx, actor, run, def) {
    if (mode(def) === 'other' && !partnerOf(ctx, run)) return 'Nobody to embalm';
    return null;
  },
  startStage(ctx, actor, run, def) {
    const d = runData(run);
    const dur = Math.max(1, num(run.duration, 60));
    if (mode(def) === 'other') {
      const partner = partnerOf(ctx, run);
      if (!partner) return 'Nobody to embalm';
      const total = 60 * traitMultSafe(ctx, actor, 'embalmOther');
      d.total = total;
      d.applied = 0;
      d.perMin = total / dur;
      d.partnerGainPerHour = (total / dur) * 60;
      d.partnerId = partner.id;
    } else {
      const level = safeSkill(ctx, actor, 'mortuary');
      const total = 45 * (0.7 + 0.06 * level);
      d.total = total;
      d.applied = 0;
      d.perMin = total / dur;
      d.presGainPerHour = (total / dur) * 60;
    }
    return null;
  },
  tick(ctx, actor, run, def, dt) {
    const d = runData(run);
    const total = num(d.total, 0);
    const applied = num(d.applied, 0);
    if (applied >= total) return;
    const recipient = mode(def) === 'other' ? partnerInRun(ctx, run) : actor;
    const give = Math.min(total - applied, num(d.perMin, 0) * safeDt(dt));
    if (!recipient || !(give > 0)) return;
    ctx.changeNeed(recipient, 'preservation', give);
    d.applied = applied + give;
  },
  completeStage(ctx, actor, run, def) {
    const d = runData(run);
    const other = mode(def) === 'other';
    const recipient = other ? partnerOf(ctx, run) : actor;
    const rest = num(d.total, 0) - num(d.applied, 0);
    if (recipient && rest > 0) ctx.changeNeed(recipient, 'preservation', rest);
    d.applied = num(d.total, 0);
    d.presGainPerHour = 0;
    d.partnerGainPerHour = 0;
    if (ctx.hasTrait(actor, 'squeamish')) ctx.addMoodlet(actor, MOOD.squeamishHorror, { sourceId: actor.id });
    if (!other) {
      ctx.stat(STAT.selfEmbalms, 1);
      ctx.stat(STAT.selfEmbalms, 1, actor.id);
      ctx.emit({ type: 'fx', kind: 'sparkle', agentId: actor.id });
      return;
    }
    if (!recipient) return;
    ctx.addMoodlet(recipient, MOOD.embalmed, { sourceId: actor.id });
    if (ctx.hasTrait(recipient, 'squeamish')) ctx.addMoodlet(recipient, MOOD.squeamishHorror, { sourceId: actor.id });
    ctx.stat(STAT.embalmedOthers, 1);
    ctx.stat(STAT.embalmedOthers, 1, actor.id);
    ctx.emit({ type: 'fx', kind: 'sparkle', agentId: recipient.id });
    ctx.notify({
      kind: 'decay',
      title: 'Freshly embalmed',
      text: `${firstName(actor)} embalmed ${firstName(recipient)} (+${Math.round(num(d.total, 0))} freshness). Taut skin, oiled joints, faint smell of pine.`,
      agentId: recipient.id,
    });
  },
  adjustScore(ctx, actor, def, _target, score) {
    if (mode(def) === 'other') return score;
    const pres = num(actor.needs?.preservation, 100);
    return pres < 50 ? score + (50 - pres) * 0.3 : score * 0.1;
  },
};

/** Partner half of Embalm Other — the embalmer's run applies all effects. */
export const beEmbalmedBehavior: InteractionBehavior = {};

// ─────────────────────────────── stitching ───────────────────────────────

export const stitchBehavior: InteractionBehavior = {
  startStage(ctx, actor, run, def, stage) {
    if (!isLastStage(ctx, def, stage)) return null; // the grab stage of "Stitch Back On" from the limb item
    const limb = heldLimb(ctx, actor);
    const recipient = mode(def) === 'other' ? partnerOf(ctx, run) : actor;
    const ok = canReattach(ctx, limb, recipient);
    if (ok !== true) return ok;
    if (armCount(ctx, actor) === 1) run.duration = Math.max(1, num(run.duration, 25) * ONE_ARM_SLOWDOWN);
    runData(run).limbObjId = limb ? limb.id : null;
    return null;
  },
  completeStage(ctx, actor, run, def, stage) {
    const d = runData(run);
    if (!isLastStage(ctx, def, stage)) {
      const obj = queuedObject(ctx, run);
      if (obj && obj.placement.kind === 'loose') ctx.holdItem(actor, obj);
      return;
    }
    const limb = getObj(ctx, d.limbObjId) ?? heldLimb(ctx, actor);
    const recipient = mode(def) === 'other' ? partnerOf(ctx, run) : actor;
    if (!limb || !recipient) return;
    d.result = rollStitch(ctx, actor, recipient, limb);
  },
  end(ctx, actor, run, _def, outcome) {
    const d = runData(run);
    const limb = heldLimb(ctx, actor);
    if (!limb) return;
    if (d.result === 'success') ctx.releaseHeld(actor, 'destroy');
    else if (d.result === 'fail' || outcome !== 'complete') ctx.releaseHeld(actor, 'floor');
  },
};

/** Partner half of Stitch Other. */
export const beStitchedBehavior: InteractionBehavior = {};

export const pickUpLimbBehavior: InteractionBehavior = {
  completeStage(ctx, actor, run, def) {
    const obj = queuedObject(ctx, run);
    if (!obj) return;
    if (obj.placement.kind === 'loose') ctx.holdItem(actor, obj);
    if (def.params?.then !== 'stitchOther') return;
    const owner = getAgent(ctx, limbData(ctx, obj)?.ownerId);
    if (owner && owner.presence === 'onLot' && owner.id !== actor.id) {
      ctx.queue(actor, { interactionId: IX.stitchOther, target: { kind: 'agent', id: owner.id }, source: run.source, front: true });
    }
  },
  label(ctx, _actor, def, target) {
    if (def.params?.then !== 'stitchOther') return def.label;
    const obj = targetObject(ctx, target);
    const owner = getAgent(ctx, limbData(ctx, obj)?.ownerId);
    const name = owner ? firstName(owner) : str(obj?.data?.ownerName, '');
    return name ? `Reattach to ${name}` : def.label;
  },
};

export const fitProstheticBehavior: InteractionBehavior = {
  choices(_ctx, actor) {
    return missingLimbs(actor).map((l) => ({ label: capitalize(limbName(l)), params: { limb: l }, available: true as const, cost: null, icon: 'limb' as const }));
  },
  completeStage(ctx, actor, run) {
    runData(run).fitted = fitProsthetic(ctx, actor, run.params?.limb);
  },
  end(ctx, _actor, run, _def, outcome) {
    if (outcome !== 'complete' || !runData(run).fitted) return;
    const crate = queuedObject(ctx, run);
    if (crate) ctx.removeObject(crate.id, 'Prosthetic fitted');
  },
  adjustScore(ctx, actor, _def, _target, score) {
    // Don't burn a $250 crate while the zombie's own fresh limb is lying around waiting to be stitched back on.
    return reattachableOwnLimbs(ctx, actor).length > 0 ? NEVER : score;
  },
};

/** Fresh limb items on the lot that belong to `agent` and fit one of its missing slots. */
export function reattachableOwnLimbs(ctx: SimContext, agent: AgentState): string[] {
  const missing = missingLimbs(agent);
  if (missing.length === 0) return [];
  return objectsWithTag(ctx, 'limb')
    .filter((o) => {
      const info = limbData(ctx, o);
      return !!info && !info.rotten && info.ownerId === agent.id && missing.includes(info.limbId);
    })
    .map((o) => o.id);
}

// ─────────────────────────────── death & grief ───────────────────────────────

export const reanimateBehavior: InteractionBehavior = {
  begin(ctx, _actor, run) {
    const pile = queuedObject(ctx, run);
    if (!pile) return 'The bones are gone';
    const owner = getAgent(ctx, pile.data?.ownerId);
    if (!owner) return 'These bones belong to nobody you know';
    if (reanimateHoursLeft(ctx, owner) <= 0) return 'Too late — the bones have gone to dust';
    runData(run).ownerId = owner.id;
    return null;
  },
  startStage(ctx, _actor, run, def, stage) {
    const d = runData(run);
    if (!isLastStage(ctx, def, stage)) {
      const kit = stageObject(ctx, run);
      d.kitId = kit ? kit.id : null;
      return null;
    }
    if (!getObj(ctx, d.kitId) && objectsWithTag(ctx, 'reanimationKit').length === 0) return 'The Reanimation Kit is gone';
    return null;
  },
  completeStage(ctx, _actor, run, def, stage) {
    if (isLastStage(ctx, def, stage)) runData(run).ready = true;
  },
  end(ctx, actor, run, _def, outcome) {
    const d = runData(run);
    if (outcome !== 'complete' || !d.ready) return;
    const res = reanimate(ctx, d.ownerId, actor);
    if (res !== true) {
      ctx.notify({ kind: 'bad', title: 'Reanimation fizzled', text: res, agentId: actor.id });
      return;
    }
    const kit = getObj(ctx, d.kitId) ?? objectsWithTag(ctx, 'reanimationKit')[0] ?? null;
    if (kit) ctx.removeObject(kit.id, 'Used up');
  },
};

export const kitReanimateBehavior: InteractionBehavior = {
  choices(ctx) {
    return reanimatableMembers(ctx).map((m) => ({
      label: `${firstName(m)} (${Math.ceil(reanimateHoursLeft(ctx, m))} h left)`,
      params: { agentId: m.id },
      available: getObj(ctx, m.status?.bonePileId) ? (true as const) : 'Their bones are missing',
      cost: null,
      icon: 'skull' as const,
    }));
  },
  begin(ctx, _actor, run) {
    const wanted = getAgent(ctx, run.params?.agentId);
    const target = wanted && reanimateHoursLeft(ctx, wanted) > 0 ? wanted : reanimatableMembers(ctx)[0] ?? null;
    if (!target) return 'Nobody to reanimate';
    if (!getObj(ctx, target.status?.bonePileId)) return 'Their bones are missing';
    runData(run).agentId = target.id;
    return null;
  },
  completeStage(ctx, actor, run) {
    const m = getAgent(ctx, runData(run).agentId);
    const pile = getObj(ctx, m?.status?.bonePileId);
    if (!pile) return;
    ctx.queue(actor, { interactionId: IX.reanimate, target: { kind: 'object', id: pile.id }, source: run.source, front: true });
  },
};

const MIN_TICKS_60 = Math.round(60 / TICK_MINUTES);
const MIN_TICKS_720 = Math.round(720 / TICK_MINUTES);

export const mournBehavior: InteractionBehavior = {
  completeStage(ctx, actor, _run, def) {
    const m = mode(def);
    if (m !== 'pile' && m !== 'urn') return;
    // Grief work: each mourning session takes 12 h off Mourning (never below 1 h left).
    const ml = Array.isArray(actor.moodlets) ? actor.moodlets.find((x) => x.id === MOOD.mourning) : undefined;
    if (ml && isNum(ml.endTick)) ml.endTick = Math.max(ctx.state.tick + MIN_TICKS_60, ml.endTick - MIN_TICKS_720);
    ctx.addMoodlet(actor, MOOD.cathartic);
  },
  adjustScore(ctx, actor, def, _target, score) {
    const m = mode(def);
    if ((m === 'pile' || m === 'urn') && ctx.hasMoodlet(actor, MOOD.mourning)) return leisureScore(ctx, actor, def, score + 12);
    return leisureScore(ctx, actor, def, score);
  },
};

// ─────────────────────────────── mirror ───────────────────────────────

/** Player-facing freshness report (Check Freshness). */
export function freshnessReport(ctx: SimContext, agent: AgentState): string {
  const pres = Math.round(num(agent.needs?.preservation, 0));
  const vit = Math.round(num(agent.vitality, 100));
  const rate = preservationDecayPerHour(ctx, agent);
  const parts: string[] = [`Freshness ${pres} / ${vit} (vitality is the ceiling).`];
  parts.push(rate > 0 ? `Losing about ${rate.toFixed(1)} per hour right now.` : 'Not decaying right now.');
  const missing = missingLimbs(agent);
  const wooden = (['armL', 'armR', 'legL', 'legR'] as const).filter((l) => agent.limbs?.[l] === 'prosthetic');
  if (missing.length > 0) parts.push(`Missing: ${missing.map(limbName).join(', ')}.`);
  else parts.push('All limbs present and accounted for.');
  if (wooden.length > 0) parts.push(`Wooden: ${wooden.map(limbName).join(', ')}.`);
  if (pres <= 0) {
    parts.push(`FALLING APART — crumbles in about ${Math.max(0, Math.ceil(crumbleHoursLeft(agent)))} h unless freshness goes up.`);
  } else if (pres < 50) {
    parts.push(`Limb-loss risk: ${(limbLossChance(ctx, agent) * 100).toFixed(1)}% per hour.`);
  } else if (rate > 0) {
    parts.push(`Limbs should stay on for ~${Math.floor((pres - 50) / rate)} more hours.`);
  }
  return parts.join(' ');
}

export const mirrorBehavior: InteractionBehavior = {
  adjustScore(ctx, actor, def, _target, score) {
    // Even the vainest zombie gets bored of their reflection for a few hours.
    if (mode(def) === 'admire' && (ctx.hasMoodlet(actor, MOOD.lookingGood) || ctx.hasMoodlet(actor, MOOD.mirrorShock))) return score * 0.1;
    return leisureScore(ctx, actor, def, score);
  },
  completeStage(ctx, actor, _run, def) {
    const m = mode(def);
    if (m === 'admire') {
      const pres = num(actor.needs?.preservation, 50);
      ctx.addMoodlet(actor, pres >= 50 ? MOOD.lookingGood : MOOD.mirrorShock);
    } else if (m === 'check') {
      ctx.notify({ kind: 'decay', title: `${firstName(actor)}’s freshness check`, text: freshnessReport(ctx, actor), agentId: actor.id });
    }
  },
};
