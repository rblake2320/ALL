/**
 * UI-level fuzz on the REAL content (spatial + home + people through src/sim/index.ts): random available menu
 * entries (and their children) on random targets for 36 game hours. Proves menus and dispatch agree (an entry
 * the menu offers is only ever refused because the queue is full), invariants hold every game hour and nothing
 * faults. Skipped, not failed, while the parallel modules can't be imported.
 */
import { describe, expect, it } from 'vitest';
import type { Command, NewGameOptions } from '../../../src/sim/contracts';
import type { TargetRef } from '../../../src/sim/types';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { createRng, seedRngState } from '../../../src/sim/rng';

type SimIndex = typeof import('../../../src/sim/index');
let real: SimIndex | null = null;
let loadError = '';
try {
  real = await import('../../../src/sim/index');
} catch (e) {
  loadError = e instanceof Error ? e.message : String(e);
}

describe.skipIf(!real)(`real-content fuzz${loadError ? ` (skipped: ${loadError})` : ''}`, () => {
  it('random menu orders for 36 game hours: menu/dispatch agree, invariants hold, zero faults', () => {
    const opts: NewGameOptions = {
      seed: 3,
      householdName: 'The Graves',
      members: [
        { firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: ['gourmand', 'neatFreak', 'nightOwl'], aspiration: 'tycoon' },
        { firstName: 'Ghoulia', lastName: 'Graves', appearance: defaultAppearance(), traits: ['cheerful', 'artistic'], aspiration: 'afterparty' },
        { firstName: 'Rotney', lastName: 'Graves', appearance: defaultAppearance(), traits: ['slob', 'lazy', 'clumsy'], aspiration: null },
      ],
      lotTemplate: 'starter',
      difficulty: 'normal',
    };
    const s = real!.createSimulation(real!.createNewWorld(opts));
    const r = createRng(seedRngState(93));
    const rejected: string[] = [];
    let ok = 0;
    for (let t = 0; t < 36 * TICKS_PER_HOUR; t++) {
      if (t % 37 === 0) {
        const members = s.state.household.memberIds.map((id) => s.state.agents[id]).filter((a) => a.presence === 'onLot');
        if (members.length) {
          const actor = r.pick(members);
          const roll = r.next();
          const objs = Object.values(s.state.objects).filter((o) => o.placement.kind !== 'held');
          const onLot = Object.values(s.state.agents).filter((a) => a.presence === 'onLot');
          let target: TargetRef = { kind: 'self' };
          if (roll < 0.6 && objs.length) target = { kind: 'object', id: r.pick(objs).id };
          else if (roll < 0.8 && onLot.length) target = { kind: 'agent', id: r.pick(onLot).id };
          else if (roll < 0.9) target = { kind: 'tile', x: r.int(0, 29), z: r.int(0, 29) };
          const menu = s.menu(actor.id, target).filter((e) => e.available);
          if (menu.length) {
            const e = r.pick(menu);
            const kids = e.children ? e.children.filter((c) => c.available) : [];
            if (!e.children || e.children.length === 0 || kids.length) {
              const child = kids.length ? r.pick(kids) : null;
              const cmd: Command = { type: 'queue', actorId: actor.id, interactionId: e.interactionId, target, params: child ? child.params : e.params };
              const res = s.dispatch(cmd);
              if (res.ok) ok++;
              else if (res.reason !== 'Queue is full') rejected.push(`${e.interactionId}: ${res.reason}`);
            }
          }
        }
      }
      s.step();
      if (t % TICKS_PER_HOUR === 0) {
        const inv = s.checkInvariants();
        if (inv.length) throw new Error(`tick ${s.state.tick}: ${inv.join('; ')}`);
      }
      if (t % 500 === 0) s.drainEvents();
    }
    expect(rejected).toEqual([]);
    expect(ok).toBeGreaterThan(100);
    expect(s.faults()).toEqual([]);
    expect(s.checkInvariants()).toEqual([]);
  }, 240000);
});
