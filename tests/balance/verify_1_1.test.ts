/**
 * INDEPENDENT verification of the balance pass (docs/BALANCE.md / GDD §18), written without the balance harness.
 * Different seeds (1001–1010), own household-size rule, own player script, own metric bookkeeping.
 *
 * Run:  npx vitest run --config tests/balance/vitest.config.ts tests/balance/verify_1_1.test.ts
 * (not part of CI: ~10 min of simulation). VERIFY_SEEDS="1001,1002" narrows the sweep.
 * A JSON report is written to $VERIFY_OUT when set.
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { NewGameOptions } from '../../src/sim/contracts';
import type { WorldState } from '../../src/sim/types';
import { NEED_IDS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/types';
import { createNewWorld, createSimulation, LOT_TEMPLATES, loadContent } from '../../src/sim/index';
import { isEssentialInteraction } from '../../src/sim/engine/repetition';
import { timeInfo } from '../../src/sim/time';
import type { EngineSimulation } from '../../src/sim/engine/simulation';
import { buildCazCatalog } from '../../src/game/gddCatalog';
import { randomHousehold } from '../../src/game/randomZombie';
import { SaveManagerImpl } from '../../src/persistence/saveManager';
import { createMemoryBackend } from '../../src/persistence/backends/memory';
import { engineRepairHook } from '../../src/persistence/semanticRepair';
import { canonicalJson } from '../../src/persistence/canonicalJson';

type Sim = EngineSimulation;
type Need = (typeof NEED_IDS)[number];

const SEEDS = (process.env.VERIFY_SEEDS ?? '1001,1002,1003,1004,1005,1006,1007,1008,1009,1010').split(',').map(Number);
const CRIT = 15;
const yieldLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function options(seed: number, difficulty: WorldState['settings']['difficulty']): NewGameOptions {
  const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
  const count = 2 + (seed % 2); // odd seeds: 3 zombies, even: 2
  const { householdName, members } = randomHousehold(seed, catalog, count);
  return { seed, householdName, members, lotTemplate: 'starter', difficulty };
}

interface Tally {
  hours: number;
  crit: Record<Need, number>;
  min: Record<Need, number>;
}
const tally = (): Tally => ({
  hours: 0,
  crit: Object.fromEntries(NEED_IDS.map((n) => [n, 0])) as Record<Need, number>,
  min: Object.fromEntries(NEED_IDS.map((n) => [n, 100])) as Record<Need, number>,
});

interface Result {
  seed: number;
  members: number;
  days: number;
  crumbles: { name: string; day: number; presence: string }[];
  gameOverDay: number | null;
  stayHome: Tally;
  workers: Tally;
  workerCount: number;
  funds: number[];
  slope7: number;
  repoVisits: number;
  repossessions: number;
  powerCuts: number;
  lateBills: number;
  fires: number;
  maxNonEssentialPerDay: { n: number; what: string };
  maxAnyAutoPerDay: { n: number; what: string };
  maxStartsPerHour: { n: number; what: string };
  topAwakeShare: { share: number; what: string };
  faults: string[];
  violations: string[];
  player: string[];
  careers: string[];
  ms: number;
}

function slope(funds: number[], from: number): number {
  const pts = funds.map((f, d) => [d, f]).filter(([d]) => d >= from);
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let a = 0;
  let b = 0;
  for (const [x, y] of pts) {
    a += (x - mx) * (y - my);
    b += (x - mx) ** 2;
  }
  return b ? a / b : 0;
}

function tryBuy(sim: Sim, defId: string, box: { x0: number; z0: number; x1: number; z1: number }): boolean {
  for (let z = box.z0; z < box.z1; z++)
    for (let x = box.x0; x < box.x1; x++)
      for (const rot of [0, 2, 1, 3] as const) {
        const r = sim.build.apply({ type: 'buy', defId, x, z, rot });
        if (r.ok) {
          sim.build.clearHistory();
          return true;
        }
      }
  return false;
}

const BEDROOM = { x0: 9, z0: 10, x1: 16, z1: 14 };

async function run(seed: number, days: number, player: boolean, career?: string): Promise<Result> {
  const t0 = performance.now();
  const sim = createSimulation(createNewWorld(options(seed, 'normal'))) as Sim;
  const ids = sim.state.household.memberIds.slice();
  const name = (id: string) => sim.state.agents[id]?.firstName ?? id;
  const per = new Map(ids.map((id) => [id, tally()]));
  const everWorker = new Set<string>();
  const crumbles: Result['crumbles'] = [];
  const funds = [sim.state.household.funds];
  const lastUid = new Map<string, number>();
  const autoPerDay = new Map<string, number>(); // day|agent|iid  (fresh autonomous decisions)
  const startsPerHour = new Map<string, number>(); // hour|agent|iid (every start incl. resumes, any source)
  const awake = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const awakeTot = new Map(ids.map((id) => [id, 0]));
  const violations: string[] = [];
  const late = new Set<string>();
  const essentials = Object.values(sim.state.objects)
    .filter((o) => (o.defId === 'fridge_humming' || o.defId === 'stove_greasefire') && o.placement.kind === 'floor')
    .map((o) => ({ defId: o.defId, p: o.placement as { x: number; z: number; rot: 0 | 1 | 2 | 3 } }));
  const log: string[] = [];
  let repoVisits = 0;
  let lastRepo = sim.state.household.repoDispatchedDay;
  let jobDone = !player;
  let chillDone = !player;
  let stationDone = !player;
  let gameOverDay: number | null = null;
  const isSleep = (iid: string) => {
    const t = sim.content.interactions[iid]?.tags;
    return Array.isArray(t) && (t.includes('sleep') || t.includes('nap'));
  };

  for (let i = 1; i <= days * TICKS_PER_DAY; i++) {
    sim.step();
    const tick = sim.state.tick;
    const ti = timeInfo(tick);
    const hourIdx = Math.floor(tick / TICKS_PER_HOUR);
    for (const id of ids) {
      const a = sim.state.agents[id];
      const r = a?.active;
      if (r && r.uid !== lastUid.get(id)) {
        lastUid.set(id, r.uid);
        const hk = `${hourIdx}|${id}|${r.interactionId}`;
        startsPerHour.set(hk, (startsPerHour.get(hk) ?? 0) + 1);
        if (r.source === 'auto' && r.params._origUid === undefined && !r.interactionId.startsWith('engine_')) {
          const k = `${ti.day}|${id}|${r.interactionId}`;
          autoPerDay.set(k, (autoPerDay.get(k) ?? 0) + 1);
        }
      }
      if (a && a.presence === 'onLot' && !a.status.passedOut && !(a.active && isSleep(a.active.interactionId))) {
        awakeTot.set(id, awakeTot.get(id)! + 1);
        const iid = a.active?.interactionId ?? '(idle)';
        const m = awake.get(id)!;
        m.set(iid, (m.get(iid) ?? 0) + 1);
      }
    }
    if (tick % TICKS_PER_HOUR !== 0) continue;
    sim.drainEvents();
    for (const id of ids) {
      const a = sim.state.agents[id];
      if (!a) continue;
      if (a.career) everWorker.add(id);
      if ((a.presence === 'crumbled' || a.presence === 'gone') && !crumbles.some((c) => c.name === name(id))) crumbles.push({ name: name(id), day: ti.day, presence: a.presence });
      if (a.presence !== 'onLot') continue;
      const t = per.get(id)!;
      t.hours++;
      for (const n of NEED_IDS) {
        if (a.needs[n] < CRIT) t.crit[n]++;
        t.min[n] = Math.min(t.min[n], a.needs[n]);
      }
    }
    for (const b of sim.state.household.bills) if (tick > b.dueTick && (b.paidTick === null || b.paidTick > b.dueTick)) late.add(b.id);
    if (sim.state.household.repoDispatchedDay !== null && sim.state.household.repoDispatchedDay !== lastRepo) repoVisits++;
    lastRepo = sim.state.household.repoDispatchedDay;
    for (const v of sim.checkInvariants()) if (violations.length < 20) violations.push(`t${tick} ${v}`);
    // ── scripted reasonable player ──
    if (player) {
      if (!jobDone && ti.hour >= 10) {
        const id = ids.find((x) => sim.state.agents[x]?.presence === 'onLot');
        if (id && sim.dispatch({ type: 'queue', actorId: id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: career! } }).ok) {
          jobDone = true;
          log.push(`d${ti.day} ${ti.hour}h job ${career} -> ${name(id)}`);
        }
      }
      if (!chillDone && ti.hour >= 12) {
        chillDone = true;
        log.push(`d${ti.day} chill-rest ${tryBuy(sim, 'coffin_chillrest', BEDROOM) ? 'bought' : 'FAILED'} (funds ${sim.state.household.funds})`);
      }
      if (chillDone && !stationDone && sim.state.household.funds >= 3000 && ti.hour >= 10 && ti.hour <= 20 && tryBuy(sim, 'station_embalming', BEDROOM)) {
        stationDone = true;
        log.push(`d${ti.day} ${ti.hour}h station bought`);
      }
      if (ti.hour >= 8 && ti.hour <= 22)
        for (const e of essentials)
          if (!Object.values(sim.state.objects).some((o) => o.defId === e.defId)) {
            const r = sim.build.apply({ type: 'buy', defId: e.defId, x: e.p.x, z: e.p.z, rot: e.p.rot });
            if (r.ok) sim.build.clearHistory();
            log.push(`d${ti.day} ${ti.hour}h rebuy ${e.defId} ${r.ok ? 'ok' : r.reason}`);
          }
    }
    if (ti.hour === 0) funds.push(sim.state.household.funds);
    if (sim.state.gameOver && gameOverDay === null) {
      gameOverDay = ti.day;
      break;
    }
    if (hourIdx % 2 === 0) await yieldLoop();
  }

  const stayHome = tally();
  const workers = tally();
  const merge = (into: Tally, t: Tally) => {
    into.hours += t.hours;
    for (const n of NEED_IDS) {
      into.crit[n] += t.crit[n];
      into.min[n] = Math.min(into.min[n], t.min[n]);
    }
  };
  for (const id of ids) merge(everWorker.has(id) ? workers : stayHome, per.get(id)!);
  const maxNE = { n: 0, what: '' };
  const maxAny = { n: 0, what: '' };
  for (const [k, n] of autoPerDay) {
    const [d, id, iid] = k.split('|');
    const def = sim.content.interactions[iid];
    const what = `${name(id)} ${iid} x${n} d${d}`;
    if (n > maxAny.n) Object.assign(maxAny, { n, what });
    if (def && !isEssentialInteraction(sim.engine, def) && n > maxNE.n) Object.assign(maxNE, { n, what });
  }
  const maxHour = { n: 0, what: '' };
  for (const [k, n] of startsPerHour) if (n > maxHour.n) Object.assign(maxHour, { n, what: k });
  const top = { share: 0, what: '' };
  for (const id of ids)
    for (const [iid, m] of awake.get(id)!) {
      if (iid === '(idle)' || iid.startsWith('engine_')) continue;
      const s = m / Math.max(1, awakeTot.get(id)!);
      if (s > top.share) Object.assign(top, { share: s, what: `${name(id)} ${iid}` });
    }
  const c = sim.state.stats.counters;
  return {
    seed,
    members: ids.length,
    days,
    crumbles,
    gameOverDay,
    stayHome,
    workers,
    workerCount: everWorker.size,
    funds,
    slope7: funds.length > 8 ? slope(funds, 7) : NaN,
    repoVisits,
    repossessions: c.repossessions ?? 0,
    powerCuts: c.powerCuts ?? 0,
    lateBills: late.size,
    fires: c.firesStarted ?? 0,
    maxNonEssentialPerDay: maxNE,
    maxAnyAutoPerDay: maxAny,
    maxStartsPerHour: maxHour,
    topAwakeShare: top,
    faults: sim.faults().slice(0, 10).map((f) => `${f.tick} ${f.where}: ${f.message}`),
    violations,
    player: log,
    careers: ids.map((id) => {
      const k = sim.state.agents[id]?.career;
      return k ? `${name(id)} ${k.trackId} L${k.level}` : `${name(id)} -`;
    }),
    ms: Math.round(performance.now() - t0),
  };
}

const pct = (t: Tally, n: Need) => (t.hours ? (100 * t.crit[n]) / t.hours : 0);
function line(r: Result): string {
  const sh = NEED_IDS.map((n) => `${n.slice(0, 4)} ${pct(r.stayHome, n).toFixed(1)}%/min${Math.round(r.stayHome.min[n])}`).join(' ');
  return (
    `seed ${r.seed} (${r.members}z) crumbles ${JSON.stringify(r.crumbles)} gameOver ${r.gameOverDay ?? '-'} | stayHome(${r.stayHome.hours}h) ${sh} | ` +
    `workers(${r.workerCount}, ${r.workers.hours}h) fun<15 ${pct(r.workers, 'fun').toFixed(1)}% min ${Math.round(r.workers.min.fun)} | funds ${r.funds[0]}..${r.funds[7] ?? '?'}..${r.funds.at(-1)} slope7 ${r.slope7.toFixed(1)} | ` +
    `repo ${r.repoVisits}/${r.repossessions} cuts ${r.powerCuts} late ${r.lateBills} fires ${r.fires} | NE/day ${r.maxNonEssentialPerDay.n} (${r.maxNonEssentialPerDay.what}) any/day ${r.maxAnyAutoPerDay.n} (${r.maxAnyAutoPerDay.what}) ` +
    `starts/h ${r.maxStartsPerHour.n} (${r.maxStartsPerHour.what}) | top awake ${(100 * r.topAwakeShare.share).toFixed(1)}% ${r.topAwakeShare.what} | faults ${r.faults.length} viol ${r.violations.length} | ${r.careers.join(', ')} | ${(r.ms / 1000).toFixed(0)}s` +
    (r.player.length ? `\n    player: ${r.player.join('; ')}` : '') +
    (r.faults.length ? `\n    FAULTS: ${r.faults.slice(0, 3).join(' | ')}` : '') +
    (r.violations.length ? `\n    VIOL: ${r.violations.slice(0, 3).join(' | ')}` : '')
  );
}

const report: Record<string, unknown> = {};
const out = () => {
  if (process.env.VERIFY_OUT) writeFileSync(process.env.VERIFY_OUT, JSON.stringify(report, null, 1));
};

describe('independent balance verification (seeds 1001+)', () => {
  it('A: unattended normal, 14 days', { timeout: 3_600_000 }, async () => {
    const rs: Result[] = [];
    for (const s of SEEDS) {
      const r = await run(s, 14, false);
      console.log('[A] ' + line(r));
      rs.push(r);
    }
    report.A = rs;
    out();
    const survived10 = rs.filter((r) => r.gameOverDay === null || r.gameOverDay > 10).length;
    const noEarly = rs.filter((r) => r.crumbles.every((c) => c.day >= 8)).length;
    const pooled = tally();
    for (const r of rs) {
      pooled.hours += r.stayHome.hours;
      for (const n of NEED_IDS) pooled.crit[n] += r.stayHome.crit[n];
    }
    const worstSeed = Math.max(...rs.flatMap((r) => NEED_IDS.map((n) => pct(r.stayHome, n))));
    console.log(`[A] survived>=10d ${survived10}/${rs.length}; no crumble before d8 ${noEarly}/${rs.length}; pooled stayHome<15: ${NEED_IDS.map((n) => `${n} ${pct(pooled, n).toFixed(2)}%`).join(' ')}; worst seed-need ${worstSeed.toFixed(1)}%`);
    expect.soft(survived10 / rs.length).toBeGreaterThanOrEqual(0.8);
    expect.soft(noEarly).toBe(rs.length);
    for (const n of NEED_IDS) expect.soft(pct(pooled, n), n).toBeLessThan(5);
    expect.soft(rs.flatMap((r) => r.faults)).toEqual([]);
    expect.soft(rs.flatMap((r) => r.violations)).toEqual([]);
  });

  it('B: reasonable player (Mortuary / Necro-Tech), normal, 21 days', { timeout: 3_600_000 }, async () => {
    const rs: Result[] = [];
    for (const s of SEEDS) {
      const career = Math.floor((s - 1001) / 2) % 2 === 0 ? 'mortuary' : 'necrotech';
      const r = await run(s, 21, true, career);
      console.log('[B] ' + line(r));
      rs.push(r);
    }
    report.B = rs;
    out();
    expect.soft(rs.filter((r) => r.crumbles.length === 0).length).toBe(rs.length);
    for (const r of rs) expect.soft(pct(r.workers, 'fun'), `seed ${r.seed} worker fun`).toBeLessThan(5);
    for (const r of rs) expect.soft(r.slope7, `seed ${r.seed} funds slope`).toBeGreaterThan(0);
    expect.soft(rs.reduce((s, r) => s + r.repoVisits + r.repossessions, 0)).toBe(0);
    expect.soft(Math.max(...rs.map((r) => r.maxNonEssentialPerDay.n))).toBeLessThanOrEqual(6);
    expect.soft(Math.max(...rs.map((r) => r.topAwakeShare.share))).toBeLessThanOrEqual(0.25);
    expect.soft(rs.flatMap((r) => r.faults)).toEqual([]);
    expect.soft(rs.flatMap((r) => r.violations)).toEqual([]);
  });

  it('save -> load -> continue is deterministic over 2 game days', { timeout: 1_800_000 }, async () => {
    const seed = 1007;
    const sim = createSimulation(createNewWorld(options(seed, 'normal'))) as Sim;
    // get the career system involved, then stop at an odd mid-afternoon tick (runs in flight)
    sim.dispatch({ type: 'queue', actorId: sim.state.household.memberIds[0], interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'mortuary' } });
    const stopAt = 2 * TICKS_PER_DAY + 5 * TICKS_PER_HOUR + 37;
    while (sim.state.tick < stopAt) sim.step();
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), repair: engineRepairHook(), logger: { warn() {}, error() {}, info() {} } as never });
    const saved = await mgr.save('v', 'Verify', sim.serialize(), {
      householdName: 'x', memberNames: [], day: 3, timeLabel: '', funds: sim.state.household.funds, lotValue: 0, thumbnail: null,
    });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const loaded = await mgr.load('v');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual([]);
    const copy = createSimulation(loaded.world) as Sim;
    expect(copy.repairWarnings).toEqual([]);
    sim.drainEvents();
    copy.drainEvents();
    let firstDiff: number | null = null;
    let eventDiff: number | null = null;
    for (let i = 0; i < 2 * TICKS_PER_DAY; i++) {
      sim.step();
      copy.step();
      if (sim.state.tick % TICKS_PER_HOUR === 0) {
        if (eventDiff === null && canonicalJson(sim.drainEvents()) !== canonicalJson(copy.drainEvents())) eventDiff = sim.state.tick;
        if (firstDiff === null && canonicalJson(sim.serialize()) !== canonicalJson(copy.serialize())) firstDiff = sim.state.tick;
        await yieldLoop();
      }
    }
    const same = canonicalJson(sim.serialize()) === canonicalJson(copy.serialize());
    report.determinism = { seed, savedAtTick: stopAt, continuedTicks: 2 * TICKS_PER_DAY, finalEqual: same, firstStateDiffTick: firstDiff, firstEventDiffTick: eventDiff, faults: [sim.faults().length, copy.faults().length] };
    out();
    console.log('[DET] ' + JSON.stringify(report.determinism));
    expect(firstDiff).toBeNull();
    expect(eventDiff).toBeNull();
    expect(same).toBe(true);
  });
});
