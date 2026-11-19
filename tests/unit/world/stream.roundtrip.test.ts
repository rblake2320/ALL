/**
 * W-025 S4 (docs/DESIGN_WORLD_LEVELS.md §1.4, §1.15 AC-3 / AC-4 with streaming): a member walks home → the neighbour's
 * yard (n3) → Mildew Lane → the Old Graveyard → home while STREAMING alone brings regions live ahead of the walker and
 * freezes the ones left behind (no manual activation anywhere). Checks:
 *  - every region the walker enters was live before it got there; no member is ever in a dormant region;
 *  - regions freeze behind the walker (snapshots written, objects out of `state.objects`) and thaw again on the way
 *    back (objects back, catch-up watermark = the thaw tick);
 *  - byte-identical vs an independent reference run and vs the pinned golden (fixtures/s4.stream.golden.json);
 *  - save / load (the real SaveManager) on the tick before, of and after EVERY tier change, then continuing, gives
 *    the final state of the uninterrupted run, byte for byte; so does a journal-style replay after a kill.
 */
import { legacyReferenceHash } from './legacyReference';
import type { WorldState } from '../../../src/sim/types';
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import golden from './fixtures/s4.stream.batch-v3-pets-outdoors.golden.json';
import legacyGolden from './fixtures/s4.stream.golden.json';
import type { Command } from '../../../src/sim/contracts';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { WorldRouteTarget } from '../../../src/shared/world';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';
import { agentRegion, isRegionActive, spatialOfRegion } from '../../../src/sim/engine/regions';
import { streamNotes } from '../../../src/sim/engine/streaming';
import { GRAVEYARD, HOME, N3, stateHash, tileOfAgent } from './s3Harness';
import { saveAndLoad, stepLogged, streamWorld, type TierChange } from './s4Harness';

const LEGS: WorldRouteTarget[] = [
  { regionId: N3, x: 5, z: 25 },
  { regionId: GRAVEYARD, x: 14, z: 20 },
  { regionId: HOME, x: 15, z: 20 },
];
const TICKS = 2200;

interface Run {
  tiers: TierChange[];
  crossings: { tick: number; from: string; to: string; portalId: string }[];
  hashes: { tick: number; hash: string }[];
  journal: { tick: number; cmd: Command }[];
  leg: number;
}

function command(sim: EngineSimulation, a: string, run: Run): Command | null {
  const ag = sim.state.agents[a];
  if (ag.active || ag.queue.length > 0 || run.leg >= LEGS.length || sim.state.tick % 2 !== 0) return null;
  const t = LEGS[run.leg++];
  return { type: 'queue', actorId: a, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: t.x, z: t.z }, params: { regionId: t.regionId } };
}

function drive(sim: EngineSimulation, a: string, run: Run, toTick: number, opts: { hash?: (world: WorldState) => string; replay?: Run['journal']; checks?: boolean } = {}): void {
  while (sim.state.tick < toTick) {
    const cmds = opts.replay ? opts.replay.filter((j) => j.tick === sim.state.tick).map((j) => j.cmd) : [command(sim, a, run)].filter((c): c is Command => !!c);
    for (const c of cmds) {
      expect(sim.dispatch(c).ok).toBe(true);
      run.journal.push({ tick: sim.state.tick, cmd: c });
    }
    stepLogged(sim, run.tiers);
    for (const e of sim.drainEvents()) if (e.type === 'regionCrossed') run.crossings.push({ tick: sim.state.tick, from: e.from, to: e.to, portalId: e.portalId });
    if (opts.checks) {
      for (const id of sim.state.household.memberIds) {
        const ag = sim.state.agents[id];
        const rid = agentRegion(sim.engine, ag);
        expect(isRegionActive(sim.engine, rid)).toBe(true);
        // privacy (D-068 ownership table): a neighbour's yard and front path are walkable, its house never is, for a
        // walker without a welcome; so no member ever stands indoors in another household's lot
        if (rid !== HOME) {
          const sp = spatialOfRegion(sim.engine, rid)!;
          const t = sp.tileOf(ag.pos);
          expect({ id, rid, indoor: sp.isIndoor(t.x, t.z) }).toEqual({ id, rid, indoor: false });
        }
      }
    }
    if (sim.state.tick % 100 === 0) run.hashes.push({ tick: sim.state.tick, hash: (opts.hash ?? stateHash)(sim.state) });
  }
}

function newRun(): Run {
  return { tiers: [], crossings: [], hashes: [], journal: [], leg: 0 };
}

function session(seed = 7, checks = false, legacy = false) {
  const hash = legacy ? legacyReferenceHash : stateHash;
  const { sim, eng, members } = streamWorld({ seed });
  const run = newRun();
  drive(sim, members[0], run, TICKS, { checks, hash });
  return { sim, eng, members, run, final: hash(sim.state) };
}

describe('S4 streaming round trip (home → n3 → street → graveyard → home)', () => {
  const ref = session(7, true);

  it('regions activate ahead of the walker and freeze behind it; every leg arrives', () => {
    const { sim, eng, members, run } = ref;
    const a = members[0];
    expect(run.leg).toBe(LEGS.length);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: HOME, x: 15, z: 20 });
    expect(run.crossings.filter((c) => c.to === GRAVEYARD).length).toBe(1);
    // every crossing went into a region that was already live (streaming activated it ahead, on an evaluation tick)
    for (const c of run.crossings) {
      const thawedAt = [...run.tiers].reverse().find((t) => t.tick < c.tick && t.thawed.includes(c.to));
      const frozenAfter = thawedAt ? run.tiers.find((t) => t.tick > thawedAt.tick && t.tick < c.tick && t.frozen.includes(c.to)) : undefined;
      const liveFromStart = c.to === HOME || (!thawedAt && !run.tiers.some((t) => t.tick < c.tick && t.frozen.includes(c.to)));
      expect(liveFromStart || (!!thawedAt && !frozenAfter)).toBe(true);
    }
    // the graveyard thawed before the gate crossing (pre-activated, not on the crossing tick itself) and froze after
    const gate = run.crossings.find((c) => c.to === GRAVEYARD)!;
    const gThaw = run.tiers.find((t) => t.thawed.includes(GRAVEYARD))!;
    expect(gThaw.tick).toBeLessThan(gate.tick);
    expect(run.tiers.some((t) => t.tick > gate.tick && t.frozen.includes(GRAVEYARD))).toBe(true);
    // lots behind the walker froze while it was at the graveyard and thawed again on the way back (n1 stays live:
    // the second member never leaves home, 45 tiles cover it)
    const s3 = 'wormwood:mildew_s3';
    expect(run.tiers.some((t) => t.frozen.includes(s3))).toBe(true);
    expect(run.tiers.some((t) => t.thawed.includes(s3) && t.tick > gate.tick)).toBe(true);
    expect(run.tiers.some((t) => t.frozen.includes('wormwood:mildew_n1'))).toBe(false);
    // every live region is caught up to its last thaw tick (the watermark moves only on a thaw)
    for (const id of sim.state.town!.stream.active) {
      if (id === HOME) continue;
      const last = [...run.tiers].reverse().find((t) => t.thawed.includes(id))!;
      expect({ id, w: sim.state.town!.regions[id].caughtUpTick }).toEqual({ id, w: last.tick });
    }
    // a frozen region's objects live only in its snapshot; an active one's only in state.objects
    const town = sim.state.town!;
    for (const [id, rec] of Object.entries(town.regions)) {
      if (id === HOME || !rec.snapshot) continue;
      const inWorld = Object.values(sim.state.objects).filter((o) => o.regionId === id).length;
      const inSnap = Object.keys(rec.snapshot.objects as object).length;
      if (isRegionActive(eng, id)) expect(inSnap).toBe(0);
      else expect(inWorld).toBe(0);
    }
    expect(run.tiers.length).toBeGreaterThan(6);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    expect(streamNotes(eng)).toEqual([]);
    // eslint-disable-next-line no-console
    console.log(`[S4 round trip] ${run.tiers.length} tier changes, ${run.crossings.length} crossings, ${run.tiers.reduce((n, t) => n + t.thawed.length, 0)} thaws, ${run.tiers.reduce((n, t) => n + t.frozen.length, 0)} freezes`);
  });

  it('complete current runs match; legacy fields match unchanged pinned hashes', () => {
    const again = session(7);
    expect(again.run.hashes).toEqual(ref.run.hashes);
    expect(again.run.tiers).toEqual(ref.run.tiers);
    expect(again.final).toBe(ref.final);
    const legacy = session(7, false, true);
    expect(legacy.run.tiers).toEqual(ref.run.tiers);
    expect(legacy.run.crossings).toEqual(ref.run.crossings);
    const now = { seed: 7, ticks: TICKS, final: legacy.final, hashes: legacy.run.hashes, tiers: legacy.run.tiers, crossings: legacy.run.crossings };
    expect(now.tiers).toEqual(legacyGolden.tiers);
    expect(now.crossings).toEqual(legacyGolden.crossings);
    // re-record only on purpose: S4_RECORD=1 npx vitest run <this file>
    if (process.env.S4_RECORD === '1') writeFileSync(fileURLToPath(new URL('./fixtures/s4.stream.batch-v3-pets-outdoors.golden.json', import.meta.url)), `${JSON.stringify(now, null, 1)}\n`);
    else expect(now).toEqual(golden);
    // eslint-disable-next-line no-console
    console.log(`[S4 round trip] seed 7, ${TICKS} ticks, final ${ref.final}`);
    expect(session(8).final).not.toBe(ref.final);
  });

  it('save / load on the tick before, of and after every tier change continues byte-identically', async () => {
    const ticks = [...new Set(ref.run.tiers.flatMap((t) => [t.tick - 1, t.tick, t.tick + 1]))].filter((t) => t > 0 && t < TICKS).sort((x, y) => x - y);
    expect(ticks.length).toBeGreaterThan(15);
    // one session, saved at every boundary tick on the way (each copy continues on its own to the end)
    const { sim, members } = streamWorld({ seed: 7 });
    const run = newRun();
    for (const t of ticks) {
      drive(sim, members[0], run, t, { replay: ref.run.journal });
      const loaded = await saveAndLoad(JSON.parse(JSON.stringify(sim.state)));
      expect(loaded.warnings).toEqual([]);
      expect(loaded.repair).toEqual([]);
      const cont = newRun();
      drive(loaded.sim, members[0], cont, TICKS, { replay: ref.run.journal });
      expect({ t, final: stateHash(loaded.sim.state) }).toEqual({ t, final: ref.final });
      expect(loaded.sim.faults()).toEqual([]);
    }
    // eslint-disable-next-line no-console
    console.log(`[S4 save/load] ${ticks.length} save points around ${ref.run.tiers.length} tier changes: all byte-identical`);
  }, 600_000);

  it('journal-style replay after a kill mid-walk (snapshot + the commands after it) recovers the same state', async () => {
    const killAt = ref.run.crossings[Math.floor(ref.run.crossings.length / 2)].tick + 3;
    const { sim, members } = streamWorld({ seed: 7 });
    const run = newRun();
    drive(sim, members[0], run, 500, { replay: ref.run.journal });
    const snap = JSON.parse(JSON.stringify(sim.state));
    drive(sim, members[0], run, killAt, { replay: ref.run.journal }); // ... and the process dies here
    const loaded = await saveAndLoad(snap);
    drive(loaded.sim, members[0], newRun(), TICKS, { replay: ref.run.journal });
    expect(stateHash(loaded.sim.state)).toBe(ref.final);
  });
});
