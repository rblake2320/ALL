/**
 * INDEPENDENT skeptic check (round 2) of the balance pass. Own loop, own player script, own household-size rule,
 * and seeds 2001-2010 — NOT 11/22/33/44/55 (tuned) nor 1001-1010 (used by the round-1 skeptics and then tuned
 * against in BALANCE.md §5.8).
 *
 * Run: npx vitest run --config tests/balance/vitest.config.ts tests/balance/verify_2_2.test.ts
 * VERIFY_SEEDS=2001,2002 narrows; VERIFY_PART=A|B|D runs one part; VERIFY_OUT=<file> writes JSON.
 * Measures only; targets are judged in the report. Asserts only faults / invariants / determinism.
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
const SEEDS = (process.env.VERIFY_SEEDS ?? '2001,2002,2003,2004,2005,2006,2007,2008,2009,2010').split(',').map(Number);
const PART = process.env.VERIFY_PART ?? 'ALL';
const CRIT = 15;
const TRACE = process.env.VERIFY_TRACE?.split(':'); // seed:day:firstName:interactionId
const pause = (): Promise<void> => new Promise((r) => setImmediate(r));

function opts(seed: number, difficulty: WorldState['settings']['difficulty'] = 'normal'): NewGameOptions {
  const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
  const count = seed % 4 < 2 ? 3 : 2; // own rule: 2001/04/05/08/09 -> 3 zombies, others 2
  const { householdName, members } = randomHousehold(seed * 31 + 7, catalog, count);
  return { seed, householdName, members, lotTemplate: 'starter', difficulty };
}

interface T { h: number; c: Record<NeedId, number>; m: Record<NeedId, number> }
const mk = (): T => ({ h: 0, c: Object.fromEntries(NEED_IDS.map((n) => [n, 0])) as Record<NeedId, number>, m: Object.fromEntries(NEED_IDS.map((n) => [n, 100])) as Record<NeedId, number> });
const pct = (t: T, n: NeedId): number => (t.h ? Math.round((1000 * t.c[n]) / t.h) / 10 : 0);

interface R {
  part: string; seed: number; n: number; days: number; ran: number; gameOver: boolean;
  crumbles: string[]; stay: T; work: T; funds: number[]; slope7: number; minFunds: number;
  repo: number; repossess: number; cuts: number; late: number; fires: number;
  maxNE: string; maxNEn: number; over6: string[]; topShare: number; top: string;
  faults: string[]; viol: string[]; careers: string[]; log: string[]; s: number;
}

function slope(f: number[], from: number): number {
  const p = f.map((v, d) => [d, v] as const).filter(([d]) => d >= from);
  if (p.length < 2) return NaN;
  const mx = p.reduce((s, [d]) => s + d, 0) / p.length, my = p.reduce((s, [, v]) => s + v, 0) / p.length;
  let a = 0, b = 0;
  for (const [d, v] of p) { a += (d - mx) * (v - my); b += (d - mx) ** 2; }
  return Math.round((a / b) * 10) / 10;
}

function buyAround(sim: Sim, defId: string, cx: number, cz: number, maxD = 7): boolean {
  const cand: [number, number, number][] = [];
  for (let x = 0; x < sim.state.lot.width; x++) for (let z = 0; z < sim.state.lot.depth; z++) {
    const d = Math.max(Math.abs(x - cx), Math.abs(z - cz));
    if (d <= maxD) cand.push([d, z, x]);
  }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, z, x] of cand) for (const rot of [1, 3, 0, 2] as const) {
    if (sim.build.apply({ type: 'buy', defId, x, z, rot }).ok) { sim.build.clearHistory(); return true; }
  }
  return false;
}

async function run(part: 'A' | 'B', seed: number, days: number): Promise<R> {
  const t0 = performance.now();
  const sim = createSimulation(createNewWorld(opts(seed))) as Sim;
  const ids = sim.state.household.memberIds.slice();
  const nm = (id: string): string => sim.state.agents[id]?.firstName ?? id;
  const per = new Map(ids.map((id) => [id, mk()]));
  const worker = new Set<string>();
  const crumbles: string[] = [];
  const seenUid = new Map<string, number>();
  const fresh = new Map<string, number>();
  const awake = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const awakeN = new Map(ids.map((id) => [id, 0]));
  const funds = [sim.state.household.funds];
  let minFunds = funds[0];
  const viol: string[] = [];
  const late = new Set<string>();
  let repo = 0, lastRepo = sim.state.household.repoDispatchedDay;
  const log: string[] = [];
  const keep = Object.values(sim.state.objects).filter((o) => ['fridge_humming', 'stove_greasefire'].includes(o.defId) && o.placement.kind === 'floor')
    .map((o) => ({ defId: o.defId, p: o.placement as { x: number; z: number; rot: 0 | 1 | 2 | 3 } }));
  const anyCoffin = Object.values(sim.state.objects).find((o) => o.defId.startsWith('coffin') && o.placement.kind === 'floor');
  const bed = anyCoffin && anyCoffin.placement.kind === 'floor' ? { x: anyCoffin.placement.x, z: anyCoffin.placement.z } : { x: 12, z: 12 };
  const sleepy = (iid: string): boolean => { const t = sim.content.interactions[iid]?.tags ?? []; return t.includes('sleep') || t.includes('nap'); };
  let hired = part !== 'B', chill = part !== 'B', station = part !== 'B';
  const career = Math.floor(seed / 2) % 2 === 0 ? 'mortuary' : 'necrotech'; // own rotation
  let ran = days;

  for (let i = 1; i <= days * TICKS_PER_DAY; i++) {
    sim.step();
    const tick = sim.state.tick;
    const ti = timeInfo(tick);
    for (const id of ids) {
      const a = sim.state.agents[id];
      if (!a) continue;
      const r = a.active;
      if (r && seenUid.get(id) !== r.uid) {
        seenUid.set(id, r.uid);
        if (r.source === 'auto' && r.params._origUid === undefined && !r.interactionId.startsWith('engine_')) {
          const k = `${ti.day}|${id}|${r.interactionId}`; // socials: one key over all partners
          fresh.set(k, (fresh.get(k) ?? 0) + 1);
          if (TRACE && TRACE[0] === String(seed) && TRACE[1] === String(ti.day) && TRACE[2] === nm(id) && TRACE[3] === r.interactionId)
            console.log(`[TRACE] ${part} ${ti.hour}:${String(ti.minute ?? '').padStart(2, '0')} uid${r.uid} -> ${r.target.kind === 'agent' ? nm(r.target.id) : r.target.kind} fun ${Math.round(a.needs.fun)} soc ${Math.round(a.needs.social)}`);
        }
      }
      if ((i & 1) === 0 && a.presence === 'onLot' && !a.status.passedOut && !(r && sleepy(r.interactionId))) {
        awakeN.set(id, awakeN.get(id)! + 1);
        const iid = r?.interactionId ?? '(idle)';
        const m = awake.get(id)!; m.set(iid, (m.get(iid) ?? 0) + 1);
      }
    }
    if (tick % TICKS_PER_HOUR !== 0) continue;
    sim.drainEvents();
    for (const id of ids) {
      const a = sim.state.agents[id];
      if (!a) continue;
      if (a.career) worker.add(id);
      if ((a.presence === 'crumbled' || a.presence === 'gone') && !crumbles.some((c) => c.startsWith(nm(id) + ' '))) crumbles.push(`${nm(id)} d${ti.day} ${a.presence}`);
      if (a.presence !== 'onLot') continue;
      const t = per.get(id)!; t.h++;
      for (const n of NEED_IDS) { if (a.needs[n] < CRIT) t.c[n]++; t.m[n] = Math.min(t.m[n], Math.round(a.needs[n])); }
    }
    for (const b of sim.state.household.bills) if (tick > b.dueTick && (b.paidTick === null || b.paidTick > b.dueTick)) late.add(b.id);
    const rd = sim.state.household.repoDispatchedDay;
    if (rd !== null && rd !== lastRepo) repo++;
    lastRepo = rd;
    for (const v of sim.checkInvariants()) if (viol.length < 10) viol.push(`t${tick} ${v}`);
    minFunds = Math.min(minFunds, sim.state.household.funds);
    if (part === 'B') {
      if (!hired && ti.hour >= 10) {
        const id = ids.find((x) => sim.state.agents[x]?.presence === 'onLot');
        if (id && sim.dispatch({ type: 'queue', actorId: id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: career } }).ok) { hired = true; log.push(`d${ti.day} job ${career}->${nm(id)}`); }
      }
      if (!chill && ti.hour >= 12) { chill = true; log.push(`chill ${sim.state.household.funds >= 1000 && buyAround(sim, 'coffin_chillrest', bed.x, bed.z)}`); }
      if (!station && sim.state.household.funds >= 3000 && ti.hour >= 9 && ti.hour <= 21 && buyAround(sim, 'station_embalming', bed.x, bed.z)) { station = true; log.push(`d${ti.day} station`); }
      if (ti.hour >= 8 && ti.hour <= 22) for (const e of keep) {
        if (Object.values(sim.state.objects).some((o) => o.defId === e.defId)) continue;
        let ok = sim.build.apply({ type: 'buy', defId: e.defId, x: e.p.x, z: e.p.z, rot: e.p.rot }).ok;
        if (ok) sim.build.clearHistory(); else ok = buyAround(sim, e.defId, e.p.x, e.p.z, 3);
        log.push(`d${ti.day}h${ti.hour} rebuy ${e.defId} ${ok}`);
      }
    }
    if (ti.hour === 0) funds.push(sim.state.household.funds);
    if (sim.state.gameOver) { ran = ti.day; break; }
    if (tick % (2 * TICKS_PER_HOUR) === 0) await pause();
  }

  const stay = mk(), work = mk();
  for (const id of ids) {
    const dst = worker.has(id) ? work : stay, src = per.get(id)!;
    dst.h += src.h;
    for (const n of NEED_IDS) { dst.c[n] += src.c[n]; dst.m[n] = Math.min(dst.m[n], src.m[n]); }
  }
  let maxNEn = 0, maxNE = '';
  const over6: string[] = [];
  for (const [k, n] of fresh) {
    const [d, id, iid] = k.split('|');
    const def = sim.content.interactions[iid];
    if (!def || isEssentialInteraction(sim.engine, def)) continue;
    if (n > maxNEn) { maxNEn = n; maxNE = `${nm(id)} ${iid} d${d}`; }
    if (n > 6) over6.push(`${nm(id)} ${iid} x${n} d${d}`);
  }
  let topShare = 0, top = '';
  for (const id of ids) for (const [iid, v] of awake.get(id)!) {
    if (iid === '(idle)' || iid.startsWith('engine_')) continue;
    const s = (100 * v) / Math.max(1, awakeN.get(id)!);
    if (s > topShare) { topShare = Math.round(s * 10) / 10; top = `${nm(id)} ${iid}`; }
  }
  const c = sim.state.stats.counters;
  return {
    part, seed, n: ids.length, days, ran, gameOver: sim.state.gameOver, crumbles, stay, work, funds, slope7: slope(funds, 7), minFunds,
    repo, repossess: c.repossessions ?? 0, cuts: c.powerCuts ?? 0, late: late.size, fires: c.firesStarted ?? 0,
    maxNE, maxNEn, over6, topShare, top,
    faults: sim.faults().slice(0, 5).map((f) => `${f.where}: ${f.message}`), viol,
    careers: ids.map((id) => { const k = sim.state.agents[id]?.career; return k ? `${nm(id)}:${k.trackId}L${k.level}` : `${nm(id)}:-`; }),
    log, s: Math.round((performance.now() - t0) / 1000),
  };
}

function line(r: R): string {
  const sh = NEED_IDS.map((n) => `${n.slice(0, 4)}${pct(r.stay, n)}%/${r.stay.m[n]}`).join(' ');
  return `[${r.part} ${r.seed} ${r.n}z] ${r.ran}/${r.days}d crumbles=${JSON.stringify(r.crumbles)} | stay(${r.stay.h}h) ${sh} | work(${r.work.h}h) fun<15 ${pct(r.work, 'fun')}% min${r.work.m.fun} | funds ${r.funds[0]}→${r.funds[7] ?? '?'}→${r.funds.at(-1)} min${r.minFunds} slope7 ${r.slope7} | repo ${r.repo}/${r.repossess} cuts ${r.cuts} late ${r.late} fires ${r.fires} | NE/day ${r.maxNEn} (${r.maxNE}) over6 ${r.over6.length} | top ${r.topShare}% ${r.top} | faults ${r.faults.length} viol ${r.viol.length} | ${r.careers.join(',')} | ${r.s}s | ${r.log.join('; ')}${r.faults.length ? '\n  F: ' + r.faults.join(' | ') : ''}${r.viol.length ? '\n  V: ' + r.viol.join(' | ') : ''}`;
}

const out: R[] = [];
const save = (): void => { if (process.env.VERIFY_OUT) writeFileSync(process.env.VERIFY_OUT, JSON.stringify(out, null, 1)); };
const want = (p: string): boolean => PART === 'ALL' || PART === p;

describe('skeptic round 2 (seeds 2001-2010)', () => {
  it.runIf(want('A'))('A: unattended normal 14 days', async () => {
    for (const s of SEEDS) { const r = await run('A', s, 14); out.push(r); console.log(line(r)); save(); }
    const rs = out.filter((r) => r.part === 'A');
    expect(rs.flatMap((r) => r.faults)).toEqual([]);
    expect(rs.flatMap((r) => r.viol)).toEqual([]);
  });

  it.runIf(want('B'))('B: reasonable player normal 21 days', async () => {
    for (const s of SEEDS) { const r = await run('B', s, 21); out.push(r); console.log(line(r)); save(); }
    const rs = out.filter((r) => r.part === 'B');
    expect(rs.flatMap((r) => r.faults)).toEqual([]);
    expect(rs.flatMap((r) => r.viol)).toEqual([]);
  });

  it.runIf(want('D'))('save -> load -> continue deterministic over 2 game days (seed 2003)', async () => {
    const o = opts(2003);
    const a = createSimulation(createNewWorld(o)) as Sim;
    a.dispatch({ type: 'queue', actorId: a.state.household.memberIds[0], interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'necrotech' } });
    const at = 3 * TICKS_PER_DAY + 18 * TICKS_PER_HOUR + 113; // day 4, evening, off-hour
    while (a.state.tick < at) { a.step(); if (a.state.tick % TICKS_PER_HOUR === 0) a.drainEvents(); }
    a.drainEvents();
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), repair: engineRepairHook(), logger: { warn() {}, error() {}, info() {} } as never });
    const sv = await mgr.save('s', 'S', a.serialize(), { householdName: o.householdName, memberNames: [], day: 4, timeLabel: '', funds: a.state.household.funds, lotValue: 0, thumbnail: null });
    expect(sv.ok, JSON.stringify(sv)).toBe(true);
    const ld = await mgr.load('s');
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
        if (i % (4 * TICKS_PER_HOUR) === 0) await pause();
      }
    }
    console.log(`[DET] seed 2003 save@${at} +${2 * TICKS_PER_DAY}: stateDiff ${stateDiff} evDiff ${evDiff} faults ${a.faults().length}/${b.faults().length} viol ${a.checkInvariants().length}/${b.checkInvariants().length}`);
    expect(stateDiff).toBeNull();
    expect(evDiff).toBeNull();
    expect(a.faults().length + b.faults().length).toBe(0);
  });
});
