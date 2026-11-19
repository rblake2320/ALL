import { describe, expect, it } from 'vitest';
import { validateWorld } from '../../../src/persistence/validation';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { makeWorld, prng } from './fixtures';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function mutate(fn: (w: Json) => void): Json {
  const w = JSON.parse(JSON.stringify(makeWorld())) as Json;
  fn(w);
  return w;
}

describe('validateWorld — valid input', () => {
  it('accepts the fixture world unchanged, with zero issues', () => {
    const r = validateWorld(JSON.parse(JSON.stringify(makeWorld())));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(canonicalJson(r.world)).toBe(canonicalJson(makeWorld()));
  });

  it('keeps unknown fields (forward-compatible data is not destroyed)', () => {
    const r = validateWorld(mutate((w) => ((w.futureFeature = { x: 1 }), (w.agents.a1.newField = 'kept'))));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.world as unknown as Json).futureFeature).toEqual({ x: 1 });
      expect((r.world.agents.a1 as unknown as Json).newField).toBe('kept');
    }
  });
});

describe('validateWorld — fatal structure', () => {
  const fatal: [string, (w: Json) => void, RegExp][] = [
    ['non-object payload', () => undefined, /not an object/],
    ['missing agents', (w) => delete w.agents, /agents/],
    ['agents is an array', (w) => (w.agents = []), /agents/],
    ['missing lot', (w) => delete w.lot, /lot/],
    ['lot width string', (w) => (w.lot.width = '12'), /lot\.width/],
    ['lot width huge', (w) => (w.lot.width = 100000), /lot\.width/],
    ['lot width fractional', (w) => (w.lot.width = 12.5), /lot\.width/],
    ['missing household', (w) => delete w.household, /household/],
    ['negative tick', (w) => (w.tick = -5), /tick/],
    ['schemaVersion zero', (w) => (w.schemaVersion = 0), /schemaVersion/],
    ['objects null', (w) => (w.objects = null), /objects/],
  ];
  for (const [name, fn, re] of fatal) {
    it(`rejects ${name}`, () => {
      const input = name === 'non-object payload' ? [1, 2] : mutate(fn);
      const r = validateWorld(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toMatch(re);
    });
  }

  it('never throws on random garbage (fuzz)', () => {
    const rnd = prng(2024);
    const pool: unknown[] = [null, true, 0, -1, 1e308, 'x', '', [], {}, [null], { a: 1 }, NaN, 'h:1:2'];
    const base = JSON.parse(JSON.stringify(makeWorld())) as Json;
    const paths: string[][] = [];
    const walk = (v: unknown, p: string[]) => {
      if (p.length > 0) paths.push(p);
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Json)) walk(x, [...p, k]);
    };
    walk(base, []);
    for (let i = 0; i < 3000; i++) {
      const w = JSON.parse(JSON.stringify(base)) as Json;
      const n = 1 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) {
        const path = paths[Math.floor(rnd() * paths.length)];
        let target: Json = w;
        for (let k = 0; k < path.length - 1 && target && typeof target === 'object'; k++) target = target[path[k]];
        if (target && typeof target === 'object') {
          const roll = rnd();
          if (roll < 0.3) delete target[path[path.length - 1]];
          else target[path[path.length - 1]] = pool[Math.floor(rnd() * pool.length)];
        }
      }
      const r = validateWorld(w);
      if (r.ok) {
        // Whatever survives must be serializable and stable under re-validation (idempotent repair).
        const once = canonicalJson(r.world);
        const again = validateWorld(JSON.parse(once));
        expect(again.ok).toBe(true);
        if (again.ok) expect(canonicalJson(again.world)).toBe(once);
      }
    }
  }, 180_000);
});

describe('validateWorld — repairs', () => {
  it('clamps ranges and rounds integers with warnings', () => {
    const r = validateWorld(
      mutate((w) => {
        w.agents.a1.needs.hunger = 150;
        w.agents.a1.needs.energy = -3;
        w.agents.a1.vitality = 5;
        w.household.funds = -20.7;
        w.objects.o8.condition.dirt = 9;
        w.agents.a1.skills.cooking.level = 99;
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.world.agents.a1;
    expect(a.needs.hunger).toBe(100);
    expect(a.needs.energy).toBe(0);
    expect(a.vitality).toBe(20);
    expect(a.needs.preservation).toBe(20); // preservation <= vitality
    expect(r.world.household.funds).toBe(0);
    expect(r.world.objects.o8.condition.dirt).toBe(1);
    expect(a.skills.cooking.level).toBe(10);
    expect(r.warnings.length).toBeGreaterThanOrEqual(6);
    expect(r.warnings.join('\n')).toMatch(/agents\.a1\.needs\.hunger/);
  });

  it('defaults unknown enum values and malformed colors', () => {
    const r = validateWorld(
      mutate((w) => {
        w.agents.a1.anim = 'moonwalk';
        w.agents.a1.appearance.hairStyle = 'mullet';
        w.agents.a1.appearance.hairColor = 'red';
        w.agents.a1.limbs.armL = 'tentacle';
        w.notifications[0].kind = 'spam';
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.agents.a1.anim).toBe('idle');
    expect(r.world.agents.a1.appearance.hairStyle).toBe('messy');
    expect(r.world.agents.a1.appearance.hairColor).toBe('#3b2f2f');
    expect(r.world.agents.a1.limbs.armL).toBe('ok');
    expect(r.world.notifications[0].kind).toBe('info');
  });

  it('drops broken collection entries but keeps the rest', () => {
    const r = validateWorld(
      mutate((w) => {
        w.objects.o10.placement = { kind: 'teleported' };
        w.agents.a1.queue.push({ uid: 'nope' });
        w.agents.a1.moodlets.push(42);
        w.lot.walls['diagonal:1:1'] = w.lot.walls['h:2:2'];
        w.choices[0].options = [];
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.objects.o10).toBeUndefined();
    expect(r.world.objects.o8).toBeDefined();
    expect(r.world.agents.a1.queue).toHaveLength(1);
    expect(r.world.agents.a1.moodlets).toHaveLength(1);
    expect(r.world.lot.walls['diagonal:1:1']).toBeUndefined();
    expect(r.world.choices).toHaveLength(0);
    expect(r.issues.filter((i) => i.kind === 'dropped').length).toBeGreaterThanOrEqual(5);
  });

  it('nulls out malformed nullable sub-structures (career, active, path)', () => {
    const r = validateWorld(
      mutate((w) => {
        w.agents.a1.career = { trackId: 5 };
        w.agents.a1.active.phase = 'teleport';
        w.agents.a1.path = [{ x: 1, z: 1 }, 'bad'];
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.agents.a1.career).toBeNull();
    expect(r.world.agents.a1.active).toBeNull();
    expect(r.world.agents.a1.path).toBeNull();
  });

  it('repairs identity/integrity: record keys, relationship keys, members, nextId', () => {
    const r = validateWorld(
      mutate((w) => {
        w.agents.a2.id = 'zzz';
        w.objects.o7.id = 'o999';
        w.relationships['a2|a1'] = { ...w.relationships['a1|a2'], a: 'a2', b: 'a1' };
        delete w.relationships['a1|a2'];
        w.relationships['a3|a3'] = { ...w.relationships['a2|a1'], a: 'a3', b: 'a3' };
        w.household.memberIds = ['a1', 'a2', 'ghost'];
        w.agents.a2.role = 'service';
        w.nextId = 3;
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.agents.a2.id).toBe('a2');
    expect(r.world.objects.o7.id).toBe('o7');
    expect(Object.keys(r.world.relationships)).toEqual(['a1|a2']);
    expect(r.world.relationships['a1|a2'].a).toBe('a1');
    expect(r.world.household.memberIds).toEqual(['a1', 'a2']);
    expect(r.world.agents.a2.role).toBe('household');
    expect(r.world.nextId).toBe(51); // > notification id 50 > uids 40/41 > o10
  });

  it('resizes floors and clamps the buildable rect to the lot', () => {
    const r = validateWorld(
      mutate((w) => {
        w.lot.floors = w.lot.floors.slice(0, 10);
        w.lot.buildable = { x0: 20, z0: -4, x1: 3, z1: 50 };
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.lot.floors).toHaveLength(120);
    expect(r.world.lot.buildable).toEqual({ x0: 3, x1: 12, z0: 0, z1: 10 });
  });

  it('re-seeds a degenerate or malformed RNG state from the world seed', () => {
    for (const rng of [{ a: 0, b: 0, c: 0, d: 0 }, { a: -1, b: 2, c: 3, d: 4 }, 'xyz', { a: 1.5, b: 0, c: 0, d: 0 }]) {
      const r = validateWorld(mutate((w) => (w.rng = rng)));
      expect(r.ok).toBe(true);
      if (r.ok) {
        const s = r.world.rng;
        expect([s.a, s.b, s.c, s.d].every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff)).toBe(true);
        expect(s.a | s.b | s.c | s.d).not.toBe(0);
        expect(r.warnings.join(' ')).toMatch(/RNG re-seeded/);
      }
    }
  });

  it('trims oversized logs keeping the newest entries', () => {
    const r = validateWorld(
      mutate((w) => {
        w.notifications = Array.from({ length: 300 }, (_, i) => ({ ...w.notifications[0], id: 1000 + i }));
        w.household.txLog = Array.from({ length: 1000 }, (_, i) => `tx${i}`);
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.notifications).toHaveLength(120);
    expect(r.world.notifications[119].id).toBe(1299);
    expect(r.world.household.txLog).toHaveLength(256);
    expect(r.world.household.txLog[255]).toBe('tx999');
    expect(r.world.nextId).toBe(1300);
  });

  it('caps the warning list so a hugely broken file cannot flood the UI', () => {
    const r = validateWorld(
      mutate((w) => {
        for (let i = 0; i < 400; i++) w.objects[`o${200 + i}`] = { id: `o${200 + i}`, defId: 'x', placement: { kind: 'floor', x: 1, z: 1, rot: 9 } };
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.length).toBeLessThanOrEqual(26);
      expect(r.warnings[r.warnings.length - 1]).toMatch(/more repair/);
    }
  });
});
