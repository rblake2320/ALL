import { describe, expect, it } from 'vitest';
import type { Command, MenuEntry } from '../../../src/sim/contracts';
import type { TargetRef } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { fixtureSim, member, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';

/**
 * Seeded random *valid* commands for 5 game days on fixture content; invariants are checked every 120 ticks
 * and no faults may be recorded. The fuzzer drives the UI-level API (menu -> dispatch) plus chaos the world can
 * throw at the engine: power cuts, objects sold or spawned mid-use, visitors arriving and leaving, agents going
 * to work, settings flipping.
 */
describe('fuzz: random valid commands', () => {
  for (const seed of [11, 4242]) {
    it(`seed ${seed}: 5 game days, invariants hold every 120 ticks, zero faults`, () => {
      const { sim } = fixtureSim(newFixtureWorld({ seed, lotTemplate: 'starter', members: [member('A'), member('B'), member('C')] }));
      const r = createRng(seedRngState(seed * 7919));
      const ctx = sim.engine.ctx;
      place(sim, 'tv_crt', 16, 8);
      place(sim, 'chair_creaky', 16, 11, 2);
      place(sim, 'stereo_boombox', 22, 8);
      place(sim, 'shower_drizzle', 3, 14);
      place(sim, 'coffin_pine', 14, 14);
      place(sim, 'mirror_cracked', 22, 14);
      place(sim, 'station_embalming', 20, 18);
      place(sim, 'headstone_decor', 25, 22);
      place(sim, 'desk_hauntedpc', 2, 20);
      const visitor = ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Vee', lastName: 'Zitor', appearance: {} as never, traits: [] });
      let stats = { cmds: 0, ok: 0 };
      const randomTarget = (): TargetRef => {
        const roll = r.next();
        const objs = Object.values(sim.state.objects).filter((o) => o.placement.kind !== 'held');
        const onLot = Object.values(sim.state.agents).filter((a) => a.presence === 'onLot');
        if (roll < 0.55 && objs.length) return { kind: 'object', id: r.pick(objs).id };
        if (roll < 0.75 && onLot.length) return { kind: 'agent', id: r.pick(onLot).id };
        if (roll < 0.9) return { kind: 'tile', x: r.int(0, 29), z: r.int(0, 29) };
        return { kind: 'self' };
      };
      const total = TICKS_PER_DAY * 5;
      for (let t = 0; t < total; t++) {
        if (t % 23 === 0) {
          const members = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
          const actor = r.pick(members);
          const roll = r.next();
          let cmd: Command | null = null;
          if (roll < 0.6) {
            const target = randomTarget();
            const menu = sim.menu(actor.id, target).filter((e) => e.available);
            if (menu.length) {
              const e: MenuEntry = r.pick(menu);
              const child = e.children && e.children.length ? r.pick(e.children) : null;
              cmd = { type: 'queue', actorId: actor.id, interactionId: e.interactionId, target, params: child ? child.params : e.params };
            }
          } else if (roll < 0.75) {
            const q = sim.queueView(actor.id);
            if (q.length) cmd = { type: 'cancel', actorId: actor.id, uid: r.pick(q).uid };
          } else if (roll < 0.82) {
            cmd = { type: 'build', cmd: { type: 'buy', defId: r.pick(['chair_creaky', 'table_rickety', 'mirror_cracked']), x: r.int(1, 27), z: r.int(1, 25), rot: r.int(0, 3) as 0 | 1 | 2 | 3 } };
          } else if (roll < 0.86) {
            const sellable = Object.values(sim.state.objects).filter((o) => o.placement.kind === 'floor');
            if (sellable.length) cmd = { type: 'build', cmd: { type: 'sell', objectId: r.pick(sellable).id } };
          } else if (roll < 0.88) {
            cmd = { type: r.pick(['undo', 'redo', 'endBuildSession'] as const) };
          } else if (roll < 0.9) {
            cmd = { type: 'setSettings', settings: { autonomy: r.pick(['full', 'limited', 'off'] as const) } };
          } else if (roll < 0.92) {
            cmd = { type: 'cheat', code: r.pick(['freshstart', 'graverobber']) };
          } else if (roll < 0.94) {
            sim.state.household.utilitiesOn = !sim.state.household.utilitiesOn;
          } else if (roll < 0.96) {
            if (visitor.presence === 'onLot') ctx.sendOffLot(visitor, 'offLot', 'bye');
            else {
              visitor.visit = { arrivedTick: sim.state.tick, leaveTick: sim.state.tick + 1000, reason: 'dropIn', welcomed: r.chance(0.5), leaving: false };
              ctx.spawnAgent(visitor.id);
            }
          } else if (roll < 0.97) {
            if (actor.presence === 'onLot' && r.chance(0.5)) ctx.sendOffLot(actor, 'atWork', 'shift');
          } else if (roll < 0.98) {
            for (const m of members) if (m.presence === 'atWork') ctx.spawnAgent(m.id);
          } else {
            const loose = Object.values(sim.state.objects).filter((o) => o.placement.kind === 'loose' || o.placement.kind === 'held');
            if (loose.length) ctx.removeObject(r.pick(loose).id);
            else ctx.placeItemNear('item_meal', { x: r.int(2, 27) + 0.5, z: r.int(2, 25) + 0.5 });
          }
          if (cmd) {
            stats.cmds++;
            if (sim.dispatch(cmd).ok) stats.ok++;
          }
        }
        sim.step();
        if (t % 120 === 0) {
          const inv = sim.checkInvariants();
          if (inv.length) throw new Error(`tick ${sim.state.tick}: ${inv.join('; ')}`);
        }
        if (t % 1000 === 0) sim.drainEvents();
      }
      expect(sim.faults()).toEqual([]);
      expect(sim.checkInvariants()).toEqual([]);
      expect(stats.ok).toBeGreaterThan(50);
      stats = { ...stats };
    }, 240000);
  }
});
