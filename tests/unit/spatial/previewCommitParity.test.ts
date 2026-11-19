/**
 * Preview ⇔ commit parity on the REAL sim (starter lot, seed 7): what the build/buy ghost shows is exactly what a
 * click does. For every catalog def by placement kind, `sim.build.preview(cmd)` and the input layer's verdict
 * (placementVerdict — the one function the Buy/Build ghosts, labels, keyboard announcements and clicks use) must
 * agree with `dispatch({ type: 'build', cmd })` on ok AND reason; a successful apply must be undone with an exact
 * refund. Regression for the owner report "window showed GREEN but I couldn't add it": the ghost used the raw
 * spatial check (no funds rule), so a window you could not afford drew green and the click was refused.
 */
import { describe, expect, it } from 'vitest';
import type { BuildCommand, ObjectDef, SimulationAPI } from '../../../src/sim/contracts';
import type { EdgeKey, ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { placementVerdict, previewBuild } from '../../../src/game/input/placementPreview';
import { resaleValue, specOf } from '../../../src/sim/spatial/defs';

function realSim(): SimulationAPI {
  return createSimulation(
    createNewWorld({
      seed: 7,
      householdName: 'Parity',
      members: ['Mort', 'Ghoulia'].map((firstName) => ({ firstName, lastName: 'Parity', appearance: defaultAppearance(), traits: [], aspiration: null })),
      lotTemplate: 'starter',
      difficulty: 'normal',
    }),
  );
}

const funds = (sim: SimulationAPI): number => sim.state.household.funds;
const objectCount = (sim: SimulationAPI): number => Object.keys(sim.state.objects).length;

interface Tally {
  total: number;
  ok: number;
  refused: number;
  mismatches: string[];
}
const tally = (): Tally => ({ total: 0, ok: 0, refused: 0, mismatches: [] });

/** preview / verdict / apply for one command; undo a successful apply and check the exact refund. */
function parity(sim: SimulationAPI, cmd: BuildCommand, t: Tally): boolean {
  const f0 = funds(sim);
  const n0 = objectCount(sim);
  const p = sim.build.preview(cmd);
  const v = placementVerdict(sim, cmd);
  const r = sim.dispatch({ type: 'build', cmd });
  t.total++;
  const pReason = p.ok ? undefined : p.reason;
  const rReason = r.ok ? undefined : r.reason;
  const vReason = v.ok ? undefined : v.reason;
  if (p.ok !== r.ok || v.ok !== r.ok || pReason !== rReason || vReason !== rReason) {
    t.mismatches.push(`${JSON.stringify(cmd)}: preview ${p.ok}/${pReason} verdict ${v.ok}/${vReason} apply ${r.ok}/${rReason}`);
  }
  if (!r.ok) {
    t.refused++;
    if (funds(sim) !== f0 || objectCount(sim) !== n0) t.mismatches.push(`${JSON.stringify(cmd)}: refused but changed the world`);
    return false;
  }
  t.ok++;
  if (p.ok && funds(sim) !== f0 - p.cost) t.mismatches.push(`${JSON.stringify(cmd)}: charged ${f0 - funds(sim)} ≠ previewed ${p.cost}`);
  if (sim.build.canUndo()) {
    const u = sim.dispatch({ type: 'undo' });
    if (!u.ok || funds(sim) !== f0 || objectCount(sim) !== n0) t.mismatches.push(`${JSON.stringify(cmd)}: undo did not restore (${u.ok}, funds ${funds(sim)} vs ${f0})`);
  }
  return true;
}

function defsBy(sim: SimulationAPI, placement: ObjectDef['placement']): ObjectDef[] {
  return Object.values(sim.content.objects)
    .filter((d) => d.buyable === true && d.placement === placement)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const wallEdges = (sim: SimulationAPI): EdgeKey[] => Object.keys(sim.state.lot.walls).sort();

/** Deterministic tile sample over the buildable area: a coarse lattice (hits furniture, walls, open floor, yard). */
function sampleTiles(sim: SimulationAPI, step = 3): { x: number; z: number }[] {
  const b = sim.state.lot.buildable;
  const out: { x: number; z: number }[] = [];
  for (let z = b.z0; z < b.z1; z += step) for (let x = b.x0; x < b.x1; x += step) out.push({ x, z });
  return out;
}

describe('preview ⇔ commit parity on the real starter lot (seed 7)', () => {
  it('floor items: every buyable def × sampled tiles × 4 rotations', () => {
    const sim = realSim();
    const t = tally();
    const tiles = sampleTiles(sim, 4);
    for (const d of defsBy(sim, 'floor')) for (const tile of tiles) for (const rot of [0, 1, 2, 3] as const) parity(sim, { type: 'buy', defId: d.id, x: tile.x, z: tile.z, rot, tint: null }, t);
    expect(t.mismatches).toEqual([]);
    expect(t.ok).toBeGreaterThan(0);
    expect(t.refused).toBeGreaterThan(0);
    console.log(`[parity] floor: ${t.total} commands, ${t.ok} applied, ${t.refused} refused, 0 mismatches`);
  });

  it('wall items: every buyable def × every wall edge × both sides', () => {
    const sim = realSim();
    const t = tally();
    for (const d of defsBy(sim, 'wall')) for (const edge of wallEdges(sim)) for (const side of [0, 1] as const) parity(sim, { type: 'buyWallItem', defId: d.id, edge, side, tint: null }, t);
    expect(t.mismatches).toEqual([]);
    expect(t.ok).toBeGreaterThan(0);
    expect(t.refused).toBeGreaterThan(0);
    console.log(`[parity] wall items: ${t.total} commands, ${t.ok} applied, ${t.refused} refused, 0 mismatches`);
  });

  it('doors and windows: every buyable def × every wall edge (plus non-wall edges)', () => {
    const sim = realSim();
    const t = tally();
    const edges = [...wallEdges(sim), 'h:1:1', 'v:2:2', 'h:999:0'];
    for (const d of [...defsBy(sim, 'door'), ...defsBy(sim, 'window')]) for (const edge of edges) parity(sim, { type: 'buyOpening', defId: d.id, edge, tint: null }, t);
    expect(t.mismatches).toEqual([]);
    expect(t.ok).toBeGreaterThan(0);
    expect(t.refused).toBeGreaterThan(0);
    console.log(`[parity] doors/windows: ${t.total} commands, ${t.ok} applied, ${t.refused} refused, 0 mismatches`);
  });

  it('funds: exactly affordable applies, one short is refused with "Not enough money" in the ghost too', () => {
    const sim = realSim();
    const cases: { cmd: (def: ObjectDef) => BuildCommand; placement: ObjectDef['placement'] }[] = [];
    const openingEdge = (d: ObjectDef): EdgeKey => wallEdges(sim).find((e) => sim.spatial.checkOpening(d.id, e, null).ok)!;
    const wallEdge = wallEdges(sim).find((e) => sim.spatial.checkWallItem(defsBy(sim, 'wall')[0].id, e, 0, null).ok || sim.spatial.checkWallItem(defsBy(sim, 'wall')[0].id, e, 1, null).ok)!;
    const wallSide = sim.spatial.checkWallItem(defsBy(sim, 'wall')[0].id, wallEdge, 0, null).ok ? 0 : 1;
    const floorDef = defsBy(sim, 'floor').find((d) => d.price > 1)!;
    const freeTile = sampleTiles(sim, 1).find((p) => sim.spatial.checkPlace(floorDef.id, p.x, p.z, 0, null).ok)!;
    cases.push({ placement: 'window', cmd: (d) => ({ type: 'buyOpening', defId: d.id, edge: openingEdge(d) }) });
    cases.push({ placement: 'door', cmd: (d) => ({ type: 'buyOpening', defId: d.id, edge: openingEdge(d) }) });
    cases.push({ placement: 'wall', cmd: (d) => ({ type: 'buyWallItem', defId: d.id, edge: wallEdge, side: wallSide }) });
    cases.push({ placement: 'floor', cmd: (d) => ({ type: 'buy', defId: d.id, x: freeTile.x, z: freeTile.z, rot: 0 }) });
    for (const c of cases) {
      const def = c.placement === 'floor' ? floorDef : defsBy(sim, c.placement)[0];
      const cmd = c.cmd(def);
      // the raw spatial check that the ghost USED to trust never looks at funds
      sim.state.household.funds = def.price - 1;
      const v = placementVerdict(sim, cmd);
      expect(v, `${def.id} 1 short`).toMatchObject({ ok: false, reason: 'Not enough money' });
      const t = tally();
      expect(parity(sim, cmd, t), `${def.id} 1 short applies`).toBe(false);
      expect(t.mismatches).toEqual([]);
      sim.state.household.funds = def.price;
      expect(placementVerdict(sim, cmd).ok, `${def.id} exactly affordable`).toBe(true);
      expect(parity(sim, cmd, t)).toBe(true);
      expect(t.mismatches).toEqual([]);
    }
  });

  it('not for sale: preview, verdict and apply all refuse with the same reason', () => {
    const sim = realSim();
    const notForSale = Object.values(sim.content.objects).filter((d) => d.buyable === false || d.placement === 'item');
    expect(notForSale.length).toBeGreaterThan(0);
    const edge = wallEdges(sim)[0];
    const t = tally();
    for (const d of notForSale.slice(0, 20)) {
      parity(sim, { type: 'buy', defId: d.id, x: 5, z: 5, rot: 0 }, t);
      parity(sim, { type: 'buyWallItem', defId: d.id, edge, side: 0 }, t);
      parity(sim, { type: 'buyOpening', defId: d.id, edge }, t);
    }
    expect(t.mismatches).toEqual([]);
    expect(t.ok).toBe(0);
    expect(previewBuild(sim, { type: 'buy', defId: notForSale[0].id, x: 5, z: 5, rot: 0 }).reason).toBe('Not for sale');
  });

  it('move / moveWallItem / moveOpening: preview ⇔ apply for every target', () => {
    const sim = realSim();
    const t = tally();
    const objs = Object.values(sim.state.objects) as ObjectState[];
    const buyable = (o: ObjectState) => sim.content.objects[o.defId]?.buyable === true;
    const floors = objs.filter((o) => o.placement.kind === 'floor' && buyable(o)).slice(0, 6);
    const wallItems = objs.filter((o) => o.placement.kind === 'wall');
    const openings = objs.filter((o) => o.placement.kind === 'opening');
    expect(floors.length).toBeGreaterThan(0);
    expect(openings.length).toBeGreaterThan(0);
    for (const o of floors) for (const p of sampleTiles(sim, 5)) for (const rot of [0, 1, 2, 3] as const) parity(sim, { type: 'move', objectId: o.id, x: p.x, z: p.z, rot }, t);
    for (const o of wallItems) for (const edge of wallEdges(sim)) for (const side of [0, 1] as const) parity(sim, { type: 'moveWallItem', objectId: o.id, edge, side }, t);
    for (const o of openings) for (const edge of wallEdges(sim)) parity(sim, { type: 'moveOpening', objectId: o.id, edge }, t);
    expect(t.mismatches).toEqual([]);
    expect(t.ok).toBeGreaterThan(0);
    expect(t.refused).toBeGreaterThan(0);
    console.log(`[parity] moves: ${t.total} commands, ${t.ok} applied, ${t.refused} refused, 0 mismatches`);
  });

  it('sell refunds exactly the previewed (depreciated) value and undo re-charges it', () => {
    const sim = realSim();
    const objs = (Object.values(sim.state.objects) as ObjectState[]).filter((o) => ['floor', 'wall', 'opening'].includes(o.placement.kind));
    let sold = 0;
    for (const o of objs) {
      const cmd: BuildCommand = { type: 'sell', objectId: o.id };
      const f0 = funds(sim);
      const p = sim.build.preview(cmd);
      const r = sim.dispatch({ type: 'build', cmd });
      expect(r.ok, o.defId).toBe(p.ok);
      if (!r.ok) continue;
      sold++;
      const refund = resaleValue(o.value, specOf(sim.content, o.defId));
      expect(p.cost, o.defId).toBe(refund > 0 ? -refund : 0);
      expect(funds(sim) - f0, o.defId).toBe(refund);
      expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
      expect(funds(sim)).toBe(f0);
      expect(sim.state.objects[o.id]).toBeTruthy();
      expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
      expect(funds(sim) - f0).toBe(refund);
      expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    }
    expect(sold).toBeGreaterThan(5);
  });
});
