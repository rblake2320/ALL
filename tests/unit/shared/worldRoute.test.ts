/**
 * The pure portal-graph planner (src/shared/worldRoute.ts, W-025 S3) on the shipped Mildew Lane map with a synthetic
 * world (every open region walkable, legs = octile distance): portal geometry, A* optimality against a brute-force
 * Dijkstra over the same graph, the reason order, one-way and locked portals, determinism.
 */
import { describe, expect, it } from 'vitest';
import { buildWorldMap } from '../../../src/shared/mildewLane';
import { lotTileToWorldTile, type RegionId, type WorldPoint } from '../../../src/shared/world';
import { type RouteEnv, decodeRoute, encodeRoute, planRoute, portalSpans, routeWorld } from '../../../src/shared/worldRoute';

const map = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
const spans = portalSpans(map);
const octile = (a: WorldPoint, b: WorldPoint) => {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
};

function env(over: Partial<RouteEnv> = {}): RouteEnv {
  const kinds = new Map(map.regions.map((r) => [r.id, r] as const));
  return {
    regionBlocked: (id) => (kinds.get(id)?.kind === 'unfinished' ? 'unfinished' : null),
    regionLive: (id) => kinds.get(id)?.kind !== 'unfinished',
    portalLocked: () => false,
    tileUsable: (id, x, z) => {
      const d = kinds.get(id);
      return !!d && x >= 0 && z >= 0 && x < d.placement.width && z < d.placement.depth;
    },
    tileCost: () => 0,
    legCost: (_id, a, b) => octile(a, b),
    ...over,
  };
}
const nobody = () => false;

describe('portal spans', () => {
  it('every portal resolves; each pair is one world step apart across the shared edge, in increasing world order', () => {
    expect(spans.size).toBe(map.portals.length);
    for (const p of map.portals) {
      const s = spans.get(p.id)!;
      expect(s.pairs.length).toBe(p.width);
      const ra = map.regions.find((r) => r.id === p.a.regionId)!;
      const rb = map.regions.find((r) => r.id === p.b.regionId)!;
      let prev: WorldPoint | null = null;
      for (const q of s.pairs) {
        const wa = lotTileToWorldTile(ra.placement, q.a.x, q.a.z)!;
        const wb = lotTileToWorldTile(rb.placement, q.b.x, q.b.z)!;
        expect({ x: wb.x - wa.x, z: wb.z - wa.z }).toEqual(s.dir);
        if (prev) expect(wa.x + wa.z).toBe(prev.x + prev.z + 1);
        prev = wa;
      }
      expect(s.pairs[0].a).toEqual({ x: p.a.x, z: p.a.z });
    }
  });
});

describe('planRoute (A*)', () => {
  const regions = map.regions.filter((r) => r.kind !== 'unfinished');

  /** Brute force: Dijkstra over the same node set (no heuristic). */
  function brute(from: { regionId: RegionId; x: number; z: number }, to: { regionId: RegionId; x: number; z: number }): number {
    const e = env();
    const nodes: { key: string; region: RegionId; t: WorldPoint }[] = [{ key: 'S', region: from.regionId, t: from }, { key: 'G', region: to.regionId, t: to }];
    for (const [id, s] of spans) {
      const i = (s.pairs.length - 1) / 2;
      const k = s.pairs.map((_, j) => j).sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b)[0];
      nodes.push({ key: `${id}:a`, region: s.portal.a.regionId, t: s.pairs[k].a }, { key: `${id}:b`, region: s.portal.b.regionId, t: s.pairs[k].b });
    }
    const dist = new Map(nodes.map((n) => [n.key, Infinity]));
    dist.set('S', 0);
    const done = new Set<string>();
    for (;;) {
      let cur: (typeof nodes)[number] | null = null;
      for (const n of nodes) if (!done.has(n.key) && (cur === null || dist.get(n.key)! < dist.get(cur.key)!)) cur = n;
      if (!cur || dist.get(cur.key) === Infinity) break;
      done.add(cur.key);
      const d = dist.get(cur.key)!;
      for (const m of nodes) {
        if (m.key === cur.key || m.key === 'S') continue;
        let c = Infinity;
        if (m.region === cur.region) c = e.legCost(cur.region, cur.t, m.t, false);
        const [pc, sc] = cur.key.split(/:(?=[ab]$)/);
        const [pm, sm] = m.key.split(/:(?=[ab]$)/);
        if (pc === pm && sc !== sm) c = Math.min(c, 1);
        if (d + c < dist.get(m.key)!) dist.set(m.key, d + c);
      }
    }
    return dist.get('G')!;
  }

  it('finds the optimal route (= brute-force Dijkstra) for 200 random pairs of tiles in different regions', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    for (let i = 0; i < 200; i++) {
      const ra = regions[rnd(regions.length)];
      let rb = regions[rnd(regions.length)];
      if (rb.id === ra.id) rb = regions[(regions.indexOf(ra) + 1) % regions.length];
      const from = { regionId: ra.id, x: rnd(ra.placement.width), z: rnd(ra.placement.depth) };
      const to = { regionId: rb.id, x: rnd(rb.placement.width), z: rnd(rb.placement.depth) };
      const r = planRoute(map, spans, from, to, env(), nobody, { ignoreLocks: false, ignorePrivacy: false });
      expect(r).not.toBeNull();
      expect(r!.cost).toBeCloseTo(brute(from, to), 6);
      expect(r!.crossings.length).toBeGreaterThan(0);
      // the same input gives the same route
      expect(planRoute(map, spans, from, to, env(), nobody, { ignoreLocks: false, ignorePrivacy: false })).toEqual(r);
    }
  });

  it('reason order: unfinished, then locked (gate), then private, then noPath', () => {
    const from = { regionId: 'wormwood:mildew_n2', x: 15, z: 20 };
    const grave = { regionId: 'graveyard:old_graveyard', x: 14, z: 20 };
    expect(routeWorld(map, spans, from, { regionId: 'unfinished:bayou_road', x: 1, z: 1 }, env(), nobody, 1.3).result).toMatchObject({ ok: false, reason: 'unfinished' });
    const locked = env({ portalLocked: (p) => p.id === 'gate:old_graveyard' });
    expect(routeWorld(map, spans, from, grave, locked, nobody, 1.3).result).toMatchObject({ ok: false, reason: 'locked' });
    // a private interior: tile (5,5) of n3 only reachable with the resident mask
    const priv = env({ legCost: (id, a, b, resident) => (id === 'wormwood:mildew_n3' && !resident && (b.x === 5 && b.z === 5) ? Infinity : octile(a, b)) });
    expect(routeWorld(map, spans, from, { regionId: 'wormwood:mildew_n3', x: 5, z: 5 }, priv, nobody, 1.3).result).toMatchObject({ ok: false, reason: 'private' });
    expect(routeWorld(map, spans, from, { regionId: 'wormwood:mildew_n3', x: 5, z: 5 }, priv, (id) => id === 'wormwood:mildew_n3', 1.3).result.ok).toBe(true);
    const cut = env({ regionLive: (id) => id === 'wormwood:mildew_n2' || id === 'graveyard:old_graveyard' });
    expect(routeWorld(map, spans, from, grave, cut, nobody, 1.3).result).toMatchObject({ ok: false, reason: 'noPath' });
    const district = env({ regionBlocked: (id) => (id.startsWith('graveyard:') ? 'locked' : null) });
    expect(routeWorld(map, spans, from, grave, district, nobody, 1.3).result).toMatchObject({ ok: false, reason: 'locked' });
    const ok = routeWorld(map, spans, from, grave, env(), nobody, 1.3).result;
    expect(ok.ok && ok.portals[ok.portals.length - 1]).toBe('gate:old_graveyard');
    expect(routeWorld(null, null, null, grave, env(), nobody, 1.3).result).toMatchObject({ ok: false, reason: 'noPath', target: grave });
  });

  it('route codec round-trips', () => {
    const r = planRoute(map, spans, { regionId: 'wormwood:mildew_s4', x: 3, z: 3 }, { regionId: 'wormwood:corner_park', x: 5, z: 5 }, env(), nobody, { ignoreLocks: false, ignorePrivacy: false })!;
    expect(decodeRoute(encodeRoute(r.crossings))).toEqual(r.crossings);
    expect(decodeRoute('')).toEqual([]);
  });
});
