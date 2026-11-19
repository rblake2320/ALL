/**
 * W-075 ambient wildlife (docs/systems/wildlife.md): critters are a pure function of (seed, lot, tick, layout),
 * never stored in the world; per-species and per-lot caps hold at every tick; species keep their time of day;
 * frogs and fireflies only appear by water; the comic zombie chase never catches anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ambientWildlife,
  chaseCritter,
  CHASE_MOODLETS,
  CATCH_RADIUS,
  SPECIES_CAPS,
  WILDLIFE_CAP_PER_LOT,
  WILDLIFE_SPECIES,
  type WildlifeLotLayout,
} from '../../../src/sim/systems/wildlife';
import { tickAt, timeInfo } from '../../../src/sim/time';
import { TICKS_PER_DAY } from '../../../src/sim/types';

const LOT: WildlifeLotLayout = { width: 20, depth: 16 };
const WET: WildlifeLotLayout = { width: 20, depth: 16, water: [{ x: 4, z: 4 }] };
const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'public', 'assets', 'manifest.wildlife.json'), 'utf8')) as {
  species: Record<string, { clips: { name: string }[] }>;
};

function everyTick(days: number, step = 7): number[] {
  const out: number[] = [];
  for (let t = 0; t < days * TICKS_PER_DAY; t += step) out.push(t);
  return out;
}

describe('ambient wildlife spawns', () => {
  it('is deterministic for a seed, lot and time, independent of call order', () => {
    const ticks = everyTick(1, 37);
    const forward = ticks.map((t) => ambientWildlife(42, 'lot-a', t, WET));
    const backward = [...ticks].reverse().map((t) => ambientWildlife(42, 'lot-a', t, WET)).reverse();
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    expect(forward.some((l) => l.length > 0)).toBe(true);
  });

  it('differs by seed and by lot', () => {
    const t = tickAt(1, 10 * 60);
    const a = JSON.stringify(ambientWildlife(1, 'lot-a', t, LOT));
    expect(JSON.stringify(ambientWildlife(2, 'lot-a', t, LOT))).not.toBe(a);
    expect(JSON.stringify(ambientWildlife(1, 'lot-b', t, LOT))).not.toBe(a);
  });

  it('never exceeds the per-lot cap or any per-species cap', () => {
    expect(WILDLIFE_CAP_PER_LOT).toBe(12);
    let peak = 0;
    for (const seed of [1, 7, 99, 2026]) {
      for (const t of everyTick(3, 13)) {
        const list = ambientWildlife(seed, 'lot-a', t, WET);
        peak = Math.max(peak, list.length);
        expect(list.length).toBeLessThanOrEqual(WILDLIFE_CAP_PER_LOT);
        const per: Record<string, number> = {};
        for (const c of list) per[c.species] = (per[c.species] ?? 0) + 1;
        for (const [s, n] of Object.entries(per)) expect(n).toBeLessThanOrEqual(SPECIES_CAPS[s as keyof typeof SPECIES_CAPS]);
        expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
      }
    }
    expect(peak).toBeGreaterThan(0);
  });

  it('keeps time of day: birds, pigeons, squirrels by day; bats, frogs, fireflies at night', () => {
    for (const t of everyTick(2, 11)) {
      const night = timeInfo(t).isNight;
      for (const c of ambientWildlife(5, 'lot-a', t, WET)) {
        if (['songbird', 'pigeon', 'squirrel'].includes(c.species)) expect(night).toBe(false);
        if (['bat', 'frog', 'firefly'].includes(c.species)) expect(night).toBe(true);
      }
    }
  });

  it('puts frogs and fireflies only on lots with water, near the water', () => {
    for (const t of everyTick(2, 11)) {
      for (const c of ambientWildlife(5, 'lot-a', t, LOT)) expect(['frog', 'firefly']).not.toContain(c.species);
      for (const c of ambientWildlife(5, 'lot-a', t, WET)) {
        if (c.species === 'frog' || c.species === 'firefly') expect(Math.hypot(c.pos.x - 4, c.pos.z - 4)).toBeLessThanOrEqual(3);
      }
    }
    const seen = new Set<string>();
    for (const t of everyTick(2, 11)) for (const c of ambientWildlife(5, 'lot-a', t, WET)) seen.add(c.species);
    for (const s of WILDLIFE_SPECIES) expect(seen.has(s)).toBe(true);
  });

  it('exposes only { id, species, pos, facing, anim } with finite numbers and clips the manifest ships', () => {
    for (const t of everyTick(1, 17)) {
      for (const c of ambientWildlife(3, 'lot-a', t, WET)) {
        expect(Object.keys(c).sort()).toEqual(['anim', 'facing', 'id', 'pos', 'species']);
        expect(Object.isFrozen(c)).toBe(true);
        for (const v of [c.pos.x, c.pos.y, c.pos.z, c.facing]) expect(Number.isFinite(v)).toBe(true);
        if (c.species === 'firefly') expect(c.anim).toBe('glow'); // particle swarm, no model (wildlife-art.md)
        else expect(manifest.species[c.species].clips.map((k) => k.name)).toContain(c.anim);
      }
    }
  });

  it('saves nothing: no world state is read or written, layouts are not mutated', () => {
    const layout = { width: 20, depth: 16, water: [{ x: 4, z: 4 }] };
    const before = JSON.stringify(layout);
    for (const t of everyTick(1, 29)) ambientWildlife(9, 'lot-a', t, layout);
    expect(JSON.stringify(layout)).toBe(before);
    // Same answer at day 1 and day 1000 for the same slot of a cycle would mean state leaked; instead it is purely
    // keyed by the tick, so a late tick costs the same as an early one (no accumulated history).
    const late = ambientWildlife(9, 'lot-a', 1000 * TICKS_PER_DAY + 400, layout);
    expect(late.length).toBeLessThanOrEqual(WILDLIFE_CAP_PER_LOT);
  });
});

describe('comic zombie chase', () => {
  it('never catches, the zombie stops, and the critter gets away', () => {
    let chases = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const t of everyTick(2, 97)) {
        for (const c of ambientWildlife(seed, 'lot-a', t, WET)) {
          for (const start of [c.pos, { x: c.pos.x + 0.1, y: 0, z: c.pos.z }, { x: c.pos.x - 3, y: 0, z: c.pos.z + 2 }]) {
            const r = chaseCritter(seed, c, { x: start.x, z: start.z }, t);
            chases++;
            expect(r.caught).toBe(false);
            expect(r.frames.length).toBeGreaterThan(1);
            for (const f of r.frames) {
              const reach = Math.hypot(f.critter.x - f.zombie.x, f.critter.z - f.zombie.z) >= CATCH_RADIUS || f.critter.y >= 2;
              expect(reach).toBe(true);
            }
            const last = r.frames[r.frames.length - 1];
            expect(last.zombieAnim).toBe('idle');
            expect(r.durationSec).toBeGreaterThanOrEqual(4);
            expect(r.durationSec).toBeLessThanOrEqual(8);
            expect(last.t).toBeCloseTo(r.durationSec, 5);
          }
        }
      }
    }
    expect(chases).toBeGreaterThan(50);
  });

  it('is deterministic and ends in a short mood moodlet (Got Away Again, or Squirrel Rage when hot-headed)', () => {
    const t = tickAt(1, 10 * 60);
    const c = ambientWildlife(11, 'lot-a', t, LOT)[0];
    expect(c).toBeDefined();
    const a = chaseCritter(11, c, { x: 1, z: 1 }, t);
    expect(JSON.stringify(chaseCritter(11, c, { x: 1, z: 1 }, t))).toBe(JSON.stringify(a));
    expect(a.moodlet).toBe('wildlife_got_away_again');
    expect(chaseCritter(11, c, { x: 1, z: 1 }, t, { hotHeaded: true }).moodlet).toBe('wildlife_squirrel_rage');
    for (const m of CHASE_MOODLETS) {
      expect(m.durationMin).not.toBeNull();
      expect(m.durationMin!).toBeLessThanOrEqual(3 * 60);
      expect(m.maxStacks).toBe(1);
    }
  });
});
