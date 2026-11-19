import { describe, expect, it } from 'vitest';
import { createLotTemplate } from '../../../src/sim/spatial/templates';
import { auditBuiltStarts, extractStartGeometry, type BuiltStartLayout, type BuiltStartLot } from '../../../src/sim/world/startGeometry';

/** Real shipped template grids; layout placement is a test fixture, not a world generator. */
export function canonicalBuiltStart(): BuiltStartLayout {
  const lots: BuiltStartLot[] = Array.from({ length: 8 }, (_, i) => {
    const templateId = i === 0 ? 'derelict' : i === 7 ? 'empty' : 'starter';
    const regionId = `wormwood:mildew_${i < 4 ? 'n' : 's'}${i % 4 + 1}`;
    return {
      ...createLotTemplate(templateId), mirrored: false,
      region: {
        id: regionId, lotId: regionId, kind: 'lot', districtId: 'wormwood', templateId,
        placement: { regionId, originX: (i % 4) * 40 - 80, originZ: i < 4 ? -30 : 10, rot: i < 4 ? 0 : 2, width: 30, depth: 30 },
      },
    };
  });
  return { home: lots[0], neighbours: lots.slice(1), fallback: false };
}

function signature(layout: BuiltStartLayout) {
  const result = extractStartGeometry(layout);
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.signature;
}

describe('built-start extraction', () => {
  it('reads real walls/openings/terrain and placed slot, without mutating the built layout', () => {
    const layout = canonicalBuiltStart(), before = structuredClone(layout);
    const result = extractStartGeometry(layout);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.geometry.slotId).toBe('mildew_n1');
    expect(result.geometry.shellEdges).toEqual(Object.keys(layout.home.lot.walls).sort());
    expect(result.geometry.openings).toContain('door_splintered@h:13:19');
    expect(result.geometry.terrain).toEqual(layout.home.lot.floors);
    expect(result.geometry.neighbours).toHaveLength(7);
    expect(layout).toEqual(before);
    result.geometry.buildable.x0++;
    expect(layout).toEqual(before);
  });

  it('ignores seed labels, cosmetics, object ids, ordering and grid cache versions', () => {
    const original = canonicalBuiltStart(), changed = structuredClone(original);
    Object.assign(changed, { seed: 12345, variantSeed: 99, neighbourSeed: 123 });
    changed.home.lot.version += 100;
    changed.home.lot.walls = Object.fromEntries(Object.entries(changed.home.lot.walls).reverse());
    changed.home.objects = [...changed.home.objects].reverse();
    changed.neighbours = [...changed.neighbours].reverse();
    expect(signature(changed)).toEqual(signature(original));
  });

  it('preserves geometry signatures through a JSON save/restore of built region inputs', () => {
    const input = canonicalBuiltStart();
    expect(signature(JSON.parse(JSON.stringify(input)))).toEqual(signature(input));
  });

  it.each([
    ['footprint', (s: BuiltStartLayout) => { s.home.lot.buildable.x0++; }],
    ['shell', (s: BuiltStartLayout) => { delete s.home.lot.walls['h:11:13']; }],
    ['shell', (s: BuiltStartLayout) => { s.home.objects = s.home.objects.filter(o => o.placement.kind !== 'opening'); }],
    ['terrain', (s: BuiltStartLayout) => { s.home.lot.floors[0] = 'floor_dirt_packed'; }],
    ['rot', (s: BuiltStartLayout) => { s.home.region.placement.rot = 2; }],
    ['neighbours', (s: BuiltStartLayout) => { s.neighbours[0].mirrored = true; }],
  ] as const)('detects a built %s change', (part, change) => {
    const layout = canonicalBuiltStart(), before = signature(layout);
    change(layout);
    const after = signature(layout);
    expect(after.parts[part]).not.toBe(before.parts[part]);
  });

  const hostile: [string, (s: BuiltStartLayout) => void][] = [
    ['missing neighbor', s => { s.neighbours = s.neighbours.slice(1); }],
    ['extra neighbor', s => { s.neighbours = [...s.neighbours, s.neighbours[0]]; }],
    ['duplicate region', s => { s.neighbours = [s.home, ...s.neighbours.slice(1)]; }],
    ['unbuilt neighbor', s => { (s.neighbours[0] as unknown as Record<string, unknown>).lot = null; }],
    ['foreign district', s => { s.neighbours[0].region.districtId = 'bayou'; }],
    ['overlapping region', s => { s.neighbours[0].region.placement.originX = s.home.region.placement.originX; }],
    ['grid dimension mismatch', s => { s.home.lot.width++; }],
    ['invalid rotation', s => { (s.home.region.placement as unknown as Record<string, unknown>).rot = 7; }],
    ['missing fallback', s => { delete (s as unknown as Record<string, unknown>).fallback; }],
    ['short terrain', s => { s.home.lot.floors.pop(); }],
    ['sparse terrain', s => { delete s.home.lot.floors[0]; }],
    ['invalid footprint', s => { s.home.lot.buildable.x0 = -1; }],
    ['bad edge', s => { s.home.lot.walls['h:999:2'] = { paint: ['wall_plaster_moss', 'wall_plaster_moss'], openingId: null }; }],
    ['duplicate opening', s => { s.home.objects = [...s.home.objects, s.home.objects.find(o => o.placement.kind === 'opening')!]; }],
    ['opening without wall', s => { delete s.home.lot.walls['h:13:19']; }],
    ['missing mirror flag', s => { delete (s.neighbours[0] as unknown as Record<string, unknown>).mirrored; }],
    ['unfinished home', s => { s.home.region.kind = 'unfinished'; }],
  ];
  it.each(hostile)('refuses %s instead of manufacturing a signature', (_, breakIt) => {
    const layout = canonicalBuiltStart();
    breakIt(layout);
    expect(extractStartGeometry(layout).ok).toBe(false);
  });
});

describe('AC-6 built cohort', () => {
  it('rejects 50 changed seed labels with unchanged real template geometry', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({ seed: i + 1, layout: canonicalBuiltStart() }));
    const report = auditBuiltStarts(samples);
    expect(report.extractionErrors).toEqual([]);
    expect(report.coverageErrors).toEqual([]);
    expect(report.diversity).toEqual({ seeds: 50, distinct: 1, fallbacks: 0, minPairwiseDistance: 0, pass: false });
    expect(report.pass).toBe(false);
  });

  it('rejects missing, duplicate, extra, invalid or out-of-cohort seed receipts', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({ seed: i + 1, layout: canonicalBuiltStart() }));
    for (const input of [samples.slice(1), [...samples, samples[0]], samples.map(s => ({ ...s, seed: 1 })), samples.map(s => ({ ...s, seed: s.seed + 50 })), samples.map(s => ({ ...s, seed: NaN }))]) {
      const report = auditBuiltStarts(input);
      expect(report.pass).toBe(false);
      expect(report.coverageErrors.length).toBeGreaterThan(0);
    }
  });

  it('binds invalid-built-layout failure to its seed', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({ seed: i + 1, layout: canonicalBuiltStart() }));
    samples[17].layout.home.lot.floors.pop();
    const report = auditBuiltStarts(samples);
    expect(report.pass).toBe(false);
    expect(report.extractionErrors).toEqual([{ seed: 18, reason: 'incomplete terrain' }]);
    expect(report.signatures.find(s => s.seed === 18)?.signature).toBeNull();
  });
});
