/** Behaviour registry helpers + the engine's own behaviours (standard, respond, passOut, exitLot). */
import type { InteractionBehavior, InteractionDef } from '../contracts';
import type { ActiveInteraction, AgentState } from '../types';
import { dirToFacing } from '../../shared/dimensions';
import { ENGINE_BEHAVIORS, ENGINE_INTERACTIONS, PRIORITY } from '../vocabulary';
import { HARD_QUEUE_CAP } from './constants';
import { ENGINE_INTERNAL_BEHAVIORS } from './content';
import { recordFault } from './faults';
import type { Engine } from './types';
import { isPresence } from './agents';
import { knockBehavior } from './knock';

export function behaviorKey(def: InteractionDef): string {
  return typeof def.behavior === 'string' && def.behavior ? def.behavior : ENGINE_BEHAVIORS.standard;
}

export function behaviorOf(eng: Engine, def: InteractionDef): InteractionBehavior | null {
  return eng.behaviors[behaviorKey(def)] ?? null;
}

/** Invoke a behaviour hook behind a fault barrier. `threw` tells the caller to abort the run. */
export function callHook<R>(eng: Engine, def: InteractionDef, hook: string, fn: () => R): { value: R | undefined; threw: boolean } {
  try {
    return { value: fn(), threw: false };
  } catch (e) {
    recordFault(eng, `behavior:${behaviorKey(def)}.${hook}`, e);
    return { value: undefined, threw: true };
  }
}

function facePartner(eng: Engine, agent: AgentState, run: ActiveInteraction): void {
  const p = run.partnerId ? eng.state.agents[run.partnerId] : undefined;
  if (!p) return;
  const dx = p.pos.x - agent.pos.x;
  const dz = p.pos.z - agent.pos.z;
  if (Math.abs(dx) + Math.abs(dz) > 1e-6) agent.facing = dirToFacing(dx, dz);
}

function partnerLinked(eng: Engine, agent: AgentState, run: ActiveInteraction): boolean {
  const p = run.partnerId ? eng.state.agents[run.partnerId] : undefined;
  return !!(p && p.presence === 'onLot' && p.active && p.active.partnerId === agent.id);
}

export function engineBehaviors(eng: Engine): Record<string, InteractionBehavior> {
  const respond: InteractionBehavior = {
    startStage(_ctx, agent, run) {
      const p = run.partnerId ? eng.state.agents[run.partnerId] : undefined;
      const pdef = p && p.active ? eng.content.interactions[p.active.interactionId] : undefined;
      if (pdef && pdef.social && pdef.social.targetAnim) agent.anim = pdef.social.targetAnim;
      if (pdef && pdef.social && pdef.social.targetVoice) {
        eng.ctx.emit({ type: 'voice', agentId: agent.id, emotion: pdef.social.targetVoice, durationMs: 1200 });
      }
      facePartner(eng, agent, run);
      return null;
    },
    tick(_ctx, agent, run) {
      // Only finish once the actor has linked to us and then let go (or vanished).
      if (run.data._linked && !partnerLinked(eng, agent, run)) return 'done';
      if (partnerLinked(eng, agent, run)) run.data._linked = true;
      else if (eng.state.tick - (run.startedRunTick ?? eng.state.tick) > 8) return 'done';
      facePartner(eng, agent, run);
      return undefined;
    },
  };

  const passOut: InteractionBehavior = {
    begin(ctx, agent) {
      agent.status.passedOut = true;
      ctx.emit({ type: 'bubble', agentId: agent.id, icon: 'zzz', style: 'thought', positive: false });
      ctx.emit({ type: 'fx', kind: 'zzz', agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
      if (ctx.isHousehold(agent)) {
        ctx.notify({
          kind: 'warning',
          title: `${agent.firstName} passed out`,
          text: `${agent.firstName} collapsed from exhaustion and is sleeping on the floor.`,
          agentId: agent.id,
        });
      }
      return null;
    },
    end(_ctx, agent) {
      agent.status.passedOut = false;
    },
  };

  const exitLot: InteractionBehavior = {
    end(ctx, agent, run, _def, outcome) {
      if (agent.presence !== 'onLot') return;
      const p = run.params.presence;
      const presence = isPresence(p) && p !== 'onLot' ? p : 'offLot';
      if (outcome === 'canceled') {
        // ctx.sendOffLot promises the agent leaves: a cancel (a system interrupt, build mode, a critical override)
        // only restarts the walk. despawnAgent() clears the queue right after its own cancel, so a real departure
        // is unaffected. A full queue gives up its last item so the exit always fits.
        if (Array.isArray(agent.queue) && agent.queue.length >= HARD_QUEUE_CAP) agent.queue.pop();
        ctx.queue(agent, {
          interactionId: ENGINE_INTERACTIONS.exitLot,
          target: { kind: 'self' },
          params: { ...run.params, presence },
          source: 'system',
          priority: PRIORITY.critical,
          front: true,
        });
        return;
      }
      ctx.despawnAgent(agent.id, presence);
    },
  };

  return {
    [ENGINE_BEHAVIORS.standard]: {},
    [ENGINE_INTERNAL_BEHAVIORS.respond]: respond,
    [ENGINE_INTERNAL_BEHAVIORS.passOut]: passOut,
    [ENGINE_INTERNAL_BEHAVIORS.exitLot]: exitLot,
    [ENGINE_INTERNAL_BEHAVIORS.knock]: knockBehavior(eng),
  };
}
