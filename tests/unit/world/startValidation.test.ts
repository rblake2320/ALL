import { afterEach, expect, it, vi } from 'vitest';
import { loadContent } from '../../../src/sim';
import { createStartTemplate } from '../../../src/sim/world/startTemplates';
import { graveyardWalkTiles, validateStartLot } from '../../../src/sim/world/startValidation';
import { generateStart, transformStartTemplate } from '../../../src/sim/world/startGenerator';
import { canonicalStartPick } from '../../../src/shared/town';
import * as world from '../../../src/shared/world';
import { buildWorldMap } from '../../../src/shared/mildewLane';

const registry = loadContent();
afterEach(() => vi.restoreAllMocks());
for (const [name, mutate] of [
  ['missing mailbox', (t: ReturnType<typeof createStartTemplate>) => { t.objects = t.objects.filter(o => o.defId !== 'mailbox_crooked'); }],
  ['missing coffin', (t: ReturnType<typeof createStartTemplate>) => { t.objects = t.objects.filter(o => o.defId !== 'coffin_pine'); }],
  ['sealed front door', (t: ReturnType<typeof createStartTemplate>) => { t.objects = t.objects.filter(o => o.placement.kind !== 'opening' || o.placement.edge !== 'h:13:19'); }],
  ['overlapping furniture', (t: ReturnType<typeof createStartTemplate>) => { t.objects.push(structuredClone(t.objects.find(o => o.defId === 'coffin_pine')!)); }],
  ['unknown object', (t: ReturnType<typeof createStartTemplate>) => { t.objects[0].defId = 'unbuilt_object'; }],
  ['unknown terrain', (t: ReturnType<typeof createStartTemplate>) => { t.lot.floors[0] = 'unbuilt_floor'; }],
  ['unknown wall paint', (t: ReturnType<typeof createStartTemplate>) => { Object.values(t.lot.walls)[0].paint[0] = 'unbuilt_wall'; }],
  ['missing entrances', (t: ReturnType<typeof createStartTemplate>) => { t.lot.entryPoints = []; }],
  ['incomplete floor grid', (t: ReturnType<typeof createStartTemplate>) => { t.lot.floors.pop(); }],
] as const) it(`admission rejects ${name}`, () => {
  const home = createStartTemplate('derelict'); mutate(home);
  expect(validateStartLot(home, registry, true).ok).toBe(false);
});

it('a missing street connection cannot be counted as a short graveyard walk', () => {
  const map = buildWorldMap({ seed: 1, genVersion: 1, contentVersion: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'derelict' });
  map.portals = map.portals.filter(p => p.a.regionId !== 'street:mildew:3' && p.b.regionId !== 'street:mildew:3');
  expect(graveyardWalkTiles(createStartTemplate('derelict'), registry, map, 'wormwood:mildew_n2')).toBe(Infinity);
});

it('a forged portal that teleports across districts cannot shorten the gate walk', () => {
  const map = buildWorldMap({ seed: 1, genVersion: 1, contentVersion: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'derelict' });
  map.portals = [{ id: 'forged', kind: 'gate', a: { regionId: 'wormwood:mildew_n2', x: 13, z: 19 }, b: { regionId: 'graveyard:old_graveyard', x: 14, z: 29 }, width: 1 }];
  expect(graveyardWalkTiles(createStartTemplate('derelict'), registry, map, 'wormwood:mildew_n2')).toBe(Infinity);
});

it('exhausted attempts build an admitted canonical fallback, retain all failures and replay its marker', () => {
  const before = generateStart(7, 'derelict', registry);
  const failed = before.attempts.find(a => a.errors.length);
  expect(failed).toBeDefined();
  vi.spyOn(world, 'pickStart').mockImplementation((_seed, _spec, attempt = 0) => ({ ...failed!.pick, attempt }));
  const generated = generateStart(7, 'derelict', registry);
  expect(generated.fallback).toBe(true);
  expect(generated.attempts).toHaveLength(8);
  expect(generated.attempts.every(a => a.errors.length > 0)).toBe(true);
  expect(generated.validation.ok).toBe(true);
  expect(generated.start).toEqual({ ...canonicalStartPick('derelict'), attempt: 8 });
  expect(generated.home).toEqual(createStartTemplate('derelict'));
  expect(generateStart(7, 'derelict', registry, JSON.parse(JSON.stringify(generated.start))).layout).toEqual(generated.layout);
});

it('refuses a forged fallback slot and transforms beyond the saved-version bounds', () => {
  expect(() => generateStart(1, 'derelict', registry, { ...canonicalStartPick('derelict'), attempt: 8, slotId: 'mildew_n1' })).toThrow('canonical');
  expect(() => transformStartTemplate(createStartTemplate('derelict'), registry, true, 4, 0)).toThrow('bounds');
});
