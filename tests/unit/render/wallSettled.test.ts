/**
 * W-115 test hooks: WallLayer.isSettled() (the e2e placement suite waits on it instead of a fixed 400 ms after a
 * wall-mode change) and the frame-budgeted wait decision the e2e harness uses (tests/e2e/lib/waits.mjs).
 *
 * The cutaway animation advances per RENDERED frame with dt clamped to 0.25 s, so on a software-rendered CI runner
 * (several seconds per frame) it spans many seconds of wall-clock time: "settled" must be game state, not a delay.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WallLayer } from '../../../src/render/build/walls';
import { wallAtlasLayout } from '../../../src/render/build/atlasLayout';
import type { LotState, WallSegment } from '../../../src/sim/types';
// @ts-expect-error -- plain .mjs helper shared with the browser e2e harness (no type declarations)
import { budgetExpired } from '../../e2e/lib/waits.mjs';

const seg = (): WallSegment => ({ paint: ['wall_plaster_bone', 'wall_exterior_siding'], openingId: null });

/** A 2×2 room: tiles [2,4)×[2,4). */
function lot(): LotState {
  const walls: Record<string, WallSegment> = {};
  for (const x of [2, 3]) {
    walls[`h:${x}:2`] = seg();
    walls[`h:${x}:4`] = seg();
  }
  for (const z of [2, 3]) {
    walls[`v:2:${z}`] = seg();
    walls[`v:4:${z}`] = seg();
  }
  return { walls, wallVersion: 1 } as unknown as LotState;
}

/** A WallLayer with its atlas injected (the real atlas paints a 2D canvas, which node has no DOM for). */
function layer(): WallLayer {
  const w = new WallLayer();
  const inner = w as unknown as { atlas: unknown; material: THREE.Material };
  inner.atlas = { canvas: null, layout: wallAtlasLayout(32) };
  inner.material = new THREE.MeshStandardMaterial();
  expect(w.sync(lot(), new Map(), 0)).toBe(true);
  return w;
}

/** View along +z (camera → target): the south walls (h:*:4, nearest the camera) are the ones cutaway lowers. */
const step = (w: WallLayer, mode: 'up' | 'cutaway' | 'down', dt = 0.25) => w.update(dt, mode, 0, 1, () => 0, 1);

describe('WallLayer.isSettled (W-115 e2e hook)', () => {
  it('an empty layer is settled in every mode', () => {
    const w = new WallLayer();
    expect(w.isSettled('up')).toBe(true);
    expect(w.isSettled('cutaway')).toBe(true);
  });

  it('is not settled until the mode was applied and the height animation finished', () => {
    const w = layer();
    // freshly built: the mode has not been applied by a frame yet
    expect(w.isSettled('up')).toBe(false);
    step(w, 'up'); // walls start at full height: nothing to animate
    expect(w.isSettled('up')).toBe(true);
    expect(w.isSettled('cutaway')).toBe(false); // the hook answers for the mode asked about
    // switch to walls down: the first frame starts the animation, it is not settled after one 0.25 s frame
    step(w, 'down');
    expect(w.isSettled('down')).toBe(false);
    const h0 = w.heightOf('h:2:4');
    let frames = 1;
    while (!w.isSettled('down') && frames < 200) {
      step(w, 'down');
      frames++;
    }
    expect(w.isSettled('down')).toBe(true);
    expect(frames).toBeGreaterThan(2); // the animation spans several rendered frames, however long each one takes
    expect(w.heightOf('h:2:4')).toBeLessThan(h0);
  });

  it('a ghost raising one wall un-settles the layer until that wall is back up', () => {
    const w = layer();
    for (let i = 0; i < 200 && !w.isSettled('down'); i++) step(w, 'down');
    expect(w.isSettled('down')).toBe(true);
    w.setRaised('h:2:4');
    expect(w.isSettled('down')).toBe(false);
    for (let i = 0; i < 200 && !w.isSettled('down'); i++) step(w, 'down');
    expect(w.isSettled('down')).toBe(true);
    expect(w.heightOf('h:2:4')).toBeGreaterThan(w.heightOf('h:3:4'));
  });
});

describe('frame-budgeted e2e waits (tests/e2e/lib/waits.mjs)', () => {
  const o = { minMs: 15_000, minFrames: 12, capMs: 480_000 };
  it('never gives up before the wall-clock minimum, however many frames were drawn', () => {
    expect(budgetExpired({ ...o, elapsedMs: 5_000, frames: 500 })).toBe(false);
  });
  it('does not give up after the old fixed timeout when the game drew too few frames (slow CI runner)', () => {
    // the CI failures: 15 s passed but the page had rendered only 2 frames since the key press
    expect(budgetExpired({ ...o, elapsedMs: 15_001, frames: 2 })).toBe(false);
    expect(budgetExpired({ ...o, elapsedMs: 120_000, frames: 11 })).toBe(false);
  });
  it('gives up once both the time and the frame budget are spent, or at the hard cap', () => {
    expect(budgetExpired({ ...o, elapsedMs: 15_000, frames: 12 })).toBe(true);
    expect(budgetExpired({ ...o, elapsedMs: 480_000, frames: 0 })).toBe(true);
  });
});
