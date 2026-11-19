/**
 * AC-3 (on foot) — W-025 S3, docs/DESIGN_WORLD_LEVELS.md §1.15: the same seed + the same commands (home → the
 * neighbour's yard → Mildew Lane → the Old Graveyard gate → back home, on foot) give a byte-identical WorldState,
 * against an independent reference run and against the pinned golden hashes (fixtures/s3.travel.golden.json, recorded
 * by this harness on the S3 tree). The hearse leg of AC-3 is S13.
 */
import { legacyReferenceHash } from './legacyReference';
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import golden from './fixtures/s3.travel.batch-v3-pets-outdoors.golden.json';
import goldenFrozen from './fixtures/s3.travel.frozen.batch-v3-pets-outdoors.golden.json';
import legacyFrozen from './fixtures/s3.travel.frozen.golden.json';
import { GRAVEYARD, HOME, N3, S2, goHere, laneWorld, stateHash, tileOfAgent } from './s3Harness';
import { LEGS_A, LEGS_B, SCRIPT_TICKS, emptyRun, runScript } from './s3Script';
import { lotToWorld } from '../../../src/shared/world';
import { regionDefOf } from '../../../src/sim/engine/worldMove';
import { streetTiles } from '../../../src/shared/mildewLane';
import { agentRegion } from '../../../src/sim/engine/regions';

function session(seed: number, legacy = false) {
  const hash = legacy ? legacyReferenceHash : stateHash;
  const { sim, eng, members } = laneWorld({ seed });
  const run = runScript(sim, members, SCRIPT_TICKS, { a: 0, b: 0 }, emptyRun(), { hash });
  return { sim, eng, members, run, final: hash(sim.state) };
}

describe('AC-3 travel round trip on foot (S3)', () => {
  it('the full travel fingerprint retains pet motion and trust after returning home', () => {
    const { sim } = session(7);
    expect(sim.state.pets!.strays.length).toBeGreaterThan(0);
    const before = stateHash(sim.state);
    const edited = structuredClone(sim.state);
    edited.pets!.strays[0].pos.x += 1;
    edited.pets!.strays[0].trust += 1;
    expect(stateHash(edited)).not.toBe(before);
  });

  it('home → neighbour yard → street → graveyard gate → home: every leg arrives, crossing the expected portals', () => {
    const { sim, eng, members, run } = session(7);
    const [a, b] = members;
    expect(run.results.every((r) => r.ok)).toBe(true);
    expect(run.results.length).toBe(LEGS_A.length + LEGS_B.length);
    const crossA = run.crossings.filter((c) => c.agentId === a).map((c) => c.portalId);
    // out: sidewalk into the neighbour's yard, its crosswalk, the street, the gate; back: the reverse
    expect(crossA.slice(0, 5)).toEqual(['sidewalk:mildew_n2-n3', 'crosswalk:mildew_n3', 'crosswalk:street_mildew_3-4', 'crosswalk:street_mildew_4-5', 'gate:old_graveyard']);
    expect(crossA).toContain('gate:old_graveyard');
    expect(crossA.filter((p) => p === 'gate:old_graveyard').length).toBe(2);
    expect(run.crossings.filter((c) => c.agentId === a && c.to === GRAVEYARD).length).toBe(1);
    expect(run.crossings.filter((c) => c.agentId === a && c.from === N3).length).toBe(2);
    expect(run.crossings.filter((c) => c.agentId === b).map((c) => c.portalId)).toEqual(['crosswalk:mildew_n2', 'crosswalk:mildew_n2']);
    // both are home again, on their target tiles, idle, with the home's regionId ABSENT again
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: HOME, x: 15, z: 20 });
    expect(tileOfAgent(eng, sim.state.agents[b])).toEqual({ regionId: HOME, x: 12, z: 22 });
    for (const id of [a, b]) {
      expect('regionId' in sim.state.agents[id]).toBe(false);
      expect(sim.state.agents[id].active).toBeNull();
    }
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('complete current runs match; legacy fields match unchanged pinned hashes', () => {
    const ref = session(7);
    const again = session(7);
    expect(again.run.hashes).toEqual(ref.run.hashes);
    expect(again.run.crossings).toEqual(ref.run.crossings);
    expect(again.final).toBe(ref.final);
    const g = golden as { seed: number; ticks: number; final: string; hashes: { tick: number; hash: string }[]; crossings: unknown[] };
    // eslint-disable-next-line no-console
    console.log(`[AC-3] seed 7, ${SCRIPT_TICKS} ticks, ${ref.run.crossings.length} crossings, final ${ref.final}`);
    const legacy = session(7, true);
    expect(legacy.run.crossings).toEqual(ref.run.crossings);
    const now = { seed: 7, ticks: SCRIPT_TICKS, final: legacy.final, hashes: legacy.run.hashes, crossings: legacy.run.crossings };
    // re-record (only on purpose, after an intended behaviour change): S3_RECORD=1 npx vitest run <this file>
    if (process.env.S3_RECORD === '1') writeFileSync(fileURLToPath(new URL('./fixtures/s3.travel.batch-v3-pets-outdoors.golden.json', import.meta.url)), `${JSON.stringify(now, null, 1)}\n`);
    else expect(now).toEqual(g);
    // a different seed is a different world (the test can tell runs apart)
    expect(session(8).final).not.toBe(ref.final);
  });

  it('with streaming frozen, schema-v3 fingerprints reproduce and the original S3 crossing trace is unchanged', () => {
    // s3.travel.frozen.golden.json is the golden recorded on the S3 tree (bda3fb3, matched on Windows and ARM). With
    // streaming frozen (`expandPending`, hashed as `false` so the bytes are the S3 world's), S4 gives the same 14
    // hashes, the same 12 crossings and the same final hash: nothing else in S4 changes this walk. With streaming on,
    // the dormant n4 becomes plannable, so the return leg cuts through n4's front yard (crosswalk:mildew_n4 +
    // sidewalk:mildew_n3-n4, avoiding the road +2 of street 3), and regions freeze / thaw (town.stream, snapshots,
    // objects moved): that is the new golden above.
    const frozen = goldenFrozen as { final: string; hashes: { tick: number; hash: string }[]; crossings: unknown[] };
    const { sim, members } = laneWorld({ seed: 7 });
    sim.state.town!.expandPending = true;
    const asS3 = () => {
      const c = JSON.parse(JSON.stringify(sim.state));
      c.town.expandPending = false;
      return legacyReferenceHash(c);
    };
    const d = { a: 0, b: 0 };
    const run = emptyRun();
    const hashes: { tick: number; hash: string }[] = [];
    while (sim.state.tick < SCRIPT_TICKS) {
      runScript(sim, members, sim.state.tick + 1, d, run, { every: 1e9 });
      if (sim.state.tick % 100 === 0) hashes.push({ tick: sim.state.tick, hash: asS3() });
    }
    expect(run.crossings).toEqual(legacyFrozen.crossings);
    expect(legacyFrozen.final.startsWith('1dc921c0')).toBe(true);
    if (process.env.S3_RECORD === '1') writeFileSync(fileURLToPath(new URL('./fixtures/s3.travel.frozen.batch-v3-pets-outdoors.golden.json', import.meta.url)), `${JSON.stringify({ final: asS3(), hashes, crossings: run.crossings }, null, 1)}\n`);
    else {
      expect(hashes).toEqual(frozen.hashes);
      expect(run.crossings).toEqual(frozen.crossings);
      expect(asS3()).toBe(frozen.final);
    }
  });

  it('every crossing is seamless in world space, re-homes regionId at that tick, and keeps the walk on verges and crosswalks', () => {
    const { sim, eng, members } = laneWorld({ seed: 7 });
    const [a] = members;
    const d = { a: 0, b: 99 };
    const run = emptyRun();
    let last: { region: string; wx: number; wz: number } | null = null;
    let maxJump = 0;
    const offKinds = new Set<string>();
    for (let t = 0; t < SCRIPT_TICKS; t++) {
      runScript(sim, members, sim.state.tick + 1, d, run, { every: 1e9 });
      const ag = sim.state.agents[a];
      const region = agentRegion(eng, ag);
      const def = regionDefOf(eng, region)!;
      const w = lotToWorld(def.placement, ag.pos.x, ag.pos.z)!;
      const wp = lotToWorld(def.placement, ag.prevPos.x, ag.prevPos.z)!;
      if (last) {
        // prevPos (transformed with pos) is where the agent stood at the start of this tick: no jump, in world space
        expect(Math.hypot(wp.x - last.wx, wp.z - last.wz)).toBeLessThan(1e-9);
        maxJump = Math.max(maxJump, Math.hypot(w.x - wp.x, w.z - wp.z));
      }
      last = { region, wx: w.x, wz: w.z };
      const kinds = streetTiles(def);
      if (kinds) {
        const tt = tileOfAgent(eng, ag);
        const k = kinds[tt.z * def.placement.width + tt.x];
        if (k !== 'verge' && k !== 'crosswalk') offKinds.add(`${region}:${tt.x},${tt.z}:${k}`);
      }
      // the tick of a crossing: the agent is inside the new region's grid already
      const c = run.crossings.find((x) => x.tick === sim.state.tick && x.agentId === a);
      if (c) expect(region).toBe(c.to);
    }
    expect(run.crossings.filter((c) => c.agentId === a).length).toBeGreaterThanOrEqual(10);
    // walking speed 1.3 tiles / game min = 0.325 tiles per tick: a crossing moves no faster than a normal step
    expect(maxJump).toBeLessThanOrEqual(0.33);
    // road and curb tiles cost +2: on the street segments the walk keeps to the verge; the only road it crosses is
    // the street end's turning circle in front of the graveyard gate (the gate opens onto the road centre, rows 4–5)
    const off = [...offKinds];
    expect(off.length).toBeGreaterThan(0);
    expect(off.length).toBeLessThanOrEqual(10);
    for (const k of off) expect(k.startsWith('street:mildew:5:') || k.startsWith('street:mildew:4:2')).toBe(true);
  });

  it('crossing the street to the far side uses the crosswalk (no road or curb tile off the crosswalk)', () => {
    const { sim, eng, members } = laneWorld({ seed: 7 });
    const [a] = members;
    expect(goHere(sim, a, { regionId: S2, x: 10, z: 20 }).ok).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) {
      sim.step();
      const ag = sim.state.agents[a];
      const t = tileOfAgent(eng, ag);
      const def = regionDefOf(eng, t.regionId)!;
      const kinds = streetTiles(def);
      if (kinds) seen.add(kinds[t.z * def.placement.width + t.x]);
      if (!ag.active && ag.queue.length === 0) break;
    }
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: S2, x: 10, z: 20 });
    expect([...seen].sort()).toEqual(['crosswalk', 'verge'].filter((k) => seen.has(k)).sort());
    expect(seen.has('crosswalk')).toBe(true);
  });
});
