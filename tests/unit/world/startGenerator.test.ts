import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../src/sim';
import { canonicalStartPick } from '../../../src/shared/town';
import { generateStart } from '../../../src/sim/world/startGenerator';
import { auditBuiltStarts, extractStartGeometry } from '../../../src/sim/world/startGeometry';
import { createStartTemplate } from '../../../src/sim/world/startTemplates';

const registry = loadContent();
describe('S7 admission and built-world AC6', () => {
  it('50 seeds: admitted real lots, fair funds, bounded gate walks, diverse built geometry, exact saved-pick replay', () => {
    const results = Array.from({ length: 50 }, (_, i) => ({ seed: i + 1, generated: generateStart(i + 1, 'derelict', registry) }));
    const audit = auditBuiltStarts(results.map(r => ({ seed: r.seed, layout: r.generated.layout })));
    console.log('AC6 generated-start gate', JSON.stringify({ diversity: audit.diversity, retries: results.map(r => ({ seed: r.seed, attempts: r.generated.attempts.length, fallback: r.generated.fallback, errors: r.generated.attempts.filter(a => a.errors.length).map(a => a.errors) })) }));
    expect(audit).toMatchObject({ pass: true, coverageErrors: [], extractionErrors: [] });
    for (const { seed, generated: g } of results) {
      expect(g.validation.ok).toBe(true);
      expect(g.validation.startingFunds).toBe(2500);
      expect(g.validation.graveyardWalkTiles).toBeLessThanOrEqual(140);
      expect(g.validation.dayOne).toHaveLength(3);
      expect(extractStartGeometry(generateStart(seed, 'derelict', registry).layout)).toEqual(extractStartGeometry(g.layout));
      const loaded = generateStart(seed, 'derelict', registry, JSON.parse(JSON.stringify(g.start)));
      expect(loaded.home).toEqual(g.home);
      expect(loaded.map).toEqual(g.map);
      expect(loaded.layout).toEqual(g.layout);
    }
  }, 30000);
  for (const base of ['derelict', 'starter', 'empty'] as const) it(`${base}: explicit canonical override retains shipped lot bytes`, () => {
    const generated = generateStart(1, base, registry, canonicalStartPick(base));
    expect(generated.home).toEqual(createStartTemplate(base));
    expect(generated.fallback).toBe(false);
  });
  for (const base of ['starter', 'empty'] as const) it(`${base}: seeded sandbox starts retain their type, funds base and replay`, () => {
    for (let seed = 1; seed <= 15; seed++) {
      const g = generateStart(seed, base, registry);
      expect(g.start.templateId).toBe(base);
      expect(g.validation.ok).toBe(true);
      expect(g.validation.startingFunds).toBe(base === 'starter' ? 6500 : 22000);
      expect(generateStart(seed, base, registry, JSON.parse(JSON.stringify(g.start))).layout).toEqual(g.layout);
    }
  });
  it('unknown version, wrong template and nonfinite seed are refused', () => {
    expect(() => generateStart(NaN, 'derelict', registry)).toThrow();
    expect(() => generateStart(1, 'derelict', registry, { ...canonicalStartPick('derelict'), genVersion: 2 })).toThrow();
    expect(() => generateStart(1, 'derelict', registry, canonicalStartPick('empty'))).toThrow();
  });
});
