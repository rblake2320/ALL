/** Shipped quest content + validator (adversarial defs) + daily picker. */
import { describe, expect, it } from 'vitest';
import type { QuestDef } from '../../../src/sim/contracts';
import { loadContent } from '../../../src/sim/index';
import { ALL_QUESTS, DAILY_TASK_POOL, NEIGHBOURHOOD_QUESTS, STORY_QUESTS } from '../../../src/sim/content/quests';
import { DAILY_TASKS_PER_DAY, pickDailyTasks, validateDailyPool, validateQuests } from '../../../src/sim/systems/quests';

const reg = loadContent();

describe('quest content', () => {
  it('validates clean against the shipped registry', () => {
    expect(validateQuests(ALL_QUESTS, reg)).toEqual([]);
    expect(validateDailyPool(DAILY_TASK_POOL, reg)).toEqual([]);
  });

  it('has 8–10 story quests, 20 repeatable neighbourhood quests, a 40-task daily pool', () => {
    expect(STORY_QUESTS.length).toBeGreaterThanOrEqual(8);
    expect(STORY_QUESTS.length).toBeLessThanOrEqual(10);
    expect(NEIGHBOURHOOD_QUESTS).toHaveLength(20);
    for (const q of NEIGHBOURHOOD_QUESTS) expect(q.repeat, q.id).toBeDefined();
    expect(DAILY_TASK_POOL).toHaveLength(40);
    expect(new Set(DAILY_TASK_POOL.map((t) => t.id)).size).toBe(40);
  });

  it('the story chain teaches the core loop (meal, repair, job, friend, decorate, embalming, party)', () => {
    const kinds = STORY_QUESTS.flatMap((q) => q.steps.map((s) => JSON.stringify(s.objective)));
    for (const needle of ['mealsCooked', 'repairs', '"career"', '"friends"', '"decor"', '"embalm"', 'partiesThrown', 'billsOnTime', '"skill"']) {
      expect(kinds.some((k) => k.includes(needle)), needle).toBe(true);
    }
    // the first quest has no prerequisites; every other story quest is reachable from it
    const roots = STORY_QUESTS.filter((q) => !q.requires?.length);
    expect(roots.map((q) => q.id)).toEqual(['story_firstMeal']);
  });

  it('rewards are Bones (+ cosmetics on one-off quests) only — never funds or needs', () => {
    for (const q of ALL_QUESTS) {
      expect(Object.keys(q.reward).every((k) => k === 'bones' || k === 'entitlements'), q.id).toBe(true);
      expect(q.reward.bones).toBeGreaterThan(0);
      if (q.repeat) expect(q.reward.entitlements ?? []).toEqual([]);
    }
  });
});

describe('quest validator (adversarial)', () => {
  const base = (over: Partial<QuestDef>): QuestDef => ({
    id: 'x',
    category: 'story',
    title: 'X',
    description: 'x',
    icon: 'star',
    steps: [{ id: 's', label: 'l', objective: { kind: 'stat', key: 'repairs', count: 1 } }],
    reward: { bones: 10 },
    ...over,
  });

  it('flags unknown ids, tags, stats, recipes, icons, bad counts, money rewards, cycles, duplicates', () => {
    const bad: QuestDef[] = [
      base({ id: 'a', steps: [{ id: 's', label: 'l', objective: { kind: 'interaction', ids: ['home_nope'], count: 1 } }] }),
      base({ id: 'b', steps: [{ id: 's', label: 'l', objective: { kind: 'interaction', tags: ['nonexistentTag'], count: 0 } }] }),
      base({ id: 'c', steps: [{ id: 's', label: 'l', objective: { kind: 'stat', key: 'goldMined', count: 1 } }] }),
      base({ id: 'd', steps: [{ id: 's', label: 'l', objective: { kind: 'interaction', tags: ['cook'], match: { recipe: 'unicornSteak' }, count: 1 } }] }),
      base({ id: 'e', icon: 'unicorn' as never }),
      base({ id: 'f', reward: { bones: 10, funds: 500 } as never }),
      base({ id: 'g', reward: { bones: 99999 } }),
      base({ id: 'h', reward: { bones: 5, entitlements: ['gg:100'] } }),
      base({ id: 'i', requires: ['j'] }),
      base({ id: 'j', requires: ['i'] }),
      base({ id: 'k', requires: ['missing'] }),
      base({ id: 'k' }),
      base({ id: 'l', repeat: { cooldownDays: 1 } }),
      base({ id: 'm', category: 'neighbourhood', repeat: { cooldownDays: 1 }, reward: { bones: 5, entitlements: ['cosmetic:hat'] } }),
      base({ id: 'n', steps: [] }),
      base({ id: 'o', steps: [{ id: 's', label: 'l', objective: { kind: 'own', count: 1 } }] }),
      base({ id: 'p', steps: [{ id: 's', label: 'l', objective: { kind: 'teleport' } as never }] }),
      base({ id: 'bad id!' }),
    ];
    const out = validateQuests(bad, reg).join('\n');
    for (const needle of [
      "unknown interaction 'home_nope'",
      "no interaction has tag 'nonexistentTag'",
      'count must be a positive integer',
      "unknown stat 'goldMined'",
      "unknown recipe 'unicornSteak'",
      "unknown icon 'unicorn'",
      "reward 'funds' is not allowed",
      'bones must be 1..500',
      "entitlement 'gg:100'",
      'prerequisite cycle',
      "requires unknown quest 'missing'",
      "duplicate quest id 'k'",
      'story quests never repeat',
      'repeatable quests must not grant entitlements',
      'quest n: no steps',
      'own objective needs tags or defIds',
      "unknown objective kind 'teleport'",
      'bad quest id',
    ]) {
      expect(out, needle).toContain(needle);
    }
  });

  it('daily pool rejects absolute kinds that an old save would satisfy instantly', () => {
    const out = validateDailyPool(
      [
        { id: 'x1', title: 'Be rich', objective: { kind: 'funds', atLeast: 100 }, bones: 5 },
        { id: 'x2', title: 'Old decor', objective: { kind: 'own', tags: ['decor'], count: 1, fresh: false }, bones: 5 },
        { id: 'x2', title: '', objective: { kind: 'skill', level: 1 }, bones: 0 },
      ],
      reg,
    ).join('\n');
    expect(out).toContain("kind 'funds' is not allowed");
    expect(out).toContain('own objectives must be fresh');
    expect(out).toContain("duplicate daily task 'x2'");
    expect(out).toContain('bones must be 1..50');
  });
});

describe('daily picker', () => {
  it('is deterministic, distinct, order-independent of the pool array, and varies by day', () => {
    const a = pickDailyTasks(DAILY_TASK_POOL, 'p1:2026-11-05');
    expect(a).toHaveLength(DAILY_TASKS_PER_DAY);
    expect(new Set(a.map((t) => t.id)).size).toBe(3);
    expect(pickDailyTasks([...DAILY_TASK_POOL].reverse(), 'p1:2026-11-05').map((t) => t.id)).toEqual(a.map((t) => t.id));
    const days = new Set<string>();
    for (let d = 1; d <= 30; d++) days.add(pickDailyTasks(DAILY_TASK_POOL, `p1:2026-11-${String(d).padStart(2, '0')}`).map((t) => t.id).join(','));
    expect(days.size).toBeGreaterThan(25);
    expect(pickDailyTasks([], 'k')).toEqual([]);
    expect(pickDailyTasks(DAILY_TASK_POOL.slice(0, 2), 'k', 5)).toHaveLength(2);
  });
});
