/**
 * Home services runtime (docs/contract-requests/home-build-system.md section 4, steps 3 and 4): the Hearth and its upgrades,
 * the Wardrobe (saved builds), the Embalming table (respec gate), the Crypt vault (stash) and, later, the Bone gate.
 *
 * Every service is a piece of WORKING FURNITURE: the command is refused unless the household has that object placed
 * (the Hearth for upgrades, the wardrobe for builds, ...). Nothing here changes a fight stat (CB-2). Deterministic: no
 * ctx.rng and no wall clock; the daily Rot Essence is a pure function of the day and the placed objects.
 */
import { buyHearthUpgrade, setProgress } from '../../../shared/homeBuild';
import { SWAP_COOLDOWN_MIN, canRespec, deleteBuild, essenceForDay, isMaterial, newWardrobe, saveBuild, stashAdd, stashTake, swapBuild, type WardrobeState } from '../../../shared/homeServices';
import type { HomeCommand, SimContext, SimSystem } from '../../contracts';
import { placedItems } from '../../spatial/homeBuildRules';
import { timeInfo } from '../../time';
import { TICK_MINUTES, type AgentState } from '../../types';
import { IX, ITEM, MOOD } from '../../content/home/ids';
import { homeBonusOf } from '../../engine/homeBonus';
import { syncMoodlet } from '../home/util';
import { HEARTH_OBJECT, SERVICE_OBJECTS } from './furniture';
import { createHomeServicesState, healHomeServicesState } from './state';
import { agentAtBuildHome, buildHomeObjects } from '../../spatial/build/region';

export const HOME_SERVICES_SYSTEM_ID = 'homeServices';

/** Ticks of the swap cooldown. */
export const SWAP_COOLDOWN_TICKS = Math.ceil(SWAP_COOLDOWN_MIN / TICK_MINUTES);

function hasObject(ctx: SimContext, defId: string): boolean {
  const objs = buildHomeObjects(ctx.state);
  for (const id in objs) if (objs[id]?.defId === defId) return true;
  return false;
}

function hasService(ctx: SimContext, service: keyof typeof SERVICE_OBJECTS): boolean {
  return SERVICE_OBJECTS[service].some((d) => hasObject(ctx, d));
}

function member(ctx: SimContext, agentId: unknown): AgentState | string {
  if (typeof agentId !== 'string') return 'Pick a zombie';
  const a = ctx.agent(agentId);
  if (!a || !ctx.state.household.memberIds.includes(agentId)) return 'That zombie is not in the household';
  if (a.presence !== 'onLot' || !agentAtBuildHome(ctx.state, a)) return `${a.firstName} is not at home`;
  return a;
}

/** The world flag a combat, raid or event system sets (true) while it runs: no build change while it is up. */
export const BUILD_LOCK_FLAG = 'home.buildLock';

/**
 * Why this zombie cannot change build right now (a fight or an event), or null. FAIL CLOSED: a world this cannot read
 * refuses. What exists on this base: the Fight Fire interaction and any burning fire (an emergency at home), a Repo Ghoul
 * on the lot, a get-together (party guests inside), and the `home.buildLock` flag for the combat and raid systems of combat-power.md, which do not exist yet
 * (nothing sets the flag today, so there is no fight to refuse; whoever lands them sets it for the length of the event).
 */
export function buildChangeBlocked(ctx: SimContext, agent: AgentState): string | null {
  try {
    if (!ctx.state || !agent) return 'Not right now.';
    if (ctx.state.flags?.[BUILD_LOCK_FLAG]) return 'Not during a fight or an event.';
    if (agent.active && agent.active.interactionId === IX.fightFire) return `${agent.firstName} is busy fighting a fire.`;
    if (hasObject(ctx, ITEM.fire)) return 'A fire is burning. Put it out first.';
    for (const id in ctx.state.agents) {
      const a = ctx.state.agents[id];
      if (!a || !agentAtBuildHome(ctx.state, a)) continue;
      if (a && a.presence === 'onLot' && a.visit?.reason === 'repo') return 'The Repo Ghoul is at the door.';
      if (a && a.presence === 'onLot' && a.visit?.reason === 'party' && a.visit.welcomed) return 'A get-together is on. Wait until it is over.';
    }
    return null;
  } catch {
    return 'Not right now.';
  }
}

function wardrobeOf(ctx: SimContext, id: string): WardrobeState {
  return ctx.state.homeServices!.wardrobe[id] ?? newWardrobe();
}

export function command(ctx: SimContext, cmd: unknown): true | string {
  if (!cmd || typeof cmd !== 'object') return "Can't do that";
  const c = cmd as HomeCommand;
  const hs = ctx.state.homeServices;
  if (!hs) return 'Home services are unavailable';
  const day = timeInfo(ctx.state.tick).day;
  switch (c.action) {
    case 'hearthBuy': {
      if (typeof c.upgradeId !== 'string') return 'Pick an upgrade';
      if (!hasObject(ctx, HEARTH_OBJECT)) return 'Place the Hearth first.';
      const r = buyHearthUpgrade(hs.hearth, c.upgradeId, ctx.state.household.utilitiesOn === true);
      if (!r.ok) return r.message;
      hs.hearth = r.state;
      ctx.emit({ type: 'sfx', id: 'milestone' });
      ctx.emit({ type: 'homeService', service: 'hearth', action: 'upgrade', recordId: c.upgradeId });
      return true;
    }
    case 'wardrobeSave':
    case 'wardrobeSwap':
    case 'wardrobeDelete': {
      if (!hasService(ctx, 'wardrobe')) return 'Place a Wardrobe first.';
      const agent = member(ctx, c.agentId);
      if (typeof agent === 'string') return agent;
      const w = wardrobeOf(ctx, agent.id);
      const r =
        c.action === 'wardrobeSave'
          ? saveBuild(w, c.name, c.payload)
          : c.action === 'wardrobeDelete'
            ? deleteBuild(w, String(c.recordId))
            : swapBuild(w, String(c.recordId), ctx.state.tick, SWAP_COOLDOWN_TICKS, buildChangeBlocked(ctx, agent));
      if (!r.ok) return r.message;
      hs.wardrobe = { ...hs.wardrobe, [agent.id]: r.state };
      if (c.action === 'wardrobeSwap') ctx.emit({ type: 'homeService', service: 'wardrobe', action: 'swap', agentId: agent.id, recordId: r.record.id });
      return true;
    }
    case 'respec': {
      if (!hasService(ctx, 'embalming')) return 'Place an Embalming Station first.';
      const agent = member(ctx, c.agentId);
      if (typeof agent === 'string') return agent;
      const ok = canRespec(hs.respecDay[agent.id] ?? null, day, buildChangeBlocked(ctx, agent));
      if (!ok.ok) return ok.message;
      hs.respecDay = { ...hs.respecDay, [agent.id]: day };
      ctx.emit({ type: 'homeService', service: 'embalming', action: 'respec', agentId: agent.id });
      return true;
    }
    case 'stashPut':
    case 'stashTake': {
      if (!hasService(ctx, 'vault')) return 'Place a Crypt Vault first.';
      if (!isMaterial(c.material)) return 'That is not something the vault keeps.';
      const r = c.action === 'stashPut' ? stashAdd(hs.stash, c.material, c.units) : stashTake(hs.stash, c.material, c.units);
      if (!r.ok) return r.message;
      hs.stash = r.state;
      return true;
    }
    default:
      return 'Unknown home action';
  }
}

/** Credit the day's Rot Essence once (a day is never paid twice, also across save and load). */
export function creditEssence(ctx: SimContext, day: number): void {
  const hs = ctx.state.homeServices;
  if (!hs || day <= hs.essenceDay) return;
  hs.essenceDay = day;
  const placed = hasObject(ctx, HEARTH_OBJECT);
  const thresholds = setProgress(placedItems(ctx.state)).reduce((n, p) => n + p.earned.length, 0);
  const gain = essenceForDay(placed, ctx.state.household.utilitiesOn === true, thresholds);
  if (gain > 0) hs.hearth = { ...hs.hearth, essence: hs.hearth.essence + gain };
}

const FEELING_MOODLET: Readonly<Record<string, string>> = { wellInterred: MOOD.homeWellInterred, cosyParlour: MOOD.homeCosyParlour, wellFed: MOOD.homeWellFed };

/** A full furniture set sends the household into the day with a feeling (a LIFE bonus): set it for each member, clear the others. */
export function applyStartOfDayFeeling(ctx: SimContext): void {
  const want = FEELING_MOODLET[homeBonusOf(ctx.state).startOfDayFeeling ?? ''] ?? null;
  for (const id of ctx.state.household?.memberIds ?? []) {
    const a = ctx.state.agents[id];
    if (!a || (a.presence !== 'onLot' && a.presence !== 'atWork')) continue;
    for (const m of Object.values(FEELING_MOODLET)) syncMoodlet(ctx, a, m, m === want);
  }
}

export function createHomeServicesSystem(): SimSystem {
  return {
    id: HOME_SERVICES_SYSTEM_ID,
    init(ctx) {
      if (ctx.state.homeServices) healHomeServicesState(ctx.state);
      else ctx.state.homeServices = createHomeServicesState();
    },
    dayStart(ctx, day) {
      creditEssence(ctx, day);
      applyStartOfDayFeeling(ctx);
    },
    api: {
      command: (cmd: unknown, ctx: SimContext) => command(ctx, cmd),
      view: (ctx: SimContext) => (ctx.state.homeServices ? JSON.parse(JSON.stringify(ctx.state.homeServices)) : null),
    },
  };
}

export const homeServicesSystem = createHomeServicesSystem();
