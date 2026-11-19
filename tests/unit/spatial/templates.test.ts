import { describe, expect, it } from 'vitest';
import { createLotTemplate, createSpatial, edgeSides, linkOpenings, LOT_TEMPLATE_INFO, parseEdge } from '../../../src/sim/spatial';
import type { ObjectState } from '../../../src/sim/types';
import { DEFAULT_EXTERIOR_WALL, FLOOR_STYLE_BY_ID, WALL_STYLE_BY_ID } from '../../../src/shared/styles';
import { makeContent, templateWorld } from './fixtures';

const content = makeContent();

function spatialFor(id: 'starter' | 'empty') {
  const state = templateWorld(id);
  const S = createSpatial(() => state, content);
  return { state, S };
}

function checkObject(S: ReturnType<typeof createSpatial>, o: ObjectState) {
  const p = o.placement;
  if (p.kind === 'floor') return S.checkPlace(o.defId, p.x, p.z, p.rot, o.id);
  if (p.kind === 'wall') return S.checkWallItem(o.defId, p.edge, p.side, o.id);
  if (p.kind === 'opening') return S.checkOpening(o.defId, p.edge, o.id);
  throw new Error(`unexpected template placement ${p.kind}`);
}

function byDef(state: { objects: Record<string, ObjectState> }, defId: string): ObjectState[] {
  return Object.values(state.objects).filter((o) => o.defId === defId);
}

describe('LOT_TEMPLATE_INFO', () => {
  it('lists the three templates with their starting funds, the story start (derelict) first', () => {
    expect(LOT_TEMPLATE_INFO.map((t) => [t.id, t.startingFunds])).toEqual([
      ['derelict', 2500],
      ['starter', 6500],
      ['empty', 22000],
    ]);
    expect(LOT_TEMPLATE_INFO[1].name).toBe('Fixer-Upper on Mildew Lane');
    for (const t of LOT_TEMPLATE_INFO) expect(t.description.length).toBeGreaterThan(20);
  });
});

describe('lot shape', () => {
  for (const id of ['starter', 'empty'] as const) {
    it(`${id}: 30x30, buildable [1,29)x[1,27), sidewalk 28, entry points at the sidewalk ends, 900 floors`, () => {
      const { lot } = createLotTemplate(id);
      expect([lot.width, lot.depth]).toEqual([30, 30]);
      expect(lot.buildable).toEqual({ x0: 1, z0: 1, x1: 29, z1: 27 });
      expect(lot.sidewalkZ).toBe(28);
      expect(lot.entryPoints).toEqual([
        { x: 0.5, z: 28.5 },
        { x: 29.5, z: 28.5 },
      ]);
      expect(lot.floors.length).toBe(900);
      expect(Number.isInteger(lot.version) && Number.isInteger(lot.wallVersion) && Number.isInteger(lot.floorVersion)).toBe(true);
      expect(JSON.parse(JSON.stringify(lot))).toEqual(lot); // JSON-safe
    });
  }

  it('returns fresh, unshared data on every call; unknown ids fall back to the empty plot', () => {
    const a = createLotTemplate('starter');
    a.lot.walls['h:14:19'].paint[0] = 'MUTATED';
    a.lot.floors[0] = 'MUTATED';
    a.objects[0].placement = { kind: 'floor', x: 0, z: 0, rot: 0 };
    const b = createLotTemplate('starter');
    expect(b.lot.walls['h:14:19'].paint[0]).not.toBe('MUTATED');
    expect(b.lot.floors[0]).toBeNull();
    expect(b.objects[0].placement.kind).toBe('opening');
    expect(createLotTemplate('mansion' as 'empty').objects.length).toBe(2);
  });
});

describe('every template object is valid and fully reachable', () => {
  for (const id of ['starter', 'empty'] as const) {
    it(`${id}: all objects pass checkPlace / checkWallItem / checkOpening with no blocked slots`, () => {
      const { state, S } = spatialFor(id);
      for (const o of Object.values(state.objects)) {
        const r = checkObject(S, o);
        expect(r.ok, `${o.defId} ${JSON.stringify(o.placement)}: ${r.reason}`).toBe(true);
        expect(r.blockedSlots, `${o.defId} blocked slots`).toEqual([]);
        expect(content.objects[o.defId], `${o.defId} must be a catalog object`).toBeDefined();
      }
      expect(S.debugFaults()).toEqual([]);
    });

    it(`${id}: every slot of every object is reachable from BOTH sidewalk entry points`, () => {
      const { state, S } = spatialFor(id);
      for (const ep of state.lot.entryPoints) {
        const df = S.distanceField(ep);
        for (const o of Object.values(state.objects)) {
          const spec = content.objects[o.defId];
          const resolved = S.resolveSlots(o);
          spec.slots.forEach((slot, idx) => {
            const tiles = resolved.filter((r) => r.index === idx).flatMap((r) => r.approach);
            const reachable = tiles.filter((t) => Number.isFinite(df.dist[t.z * 30 + t.x]));
            expect(reachable.length, `${o.defId}.${slot.id} unreachable from ${JSON.stringify(ep)}`).toBeGreaterThan(0);
            expect(S.findPath(ep, reachable[0]), `${o.defId}.${slot.id} path`).not.toBeNull();
          });
        }
      }
    });
  }

  it('starter: every walkable tile on the lot (indoors included) is reachable from the sidewalk', () => {
    const { S } = spatialFor('starter');
    const df = S.distanceField({ x: 0.5, z: 28.5 });
    for (let z = 0; z < 30; z++) for (let x = 0; x < 30; x++) if (S.isWalkable(x, z)) expect(Number.isFinite(df.dist[z * 30 + x]), `${x},${z}`).toBe(true);
  });
});

describe('starter cottage layout', () => {
  const { state, S } = spatialFor('starter');
  const roomOfObj = (o: ObjectState) => {
    const c = S.objectCenter(o);
    return S.roomAt(c.x, c.z);
  };

  it('has 4 enclosed rooms, roughly centred, ~11 x 9 tiles', () => {
    const indoor = S.rooms().filter((r) => r.indoor);
    expect(indoor.length).toBe(4);
    const tiles = indoor.flatMap((r) => r.tiles);
    const xs = tiles.map((i) => i % 30);
    const zs = tiles.map((i) => Math.floor(i / 30));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...xs)).toBeLessThanOrEqual(21);
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(11);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...zs)).toBeLessThanOrEqual(20);
    expect(Math.max(...zs) - Math.min(...zs) + 1).toBeGreaterThanOrEqual(9);
  });

  it('contains every required object (counts per the brief)', () => {
    const want: Record<string, number> = {
      sofa_moldy: 1,
      tv_crt: 1,
      armchair_tattered: 1,
      rug_rag: 1,
      lamp_skull: 1,
      table_coffinlid: 1,
      fridge_humming: 1,
      stove_greasefire: 1,
      counter_butcher: 2,
      sink_rusty: 1,
      trash_lidded: 1,
      table_wake: 1,
      chair_creaky: 4,
      coffin_pine: 1,
      coffin_chillrest: 1, // balance pass: one pine coffin became a Chill-Rest (docs/BALANCE.md)
      shelf_moldering: 1, // balance pass: a second fun source (and Logic) in the living room
      candelabra_drippy: 1,
      shower_drizzle: 1,
      mirror_cracked: 1,
      mailbox_crooked: 1,
      plot_budget: 1,
      headstone_decor: 1,
      tree_gnarled: 2,
      lantern_post: 1,
    };
    for (const [def, n] of Object.entries(want)) expect(byDef(state, def).length, def).toBe(n);
    expect(byDef(state, 'door_splintered').length).toBeGreaterThanOrEqual(4);
    expect(byDef(state, 'window_grimy').length + byDef(state, 'window_gothic').length).toBeGreaterThanOrEqual(5);
  });

  it('puts things in the right rooms', () => {
    const roomsOf = (defs: string[]) => new Set(defs.flatMap((d) => byDef(state, d)).map(roomOfObj));
    const living = roomsOf(['sofa_moldy', 'tv_crt', 'armchair_tattered', 'rug_rag', 'lamp_skull', 'table_coffinlid', 'shelf_moldering']);
    const kitchen = roomsOf(['fridge_humming', 'stove_greasefire', 'counter_butcher', 'sink_rusty', 'trash_lidded', 'table_wake', 'chair_creaky']);
    const bedroom = roomsOf(['coffin_pine', 'coffin_chillrest', 'candelabra_drippy']);
    const bathroom = roomsOf(['shower_drizzle', 'mirror_cracked']);
    for (const s of [living, kitchen, bedroom, bathroom]) {
      expect(s.size).toBe(1);
      expect([...s][0]).toBeGreaterThan(0);
    }
    expect(new Set([...living, ...kitchen, ...bedroom, ...bathroom]).size).toBe(4);
    const yard = roomsOf(['mailbox_crooked', 'plot_budget', 'headstone_decor', 'tree_gnarled', 'lantern_post']);
    expect([...yard]).toEqual([0]);
  });

  it('front door on the street-facing (+Z) wall, every room reachable through interior doors', () => {
    const doors = byDef(state, 'door_splintered');
    const front = doors.filter((d) => {
      if (d.placement.kind !== 'opening') return false;
      const e = parseEdge(d.placement.edge)!;
      const [a, b] = edgeSides(d.placement.edge);
      return e.kind === 'h' && S.isIndoor(a.x, a.z) && !S.isIndoor(b.x, b.z);
    });
    expect(front.length).toBe(1);
    for (const d of doors) {
      if (d.placement.kind !== 'opening') continue;
      const [a, b] = edgeSides(d.placement.edge);
      expect(S.canStep(a.x, a.z, b.x, b.z)).toBe(true);
      expect(state.lot.walls[d.placement.edge].openingId).toBe(d.id);
    }
  });

  it('walls: interior paint inside, siding outside; interior floors cover every indoor tile', () => {
    for (const [edge, seg] of Object.entries(state.lot.walls)) {
      const sides = edgeSides(edge);
      seg.paint.forEach((style, s) => {
        expect(WALL_STYLE_BY_ID[style], style).toBeDefined();
        const t = sides[s];
        if (S.isIndoor(t.x, t.z)) expect(style, `${edge} side ${s}`).not.toBe(DEFAULT_EXTERIOR_WALL);
        else expect(style, `${edge} side ${s}`).toBe(DEFAULT_EXTERIOR_WALL);
      });
    }
    const indoorStyles = new Set<string>();
    for (const r of S.rooms().filter((x) => x.indoor)) {
      for (const i of r.tiles) {
        const f = state.lot.floors[i];
        expect(f, `tile ${i}`).not.toBeNull();
        expect(FLOOR_STYLE_BY_ID[f as string]).toBeDefined();
        indoorStyles.add(FLOOR_STYLE_BY_ID[f as string].pattern);
      }
    }
    for (const p of ['planks', 'checker', 'tile']) expect(indoorStyles.has(p), p).toBe(true);
  });

  it('dining chairs face the table; the loveseat faces the TV whose viewing tiles stay clear', () => {
    const table = byDef(state, 'table_wake')[0];
    const tableTiles = S.objectTiles(table).map((t) => `${t.x},${t.z}`);
    for (const chair of byDef(state, 'chair_creaky')) {
      const [slot] = S.resolveSlots(chair);
      const fx = Math.floor(slot.pose.x + Math.sin(slot.pose.facing));
      const fz = Math.floor(slot.pose.z + Math.cos(slot.pose.facing));
      expect(tableTiles, `chair ${chair.id}`).toContain(`${fx},${fz}`);
    }
    const sofa = byDef(state, 'sofa_moldy')[0];
    const tv = byDef(state, 'tv_crt')[0];
    const sc = S.objectCenter(sofa);
    const tc = S.objectCenter(tv);
    const facing = S.resolveSlots(sofa)[0].pose.facing;
    const dx = tc.x - sc.x;
    const dz = tc.z - sc.z;
    const cos = (Math.sin(facing) * dx + Math.cos(facing) * dz) / Math.hypot(dx, dz);
    expect(cos).toBeGreaterThan(0.95);
    for (const t of S.resolveSlots(tv)[0].approach) expect(S.isWalkable(t.x, t.z)).toBe(true);
    // the armchair is angled at the TV too
    const arm = byDef(state, 'armchair_tattered')[0];
    const af = S.resolveSlots(arm)[0].pose.facing;
    const ac = S.objectCenter(arm);
    const adx = tc.x - ac.x;
    const adz = tc.z - ac.z;
    expect((Math.sin(af) * adx + Math.cos(af) * adz) / Math.hypot(adx, adz)).toBeGreaterThan(0.85);
  });

  it('mailbox stands by the front path near the curb (z ~ 26)', () => {
    const mb = byDef(state, 'mailbox_crooked')[0];
    if (mb.placement.kind !== 'floor') throw new Error();
    expect(mb.placement.z).toBeGreaterThanOrEqual(24);
    expect(mb.placement.z).toBeLessThanOrEqual(26);
    const neighbours = [-1, 1].map((dx) => state.lot.floors[mb.placement.kind === 'floor' ? mb.placement.z * 30 + mb.placement.x + dx : 0]);
    expect(neighbours.some((f) => f === 'floor_stone_crypt')).toBe(true);
  });

  it('room environments are in range and the furnished living room is pleasant', () => {
    for (const r of S.rooms()) {
      const t = r.tiles[0];
      const v = S.roomEnvironment(t % 30, Math.floor(t / 30));
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThanOrEqual(10);
    }
    const sofa = byDef(state, 'sofa_moldy')[0];
    const c = S.objectCenter(sofa);
    expect(S.roomEnvironment(c.x, c.z)).toBeGreaterThan(0);
  });
});

describe('empty plot', () => {
  it('is a bare lot with a mailbox and a gnarled tree', () => {
    const { state, S } = spatialFor('empty');
    expect(Object.values(state.objects).map((o) => o.defId).sort()).toEqual(['mailbox_crooked', 'tree_gnarled']);
    expect(Object.keys(state.lot.walls)).toEqual([]);
    expect(state.lot.floors.every((f) => f === null)).toBe(true);
    expect(S.rooms().length).toBe(1);
  });
});

describe('linkOpenings', () => {
  it('links spawned openings to their walls, clears dangling links and is idempotent', () => {
    const state = templateWorld('starter');
    for (const seg of Object.values(state.lot.walls)) seg.openingId = null;
    state.lot.walls['h:12:19'].openingId = 'o-ghost';
    const n = linkOpenings(state);
    const openings = Object.values(state.objects).filter((o) => o.placement.kind === 'opening');
    expect(n).toBe(openings.length + 1);
    for (const o of openings) if (o.placement.kind === 'opening') expect(state.lot.walls[o.placement.edge].openingId).toBe(o.id);
    expect(state.lot.walls['h:12:19'].openingId).toBeNull();
    expect(linkOpenings(state)).toBe(0);
    expect(linkOpenings({ lot: null } as never)).toBe(0);
  });
});
