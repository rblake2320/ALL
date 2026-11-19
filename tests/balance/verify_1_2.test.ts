/**
 * INDEPENDENT verification of the balance pass (skeptic run). Own measurement loop, own player script,
 * seeds 1001-1010 (not the 11/22/33/44/55 the balance pass tuned against).
 *
 * Run: npx vitest run --config tests/balance/vitest.config.ts tests/balance/verify_1_2.test.ts
 * Set VERIFY_SEEDS=1001,1002 to narrow. Results are written to VERIFY_OUT (JSON) if set.
 * Measures only; the targets are judged in the report (the tests assert only faults / invariants / determinism).
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

const SEEDS = (process.env.VERIFY_SEEDS ?? '1001,1002,1003,1004,1005,1006,1007,1008,1009,1010').split(',').map(Number);
const CRIT = 15;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySim = SimulationAPI & { engine: any };

function options(seed: number, difficulty: WorldState['settings']['difficulty']): NewGameOptions {
  const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
  const count = 2 + (seed % 2); // own rule (harness uses an rng draw)
  const { householdName, members } = randomHousehold(seed, catalog, count);
  return { seed, householdName, members, lotTemplate: 'starter', difficulty };
}

/** Nearest valid buy spot to (cx,cz), scanning the whole lot. */
function buyNearest(sim: SimulationAPI, defId: string, cx: number, cz: number): boolean {
  const { width, depth } = sim.state.lot;
  const spots: [number, number, number][] = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) spots.push([Math.abs(x - cx) + Math.abs(z - cz), x, z]);
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [d, x, z] of spots) {
    if (d > 8) break;
    for (const rot of [0, 1, 2, 3] as const) {
      const pv = sim.build.preview({ type: 'buy', defId, x, z, rot });
      if (!pv.ok) continue;
      if (sim.build.apply({ type: 'buy', defId, x, z, rot }).ok) {
        sim.build.clearHistory();
        return true;
      }
    }
  }
  return false;
}

interface Tally { hours: number; crit: Record<NeedId, number>; min: Record<NeedId, number> }
const tally = (): Tally => ({ hours: 0, crit: Object.fromEntries(NEED_IDS.map((n) => [n, 0])) as Record<NeedId, number>, min: Object.fromEntries(NEED_IDS.map((n) => [n, 100])) as Record<NeedId, number> });

interface Result {
  seed: number; mode: string; members: number; days: number; daysRun: number; gameOver: boolean;
  crumbles: { name: string; day: number }[];
  stayHome: Tally; workers: Tally;
  funds: number[]; slopeFrom7: number;
  repoVisits: number; powerCuts: number; lateBills: number; billsIssued: number; billsPaid: number; fires: number;
  maxNonEssentialPerDayEngine: { who: string; iid: string; n: number; day: number };
  maxAnyNonTagEssentialPerDay: { who: string; iid: string; n: number; day: number };
  maxSocialPerPartnerPerDay: number;
  spamOver6: string[];
  topAwakeShare: { who: string; iid: string; share: number };
  faults: number; faultSamples: string[]; violations: string[];
  playerLog: string[]; ms: number;
}

const TAG_ESSENTIAL = new Set(['eat', 'cook', 'snack', 'sleep', 'nap', 'hygiene', 'preserve', 'embalm', 'money', 'fire', 'repair', 'limb', 'reanimate', 'clean']);

async function run(seed: number, mode: 'unattended' | 'player', days: number): Promise<Result> {
  const t0 = performance.now();
  const sim = createSimulation(createNewWorld(options(seed, 'normal'))) as AnySim;
  const ids = sim.state.household.memberIds.slice();
  const name = (id: string): string => sim.state.agents[id]?.firstName ?? id;
  const tallies = new Map(ids.map((id) => [id, tally()]));
  const workers = new Set<string>();
  const crumbles: { name: string; day: number }[] = [];
  const lastUid = new Map<string, number>();
  const runs = new Map<string, number>(); // day|id|iid
  const socialPair = new Map<string, number>();
  const awake = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]));
  const funds = [sim.state.household.funds];
  const viol: string[] = [];
  const late = new Set<string>();
  let repo = 0;
  let lastRepo = sim.state.household.repoDispatchedDay;
  const log: string[] = [];
  let job = false, chill = false, station = false;
  const essentials = Object.values(sim.state.objects).filter((o) => (o.defId === 'fridge_humming' || o.defId === 'stove_greasefire') && o.placement.kind === 'floor')
    .map((o) => ({ defId: o.defId, p: o.placement as { x: number; z: number; rot: 0 | 1 | 2 | 3 } }));
  const coffin = Object.values(sim.state.objects).find((o) => o.defId.startsWith('coffin') && o.placement.kind === 'floor');
  const bed = coffin && coffin.placement.kind === 'floor' ? { x: coffin.placement.x, z: coffin.placement.z } : { x: 12, z: 11 };
  const isSleep = (iid: string): boolean => { const t = sim.content.interactions[iid]?.tags ?? []; return t.includes('sleep') || t.includes('nap'); };
  let daysRun = days;

  const total = days * TICKS_PER_DAY;
  for (let i = 1; i <= total; i++) {
    sim.step();
    const tick = sim.state.tick;
    const day = timeInfo(tick).day;
    for (const id of ids) {
      const r = sim.state.agents[id]?.active;
      if (!r || lastUid.get(id) === r.uid) continue;
      lastUid.set(id, r.uid);
      if (r.source !== 'auto' || r.params._origUid !== undefined || r.interactionId.startsWith('engine_')) continue;
      const k = `${day}|${id}|${r.interactionId}`;
      runs.set(k, (runs.get(k) ?? 0) + 1);
      if (r.target.kind === 'agent' && sim.content.interactions[r.interactionId]?.social) socialPair.set(`${k}|${r.target.id}`, (socialPair.get(`${k}|${r.target.id}`) ?? 0) + 1);
    }
    if (i % 4 === 0) {
      for (const id of ids) {
        const a = sim.state.agents[id];
        if (!a || a.presence !== 'onLot' || a.status.passedOut) continue;
        const iid = a.active?.interactionId ?? '(idle)';
        if (a.active && isSleep(iid)) continue;
        const m = awake.get(id)!;
        m.set(iid, (m.get(iid) ?? 0) + 1);
      }
    }
    if (i % TICKS_PER_HOUR !== 0) continue;
    sim.drainEvents();
    const hour = timeInfo(tick).hour;
    for (const id of ids) {
      const a = sim.state.agents[id];
      if (!a) continue;
      if (a.career) workers.add(id);
      if ((a.presence === 'crumbled' || a.presence === 'gone') && !crumbles.some((c) => c.name === name(id))) crumbles.push({ name: name(id), day });
      if (a.presence !== 'onLot') continue;
      const t = tallies.get(id)!;
      t.hours++;
      for (const n of NEED_IDS) { if (a.needs[n] < CRIT) t.crit[n]++; if (a.needs[n] < t.min[n]) t.min[n] = Math.round(a.needs[n]); }
    }
    for (const b of sim.state.household.bills) if ((b.paidTick === null && tick > b.dueTick) || (b.paidTick !== null && b.paidTick > b.dueTick)) late.add(b.id);
    const rd = sim.state.household.repoDispatchedDay;
    if (rd !== null && rd !== lastRepo) repo++;
    lastRepo = rd;
    for (const v of sim.checkInvariants()) if (viol.length < 20) viol.push(`t${tick} ${v}`);
    if (mode === 'player') {
      if (hour >= 8 && hour <= 22) for (const e of essentials) {
        if (Object.values(sim.state.objects).some((o) => o.defId === e.defId)) continue;
        const ok = sim.build.apply({ type: 'buy', defId: e.defId, x: e.p.x, z: e.p.z, rot: e.p.rot }).ok;
        if (ok) sim.build.clearHistory();
        log.push(`d${day} ${hour}h replace ${e.defId} ${ok}`);
      }
      if (!job) {
        const career = seed % 2 === 0 ? 'necrotech' : 'mortuary';
        const id = ids.find((x) => sim.state.agents[x]?.presence === 'onLot');
        if (id && sim.dispatch({ type: 'queue', actorId: id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: career } }).ok) { job = true; log.push(`d${day} ${hour}h ${name(id)} job ${career}`); }
      }
      if (!chill && hour >= 12) { chill = true; log.push(`d${day} chillrest ${sim.state.household.funds >= 1400 && buyNearest(sim, 'coffin_chillrest', bed.x, bed.z)}`); }
      if (chill && !station && sim.state.household.funds >= 3000 && hour >= 10 && hour <= 20 && buyNearest(sim, 'station_embalming', bed.x, bed.z)) { station = true; log.push(`d${day} ${hour}h station`); }
    }
    if (hour === 0) funds.push(sim.state.household.funds);
    if (sim.state.gameOver) { daysRun = Math.floor(tick / TICKS_PER_DAY); break; }
    if (i % (3 * TICKS_PER_HOUR) === 0) await yieldLoop();
  }

  const stay = tally(), work = tally();
  for (const id of ids) {
    const dst = workers.has(id) ? work : stay, src = tallies.get(id)!;
    dst.hours += src.hours;
    for (const n of NEED_IDS) { dst.crit[n] += src.crit[n]; dst.min[n] = Math.min(dst.min[n], src.min[n]); }
  }
  const maxE = { who: '', iid: '', n: 0, day: 0 }, maxT = { who: '', iid: '', n: 0, day: 0 };
  const spam: string[] = [];
  for (const [k, n] of runs) {
    const [d, id, iid] = k.split('|');
    const def = sim.content.interactions[iid];
    if (!def) continue;
    if (!isEssentialInteraction(sim.engine, def)) {
      if (n > maxE.n) Object.assign(maxE, { who: name(id), iid, n, day: +d });
      if (n > 6 && !def.social) spam.push(`${name(id)} ${iid} x${n} d${d}`);
    }
    if (!(def.tags ?? []).some((t) => TAG_ESSENTIAL.has(t)) && n > maxT.n) Object.assign(maxT, { who: name(id), iid, n, day: +d });
  }
  let maxPair = 0;
  for (const [k, n] of socialPair) { if (n > maxPair) maxPair = n; if (n > 6) spam.push(`social ${k} x${n}`); }
  const top = { who: '', iid: '', share: 0 };
  for (const id of ids) {
    const m = awake.get(id)!;
    let tot = 0; for (const v of m.values()) tot += v;
    for (const [iid, v] of m) if (iid !== '(idle)' && !iid.startsWith('engine_idle') && tot > 0 && (v / tot) * 100 > top.share) Object.assign(top, { who: name(id), iid, share: Math.round((v / tot) * 1000) / 10 });
  }
  const pts = funds.map((f, d) => [d, f] as const).filter(([d]) => d >= 7);
  const mx = pts.reduce((s, [d]) => s + d, 0) / pts.length, my = pts.reduce((s, [, f]) => s + f, 0) / pts.length;
  let num = 0, den = 0; for (const [d, f] of pts) { num += (d - mx) * (f - my); den += (d - mx) ** 2; }
  const c = sim.state.stats.counters;
  const faults = sim.faults();
  return {
    seed, mode, members: ids.length, days, daysRun, gameOver: sim.state.gameOver, crumbles, stayHome: stay, workers: work,
    funds, slopeFrom7: den ? Math.round(num / den) : 0,
    repoVisits: repo, powerCuts: c.powerCuts ?? 0, lateBills: late.size, billsIssued: c.billsIssued ?? 0, billsPaid: c.billsPaid ?? 0, fires: c.firesStarted ?? 0,
    maxNonEssentialPerDayEngine: maxE, maxAnyNonTagEssentialPerDay: maxT, maxSocialPerPartnerPerDay: maxPair, spamOver6: spam.slice(0, 20),
    topAwakeShare: top, faults: faults.length, faultSamples: faults.slice(0, 5).map((f) => `${f.where}: ${f.message}`), violations: viol,
    playerLog: log, ms: Math.round(performance.now() - t0),
  };
}

const pct = (t: Tally, n: NeedId): number => (t.hours ? Math.round((t.crit[n] / t.hours) * 1000) / 10 : 0);
function line(r: Result): string {
  const sh = NEED_IDS.map((n) => `${n}:${pct(r.stayHome, n)}%/min${r.stayHome.min[n]}`).join(' ');
  return `[${r.mode} ${r.seed} n=${r.members}] days ${r.daysRun}/${r.days} crumbles=${JSON.stringify(r.crumbles)} | stayHome(${r.stayHome.hours}h) ${sh} | workers(${r.workers.hours}h) fun<15 ${pct(r.workers, 'fun')}% min${r.workers.min.fun} | funds d0 ${r.funds[0]} end ${r.funds[r.funds.length - 1]} slope ${r.slopeFrom7}/d | repo ${r.repoVisits} cuts ${r.powerCuts} late ${r.lateBills} bills ${r.billsPaid}/${r.billsIssued} fires ${r.fires} | maxNE ${JSON.stringify(r.maxNonEssentialPerDayEngine)} maxTag ${JSON.stringify(r.maxAnyNonTagEssentialPerDay)} pair ${r.maxSocialPerPartnerPerDay} spam ${r.spamOver6.length} | top ${JSON.stringify(r.topAwakeShare)} | faults ${r.faults} viol ${r.violations.length} | ${r.ms}ms | ${r.playerLog.join('; ')}`;
}

const all: Result[] = [];
const flush = (): void => { if (process.env.VERIFY_OUT) writeFileSync(process.env.VERIFY_OUT, JSON.stringify(all, null, 1)); };

describe('independent balance verification (seeds 1001-1010)', () => {
  it('A: unattended normal, 14 days', async () => {
    for (const s of SEEDS) { const r = await run(s, 'unattended', 14); all.push(r); console.log(line(r)); flush(); }
    for (const r of all.filter((x) => x.mode === 'unattended')) { expect(r.faults, r.faultSamples.join('\n')).toBe(0); expect(r.violations).toEqual([]); }
  });

  it('B: reasonable player normal, 21 days', async () => {
    for (const s of SEEDS) { const r = await run(s, 'player', 21); all.push(r); console.log(line(r)); flush(); }
    for (const r of all.filter((x) => x.mode === 'player')) { expect(r.faults, r.faultSamples.join('\n')).toBe(0); expect(r.violations).toEqual([]); }
  });

  it('save -> load -> continue is deterministic over 2 game days (seed 1004, mid-day save)', async () => {
    const opts = options(1004, 'normal');
    const a = createSimulation(createNewWorld(opts));
    const saveAt = TICKS_PER_DAY + 7 * TICKS_PER_HOUR + 37; // day 2, mid-afternoon, off the hour
    for (let i = 0; i < saveAt; i++) a.step();
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: { warn: () => undefined, error: () => undefined }, repair: engineRepairHook() });
    const meta = { householdName: opts.householdName, memberNames: [], day: 2, timeLabel: 'x', funds: a.state.household.funds, lotValue: 0, thumbnail: null };
    const saved = await mgr.save('v', 'v', a.serialize(), meta);
    expect(saved.ok).toBe(true);
    const loaded = await mgr.load('v');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual([]);
    const b = createSimulation(loaded.world);
    expect(b.repairWarnings).toEqual([]);
    const sigs: string[] = [];
    for (let i = 1; i <= 2 * TICKS_PER_DAY; i++) {
      a.step(); b.step();
      if (i % TICKS_PER_HOUR === 0) {
        const ja = canonicalJson(a.serialize()), jb = canonicalJson(b.serialize());
        if (ja !== jb) sigs.push(`diverged at +${i} ticks`);
        a.drainEvents(); b.drainEvents();
        if (sigs.length) break;
        if (i % (3 * TICKS_PER_HOUR) === 0) await yieldLoop();
      }
    }
    console.log(`[determinism] seed 1004 save@${saveAt} +${2 * TICKS_PER_DAY} ticks: ${sigs.length ? sigs[0] : 'identical every hour'}; faults ${a.faults().length}/${b.faults().length}`);
    expect(sigs).toEqual([]);
    expect(canonicalJson(a.serialize())).toBe(canonicalJson(b.serialize()));
  });
});
