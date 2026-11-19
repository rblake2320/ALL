/** Interaction menus (README §11). */
import type { InteractionDef, MenuEntry } from '../contracts';
import type { AgentState, TargetRef } from '../types';
import { isHouseholdAgent } from './agents';
import { behaviorOf, callHook } from './behaviors';
import { interactionLabel } from './labels';
import { objectName, resolveSlotsSafe, slotFree, tryObjectDef } from './objects';
import { checkStartable } from './runner';
import { socialGate } from './socialGate';
import { engagesTarget, targetBusyReason } from './socials';
import { stageNeedsPower, stagePowerReason } from './stages';
import type { Engine } from './types';
import { cleanParams, humanize, isNum, isTargetRef, withArticle } from './util';
import { agentRegion, objectRegion, scopeRegion, withAgentRegion, withRegion } from './regions';
import { ENGINE_INTERACTIONS } from '../vocabulary';
import { isDoorOpening, knockRegionOf } from './knock';
import { objectPlanTile, routeFor, ROUTE_REASON_TEXT } from './worldMove';

function visible(def: InteractionDef | undefined): def is InteractionDef {
  return !!def && !def.hidden && def.playerAllowed !== false;
}

/** Why the object can't host this interaction right now (all slots taken / no power), or null. */
export function objectBusyReason(eng: Engine, actor: AgentState, def: InteractionDef, target: TargetRef): string | null {
  const first = eng.content.stagesOf(def.id)[0];
  if (first && first.target && first.target.kind === 'nearestTag') {
    const tag = first.target.tag;
    const here = scopeRegion(eng);
    const cands = Object.values(eng.state.objects).filter((o) => !o.condition.broken && o.placement.kind !== 'held' && objectRegion(eng, o) === here && !!tryObjectDef(eng, o)?.tags.includes(tag));
    if (cands.length === 0) return `Needs ${withArticle(humanize(tag))}`;
    // stage resolution skips objects that need power while it is out (explicit stage.power or ObjectDef.needsPower)
    if (!eng.state.household.utilitiesOn && cands.every((o) => stageNeedsPower(eng, first, o))) return 'The power is out';
  }
  if (target.kind !== 'object') return null;
  const obj = eng.state.objects[target.id];
  if (!obj) return "It's gone";
  const st0 = eng.content.stagesOf(def.id)[0];
  if (!st0 || !st0.target) return null;
  const t0 = st0.target;
  // same notion as Resolution.aboutTarget: the stage happens at the queued object (seat facing / near it, tile near it)
  const aboutTarget =
    t0.kind === 'target' || (t0.kind === 'seat' && (t0.near === 'target' || t0.facingTarget === true)) || (t0.kind === 'tileNear' && t0.of === 'target');
  const pr = stagePowerReason(eng, st0, aboutTarget ? obj : null);
  if (pr) return pr;
  if (t0.kind !== 'target') return null;
  if (obj.placement.kind === 'held') return obj.placement.agentId === actor.id ? null : 'Someone else has it';
  // stage resolution refuses burning objects; say so up front instead of failing after the click
  if (obj.condition && obj.condition.burning) return `The ${objectName(eng, obj).toLowerCase()} is on fire!`;
  const want = t0.slots;
  const slots = resolveSlotsSafe(eng, obj).filter((s) => !want || want.length === 0 || want.includes(s.id));
  if (slots.length > 0 && slots.every((s) => !slotFree(eng, obj, s.index, actor.id))) return 'In use';
  return null;
}

/** Availability of (def, target) for the actor: null = available, string = reason, false = hide entirely. */
export function availability(eng: Engine, actor: AgentState, def: InteractionDef, target: TargetRef, params: Record<string, string | number | boolean> = {}): string | null | false {
  const isSocial = !!def.social && target.kind === 'agent';
  const r = checkStartable(eng, actor, def, { target, params });
  if (r !== true) return isSocial ? false : r;
  if (target.kind === 'agent') {
    const other = eng.state.agents[target.id];
    if (!other || other.presence !== 'onLot') return false;
    if (isSocial) {
      const g = socialGate(eng, actor, other, def);
      if (!g.ok) return g.hide ? false : g.reason;
    }
    if ((isSocial && engagesTarget(eng, def)) || def.pair) {
      const b = targetBusyReason(eng, actor, other);
      if (b) return b;
    }
  }
  const busy = objectBusyReason(eng, actor, def, target);
  if (busy) return busy;
  if (isNum(def.cost) && def.cost > eng.state.household.funds) return `Can't afford ($${Math.round(def.cost)})`;
  return null;
}

function entryFor(eng: Engine, actor: AgentState, def: InteractionDef, target: TargetRef): MenuEntry | null {
  const params: Record<string, string | number | boolean> = {};
  const avail = availability(eng, actor, def, target, params);
  if (avail === false) return null;
  const entry: MenuEntry = {
    interactionId: def.id,
    label: interactionLabel(eng, actor, def, target, params),
    group: typeof def.group === 'string' ? def.group : null,
    icon: def.icon,
    available: avail === null,
    reason: avail,
    cost: isNum(def.cost) ? def.cost : null,
    params,
  };
  const beh = behaviorOf(eng, def);
  if (beh && beh.choices) {
    const r = callHook(eng, def, 'choices', () => beh.choices!(eng.ctx, actor, def, target));
    if (!r.threw && Array.isArray(r.value)) {
      const children: MenuEntry[] = [];
      for (const c of r.value) {
        if (!c || typeof c.label !== 'string') continue;
        let reason: string | null = c.available === true ? null : typeof c.available === 'string' && c.available ? c.available : 'Not available';
        if (!reason && isNum(c.cost) && c.cost > eng.state.household.funds) reason = `Can't afford ($${Math.round(c.cost)})`;
        if (!reason && !entry.available) reason = entry.reason;
        children.push({
          interactionId: def.id,
          label: c.label,
          group: null,
          icon: c.icon ?? def.icon,
          available: reason === null,
          reason,
          cost: isNum(c.cost) ? c.cost : null,
          params: cleanParams(c.params),
        });
      }
      entry.children = children;
      if (entry.available && children.length > 0 && !children.some((c) => c.available)) {
        entry.available = false;
        entry.reason = children[0].reason;
      }
    }
  }
  return entry;
}

export function buildMenu(eng: Engine, actorId: string, target: TargetRef): MenuEntry[] {
  const actor = eng.state.agents[actorId];
  return actor ? withAgentRegion(eng, actor, () => buildMenuIn(eng, actorId, target)) : [];
}

function buildMenuIn(eng: Engine, actorId: string, target: TargetRef): MenuEntry[] {
  const actor = typeof actorId === 'string' ? eng.state.agents[actorId] : undefined;
  if (!actor || actor.presence !== 'onLot' || !isHouseholdAgent(eng, actor) || !isTargetRef(target)) return [];
  let t: TargetRef = target;
  if (t.kind === 'agent' && t.id === actor.id) t = { kind: 'self' };
  let defs: InteractionDef[] = [];
  const all = Object.values(eng.content.interactions);
  switch (t.kind) {
    case 'tile':
      if (!eng.spatial.inBounds(Math.floor(t.x), Math.floor(t.z))) return [];
      t = { kind: 'tile', x: Math.floor(t.x), z: Math.floor(t.z) };
      defs = all.filter((d) => d.targetKind === 'tile');
      break;
    case 'self':
      defs = all.filter((d) => d.targetKind === 'self');
      break;
    case 'agent': {
      const other = eng.state.agents[t.id];
      if (!other || other.presence !== 'onLot') return [];
      defs = all.filter((d) => d.targetKind === 'agent');
      break;
    }
    case 'object': {
      const obj = eng.state.objects[t.id];
      const od = obj ? tryObjectDef(eng, obj) : null;
      if (!obj || !od) return [];
      defs = od.interactions.map((id) => eng.content.interactions[id]).filter((d): d is InteractionDef => !!d && d.targetKind === 'object');
      // W-025 S3: the door of a neighbour's house offers Knock (never a door of the home: knockRegionOf is null there)
      const knock = eng.content.interactions[ENGINE_INTERACTIONS.knock];
      if (knock && isDoorOpening(eng, obj) && knockRegionOf(eng, obj) !== null) defs = [...defs, knock];
      break;
    }
  }
  const out: MenuEntry[] = [];
  const here = agentRegion(eng, actor);
  const obj = t.kind === 'object' ? eng.state.objects[t.id] : undefined;
  const other = t.kind === 'agent' ? eng.state.agents[t.id] : undefined;
  const region = obj ? objectRegion(eng, obj) : other ? agentRegion(eng, other) : here;
  const away = region !== here;
  const tile = obj ? objectPlanTile(eng, obj) : other ? { regionId: region, x: Math.floor(other.pos.x), z: Math.floor(other.pos.z) } : null;
  const route = away && tile ? routeFor(eng, actor, tile).result : null;
  const routeReason = away && !tile ? ROUTE_REASON_TEXT.noPath : route && !route.ok ? ROUTE_REASON_TEXT[route.reason] : null;
  const seen = new Set<string>();
  for (const def of defs) {
    if (!visible(def) || seen.has(def.id)) continue;
    seen.add(def.id);
    // Match queueCommand's target-region availability and route gate before presenting a clickable action.
    const e = away ? withRegion(eng, region, () => entryFor(eng, actor, def, t)) : entryFor(eng, actor, def, t);
    if (e && routeReason) {
      e.available = false;
      e.reason = routeReason;
      for (const child of e.children ?? []) { child.available = false; child.reason = routeReason; }
    }
    if (e) out.push(e);
  }
  const order = (id: string) => {
    const d = eng.content.interactions[id];
    return d && isNum(d.menuOrder) ? d.menuOrder : 100;
  };
  out.sort((a, b) => order(a.interactionId) - order(b.interactionId) || (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label));
  return out;
}
