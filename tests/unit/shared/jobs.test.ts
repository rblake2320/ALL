/**
 * W-124 (D-071) job categories are honest: a category is shown as available ONLY when at least one of its routes is
 * an implemented interaction (registry entry, visible, free, hosted by an object def or agent-targeted); pending
 * content ("yard work", cooking that would buy groceries) is "coming later" and refused by the sim.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../src/sim/index';
import {
  JOB_CATEGORIES,
  implementedJobInteractions,
  inWindow,
  jobCategoryStatuses,
  jobRoutes,
  modeLabel,
  parseMode,
  parsePriority,
  parseScope,
  windowKey,
} from '../../../src/shared/jobs';
import { ACTIVITY_CATEGORIES } from '../../../src/shared/questAction';

const content = loadContent();

describe('category honesty', () => {
  it('every VISIBLE (available) category has at least one implemented interaction route', () => {
    const statuses = jobCategoryStatuses(content);
    const visible = statuses.filter((s) => s.available);
    expect(visible.length).toBeGreaterThan(0);
    for (const s of visible) {
      const impl = implementedJobInteractions(content, s.id);
      expect(impl.length, `${s.id} is offered but has no implemented route`).toBeGreaterThan(0);
      for (const iid of impl) {
        const d = content.interactions[iid];
        expect(d, iid).toBeDefined();
        expect(d.hidden ?? false, iid).toBe(false);
        expect(typeof d.cost === 'number' ? d.cost : 0, `${iid} costs money`).toBe(0);
      }
    }
  });

  it('available now vs coming later (the shipped table)', () => {
    const s = jobCategoryStatuses(content);
    expect(s.filter((c) => c.available).map((c) => c.id)).toEqual(['clean', 'repairs', 'play', 'hobbies', 'study', 'exercise', 'social']);
    const later = s.filter((c) => !c.available);
    expect(later.map((c) => c.id)).toEqual(['yard', 'cooking']);
    for (const c of later) expect(c.reason, c.id).toBeTruthy();
  });

  it('the rule is computed, not hard-coded: a category whose interactions vanish from the content is no longer offered', () => {
    const stripped = { interactions: { ...content.interactions }, objects: content.objects };
    for (const iid of implementedJobInteractions(content, 'play')) delete (stripped.interactions as Record<string, unknown>)[iid];
    const s = jobCategoryStatuses(stripped).find((c) => c.id === 'play')!;
    expect(s.available).toBe(false);
    expect(s.interactions).toEqual([]);
    // interactions nobody can host (no object def offers them) do not count either
    const orphan = { interactions: content.interactions, objects: {} };
    expect(jobCategoryStatuses(orphan).find((c) => c.id === 'clean')!.available).toBe(false);
    // social targets agents, so it needs no object
    expect(jobCategoryStatuses(orphan).find((c) => c.id === 'social')!.available).toBe(true);
  });

  it('every category routes through the W-123 ACTIVITY_CATEGORIES table', () => {
    for (const c of JOB_CATEGORIES) {
      expect(Object.prototype.hasOwnProperty.call(ACTIVITY_CATEGORIES, c.id), c.id).toBe(true);
      expect(jobRoutes(c.id).length, c.id).toBeGreaterThan(0);
    }
    expect(jobRoutes('__proto__')).toEqual([]);
  });
});

describe('spec parsing (commands and saves)', () => {
  it('scope / mode / priority accept exactly the documented shapes', () => {
    expect(parseScope({ kind: 'lot' })).toEqual({ kind: 'lot' });
    expect(parseScope({ kind: 'room', x: 3, z: 4, junk: 1 })).toEqual({ kind: 'room', x: 3, z: 4 });
    expect(parseScope({ kind: 'object', id: 'o12' })).toEqual({ kind: 'object', id: 'o12' });
    for (const bad of [null, 1, 'lot', [], {}, { kind: 'room', x: -1, z: 0 }, { kind: 'room', x: 1.5, z: 0 }, { kind: 'room', x: 99, z: 0 }, { kind: 'object', id: 'a1' }, { kind: 'object', id: 'o1;drop' }, { kind: 'world', x: 1, z: 1 }])
      expect(parseScope(bad, 40, 40), JSON.stringify(bad)).toBeNull();
    expect(parseMode({ kind: 'recurring', from: 22, to: 2 })).toEqual({ kind: 'recurring', from: 22, to: 2 });
    for (const bad of [null, { kind: 'recurring', from: 5, to: 5 }, { kind: 'recurring', from: 24, to: 2 }, { kind: 'recurring', from: '1', to: 2 }, { kind: 'forever' }]) expect(parseMode(bad), JSON.stringify(bad)).toBeNull();
    expect(parsePriority(undefined)).toBe('normal');
    expect(parsePriority('high')).toBe('high');
    expect(parsePriority('urgent')).toBeNull();
  });

  it('daily windows: inside / outside, wrapping past midnight, and the window key', () => {
    expect(inWindow(18, 18, 21)).toBe(true);
    expect(inWindow(21, 18, 21)).toBe(false);
    expect(inWindow(23, 22, 2)).toBe(true);
    expect(inWindow(1, 22, 2)).toBe(true);
    expect(inWindow(2, 22, 2)).toBe(false);
    expect(windowKey(5, 23, 22, 2)).toBe(5);
    expect(windowKey(6, 1, 22, 2)).toBe(5);
    expect(windowKey(6, 19, 18, 21)).toBe(6);
    expect(modeLabel({ kind: 'recurring', from: 18, to: 21 })).toBe('Daily 6 PM–9 PM');
  });
});
