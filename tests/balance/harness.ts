/**
 * Headless BALANCE harness (backlog "Balance" + decision #13; method in docs/BALANCE.md).
 *
 * runScenario(spec, seed) builds createSimulation(createNewWorld(...)) with the REAL shipped content, a seeded random
 * household (the same randomHousehold the Create-a-Zombie "Randomize" button uses) and an optional scripted player,
 * steps it for N game days and returns RunMetrics. Cheap per-tick bookkeeping only (no logging, no event retention:
 * events are drained and dropped every game hour); invariants are checked every game hour; the loop yields to the
 * event loop every couple of game hours so vitest's worker heartbeat never starves on a loaded machine.
 *
 * Scenarios (SCENARIOS):
 *   A  unattended   starter lot, 2–3 random zombies, no input, normal
 *   B  reasonable   starter lot, 2–3 random zombies; day 1 one zombie gets a job, a Chill-Rest coffin is bought on day 1
 *                   if affordable, an Embalming Station once funds ≥ $3,000; bills are left to autonomy; otherwise
 *                   autonomy
 *   Cg / Cr         A on grim / relaxed
 *   D  empty plot   B on the Empty Plot after a scripted day-1 build (one-room crypt with the essentials)
 */
import type { NewGameOptions, SimulationAPI } from '../../src/sim/contracts';
import type { AgentState, NeedId, WorldState } from '../../src/sim/types';
import { NEED_IDS, SKILL_IDS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/types';
import { createNewWorld, createSimulation, LOT_TEMPLATES, loadContent } from '../../src/sim/index';
import { isEssentialInteraction } from '../../src/sim/engine/repetition';
import { timeInfo } from '../../src/sim/time';
import type { EngineSimulation } from '../../src/sim/engine/simulation';
import { buildCazCatalog } from '../../src/game/gddCatalog';
import { randomHousehold, rngFromSeed } from '../../src/game/randomZombie';

export type Difficulty = WorldState['settings']['difficulty'];
export type PlayerScript = 'none' | 'reasonable';

export interface ScenarioSpec {
  id: string;
  label: string;
  lot: 'starter' | 'empty';
  difficulty: Difficulty;
  player: PlayerScript;
  days: number;
  /** careers the scripted player picks from (by seed); default PLAYER_CAREERS */
  careers?: readonly string[];
}

/** The reasonable player takes a well-paid 9-to-5: Mortuary Sciences (pairs with the Embalming Station) or Necro-Tech. */
export const PLAYER_CAREERS = ['mortuary', 'necrotech'] as const;
/** Career coverage (scenario Bc): the other three tracks — evenings, nights, weekends, lower L1 pay. */
export const OTHER_CAREERS = ['politics', 'culinary', 'retail'] as const;

export const SCENARIOS: Record<'A' | 'B' | 'Bc' | 'Cg' | 'Cr' | 'D', ScenarioSpec> = {
  A: { id: 'A', label: 'Unattended (normal)', lot: 'starter', difficulty: 'normal', player: 'none', days: 14 },
  B: { id: 'B', label: 'Reasonable player (normal)', lot: 'starter', difficulty: 'normal', player: 'reasonable', days: 21 },
  Bc: { id: 'Bc', label: 'Reasonable player, other careers (normal)', lot: 'starter', difficulty: 'normal', player: 'reasonable', days: 21, careers: OTHER_CAREERS },
  Cg: { id: 'Cg', label: 'Unattended (grim)', lot: 'starter', difficulty: 'grim', player: 'none', days: 14 },
  Cr: { id: 'Cr', label: 'Unattended (relaxed)', lot: 'starter', difficulty: 'relaxed', player: 'none', days: 14 },
  D: { id: 'D', label: 'Reasonable player, Empty Plot (normal)', lot: 'empty', difficulty: 'normal', player: 'reasonable', days: 21 },
};

export const DEFAULT_SEEDS = [11, 22, 33, 44, 55] as const;


/** Non-essential autonomous runs per zombie per game day above this are flagged as action spam. */
export const SPAM_LIMIT = 6;
export const CRITICAL = 15;

export interface NeedTally {
  hours: number;
  /** on-lot awake+asleep hours with the need below CRITICAL */
  critical: Record<NeedId, number>;
  /** lowest hourly on-lot sample per need */
  min: Record<NeedId, number>;
  /** sum of hourly on-lot samples per need (mean = sum / hours) */
  sum: Record<NeedId, number>;
}

export interface AgentReport {
  id: string;
  name: string;
  traits: string[];
  aspiration: string | null;
  worker: boolean;
  career: { track: string; level: number; performance: number } | null;
  crumbledDay: number | null;
  skills: Record<string, number>;
  finalNeeds: Record<NeedId, number>;
  vitality: number;
  tally: NeedTally;
  /** worst game-day count of fresh autonomous runs of one non-essential interaction */
  maxNonEssentialPerDay: number;
  worstNonEssential: string | null;
  /** share of on-lot awake minutes spent in the single most-used non-sleep interaction */
  topAwakeShare: number;
  topAwakeInteraction: string | null;
  limbsLost: number;
}

export interface RunMetrics {
  scenario: string;
  seed: number;
  difficulty: Difficulty;
  days: number;
  /** whole game days the household lasted (= days unless game over) */
  daysSurvived: number;
  gameOver: boolean;
  /** day (1-based) of the first crumble, null if none */
  firstCrumbleDay: number | null;
  crumbles: { id: string; day: number }[];
  members: number;
  agents: AgentReport[];
  /** pooled need tallies */
  stayHome: NeedTally;
  workers: NeedTally;
  /** funds at 00:00 of each day (index 0 = start) */
  funds: number[];
  /** money flow by reason ('+Wages', '-Bills', ...) */
  money: Record<string, number>;
  bills: { issued: number; paid: number; late: number; powerCuts: number; repoVisits: number; repossessions: number };
  fires: number;
  limbsLost: number;
  relationships: { met: number; friends: number; householdFriends: number; partners: number };
  spam: string[];
  faults: { tick: number; where: string; message: string }[];
  violations: string[];
  playerLog: string[];
  ms: number;
}

const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function blankTally(): NeedTally {
  const z = (v: number) => Object.fromEntries(NEED_IDS.map((n) => [n, v])) as Record<NeedId, number>;
  return { hours: 0, critical: z(0), min: z(100), sum: z(0) };
}

function addTally(into: NeedTally, from: NeedTally): void {
  into.hours += from.hours;
  for (const n of NEED_IDS) {
    into.critical[n] += from.critical[n];
    into.sum[n] += from.sum[n];
    into.min[n] = Math.min(into.min[n], from.min[n]);
  }
}

/** Share of tallied hours with `need` below CRITICAL (0 when no hours). */
export function critShare(t: NeedTally, need: NeedId): number {
  return t.hours > 0 ? t.critical[need] / t.hours : 0;
}

export function worstCritShare(t: NeedTally): { need: NeedId; share: number } {
  let best: { need: NeedId; share: number } = { need: 'hunger', share: -1 };
  for (const n of NEED_IDS) {
    const s = critShare(t, n);
    if (s > best.share) best = { need: n, share: s };
  }
  return best;
}

/** Seeded household: 2 or 3 random zombies (count from the seed too). */
export function scenarioOptions(spec: ScenarioSpec, seed: number): NewGameOptions {
  const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
  const count = 2 + (rngFromSeed(seed ^ 0x5eed).next() < 0.5 ? 0 : 1);
  const { householdName, members } = randomHousehold(seed, catalog, count);
  return { seed, householdName, members, lotTemplate: spec.lot, difficulty: spec.difficulty };
}

// ───────────────────────────────────────── player scripts ─────────────────────────────────────────

type Sim = EngineSimulation;

function tileFree(sim: Sim, x: number, z: number): boolean {
  for (const o of Object.values(sim.state.objects)) {
    const p = o.placement;
    if (p.kind !== 'floor') continue;
    const def = sim.content.objects[o.defId];
    if (!def) continue;
    const w = p.rot % 2 === 0 ? def.footprint.w : def.footprint.d;
    const d = p.rot % 2 === 0 ? def.footprint.d : def.footprint.w;
    if (x >= p.x && x < p.x + w && z >= p.z && z < p.z + d) return false;
  }
  return true;
}

/** Buy `defId` at the first valid spot (nearest to `near` first, inside [x0,x1)×[z0,z1)). */
export function buyNear(sim: Sim, defId: string, near: { x: number; z: number }, box: { x0: number; z0: number; x1: number; z1: number }, rots: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3]): string | null {
  const spots: { x: number; z: number; d: number }[] = [];
  for (let x = box.x0; x < box.x1; x++) for (let z = box.z0; z < box.z1; z++) spots.push({ x, z, d: Math.abs(x - near.x) + Math.abs(z - near.z) });
  spots.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  for (const s of spots) {
    if (!tileFree(sim, s.x, s.z)) continue;
    for (const rot of rots) {
      const before = new Set(Object.keys(sim.state.objects));
      const r = sim.build.apply({ type: 'buy', defId, x: s.x, z: s.z, rot });
      if (r.ok) {
        const id = Object.keys(sim.state.objects).find((k) => !before.has(k)) ?? r.objectId ?? null;
        return id;
      }
    }
  }
  return null;
}

function findJob(sim: Sim, agentId: string, careerId: string): boolean {
  return sim.dispatch({ type: 'queue', actorId: agentId, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId } }).ok;
}

/**
 * Scripted day-1 build on the Empty Plot: one 9×7 crypt (x 10..18, z 12..18) laid out like the starter cottage —
 * rot 0 faces +Z (against the back wall), rot 1 faces −X (the east counter run), rot 2 faces −Z.
 *        x: 10   11   12   13   14   15   16   17   18
 *   z=12    CFN  CFN  CFN  LMP  MIR  SHW  .    .    .
 *   z=13    CFN  CFN  CFN  .    .    .    .    .    FRG
 *   z=14    .    .    .    .    CHR  CHR  .    .    STV
 *   z=15    .    TV   .    .    TBL  TBL  .    .    CTR
 *   z=16    .    .    .    .    CHR  CHR  .    .    SNK
 *   z=17    .    .    .    .    .    .    .    .    TRS
 *   z=18    SOF  SOF  .    SHF  .    .    .    .    .      front door h:14:19
 */
export function furnishEmptyPlot(sim: Sim, members: number, log: string[]): void {
  const b = sim.build;
  const room = { x0: 10, z0: 12, x1: 19, z1: 19 };
  const r = b.apply({ type: 'room', ...room, floor: 'floor_planks_worn' });
  log.push(`room ${r.ok ? 'ok' : r.reason}`);
  const door = b.apply({ type: 'buyOpening', defId: 'door_splintered', edge: 'h:14:19' });
  log.push(`door ${door.ok ? 'ok' : door.reason}`);
  for (const w of ['h:11:19', 'h:17:19']) b.apply({ type: 'buyOpening', defId: 'window_grimy', edge: w });
  const items: [string, number, number, 0 | 1 | 2 | 3][] = [
    ['fridge_humming', 18, 13, 1],
    ['stove_greasefire', 18, 14, 1],
    ['counter_butcher', 18, 15, 1],
    ['sink_rusty', 18, 16, 1],
    ['trash_lidded', 18, 17, 1],
    ['mirror_cracked', 14, 12, 0],
    ['shower_drizzle', 15, 12, 0],
    ['table_wake', 14, 15, 0],
    ['chair_creaky', 14, 14, 0],
    ['chair_creaky', 15, 14, 0],
    ['chair_creaky', 14, 16, 2],
    ['chair_creaky', 15, 16, 2],
    ['tv_crt', 11, 15, 0],
    ['sofa_moldy', 10, 18, 2],
    ['lamp_skull', 13, 12, 0],
    // a second fun source (and logic for Necro-Tech promotions): with the TV alone a worker's day off was 7 TV sessions
    ['shelf_moldering', 13, 18, 2],
  ];
  for (let i = 0; i < members; i++) items.push(['coffin_pine', 10 + i, 12, 0]);
  for (const [def, x, z, rot] of items) {
    const res = b.apply({ type: 'buy', defId: def, x, z, rot });
    log.push(`${def} ${res.ok ? 'ok' : `FAILED ${res.reason}`}`);
  }
  b.clearHistory();
}

interface PlayerState {
  jobDone: boolean;
  coffinDone: boolean;
  stationDone: boolean;
  /** kitchen essentials at their day-1 spots: a burned/repossessed one is replaced ("Your stove burned — buy a new one") */
  essentials: { defId: string; x: number; z: number; rot: 0 | 1 | 2 | 3 }[];
  log: string[];
}

const ESSENTIAL_DEFS = ['fridge_humming', 'stove_greasefire'];

function rememberEssentials(sim: Sim): PlayerState['essentials'] {
  const out: PlayerState['essentials'] = [];
  for (const o of Object.values(sim.state.objects)) {
    if (!ESSENTIAL_DEFS.includes(o.defId) || o.placement.kind !== 'floor') continue;
    out.push({ defId: o.defId, x: o.placement.x, z: o.placement.z, rot: o.placement.rot as 0 | 1 | 2 | 3 });
  }
  return out;
}

function replaceEssentials(sim: Sim, ps: PlayerState, day: number, hour: number): void {
  for (const e of ps.essentials) {
    if (Object.values(sim.state.objects).some((o) => o.defId === e.defId)) continue;
    const r = sim.build.apply({ type: 'buy', defId: e.defId, x: e.x, z: e.z, rot: e.rot });
    ps.log.push(`d${day} ${hour}h: replaced ${e.defId} ${r.ok ? 'ok' : `FAILED (${r.reason})`}`);
    if (r.ok) sim.build.clearHistory();
  }
}

function playerTick(sim: Sim, spec: ScenarioSpec, seed: number, ps: PlayerState, hour: number): void {
  const ids = sim.state.household.memberIds;
  const day = timeInfo(sim.state.tick).day;
  if (hour >= 8 && hour <= 22) replaceEssentials(sim, ps, day, hour);
  const bedBox = spec.lot === 'starter' ? { x0: 9, z0: 10, x1: 16, z1: 14 } : { x0: 10, z0: 12, x1: 18, z1: 18 };
  const bedNear = spec.lot === 'starter' ? { x: 14, z: 10 } : { x: 16, z: 12 };
  if (!ps.jobDone) {
    const list = spec.careers ?? PLAYER_CAREERS;
    const career = list[seed % list.length];
    const id = ids.find((a) => sim.state.agents[a]?.presence === 'onLot');
    if (id && findJob(sim, id, career)) {
      ps.jobDone = true;
      ps.log.push(`d${day} ${hour}h: ${sim.state.agents[id].firstName} gets a job (${career})`);
    }
  }
  if (!ps.coffinDone && day <= 2 && hour >= 12) {
    if (sim.state.household.funds >= 1400) {
      const id = buyNear(sim, 'coffin_chillrest', bedNear, bedBox);
      ps.log.push(`d${day} ${hour}h: Chill-Rest coffin ${id ? 'bought' : 'no room'}`);
      if (id) sim.build.clearHistory();
    } else ps.log.push(`d${day}: Chill-Rest not affordable`);
    ps.coffinDone = true;
  }
  if (ps.coffinDone && !ps.stationDone && sim.state.household.funds >= 3000 && hour >= 10 && hour <= 20) {
    const id = buyNear(sim, 'station_embalming', bedNear, bedBox, [0, 2, 1, 3]);
    if (id) {
      sim.build.clearHistory();
      ps.stationDone = true;
      ps.log.push(`d${day} ${hour}h: Embalming Station bought (funds now ${sim.state.household.funds})`);
    }
  }
}

// ───────────────────────────────────────── the run ─────────────────────────────────────────

export interface RunOptions {
  /** override days */
  days?: number;
  /** stop early once every household zombie is gone */
  stopOnGameOver?: boolean;
  /** debugging hooks (never used by the sweep itself) */
  onFreshRun?: (sim: EngineSimulation, agentId: string, run: NonNullable<AgentState['active']>) => void;
  onHour?: (sim: EngineSimulation) => void;
}

function isSleepDef(sim: Sim, iid: string): boolean {
  const def = sim.content.interactions[iid];
  return !!def && Array.isArray(def.tags) && (def.tags.includes('sleep') || def.tags.includes('nap'));
}

export async function runScenario(spec: ScenarioSpec, seed: number, opts: RunOptions = {}): Promise<RunMetrics> {
  const t0 = performance.now();
  const days = opts.days ?? spec.days;
  const sim = createSimulation(createNewWorld(scenarioOptions(spec, seed))) as Sim;
  const ids = sim.state.household.memberIds.slice();
  const ps: PlayerState = { jobDone: false, coffinDone: false, stationDone: false, essentials: [], log: [] };
  if (spec.lot === 'empty' && spec.player === 'reasonable') furnishEmptyPlot(sim, ids.length, ps.log);
  ps.essentials = rememberEssentials(sim);

  const tallies = new Map<string, NeedTally>(ids.map((id) => [id, blankTally()]));
  const workerEver = new Set<string>();
  const crumbles: { id: string; day: number }[] = [];
  const lastUid: Record<string, number> = {};
  const runsPerDay = new Map<string, number>(); // `${day}|${agent}|${iid}`
  const awakeMin = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]));
  const awakeTotal = new Map<string, number>(ids.map((id) => [id, 0]));
  const funds: number[] = [sim.state.household.funds];
  const violations = new Set<string>();
  const money = new Map<string, number>();
  const lateBills = new Set<string>();
  let repoVisits = 0;
  let lastRepoDay: number | null = sim.state.household.repoDispatchedDay;
  let daysSurvived = days;
  const total = days * TICKS_PER_DAY;

  for (let i = 1; i <= total; i++) {
    sim.step();
    const tick = sim.state.tick;
    const day = timeInfo(tick).day; // 1-based calendar day (the clock starts Monday 09:00)
    // fresh autonomous decisions (every tick: cheap; a suspended run re-queued after a social is the same decision)
    for (const id of ids) {
      const a = sim.state.agents[id];
      const run = a?.active;
      if (!run || run.uid === lastUid[id]) continue;
      lastUid[id] = run.uid;
      opts.onFreshRun?.(sim, id, run);
      if (run.source !== 'auto' || run.params._origUid !== undefined || run.interactionId.startsWith('engine_')) continue;
      const k = `${day}|${id}|${run.interactionId}`;
      runsPerDay.set(k, (runsPerDay.get(k) ?? 0) + 1);
    }
    if (i % 4 === 0) {
      // once per game minute: awake time share per interaction
      for (const id of ids) {
        const a = sim.state.agents[id];
        if (!a || a.presence !== 'onLot') continue;
        const iid = a.active?.interactionId ?? '(idle)';
        if (a.active && isSleepDef(sim, iid)) continue;
        if (a.status.passedOut) continue;
        awakeTotal.set(id, (awakeTotal.get(id) ?? 0) + 1);
        const m = awakeMin.get(id)!;
        m.set(iid, (m.get(iid) ?? 0) + 1);
      }
    }
    if (i % TICKS_PER_HOUR === 0) {
      for (const ev of sim.drainEvents()) {
        if (ev.type !== 'funds') continue;
        const k = `${ev.delta < 0 ? '-' : '+'}${ev.reason}`;
        money.set(k, (money.get(k) ?? 0) + ev.delta);
      }
      const hour = timeInfo(tick).hour;
      for (const id of ids) {
        const a = sim.state.agents[id];
        if (!a) continue;
        if (a.career) workerEver.add(id);
        if ((a.presence === 'crumbled' || a.presence === 'gone') && !crumbles.some((c) => c.id === id)) crumbles.push({ id, day });
        if (a.presence !== 'onLot') continue;
        const t = tallies.get(id)!;
        t.hours++;
        for (const n of NEED_IDS) {
          const v = a.needs[n];
          if (v < CRITICAL) t.critical[n]++;
          t.sum[n] += v;
          if (v < t.min[n]) t.min[n] = v;
        }
      }
      for (const bill of sim.state.household.bills) {
        if ((bill.paidTick === null && tick > bill.dueTick) || (bill.paidTick !== null && bill.paidTick > bill.dueTick)) lateBills.add(bill.id);
      }
      const rd = sim.state.household.repoDispatchedDay;
      if (rd !== null && rd !== lastRepoDay) repoVisits++;
      lastRepoDay = rd;
      for (const v of sim.checkInvariants()) if (violations.size < 50) violations.add(`t${tick}: ${v}`);
      if (spec.player === 'reasonable') playerTick(sim, spec, seed, ps, hour);
      opts.onHour?.(sim);
      if (hour === 0) funds.push(sim.state.household.funds);
      if (sim.state.gameOver) {
        daysSurvived = Math.min(daysSurvived, Math.floor(tick / TICKS_PER_DAY));
        if (opts.stopOnGameOver !== false) break;
      }
      if (i % (2 * TICKS_PER_HOUR) === 0) await breathe();
    }
  }

  const agents: AgentReport[] = [];
  const stayHome = blankTally();
  const workers = blankTally();
  const spam: string[] = [];
  const counters = sim.state.stats.counters;
  for (const id of ids) {
    const a = sim.state.agents[id] as AgentState;
    const worker = workerEver.has(id);
    const tally = tallies.get(id)!;
    addTally(worker ? workers : stayHome, tally);
    let maxNE = 0;
    let worst: string | null = null;
    for (const [k, n] of runsPerDay) {
      const [d, aid, iid] = k.split('|');
      if (aid !== id) continue;
      const def = sim.content.interactions[iid];
      if (!def || isEssentialInteraction(sim.engine, def)) continue;
      if (n > maxNE) {
        maxNE = n;
        worst = `${iid}×${n} (day ${d})`;
      }
      // Socials count as one interaction id across all partners (the rule as written; skeptic review 1007 had
      // 7 jokes a day spread over two housemates, which the earlier per-partner count let through).
      if (n > SPAM_LIMIT) spam.push(`${a.firstName} ${iid} ×${n} on day ${d}`);
    }
    let top: string | null = null;
    let topMin = 0;
    for (const [iid, m] of awakeMin.get(id)!) if (iid !== '(idle)' && !iid.startsWith('engine_idle') && m > topMin) [top, topMin] = [iid, m];
    const tot = awakeTotal.get(id) ?? 0;
    const c = crumbles.find((x) => x.id === id);
    agents.push({
      id,
      name: `${a.firstName} ${a.lastName}`,
      traits: a.traits.slice(),
      aspiration: a.aspiration,
      worker,
      career: a.career ? { track: a.career.trackId, level: a.career.level, performance: Math.round(a.career.performance) } : null,
      crumbledDay: c ? c.day : null,
      skills: Object.fromEntries(SKILL_IDS.map((s) => [s, a.skills[s]?.level ?? 0])),
      finalNeeds: Object.fromEntries(NEED_IDS.map((n) => [n, Math.round(a.needs[n])])) as Record<NeedId, number>,
      vitality: Math.round(a.vitality * 10) / 10,
      tally,
      maxNonEssentialPerDay: maxNE,
      worstNonEssential: worst,
      topAwakeShare: tot > 0 ? topMin / tot : 0,
      topAwakeInteraction: top,
      limbsLost: sim.state.stats.agent[id]?.limbsLost ?? 0,
    });
  }
  let met = 0;
  let friends = 0;
  let hhFriends = 0;
  let partners = 0;
  const hh = new Set(ids);
  for (const r of Object.values(sim.state.relationships)) {
    if (!(hh.has(r.a) || hh.has(r.b))) continue;
    if (r.met) met++;
    if (r.friendship >= 35) {
      friends++;
      if (hh.has(r.a) && hh.has(r.b)) hhFriends++;
    }
    if (r.partners) partners++;
  }
  return {
    scenario: spec.id,
    seed,
    difficulty: spec.difficulty,
    days,
    daysSurvived,
    gameOver: sim.state.gameOver,
    firstCrumbleDay: crumbles.length ? Math.min(...crumbles.map((c) => c.day)) : null,
    crumbles,
    members: ids.length,
    agents,
    stayHome,
    workers,
    funds,
    money: Object.fromEntries([...money].sort((x, y) => x[1] - y[1])),
    bills: {
      issued: counters.billsIssued ?? 0,
      paid: counters.billsPaid ?? 0,
      late: lateBills.size,
      powerCuts: counters.powerCuts ?? 0,
      repoVisits,
      repossessions: counters.repossessions ?? 0,
    },
    fires: counters.firesStarted ?? 0,
    limbsLost: counters.limbsLost ?? 0,
    relationships: { met, friends, householdFriends: hhFriends, partners },
    spam,
    faults: sim.faults().slice(0, 20),
    violations: [...violations],
    playerLog: ps.log,
    ms: Math.round(performance.now() - t0),
  };
}

// ───────────────────────────────────────── summaries ─────────────────────────────────────────

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Least-squares slope of funds per day over days [from, end]. */
export function fundsSlope(funds: number[], from = 7): number {
  const pts = funds.map((f, d) => [d, f] as const).filter(([d]) => d >= from);
  if (pts.length < 2) return 0;
  const mx = pts.reduce((s, [d]) => s + d, 0) / pts.length;
  const my = pts.reduce((s, [, f]) => s + f, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [d, f] of pts) {
    num += (d - mx) * (f - my);
    den += (d - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

export function formatRun(m: RunMetrics): string {
  const lines: string[] = [];
  const sh = worstCritShare(m.stayHome);
  lines.push(
    `[${m.scenario} seed ${m.seed}] ${m.members} zombies · survived ${m.daysSurvived}/${m.days}d · first crumble ${m.firstCrumbleDay ?? '—'} · ` +
      `stay-home worst ${sh.need} ${pct(sh.share)} (${m.stayHome.hours}h) · workers fun<15 ${pct(critShare(m.workers, 'fun'))} (${m.workers.hours}h) · ` +
      `funds ${m.funds[0]}→${m.funds.at(-1)} (slope d7+ ${fundsSlope(m.funds).toFixed(0)}/d) · bills ${m.bills.issued}/${m.bills.paid}/late ${m.bills.late}/cuts ${m.bills.powerCuts}/repo ${m.bills.repoVisits} · ` +
      `fires ${m.fires} · limbs ${m.limbsLost} · rel met ${m.relationships.met} friends ${m.relationships.friends} · faults ${m.faults.length} · viol ${m.violations.length} · ${(m.ms / 1000).toFixed(1)}s`,
  );
  for (const a of m.agents) {
    const crit = NEED_IDS.map((n) => `${n.slice(0, 4)} ${pct(critShare(a.tally, n))}/min${Math.round(a.tally.min[n])}/avg${Math.round(a.tally.sum[n] / Math.max(1, a.tally.hours))}`).join(' ');
    const sk = Object.entries(a.skills).filter(([, l]) => l > 0).map(([s, l]) => `${s}${l}`).join(',');
    lines.push(
      `    ${a.name} [${a.traits.join(',')}] ${a.worker ? `WORKER ${a.career?.track ?? '?'} L${a.career?.level ?? '?'}` : 'home'} · crumbled ${a.crumbledDay ?? '—'} · vit ${a.vitality} · ` +
        `${crit} · maxNE/d ${a.maxNonEssentialPerDay} ${a.worstNonEssential ?? ''} · top awake ${a.topAwakeInteraction} ${pct(a.topAwakeShare)} · skills ${sk || '—'} · limbs ${a.limbsLost}`,
    );
  }
  if (m.spam.length) lines.push(`    SPAM: ${m.spam.slice(0, 6).join('; ')}`);
  if (m.faults.length) lines.push(`    FAULTS: ${m.faults.slice(0, 3).map((f) => `${f.where}: ${f.message}`).join('; ')}`);
  if (m.violations.length) lines.push(`    VIOLATIONS: ${m.violations.slice(0, 3).join('; ')}`);
  lines.push(`    money: ${Object.entries(m.money).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (m.playerLog.length) lines.push(`    player: ${m.playerLog.filter((l) => !l.endsWith(' ok')).join('; ')}`);
  return lines.join('\n');
}

export interface ScenarioSummary {
  scenario: string;
  runs: number;
  survived10: number;
  noCrumbleBefore8: number;
  noCrumble: number;
  meanFirstCrumble: number | null;
  stayHomeWorst: { need: NeedId; share: number };
  stayHomeShares: Record<NeedId, number>;
  workerFun: number;
  workerShares: Record<NeedId, number>;
  stayHomeMin: Record<NeedId, number>;
  stayHomeAvg: Record<NeedId, number>;
  workerMin: Record<NeedId, number>;
  workerAvg: Record<NeedId, number>;
  maxNonEssential: number;
  maxAwakeShare: number;
  fundsSlopeMin: number;
  repoVisits: number;
  powerCuts: number;
  lateBills: number;
  fires: number;
  limbs: number;
  faults: number;
  violations: number;
  totalCrumbles: number;
}

export function summarize(runs: RunMetrics[]): ScenarioSummary {
  const stay = blankTally();
  const work = blankTally();
  for (const r of runs) {
    addTally(stay, r.stayHome);
    addTally(work, r.workers);
  }
  const firsts = runs.map((r) => r.firstCrumbleDay).filter((d): d is number => d !== null);
  return {
    scenario: runs[0]?.scenario ?? '?',
    runs: runs.length,
    survived10: runs.filter((r) => r.daysSurvived >= Math.min(10, r.days)).length,
    noCrumbleBefore8: runs.filter((r) => r.firstCrumbleDay === null || r.firstCrumbleDay >= 8).length,
    noCrumble: runs.filter((r) => r.firstCrumbleDay === null).length,
    meanFirstCrumble: firsts.length ? firsts.reduce((s, d) => s + d, 0) / firsts.length : null,
    stayHomeWorst: worstCritShare(stay),
    stayHomeShares: Object.fromEntries(NEED_IDS.map((n) => [n, critShare(stay, n)])) as Record<NeedId, number>,
    workerFun: critShare(work, 'fun'),
    workerShares: Object.fromEntries(NEED_IDS.map((n) => [n, critShare(work, n)])) as Record<NeedId, number>,
    stayHomeMin: { ...stay.min },
    stayHomeAvg: Object.fromEntries(NEED_IDS.map((n) => [n, stay.hours ? stay.sum[n] / stay.hours : 0])) as Record<NeedId, number>,
    workerMin: { ...work.min },
    workerAvg: Object.fromEntries(NEED_IDS.map((n) => [n, work.hours ? work.sum[n] / work.hours : 0])) as Record<NeedId, number>,
    maxNonEssential: Math.max(0, ...runs.flatMap((r) => r.agents.map((a) => a.maxNonEssentialPerDay))),
    maxAwakeShare: Math.max(0, ...runs.flatMap((r) => r.agents.map((a) => a.topAwakeShare))),
    fundsSlopeMin: Math.min(...runs.map((r) => fundsSlope(r.funds))),
    repoVisits: runs.reduce((s, r) => s + r.bills.repoVisits, 0),
    powerCuts: runs.reduce((s, r) => s + r.bills.powerCuts, 0),
    lateBills: runs.reduce((s, r) => s + r.bills.late, 0),
    fires: runs.reduce((s, r) => s + r.fires, 0),
    limbs: runs.reduce((s, r) => s + r.limbsLost, 0),
    faults: runs.reduce((s, r) => s + r.faults.length, 0),
    violations: runs.reduce((s, r) => s + r.violations.length, 0),
    totalCrumbles: runs.reduce((s, r) => s + r.crumbles.length, 0),
  };
}

export function formatSummary(s: ScenarioSummary): string {
  const shares = (o: Record<NeedId, number>, mn: Record<NeedId, number>, av: Record<NeedId, number>): string =>
    NEED_IDS.map((n) => `${n.slice(0, 4)} ${pct(o[n])} (min ${Math.round(mn[n])} avg ${Math.round(av[n])})`).join(' ');
  return (
    `== ${s.scenario}: ${s.runs} runs · survived≥10d ${s.survived10}/${s.runs} · no crumble<d8 ${s.noCrumbleBefore8}/${s.runs} · no crumble ${s.noCrumble}/${s.runs} (total ${s.totalCrumbles}, mean first d${s.meanFirstCrumble?.toFixed(1) ?? '—'})\n` +
    `   stay-home <15: ${shares(s.stayHomeShares, s.stayHomeMin, s.stayHomeAvg)}\n   workers  <15: ${shares(s.workerShares, s.workerMin, s.workerAvg)}\n` +
    `   maxNE/day ${s.maxNonEssential} · max awake share ${pct(s.maxAwakeShare)} · funds slope d7+ min ${s.fundsSlopeMin.toFixed(0)}/d · late ${s.lateBills} cuts ${s.powerCuts} repo ${s.repoVisits} · fires ${s.fires} · limbs ${s.limbs} · faults ${s.faults} · viol ${s.violations}`
  );
}
