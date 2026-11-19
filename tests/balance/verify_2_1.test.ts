/**
 * INDEPENDENT skeptic verification #2.1 of the balance pass. Own loop, own player, own household-size rule and
 * FRESH seeds 3001-3010 (neither the tuning seeds 11-55 nor the earlier skeptic seeds 1001-1010).
 *
 * Run: npx vitest run --config tests/balance/vitest.config.ts tests/balance/verify_2_1.test.ts
 * Env: VERIFY_SEEDS=3001,3002 to narrow; VERIFY_OUT=/path.json to dump the raw results.
 * Measures only. The tests hard-assert faults = 0, invariants clean and save/load determinism; the balance targets
 * are judged in the printed summary (MET / NOT MET), not asserted, so a single run reports everything.
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

const SEEDS = (process.env.VERIFY_SEEDS ?? '3001,3002,3003,3004,3005,3006,3007,3008,3009,3010').split(',').map(Number);
const LOW = 15;
const tick0 = (): Promise<void> => new Promise((r) => setImmediate(r));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sim = SimulationAPI & { engine: any };

const CATALOG = buildCazCatalog(loadContent(), LOT_TEMPLATES);
/** Own rule: 3 zombies unless seed % 3 === 0 (biased to the thin 3-zombie case). */
function opts(seed: number): NewGameOptions {
  const { householdName, members } = randomHousehold(seed, CATALOG, seed % 3 === 0 ? 2 : 3);
  return { seed, householdName, members, lotTemplate: 'starter', difficulty: 'normal' as WorldState['settings']['difficulty'] };
}

function buyNear(sim: SimulationAPI, defId: string, cx: number, cz: number, maxD = 10): boolean {
  const { width, depth } = sim.state.lot;
  const c: [number, number, number][] = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) c.push([Math.max(Math.abs(x - cx), Math.abs(z - cz)), z, x]);
  c.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [d, z, x] of c) {
    if (d > maxD) return false;
    for (const rot of [2, 0, 1, 3] as const) {
      if (!sim.build.preview({ type: 'buy', defId, x, z, rot }).ok) continue;
      if (sim.build.apply({ type: 'buy', defId, x, z, rot }).ok) { sim.build.clearHistory(); return true; }
    }
  }
  return false;
}

interface NeedTally { hours: number; low: Record<NeedId, number>; min: Record<NeedId, number> }
const nt = (): NeedTally => ({ hours: 0, low: Object.fromEntries(NEED_IDS.map((n) => [n, 0])) as Record<NeedId, number>, min: Object.fromEntries(NEED_IDS.map((n) => [n, 100])) as Record<NeedId, number> });

interface R {
  seed: number; mode: 'A' | 'B'; n: number; daysTarget: number; daysSurvived: number; gameOver: boolean;
  crumbles: { who: string; day: number }[];
  stay: NeedTally; work: NeedTally; workerIds: number;
  funds: number[]; slope7: number; slopeLast7: number;
  repoVisits: number; repossessions: number; lateBills: number; powerCuts: number; fires: number;
  worstSpam: { who: string; iid: string; n: number; day: number }; spamOver6: string[];
  topShare: { who: string; iid: string; pct: number };
  faults: number; faultSamples: string[]; violations: string[]; counters: Record<string, number>; log: string[]; ms: number;
}

async function run(seed: number, mode: 'A' | 'B', days: number): Promise<R> {
  const t0 = performance.now();
  const sim = createSimulation(createNewWorld(opts(seed))) as Sim;
  const S = (): WorldState => sim.state;
  const ids = S().household.memberIds.slice();
  const nm = (id: string): string => S().agents[id]?.firstName ?? id;
  const tallies = new Map(ids.map((id) => [id, nt()]));
  const everWorker = new Set<string>();
  const crumbles: R['crumbles'] = [];
  const seenUid = new Map<string, number>();
  const perDay = new Map<string, number>(); // `${day}\t${id}\t${iid}` (socials pooled over partners)
  const awake = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const funds: number[] = [S().household.funds];
  const viol: string[] = [];
  const lateIds = new Set<string>();
  let repoVisits = 0, prevRepo = S().household.repoDispatchedDay;
  const log: string[] = [];
  const keyObjs = Object.values(S().objects).filter((o) => ['fridge_humming', 'stove_greasefire'].includes(o.defId) && o.placement.kind === 'floor')
    .map((o) => ({ defId: o.defId, p: o.placement as { x: number; z: number; rot: 0 | 1 | 2 | 3 } }));
  const cof = Object.values(S().objects).find((o) => o.defId.startsWith('coffin') && o.placement.kind === 'floor');
  const anchor = cof && cof.placement.kind === 'floor' ? { x: cof.placement.x, z: cof.placement.z } : { x: 12, z: 11 };
  const sleepy = new Map<string, boolean>();
  const isSleep = (iid: string): boolean => {
    let v = sleepy.get(iid);
    if (v === undefined) { const t = sim.content.interactions[iid]?.tags ?? []; v = t.includes('sleep') || t.includes('nap'); sleepy.set(iid, v); }
    return v;
  };
  let jobber: string | undefined;
  let hired = false, jobTries = 0, chill = false, station = false;
  let survived = days;
  const total = days * TICKS_PER_DAY;

  for (let i = 1; i <= total; i++) {
    sim.step();
    const tick = S().tick;
    const ti = timeInfo(tick);
    for (const id of ids) {
      const a = S().agents[id];
      if (!a) continue;
      const r = a.active;
      if (r && seenUid.get(id) !== r.uid) {
        seenUid.set(id, r.uid);
        if (r.source === 'auto' && r.params._origUid === undefined && !r.interactionId.startsWith('engine_')) {
          const k = `${ti.day}\t${id}\t${r.interactionId}`;
          perDay.set(k, (perDay.get(k) ?? 0) + 1);
        }
      }
      // waking share sampled EVERY tick (on lot, not sleeping, not passed out; idle counts as waking time)
      if (a.presence === 'onLot' && !a.status.passedOut && !(r && isSleep(r.interactionId))) {
        const m = awake.get(id)!; const iid = r?.interactionId ?? '(idle)';
        m.set(iid, (m.get(iid) ?? 0) + 1);
      }
    }
    if (i % TICKS_PER_HOUR !== 0) continue;
    sim.drainEvents();
    for (const id of ids) {
      const a = S().agents[id];
      if (!a) continue;
      if (a.career) everWorker.add(id);
      if ((a.presence === 'crumbled' || a.presence === 'gone') && !crumbles.some((c) => c.who === id)) crumbles.push({ who: id, day: ti.day });
      if (a.presence !== 'onLot') continue;
      const t = tallies.get(id)!; t.hours++;
      for (const n of NEED_IDS) { const v = a.needs[n]; if (v < LOW) t.low[n]++; if (v < t.min[n]) t.min[n] = Math.round(v); }
    }
    for (const b of S().household.bills) if ((b.paidTick === null && tick > b.dueTick) || (b.paidTick !== null && b.paidTick > b.dueTick)) lateIds.add(b.id);
    const rd = S().household.repoDispatchedDay; if (rd !== null && rd !== prevRepo) repoVisits++; prevRepo = rd;
    for (const v of sim.checkInvariants()) if (viol.length < 20) viol.push(`t${tick} ${v}`);
    if (mode === 'B') {
      const h = ti.hour;
      if (!hired && jobTries < 10 && (jobTries === 0 || ti.hour % 3 === 0)) {
        jobTries++;
        jobber ??= ids.find((x) => S().agents[x]?.presence === 'onLot');
        const id = jobber && S().agents[jobber]?.presence === 'onLot' && !(S().agents[jobber]?.queue ?? []).some((q) => q.interactionId === 'phone_findJob') ? jobber : undefined;
        const career = seed % 4 < 2 ? 'mortuary' : 'necrotech';
        if (id && sim.dispatch({ type: 'queue', actorId: id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: career } }).ok) log.push(`d${ti.day}h${h} queued job ${career} for ${nm(id)}`);
      }
      if (!hired && ids.some((x) => S().agents[x]?.career)) { hired = true; log.push(`d${ti.day}h${h} hired`); }
      if (!chill && ti.day === 1 && h >= 15) { chill = true; log.push(`chill ${S().household.funds >= 1400 && buyNear(sim, 'coffin_chillrest', anchor.x, anchor.z)}`); }
      if (!station && S().household.funds >= 3000 && h >= 9 && h <= 21 && buyNear(sim, 'station_embalming', anchor.x, anchor.z)) { station = true; log.push(`d${ti.day} station`); }
      if (h >= 7 && h <= 23) for (const e of keyObjs) {
        if (Object.values(S().objects).some((o) => o.defId === e.defId)) continue;
        const ok = sim.build.apply({ type: 'buy', defId: e.defId, x: e.p.x, z: e.p.z, rot: e.p.rot }).ok || buyNear(sim, e.defId, e.p.x, e.p.z, 3);
        if (ok) sim.build.clearHistory();
        log.push(`d${ti.day}h${h} rebuy ${e.defId} ${ok}`);
      }
    }
    if (ti.hour === 0) funds.push(S().household.funds);
    if (S().gameOver) { survived = Math.floor(tick / TICKS_PER_DAY); break; }
    if (i % (2 * TICKS_PER_HOUR) === 0) await tick0();
  }

  const stay = nt(), work = nt();
  for (const id of ids) {
    const d = everWorker.has(id) ? work : stay, s = tallies.get(id)!;
    d.hours += s.hours; for (const n of NEED_IDS) { d.low[n] += s.low[n]; d.min[n] = Math.min(d.min[n], s.min[n]); }
  }
  const worst = { who: '', iid: '', n: 0, day: 0 }; const spam: string[] = [];
  for (const [k, n] of perDay) {
    const [d, id, iid] = k.split('\t'); const def = sim.content.interactions[iid];
    if (!def || isEssentialInteraction(sim.engine, def)) continue;
    if (n > worst.n) Object.assign(worst, { who: nm(id), iid, n, day: +d });
    if (n > 6) spam.push(`${nm(id)} ${iid} x${n} d${d}`);
  }
  const top = { who: '', iid: '', pct: 0 };
  for (const id of ids) {
    const m = awake.get(id)!; let tot = 0; for (const v of m.values()) tot += v;
    for (const [iid, v] of m) { if (iid === '(idle)' || iid.startsWith('engine_')) continue; const p = (100 * v) / tot; if (p > top.pct) Object.assign(top, { who: nm(id), iid, pct: Math.round(p * 10) / 10 }); }
  }
  const slope = (pts: [number, number][]): number => {
    if (pts.length < 2) return 0;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let a = 0, b = 0; for (const [x, y] of pts) { a += (x - mx) * (y - my); b += (x - mx) ** 2; }
    return Math.round(a / b);
  };
  const fp = funds.map((f, d) => [d, f] as [number, number]);
  const c = S().stats.counters; const f = sim.faults();
  return {
    seed, mode, n: ids.length, daysTarget: days, daysSurvived: survived, gameOver: S().gameOver,
    crumbles: crumbles.map((x) => ({ who: nm(x.who), day: x.day })), stay, work, workerIds: everWorker.size,
    funds, slope7: slope(fp.filter(([d]) => d >= 7)), slopeLast7: slope(fp.slice(-8)),
    repoVisits, repossessions: c.repossessions ?? 0, lateBills: lateIds.size, powerCuts: c.powerCuts ?? 0, fires: c.firesStarted ?? c.fires ?? 0,
    worstSpam: worst, spamOver6: spam.slice(0, 20), topShare: top,
    faults: f.length, faultSamples: f.slice(0, 5).map((x) => `${x.where}: ${x.message}`), violations: viol,
    counters: { ...c }, log, ms: Math.round(performance.now() - t0),
  };
}

const p = (t: NeedTally, n: NeedId): number => (t.hours ? Math.round((1000 * t.low[n]) / t.hours) / 10 : 0);
const fmt = (r: R): string =>
  `[${r.mode} ${r.seed} n=${r.n} w=${r.workerIds}] ${r.daysSurvived}/${r.daysTarget}d crumbles ${JSON.stringify(r.crumbles)} | stay(${r.stay.hours}h) ` +
  NEED_IDS.map((n) => `${n} ${p(r.stay, n)}%/${r.stay.min[n]}`).join(' ') +
  ` | work(${r.work.hours}h) fun ${p(r.work, 'fun')}%/${r.work.min.fun} | funds ${r.funds[0]}->${r.funds[r.funds.length - 1]} slope7 ${r.slope7} last7 ${r.slopeLast7}` +
  ` | repo ${r.repoVisits}/${r.repossessions} late ${r.lateBills} cuts ${r.powerCuts} fires ${r.fires} | spam ${JSON.stringify(r.worstSpam)} >6:${r.spamOver6.length} | top ${JSON.stringify(r.topShare)}` +
  ` | faults ${r.faults} viol ${r.violations.length} | ${r.ms}ms | ${r.log.join('; ')}`;

const results: R[] = [];
const dump = (): void => { if (process.env.VERIFY_OUT) writeFileSync(process.env.VERIFY_OUT, JSON.stringify(results, null, 1)); };

function verdicts(): void {
  const A = results.filter((r) => r.mode === 'A'), B = results.filter((r) => r.mode === 'B');
  const out: string[] = [];
  const v = (ok: boolean, name: string, s: string): void => { out.push(`${ok ? 'MET    ' : 'NOT MET'} ${name}: ${s}`); };
  if (A.length) {
    const surv = A.filter((r) => r.daysSurvived >= 10 && !r.crumbles.some((c) => c.day < 10)).length;
    v(surv >= Math.ceil(0.8 * A.length), 'A survives >=10d in >=80% seeds', `${surv}/${A.length}`);
    const early = A.filter((r) => r.crumbles.some((c) => c.day < 8));
    v(early.length === 0, 'A nobody crumbles before day 8', `${early.length} runs with early crumble; all crumbles ${JSON.stringify(A.flatMap((r) => r.crumbles.map((c) => `${r.seed}:${c.who}@d${c.day}`)))}`);
    const worstStay = Math.max(0, ...A.flatMap((r) => NEED_IDS.map((n) => p(r.stay, n))));
    v(worstStay < 5, 'A stay-home each need <15 in <5% hours', `worst ${worstStay}%`);
  }
  if (B.length) {
    const cr = B.filter((r) => r.crumbles.length > 0 || r.gameOver);
    v(cr.length === 0, 'B nobody crumbles 21d', `${B.length - cr.length}/${B.length} clean`);
    const wf = Math.max(0, ...B.map((r) => p(r.work, 'fun')));
    v(wf < 5, 'B workers Amusement<15 <5% hours', `worst ${wf}% (per seed ${B.map((r) => p(r.work, 'fun')).join(',')})`);
    const neg = B.filter((r) => r.slope7 <= 0);
    v(neg.length === 0, 'B funds trend upward after d7', `slopes ${B.map((r) => r.slope7).join(',')} $/d; last-7d ${B.map((r) => r.slopeLast7).join(',')}`);
    const repo = B.reduce((s, r) => s + r.repoVisits, 0);
    v(repo === 0, 'B zero repo visits', `repo ${repo}, late ${B.reduce((s, r) => s + r.lateBills, 0)}, cuts ${B.reduce((s, r) => s + r.powerCuts, 0)}`);
  }
  const all = results;
  const worstSpam = Math.max(0, ...all.map((r) => r.worstSpam.n));
  v(worstSpam <= 6, 'no non-essential action >6/zombie/day', `worst ${worstSpam} (${all.filter((r) => r.spamOver6.length).map((r) => `${r.mode}${r.seed}:${r.spamOver6.join('|')}`).join(' ; ') || 'none above 6'})`);
  const worstShare = Math.max(0, ...all.map((r) => r.topShare.pct));
  v(worstShare <= 25, 'no non-sleep interaction >25% waking', `worst ${worstShare}% ${JSON.stringify(all.reduce((a, r) => (r.topShare.pct > a.topShare.pct ? r : a)).topShare)}`);
  v(all.every((r) => r.faults === 0), 'faults 0', `${all.reduce((s, r) => s + r.faults, 0)}`);
  v(all.every((r) => r.violations.length === 0), 'hourly invariants clean', `${all.reduce((s, r) => s + r.violations.length, 0)} violations`);
  console.log(`\n==== VERIFY 2.1 VERDICTS ====\n${out.join('\n')}\n`);
}

describe('skeptic verification 2.1 (fresh seeds 3001-3010)', () => {
  it('A: unattended normal, 14 days', async () => {
    for (const s of SEEDS) { const r = await run(s, 'A', 14); results.push(r); console.log(fmt(r)); dump(); }
    for (const r of results.filter((x) => x.mode === 'A')) { expect(r.faults, r.faultSamples.join('\n')).toBe(0); expect(r.violations).toEqual([]); }
  });

  it('B: reasonable player normal, 21 days', async () => {
    for (const s of SEEDS) { const r = await run(s, 'B', 21); results.push(r); console.log(fmt(r)); dump(); }
    verdicts();
    for (const r of results.filter((x) => x.mode === 'B')) { expect(r.faults, r.faultSamples.join('\n')).toBe(0); expect(r.violations).toEqual([]); }
  });

  it('save -> load -> continue is identical over 2 game days (seed 3004, player actions, odd tick)', async () => {
    const o = opts(3004);
    const a = createSimulation(createNewWorld(o));
    const saveAt = 5 * TICKS_PER_HOUR + 113; // day 1 ~14:28, after the job call is queued
    let jobOk: unknown = null;
    for (let i = 1; i <= saveAt; i++) {
      a.step();
      if (i === 30) jobOk = a.dispatch({ type: 'queue', actorId: a.state.household.memberIds[0], interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'necrotech' } }).ok;
      if (i % TICKS_PER_HOUR === 0) a.drainEvents();
    }
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: { warn: () => undefined, error: () => undefined }, repair: engineRepairHook() });
    const saved = await mgr.save('s', 's', a.serialize(), { householdName: o.householdName, memberNames: [], day: 1, timeLabel: 't', funds: a.state.household.funds, lotValue: 0, thumbnail: null });
    expect(saved.ok).toBe(true);
    const loaded = await mgr.load('s');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const b = createSimulation(loaded.world);
    expect(b.repairWarnings).toEqual([]);
    let diverged = -1;
    for (let i = 1; i <= 2 * TICKS_PER_DAY; i++) {
      a.step(); b.step();
      if (i % (TICKS_PER_HOUR / 2) === 0) {
        if (canonicalJson(a.serialize()) !== canonicalJson(b.serialize())) { diverged = i; break; }
        a.drainEvents(); b.drainEvents();
      }
      if (i % (2 * TICKS_PER_HOUR) === 0) await tick0();
    }
    console.log(`[determinism 3004] save@${saveAt}, +${2 * TICKS_PER_DAY} ticks, compared every 30 game min: ${diverged < 0 ? 'IDENTICAL' : `DIVERGED at +${diverged}`}; faults ${a.faults().length}/${b.faults().length}; jobQueued ${String(jobOk)} career ${a.state.agents[a.state.household.memberIds[0]]?.career?.careerId ?? 'none'}`);
    expect(diverged).toBe(-1);
    expect(a.faults()).toEqual([]);
  });
});
