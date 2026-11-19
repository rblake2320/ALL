/** An accepted pet feature must remain inside the home-only equivalence comparison. */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNewWorld } from '../../../src/sim';
import { sha256HexSync } from '../../../src/persistence/sha256';
import { ac1Options, ac1Projection, ac1SaveHash } from './ac1Harness';

it('binds the accepted reference to its recorded source and unchanged collector bytes', () => {
  const fixture = readFileSync(new URL('./fixtures/ac1.accepted-00794ea-pets-outdoors.json', import.meta.url));
  const provenance = JSON.parse(readFileSync(new URL('./fixtures/ac1.accepted-00794ea-pets-outdoors.provenance.json', import.meta.url), 'utf8'));
  const cohort = JSON.parse(fixture.toString('utf8'));
  expect(provenance.engine).toBe('00794ead432a550e6bef79d96a8553097fdd3064');
  expect(provenance.acceptedFeatureBase).toBe('3cc1f39f4adee7a39034dc29ec20097c1b49a8d8');
  expect(cohort.engine).toBe(provenance.engine);
  expect(sha256HexSync(fixture)).toBe(provenance.referenceSha256);
  expect(sha256HexSync(readFileSync(new URL('./ac1.accepted.record.ts', import.meta.url)))).toBe(provenance.recorderSha256);
  expect(sha256HexSync(readFileSync(new URL('./ac1Harness.ts', import.meta.url)))).toBe(provenance.harnessSha256);
  expect(cohort.runs).toHaveLength(21);
  expect(cohort.runs.every((r: { faults: number }) => r.faults === 0)).toBe(true);
});

it('keeps the full pets block and detects changes to its trust, motion and population', () => {
  const world = createNewWorld(ac1Options('starter', 1));
  expect(world.pets?.strays.length).toBeGreaterThan(0);
  expect(ac1Projection(world).pets).toEqual(world.pets);
  const original = ac1SaveHash(world);
  for (const change of ['trust', 'motion', 'population'] as const) {
    const edited = structuredClone(world);
    if (change === 'trust') edited.pets!.strays[0].trust += 1;
    if (change === 'motion') edited.pets!.strays[0].pos.x += 1;
    if (change === 'population') edited.pets!.strays.pop();
    expect(ac1SaveHash(edited), change).not.toBe(original);
  }
});
