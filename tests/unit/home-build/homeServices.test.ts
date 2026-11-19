import { describe, expect, it } from 'vitest';
import {
  BUILD_NAME_MAX,
  BUILD_PAYLOAD_MAX_CHARS,
  ESSENCE_EARN,
  MATERIAL_IDS,
  MAX_SAVED_BUILDS,
  STASH_CAPS,
  canRespec,
  cleanBuildName,
  deleteBuild,
  essenceForDay,
  newHomeServicesState,
  newStash,
  newWardrobe,
  saveBuild,
  setBuildPayloadValidator,
  stashAdd,
  stashTake,
  swapBuild,
} from '../../../src/shared/homeServices';

const COOL = 4; // ticks

describe('Wardrobe: saved builds', () => {
  it('saves up to the limit, then refuses the next one', () => {
    let w = newWardrobe();
    for (let i = 0; i < MAX_SAVED_BUILDS; i++) {
      const r = saveBuild(w, `Build ${i}`, { n: i });
      expect(r.ok).toBe(true);
      if (r.ok) w = r.state;
    }
    const full = saveBuild(w, 'One too many', {});
    expect(full).toMatchObject({ ok: false, reason: 'full' });
  });

  it('never reuses an id, even after a delete', () => {
    let w = newWardrobe();
    const a = saveBuild(w, 'A', {});
    if (!a.ok) throw new Error('a');
    w = a.state;
    const d = deleteBuild(w, a.record.id);
    if (!d.ok) throw new Error('d');
    const b = saveBuild(d.state, 'B', {});
    expect(b.ok && b.record.id).not.toBe(a.record.id);
  });

  it('refuses bad names and payloads that cannot be stored', () => {
    expect(cleanBuildName('  Two   spaces ')).toBe('Two spaces');
    expect(cleanBuildName('')).toBeNull();
    expect(cleanBuildName('x'.repeat(BUILD_NAME_MAX + 1))).toBeNull();
    expect(cleanBuildName(5)).toBeNull();
    expect(saveBuild(newWardrobe(), '', {})).toMatchObject({ ok: false, reason: 'name' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(saveBuild(newWardrobe(), 'C', cyclic)).toMatchObject({ ok: false, reason: 'payload' });
    expect(saveBuild(newWardrobe(), 'Big', 'x'.repeat(BUILD_PAYLOAD_MAX_CHARS + 1))).toMatchObject({ ok: false, reason: 'payload' });
    expect(saveBuild(newWardrobe(), 'Undefined', undefined)).toMatchObject({ ok: false, reason: 'payload' });
  });

  it('stores a copy: changing the original afterwards does not change the saved build', () => {
    const payload = { gear: ['a'] };
    const r = saveBuild(newWardrobe(), 'Copy', payload);
    if (!r.ok) throw new Error('save');
    payload.gear.push('b');
    expect(r.record.payload).toEqual({ gear: ['a'] });
  });

  it('swaps once, then the cooldown refuses a second swap until it is over', () => {
    let w = newWardrobe();
    const ids: string[] = [];
    for (const n of ['A', 'B']) {
      const r = saveBuild(w, n, {});
      if (!r.ok) throw new Error('save');
      w = r.state;
      ids.push(r.record.id);
    }
    const s1 = swapBuild(w, ids[0], 100, COOL, null);
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    expect(s1.state.activeId).toBe(ids[0]);
    expect(swapBuild(s1.state, ids[1], 100 + COOL - 1, COOL, null)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(swapBuild(s1.state, ids[1], 100 + COOL, COOL, null).ok).toBe(true);
  });

  it('refuses a swap during a fight or event, and a swap to the build already on', () => {
    const r = saveBuild(newWardrobe(), 'A', {});
    if (!r.ok) throw new Error('save');
    expect(swapBuild(r.state, r.record.id, 5, COOL, 'Not during a fight.')).toMatchObject({ ok: false, reason: 'blocked', message: 'Not during a fight.' });
    const on = swapBuild(r.state, r.record.id, 5, COOL, null);
    if (!on.ok) throw new Error('swap');
    expect(swapBuild(on.state, r.record.id, 500, COOL, null)).toMatchObject({ ok: false, reason: 'already' });
  });

  it('a swap to an unknown build is refused, and deleting the active build clears it', () => {
    expect(swapBuild(newWardrobe(), 'b99', 0, COOL, null)).toMatchObject({ ok: false, reason: 'unknown' });
    const r = saveBuild(newWardrobe(), 'A', {});
    if (!r.ok) throw new Error('save');
    const on = swapBuild(r.state, r.record.id, 1, COOL, null);
    if (!on.ok) throw new Error('swap');
    const d = deleteBuild(on.state, r.record.id);
    expect(d.ok && d.state.activeId).toBeNull();
  });
});

describe('Embalming table: respec gate', () => {
  it('allows one respec a day and not during a fight', () => {
    expect(canRespec(null, 3, null).ok).toBe(true);
    expect(canRespec(2, 3, null).ok).toBe(true);
    expect(canRespec(3, 3, null).ok).toBe(false);
    expect(canRespec(null, 3, 'Not during a fight.')).toEqual({ ok: false, message: 'Not during a fight.' });
  });
});

describe('Crypt vault: the stash', () => {
  it('holds the seven W-029 materials with their caps', () => {
    expect(MATERIAL_IDS).toHaveLength(7);
    expect(STASH_CAPS.ecto).toBe(20);
    expect(STASH_CAPS.scrap).toBe(100);
  });

  it('adds up to the cap and reports what it took, never more', () => {
    const r = stashAdd(newStash(), 'ecto', 25);
    expect(r.ok && r.moved).toBe(20);
    expect(r.ok && r.state.ecto).toBe(20);
    expect(stashAdd(r.ok ? r.state : newStash(), 'ecto', 1)).toMatchObject({ ok: false });
  });

  it('takes only what is there, and refuses fractions, zero and negatives', () => {
    const s = stashAdd(newStash(), 'bone', 5);
    if (!s.ok) throw new Error('add');
    expect(stashTake(s.state, 'bone', 6)).toMatchObject({ ok: false });
    const t = stashTake(s.state, 'bone', 5);
    expect(t.ok && t.state.bone).toBe(0);
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(stashAdd(newStash(), 'wood', bad).ok).toBe(false);
      expect(stashTake(s.state, 'bone', bad).ok).toBe(false);
    }
  });

  it('does not change the state it was given', () => {
    const before = newStash();
    stashAdd(before, 'cloth', 3);
    expect(before.cloth).toBe(0);
  });
});

describe('Rot Essence earning', () => {
  it('pays only while the Hearth stands and is powered', () => {
    expect(essenceForDay(false, true, 0)).toBe(0);
    expect(essenceForDay(true, false, 6)).toBe(0);
    expect(essenceForDay(true, true, 0)).toBe(ESSENCE_EARN.hearthDay);
  });

  it('adds one per set threshold in force, capped, and ignores junk counts', () => {
    expect(essenceForDay(true, true, 3)).toBe(ESSENCE_EARN.hearthDay + 3);
    expect(essenceForDay(true, true, 99)).toBe(ESSENCE_EARN.hearthDay + ESSENCE_EARN.setBonusCap);
    expect(essenceForDay(true, true, -4)).toBe(ESSENCE_EARN.hearthDay);
    expect(essenceForDay(true, true, NaN)).toBe(ESSENCE_EARN.hearthDay);
  });

  it('keeps the activity sources at zero until their systems land', () => {
    expect([ESSENCE_EARN.scavenge, ESSENCE_EARN.dig, ESSENCE_EARN.fish]).toEqual([0, 0, 0]);
  });
});

describe('the save shape', () => {
  it('starts empty and cold', () => {
    const s = newHomeServicesState();
    expect(s).toMatchObject({ version: 1, essenceDay: -1, hearth: { essence: 0, owned: [] }, wardrobe: {}, respecDay: {} });
    expect(Object.values(s.stash).every((n) => n === 0)).toBe(true);
  });
});

describe('the pre-commit validator seam for the zombie build data', () => {
  const reset = () => setBuildPayloadValidator(null);

  it('refuses to save a payload the validator rejects, and a validator that throws refuses too', () => {
    try {
      setBuildPayloadValidator((p) => (typeof p === 'object' && p !== null ? null : 'Not a build.'));
      expect(saveBuild(newWardrobe(), 'A', { ok: 1 }).ok).toBe(true);
      expect(saveBuild(newWardrobe(), 'A', 7)).toMatchObject({ ok: false, reason: 'payload', message: 'Not a build.' });
      setBuildPayloadValidator(() => {
        throw new Error('boom');
      });
      expect(saveBuild(newWardrobe(), 'A', {})).toMatchObject({ ok: false, reason: 'payload' });
    } finally {
      reset();
    }
  });

  it('refuses a swap to a stored record that no longer validates, so it never becomes active', () => {
    const r = saveBuild(newWardrobe(), 'A', { v: 1 });
    if (!r.ok) throw new Error('save');
    try {
      setBuildPayloadValidator(() => 'Too old.');
      const s = swapBuild(r.state, r.record.id, 10, 4, null);
      expect(s).toMatchObject({ ok: false, reason: 'payload', message: 'Too old.' });
      expect(r.state.activeId).toBeNull();
    } finally {
      reset();
    }
    expect(swapBuild(r.state, r.record.id, 10, 4, null).ok).toBe(true);
  });
});
