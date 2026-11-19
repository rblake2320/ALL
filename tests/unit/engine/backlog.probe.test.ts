/**
 * Multi-day REAL-content probes for the integration backlog (heavy: each test simulates several game days — run
 * sequentially, one world per test, no per-tick logging).
 *   #6  save → load → continue is deterministic end to end over 3 game days (plain JSON AND the real SaveManager:
 *       canonical key-sorted JSON, envelope, validation, engine repair hook), including a build undo that re-inserts
 *       an old object id out of order.
 *   #13 no non-essential interaction runs more than 6× per zombie per game day in a 4-day unattended probe
 *       (door-slam / speech-practice spam gone).
 *   #12 balance metric: a day-job worker's Amusement is < 15 in < 5 % of their on-lot hours.
 */
import { describe, expect, it } from 'vitest';
import type { NewGameOptions, SimulationAPI } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { isEssentialInteraction } from '../../../src/sim/engine/repetition';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { makeMeta, silentLogger } from '../persistence/fixtures';

const HEAVY = 300_000;

/** Long synchronous loops starve the vitest worker's RPC heartbeat on a loaded machine: yield every so often. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function household(seed: number): NewGameOptions {
  return {
    seed,
    householdName: 'Probe',
    lotTemplate: 'starter',
    difficulty: 'normal',
    members: [
      { firstName: 'Mort', lastName: 'Probe', appearance: defaultAppearance(), traits: ['gourmand', 'neatFreak', 'vain'], aspiration: 'tycoon' },
      { firstName: 'Ghoulia', lastName: 'Probe', appearance: defaultAppearance(), traits: ['artistic', 'lazy', 'hothead'], aspiration: 'afterparty' },
      { firstName: 'Bram', lastName: 'Probe', appearance: defaultAppearance(), traits: ['socialButterfly', 'bookworm', 'partyAnimal'], aspiration: 'masterPreserver' },
    ],
  };
}

function employ(sim: SimulationAPI, idx: number, careerId: string): void {
  const id = sim.state.household.memberIds[idx];
  const r = sim.dispatch({ type: 'queue', actorId: id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId } });
  if (!r.ok) throw new Error(`could not get a job: ${r.reason}`);
}

/** First differing leaf paths (readable failures). */
function diff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 10 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
  } else out.push(`${path}: ${JSON.stringify(a)?.slice(0, 90)} vs ${JSON.stringify(b)?.slice(0, 90)}`);
  return out;
}

describe('#6 save → load → continue is deterministic end to end (real content, 3 game days)', () => {
  it('every 8 game hours: the loaded world serializes equal to the saved one, and both continue identically', { timeout: HEAVY }, async () => {
    const live = createSimulation(createNewWorld(household(606))) as EngineSimulation;
    employ(live, 2, 'necrotech');
    // A build session that leaves an object id OUT of numeric insertion order (undo re-inserts the TV at the end).
    const tv = Object.values(live.state.objects).find((o) => o.defId === 'tv_crt')!;
    for (let z = 20; z < 23; z++) live.build.apply({ type: 'buy', defId: 'chair_creaky', x: 21, z, rot: 0 });
    expect(live.build.apply({ type: 'sell', objectId: tv.id }).ok).toBe(true);
    expect(live.build.undo()).toBe(true);
    live.build.clearHistory();
    expect(Object.keys(live.state.objects).at(-1)).toBe(tv.id);

    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger, repair: engineRepairHook() });
    const seg = 8 * TICKS_PER_HOUR;
    let other: SimulationAPI = live;
    let checked = 0;
    for (let s = 0; s < 9; s++) {
      // save the continuing timeline (alternating the real SaveManager and a plain JSON round trip) and load it
      const snapshot = other.serialize();
      let loadedWorld: WorldState;
      if (s % 2 === 0) {
        const saved = await mgr.save('probe', 'Probe', snapshot, makeMeta());
        expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
        const loaded = await mgr.load('probe');
        expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
        if (!loaded.ok) return;
        expect(loaded.warnings).toEqual([]);
        loadedWorld = loaded.world;
      } else loadedWorld = JSON.parse(JSON.stringify(snapshot)) as WorldState;
      const next = createSimulation(loadedWorld);
      expect(next.repairWarnings).toEqual([]); // repairWorld is a true no-op on a healthy world (decision #9)
      expect(next.serialize()).toEqual(snapshot); // serialize equality right after load
      other = next;
      for (let i = 0; i < seg; i++) {
        live.step();
        other.step();
        if (i % 480 === 0) {
          live.drainEvents();
          other.drainEvents();
          await breathe();
        }
      }
      const a = canonicalJson(live.serialize());
      const b = canonicalJson(other.serialize());
      if (a !== b) throw new Error(`diverged after segment ${s} (tick ${live.state.tick}): ${diff(JSON.parse(a), JSON.parse(b)).join('; ')}`);
      checked++;
    }
    expect(checked).toBe(9);
    expect(live.state.tick).toBeGreaterThanOrEqual(3 * TICKS_PER_DAY);
    expect(live.faults()).toEqual([]);
    expect(live.checkInvariants()).toEqual([]);
  });
});

describe('#13 + #12 four unattended game days (real content, one employed zombie)', () => {
  it('no non-essential interaction > 6 runs per zombie per game day; the worker’s Amusement < 15 in < 5 % of on-lot hours', { timeout: HEAVY }, async () => {
    const sim = createSimulation(createNewWorld(household(1))) as EngineSimulation;
    const ids = sim.state.household.memberIds;
    employ(sim, 2, 'necrotech');
    const lastUid: Record<string, number> = {};
    const runs = new Map<string, number>(); // `${day}|${agent}|${interaction}` → fresh autonomous runs
    let workerHours = 0;
    let workerBored = 0;
    for (let i = 1; i <= 4 * TICKS_PER_DAY; i++) {
      sim.step();
      if (i % 480 === 0) {
        sim.drainEvents();
        await breathe();
      }
      const day = Math.floor(sim.state.tick / TICKS_PER_DAY);
      for (const id of ids) {
        const run = sim.state.agents[id].active;
        if (!run || run.uid === lastUid[id]) continue;
        lastUid[id] = run.uid;
        // a fresh autonomous decision (a suspended run re-queued after a social is the same decision, not a new one)
        if (run.source !== 'auto' || run.params._origUid !== undefined || run.interactionId.startsWith('engine_')) continue;
        const k = `${day}|${id}|${run.interactionId}`;
        runs.set(k, (runs.get(k) ?? 0) + 1);
      }
      if (i % TICKS_PER_HOUR === 0) {
        const w = sim.state.agents[ids[2]];
        if (w.presence === 'onLot') {
          workerHours++;
          if (w.needs.fun < 15) workerBored++;
        }
      }
    }
    const offenders: string[] = [];
    for (const [k, n] of runs) {
      const iid = k.split('|')[2];
      const def = sim.content.interactions[iid];
      if (def && !isEssentialInteraction(sim.engine, def) && n > 6) offenders.push(`${k}=${n}`);
    }
    expect(offenders).toEqual([]);
    for (const spammer of ['home_slamDoor', 'home_practiceSpeech']) {
      const worst = Math.max(0, ...[...runs].filter(([k]) => k.endsWith(`|${spammer}`)).map(([, n]) => n));
      expect(worst, spammer).toBeLessThanOrEqual(6); // was ~250 / day (door slams) before backlog #13
    }
    expect(workerHours).toBeGreaterThan(40);
    expect(workerBored / workerHours).toBeLessThan(0.05);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });
});
