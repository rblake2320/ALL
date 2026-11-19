import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { fixtureSim, member, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';

describe('performance', () => {
  it('7 game days with 8 agents on the fixture lot in < 20 s', () => {
    const names = ['Mort', 'Ghoulia', 'Rotney', 'Cadavera', 'Bones', 'Wraith', 'Gristle', 'Marrow'];
    const { sim } = fixtureSim(newFixtureWorld({ seed: 31337, members: names.map((n) => member(n)) }));
    for (let i = 0; i < 4; i++) {
      place(sim, 'fridge_humming', 3 + i * 2, 3);
      place(sim, 'coffin_pine', 3 + i * 2, 18);
      place(sim, 'coffin_pine', 13 + i * 2, 18);
    }
    place(sim, 'table_rickety', 8, 10);
    place(sim, 'chair_creaky', 8, 9);
    place(sim, 'chair_creaky', 9, 10, 1);
    place(sim, 'tv_crt', 16, 8);
    place(sim, 'chair_creaky', 16, 11, 2);
    place(sim, 'chair_creaky', 17, 11, 2);
    place(sim, 'stereo_boombox', 22, 8);
    place(sim, 'shower_drizzle', 3, 14);
    place(sim, 'shower_drizzle', 25, 14);
    place(sim, 'mirror_cracked', 22, 14);
    const ticks = TICKS_PER_DAY * 7;
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (i % 2000 === 0) sim.drainEvents();
    }
    const wallMs = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const tps = Math.round((ticks / cpuMs) * 1000);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] 7 game days, 8 agents: cpu ${(cpuMs / 1000).toFixed(2)} s, wall ${(wallMs / 1000).toFixed(2)} s, ` +
        `${tps} ticks/s cpu (${Math.round((ticks / wallMs) * 1000)} wall), ${Math.round(tps / 240)} game-hours/s`,
    );
    // CPU time is the robust measure on a shared box (other agents' browsers/compilers inflate wall time);
    // wall time gets a generous ceiling so a real regression still fails.
    expect(cpuMs).toBeLessThan(20000);
    expect(wallMs).toBeLessThan(200000);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    for (const id of sim.state.household.memberIds) expect(sim.state.agents[id].needs.hunger).toBeGreaterThan(5);
  }, 240000);
});
