import { describe, expect, it, vi } from 'vitest';
import { PointerGestures, type PointerEventLike } from '../../../src/game/input/pointer';
import { CameraController } from '../../../src/game/input/camera';
import { LiveInput } from '../../../src/game/input/live';
import type { InputHost, ModeHandler, PointerPos } from '../../../src/game/input/types';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { legacyTown } from '../../../src/shared/town';
import { FakeRenderer, FakeSim, makeWorld, point } from './fakes';

const mods = { shift: false, ctrl: false, alt: false };
const pos: PointerPos = { cx: 100, cy: 100, vx: 100, vy: 100 };
function fixture() {
  const sim = new FakeSim(makeWorld()); sim.state.town = legacyTown(7, 0);
  const renderer = new FakeRenderer();
  let selected: string | null = 'a1';
  const walkTo = vi.fn((id, target) => ({ ok: true as const, target, portals: [], lengthTiles: 1, etaGameMin: 1 }));
  const openMenuFor = vi.fn(), toast = vi.fn();
  const host: InputHost = {
    renderer, sim: () => sim, settings: () => DEFAULT_SETTINGS,
    setHoverLabel() {}, setGridHover() {}, setBuildPreviewLabel() {}, toast, sfx() {}, changed() {},
    selectedAgentId: () => selected, selectAgent: id => { selected = id; }, walkTo,
    openMenuFor, openPetMenu: vi.fn(), closeMenu: () => false, isMenuOpen: () => false, applyBuild: () => false, placeCopy() {},
  };
  const live = new LiveInput(host);
  return { sim, renderer, live, walkTo, openMenuFor, toast, select: (id: string | null) => { selected = id; } };
}

describe('ordinary world-ground input', () => {
  it.each(['mouse', 'touch'])('%s forwards the real region-local pick once to the journaled walk port', pointerType => {
    const t = fixture(), target = { regionId: 'street:mildew:2', x: 14, z: 2 };
    t.renderer.pickResult = { kind: 'worldTile', target, world: { x: 84, z: 32 }, what: 'ground', point: point() };
    t.live.primaryDown(); t.live.click({ ...pos, pointerType }, mods);
    expect(t.walkTo.mock.calls).toEqual([['a1', target]]); expect(t.openMenuFor).not.toHaveBeenCalled();
  });
  it('touch home ground walks directly; desktop keeps the home interaction menu', () => {
    const t = fixture(); t.renderer.pickResult = { kind: 'tile', x: 14, z: 26, point: point() };
    t.live.primaryDown(); t.live.click({ ...pos, pointerType: 'touch' }, mods);
    expect(t.walkTo).toHaveBeenCalledWith('a1', { regionId: t.sim.state.town!.homeLotId, x: 14, z: 26 });
    t.live.primaryDown(); t.live.click({ ...pos, pointerType: 'mouse' }, mods);
    expect(t.openMenuFor).toHaveBeenCalledTimes(1);
  });
  it('desktop home ground names the home region when the selected member is away', () => {
    const t = fixture(); t.sim.state.agents.a1.regionId = 'street:mildew:2';
    t.renderer.pickResult = { kind: 'tile', x: 13, z: 28, point: point() };
    t.live.primaryDown(); t.live.click({ ...pos, pointerType: 'mouse' }, mods);
    expect(t.walkTo).toHaveBeenCalledWith('a1', { regionId: t.sim.state.town!.homeLotId, x: 13, z: 28 });
    expect(t.openMenuFor).not.toHaveBeenCalled();
  });
  it('a selection change during the gesture cannot order the replacement actor', () => {
    const t = fixture(); t.renderer.pickResult = { kind: 'worldTile', target: { regionId: 'street:mildew:2', x: 14, z: 2 }, world: { x: 84, z: 32 }, what: 'ground', point: point() };
    t.live.primaryDown(); t.select('a2'); t.live.click({ ...pos, pointerType: 'touch' }, mods);
    expect(t.walkTo).not.toHaveBeenCalled();
  });
  it('missing selection gives feedback; touching an object still opens its interactions', () => {
    const t = fixture(); t.renderer.pickResult = { kind: 'worldTile', target: { regionId: 'street:mildew:2', x: 14, z: 2 }, world: { x: 84, z: 32 }, what: 'ground', point: point() };
    t.select(null); t.live.primaryDown(); t.live.click({ ...pos, pointerType: 'touch' }, mods);
    expect(t.walkTo).not.toHaveBeenCalled(); expect(t.toast).toHaveBeenCalled();
    t.select('a1'); t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    t.live.primaryDown(); t.live.click({ ...pos, pointerType: 'touch' }, mods);
    expect(t.openMenuFor).toHaveBeenCalledWith({ kind: 'object', id: 'o1' }, 100, 100);
  });
});

function gestures() {
  const renderer = new FakeRenderer(), click = vi.fn();
  const handler: ModeHandler = { primaryDown: () => 'deferred', click, hover() {}, toolMove() {}, toolEnd() {}, toolCancel() {}, secondaryClick() {}, doubleClick() {}, escape: () => false, reset() {} };
  const g = new PointerGestures({ handler: () => handler, camera: new CameraController(renderer, () => DEFAULT_SETTINGS, () => {}), canvasOrigin: () => ({ left: 0, top: 0 }), spaceHeld: () => false, spaceUsed() {}, onError(_where, error) { throw error; }, now: () => 1000 });
  const ev = (timeStamp: number, x = 100, pointerId = 1): PointerEventLike => ({ pointerId, button: 0, clientX: x, clientY: 100, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, pointerType: 'touch', timeStamp });
  return { g, click, ev };
}

describe('world touch admission uses the canonical gesture contract', () => {
  it.each([100, 350])('a %i ms tap admits exactly one click and retains the touch kind', ms => {
    const t = gestures(); t.g.down(t.ev(1000)); t.g.up(t.ev(1000 + ms));
    expect(t.click).toHaveBeenCalledTimes(1); expect(t.click.mock.calls[0][0].pointerType).toBe('touch');
  });
  it.each([351, 500, 1000])('a %i ms hold cannot become a walk', ms => {
    const t = gestures(); t.g.down(t.ev(1000)); t.g.up(t.ev(1000 + ms)); expect(t.click).not.toHaveBeenCalled();
  });
  it('10 px is a tap; a far release without moves is a pan and starts the 300 ms guard', () => {
    const t = gestures(); t.g.down(t.ev(1000)); t.g.up(t.ev(1100, 110)); expect(t.click).toHaveBeenCalledTimes(1);
    t.g.down(t.ev(1500)); t.g.up(t.ev(1600, 111));
    t.g.down(t.ev(1899)); t.g.up(t.ev(1900)); expect(t.click).toHaveBeenCalledTimes(1);
    t.g.down(t.ev(1900)); t.g.up(t.ev(1950)); expect(t.click).toHaveBeenCalledTimes(2);
  });
  it('pinch lifts and a following tap inside the guard enqueue nothing; a later tap works', () => {
    const t = gestures(); t.g.down(t.ev(1000)); t.g.down(t.ev(1010, 200, 2));
    t.g.up(t.ev(1050, 200, 2)); t.g.up(t.ev(1060));
    t.g.down(t.ev(1359)); t.g.up(t.ev(1400)); expect(t.click).not.toHaveBeenCalled();
    t.g.down(t.ev(1400)); t.g.up(t.ev(1450)); expect(t.click).toHaveBeenCalledTimes(1);
  });
  it('a cancelled touch never clicks and all-pointer blur clears stale fingers', () => {
    const t = gestures(); t.g.down(t.ev(1000)); t.g.cancel(); t.g.up(t.ev(1100)); expect(t.click).not.toHaveBeenCalled();
    t.g.down(t.ev(1500, 100, 2)); t.g.up(t.ev(1550, 100, 2)); expect(t.click).toHaveBeenCalledTimes(1);
  });
  it.each(['reversed time', 'invalid time', 'invalid coordinates'])('a later valid move cannot hide %s earlier in the gesture', defect => {
    const t = gestures(); t.g.down(t.ev(1000));
    t.g.move(defect === 'reversed time' ? t.ev(990) : defect === 'invalid time' ? t.ev(NaN) : t.ev(1010, NaN));
    t.g.move(t.ev(1050)); t.g.up(t.ev(1100)); expect(t.click).not.toHaveBeenCalled();
  });
  it('a finger crossing onto the HUD cancels the world finger and guards a subsequent lift/tap', () => {
    const t = gestures(); t.g.down(t.ev(1000)); t.g.guardTouch(); t.g.up(t.ev(1100));
    t.g.down(t.ev(1299)); t.g.up(t.ev(1350)); expect(t.click).not.toHaveBeenCalled();
    t.g.down(t.ev(1600)); t.g.up(t.ev(1650)); expect(t.click).toHaveBeenCalledTimes(1);
  });
});
