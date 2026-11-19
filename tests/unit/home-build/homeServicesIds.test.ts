/**
 * Saved-build ids are canonical, bounded and never collide (PR #105 review P2): the schema drops anything but `b` + a whole
 * number 1..999999999, healing allocates a finite, unique, schema-valid next id and survives exhaustion, and save, reload and
 * healing are idempotent. Astra's probe (zsm-team/astra/pr105-schema-probe-9297c13.cjs) is the b1e309 case.
 */
import { describe, expect, it } from 'vitest';
import { VCtx } from '../../../src/persistence/validation/core';
import { homeServicesSchema } from '../../../src/persistence/validation/homeServicesSchema';
import { BUILD_ID_RE, MAX_BUILD_ID, isBuildId, newHomeServicesState, newWardrobe, saveBuild, deleteBuild, type HomeServicesState, type WardrobeState } from '../../../src/shared/homeServices';
import { healHomeServicesState } from '../../../src/sim/systems/homeServices/state';
import type { WorldState } from '../../../src/sim/types';

const slot = (id: string) => ({ id, name: 'saved', payload: {} });
function stateWith(w: Partial<WardrobeState>): HomeServicesState {
  const hs = newHomeServicesState();
  return { ...hs, wardrobe: { a: { ...newWardrobe(), ...w } } };
}
function load(hs: HomeServicesState): { hs: HomeServicesState; issues: string[] } {
  const ctx = new VCtx();
  const checked = homeServicesSchema(JSON.parse(JSON.stringify(hs)), ctx);
  const world = { household: { memberIds: ['a'] }, homeServices: checked } as unknown as WorldState;
  healHomeServicesState(world);
  return { hs: world.homeServices!, issues: ctx.issues.map((i) => `${i.path}: ${i.message}`) };
}
const w = (r: { hs: HomeServicesState }): WardrobeState => r.hs.wardrobe.a;

describe('the id domain', () => {
  it('is b + a canonical whole number up to 999999999', () => {
    for (const ok of ['b1', 'b9', 'b10', 'b123456789', 'b999999999']) expect(isBuildId(ok), ok).toBe(true);
    for (const bad of ['b0', 'b01', 'B1', 'b', 'b-1', 'b+1', 'b1.5', 'b1e3', 'b1e309', 'b1000000000', 'b99999999999', 'bInfinity', 'bNaN', 'b 1', ' b1', 'b1 ', 'b١', '', 'b1\n', 5, null, undefined, {}]) expect(isBuildId(bad), String(bad)).toBe(false);
    expect(BUILD_ID_RE.test('b999999999')).toBe(true);
    expect('b999999999'.length).toBeLessThanOrEqual(12);
  });
});

describe('the schema and healing', () => {
  it('b1e309 (Astra probe): the record is dropped with a note, nextId stays finite, and new ids are unique and valid', () => {
    const r = load(stateWith({ slots: [slot('b1e309')], nextId: 1 }));
    expect(r.issues.some((i) => /canonical/.test(i))).toBe(true);
    expect(w(r).slots).toEqual([]);
    expect(Number.isFinite(w(r).nextId)).toBe(true);
    let cur = w(r);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const s = saveBuild(cur, `n${i}`, {});
      if (!s.ok) throw new Error(s.message);
      expect(isBuildId(s.record.id), s.record.id).toBe(true);
      expect(seen.has(s.record.id), s.record.id).toBe(false);
      seen.add(s.record.id);
      cur = s.state;
    }
    expect(JSON.stringify(cur)).not.toMatch(/Infinity|NaN/);
    expect(Number.isInteger(cur.nextId) && cur.nextId <= MAX_BUILD_ID + 1).toBe(true);
  });

  it('every malformed id is dropped, valid neighbours are kept, and an activeId that pointed at a dropped id is cleared', () => {
    const r = load(stateWith({ slots: [slot('b2'), slot('b99999999999'), slot('b01'), slot('b7')], activeId: 'b99999999999', nextId: 1 }));
    expect(w(r).slots.map((s) => s.id)).toEqual(['b2', 'b7']);
    expect(w(r).activeId).toBeNull();
    expect(w(r).nextId).toBe(8);
  });

  it('duplicate ids keep one record; the highest valid id sets the next id above it', () => {
    const r = load(stateWith({ slots: [slot('b4'), slot('b4'), slot('b9')], activeId: 'b9', nextId: 2 }));
    expect(w(r).slots.map((s) => s.id)).toEqual(['b4', 'b9']);
    expect(w(r).activeId).toBe('b9');
    expect(w(r).nextId).toBe(10);
  });

  it('the highest possible id: the next id is 1000000000, saving is refused (exhaustion), and the block still validates and reloads', () => {
    const r = load(stateWith({ slots: [slot('b999999999')], nextId: 1 }));
    expect(w(r).nextId).toBe(MAX_BUILD_ID + 1);
    const s = saveBuild(w(r), 'x', {});
    expect(s).toMatchObject({ ok: false, reason: 'full' });
    expect(s.ok ? '' : s.message).toMatch(/every build number/);
    const again = load(r.hs);
    expect(w(again).slots.map((x) => x.id)).toEqual(['b999999999']);
    expect(again.issues).toEqual([]);
    // deleting a build never frees a number: ids are not reused, so the Wardrobe stays exhausted
    const d = deleteBuild(w(r), 'b999999999');
    expect(d.ok && saveBuild(d.state, 'y', {})).toMatchObject({ ok: false });
  });

  it('a hostile nextId (NaN, negative, fractional, huge, text) is repaired to a finite valid number above every id', () => {
    for (const bad of [Number.NaN, -5, 0, 2.5, 1e12, 'x', null]) {
      const r = load(stateWith({ slots: [slot('b3')], nextId: bad as never }));
      const n = w(r).nextId;
      expect(Number.isInteger(n) && n >= 4 && n <= MAX_BUILD_ID + 1, String(bad)).toBe(true);
    }
  });

  it('50 save and delete cycles after a load: ids strictly increase, never repeat, all valid; healing and reload are idempotent', () => {
    let cur = w(load(stateWith({ slots: [slot('b5')], nextId: 1 })));
    const all: string[] = [];
    for (let i = 0; i < 50; i++) {
      const s = saveBuild(cur, `n${i}`, { i });
      if (!s.ok) throw new Error(s.message);
      all.push(s.record.id);
      const d = deleteBuild(s.state, s.record.id);
      if (!d.ok) throw new Error(d.message);
      cur = d.state;
    }
    expect(new Set(all).size).toBe(50);
    expect(all.every(isBuildId)).toBe(true);
    const nums = all.map((x) => Number(x.slice(1)));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(nums[0]).toBe(6);
    const hs = { ...newHomeServicesState(), wardrobe: { a: cur } };
    const once = load(hs).hs;
    const twice = load(once).hs;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(JSON.stringify(load(JSON.parse(JSON.stringify(twice))).hs)).toBe(JSON.stringify(once));
  });
});
