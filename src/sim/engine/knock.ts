/**
 * KNOCK → WELCOME (W-025 S3; docs/DESIGN_WORLD_LEVELS.md §1.5 ownership table).
 *
 * A neighbour's house interior is private: its doors are closed in the PUBLIC step mask. `engine_knock` on such a door
 * (walked to from anywhere: the route aims at the door's outdoor side) asks the house: the door is answered when a
 * RESIDENT is in the region (`RegionService.residents`, derived; S6 fills it from the townie schedules), it is
 * 09:00–21:00 and the resident's friendship with the knocker is ≥ 0. Then the knocker is WELCOMED for 2 game hours
 * (`AgentState.welcome`): they walk that region with the resident mask, so the house doors open for them. Otherwise
 * the knock is refused with a reason and nothing changes. Deterministic (no RNG), and every step is plain saved state.
 */
import type { InteractionBehavior } from '../contracts';
import type { AgentState, ObjectState } from '../types';
import { TICKS_PER_HOUR } from '../types';
import type { RegionId } from '../../shared/world';
import { specOf, isDoor } from '../spatial/defs';
import { peekRel } from './context';
import { compareIds } from './util';
import { agentRegion, isHomeRegion, objectRegion } from './regions';
import type { Engine } from './types';

/** How long a welcome lasts (§1.5: "welcomed for 2 h"). */
export const WELCOME_TICKS = 2 * TICKS_PER_HOUR;
/** Hours a resident answers the door: [open, close). */
export const KNOCK_HOURS = { open: 9, close: 21 } as const;

export function isDoorOpening(eng: Engine, o: ObjectState | null | undefined): boolean {
  return !!o && o.placement.kind === 'opening' && isDoor(specOf(eng.content, o.defId));
}

/** The private region a door belongs to (a non-home region with a public step mask), or null. */
export function knockRegionOf(eng: Engine, o: ObjectState): RegionId | null {
  const r = objectRegion(eng, o);
  if (isHomeRegion(eng, r)) return null;
  const s = eng.regions.services.get(r);
  return s && s.publicSpatial ? r : null;
}

/** Residents present in the region, in id order. */
export function residentsHome(eng: Engine, id: RegionId): AgentState[] {
  const s = eng.regions.services.get(id);
  let ids: readonly string[] = [];
  try {
    ids = s && s.residents ? s.residents() : [];
  } catch {
    ids = [];
  }
  return ids
    .map((x) => eng.state.agents[x])
    .filter((a): a is AgentState => !!a && a.presence === 'onLot' && agentRegion(eng, a) === id)
    .sort((a, b) => compareIds(a.id, b.id));
}

/** Answer a knock: the welcoming resident, or the reason nobody lets the knocker in. */
export function answerKnock(eng: Engine, knocker: AgentState, id: RegionId): { ok: true; host: AgentState } | { ok: false; reason: string } {
  const home = residentsHome(eng, id);
  if (home.length === 0) return { ok: false, reason: 'Nobody answered the door' };
  const h = eng.time.hour;
  if (h < KNOCK_HOURS.open || h >= KNOCK_HOURS.close) return { ok: false, reason: 'Too late to call — nobody opens the door now' };
  const host = home.find((r) => peekRel(eng, r.id, knocker.id).friendship >= 0);
  if (!host) return { ok: false, reason: `${home[0].firstName} won't let you in` };
  return { ok: true, host };
}

export function knockBehavior(eng: Engine): InteractionBehavior {
  return {
    available(_ctx, _agent, _def, target) {
      if (target.kind !== 'object') return 'Nothing to knock on';
      const o = eng.state.objects[target.id];
      if (!isDoorOpening(eng, o) || !o || !knockRegionOf(eng, o)) return 'Not a door you can knock on';
      return true;
    },
    end(ctx, agent, run, _def, outcome) {
      if (outcome !== 'complete' || run.target.kind !== 'object') return;
      const o = eng.state.objects[run.target.id];
      const id = o ? knockRegionOf(eng, o) : null;
      if (!o || !id) return;
      const a = answerKnock(eng, agent, id);
      if (!a.ok) {
        ctx.notify({ kind: 'info', title: `${agent.firstName} knocked`, text: a.reason, agentId: agent.id });
        ctx.emit({ type: 'bubble', agentId: agent.id, icon: 'question', style: 'thought', positive: false });
        return;
      }
      agent.welcome = { regionId: id, untilTick: eng.state.tick + WELCOME_TICKS };
      ctx.notify({ kind: 'social', title: `${a.host.firstName} let ${agent.firstName} in`, text: 'Welcome for two hours.', agentId: agent.id });
      ctx.emit({ type: 'bubble', agentId: a.host.id, icon: 'heart', style: 'speech', positive: true });
    },
  };
}
