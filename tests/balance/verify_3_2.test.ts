/**
 * INDEPENDENT skeptic check (round 3, script 2) of the §5.9 balance pass. Own loop, own player script, own
 * household-size rule and own household seed derivation, on seeds 5001-5010 — NOT 11..55 (tuned), 1001-1010,
 * 2001-2010 or 3001-3010 (all used by earlier skeptics and then tuned against in docs/BALANCE.md).
 *
 * Run: npx vitest run --config tests/balance/vitest.config.ts tests/balance/verify_3_2.test.ts
 * VERIFY_SEEDS=5001,5002 narrows; VERIFY_PART=A|B|D runs one part; VERIFY_OUT=<file> writes JSON.
 * Measures only (targets are judged in the report). Asserts only faults / invariants / determinism.
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { NeedId, WorldState } from '../../src/sim/types';
import { NEED_IDS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/types';
import type { NewGameOptions, SimulationAPI } from '../../src/sim/contracts';
import { createNewWorld, createSimulation, LOT_TEMPLATES, loadContent } from '../../src/sim/index';
import { isEssentialInteraction } from '../../src/sim/engine/repetition';
import { timeInfo } from '../../src/sim/time';
import { buildCazCatalog } from '../../src/game/gddCatalog';
import { randomHousehold } from '../../src/game/randomZombie';
import { SaveManagerImpl } from '../../src/persistence/saveManager';
import { createMemoryBackend } from '../../src/persistence/backends/memory';
import { engineRepairHook } from '../../src/persistence/semanticRepair';
import { canonicalJson } from '../../src/persistence/canonicalJson';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sim = SimulationAPI & { engine: any };
const SEEDS = (process.env.VERIFY_SEEDS ?? '5001,5002,5003,5004,5005,5006,5007,5008,5009,5010').split(',').map(Number);
const PART = process.env.VERIFY_PART ?? 'ALL';
const CRIT = 15;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

function options(seed: number, difficulty: WorldState['settings']['difficulty'] = 'normal'): NewGameOptions {
  const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
  const count = (seed * 7) % 5 < 2 ? 3 : 2; // own rule
  const { householdName, members } = randomHousehold(seed * 13 + 5, catalog, count);
  return { seed, householdName, members, lotTemplate: 'starter', difficulty };
}

interface Tally { hours: number; low: Record<NeedId, number>; min: Record<NeedId, number> }
const tally = (): Tally => ({
  hours: 0,
  low: Object.fromEntries(NEED_IDS.map((n) => [n, 0])) as Record<NeedId, number>,
  min: Object.fromEntries(NEED_IDS.map((n) => [n, 100])) as Record<NeedId, number>,
});
const pctLow = (t: Tally, n: NeedId): number => (t.hours ? Math.round((1000 * t.low[n]) / t.hours) / 10 : 0);

interface Result {
  part: string; seed: number; size: number; days: number; survivedDays: number; gameOver: boolean;
  crumbles: string[]; stay: Tally; work: Tally; funds: number[]; slopeAfter7: number; minFunds: number;
  repoVisits: number; repossessions: number; powerCuts: number; lateBills: number; fires: number;
  worstPerDay: number; worstPerDayWhat: string; over6: string[]; topShare: number; topWhat: string;
  chillPicks: number; chillPicksAt40Plus: number;
  faults: string[]; violations: string[]; careers: string[]; notes: string[]; secs: number;
}

function linSlope(series: number[], fromDay: number): number {
  const pts = series.map((v, d) => [d, v] as const).filter(([d]) => d >= fromDay);
  if (pts.length < 2) return NaN;
  const mx = pts.reduce((s, [d]) => s + d, 0) / pts.length;
  const my = pts.reduce((s, [, v]) => s + v, 0) / pts.length;
  let num = 0, den = 0;
  for (const [d, v] of pts) { num += (d - mx) * (v - my); den += (d - mx) ** 2; }
  return Math.round((num / den) * 10) / 10;
}

/** Buy defId on the nearest free tile (Chebyshev ring order) around (cx, cz). */
function buyNear(sim: Sim, defId: string, cx: number, cz: number, radius = 8): boolean {
  for (let r = 0; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= sim.state.lot.width || z >= sim.state.lot.depth) continue;
      for (const rot of [0, 1, 2, 3] as const) {
        if (sim.build.apply({ type: 'buy', defId, x, z, rot }).ok) { sim.build.clearHistory(); return true; }
      }
    }
  }
  return false;
}

async function simulate(part: 'A' | 'B', seed: number, days: number): Promise<Result> {
  const started = performance.now();
  const sim = createSimulation(createNewWorld(options(seed))) as Sim;
  const ids = sim.state.household.memberIds.slice();
  const name = (id: string): string => sim.state.agents[id]?.firstName ?? id;
  const perAgent = new Map(ids.map((id) => [id, tally()]));
  const workers = new Set<string>();
  const crumbles: string[] = [];
  const lastUid = new Map<string, number>();
  const picksPerDay = new Map<string, number>();
  const awakeBy = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const awakeTotal = new Map(ids.map((id) => [id, 0]));
  const funds = [sim.state.household.funds];
  let minFunds = funds[0];
  const violations: string[] = [];
  const lateIds = new Set<string>();
  let repoVisits = 0, prevRepo = sim.state.household.repoDispatchedDay;
  let chillPicks = 0, chillPicksAt40Plus = 0;
  const notes: string[] = [];
  const essentialsToKeep = Object.values(sim.state.objects)
    .filter((o) => (o.defId === 'fridge_humming' || o.defId === 'stove_greasefire') && o.placement.kind === 'floor')
    .map((o) => ({ defId: o.defId, p: o.placement as { x: number; z: number; rot: 0 | 1 | 2 | 3 } }));
  const coffin = Object.values(sim.state.objects).find((o) => o.defId.startsWith('coffin') && o.placement.kind === 'floor');
  const anchor = coffin && coffin.placement.kind === 'floor' ? { x: coffin.placement.x, z: coffin.placement.z } : { x: 10, z: 10 };
  const isSleep = (iid: string): boolean => { const t = sim.content.interactions[iid]?.tags ?? []; return t.includes('sleep') || t.includes('nap'); };
  const player = part === 'B';
  let gotJob = !player, gotChill = !player, gotStation = !player;
  const career = seed % 2 === 0 ? 'necrotech' : 'mortuary'; // own rotation (opposite parity to round 2)
  let survivedDays = days;

  for (let i = 1; i <= days * TICKS_PER_DAY; i++) {
    sim.step();
    const tick = sim.state.tick;
    const ti = timeInfo(tick);
    for (const id of ids) {
      const a = sim.state.agents[id];
      if (!a) continue;
      const run = a.active;
      if (run && lastUid.get(id) !== run.uid) {
        lastUid.set(id, run.uid);
        if (run.source === 'auto' && run.params._origUid === undefined && !run.interactionId.startsWith('engine_')) {
          const key = `${ti.day}|${id}|${run.interactionId}`;
          picksPerDay.set(key, (picksPerDay.get(key) ?? 0) + 1);
          if (run.interactionId === 'home_chillOut') { chillPicks++; if (a.needs.preservation >= 40) chillPicksAt40Plus++; }
        }
      }
      if (i % 3 === 0 && a.presence === 'onLot' && !a.status.passedOut && !(run && isSleep(run.interactionId))) {
        awakeTotal.set(id, awakeTotal.get(id)! + 1);
        const iid = run?.interactionId ?? '(idle)';
        const m = awakeBy.get(id)!; m.set(iid, (m.get(iid) ?? 0) + 1);
      }
    }
    if (tick % TICKS_PER_HOUR !== 0) continue;
    sim.drainEvents();
    for (const id of ids) {
      const a = sim.state.agents[id];
      if (!a) continue;
      if (a.career) workers.add(id);
      if ((a.presence === 'crumbled' || a.presence === 'gone') && !crumbles.some((c) => c.startsWith(name(id) + ' '))) crumbles.push(`${name(id)} d${ti.day} ${a.presence}`);
      if (a.presence !== 'onLot') continue;
      const t = perAgent.get(id)!; t.hours++;
      for (const n of NEED_IDS) { if (a.needs[n] < CRIT) t.low[n]++; t.min[n] = Math.min(t.min[n], Math.round(a.needs[n])); }
    }
    for (const b of sim.state.household.bills) if (tick > b.dueTick && (b.paidTick === null || b.paidTick > b.dueTick)) lateIds.add(b.id);
    const rd = sim.state.household.repoDispatchedDay;
    if (rd !== null && rd !== prevRepo) repoVisits++;
    prevRepo = rd;
    for (const v of sim.checkInvariants()) if (violations.length < 10) violations.push(`t${tick} ${v}`);
    minFunds = Math.min(minFunds, sim.state.household.funds);
    if (player) {
      if (!gotJob && ti.hour >= 9) {
        const id = ids.find((x) => sim.state.agents[x]?.presence === 'onLot');
        if (id && sim.dispatch({ type: 'queue', actorId: id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: career } }).ok) { gotJob = true; notes.push(`d${ti.day} job ${career}->${name(id)}`); }
      }
      if (!gotChill && ti.hour >= 11) { gotChill = true; notes.push(`chill ${sim.state.household.funds >= 1000 && buyNear(sim, 'coffin_chillrest', anchor.x, anchor.z)}`); }
      if (!gotStation && sim.state.household.funds >= 3200 && ti.hour >= 10 && ti.hour <= 20 && buyNear(sim, 'station_embalming', anchor.x, anchor.z)) { gotStation = true; notes.push(`d${ti.day} station`); }
      if (ti.hour >= 9 && ti.hour <= 21) for (const e of essentialsToKeep) {
        if (Object.values(sim.state.objects).some((o) => o.defId === e.defId)) continue;
        let ok = sim.build.apply({ type: 'buy', defId: e.defId, x: e.p.x, z: e.p.z, rot: e.p.rot }).ok;
        if (ok) sim.build.clearHistory(); else ok = buyNear(sim, e.defId, e.p.x, e.p.z, 3);
        notes.push(`d${ti.day}h${ti.hour} rebuy ${e.defId} ${ok}`);
      }
    }
    if (ti.hour === 0) funds.push(sim.state.household.funds);
    if (sim.state.gameOver) { survivedDays = ti.day; break; }
    if (tick % (3 * TICKS_PER_HOUR) === 0) await yieldLoop();
  }

  const stay = tally(), work = tally();
  for (const id of ids) {
    const dst = workers.has(id) ? work : stay, src = perAgent.get(id)!;
    dst.hours += src.hours;
    for (const n of NEED_IDS) { dst.low[n] += src.low[n]; dst.min[n] = Math.min(dst.min[n], src.min[n]); }
  }
  let worstPerDay = 0, worstPerDayWhat = '';
  const over6: string[] = [];
  for (const [k, n] of picksPerDay) {
    const [d, id, iid] = k.split('|');
    const def = sim.content.interactions[iid];
    if (!def || isEssentialInteraction(sim.engine, def)) continue;
    if (n > worstPerDay) { worstPerDay = n; worstPerDayWhat = `${name(id)} ${iid} d${d}`; }
    if (n > 6) over6.push(`${name(id)} ${iid} x${n} d${d}`);
  }
  let topShare = 0, topWhat = '';
  for (const id of ids) for (const [iid, v] of awakeBy.get(id)!) {
    if (iid === '(idle)' || iid.startsWith('engine_')) continue;
    const s = (100 * v) / Math.max(1, awakeTotal.get(id)!);
    if (s > topShare) { topShare = Math.round(s * 10) / 10; topWhat = `${name(id)} ${iid}`; }
  }
  const c = sim.state.stats.counters;
  return {
    part, seed, size: ids.length, days, survivedDays, gameOver: sim.state.gameOver, crumbles, stay, work, funds,
    slopeAfter7: linSlope(funds, 7), minFunds,
    repoVisits, repossessions: c.repossessions ?? 0, powerCuts: c.powerCuts ?? 0, lateBills: lateIds.size, fires: c.firesStarted ?? 0,
    worstPerDay, worstPerDayWhat, over6, topShare, topWhat, chillPicks, chillPicksAt40Plus,
    faults: sim.faults().slice(0, 5).map((f) => `${f.where}: ${f.message}`), violations,
    careers: ids.map((id) => { const k = sim.state.agents[id]?.career; return k ? `${name(id)}:${k.trackId}L${k.level}` : `${name(id)}:-`; }),
    notes, secs: Math.round((performance.now() - started) / 1000),
  };
}

function report(r: Result): string {
  const st = NEED_IDS.map((n) => `${n.slice(0, 4)} ${pctLow(r.stay, n)}%/min${r.stay.min[n]}`).join(' ');
  return `[${r.part} ${r.seed} ${r.size}z] ${r.survivedDays}/${r.days}d gameOver=${r.gameOver} crumbles=${JSON.stringify(r.crumbles)}`
    + ` | stay ${r.stay.hours}h: ${st} | work ${r.work.hours}h fun<15 ${pctLow(r.work, 'fun')}% min${r.work.min.fun}`
    + ` | funds ${r.funds[0]}→d7 ${r.funds[7] ?? '?'}→${r.funds.at(-1)} min ${r.minFunds} slope>7 ${r.slopeAfter7}`
    + ` | repo ${r.repoVisits}/${r.repossessions} cuts ${r.powerCuts} late ${r.lateBills} fires ${r.fires}`
    + ` | NE/day max ${r.worstPerDay} (${r.worstPerDayWhat}) over6 ${r.over6.length} | top ${r.topShare}% ${r.topWhat}`
    + ` | chill ${r.chillPicks} (≥40: ${r.chillPicksAt40Plus}) | faults ${r.faults.length} viol ${r.violations.length}`
    + ` | ${r.careers.join(',')} | ${r.secs}s | ${r.notes.join('; ')}`
    + (r.faults.length ? '\n  F: ' + r.faults.join(' | ') : '') + (r.violations.length ? '\n  V: ' + r.violations.join(' | ') : '')
    + (r.over6.length ? '\n  S: ' + r.over6.join(' | ') : '');
}

const results: Result[] = [];
const persist = (): void => { if (process.env.VERIFY_OUT) writeFileSync(process.env.VERIFY_OUT, JSON.stringify(results, null, 1)); };
const want = (p: string): boolean => PART === 'ALL' || PART === p;

describe('skeptic round 3 script 2 (seeds 5001-5010)', () => {
  it.runIf(want('A'))('A: unattended normal 14 days', async () => {
    for (const s of SEEDS) { const r = await simulate('A', s, 14); results.push(r); console.log(report(r)); persist(); }
    const rs = results.filter((r) => r.part === 'A');
    expect(rs.flatMap((r) => r.faults)).toEqual([]);
    expect(rs.flatMap((r) => r.violations)).toEqual([]);
  });

  it.runIf(want('B'))('B: reasonable player normal 21 days', async () => {
    for (const s of SEEDS) { const r = await simulate('B', s, 21); results.push(r); console.log(report(r)); persist(); }
    const rs = results.filter((r) => r.part === 'B');
    expect(rs.flatMap((r) => r.faults)).toEqual([]);
    expect(rs.flatMap((r) => r.violations)).toEqual([]);
  });

  it.runIf(want('D'))('save -> load -> continue deterministic over 2 game days (seed 5006)', async () => {
    const o = options(5006);
    const a = createSimulation(createNewWorld(o)) as Sim;
    a.dispatch({ type: 'queue', actorId: a.state.household.memberIds[0], interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'mortuary' } });
    // day 6, 14:xx and a few ticks off the hour: mid-run, after the first fresh-cap days have rolled over
    const at = 5 * TICKS_PER_DAY + 7 * TICKS_PER_HOUR + 37;
    while (a.state.tick < at) { a.step(); if (a.state.tick % TICKS_PER_HOUR === 0) a.drainEvents(); }
    a.drainEvents();
    const picksFlags = Object.keys(a.state.flags ?? {}).filter((k) => k.startsWith('engine:picks:')).length;
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), repair: engineRepairHook(), logger: { warn() {}, error() {}, info() {} } as never });
    const sv = await mgr.save('v32', 'V32', a.serialize(), { householdName: o.householdName, memberNames: [], day: 6, timeLabel: '', funds: a.state.household.funds, lotValue: 0, thumbnail: null });
    expect(sv.ok, JSON.stringify(sv)).toBe(true);
    const ld = await mgr.load('v32');
    expect(ld.ok).toBe(true);
    if (!ld.ok) return;
    expect(ld.warnings).toEqual([]);
    const b = createSimulation(ld.world) as Sim;
    expect(b.repairWarnings).toEqual([]);
    expect(canonicalJson(b.serialize())).toBe(canonicalJson(a.serialize()));
    let stateDiff: number | null = null, evDiff: number | null = null;
    for (let i = 1; i <= 2 * TICKS_PER_DAY; i++) {
      a.step(); b.step();
      if (i % TICKS_PER_HOUR === 0) {
        if (evDiff === null && canonicalJson(a.drainEvents()) !== canonicalJson(b.drainEvents())) evDiff = i;
        if (stateDiff === null && canonicalJson(a.serialize()) !== canonicalJson(b.serialize())) stateDiff = i;
        if (i % (4 * TICKS_PER_HOUR) === 0) await yieldLoop();
      }
    }
    const finalEq = canonicalJson(a.serialize()) === canonicalJson(b.serialize());
    console.log(`[DET] seed 5006 save@${at} picksFlags ${picksFlags} +${2 * TICKS_PER_DAY} ticks: stateDiff ${stateDiff} evDiff ${evDiff} finalEq ${finalEq} faults ${a.faults().length}/${b.faults().length} viol ${a.checkInvariants().length}/${b.checkInvariants().length}`);
    expect(stateDiff).toBeNull();
    expect(evDiff).toBeNull();
    expect(finalEq).toBe(true);
    expect(a.faults().length + b.faults().length).toBe(0);
  });
});
