/**
 * `townies` system: townie generation, visitor lifecycle (walk-bys, drop-ins, invites, doorbell, welcome, leave),
 * parties, service NPC creation for SIM-HOME, the `phone` + `visit` behaviours and the TowniesApi.
 */
import type { RequirementCheck, SimContext, SimSystem, TownieView, TowniesApi } from '../../../contracts';
import type { AgentId, AgentState, TargetRef } from '../../../types';
import { BEHAVIOR, REQ, SYS } from '../../../content/people/ids';
import { compareIds, delFlag, flagKeys, flagNum, fullName, makeApi, num, onLotAgents, peekRel, TICKS_PER_DAY, TICKS_PER_MINUTE, townies } from '../util';
import { createService, generateTownies } from './generate';
import { endParty, parseGuestList, partyActive, partyTick, partyView, startParty } from './party';
import { phoneBehavior, pizzaCandidate } from './phone';
import { BELL_FLAG, inviteTownie, processArrivals, superviseTownie, visitBehavior, visitorsHour, welcomeCandidates } from './visitors';
import { pendingArrival } from './visitorOps';
import { relationshipLabel } from '../social/relations';

export function townieList(ctx: SimContext, forAgentId: AgentId): TownieView[] {
  const viewer = typeof forAgentId === 'string' ? forAgentId : '';
  const out: TownieView[] = townies(ctx)
    .filter((t) => t.presence !== 'gone')
    .map((t) => {
      const r = peekRel(ctx, viewer, t.id);
      return {
        id: t.id,
        name: fullName(t),
        occupation: t.occupation ?? null,
        friendship: Math.round(num(r.friendship, 0)),
        romance: Math.round(num(r.romance, 0)),
        met: !!r.met,
        label: relationshipLabel(r),
        available: t.presence === 'offLot' && !pendingArrival(ctx, t.id),
      };
    });
  out.sort((a, b) => Number(b.met) - Number(a.met) || b.friendship - a.friendship || a.name.localeCompare(b.name) || compareIds(a.id, b.id));
  return out;
}

const noPartyActive: RequirementCheck = (ctx, _rc, params) => (partyActive(ctx) ? (typeof params?.reason === 'string' ? params.reason : 'A party is already in full swing') : true);

function housekeeping(ctx: SimContext): void {
  const now = ctx.state.tick;
  if (ctx.state.party && ctx.state.party.ended) ctx.state.party = null;
  for (const k of flagKeys(ctx, 'lastVisit:')) if (now - flagNum(ctx, k, now) > 2 * TICKS_PER_DAY) delFlag(ctx, k);
  for (const prefix of ['leavingSince:', 'bell:']) {
    for (const k of flagKeys(ctx, prefix)) {
      const a = ctx.state.agents[k.slice(prefix.length)];
      if (!a || a.presence !== 'onLot') delFlag(ctx, k);
    }
  }
}

export function createTowniesSystem(): SimSystem {
  let current: SimContext | null = null;
  const api = makeApi(() => current, {
    list: { fn: (c, forAgentId: AgentId) => townieList(c, forAgentId), fallback: () => [] },
    party: { fn: (c) => partyView(c), fallback: () => null },
    createService: { fn: (c, kind: unknown) => createService(c, kind), fallback: () => '' },
    invite: { fn: (c, actorId: AgentId, townieId: unknown) => inviteTownie(c, actorId, townieId), fallback: () => 'The phone lines are down' },
    throwParty: { fn: (c, hostId: AgentId, guests?: unknown) => startParty(c, hostId, parseGuestList(guests)), fallback: () => 'The phone lines are down' },
    endParty: { fn: (c) => (endParty(c), true), fallback: () => false },
  }) satisfies Record<keyof TowniesApi, unknown>;
  return {
    id: SYS.townies,
    init(ctx) {
      current = ctx;
      generateTownies(ctx); // idempotent (flag + count guarded); also repairs saves that predate townies
    },
    tick(ctx) {
      current = ctx;
      if (ctx.state.tick % TICKS_PER_MINUTE === 0) processArrivals(ctx);
      for (const a of onLotAgents(ctx)) if (a.role === 'townie') superviseTownie(ctx, a);
      partyTick(ctx);
    },
    hour(ctx, hour) {
      current = ctx;
      visitorsHour(ctx, hour);
    },
    dayStart(ctx) {
      current = ctx;
      housekeeping(ctx);
    },
    agentLeft(ctx, agent: AgentState) {
      current = ctx;
      if (agent.role === 'townie') {
        agent.visit = null;
        agent.walkBy = null;
        delFlag(ctx, BELL_FLAG(agent.id));
      }
    },
    behaviors: { [BEHAVIOR.phone]: phoneBehavior, [BEHAVIOR.visit]: visitBehavior },
    requirements: { [REQ.noPartyActive]: noPartyActive },
    autonomyCandidates(ctx, agent) {
      current = ctx;
      const out: { interactionId: string; target: TargetRef }[] = welcomeCandidates(ctx, agent);
      const pizza = pizzaCandidate(ctx, agent);
      if (pizza) out.push(pizza);
      return out;
    },
    api,
  };
}
