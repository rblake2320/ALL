/**
 * AC-1 — home-only determinism (docs/DESIGN_WORLD_LEVELS.md §1.15): the region-aware engine steps byte-identically
 * to the pre-world engine. Template `starter` here (`derelict` in homeOnly.determinism.test.ts) (one
 * file per template so vitest runs them in parallel). See homeOnly.shared.ts for the three run modes.
 */
import { describe, expect, it } from 'vitest';
import { AC1_SEEDS, evidence, expectTownStreamedOnly, expectLegacyTown, expectSameRun, GOLDEN, goldenRun, runLegacyNoTown, runMigratedMidRun, runNewWorld } from './homeOnly.shared';

const TPL = 'starter' as const;

describe(`AC-1 home-only determinism vs the accepted base 00794ea (3cc1f39 + W-153) (${TPL}, ${AC1_SEEDS.length} seeds × ${GOLDEN.days} days)`, () => {
  it('the goldens come from the independently recorded accepted base (3cc1f39 + W-153)', () => {
    expect(GOLDEN.engine).toBe('00794ead432a550e6bef79d96a8553097fdd3064');
    expect(GOLDEN.schemaVersion).toBe(2);
  });

  for (const seed of AC1_SEEDS) {
    it(`seed ${seed}: frozen new world (schema v3), legacy world without town, and a v1 save migrated mid-run all match`, async () => {
      const a = await runNewWorld(TPL, seed);
      expectSameRun(a.run, goldenRun(`real:${TPL}:${seed}`));
      // Expansion is frozen for this home-only comparison; expanded streaming has its own suites.
      expectTownStreamedOnly(a.townBefore, a.townAfter);
      const b = await runLegacyNoTown(TPL, seed);
      expectSameRun(b, goldenRun(`real:${TPL}:${seed}`));
      const c = await runMigratedMidRun(TPL, seed);
      expect(c.warnings).toEqual([]);
      expect(c.repairWarnings).toEqual([]);
      expectLegacyTown(c.migratedTown, seed, c.tick);
      expectSameRun(c.run, goldenRun(`real:${TPL}:${seed}:reload`));
      console.log(`[AC-1] ${evidence(a.run)} | legacy ok | migrated ${evidence(c.run)}`);
    }, 300_000);
  }
});
