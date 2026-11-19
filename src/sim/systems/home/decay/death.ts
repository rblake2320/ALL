/**
 * Crumbling, urns, reanimation and game over (GDD §4).
 * - 24 consecutive game hours at preservation 0 → crumbled (presence 'crumbled', item_bonepile, household Mourning).
 * - Reanimation Kit "Reanimate" within 72 h → back with preservation 55, vitality −15 (min 20), all limbs restored.
 * - After 72 h the pile becomes item_urn (presence 'gone').
 * - Every household member crumbled/gone → state.gameOver = true + {type:'gameOver'} ("Rest in Pieces").
 */
import type { SimContext } from '../../../contracts';
import type { AgentState, ObjectState, Vec2 } from '../../../types';
import { DATA, ITEM, MOOD, STAT } from '../../../content/home/ids';
import { floorPointNear, frontSpot } from '../services';
import { centerOf, clamp, firstName, getAgent, getObj, isAlivePresence, isNum, livingMembers, members, minutesSince, num } from '../util';
import { ensureLimbs } from './limbs';
import { setVitality, VITALITY_MAX, VITALITY_MIN } from './rates';

export const CRUMBLE_AFTER_MIN = 24 * 60;
export const REANIMATE_WINDOW_MIN = 72 * 60;
export const REANIMATE_PRESERVATION = 55;
export const REANIMATE_VITALITY_COST = 15;
export const GAME_OVER_REASON = 'Rest in Pieces';

/** The agent's status block, created with defaults if a corrupted save lost it. */
export function ensureStatus(agent: AgentState): AgentState['status'] {
  if (!agent.status || typeof agent.status !== 'object') {
    agent.status = {
      zeroPreservationMinutes: 0,
      passedOut: false,
      feral: false,
      autonomyCooldownUntil: 0,
      lastSocialTick: 0,
      autonomyFails: 0,
      bonePileId: null,
      crumbledTick: null,
    };
  }
  if (!isNum(agent.status.zeroPreservationMinutes)) agent.status.zeroPreservationMinutes = 0;
  return agent.status;
}

function spawnLoose(ctx: SimContext, defId: string, at: Vec2, data: Record<string, string | number | boolean | null>): ObjectState | null {
  const p = floorPointNear(ctx, at);
  try {
    return ctx.spawnObject(defId, { kind: 'loose', x: p.x, z: p.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data });
  } catch {
    return null;
  }
}

/** Turn a household member into a bone pile. Safe to call for any agent; no-op unless alive. */
export function crumble(ctx: SimContext, agent: AgentState | null): ObjectState | null {
  if (!agent || !isAlivePresence(agent.presence)) return null;
  const wasOnLot = agent.presence === 'onLot';
  const at: Vec2 = wasOnLot ? { x: agent.pos.x, z: agent.pos.z } : frontSpot(ctx);
  if (wasOnLot) {
    try {
      ctx.despawnAgent(agent.id, 'crumbled');
    } catch {
      /* fall through to the manual presence change */
    }
  }
  agent.presence = 'crumbled';
  agent.queue = [];
  const pile = spawnLoose(ctx, ITEM.bonePile, at, {
    [DATA.ownerId]: agent.id,
    [DATA.name]: firstName(agent),
    [DATA.crumbledTick]: ctx.state.tick,
  });
  const status = ensureStatus(agent);
  status.bonePileId = pile ? pile.id : null;
  status.crumbledTick = ctx.state.tick;
  status.zeroPreservationMinutes = 0;
  status.passedOut = false;
  ctx.removeMoodlet(agent, MOOD.fallingApart);

  ctx.emit({ type: 'fx', kind: 'crumble', pos: at, objectId: pile ? pile.id : undefined });
  ctx.emit({ type: 'sfx', id: 'crumble', pos: at });
  ctx.emit({ type: 'music', mood: 'sad' });
  ctx.stat(STAT.crumbled, 1);
  for (const m of livingMembers(ctx)) if (m.id !== agent.id) ctx.addMoodlet(m, MOOD.mourning, { sourceId: agent.id });
  ctx.notify({
    kind: 'bad',
    title: `${firstName(agent)} has crumbled`,
    text: `${firstName(agent)} fell apart completely and is now a tidy pile of bones. A Reanimation Kit can bring them back within 72 hours — after that, it’s an urn on the mantelpiece.`,
    agentId: agent.id,
    objectId: pile ? pile.id : null,
  });
  checkGameOver(ctx);
  return pile;
}

/** Hours left before a zombie sitting at freshness 0 crumbles. */
export function crumbleHoursLeft(agent: AgentState): number {
  const z = num(agent.status?.zeroPreservationMinutes, 0);
  return Math.max(0, (CRUMBLE_AFTER_MIN - z) / 60);
}

/** Hours left to reanimate a crumbled member (0 when too late / not crumbled). */
export function reanimateHoursLeft(ctx: SimContext, agent: AgentState | null): number {
  if (!agent || agent.presence !== 'crumbled' || !agent.status) return 0;
  const t = agent.status.crumbledTick;
  if (!isNum(t)) return 0;
  return Math.max(0, (REANIMATE_WINDOW_MIN - minutesSince(ctx, t)) / 60);
}

/** Crumbled members whose pile can still be reanimated. */
export function reanimatableMembers(ctx: SimContext): AgentState[] {
  return members(ctx).filter((m) => m.presence === 'crumbled' && reanimateHoursLeft(ctx, m) > 0);
}

/** Bone pile → urn after 72 h; presence 'gone'. */
export function becomeUrn(ctx: SimContext, agent: AgentState): ObjectState | null {
  if (agent.presence !== 'crumbled') return null;
  const pile = getObj(ctx, agent.status?.bonePileId);
  const at = pile ? centerOf(ctx, pile) : frontSpot(ctx);
  if (pile) ctx.removeObject(pile.id, 'The bones have turned to dust');
  const urn = spawnLoose(ctx, ITEM.urn, at, { [DATA.ownerId]: agent.id, [DATA.name]: firstName(agent), [DATA.createdTick]: ctx.state.tick });
  agent.presence = 'gone';
  if (agent.status) agent.status.bonePileId = null;
  ctx.emit({ type: 'fx', kind: 'puff', pos: at });
  ctx.notify({
    kind: 'bad',
    title: `Farewell, ${firstName(agent)}`,
    text: `${firstName(agent)}’s bones have settled into a handsome bronze urn. They’d have wanted a nicer one, but they’d also have wanted to keep their arms on.`,
    agentId: agent.id,
    objectId: urn ? urn.id : null,
  });
  checkGameOver(ctx);
  return urn;
}

/**
 * Bring a crumbled household member back. Removes the bone pile; the caller consumes the kit.
 * Returns true or a player-facing reason.
 */
export function reanimate(ctx: SimContext, agentId: unknown, by?: AgentState | null): true | string {
  const agent = getAgent(ctx, agentId);
  if (!agent) return 'Nobody here to reanimate';
  if (agent.presence !== 'crumbled') return `${firstName(agent)} isn’t a pile of bones`;
  if (reanimateHoursLeft(ctx, agent) <= 0) return 'Too late — the bones have gone to dust';
  const pile = getObj(ctx, agent.status?.bonePileId);
  const at = pile ? centerOf(ctx, pile) : frontSpot(ctx);

  setVitality(agent, clamp(num(agent.vitality, VITALITY_MAX) - REANIMATE_VITALITY_COST, VITALITY_MIN, VITALITY_MAX));
  if (agent.needs) {
    agent.needs.preservation = Math.min(REANIMATE_PRESERVATION, agent.vitality);
    for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) {
      agent.needs[n] = clamp(Math.max(num(agent.needs[n], 35), 35), 0, 100);
    }
  }
  const limbs = ensureLimbs(agent);
  limbs.armL = 'ok';
  limbs.armR = 'ok';
  limbs.legL = 'ok';
  limbs.legR = 'ok';
  if (agent.status) {
    agent.status.zeroPreservationMinutes = 0;
    agent.status.bonePileId = null;
    agent.status.crumbledTick = null;
    agent.status.passedOut = false;
    agent.status.feral = false;
  }
  ctx.removeMoodlet(agent, MOOD.fallingApart);
  if (pile) ctx.removeObject(pile.id, 'Reanimated');
  try {
    ctx.spawnAgent(agent.id, at);
  } catch {
    /* handled below */
  }
  // spawnAgent sets presence; force it if a fault barrier swallowed the spawn.
  if ((agent.presence as string) !== 'onLot') agent.presence = 'onLot';
  ctx.addMoodlet(agent, MOOD.backFromDead, { sourceId: by ? by.id : null });
  for (const m of livingMembers(ctx)) ctx.removeMoodlet(m, MOOD.mourning);
  ctx.emit({ type: 'fx', kind: 'reanimate', agentId: agent.id, pos: at });
  ctx.emit({ type: 'sfx', id: 'reanimate', pos: at });
  ctx.emit({ type: 'music', mood: 'normal' });
  ctx.stat(STAT.reanimations, 1);
  if (by) ctx.stat(STAT.reanimations, 1, by.id);
  ctx.notify({
    kind: 'good',
    title: 'IT’S ALIVE! (ish)',
    text: `${firstName(agent)} is back from the dead with a crackle of lightning — a little less vital (−${REANIMATE_VITALITY_COST} vitality) but with every limb attached.`,
    agentId: agent.id,
  });
  return true;
}

/** Sets state.gameOver once every household member is crumbled or gone. Returns the game-over state. */
export function checkGameOver(ctx: SimContext): boolean {
  if (ctx.state.gameOver) return true;
  const ms = members(ctx);
  if (ms.length === 0) return false;
  if (ms.some((m) => isAlivePresence(m.presence))) return false;
  ctx.state.gameOver = true;
  ctx.emit({ type: 'gameOver', reason: GAME_OVER_REASON });
  ctx.emit({ type: 'music', mood: 'sad' });
  ctx.notify({
    kind: 'bad',
    title: GAME_OVER_REASON,
    text: 'Every member of the household has crumbled. After all that, the lease is finally up.',
  });
  return true;
}
