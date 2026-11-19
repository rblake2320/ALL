/** The rule tests/e2e/oldSave.mjs uses to decide "the old world is intact": additions are fine, nothing else is. */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper shared with the e2e scripts (no type declarations)
import { diffStates } from '../../e2e/lib/stateDiff.mjs';

const world = () => ({ schemaVersion: 1, tick: 564, household: { name: 'Old', funds: 2500, memberIds: ['a1', 'a2'] }, objects: { o1: { defId: 'bed', tint: null } }, flags: {}, list: [1, { x: 1 }] });

describe('diffStates', () => {
  it('identical worlds: nothing changed, nothing added', () => {
    expect(diffStates(world(), world())).toEqual({ changed: [], added: [] });
  });

  it('keys the newer build added are listed as added, at any depth, and are not changes', () => {
    const next = { ...world(), jobs: { list: [] } } as Record<string, unknown>;
    (next.household as Record<string, unknown>) = { ...world().household, autoPurchases: 'unlimited' };
    expect(diffStates(world(), next)).toEqual({ changed: [], added: ['state.household.autoPurchases', 'state.jobs'] });
  });

  it('a changed value, a dropped key, a type change, null vs object and array length are each reported by path', () => {
    const cases: Array<[(w: ReturnType<typeof world>) => void, RegExp]> = [
      [(w) => (w.household.funds = 2499), /^state\.household\.funds: 2500 → 2499$/],
      [(w) => delete (w.household as { name?: string }).name, /^state\.household\.name: dropped \(was "Old"\)$/],
      [(w) => ((w as { tick: unknown }).tick = '564'), /^state\.tick: 564 → "564"$/],
      [(w) => ((w.objects.o1 as { tint: unknown }).tint = {}), /^state\.objects\.o1\.tint: null → \{\}$/],
      [(w) => ((w as { flags: unknown }).flags = null), /^state\.flags: \{\} → null$/],
      [(w) => ((w as { flags: unknown }).flags = []), /^state\.flags: \{\} → \[\]$/],
      [(w) => w.household.memberIds.pop(), /^state\.household\.memberIds\.length: 2 → 1$/],
      [(w) => w.household.memberIds.push('a3'), /^state\.household\.memberIds\.length: 2 → 3$/],
      [(w) => ((w.list[1] as { x: number }).x = 2), /^state\.list\[1\]\.x: 1 → 2$/],
      [(w) => delete (w.objects as { o1?: unknown }).o1, /^state\.objects\.o1: dropped/],
    ];
    for (const [mutate, re] of cases) {
      const next = world();
      mutate(next);
      const d = diffStates(world(), next);
      expect(d.changed.length, String(re)).toBe(1);
      expect(d.changed[0]).toMatch(re);
      expect(d.added).toEqual([]);
    }
  });

  it('schemaVersion is reported like any other change (the caller allows exactly that one path)', () => {
    const d = diffStates(world(), { ...world(), schemaVersion: 2 });
    expect(d.changed).toEqual(['state.schemaVersion: 1 → 2']);
  });

  it('long values are cut, undefined does not throw', () => {
    const a = { big: 'x'.repeat(500), u: undefined as unknown };
    const d = diffStates(a, { big: 'y'.repeat(500), u: 1 });
    expect(d.changed.length).toBe(2);
    expect(d.changed.every((c: string) => c.length < 220)).toBe(true);
  });
});
