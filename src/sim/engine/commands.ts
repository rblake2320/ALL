/** dispatch(Command) — validation for every Command variant; never throws (README §11). */
import { parseAutoBuy, setAutoBuy } from '../../shared/autoBuy';
import type { Command, CommandResult } from '../contracts';
import type { AgentState, SimSettings, TargetRef } from '../types';
import { NEED_IDS } from '../types';
import { MAX_PLAYER_QUEUE } from './constants';
import { isHouseholdAgent } from './agents';
import { recordFault } from './faults';
import { availability } from './menu';
import { needCap } from './needs';
import { tryObjectDef } from './objects';
import { cancelItem, queueItem } from './queue';
import { beginNext, preempt } from './runner';
import type { Engine } from './types';
import { cleanParams, errorMessage, isNum, isTargetRef } from './util';
import { agentRegion, isAgentInActiveRegion, objectRegion, spatialOfRegion, withAgentRegion, withRegion } from './regions';
import type { RegionId, WorldRouteResult } from '../../shared/world';
import { ENGINE_INTERACTIONS } from '../vocabulary';
import { isDoorOpening, knockRegionOf } from './knock';
import { ROUTE_REASON_TEXT, objectPlanTile, regionAtWorldTile, routeFor } from './worldMove';

const FAIL = (reason: string): CommandResult => ({ ok: false, reason });

function queueCommand(eng: Engine, cmd: Extract<Command, { type: 'queue' }>): CommandResult {
  const actor = typeof cmd.actorId === 'string' ? eng.state.agents[cmd.actorId] : undefined;
  if (!actor || !isHouseholdAgent(eng, actor)) return FAIL('Not in your household');
  if (actor.presence !== 'onLot') return FAIL(`${actor.firstName} isn't home`);
  // W-025 S1: a member in a dormant region is not simulated (S4 keeps every member's region live, so this only
  // guards against a damaged save). Everything below resolves in the actor's region.
  if (!isAgentInActiveRegion(eng, actor)) return FAIL(`${actor.firstName} isn't here`);
  return withAgentRegion(eng, actor, () => queueIn(eng, actor, cmd));
}

function queueIn(eng: Engine, actor: AgentState, cmd: Extract<Command, { type: 'queue' }>): CommandResult {
  const def = typeof cmd.interactionId === 'string' ? eng.content.interactions[cmd.interactionId] : undefined;
  if (!def) return FAIL('Unknown action');
  if (def.hidden || def.playerAllowed === false) return FAIL("That can't be ordered");
  if (!isTargetRef(cmd.target)) return FAIL('Invalid target');
  let target: TargetRef = { ...cmd.target } as TargetRef;
  if (target.kind === 'agent' && target.id === actor.id && def.targetKind === 'self') target = { kind: 'self' };
  if (def.targetKind !== target.kind) return FAIL('Invalid target');
  // W-025 S3: the region the target is in (null = the actor's own region: the pre-world path, unchanged)
  let away: RegionId | null = null;
  let planTile: { x: number; z: number } | null = null;
  const here = agentRegion(eng, actor);
  switch (target.kind) {
    case 'object': {
      const obj = eng.state.objects[target.id];
      const od = obj ? tryObjectDef(eng, obj) : null;
      if (!obj || !od) return FAIL("It's gone");
      const knock = def.id === ENGINE_INTERACTIONS.knock && isDoorOpening(eng, obj) && knockRegionOf(eng, obj) !== null;
      if (!knock && !od.interactions.includes(def.id)) return FAIL('Not available here');
      const r = objectRegion(eng, obj);
      if (r !== here) {
        const t = objectPlanTile(eng, obj);
        if (!t) return FAIL(ROUTE_REASON_TEXT.noPath);
        away = r;
        planTile = t;
      }
      break;
    }
    case 'agent': {
      const other = eng.state.agents[target.id];
      if (!other || other.presence !== 'onLot') return FAIL(`${other ? other.firstName : 'They'} isn't here`);
      if (other.id === actor.id) return FAIL("Can't do that to yourself");
      const r = agentRegion(eng, other);
      if (r !== here) {
        const sp = spatialOfRegion(eng, r);
        const t = sp ? sp.tileOf(other.pos) : null;
        if (!sp || !t || !sp.inBounds(t.x, t.z)) return FAIL(`${other.firstName} isn't here`);
        away = r;
        planTile = t;
      }
      break;
    }
    case 'tile': {
      const p = cmd.params && typeof cmd.params === 'object' ? (cmd.params as Record<string, unknown>) : {};
      let rid: RegionId | null = typeof p.regionId === 'string' && p.regionId.length > 0 ? p.regionId : null;
      let tx = Math.floor(target.x);
      let tz = Math.floor(target.z);
      if (rid === null && isNum(p.wx) && isNum(p.wz)) {
        // a world tile (§1.5: engine_goHere accepts params.wx / wz)
        const at = regionAtWorldTile(eng, Math.floor(p.wx), Math.floor(p.wz));
        if (!at) return routeFail({ ok: false, target: { regionId: '', x: 0, z: 0 }, reason: 'noPath' });
        rid = at.regionId;
        tx = at.x;
        tz = at.z;
      }
      if (rid !== null && rid !== here) {
        const r = routeFor(eng, actor, { regionId: rid, x: tx, z: tz });
        if (!r.result.ok) return routeFail(r.result);
        away = rid;
        planTile = { x: tx, z: tz };
        target = { kind: 'tile', x: tx, z: tz };
        break;
      }
      if (!eng.spatial.inBounds(tx, tz)) return FAIL("Can't go there");
      target = { kind: 'tile', x: tx, z: tz };
      break;
    }
    case 'self':
      break;
  }
  let route: WorldRouteResult | undefined;
  if (away !== null && planTile) {
    const r = routeFor(eng, actor, { regionId: away, x: planTile.x, z: planTile.z });
    if (!r.result.ok) return routeFail(r.result);
    route = r.result;
  }
  const playerCount = actor.queue.filter((q) => q.source === 'player').length + (actor.active && actor.active.source === 'player' ? 1 : 0);
  if (playerCount >= MAX_PLAYER_QUEUE || actor.queue.length + (actor.active ? 1 : 0) >= MAX_PLAYER_QUEUE + 2) return FAIL('Queue is full');
  const params = cleanParams(cmd.params);
  for (const k of Object.keys(params)) if (k.startsWith('_') || k === 'partnerOf') delete params[k];
  // availability is judged where the target is (its region's objects, slots and power)
  const avail = away !== null ? withRegion(eng, away, () => availability(eng, actor, def, target, params)) : availability(eng, actor, def, target, params);
  if (avail === false) return FAIL('Not available');
  if (avail !== null) return FAIL(avail);
  if (away !== null) params._wg = away;
  const qi = queueItem(eng, actor, { interactionId: def.id, target, params, source: 'player' });
  if (!qi) return FAIL('Queue is full');
  // Player orders take over autonomous activity right away.
  preempt(eng, actor);
  if (!actor.active) beginNext(eng, actor);
  return route ? { ok: true, id: String(qi.uid), route } : { ok: true, id: String(qi.uid) };
}

/** A refused world walk: the contract reason code plus its text (never a silent failure, AC-14). */
function routeFail(route: WorldRouteResult): CommandResult {
  return { ok: false, reason: route.ok ? "Can't get there" : ROUTE_REASON_TEXT[route.reason], route };
}

function setSettings(eng: Engine, s: unknown): CommandResult {
  if (!s || typeof s !== 'object') return FAIL('Invalid settings');
  const p = s as Partial<SimSettings>;
  const cur = eng.state.settings;
  const next: SimSettings = { ...cur };
  if (p.autonomy !== undefined) {
    if (p.autonomy !== 'full' && p.autonomy !== 'limited' && p.autonomy !== 'off') return FAIL('Invalid autonomy setting');
    next.autonomy = p.autonomy;
  }
  if (p.difficulty !== undefined) {
    if (p.difficulty !== 'relaxed' && p.difficulty !== 'normal' && p.difficulty !== 'grim') return FAIL('Invalid difficulty');
    next.difficulty = p.difficulty;
  }
  if (p.visitorsEnabled !== undefined) {
    if (typeof p.visitorsEnabled !== 'boolean') return FAIL('Invalid visitors setting');
    next.visitorsEnabled = p.visitorsEnabled;
  }
  eng.state.settings = next;
  return { ok: true };
}

// Control chars, zero-width / bidi overrides, BOM and angle brackets.
const UNSAFE_NAME_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff<>]', 'g');

export function sanitizeHouseholdName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(UNSAFE_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > 40) return null;
  return s;
}

function cheat(eng: Engine, code: unknown): CommandResult {
  const c = typeof code === 'string' ? code.trim().toLowerCase() : '';
  switch (c) {
    case 'graverobber':
    case 'motherlode':
      eng.ctx.earn(5000, 'Grave robbing');
      break;
    case 'freshstart':
      for (const a of eng.ctx.householdMembers()) for (const n of NEED_IDS) a.needs[n] = needCap(a, n);
      break;
    default:
      return FAIL('Unknown cheat');
  }
  eng.state.flags.cheated = true;
  eng.ctx.notify({ kind: 'info', title: 'Cheat activated', text: `"${c}" — the dead don't judge.` });
  return { ok: true };
}

export function dispatchCommand(eng: Engine, cmd: Command): CommandResult {
  try {
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { type?: unknown }).type !== 'string') return FAIL('Invalid command');
    switch (cmd.type) {
      case 'queue':
        return queueCommand(eng, cmd);
      case 'cancel': {
        const actor = typeof cmd.actorId === 'string' ? eng.state.agents[cmd.actorId] : undefined;
        if (!actor || !isHouseholdAgent(eng, actor)) return FAIL('Not in your household');
        if (!isNum(cmd.uid)) return FAIL('Nothing to cancel');
        const r = cancelItem(eng, actor, cmd.uid, 'Canceled', true);
        if (r === true) return { ok: true };
        return FAIL(typeof r === 'string' ? r : 'Nothing to cancel');
      }
      case 'build': {
        if (!cmd.cmd || typeof cmd.cmd !== 'object') return FAIL('Invalid build command');
        const r = eng.build.apply(cmd.cmd);
        return r && r.ok ? { ok: true, cost: isNum(r.cost) ? r.cost : 0, id: r.objectId } : FAIL(r && r.reason ? r.reason : "Can't build that");
      }
      case 'undo':
        return eng.build.undo() ? { ok: true } : FAIL('Nothing to undo');
      case 'redo':
        return eng.build.redo() ? { ok: true } : FAIL('Nothing to redo');
      case 'endBuildSession':
        eng.build.clearHistory();
        return { ok: true };
      case 'choice': {
        const i = eng.state.choices.findIndex((c) => c.id === cmd.choiceId);
        if (i < 0) return FAIL('That choice is gone');
        const choice = eng.state.choices[i];
        if (!isNum(cmd.option) || !Number.isInteger(cmd.option) || cmd.option < 0 || cmd.option >= choice.options.length) return FAIL('Invalid option');
        resolveChoice(eng, i, cmd.option);
        return { ok: true };
      }
      case 'setSettings':
        return setSettings(eng, cmd.settings);
      case 'buyReward': {
        const actor = typeof cmd.agentId === 'string' ? eng.state.agents[cmd.agentId] : undefined;
        if (!actor || !isHouseholdAgent(eng, actor)) return FAIL('Not in your household');
        const api = eng.ctx.sys('aspirations');
        if (typeof api.buyReward !== 'function') return FAIL('Rewards are unavailable');
        const r = api.buyReward(actor.id, cmd.rewardId);
        return r === true ? { ok: true } : FAIL(typeof r === 'string' ? r : "Can't buy that");
      }
      case 'setAutoPurchases': {
        const v = parseAutoBuy(cmd.value);
        if (!v) return FAIL('Invalid autonomous-purchase setting');
        setAutoBuy(eng.state, v);
        return { ok: true };
      }
      case 'renameHousehold': {
        const name = sanitizeHouseholdName(cmd.name);
        if (!name) return FAIL('Name must be 1–40 characters');
        eng.state.household.name = name;
        return { ok: true };
      }
      case 'markNotificationsRead':
        for (const n of eng.state.notifications) n.read = true;
        return { ok: true };
      case 'cheat':
        return cheat(eng, cmd.code);
      case 'job': {
        const api = eng.ctx.sys('jobs');
        if (typeof api.command !== 'function') return FAIL('Jobs are unavailable');
        const r = api.command(cmd);
        return r && typeof r === 'object' && r.ok === true ? { ok: true, ...(typeof r.id === 'string' ? { id: r.id } : {}) } : FAIL(typeof r === 'string' ? r : r && typeof r.reason === 'string' ? r.reason : "Can't do that");
      }
      case 'pet': {
        const api = eng.ctx.sys('pets');
        if (typeof api.command !== 'function') return FAIL('Pets are unavailable');
        const r = api.command(cmd);
        return r === true ? { ok: true } : FAIL(typeof r === 'string' ? r : "Can't do that");
      }
      case 'home': {
        const api = eng.ctx.sys('homeServices');
        if (typeof api.command !== 'function') return FAIL('Home services are unavailable');
        const r = api.command(cmd);
        return r === true ? { ok: true } : FAIL(typeof r === 'string' ? r : "Can't do that");
      }
      case 'quest': {
        const api = eng.ctx.sys('quests');
        if (typeof api.command !== 'function') return FAIL('Quests are unavailable');
        const r = api.command(cmd.action, cmd.questId);
        return r === true ? { ok: true } : FAIL(typeof r === 'string' ? r : "Can't do that");
      }
      case 'townExpand':
        return townExpand(eng);
      default:
        return FAIL('Unknown command');
    }
  } catch (e) {
    recordFault(eng, 'dispatch', e);
    return FAIL(`Something went wrong (${errorMessage(e)})`);
  }
}

/**
 * W-025 S2: unfreeze a migrated world (`town.expandPending` → false). Deterministic and journaled (a Command), so a
 * replay applies it at the same tick. Refused, changing nothing, when there is no town or it is already expanded.
 * TODO(S4): streaming evaluates tiers from the next STREAM_EVAL tick once `expandPending` is false.
 */
function townExpand(eng: Engine): CommandResult {
  const t = eng.state.town;
  if (!t || typeof t !== 'object') return FAIL('This world has no neighbourhood map');
  if (t.expandPending !== true) return FAIL('The neighbourhood is already open');
  t.expandPending = false;
  return { ok: true };
}

/** Run the chosen option's effect and remove the choice. */
export function resolveChoice(eng: Engine, index: number, option: number): void {
  const choice = eng.state.choices[index];
  if (!choice) return;
  eng.state.choices.splice(index, 1);
  const opt = choice.options[option];
  if (!opt) return;
  const actor = choice.agentId ? eng.state.agents[choice.agentId] ?? null : null;
  eng.ctx.runEffect({ id: opt.effect, params: { ...opt.params } }, { actor, run: null, def: null, stage: null, targetAgent: null, targetObject: null, choice });
}
