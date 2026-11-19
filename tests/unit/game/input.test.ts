import { describe, expect, it } from 'vitest';
import { PointerGestures, type GestureSink, type PointerEventLike } from '../../../src/game/input/pointer';
import { CameraController } from '../../../src/game/input/camera';
import { BuyInput } from '../../../src/game/input/buy';
import { BuildInput, existingWalls, sanitizeBuildTool } from '../../../src/game/input/build';
import { LiveInput } from '../../../src/game/input/live';
import type { InputHost, ModeHandler, Mods, PointerPos } from '../../../src/game/input/types';
import type { BuildCommand } from '../../../src/sim/contracts';
import type { TargetRef } from '../../../src/sim/types';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { FakeRenderer, FakeSim, makeWorld, point } from './fakes';

// ───────────────────────── gestures ─────────────────────────

class RecordingHandler implements ModeHandler {
  log: string[] = [];
  tool = false;
  hover(): void {
    this.log.push('hover');
  }
  primaryDown(p: PointerPos): 'tool' | 'deferred' {
    this.log.push(`down@${p.cx},${p.cy}`);
    return this.tool ? 'tool' : 'deferred';
  }
  toolMove(p: PointerPos): void {
    this.log.push(`toolMove@${p.cx}`);
  }
  toolEnd(p: PointerPos, _m: Mods, moved: boolean): void {
    this.log.push(`toolEnd@${p.cx}:${moved}`);
  }
  toolCancel(): void {
    this.log.push('toolCancel');
  }
  click(p: PointerPos, m: Mods): void {
    this.log.push(`click@${p.cx}${m.shift ? '+shift' : ''}`);
  }
  secondaryClick(): void {
    this.log.push('rightClick');
  }
  doubleClick(): void {
    this.log.push('dblclick');
  }
  escape(): boolean {
    return false;
  }
  reset(): void {}
}

function gestures() {
  const renderer = new FakeRenderer();
  const camera = new CameraController(renderer, () => DEFAULT_SETTINGS, () => undefined);
  const handler = new RecordingHandler();
  let space = false;
  let spaceUsed = false;
  let enabled = true;
  const sink: GestureSink = {
    handler: () => (enabled ? handler : null),
    camera,
    canvasOrigin: () => ({ left: 10, top: 20 }),
    spaceHeld: () => space,
    spaceUsed: () => (spaceUsed = true),
    onError: () => undefined,
  };
  const g = new PointerGestures(sink);
  const ev = (over: Partial<PointerEventLike>): PointerEventLike => ({ pointerId: 1, button: 0, clientX: 110, clientY: 120, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, pointerType: 'mouse', ...over });
  return { g, renderer, handler, ev, setSpace: (v: boolean) => (space = v), wasSpaceUsed: () => spaceUsed, disable: () => (enabled = false) };
}

describe('PointerGestures', () => {
  it('left click (no movement) → click with canvas-relative coords', () => {
    const t = gestures();
    t.g.down(t.ev({}));
    t.g.up(t.ev({}));
    expect(t.handler.log).toEqual(['down@100,100', 'click@100']);
  });

  it('left drag past the threshold pans the camera instead of clicking', () => {
    const t = gestures();
    t.g.down(t.ev({}));
    t.g.move(t.ev({ clientX: 113 })); // under threshold
    t.g.move(t.ev({ clientX: 140 }));
    t.g.up(t.ev({ clientX: 140 }));
    expect(t.handler.log).toEqual(['down@100,100']);
    expect(t.renderer.count('pan')).toBe(1);
    expect(t.renderer.last('pan')!.args).toEqual([30, 0]); // whole movement since press, no jump
  });

  it('right drag orbits, right click cancels, shift+right drag pans, middle pans', () => {
    const t = gestures();
    t.g.down(t.ev({ button: 2 }));
    t.g.move(t.ev({ button: 2, clientX: 160 }));
    t.g.up(t.ev({ button: 2, clientX: 160 }));
    expect(t.renderer.count('orbit')).toBe(1);
    t.g.down(t.ev({ button: 2 }));
    t.g.up(t.ev({ button: 2 }));
    expect(t.handler.log).toContain('rightClick');
    t.g.down(t.ev({ button: 2, shiftKey: true }));
    t.g.move(t.ev({ button: 2, clientX: 180 }));
    t.g.up(t.ev({ button: 2 }));
    expect(t.renderer.count('pan')).toBe(1);
    t.g.down(t.ev({ button: 1 }));
    t.g.move(t.ev({ button: 1, clientY: 150 }));
    t.g.up(t.ev({ button: 1 }));
    expect(t.renderer.count('pan')).toBe(2);
  });

  it('space + left drag pans and marks space as used (so releasing it will not toggle pause)', () => {
    const t = gestures();
    t.setSpace(true);
    t.g.down(t.ev({}));
    t.g.move(t.ev({ clientX: 150 }));
    t.g.up(t.ev({ clientX: 150 }));
    expect(t.wasSpaceUsed()).toBe(true);
    expect(t.handler.log).toEqual([]);
    expect(t.renderer.count('pan')).toBeGreaterThan(0);
  });

  it('tool drags: start on press, move, end with moved flag; cancel never applies', () => {
    const t = gestures();
    t.handler.tool = true;
    t.g.down(t.ev({}));
    t.g.move(t.ev({ clientX: 150 }));
    t.g.up(t.ev({ clientX: 150 }));
    expect(t.handler.log).toEqual(['down@100,100', 'toolMove@140', 'toolEnd@140:true']);
    t.handler.log = [];
    t.g.down(t.ev({}));
    t.g.cancel(1);
    t.g.up(t.ev({}));
    expect(t.handler.log).toEqual(['down@100,100', 'toolCancel']);
  });

  it('only one session at a time; a second button mid-drag is ignored', () => {
    const t = gestures();
    t.g.down(t.ev({}));
    expect(t.g.down(t.ev({ button: 2, pointerId: 2 }))).toBe(false);
    t.g.up(t.ev({}));
    expect(t.handler.log.filter((l) => l.startsWith('click')).length).toBe(1);
  });

  it('nothing happens when input is disabled (dialog open / not in game)', () => {
    const t = gestures();
    t.disable();
    expect(t.g.down(t.ev({}))).toBe(false);
    t.g.up(t.ev({}));
    expect(t.handler.log).toEqual([]);
  });

  it('NaN coordinates are ignored', () => {
    const t = gestures();
    expect(t.g.down(t.ev({ clientX: NaN }))).toBe(false);
  });

  it('two-finger touch pinches (zoom) and cancels a one-finger tool drag', () => {
    const t = gestures();
    t.handler.tool = true;
    t.g.down(t.ev({ pointerType: 'touch', pointerId: 1, clientX: 100 }));
    t.g.down(t.ev({ pointerType: 'touch', pointerId: 2, clientX: 200 }));
    expect(t.handler.log).toContain('toolCancel');
    t.g.move(t.ev({ pointerType: 'touch', pointerId: 2, clientX: 300 }));
    expect(t.renderer.count('zoom')).toBe(1);
    expect(t.renderer.last('zoom')!.args[0] as number).toBeGreaterThan(0); // fingers apart → closer
  });

  it('hover is requested at most once per frame', () => {
    const t = gestures();
    t.g.move(t.ev({ clientX: 120 }));
    t.g.move(t.ev({ clientX: 130 }));
    expect(t.g.takeHoverDirty()).toBe(true);
    expect(t.g.takeHoverDirty()).toBe(false);
  });
});

// ───────────────────────── host fake ─────────────────────────

function host(sim: FakeSim | null = new FakeSim(makeWorld())) {
  const renderer = new FakeRenderer();
  const log = {
    builds: [] as BuildCommand[],
    menus: [] as { target: TargetRef; x: number; y: number }[],
    selected: [] as (string | null)[],
    toasts: [] as string[],
    sfx: [] as string[],
    labels: [] as (string | null)[],
    hover: [] as (string | null)[],
    placeCopy: [] as string[],
  };
  let selected: string | null = 'a1';
  let menuOpen = false;
  let buildOk = true;
  const h: InputHost = {
    renderer,
    openPetMenu: () => undefined,
    sim: () => sim,
    settings: () => DEFAULT_SETTINGS,
    setHoverLabel: (l) => log.hover.push(l),
    setGridHover: () => undefined,
    setBuildPreviewLabel: (l) => log.labels.push(l),
    toast: (_k, t) => log.toasts.push(t),
    sfx: (id) => log.sfx.push(id),
    changed: () => undefined,
    selectedAgentId: () => selected,
    selectAgent: (id) => {
      selected = id;
      log.selected.push(id);
    },
    openMenuFor: (target, x, y) => {
      menuOpen = true;
      log.menus.push({ target, x, y });
    },
    closeMenu: () => {
      const was = menuOpen;
      menuOpen = false;
      return was;
    },
    isMenuOpen: () => menuOpen,
    applyBuild: (cmd) => {
      log.builds.push(cmd);
      return buildOk;
    },
    placeCopy: (defId) => log.placeCopy.push(defId),
  };
  return { h, renderer, log, sim: sim!, setSelected: (s: string | null) => (selected = s), setBuildOk: (v: boolean) => (buildOk = v) };
}

const P = (cx: number, cy: number): PointerPos => ({ cx, cy, vx: cx + 5, vy: cy + 5 });
const NOM: Mods = { shift: false, ctrl: false, alt: false };

describe('LiveInput', () => {
  it('clicking an object with a selected zombie opens the menu at the cursor (viewport coords)', () => {
    const t = host();
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    new LiveInput(t.h).click(P(50, 60), NOM);
    expect(t.log.menus).toEqual([{ target: { kind: 'object', id: 'o1' }, x: 55, y: 65 }]);
  });

  it('a click while a menu is open only closes it', () => {
    const t = host();
    const live = new LiveInput(t.h);
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    live.click(P(1, 1), NOM);
    live.click(P(2, 2), NOM);
    expect(t.log.menus.length).toBe(1);
  });

  it('household zombie: select when nothing selected / with shift; self → self menu; other → social menu', () => {
    const t = host();
    const live = new LiveInput(t.h);
    t.setSelected(null);
    t.renderer.pickResult = { kind: 'agent', agentId: 'a2', point: point() };
    live.click(P(0, 0), NOM);
    expect(t.log.selected).toEqual(['a2']);
    live.click(P(0, 0), NOM);
    expect(t.log.menus.at(-1)!.target).toEqual({ kind: 'self' });
    t.h.closeMenu();
    t.renderer.pickResult = { kind: 'agent', agentId: 'a1', point: point() };
    live.click(P(0, 0), NOM);
    expect(t.log.menus.at(-1)!.target).toEqual({ kind: 'agent', id: 'a1' });
    t.h.closeMenu();
    live.click(P(0, 0), { ...NOM, shift: true });
    expect(t.log.selected.at(-1)).toBe('a1');
  });

  it('ground click → tile menu (Go Here); nothing selected → helpful toast, no menu', () => {
    const t = host();
    const live = new LiveInput(t.h);
    t.renderer.pickResult = { kind: 'tile', x: 4, z: 9, point: point() };
    live.click(P(0, 0), NOM);
    expect(t.log.menus[0].target).toEqual({ kind: 'tile', x: 4, z: 9 });
    t.h.closeMenu();
    t.setSelected(null);
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    live.click(P(0, 0), NOM);
    expect(t.log.toasts).toContain('Select a zombie first');
    expect(t.log.menus.length).toBe(1);
  });

  it('hover labels for agents and objects', () => {
    const t = host();
    const live = new LiveInput(t.h);
    t.renderer.pickResult = { kind: 'agent', agentId: 'a99', point: point() };
    live.hover(P(0, 0));
    expect(t.log.hover.at(-1)).toBe('Visitor Rotwell (visitor)');
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    live.hover(P(0, 0));
    expect(t.log.hover.at(-1)).toBe(t.sim.objectView('o1')!.name);
    t.renderer.pickResult = { kind: 'none' };
    live.hover(P(0, 0));
    expect(t.log.hover.at(-1)).toBeNull();
  });

  it('double-click a household zombie selects + focuses', () => {
    const t = host();
    t.renderer.pickResult = { kind: 'agent', agentId: 'a2', point: point() };
    new LiveInput(t.h).doubleClick(P(0, 0));
    expect(t.log.selected).toEqual(['a2']);
  });
});

describe('BuyInput', () => {
  it('ghost follows pickGrid, centred footprint, validity from checkPlace', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    expect(buy.startPlacing('sofa_moldy')).toBe(true);
    t.renderer.gridResult = { x: 10, z: 10, fx: 10.4, fz: 10.6, edge: null, edgeSide: 0 };
    buy.hover(P(0, 0));
    expect(t.renderer.ghost).toMatchObject({ defId: 'sofa_moldy', valid: true, rot: 0 });
    expect(t.log.labels.at(-1)).toBe('$120');
    t.sim.placeResult = { ok: false, reason: "Can't place over a wall", tiles: [], blockedSlots: [], cost: 0 };
    buy.refresh();
    expect(t.renderer.ghost!.valid).toBe(false);
    expect(t.log.labels.at(-1)).toBe("Can't place over a wall");
  });

  it('W-116: a click places ONE item and returns to the catalog (item kept highlighted); invalid click only plays the error sound', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    buy.startPlacing('chair_creaky', '#5a1c2a');
    t.renderer.gridResult = { x: 3, z: 4, fx: 3.5, fz: 4.5, edge: null, edgeSide: 0 };
    t.sim.placeResult = { ok: false, reason: 'Blocked', tiles: [], blockedSlots: [], cost: 0 };
    buy.click(P(0, 0), NOM);
    expect(t.log.builds.length).toBe(0);
    expect(t.log.sfx).toContain('placeInvalid');
    expect(buy.state.placingDefId).toBe('chair_creaky'); // a refused click keeps placing
    t.sim.placeResult = { ok: true, tiles: [], blockedSlots: [], cost: 40 };
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toEqual([{ type: 'buy', defId: 'chair_creaky', x: 3, z: 4, rot: 0, tint: '#5a1c2a' }]);
    expect(buy.state.placingDefId).toBeNull();
    expect(buy.state.lastDefId).toBe('chair_creaky');
    expect(t.renderer.ghost).toBeNull();
    // the second click (the playtest bug) is now the hand tool over empty ground: it buys nothing
    buy.click(P(0, 0), NOM);
    expect(t.log.builds.length).toBe(1);
  });

  it('rotation wraps and refreshes the ghost', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    buy.startPlacing('sofa_moldy');
    t.renderer.gridResult = { x: 10, z: 10, fx: 10.5, fz: 10.5, edge: null, edgeSide: 0 };
    buy.hover(P(0, 0));
    buy.rotate(-1);
    expect(buy.state.rot).toBe(3);
    expect(t.renderer.ghost!.rot).toBe(3);
    buy.rotate(1);
    buy.rotate(1);
    expect(buy.state.rot).toBe(1);
  });

  it('picking up an existing object hides it, moves it on the next valid click, Esc puts it back', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    buy.click(P(0, 0), NOM); // hand tool → pick up
    expect(buy.state.movingObjectId).toBe('o1');
    expect(t.renderer.hidden).toBe('o1');
    t.renderer.gridResult = { x: 7, z: 7, fx: 7.5, fz: 7.5, edge: null, edgeSide: 0 };
    buy.click(P(0, 0), NOM);
    expect(t.log.builds.at(-1)).toEqual({ type: 'move', objectId: 'o1', x: 7, z: 7, rot: 0 });
    expect(buy.state.movingObjectId).toBeNull();
    expect(t.renderer.hidden).toBeNull();
    buy.pickUp('o1');
    expect(buy.escape()).toBe(true);
    expect(t.renderer.hidden).toBeNull();
    expect(buy.escape()).toBe(false);
  });

  it('wall items and openings use checkWallItem / checkOpening and the edge under the cursor', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    buy.startPlacing('painting_greatgrand');
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 1, point: point() };
    buy.click(P(0, 0), NOM);
    expect(t.log.builds.at(-1)).toEqual({ type: 'buyWallItem', defId: 'painting_greatgrand', edge: 'h:8:8', side: 1, tint: null });
    buy.startPlacing('door_splintered');
    t.renderer.pickResult = { kind: 'none' };
    t.renderer.gridResult = { x: 4, z: 4, fx: 4.5, fz: 4.02, edge: 'h:4:4', edgeSide: 1 };
    buy.click(P(0, 0), NOM);
    expect(t.log.builds.at(-1)).toEqual({ type: 'buyOpening', defId: 'door_splintered', edge: 'h:4:4', tint: null });
  });

  it('refuses unknown / non-buyable defs and loose items; junk tints are dropped', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    expect(buy.startPlacing('item_meal')).toBe(false);
    expect(buy.startPlacing('nope')).toBe(false);
    buy.startPlacing('chair_creaky', 'javascript:alert(1)');
    expect(buy.state.tint).toBeNull();
  });

  it('Delete sells the carried object, else the hovered one; a vanished object cancels the move', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    buy.hover(P(0, 0));
    expect(buy.sellCurrent()).toBe(true);
    expect(t.log.builds.at(-1)).toEqual({ type: 'sell', objectId: 'o1' });
    buy.pickUp('o1');
    buy.objectRemoved('o1');
    expect(buy.state.movingObjectId).toBeNull();
    expect(t.renderer.hidden).toBeNull();
  });

  it('a throwing spatial check reads as invalid, never crashes', () => {
    const t = host();
    t.sim.spatial.checkPlace = () => {
      throw new Error('spatial bug');
    };
    const buy = new BuyInput(t.h);
    buy.startPlacing('chair_creaky');
    t.renderer.gridResult = { x: 3, z: 4, fx: 3.5, fz: 4.5, edge: null, edgeSide: 0 };
    expect(() => buy.click(P(0, 0), NOM)).not.toThrow();
    expect(t.log.builds).toEqual([]);
  });

  it('view() snapshot only changes when state changes', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    const v1 = buy.view();
    expect(buy.view()).toBe(v1);
    buy.setCategory('kitchen');
    expect(buy.view()).not.toBe(v1);
    expect(buy.view().category).toBe('kitchen');
  });
});

describe('W-116 placement state machine (D-062)', () => {
  const SHIFT: Mods = { shift: true, ctrl: false, alt: false };
  const start = () => {
    const t = host();
    const buy = new BuyInput(t.h);
    buy.startPlacing('chair_creaky');
    t.renderer.gridResult = { x: 3, z: 4, fx: 3.5, fz: 4.5, edge: null, edgeSide: 0 };
    return { t, buy };
  };

  it('place → exits placement (one build command per click)', () => {
    const { t, buy } = start();
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toHaveLength(1);
    expect(buy.isPlacing()).toBe(false);
  });

  it('Shift+click → places and STAYS in placement; a plain click after that places one more and exits', () => {
    const { t, buy } = start();
    buy.click(P(0, 0), SHIFT);
    buy.click(P(0, 0), SHIFT);
    expect(t.log.builds).toHaveLength(2);
    expect(buy.state.placingDefId).toBe('chair_creaky');
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toHaveLength(3);
    expect(buy.isPlacing()).toBe(false);
  });

  it('touch "Place another" toggle keeps placing like Shift; turning it off restores one-per-click', () => {
    const { t, buy } = start();
    buy.setKeepPlacing(true);
    expect(buy.view().keepPlacing).toBe(true);
    buy.click(P(0, 0), NOM);
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toHaveLength(2);
    expect(buy.isPlacing()).toBe(true);
    buy.setKeepPlacing(false);
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toHaveLength(3);
    expect(buy.isPlacing()).toBe(false);
  });

  it('Done → exits without buying; Esc → exits; both are no-ops (false) when nothing is being placed', () => {
    const { t, buy } = start();
    expect(buy.done()).toBe(true);
    expect(buy.isPlacing()).toBe(false);
    expect(t.renderer.ghost).toBeNull();
    expect(buy.state.lastDefId).toBe('chair_creaky');
    expect(buy.done()).toBe(false);
    buy.startPlacing('chair_creaky');
    expect(buy.escape()).toBe(true);
    expect(buy.isPlacing()).toBe(false);
    expect(buy.escape()).toBe(false);
    expect(t.log.builds).toEqual([]);
  });

  it('ADVERSARIAL: funds are never double-charged by one click — a failed build exits nothing and charges nothing; a click while not placing buys nothing', () => {
    const { t, buy } = start();
    t.setBuildOk(false); // the sim refused (e.g. funds changed between hover and click)
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toHaveLength(1); // one attempt, refused
    expect(buy.isPlacing()).toBe(true); // still placing: the player can try again or press Done
    t.setBuildOk(true);
    buy.click(P(0, 0), NOM);
    expect(t.log.builds).toHaveLength(2);
    expect(buy.isPlacing()).toBe(false);
    // after exit, clicks on empty ground with the hand tool never send a buy
    t.renderer.pickResult = { kind: 'none' };
    for (let i = 0; i < 5; i++) buy.click(P(0, 0), NOM);
    expect(t.log.builds.filter((c) => c.type === 'buy')).toHaveLength(2);
  });

  it('keyboard: Enter places one and exits; Shift+Enter places and keeps placing', () => {
    const { t, buy } = start();
    buy.keyNudge('up'); // keyboard cursor out
    buy.keyPlace(true);
    expect(t.log.builds).toHaveLength(1);
    expect(buy.isPlacing()).toBe(true);
    buy.keyPlace(false);
    expect(t.log.builds).toHaveLength(2);
    expect(buy.isPlacing()).toBe(false);
    expect(buy.announcement!.text).toMatch(/Back to the catalog/);
  });

  it('moving an existing object is unchanged: the drop always ends the move (Shift does not keep a phantom copy)', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    buy.click(P(0, 0), NOM);
    t.renderer.gridResult = { x: 7, z: 7, fx: 7.5, fz: 7.5, edge: null, edgeSide: 0 };
    buy.click(P(0, 0), SHIFT);
    expect(t.log.builds.at(-1)).toEqual({ type: 'move', objectId: 'o1', x: 7, z: 7, rot: 0 });
    expect(buy.isPlacing()).toBe(false);
  });
});

describe('BuildInput', () => {
  it('wall tool: drag snaps to a straight run, previews live, applies on release', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'wall', style: 'wall_plaster_bone' });
    t.renderer.gridResult = { x: 2, z: 5, fx: 2.1, fz: 5.1, edge: null, edgeSide: 0 };
    expect(b.primaryDown(P(0, 0))).toBe('tool');
    t.renderer.gridResult = { x: 5, z: 5, fx: 5.1, fz: 5.4, edge: null, edgeSide: 0 };
    b.toolMove(P(1, 0));
    expect(t.renderer.overlay).toMatchObject({ edges: ['h:2:5', 'h:3:5', 'h:4:5'], edgeMode: 'add', valid: true });
    expect(t.log.labels.at(-1)).toBe('$45 · 3 walls');
    b.toolEnd(P(1, 0), NOM, true);
    expect(t.log.builds).toEqual([{ type: 'addWalls', edges: ['h:2:5', 'h:3:5', 'h:4:5'], style: 'wall_plaster_bone' }]);
    expect(t.renderer.overlay).toBeNull();
  });

  it('a world refresh mid-drag re-previews at the drag pointer, not the pre-drag hover spot (label never blanks)', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'wall', style: 'wall_plaster_bone' });
    // screen x → vertex column 2 + x (position-dependent grid)
    t.renderer.pickGrid = (x: number) => ({ x: 2 + x, z: 5, fx: 2 + x + 0.05, fz: 5.05, edge: null, edgeSide: 0 as const });
    b.hover(P(0, 0));
    expect(b.primaryDown(P(0, 0))).toBe('tool');
    b.toolMove(P(3, 0));
    expect(t.log.labels.at(-1)).toBe('$45 · 3 walls');
    b.refresh(); // lot event / undo while the button is held
    expect(t.log.labels.at(-1)).toBe('$45 · 3 walls');
    expect(t.renderer.overlay).toMatchObject({ edges: ['h:2:5', 'h:3:5', 'h:4:5'] });
  });

  it('an invalid preview is not applied on release', () => {
    const t = host();
    t.sim.previewResult = { ok: false, reason: 'Not enough money', cost: 45 };
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'wall', style: 'wall_plaster_bone' });
    t.renderer.gridResult = { x: 2, z: 5, fx: 2, fz: 5, edge: null, edgeSide: 0 };
    b.primaryDown(P(0, 0));
    t.renderer.gridResult = { x: 4, z: 5, fx: 4, fz: 5, edge: null, edgeSide: 0 };
    b.toolEnd(P(1, 0), NOM, true);
    expect(t.log.builds).toEqual([]);
    expect(t.log.toasts).toContain("Can't build that");
  });

  it('room tool: inclusive tile rectangle; plain click does nothing', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'room', floor: 'floor_planks_worn', wallStyle: 'wall_plaster_bone' });
    t.renderer.gridResult = { x: 6, z: 6, fx: 6.5, fz: 6.5, edge: null, edgeSide: 0 };
    b.primaryDown(P(0, 0));
    b.toolEnd(P(0, 0), NOM, false);
    expect(t.log.builds).toEqual([]);
    b.primaryDown(P(0, 0));
    t.renderer.gridResult = { x: 3, z: 8, fx: 3.5, fz: 8.5, edge: null, edgeSide: 0 };
    b.toolEnd(P(5, 5), NOM, true);
    expect(t.log.builds).toEqual([{ type: 'room', x0: 3, z0: 6, x1: 7, z1: 9, floor: 'floor_planks_worn', wallStyle: 'wall_plaster_bone' }]);
  });

  it('floor tool: click paints one tile, drag paints a rectangle, null style removes', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'floor', styleId: null });
    t.renderer.gridResult = { x: 1, z: 1, fx: 1.5, fz: 1.5, edge: null, edgeSide: 0 };
    b.primaryDown(P(0, 0));
    b.toolEnd(P(0, 0), NOM, false);
    expect(t.log.builds).toEqual([{ type: 'floor', x0: 1, z0: 1, x1: 2, z1: 2, styleId: null }]);
  });

  it('deleteWall only targets existing walls', () => {
    const t = host();
    const b = new BuildInput(t.h);
    expect(existingWalls(t.sim, ['h:8:8', 'h:9:8'])).toEqual(['h:8:8']);
    b.setTool({ kind: 'deleteWall' });
    t.renderer.gridResult = { x: 8, z: 8, fx: 8, fz: 8, edge: 'h:8:8', edgeSide: 1 };
    b.primaryDown(P(0, 0));
    t.renderer.gridResult = { x: 10, z: 8, fx: 10, fz: 8, edge: null, edgeSide: 0 };
    b.toolEnd(P(0, 0), NOM, true);
    expect(t.log.builds).toEqual([{ type: 'removeWalls', edges: ['h:8:8'] }]);
  });

  it('paint: single side vs whole room (tile on the clicked side)', () => {
    const t = host();
    const b = new BuildInput(t.h);
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 0, point: point() };
    b.setTool({ kind: 'paintWall', styleId: 'wall_damask_crimson', wholeRoom: false });
    b.click(P(0, 0));
    expect(t.log.builds.at(-1)).toEqual({ type: 'paintWall', edge: 'h:8:8', side: 0, styleId: 'wall_damask_crimson' });
    b.setTool({ kind: 'paintWall', styleId: 'wall_damask_crimson', wholeRoom: true });
    b.click(P(0, 0));
    expect(t.log.builds.at(-1)).toEqual({ type: 'paintRoom', x: 8, z: 7, styleId: 'wall_damask_crimson' });
  });

  it('door tool: hover ghost via checkOpening, click buys the opening', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'door', defId: 'door_splintered' });
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 1, point: point() };
    b.hover(P(0, 0));
    expect(t.renderer.ghost).toMatchObject({ defId: 'door_splintered', edge: 'h:8:8', valid: true });
    b.click(P(0, 0));
    expect(t.log.builds.at(-1)).toEqual({ type: 'buyOpening', defId: 'door_splintered', edge: 'h:8:8' });
  });

  it('window tool: an unaffordable window is a RED ghost labelled "Not enough money" and the click buys nothing (owner report)', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'window', defId: 'window_grimy' });
    t.sim.previewResult = { ok: false, reason: 'Not enough money', cost: 90 };
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 1, point: point() };
    b.hover(P(0, 0));
    expect(t.renderer.ghost).toMatchObject({ defId: 'window_grimy', edge: 'h:8:8', valid: false });
    expect(t.log.labels.at(-1)).toBe('Not enough money');
    const n = t.log.builds.length;
    b.click(P(0, 0));
    expect(t.log.builds.length).toBe(n);
  });

  it('window tool: a click off any wall never buys at the previously hovered edge', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'window', defId: 'window_grimy' });
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 1, point: point() };
    b.hover(P(0, 0));
    expect(t.renderer.ghost).toMatchObject({ edge: 'h:8:8', valid: true });
    t.renderer.pickResult = { kind: 'none' };
    t.renderer.gridResult = null;
    const n = t.log.builds.length;
    b.click(P(50, 50));
    expect(t.renderer.ghost).toBeNull();
    expect(t.log.builds.length).toBe(n);
  });

  it('buy mode: an unaffordable item is a RED ghost and click / Enter buy nothing', () => {
    const t = host();
    const buy = new BuyInput(t.h);
    buy.startPlacing('painting_greatgrand');
    t.sim.previewResult = { ok: false, reason: 'Not enough money', cost: 45 };
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 1, point: point() };
    buy.hover(P(0, 0));
    expect(t.renderer.ghost).toMatchObject({ edge: 'h:8:8', valid: false });
    expect(t.log.labels.at(-1)).toBe('Not enough money');
    const n = t.log.builds.length;
    buy.click(P(0, 0), NOM);
    expect(t.log.builds.length).toBe(n);
  });

  it('eyedropper picks wall paint, floor style, or an object to copy', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'eyedropper' });
    t.renderer.pickResult = { kind: 'wall', edge: 'h:8:8', side: 1, point: point() };
    b.click(P(0, 0));
    expect(b.tool).toEqual({ kind: 'paintWall', styleId: 'wall_exterior_siding', wholeRoom: false });
    b.setTool({ kind: 'eyedropper' });
    t.renderer.pickResult = { kind: 'tile', x: 9, z: 9, point: point() };
    b.click(P(0, 0));
    expect(b.tool).toEqual({ kind: 'floor', styleId: 'floor_planks_worn' });
    b.setTool({ kind: 'eyedropper' });
    t.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    b.click(P(0, 0));
    expect(t.log.placeCopy).toEqual(['fridge_humming']);
    t.renderer.pickResult = { kind: 'tile', x: 99, z: 99, point: point() };
    b.setTool({ kind: 'eyedropper' });
    b.click(P(0, 0));
    expect(t.log.sfx).toContain('uiError');
  });

  it('Esc cancels a drag first, then drops back to the select tool', () => {
    const t = host();
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'wall', style: 's' });
    t.renderer.gridResult = { x: 2, z: 5, fx: 2, fz: 5, edge: null, edgeSide: 0 };
    b.primaryDown(P(0, 0));
    expect(b.escape()).toBe(true);
    expect(b.dragging).toBe(false);
    expect(b.escape()).toBe(true);
    expect(b.tool).toEqual({ kind: 'select' });
    expect(b.escape()).toBe(false);
  });

  it('sanitizeBuildTool rejects malformed tools', () => {
    expect(sanitizeBuildTool({ kind: 'wall' })).toBeNull();
    expect(sanitizeBuildTool({ kind: 'nuke' })).toBeNull();
    expect(sanitizeBuildTool(null)).toBeNull();
    expect(sanitizeBuildTool({ kind: 'floor', styleId: 3 })).toBeNull();
    // Unknown finishes fall back to the defaults (the sim would refuse them with "Unknown style").
    expect(sanitizeBuildTool({ kind: 'room', floor: null, wallStyle: 'w' })).toEqual({ kind: 'room', floor: null, wallStyle: 'wall_plaster_bone' });
    expect(sanitizeBuildTool({ kind: 'paintWall', styleId: 's', wholeRoom: 'yes' })).toEqual({ kind: 'paintWall', styleId: 'wall_plaster_bone', wholeRoom: false });
    const t = host();
    const b = new BuildInput(t.h);
    expect(b.setTool({ kind: 'bogus' } as never)).toBe(false);
    expect(b.tool).toEqual({ kind: 'select' });
  });

  it('a throwing preview is reported as invalid', () => {
    const t = host();
    t.sim.build.preview = () => {
      throw new Error('bug');
    };
    const b = new BuildInput(t.h);
    b.setTool({ kind: 'wall', style: 's' });
    t.renderer.gridResult = { x: 2, z: 5, fx: 2, fz: 5, edge: null, edgeSide: 0 };
    b.primaryDown(P(0, 0));
    t.renderer.gridResult = { x: 4, z: 5, fx: 4, fz: 5, edge: null, edgeSide: 0 };
    b.toolEnd(P(0, 0), NOM, true);
    expect(t.log.builds).toEqual([]);
    expect(t.log.labels).toContain('Preview unavailable');
  });
});
