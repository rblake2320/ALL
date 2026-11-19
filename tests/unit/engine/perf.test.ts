import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { fixtureSim, member, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';

type CpuUsage = { user: number; system: number };
/**
 * CPU time of THIS thread where Node offers it (22.19 and later), else of the whole process. The test runner uses
 * worker threads, so the process figure also counts every other test file running at the same time: the same code
 * measured 6.7 s alone and 13.3 s next to one other file. That, not the simulation, is why this test used to fail
 * "under load".
 */
const threadCpu = (process as unknown as { threadCpuUsage?: (prev?: CpuUsage) => CpuUsage }).threadCpuUsage;
const cpuUsage = (prev?: CpuUsage): CpuUsage => (typeof threadCpu === 'function' ? threadCpu.call(process, prev) : process.cpuUsage(prev));

/** CPU budget for the run on the reference machine, in ms. */
const BUDGET_CPU_MS = 20000;
/** What `machineCostMs()` returns on the machine class the budget was set on (measured 2026-11-19; the run takes ~7 s there). */
const REFERENCE_COST_MS = 155;
/** A machine slower than this many times the reference is treated as broken, not slow. */
const MAX_MACHINE_FACTOR = 8;

/**
 * How fast this machine is: CPU ms for a fixed workload of the kind the simulation does (integer maths, allocation,
 * sorting, map access). Best of five, so a noisy neighbour or a cold JIT does not loosen the budget. It does not touch
 * the simulation, so a slower simulation cannot make its own budget bigger.
 */
function machineCostMs(): number {
  let best = Infinity;
  for (let run = 0; run < 5; run++) {
    const cpu0 = cpuUsage();
    let h = 0x811c9dc5;
    const arr: { k: number; v: number }[] = [];
    for (let i = 0; i < 400000; i++) {
      h = Math.imul(h ^ i, 0x01000193) >>> 0;
      arr.push({ k: h & 4095, v: i });
    }
    arr.sort((a, b) => a.k - b.k || a.v - b.v);
    const m = new Map<number, number>();
    for (const o of arr) m.set(o.k, (m.get(o.k) ?? 0) + o.v);
    let sum = 0;
    for (const [k, v] of m) sum = (sum + k * 31 + v) % 2147483647;
    if (sum < 0) throw new Error('unreachable');
    const c = cpuUsage(cpu0);
    best = Math.min(best, (c.user + c.system) / 1000);
  }
  return best;
}

describe('performance', () => {
  it('7 game days with 8 agents on the fixture lot within the CPU budget (20 s on the reference machine, scaled to this machine)', () => {
    const cost = machineCostMs();
    const factor = Math.min(MAX_MACHINE_FACTOR, Math.max(1, cost / REFERENCE_COST_MS));
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
    const cpu0 = cpuUsage();
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (i % 2000 === 0) sim.drainEvents();
    }
    const wallMs = performance.now() - t0;
    const cpu = cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const tps = Math.round((ticks / cpuMs) * 1000);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] 7 game days, 8 agents: cpu ${(cpuMs / 1000).toFixed(2)} s, wall ${(wallMs / 1000).toFixed(2)} s, ` +
        `${tps} ticks/s cpu (${Math.round((ticks / wallMs) * 1000)} wall), ${Math.round(tps / 240)} game-hours/s; ` +
        `machine cost ${cost.toFixed(0)} ms (reference ${REFERENCE_COST_MS}), budget x${factor.toFixed(2)} = ${((BUDGET_CPU_MS * factor) / 1000).toFixed(1)} s`,
    );
    // CPU time is the robust measure on a shared box (other programs inflate wall time); wall time gets a generous
    // ceiling so a real regression still fails. Both scale with the measured machine factor: the budget was a fixed
    // 20 s tuned on a fast machine, and a GitHub-hosted Windows runner needed 27 s for unchanged code.
    expect(factor, 'this machine is too slow or too busy to judge performance').toBeLessThan(MAX_MACHINE_FACTOR);
    expect(cpuMs).toBeLessThan(BUDGET_CPU_MS * factor);
    expect(wallMs).toBeLessThan(200000 * factor);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    for (const id of sim.state.household.memberIds) expect(sim.state.agents[id].needs.hunger).toBeGreaterThan(5);
  }, 600000);
});
