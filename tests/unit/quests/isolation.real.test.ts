/**
 * BALANCE PROOF: the quests system never feeds back into the simulation. The same new game + the same scripted player
 * commands, stepped with and without the quests system, produce byte-identical worlds apart from `state.quests`
 * (same RNG stream, ids, needs, funds, autonomy picks, notifications, stats). So BALANCE.md targets measured without
 * quests remain valid with quests (and the balance fast test still passes unchanged).
 */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { QUESTS_SYSTEM_ID } from '../../../src/sim/systems/quests';
import { jsonClone, newWorld, opts, run, simOf, systemsWithout, systemsWithQuests, withoutQuests, type RunLog } from './helpers';

describe('quests isolation (real modules)', () => {
  for (const seed of [11, 2024]) {
    it(`seed ${seed}: 3 game days with vs. without quests are byte-identical outside state.quests`, () => {
      const withQ = systemsWithQuests();
      const noQ = systemsWithout(QUESTS_SYSTEM_ID);
      expect(noQ.length).toBe(withQ.length - 1);
      const a = simOf(newWorld(opts(seed, 3), withQ), withQ);
      const b = simOf(newWorld(opts(seed, 3), noQ), noQ);
      expect(a.state.quests).toBeDefined();
      expect(b.state.quests).toBeUndefined();
      expect(withoutQuests(a.serialize())).toBe(withoutQuests(b.serialize()));
      const log: RunLog = { quest: [] };
      for (let t = TICKS_PER_HOUR; t <= TICKS_PER_DAY * 3; t += TICKS_PER_HOUR) {
        run(a, t, log);
        run(b, t);
        const sa = withoutQuests(a.serialize());
        const sb = withoutQuests(b.serialize());
        if (sa !== sb) throw new Error(`diverged by tick ${t}`);
      }
      expect(a.faults()).toEqual([]);
      expect(b.faults()).toEqual([]);
      expect(a.checkInvariants()).toEqual([]);
      // and quests actually did something in that run (otherwise the proof is vacuous)
      expect(log.quest.some((e) => e.type === 'questCompleted')).toBe(true);
      expect(a.state.quests!.grants.length).toBeGreaterThan(0);
    }, 300_000);
  }

  it('a pre-quests save (no quests key) gains quest state on load without changing anything else', () => {
    const noQ = systemsWithout(QUESTS_SYSTEM_ID);
    const old = simOf(newWorld(opts(5), noQ), noQ);
    run(old, TICKS_PER_HOUR * 6);
    const saved = jsonClone(old.serialize());
    expect('quests' in saved).toBe(false);
    const loaded = simOf(jsonClone(saved), systemsWithQuests());
    expect(loaded.repairWarnings).toEqual([]);
    expect(loaded.state.quests).toBeDefined();
    expect(withoutQuests(loaded.serialize())).toBe(withoutQuests(saved));
    // re-loading the same old save derives the same world id (replay-stable grant ids)
    const again = simOf(jsonClone(saved), systemsWithQuests());
    expect(again.state.quests!.worldId).toBe(loaded.state.quests!.worldId);
  });
});
