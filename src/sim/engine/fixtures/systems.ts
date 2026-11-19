/** TEST FIXTURE systems: a tiny social outcome behaviour, an instrumented counting behaviour and a thrower. */
import type { InteractionBehavior, SimSystem } from '../../contracts';
import { clamp } from '../util';

export interface FixtureCounters {
  begin: Map<number, number>;
  end: Map<number, number>;
  outcomes: string[];
}

export function createCounters(): FixtureCounters {
  return { begin: new Map(), end: new Map(), outcomes: [] };
}

export function fixtureSystems(counters: FixtureCounters = createCounters()): SimSystem[] {
  const social: InteractionBehavior = {
    completeStage(ctx, actor, run, def) {
      if (run.target.kind !== 'agent' || !def.social) return;
      const t = ctx.agent(run.target.id);
      if (!t) return;
      const r = ctx.rel(actor.id, t.id);
      const ok = ctx.rng.chance(def.social.baseChance);
      r.friendship = clamp(r.friendship + (ok ? def.social.friendship[0] : def.social.friendship[1]), -100, 100);
      r.met = true;
      r.interactions++;
      r.lastInteractionTick = ctx.state.tick;
      const gain = ok ? def.social.social : def.social.social / 2;
      ctx.changeNeed(actor, 'social', gain);
      ctx.changeNeed(t, 'social', gain);
      ctx.stat(ok ? 'socialSuccess' : 'socialFail');
    },
  };
  const counter: InteractionBehavior = {
    begin(_ctx, _a, run) {
      counters.begin.set(run.uid, (counters.begin.get(run.uid) ?? 0) + 1);
      return null;
    },
    end(_ctx, _a, run, _def, outcome) {
      counters.end.set(run.uid, (counters.end.get(run.uid) ?? 0) + 1);
      counters.outcomes.push(outcome);
    },
  };
  const throws: InteractionBehavior = {
    tick() {
      throw new Error('fixture: cursed arcade exploded');
    },
  };
  return [
    {
      id: 'fx_people',
      behaviors: { fx_social: social, fx_counter: counter, fx_throws: throws },
      conditions: { fx_always: () => true },
    },
  ];
}
