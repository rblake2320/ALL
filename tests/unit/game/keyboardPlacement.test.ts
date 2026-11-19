/**
 * W-064 / Sol W-023 A1: Buy-mode placement must work from the keyboard alone (WCAG 2.1.1).
 *
 * Reproduces Sol's failing route (select a catalog item, return focus to the world, arrows + Enter / Space) against
 * the REAL controller and input stack over fakes: arrows move the ghost tile by tile (camera-relative), Enter / Space
 * place, R rotates, Esc cancels, refusals (collision / doorway) are announced with their reason, and a real pointer
 * move hands the ghost back to the mouse. Announcements go through GameController.placementAnnouncement.
 */
import { describe, expect, it } from 'vitest';
import type { BuildCommand, PlacementResult } from '../../../src/sim/contracts';
import { clampTile, gridStepForScreen, tileEdge } from '../../../src/game/input/grid';
import { startedHarness, type Harness } from './controllerHarness';

async function placing(defId = 'chair_creaky'): Promise<{ h: Harness; applied: { readonly list: BuildCommand[] } }> {
  const h = await startedHarness();
  const sim = h.gameSim();
  h.game.startPlacing(defId);
  await h.frames(1);
  // build commands reach the sim as dispatch({ type: 'build', cmd }) — the same path a mouse click takes
  const applied = {
    get list(): BuildCommand[] {
      return sim.dispatched.flatMap((c) => (c.type === 'build' ? [(c as { cmd: BuildCommand }).cmd] : []));
    },
  };
  return { h, applied };
}

const said = (h: Harness) => h.game.placementAnnouncement?.text ?? '';

describe('grid helpers for keyboard placement', () => {
  it('arrow steps follow the camera (yaw 0 = viewed from +Z)', () => {
    expect(gridStepForScreen(0, 'up')).toEqual({ x: 0, z: -1 });
    expect(gridStepForScreen(0, 'down')).toEqual({ x: 0, z: 1 });
    expect(gridStepForScreen(0, 'right')).toEqual({ x: 1, z: 0 });
    expect(gridStepForScreen(0, 'left')).toEqual({ x: -1, z: 0 });
    // quarter turn: "up the screen" is now −X
    expect(gridStepForScreen(Math.PI / 2, 'up')).toEqual({ x: -1, z: 0 });
    expect(gridStepForScreen(Math.PI / 2, 'right')).toEqual({ x: 0, z: -1 });
  });

  it('diagonal views step diagonally so ↑ and → stay perpendicular on screen', () => {
    const up = gridStepForScreen(Math.PI / 4, 'up');
    const right = gridStepForScreen(Math.PI / 4, 'right');
    expect(up).toEqual({ x: -1, z: -1 });
    expect(right).toEqual({ x: 1, z: -1 });
    expect(up.x * right.x + up.z * right.z).toBe(0);
  });

  it('never yields a zero step and survives garbage yaw', () => {
    for (let a = -7; a <= 7; a += 0.05) {
      for (const d of ['up', 'down', 'left', 'right'] as const) {
        const s = gridStepForScreen(a, d);
        expect(Math.abs(s.x) + Math.abs(s.z)).toBeGreaterThan(0);
      }
    }
    expect(gridStepForScreen(Number.NaN, 'up')).toEqual({ x: 0, z: -1 });
  });

  it('tileEdge picks the four edges of a tile with the tile on the inner side', () => {
    expect(tileEdge(3, 4, 0)).toEqual({ edge: 'h:3:4', side: 1 });
    expect(tileEdge(3, 4, 1)).toEqual({ edge: 'v:4:4', side: 0 });
    expect(tileEdge(3, 4, 2)).toEqual({ edge: 'h:3:5', side: 0 });
    expect(tileEdge(3, 4, 3)).toEqual({ edge: 'v:3:4', side: 1 });
  });

  it('clampTile keeps the cursor on the lot', () => {
    expect(clampTile({ x: -3, z: 40 }, 30, 30)).toEqual({ x: 0, z: 29 });
    expect(clampTile({ x: Number.NaN, z: 2.6 }, 30, 30)).toEqual({ x: 0, z: 3 });
    expect(clampTile({ x: 5, z: 5 }, 0, Number.NaN)).toEqual({ x: 0, z: 0 });
  });
});

describe('Buy mode: keyboard placement (Sol W-023 A1 repro)', () => {
  it('announces the start of placement with the keyboard instructions', async () => {
    const { h } = await placing();
    expect(said(h)).toMatch(/^Placing .+\. Arrow keys move it, R rotates, Enter or Space places one, Shift\+Enter places and keeps placing, Escape cancels\.$/);
  });

  it('arrows move the ghost tile by tile and Enter places it; funds path = the same build command as a click', async () => {
    const { h, applied } = await placing();
    const first = h.key('keydown', 'ArrowRight');
    expect(first.defaultPrevented).toBe(true);
    // first press: the cursor appears at the camera focus (15,15) without moving, and says where it is
    expect(h.game.gridHover).toEqual({ x: 15, z: 15, edge: null });
    expect(said(h)).toContain('at tile 15, 15');
    expect(said(h)).toContain('Can place here for $120');
    h.key('keydown', 'ArrowRight');
    h.key('keydown', 'ArrowDown');
    expect(h.game.gridHover).toEqual({ x: 16, z: 16, edge: null });
    expect(h.renderer.ghost).toMatchObject({ defId: 'chair_creaky', valid: true });
    // arrows did not pan the camera while placing
    await h.frames(3);
    expect(h.renderer.count('panWorld')).toBe(0);
    const enter = h.key('keydown', 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(applied.list).toHaveLength(1);
    expect(applied.list[0]).toMatchObject({ type: 'buy', defId: 'chair_creaky', rot: 0 });
    expect(said(h)).toMatch(/^Placed .+ for \$120\. Back to the catalog\./);
    // W-116 (D-062): one item placed → back to the catalog (same as the mouse flow), the item still highlighted
    expect(h.game.buy.placingDefId).toBeNull();
    expect(h.game.buy.lastDefId).toBe('chair_creaky');
  });

  it('W-116: Shift+Enter places and keeps placing (the keyboard twin of Shift+click)', async () => {
    const { h, applied } = await placing();
    h.key('keydown', 'ArrowRight');
    h.key('keydown', 'Enter', { shiftKey: true });
    expect(applied.list).toHaveLength(1);
    expect(h.game.buy.placingDefId).toBe('chair_creaky');
    expect(said(h)).toMatch(/Still placing/);
    h.key('keydown', 'ArrowRight');
    h.key('keydown', 'Enter');
    expect(applied.list).toHaveLength(2);
    expect(h.game.buy.placingDefId).toBeNull();
  });

  it('Shift+arrow moves four tiles; the cursor is clamped to the lot', async () => {
    const { h } = await placing();
    h.key('keydown', 'ArrowLeft');
    for (let i = 0; i < 6; i++) h.key('keydown', 'ArrowLeft', { shiftKey: true });
    expect(h.game.gridHover).toEqual({ x: 0, z: 15, edge: null });
  });

  it('a refused spot announces its reason (collision / doorway) and Enter does not buy', async () => {
    const { h, applied } = await placing();
    const sim = h.gameSim();
    const blocked: PlacementResult = { ok: false, reason: 'Blocks a doorway', tiles: [{ x: 15, z: 15 }], blockedSlots: [], cost: 0 };
    sim.placeResult = blocked;
    h.key('keydown', 'ArrowUp');
    expect(said(h)).toContain("Can't place here: Blocks a doorway.");
    expect(h.renderer.ghost).toMatchObject({ valid: false });
    h.key('keydown', 'Enter');
    expect(applied.list).toHaveLength(0);
    expect(said(h)).toBe("Can't place here: Blocks a doorway.");
  });

  it('R rotates the keyboard ghost and announces it; Esc cancels and says so', async () => {
    const { h } = await placing();
    h.key('keydown', 'ArrowUp');
    h.key('keydown', 'KeyR');
    expect(h.game.buy.rot).toBe(1);
    expect(said(h)).toMatch(/^Rotated to 90 degrees\. Can place here/);
    expect(h.renderer.ghost).toMatchObject({ rot: 1 });
    h.key('keydown', 'Escape');
    expect(h.game.buy.placingDefId).toBeNull();
    expect(said(h)).toMatch(/^Stopped placing /);
    expect(h.renderer.ghost).toBeNull();
  });

  it('Space places once the keyboard cursor is out, and does not toggle pause', async () => {
    const { h, applied } = await placing();
    const speed = h.game.speed;
    h.key('keydown', 'ArrowUp');
    h.key('keydown', 'Space');
    h.key('keyup', 'Space');
    expect(applied.list).toHaveLength(1);
    expect(h.game.speed).toBe(speed);
  });

  it('without the keyboard cursor Space keeps its pause meaning; Enter first shows the cursor instead of buying blind', async () => {
    const { h, applied } = await placing();
    const speed = h.game.speed;
    h.key('keydown', 'Space');
    h.key('keyup', 'Space');
    expect(h.game.speed).not.toBe(speed);
    expect(applied.list).toHaveLength(0);
    h.key('keydown', 'Enter');
    expect(applied.list).toHaveLength(0);
    expect(said(h)).toContain('at tile 15, 15');
    h.key('keydown', 'Enter');
    expect(applied.list).toHaveLength(1);
  });

  it('wall items use the tile edge picked by R', async () => {
    const { h, applied } = await placing('painting_greatgrand');
    h.key('keydown', 'ArrowUp');
    expect(h.game.gridHover).toEqual({ x: 15, z: 15, edge: 'h:15:15' });
    h.key('keydown', 'KeyR');
    expect(h.game.gridHover).toEqual({ x: 15, z: 15, edge: 'v:16:15' });
    h.key('keydown', 'Enter');
    expect(applied.list[0]).toMatchObject({ type: 'buyWallItem', defId: 'painting_greatgrand', edge: 'v:16:15', side: 0 });
  });

  it('a real pointer move hands the ghost back to the mouse', async () => {
    const { h } = await placing();
    h.key('keydown', 'ArrowUp');
    expect(h.game.gridHover).toEqual({ x: 15, z: 15, edge: null });
    h.renderer.gridResult = { x: 6, z: 6, fx: 6.5, fz: 6.5, edge: null, edgeSide: 0 };
    h.pointer('pointermove', 300, 300, { movementX: 4, movementY: 0 });
    await h.frames(1);
    expect(h.game.gridHover).toEqual({ x: 6, z: 6, edge: null });
    // Space is pause again (keyboard cursor gone)
    const speed = h.game.speed;
    h.key('keydown', 'Space');
    h.key('keyup', 'Space');
    expect(h.game.speed).not.toBe(speed);
  });

  it('the camera follows a keyboard ghost that leaves the screen', async () => {
    const { h } = await placing();
    h.renderer.camera.target = { x: 0, z: 15 }; // the fake reports |x − target.x| ≥ 16 as off-screen
    h.key('keydown', 'ArrowUp');
    expect(h.game.gridHover).toEqual({ x: 0, z: 15, edge: null });
    const before = h.renderer.count('focus');
    for (let i = 0; i < 5; i++) h.key('keydown', 'ArrowRight', { shiftKey: true });
    expect(h.renderer.count('focus')).toBeGreaterThan(before);
  });

  it('arrows still pan the camera when nothing is being placed', async () => {
    const h = await startedHarness();
    h.game.setMode('buy');
    await h.frames(1);
    const e = h.key('keydown', 'ArrowRight');
    await h.frames(3);
    h.key('keyup', 'ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(h.renderer.count('panWorld')).toBeGreaterThan(0);
    expect(h.game.placementAnnouncement ?? null).toBeNull();
  });

  it('keys typed in a text field never move the ghost', async () => {
    const { h, applied } = await placing();
    const input = { tagName: 'INPUT', getAttribute: () => null, closest: () => null };
    const e = new Event('keydown', { cancelable: true });
    Object.assign(e, { code: 'Enter', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false });
    Object.defineProperty(e, 'target', { value: input });
    h.win.dispatchEvent(e);
    expect(applied.list).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });
});
