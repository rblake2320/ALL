/**
 * W-136 perspectives at the game layer (docs/DESIGN_OPEN_WORLD.md §4.1, OW-4): the `V` key and the controller API,
 * the rules that hand the view back to the overview, and garbage. The renderer here is the recording fake; the
 * camera itself is covered by tests/unit/render/perspective.test.ts and the real browser by tests/e2e/perspective.mjs.
 */
import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../../../src/game/contracts';
import { PERSPECTIVES } from '../../../src/game/gameplay';
import { PERSPECTIVES as RENDER_PERSPECTIVES } from '../../../src/render/camera/perspective';
import { startedHarness } from './controllerHarness';

const titles = (h: { game: { toasts: { title: string }[] } }) => h.game.toasts.map((t) => t.title);

describe('perspective (W-136)', () => {
  it('one vocabulary in the game and the renderer; V is the key and nothing else uses it', () => {
    expect([...PERSPECTIVES]).toEqual([...RENDER_PERSPECTIVES]);
    expect(KEYMAP.perspective).toEqual(['KeyV']);
    const others = Object.entries(KEYMAP).filter(([k]) => k !== 'perspective').flatMap(([, v]) => v as readonly string[]);
    expect(others.some((c) => c.split('+').pop() === 'KeyV')).toBe(false);
  });

  it('a new game starts in the overview; V cycles shoulder → first person → overview on the selected zombie', async () => {
    const h = await startedHarness();
    expect(h.game.perspective).toBe('overview');
    expect(h.game.selectedAgentId).toBe('a1');
    const v = h.game.version;
    const e = h.key('keydown', 'KeyV');
    expect(e.defaultPrevented).toBe(true);
    expect(h.game.perspective).toBe('shoulder');
    expect(h.renderer.last('setPerspective')!.args.slice(0, 2)).toEqual(['shoulder', 'a1']);
    expect(h.game.version).toBeGreaterThan(v);
    h.key('keydown', 'KeyV');
    expect(h.game.perspective).toBe('firstPerson');
    expect(h.renderer.last('setPerspective')!.args.slice(0, 2)).toEqual(['firstPerson', 'a1']);
    h.key('keydown', 'KeyV');
    expect(h.game.perspective).toBe('overview');
    expect(h.renderer.last('setPerspective')!.args.slice(0, 2)).toEqual(['overview', null]);
    expect(h.audio.calls.filter((c) => c.name === 'sfx' && c.args[0] === 'uiToggle').length).toBeGreaterThanOrEqual(3);
  });

  it('the player wall view is never touched by a perspective change', async () => {
    const h = await startedHarness();
    h.game.setWallMode('down');
    const walls = h.renderer.calls.filter((c) => c.name === 'setWallMode').length;
    expect(walls).toBeGreaterThan(0);
    for (const p of ['shoulder', 'firstPerson', 'overview'] as const) {
      h.game.setPerspective(p);
      expect(h.game.wallMode).toBe('down');
    }
    expect(h.renderer.calls.filter((c) => c.name === 'setWallMode').length).toBe(walls);
  });

  it('Esc leaves a close view first, and only the next Esc opens the pause menu', async () => {
    const h = await startedHarness();
    h.game.setPerspective('firstPerson');
    const e = h.key('keydown', 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(h.game.perspective).toBe('overview');
    expect(h.game.dialog).toBeNull();
    h.key('keydown', 'Escape');
    expect(h.game.dialog).toBe('pause');
  });

  it('Esc closes an open interaction menu before it leaves the close view', async () => {
    const h = await startedHarness();
    h.game.setPerspective('shoulder');
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 0, 0);
    h.key('keydown', 'Escape');
    expect(h.game.menu).toBeNull();
    expect(h.game.perspective).toBe('shoulder');
    h.key('keydown', 'Escape');
    expect(h.game.perspective).toBe('overview');
  });

  it('Buy and Build are done from above: entering either returns to the overview and a close view is refused there', async () => {
    for (const mode of ['buy', 'build'] as const) {
      const h = await startedHarness();
      h.game.setPerspective('shoulder');
      h.game.setMode(mode);
      expect(h.game.perspective).toBe('overview');
      expect(h.renderer.perspective).toBe('overview');
      const calls = h.renderer.calls.filter((c) => c.name === 'setPerspective').length;
      expect(calls).toBeGreaterThan(0);
      h.game.setPerspective('firstPerson');
      h.key('keydown', 'KeyV');
      expect(h.game.perspective).toBe('overview');
      expect(h.renderer.calls.filter((c) => c.name === 'setPerspective').length).toBe(calls); // the renderer was not even asked
      expect(titles(h)).toContain('Live mode only');
      h.game.setMode('live');
      h.game.setPerspective('firstPerson');
      expect(h.game.perspective).toBe('firstPerson');
    }
  });

  it('the view moves with the selection, and ends when nobody is selected', async () => {
    const h = await startedHarness();
    h.game.setPerspective('shoulder');
    h.game.selectAgent('a2');
    expect(h.game.perspective).toBe('shoulder');
    expect(h.renderer.perspectiveAgent).toBe('a2');
    h.key('keydown', 'Tab');
    expect(h.renderer.perspectiveAgent).toBe('a1');
    h.game.selectAgent(null);
    expect(h.game.perspective).toBe('overview');
    expect(h.renderer.perspective).toBe('overview');
    h.game.setPerspective('shoulder');
    expect(h.game.perspective).toBe('overview');
    expect(titles(h)).toContain('Pick a zombie first');
  });

  it('a zombie who is not at home cannot carry the camera (refused with a reason; selecting one ends the view)', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.state.agents.a2.presence = 'atWork';
    h.game.selectAgent('a2');
    h.game.setPerspective('firstPerson');
    expect(h.game.perspective).toBe('overview');
    expect(titles(h).some((t) => /isn't home/.test(t))).toBe(true);
    h.game.selectAgent('a1');
    h.game.setPerspective('firstPerson');
    expect(h.game.perspective).toBe('firstPerson');
    h.game.selectAgent('a2'); // at work
    expect(h.game.perspective).toBe('overview');
    expect(h.renderer.perspective).toBe('overview');
  });

  it('the renderer has the last word: a zombie it cannot draw gives the overview, and the game follows it back by itself', async () => {
    const h = await startedHarness();
    h.renderer.drawable = new Set(['a2']);
    h.game.setPerspective('shoulder'); // a1 selected, not drawable
    expect(h.game.perspective).toBe('overview');
    h.renderer.drawable = null;
    h.game.setPerspective('firstPerson');
    expect(h.game.perspective).toBe('firstPerson');
    // the renderer drops the view (the zombie walked off the lot / crumbled); the game notices within a slow tick
    h.renderer.perspective = 'overview';
    const v = h.game.version;
    await h.frames(40);
    expect(h.game.perspective).toBe('overview');
    expect(h.game.version).toBeGreaterThan(v);
  });

  it('garbage and a renderer without the feature leave the overview and never throw', async () => {
    const h = await startedHarness();
    for (const g of [null, undefined, 3, {}, 'FirstPerson', 'top', ''] as never[]) {
      h.game.setPerspective(g);
      expect(h.game.perspective).toBe('overview');
    }
    h.game.setPerspective('shoulder');
    for (const g of [null, undefined, 3, {}, 'FirstPerson'] as never[]) {
      h.game.setPerspective(g);
      expect(h.game.perspective).toBe('shoulder'); // an unknown value changes nothing
    }
    h.game.setPerspective('overview');
    const r = h.renderer as unknown as Record<string, unknown>;
    const saved = { set: r.setPerspective, get: r.getPerspective };
    r.setPerspective = undefined;
    r.getPerspective = undefined;
    h.game.setPerspective('firstPerson');
    h.game.cyclePerspective();
    expect(h.game.perspective).toBe('overview');
    r.setPerspective = () => {
      throw new Error('boom');
    };
    h.game.setPerspective('firstPerson');
    expect(h.game.perspective).toBe('overview');
    r.setPerspective = () => 'sideways';
    h.game.setPerspective('firstPerson');
    expect(h.game.perspective).toBe('overview');
    Object.assign(r, { setPerspective: saved.set, getPerspective: saved.get });
    expect(h.game.fatalError).toBeNull();
  });

  it('leaving the world resets the view; the next world starts in the overview', async () => {
    const h = await startedHarness();
    h.game.setPerspective('firstPerson');
    await h.game.quitToMenu();
    expect(h.game.perspective).toBe('overview');
    expect(h.renderer.perspective).toBe('overview');
  });

  it('the ambience is the one where the view listens: a close view on a zombie indoors is indoors, wherever the overview was left', async () => {
    const h = await startedHarness();
    await h.frames(40);
    const last = () => h.audio.named('setAmbience').at(-1)!.args[0] as { indoor: boolean };
    expect(last().indoor).toBe(false); // the overview camera is over the yard (15, 15)
    // the renderer says where the view listens from: the zombie, standing in the room (FakeSim: tiles 8..9 are indoors)
    Object.assign(h.renderer, { getListener: () => ({ ...h.renderer.camera, target: { x: 8.5, z: 8.5 } }) });
    await h.frames(40);
    expect(h.renderer.getCamera().target).toEqual({ x: 15, z: 15 }); // the overview camera has not moved
    expect(last().indoor).toBe(true);
  });

  it('diagnostics name the perspective', async () => {
    const h = await startedHarness();
    h.game.setPerspective('shoulder');
    expect(h.game.diagnostics()).toContain('shoulder');
  });
});
