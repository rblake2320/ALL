/**
 * Adversarial input tests: click-vs-drag decided at release, gesture callbacks bound to the handler that started
 * them, mode switches / dialogs mid-gesture, blocked touch input, stale interaction-menu choices, keyboard ownership
 * while dialogs are open, and the ultra gate reacting within a frame.
 */
import { describe, expect, it } from 'vitest';
import { PointerGestures, type GestureSink, type PointerEventLike } from '../../../src/game/input/pointer';
import { CameraController } from '../../../src/game/input/camera';
import type { ModeHandler, Mods, PointerPos } from '../../../src/game/input/types';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { startedHarness } from './controllerHarness';
import { FakeRenderer, point } from './fakes';

class Rec implements ModeHandler {
  log: string[] = [];
  tool = false;
  constructor(private readonly name: string) {}
  hover(): void {}
  primaryDown(): 'tool' | 'deferred' {
    this.log.push(`${this.name}:down`);
    return this.tool ? 'tool' : 'deferred';
  }
  toolMove(p: PointerPos): void {
    this.log.push(`${this.name}:toolMove@${p.cx}`);
  }
  toolEnd(p: PointerPos, _m: Mods, moved: boolean): void {
    this.log.push(`${this.name}:toolEnd@${p.cx}:${moved}`);
  }
  toolCancel(): void {
    this.log.push(`${this.name}:toolCancel`);
  }
  click(p: PointerPos): void {
    this.log.push(`${this.name}:click@${p.cx}`);
  }
  secondaryClick(): void {
    this.log.push(`${this.name}:rightClick`);
  }
  doubleClick(): void {}
  escape(): boolean {
    return false;
  }
  reset(): void {}
}

function rig() {
  const renderer = new FakeRenderer();
  const camera = new CameraController(renderer, () => DEFAULT_SETTINGS, () => undefined);
  const a = new Rec('A');
  const b = new Rec('B');
  let active: ModeHandler | null = a;
  const sink: GestureSink = {
    handler: () => active,
    camera,
    canvasOrigin: () => ({ left: 0, top: 0 }),
    spaceHeld: () => false,
    spaceUsed: () => undefined,
    onError: () => undefined,
  };
  const g = new PointerGestures(sink);
  const ev = (over: Partial<PointerEventLike>): PointerEventLike => ({ pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, pointerType: 'mouse', ...over });
  return { g, renderer, a, b, ev, setActive: (h: ModeHandler | null) => (active = h) };
}

describe('click vs drag is decided by where the button is released', () => {
  it('a release far from the press with no move events in between is not a click', () => {
    const t = rig();
    t.g.down(t.ev({}));
    t.g.up(t.ev({ clientX: 400, clientY: 300 })); // coalesced / dropped pointermoves
    expect(t.a.log).toEqual(['A:down']);
  });

  it('a right-button release far away is not a "cancel" click either', () => {
    const t = rig();
    t.g.down(t.ev({ button: 2 }));
    t.g.up(t.ev({ button: 2, clientX: 300 }));
    expect(t.a.log).not.toContain('A:rightClick');
  });

  it('a tool drag released far away without moves reports moved = true', () => {
    const t = rig();
    t.a.tool = true;
    t.g.down(t.ev({}));
    t.g.up(t.ev({ clientX: 260 }));
    expect(t.a.log).toEqual(['A:down', 'A:toolEnd@260:true']);
  });

  it('a jitter within the threshold is still a click', () => {
    const t = rig();
    t.g.down(t.ev({}));
    t.g.up(t.ev({ clientX: 102, clientY: 101 }));
    expect(t.a.log).toEqual(['A:down', 'A:click@102']);
  });
});

describe('gesture callbacks stay with the handler that started the gesture', () => {
  it('switching modes mid tool-drag cancels the drag on the ORIGINAL handler; the new one sees nothing', () => {
    const t = rig();
    t.a.tool = true;
    t.g.down(t.ev({}));
    t.g.move(t.ev({ clientX: 140 }));
    t.setActive(t.b); // e.g. F2 pressed while dragging a wall
    t.g.move(t.ev({ clientX: 180 }));
    t.g.up(t.ev({ clientX: 180 }));
    expect(t.a.log).toEqual(['A:down', 'A:toolMove@140', 'A:toolCancel']);
    expect(t.b.log).toEqual([]);
  });

  it('becoming blocked (dialog opened) mid-drag cancels it; the release is ignored', () => {
    const t = rig();
    t.a.tool = true;
    t.g.down(t.ev({}));
    t.setActive(null);
    t.g.move(t.ev({ clientX: 150 }));
    t.g.up(t.ev({ clientX: 150 }));
    expect(t.a.log).toEqual(['A:down', 'A:toolCancel']);
  });

  it('a click pending on A is dropped when the active handler changes before release', () => {
    const t = rig();
    t.g.down(t.ev({}));
    t.setActive(t.b);
    t.g.up(t.ev({}));
    expect(t.a.log).toEqual(['A:down']);
    expect(t.b.log).toEqual([]);
  });

  it('touch pinch does nothing while world input is blocked', () => {
    const t = rig();
    t.setActive(null);
    t.g.down(t.ev({ pointerId: 1, pointerType: 'touch', clientX: 100 }));
    t.g.down(t.ev({ pointerId: 2, pointerType: 'touch', clientX: 200 }));
    t.g.move(t.ev({ pointerId: 2, pointerType: 'touch', clientX: 300 }));
    expect(t.renderer.count('zoom')).toBe(0);
    expect(t.renderer.count('pan')).toBe(0);
  });
});

describe('controller integration: dialogs / mode switches mid-gesture', () => {
  it('opening Help (F10) during a wall drag clears the preview overlay and label; hover works afterwards', async () => {
    const h = await startedHarness();
    h.game.setBuildTool({ kind: 'wall', style: 'wall_plaster_bone' });
    h.renderer.gridResult = { x: 5, z: 5, fx: 5.1, fz: 5.1, edge: 'h:5:5', edgeSide: 1 };
    h.pointer('pointerdown', 100, 100);
    h.renderer.gridResult = { x: 9, z: 5, fx: 9.1, fz: 5.1, edge: 'h:9:5', edgeSide: 1 };
    h.pointer('pointermove', 200, 100);
    await h.frames(1);
    expect(h.renderer.overlay).not.toBeNull();
    expect(h.game.buildPreviewLabel).not.toBeNull();
    h.key('keydown', 'F10');
    await h.frames(1);
    expect(h.game.dialog).toBe('help');
    expect(h.renderer.overlay).toBeNull();
    expect(h.game.buildPreviewLabel).toBeNull();
    h.pointer('pointerup', 200, 100);
    h.game.closeDialog();
    const applied = h.gameSim().dispatched.filter((c) => c.type === 'build').length;
    h.pointer('pointermove', 210, 100);
    await h.frames(2);
    expect(h.gameSim().dispatched.filter((c) => c.type === 'build').length).toBe(applied); // nothing half-applied
  });

  it('switching build → buy with the hotkey mid-drag never applies the wall', async () => {
    const h = await startedHarness();
    h.game.setBuildTool({ kind: 'wall', style: 'wall_plaster_bone' });
    h.renderer.gridResult = { x: 5, z: 5, fx: 5.1, fz: 5.1, edge: 'h:5:5', edgeSide: 1 };
    h.pointer('pointerdown', 100, 100);
    h.renderer.gridResult = { x: 9, z: 5, fx: 9.1, fz: 5.1, edge: 'h:9:5', edgeSide: 1 };
    h.pointer('pointermove', 200, 100);
    h.key('keydown', 'KeyB');
    h.pointer('pointerup', 200, 100);
    await h.frames(1);
    expect(h.game.mode).toBe('buy');
    expect(h.gameSim().dispatched.some((c) => c.type === 'build')).toBe(false);
    expect(h.renderer.overlay).toBeNull();
  });
});

describe('interaction menu races', () => {
  it('choosing an entry after the target object vanished (before the 500 ms upkeep) dispatches nothing', async () => {
    const h = await startedHarness();
    h.game.selectAgent('a1');
    h.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    h.pointer('pointerdown', 300, 200);
    h.pointer('pointerup', 300, 200);
    const menu = h.game.menu!;
    expect(menu).not.toBeNull();
    delete h.gameSim().state.objects.o1; // burned / repossessed this very frame
    const before = h.gameSim().dispatched.length;
    h.game.chooseMenuEntry(menu.entries[0]);
    expect(h.gameSim().dispatched.length).toBe(before);
    expect(h.game.menu).toBeNull();
  });

  it('choosing after the actor left for work dispatches nothing', async () => {
    const h = await startedHarness();
    h.game.selectAgent('a1');
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 10, 10);
    const menu = h.game.menu!;
    h.gameSim().state.agents.a1.presence = 'atWork';
    const before = h.gameSim().dispatched.length;
    h.game.chooseMenuEntry(menu.entries[0]);
    expect(h.gameSim().dispatched.length).toBe(before);
  });

  it('an entry that is not in the open menu (stale UI) is refused', async () => {
    const h = await startedHarness();
    h.game.selectAgent('a1');
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 10, 10);
    const before = h.gameSim().dispatched.length;
    h.game.chooseMenuEntry({ interactionId: 'home_evil_debug', label: 'x', group: null, icon: 'star', available: true, reason: null, cost: null, params: {} });
    expect(h.gameSim().dispatched.length).toBe(before);
  });

  it('a child passed for an entry without children (or a foreign child) is never dispatched', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.selectAgent('a1');
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 10, 10);
    const bogus = { interactionId: 'not_a_child', label: 'x', group: null, icon: 'star' as const, available: true, reason: null, cost: null, params: { evil: true } };
    h.game.chooseMenuEntry(h.game.menu!.entries[0], bogus);
    const queued = sim.dispatched.filter((c) => c.type === 'queue');
    expect(queued.map((c) => (c as { interactionId: string }).interactionId)).not.toContain('not_a_child');
    sim.menuEntries = [
      {
        interactionId: 'home_cook',
        label: 'Cook…',
        group: null,
        icon: 'plate',
        available: true,
        reason: null,
        cost: null,
        params: {},
        children: [{ interactionId: 'home_cook', label: 'Stew', group: null, icon: 'plate', available: true, reason: null, cost: 20, params: { recipeId: 'stew' } }],
      },
    ];
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 10, 10);
    const parent = h.game.menu!.entries[0];
    h.game.chooseMenuEntry(parent, bogus);
    expect(sim.dispatched.filter((c) => c.type === 'queue').length).toBe(queued.length);
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 10, 10);
    h.game.chooseMenuEntry(h.game.menu!.entries[0], h.game.menu!.entries[0].children![0]);
    const last = sim.dispatched.at(-1) as { type: string; params?: Record<string, unknown> };
    expect(last.type).toBe('queue');
    expect(last.params).toEqual({ recipeId: 'stew' });
  });
});

describe('keyboard ownership while a dialog is open', () => {
  it('Tab is left to the browser (focus can move into the dialog); F5 still never reloads', async () => {
    const h = await startedHarness();
    h.game.openDialog('settings');
    const tab = h.key('keydown', 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    const arrow = h.key('keydown', 'ArrowDown');
    expect(arrow.defaultPrevented).toBe(false);
    const f5 = h.key('keydown', 'F5');
    expect(f5.defaultPrevented).toBe(true);
    const ctrlS = h.key('keydown', 'KeyS', { ctrlKey: true });
    expect(ctrlS.defaultPrevented).toBe(true);
  });
});

describe('ultra speed reacts within a frame', () => {
  it('someone waking up drops ultra to 3 on the next frame, not 500 ms later', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    for (const id of sim.state.household.memberIds) sim.state.agents[id].anim = 'sleep';
    sim.state.agents.a99.presence = 'offLot';
    h.game.setSpeed(4);
    expect(h.game.speed).toBe(4);
    await h.frames(40); // let the 500 ms upkeep run once so the next one is far away
    sim.state.agents.a1.anim = 'idle';
    await h.frames(1);
    expect(h.game.speed).toBe(3);
  });
});
