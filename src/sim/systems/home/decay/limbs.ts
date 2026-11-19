/**
 * Limb loss, limb items, stitching and prosthetics (GDD §4).
 * p(loss)/h = ((50 − pres)/50)² × 0.08 × trait 'limbLoss' × (fitness ≥ 5 ? 0.5) × (strenuous ? 1.5) × (pres = 0 ? 3).
 * Limb pick: arms 35% each, legs 15% each among intact limbs (prosthetics stay screwed on).
 */
import type { SimContext } from '../../../contracts';
import type { AgentState, LimbItemData, ObjectState } from '../../../types';
import { LIMB_IDS, type LimbId } from '../../../../shared/appearance';
import { DATA, ITEM, MOOD, STAT } from '../../../content/home/ids';
import { floorPointNear } from '../services';
import {
  activeDef,
  bubble,
  clamp,
  dataBool,
  dataStr,
  firstName,
  getAgent,
  getObj,
  hasTag,
  isAsleep,
  isMember,
  isNum,
  isStrenuous,
  isZombie,
  minutesSince,
  nearAndSameRoom,
  num,
  onLotAgents,
  voice,
} from '../util';
import { traitMultSafe } from './rates';

export const LIMB_LOSS_BELOW = 50;
export const LIMB_LOSS_BASE = 0.08;
export const LIMB_ROT_MINUTES = 48 * 60;
export const WITNESS_RADIUS = 6;
export const STITCH_BASE = 0.5;
export const STITCH_PER_LEVEL = 0.06;
export const STITCH_CAP = 0.95;
export const ONE_ARM_SLOWDOWN = 1.35;

const LIMB_NAMES: Record<LimbId, string> = { armL: 'left arm', armR: 'right arm', legL: 'left leg', legR: 'right leg' };
const LAUGHERS = ['grumpy', 'partyAnimal', 'hothead'];

export function limbName(limb: LimbId): string {
  return LIMB_NAMES[limb] ?? 'limb';
}

export function isLimbId(v: unknown): v is LimbId {
  return typeof v === 'string' && (LIMB_IDS as string[]).includes(v);
}

export function ensureLimbs(agent: AgentState): AgentState['limbs'] {
  if (!agent.limbs || typeof agent.limbs !== 'object') agent.limbs = { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' };
  for (const l of LIMB_IDS) {
    const v = agent.limbs[l];
    if (v !== 'ok' && v !== 'missing' && v !== 'prosthetic') agent.limbs[l] = 'ok';
  }
  return agent.limbs;
}

export function missingLimbs(agent: AgentState): LimbId[] {
  const limbs = ensureLimbs(agent);
  return LIMB_IDS.filter((l) => limbs[l] === 'missing');
}

/** Hourly limb-loss probability for an on-lot zombie. */
export function limbLossChance(ctx: SimContext, agent: AgentState): number {
  if (!isZombie(agent) || agent.presence !== 'onLot') return 0;
  const pres = num(agent.needs?.preservation, 100);
  if (!(pres < LIMB_LOSS_BELOW)) return 0;
  let p = Math.pow((LIMB_LOSS_BELOW - Math.max(0, pres)) / LIMB_LOSS_BELOW, 2) * LIMB_LOSS_BASE;
  p *= traitMultSafe(ctx, agent, 'limbLoss');
  if (safeSkill(ctx, agent, 'fitness') >= 5) p *= 0.5;
  if (isStrenuous(ctx, agent)) p *= 1.5;
  if (pres <= 0) p *= 3;
  return clamp(isNum(p) ? p : 0, 0, 1);
}

export function safeSkill(ctx: SimContext, agent: AgentState, skill: 'cooking' | 'charisma' | 'mortuary' | 'logic' | 'creativity' | 'fitness'): number {
  try {
    return num(ctx.skillLevel(agent, skill), 0);
  } catch {
    return num(agent.skills?.[skill]?.level, 0);
  }
}

export function armCount(ctx: SimContext, agent: AgentState): number {
  try {
    return num(ctx.limbCount(agent, 'arm'), 2);
  } catch {
    const l = ensureLimbs(agent);
    return (l.armL !== 'missing' ? 1 : 0) + (l.armR !== 'missing' ? 1 : 0);
  }
}

/** Typed view of a limb item's data; null if the object isn't a valid limb item. */
export function limbData(ctx: SimContext, obj: ObjectState | null | undefined): LimbItemData | null {
  if (!obj || !hasTag(ctx, obj, 'limb')) return null;
  const limbId = obj.data?.[DATA.limbId];
  if (!isLimbId(limbId)) return null;
  return {
    limbId,
    ownerId: dataStr(obj, DATA.ownerId, ''),
    createdTick: num(obj.data?.[DATA.createdTick], ctx.state.tick),
    rotten: dataBool(obj, DATA.rotten, false),
  };
}

export function heldLimb(ctx: SimContext, agent: AgentState): ObjectState | null {
  const obj = getObj(ctx, agent.carryObjectId);
  if (!obj || obj.placement.kind !== 'held' || obj.placement.agentId !== agent.id) return null;
  return limbData(ctx, obj) ? obj : null;
}

/** Fresh limb + recipient still missing that exact limb. */
export function canReattach(ctx: SimContext, limbObj: ObjectState | null, recipient: AgentState | null): true | string {
  const info = limbData(ctx, limbObj);
  if (!info) return 'Not a limb';
  if (info.rotten) return 'This limb has gone off — beyond stitching';
  if (!recipient) return 'Its owner is gone';
  if (info.ownerId !== recipient.id) return `That isn’t ${firstName(recipient)}’s limb`;
  if (ensureLimbs(recipient)[info.limbId] !== 'missing') return `${firstName(recipient)}’s ${limbName(info.limbId)} is already attached`;
  return true;
}

/**
 * Knock a limb off an on-lot zombie. `limb` forces a specific limb (if intact); otherwise weighted random.
 * Spawns the limb item, plays the gross-out, notifies witnesses. Returns the spawned item (or null).
 */
export function loseLimb(ctx: SimContext, agent: AgentState | null, limb?: LimbId | null): ObjectState | null {
  if (!agent || !isZombie(agent) || agent.presence !== 'onLot') return null;
  const limbs = ensureLimbs(agent);
  const intact = LIMB_IDS.filter((l) => limbs[l] === 'ok');
  if (intact.length === 0) return null;
  let chosen: LimbId | null = null;
  if (limb && isLimbId(limb)) chosen = intact.includes(limb) ? limb : null;
  else chosen = intact[Math.max(0, ctx.rng.weighted(intact.map((l) => (l.startsWith('arm') ? 35 : 15))))] ?? null;
  if (!chosen) return null;

  limbs[chosen] = 'missing';
  const isArm = chosen.startsWith('arm');
  if (isArm && armCount(ctx, agent) === 0 && agent.carryObjectId) {
    try {
      ctx.releaseHeld(agent, 'floor');
    } catch {
      /* ignore */
    }
  }

  const at = floorPointNear(ctx, agent.pos);
  let item: ObjectState | null = null;
  const data: Record<string, string | number | boolean | null> = {
    [DATA.limbId]: chosen,
    [DATA.ownerId]: agent.id,
    [DATA.ownerName]: firstName(agent),
    [DATA.createdTick]: ctx.state.tick,
    [DATA.rotten]: false,
  };
  try {
    item = ctx.spawnObject(isArm ? ITEM.limbArm : ITEM.limbLeg, {
      kind: 'loose',
      x: at.x,
      z: at.z,
      y: 0,
      parentId: null,
      surfaceIndex: null,
      facing: Math.round(ctx.rng.next() * 628) / 100,
    }, { data });
  } catch {
    item = null;
  }

  ctx.emit({ type: 'fx', kind: 'limbDrop', agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
  ctx.emit({ type: 'sfx', id: 'limbDrop', agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
  ctx.addMoodlet(agent, MOOD.lostLimb, { sourceId: item ? item.id : null });
  const clumsy = ctx.hasTrait(agent, 'clumsy');
  if (clumsy) {
    ctx.addMoodlet(agent, MOOD.hilariousLimb, { sourceId: agent.id });
    voice(ctx, agent, 'laugh');
  } else {
    voice(ctx, agent, 'scream');
  }
  bubble(ctx, agent, 'limb', 'shout', false);
  reactWitnesses(ctx, agent);

  ctx.stat(STAT.limbsLost, 1);
  ctx.stat(STAT.limbsLost, 1, agent.id);
  if (isMember(ctx, agent)) {
    ctx.notify({
      kind: 'decay',
      title: `${firstName(agent)} lost a limb`,
      text: clumsy
        ? `${firstName(agent)}’s ${limbName(chosen)} fell off. They think it’s hilarious. Pick it up and stitch it back on before it rots (48 h).`
        : `${firstName(agent)}’s ${limbName(chosen)} just fell off. Pick it up and Stitch Back On at a Stitch-n-Mend Table before it rots (48 h).`,
      agentId: agent.id,
      objectId: item ? item.id : null,
    });
  }

  // Can't keep doing a two-handed job with one hand (or walking-based jobs without legs).
  const def = activeDef(ctx, agent);
  if (def && agent.active) {
    for (const r of def.requires ?? []) {
      const min = num((r.params as Record<string, unknown> | undefined)?.min, 0);
      if ((r.id === 'arms' && armCount(ctx, agent) < min) || (r.id === 'legs' && legCount(ctx, agent) < min)) {
        const reason = `Lost ${isArm ? 'an arm' : 'a leg'} mid-task`;
        try {
          // failRun tells the player why (player-sourced runs); fall back to a graceful interrupt on older engines.
          if (typeof ctx.failRun === 'function') ctx.failRun(agent, reason);
          else ctx.interrupt(agent, reason);
        } catch {
          /* ignore */
        }
        break;
      }
    }
  }
  return item;
}

export function legCount(ctx: SimContext, agent: AgentState): number {
  try {
    return num(ctx.limbCount(agent, 'leg'), 2);
  } catch {
    const l = ensureLimbs(agent);
    return (l.legL !== 'missing' ? 1 : 0) + (l.legR !== 'missing' ? 1 : 0);
  }
}

function reactWitnesses(ctx: SimContext, owner: AgentState): void {
  for (const w of onLotAgents(ctx)) {
    if (w.id === owner.id || !isZombie(w) || isAsleep(ctx, w)) continue;
    if (!nearAndSameRoom(ctx, w.pos, owner.pos, WITNESS_RADIUS)) continue;
    if (ctx.hasTrait(w, 'squeamish')) {
      ctx.addMoodlet(w, MOOD.squeamishHorror, { sourceId: owner.id });
      voice(ctx, w, 'scream');
      bubble(ctx, w, 'disgusted', 'shout', false);
    } else if (LAUGHERS.some((t) => ctx.hasTrait(w, t))) {
      ctx.addMoodlet(w, MOOD.hilariousLimb, { sourceId: owner.id });
      voice(ctx, w, 'laugh');
      bubble(ctx, w, 'joke', 'speech', true);
    } else {
      ctx.addMoodlet(w, MOOD.grossedOut, { sourceId: owner.id });
      voice(ctx, w, 'disgusted');
      bubble(ctx, w, 'disgusted', 'thought', false);
    }
  }
}

/** Hourly: mark limbs older than 48 h as rotten (they can only be thrown away). */
export function rotLimbs(ctx: SimContext): void {
  for (const o of Object.values(ctx.state.objects)) {
    if (!o || (o.defId !== ITEM.limbArm && o.defId !== ITEM.limbLeg)) continue;
    if (dataBool(o, DATA.rotten, false)) continue;
    if (minutesSince(ctx, o.data?.[DATA.createdTick]) < LIMB_ROT_MINUTES) continue;
    o.data[DATA.rotten] = true;
    o.data[DATA.flies] = true;
    ctx.markChanged(o);
    const owner = getAgent(ctx, o.data?.[DATA.ownerId]);
    if (owner && isMember(ctx, owner) && missingLimbs(owner).length > 0) {
      ctx.notify({
        kind: 'decay',
        title: 'A limb has gone off',
        text: `${firstName(owner)}’s detached ${o.defId === ITEM.limbArm ? 'arm' : 'leg'} has rotted beyond stitching. A Prosthetic Limb Crate is the only fix now.`,
        agentId: owner.id,
        objectId: o.id,
      });
    }
  }
}

export function stitchChance(ctx: SimContext, stitcher: AgentState): number {
  return clamp(STITCH_BASE + STITCH_PER_LEVEL * safeSkill(ctx, stitcher, 'mortuary'), 0, STITCH_CAP);
}

/**
 * Roll a reattachment. On success the recipient's limb is restored (`consume` = the held limb should be destroyed);
 * on failure the limb should drop to the floor and the stitcher gets Butterfingers.
 */
export function rollStitch(ctx: SimContext, stitcher: AgentState, recipient: AgentState, limbObj: ObjectState): 'success' | 'fail' | string {
  const ok = canReattach(ctx, limbObj, recipient);
  if (ok !== true) return ok;
  const info = limbData(ctx, limbObj)!;
  if (ctx.rng.chance(stitchChance(ctx, stitcher))) {
    ensureLimbs(recipient)[info.limbId] = 'ok';
    ctx.addMoodlet(recipient, MOOD.stitchedUp, { sourceId: stitcher.id });
    ctx.emit({ type: 'sfx', id: 'limbReattach', agentId: recipient.id });
    ctx.emit({ type: 'fx', kind: 'sparkle', agentId: recipient.id });
    ctx.stat(STAT.limbsReattached, 1);
    ctx.stat(STAT.limbsReattached, 1, recipient.id);
    if (ctx.hasTrait(stitcher, 'squeamish') || (recipient.id !== stitcher.id && ctx.hasTrait(recipient, 'squeamish'))) {
      const who = ctx.hasTrait(stitcher, 'squeamish') ? stitcher : recipient;
      ctx.addMoodlet(who, MOOD.squeamishHorror, { sourceId: limbObj.id });
    }
    ctx.notify({
      kind: 'good',
      title: 'Good as new(ish)',
      text:
        recipient.id === stitcher.id
          ? `${firstName(recipient)} stitched their ${limbName(info.limbId)} back on. The seams are lumpy but it wiggles.`
          : `${firstName(stitcher)} stitched ${firstName(recipient)}’s ${limbName(info.limbId)} back on. It wiggles!`,
      agentId: recipient.id,
    });
    return 'success';
  }
  ctx.addMoodlet(stitcher, MOOD.butterfingers, { sourceId: limbObj.id });
  ctx.emit({ type: 'sfx', id: 'fail', agentId: stitcher.id });
  bubble(ctx, stitcher, 'question', 'thought', false);
  ctx.notify({
    kind: 'info',
    title: 'Butterfingers',
    text: `The thread snapped and the ${limbName(info.limbId)} flopped to the floor. Try again — practice makes (almost) perfect.`,
    agentId: stitcher.id,
    objectId: limbObj.id,
  });
  return 'fail';
}

/** Fit a prosthetic on a missing limb (preferred limb if given and missing; else arms first). */
export function fitProsthetic(ctx: SimContext, agent: AgentState, prefer?: unknown): LimbId | null {
  const missing = missingLimbs(agent);
  if (missing.length === 0) return null;
  const order: LimbId[] = ['armR', 'armL', 'legR', 'legL'];
  const chosen = isLimbId(prefer) && missing.includes(prefer) ? prefer : order.find((l) => missing.includes(l)) ?? missing[0];
  ensureLimbs(agent)[chosen] = 'prosthetic';
  ctx.addMoodlet(agent, MOOD.woodenWonder);
  ctx.emit({ type: 'sfx', id: 'limbReattach', agentId: agent.id });
  ctx.emit({ type: 'fx', kind: 'sparkle', agentId: agent.id });
  ctx.stat(STAT.prosthetics, 1);
  ctx.stat(STAT.prosthetics, 1, agent.id);
  ctx.notify({
    kind: 'good',
    title: 'Wooden wonder',
    text: `${firstName(agent)} now sports a genuine pine ${limbName(chosen)}. Knock on wood — it’s right there.`,
    agentId: agent.id,
  });
  return chosen;
}
