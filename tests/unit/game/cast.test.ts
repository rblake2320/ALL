/**
 * Cast bodies (src/shared/cast.ts) on the GAME side: CAZ state/validation, randomize (~50 %, no RNG stream shift),
 * the demo household, the real createNewWorld, and saves (old saves load untouched; body round-trips; unknown ids
 * repair to classic with exactly one warning).
 */
import { describe, expect, it } from 'vitest';
import { CAST_BODIES, CAST_BODY_IDS, isCastBodyId } from '../../../src/shared/cast';
import { defaultAppearance, type ZombieAppearance } from '../../../src/shared/appearance';
import type { CazState } from '../../../src/game/contracts';
import type { WorldState } from '../../../src/sim/types';
import { appearanceProblems, cazIssues, finalizeCaz, patchCaz, sanitizeAppearance, updateMember, validateCazState } from '../../../src/game/cazState';
import {
  CAST_BODY_CHANCE,
  bodyForKey,
  randomAppearance,
  randomAspiration,
  randomHousehold,
  randomTraits,
  randomZombie,
  randomizeMember,
  rngFromSeed,
  uniqueFirstName,
  withBody,
} from '../../../src/game/randomZombie';
import { VOICE_SEED_MAX } from '../../../src/game/cazState';
import { DEMO_BODIES, demoOptions } from '../../../src/game/demoWorld';
import { buildCazCatalog, type CazCatalog } from '../../../src/game/gddCatalog';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../../../src/sim/index';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { TICKS_PER_DAY } from '../../../src/sim/types';

const catalog: CazCatalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
const silent = { warn: () => undefined, error: () => undefined };
const META = { householdName: 'The Rotworths', memberNames: ['Mort'], day: 1, timeLabel: 'Mon 08:00', funds: 100, lotValue: 0, thumbnail: null };

function state(members = randomHousehold(42, catalog, 2).members): CazState {
  return { members, activeIndex: 0, householdName: 'Grimsby', lotTemplate: 'starter', difficulty: 'normal' };
}

function stripBodies<T>(v: T): T {
  const copy = JSON.parse(JSON.stringify(v)) as T;
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const rec = o as Record<string, unknown>;
    if (rec.appearance && typeof rec.appearance === 'object') delete (rec.appearance as Record<string, unknown>).body;
    Object.values(rec).forEach(walk);
  };
  walk(copy);
  return copy;
}

describe('CAZ state accepts cast bodies', () => {
  const base = defaultAppearance();
  it('a known id is kept, appended last so classic appearances serialise as before', () => {
    const a = sanitizeAppearance({ ...base, body: 'walker' }, base);
    expect(a.body).toBe('walker');
    expect(Object.keys(a).at(-1)).toBe('body');
    expect(JSON.stringify(sanitizeAppearance(base, base))).toBe(JSON.stringify(base));
    expect('body' in sanitizeAppearance(base, base)).toBe(false);
  });
  it("'classic' clears the body (the key is removed, never stored as 'classic')", () => {
    const a = sanitizeAppearance({ body: 'classic' }, { ...base, body: 'boss' });
    expect('body' in a).toBe(false);
  });
  it('junk keeps the previous choice; prototype tricks are ignored', () => {
    for (const junk of ['dragon', 'Walker', '', 7, null, {}, ['walker'], 'constructor', '__proto__']) {
      expect(sanitizeAppearance({ body: junk }, { ...base, body: 'bride' }).body).toBe('bride');
      expect('body' in sanitizeAppearance({ body: junk }, base)).toBe(false);
    }
    const evil = Object.create({ body: 'boss' }) as object;
    expect('body' in sanitizeAppearance(evil, base)).toBe(false);
  });
  it('a stray base body that is not a cast id never leaks through', () => {
    const a = sanitizeAppearance({}, { ...base, body: 'dragon' as never });
    expect('body' in a).toBe(false);
  });
  it('appearanceProblems flags only unknown bodies', () => {
    expect(appearanceProblems({ ...base, body: 'walker' })).toEqual([]);
    expect(appearanceProblems({ ...base, body: 'classic' })).toEqual([]);
    expect(appearanceProblems(base)).toEqual([]);
    expect(appearanceProblems({ ...base, body: 'dragon' as never })).toEqual(['body']);
  });
  it('updateMember / patchCaz / validate / finalize carry the body through to createNewWorld options', () => {
    let s = state();
    s = updateMember(s, 0, { appearance: { ...s.members[0].appearance, body: 'ringmaster' } });
    s = updateMember(s, 1, { appearance: { ...s.members[1].appearance, body: 'nope' } });
    expect(s.members[0].appearance.body).toBe('ringmaster');
    expect(s.members[1].appearance.body).toBe(state().members[1].appearance.body);
    s = patchCaz(s, { members: s.members }, catalog);
    expect(s.members[0].appearance.body).toBe('ringmaster');
    expect(validateCazState(s, catalog)).toEqual([]);
    const opts = finalizeCaz(s, 9);
    expect(opts.members[0].appearance.body).toBe('ringmaster');
  });
  it('a corrupt body injected past sanitizing is reported as an appearance issue (Body tab)', () => {
    const s = state();
    (s.members[0].appearance as ZombieAppearance).body = 'dragon' as never;
    const issues = cazIssues(s, catalog);
    expect(issues).toEqual([expect.objectContaining({ memberIndex: 0, field: 'appearance' })]);
    expect(issues[0].message).toContain('body');
  });
});

describe('Randomize picks a cast body about half the time without shifting the RNG stream', () => {
  it('bodyForKey is pure, ~CAST_BODY_CHANCE cast, covers every body', () => {
    const seen = new Map<string, number>();
    let cast = 0;
    const N = 20000;
    for (let k = 0; k < N; k++) {
      const b = bodyForKey(k * 2654435761);
      expect(b).toBe(bodyForKey(k * 2654435761));
      if (b) {
        expect(isCastBodyId(b)).toBe(true);
        cast++;
        seen.set(b, (seen.get(b) ?? 0) + 1);
      }
    }
    expect(Math.abs(cast / N - CAST_BODY_CHANCE)).toBeLessThan(0.02);
    expect(seen.size).toBe(CAST_BODY_IDS.length);
    for (const n of seen.values()) expect(n).toBeGreaterThan((cast / CAST_BODY_IDS.length) * 0.75);
    for (const junk of [NaN, Infinity, -1, 2 ** 40, 0.5]) expect(() => bodyForKey(junk)).not.toThrow();
  });
  it('randomZombie draws exactly what it drew before bodies existed (same stream position, same fields)', () => {
    for (let seed = 1; seed < 60; seed++) {
      const a = rngFromSeed(seed);
      const z = randomZombie(a, catalog, { lastName: 'Rot' });
      const b = rngFromSeed(seed);
      const first = uniqueFirstName(b, catalog, new Set());
      const app = randomAppearance(b);
      const traits = randomTraits(b, catalog);
      const asp = randomAspiration(b, catalog);
      const voice = b.int(1, VOICE_SEED_MAX);
      expect(a.next()).toBe(b.next());
      expect(stripBodies({ appearance: z.appearance })).toEqual({ appearance: app });
      expect([z.firstName, z.traits, z.aspiration, z.voiceSeed]).toEqual([first, traits, asp, voice]);
      expect(z.appearance.body ?? null).toBe(bodyForKey(voice));
    }
  });
  it('a randomized household is ~50 % cast and always valid', () => {
    let cast = 0;
    let n = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const h = randomHousehold(seed * 7919, catalog, 4);
      expect(validateCazState(state(h.members), catalog)).toEqual([]);
      for (const m of h.members) {
        n++;
        if (m.appearance.body) cast++;
        expect('body' in m.appearance ? isCastBodyId(m.appearance.body) : true).toBe(true);
      }
    }
    expect(cast / n).toBeGreaterThan(0.4);
    expect(cast / n).toBeLessThan(0.6);
  });
  it("randomize 'look' re-rolls the body too; 'traits'/'name' keep it", () => {
    const m = { ...randomZombie(rngFromSeed(3), catalog), appearance: withBody(randomZombie(rngFromSeed(3), catalog).appearance, 'gold') };
    let changed = 0;
    for (let s = 0; s < 80; s++) {
      const look = randomizeMember(m, 'look', rngFromSeed(s), catalog, []);
      if ((look.appearance.body ?? null) !== 'gold') changed++;
      expect(randomizeMember(m, 'traits', rngFromSeed(s), catalog, []).appearance.body).toBe('gold');
      expect(randomizeMember(m, 'name', rngFromSeed(s), catalog, []).appearance.body).toBe('gold');
    }
    expect(changed).toBeGreaterThan(60);
  });
  it('withBody(null) removes the key; it never writes classic', () => {
    expect('body' in withBody({ ...defaultAppearance(), body: 'boss' }, null)).toBe(false);
    expect(withBody(defaultAppearance(), 'boss').body).toBe('boss');
  });
});

describe('demo household shows the cast immediately', () => {
  it('one body per category, members otherwise identical to the seeded household', () => {
    const o = demoOptions(catalog);
    expect(o.members.map((m) => m.appearance.body)).toEqual([...DEMO_BODIES].slice(0, o.members.length));
    const cats = new Set(DEMO_BODIES.map((id) => CAST_BODIES.find((b) => b.id === id)!.category));
    expect(cats).toEqual(new Set(['zombie', 'boss', 'turned']));
    const plain = stripBodies(randomHousehold(0x0a11fe55, catalog, 3).members);
    expect(stripBodies(o.members)).toEqual(plain);
  });
});

describe('real simulation + saves', () => {
  const opts = () => {
    const s = state(randomHousehold(77, catalog, 3).members);
    s.members[0] = { ...s.members[0], appearance: withBody(s.members[0].appearance, 'strongman') };
    s.members[1] = { ...s.members[1], appearance: withBody(s.members[1].appearance, 'streamer') };
    s.members[2] = { ...s.members[2], appearance: withBody(s.members[2].appearance, null) };
    return finalizeCaz(s, 1234);
  };

  it('createNewWorld stores the chosen bodies; classic stays absent', () => {
    const w = createNewWorld(opts());
    const bodies = w.household.memberIds.map((id) => w.agents[id].appearance.body ?? null);
    expect(bodies).toEqual(['strongman', 'streamer', null]);
  });

  it('bodies never influence the simulation: a day with and without them is identical (byte for byte, minus bodies)', () => {
    const withB = createSimulation(createNewWorld(opts()));
    const noB = createSimulation(stripBodies(createNewWorld(opts())) as WorldState);
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      withB.step();
      noB.step();
    }
    expect(canonicalJson(stripBodies(withB.serialize()))).toBe(canonicalJson(noB.serialize()));
  });

  async function roundTrip(world: WorldState) {
    const m = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silent });
    const saved = await m.save('slot1', 'cast', world, META);
    expect(saved.ok).toBe(true);
    const loaded = await m.load('slot1');
    if (!loaded.ok) throw new Error(`load failed: ${JSON.stringify(loaded)}`);
    const sim = createSimulation(loaded.world);
    return { loaded, sim };
  }

  it('an OLD save (no body anywhere) loads with no repair warnings and identical canonical JSON', async () => {
    const old = stripBodies(createSimulation(createNewWorld(opts())).serialize());
    expect(JSON.stringify(old)).not.toContain('"body"');
    const before = canonicalJson(old);
    const { loaded, sim } = await roundTrip(old);
    expect(loaded.warnings).toEqual([]);
    expect(sim.repairWarnings).toEqual([]);
    expect(canonicalJson(loaded.world)).toBe(before);
    expect(canonicalJson(sim.serialize())).toBe(before);
    // existing townies are kept as they were — no regeneration, no bodies added
    expect(Object.values(sim.serialize().agents).some((a) => a.appearance.body)).toBe(false);
  });

  it('a save with bodies round-trips (members, townies and all) with no warnings', async () => {
    const w = createSimulation(createNewWorld(opts())).serialize();
    const before = canonicalJson(w);
    expect(Object.values(w.agents).filter((a) => a.role === 'townie' && a.appearance.body).length).toBeGreaterThan(5);
    const { loaded, sim } = await roundTrip(w);
    expect(loaded.warnings).toEqual([]);
    expect(sim.repairWarnings).toEqual([]);
    expect(canonicalJson(sim.serialize())).toBe(before);
    const again = await roundTrip(sim.serialize());
    expect(canonicalJson(again.sim.serialize())).toBe(before);
  });

  it('an unknown body id repairs to classic with exactly one warning', async () => {
    const w = createSimulation(createNewWorld(opts())).serialize();
    const id = w.household.memberIds[0];
    (w.agents[id].appearance as { body?: unknown }).body = 'dragon-from-a-future-build';
    const { loaded, sim } = await roundTrip(w);
    const all = [...loaded.warnings, ...sim.repairWarnings];
    expect(all.filter((x) => /cast body/i.test(x))).toHaveLength(1);
    expect(all).toHaveLength(1);
    expect('body' in sim.serialize().agents[id].appearance).toBe(false);
  });

  it('the two premium ids renamed before release load as their new ids, with one warning each', async () => {
    const w = createSimulation(createNewWorld(opts())).serialize();
    const [a, b] = w.household.memberIds;
    (w.agents[a].appearance as { body?: unknown }).body = 'undertaker';
    (w.agents[b].appearance as { body?: unknown }).body = 'roadhog';
    const { loaded, sim } = await roundTrip(w);
    const all = [...loaded.warnings, ...sim.repairWarnings];
    expect(all.filter((x) => /renamed/.test(x))).toHaveLength(2);
    expect(sim.serialize().agents[a].appearance.body).toBe('sexton');
    expect(sim.serialize().agents[b].appearance.body).toBe('lowside');
  });
});
