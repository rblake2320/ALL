/**
 * Backlog #19 (documentation-only KEYMAP.focusHud) and the build-mode wall-drag label regression ("Unknown style"
 * before a wall finish is picked), against the REAL keymap, the real controller harness and the REAL sim planner.
 */
import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../../../src/game/contracts';
import { DOC_ONLY_ACTIONS, KeyResolver, shouldPreventDefault, type KeyEventLike } from '../../../src/game/input/keyboard';
import { BuildInput, knownFloorStyle, knownWallStyle, sanitizeBuildTool } from '../../../src/game/input/build';
import type { InputHost, Mods, PointerPos } from '../../../src/game/input/types';
import type { BuildCommand, SimulationAPI } from '../../../src/sim/contracts';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { DEFAULT_INTERIOR_WALL, WALL_STYLES } from '../../../src/shared/styles';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { startedHarness } from './controllerHarness';
import { FakeRenderer } from './fakes';

const ev = (code: string, m: Partial<KeyEventLike> = {}): KeyEventLike => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });

describe('#19 KEYMAP.focusHud is documentation-only', () => {
  it('documents F6 / Shift+F6 for Help', () => {
    expect(KEYMAP.focusHud).toEqual(['F6', 'shift+F6']);
    expect(DOC_ONLY_ACTIONS.has('focusHud')).toBe(true);
  });

  it('the controller resolver never binds it — F6 in every modifier combination resolves to nothing', () => {
    const r = new KeyResolver();
    expect(r.invalid).toEqual([]);
    for (const m of [{}, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }]) expect(r.resolve(ev('F6', m))).toBeNull();
    expect(r.combos().some((c) => DOC_ONLY_ACTIONS.has(c.action))).toBe(false);
    // even a custom map that binds it to a key the controller would otherwise own stays unbound
    const custom = new KeyResolver({ focusHud: ['KeyP'], pause: ['Space'] });
    expect(custom.resolve(ev('KeyP'))).toBeNull();
    expect(custom.resolve(ev('Space'))).toBe('pause');
    // and the browser default is left for the HUD's own capture handler to manage
    expect(shouldPreventDefault(r.resolve(ev('F6')), 'F6')).toBe(false);
  });

  it('documentation-only actions do not shadow real bindings', () => {
    const r = new KeyResolver();
    expect(r.resolve(ev('F5'))).toBe('quickSave');
    expect(r.resolve(ev('Tab', { shiftKey: true }))).toBe('cycleZombie');
    expect(r.resolve(ev('F10'))).toBe('help');
  });

  it('in the real controller, F6 / Shift+F6 are neither acted on nor preventDefault-ed', async () => {
    const h = await startedHarness();
    const before = { speed: h.game.speed, mode: h.game.mode, dialog: h.game.dialog };
    const a = h.key('keydown', 'F6');
    const b = h.key('keydown', 'F6', { shiftKey: true });
    expect(a.defaultPrevented).toBe(false);
    expect(b.defaultPrevented).toBe(false);
    expect({ speed: h.game.speed, mode: h.game.mode, dialog: h.game.dialog }).toEqual(before);
    // a neighbouring real hazard key is still handled
    expect(h.key('keydown', 'F5').defaultPrevented).toBe(true);
  });
});

// ───────────────────────── wall-drag label on the real planner ─────────────────────────

function realSim(): SimulationAPI {
  return createSimulation(
    createNewWorld({
      seed: 1919,
      householdName: 'Plaster',
      members: [{ firstName: 'Mort', lastName: 'Plaster', appearance: defaultAppearance(), traits: [], aspiration: 'tycoon' }],
      lotTemplate: 'empty',
      difficulty: 'normal',
    }),
  );
}

function host(sim: SimulationAPI) {
  const renderer = new FakeRenderer();
  const labels: (string | null)[] = [];
  const builds: BuildCommand[] = [];
  const toasts: string[] = [];
  const h: InputHost = {
    renderer,
    openPetMenu: () => undefined,
    sim: () => sim,
    settings: () => DEFAULT_SETTINGS,
    setHoverLabel: () => undefined,
    setGridHover: () => undefined,
    setBuildPreviewLabel: (l) => labels.push(l),
    toast: (_k, t, text) => toasts.push(`${t}: ${text}`),
    sfx: () => undefined,
    changed: () => undefined,
    selectedAgentId: () => null,
    selectAgent: () => undefined,
    openMenuFor: () => undefined,
    closeMenu: () => false,
    isMenuOpen: () => false,
    applyBuild: (cmd) => {
      builds.push(cmd);
      return true;
    },
    placeCopy: () => undefined,
  };
  return { h, renderer, labels, builds, toasts };
}

const P = (cx: number, cy: number): PointerPos => ({ cx, cy, vx: cx, vy: cy });
const NOM: Mods = { shift: false, ctrl: false, alt: false };

/** Drag a 3-segment wall run on the real sim with the given (possibly bogus) wall tool. */
function dragWall(style: string) {
  const sim = realSim();
  const t = host(sim);
  const b = new BuildInput(t.h);
  expect(b.setTool({ kind: 'wall', style })).toBe(true);
  t.renderer.gridResult = { x: 2, z: 5, fx: 2.1, fz: 5.1, edge: null, edgeSide: 0 };
  expect(b.primaryDown(P(0, 0))).toBe('tool');
  t.renderer.gridResult = { x: 5, z: 5, fx: 5.1, fz: 5.4, edge: null, edgeSide: 0 };
  b.toolMove(P(1, 0));
  const label = t.labels.at(-1) ?? null;
  const overlay = t.renderer.overlay;
  b.toolEnd(P(1, 0), NOM, true);
  return { b, t, label, overlay, sim };
}

describe('wall-drag overlay label never reads "Unknown style"', () => {
  const price = WALL_STYLES.find((s) => s.id === DEFAULT_INTERIOR_WALL)!;

  it('the default finish: "$cost · 3 walls" and the build applies', () => {
    const { label, overlay, t } = dragWall(DEFAULT_INTERIOR_WALL);
    expect(label).toMatch(/^\$\d+ · 3 walls$/);
    expect(overlay).toMatchObject({ valid: true, label, styleId: DEFAULT_INTERIOR_WALL });
    expect(t.builds).toEqual([{ type: 'addWalls', edges: ['h:2:5', 'h:3:5', 'h:4:5'], style: DEFAULT_INTERIOR_WALL }]);
    expect(price).toBeDefined();
  });

  it.each(['not_a_style', 'WALL_PLASTER_BONE', 'wall_plaster_bone ', '__proto__', 'constructor', 'toString', 'floor_planks_worn'])(
    'an unknown wall finish %j falls back to the default finish (real planner, no error label)',
    (bogus) => {
      const { label, overlay, b, t } = dragWall(bogus);
      expect(b.tool).toEqual({ kind: 'wall', style: DEFAULT_INTERIOR_WALL });
      expect(label).not.toMatch(/unknown/i);
      expect(label).toMatch(/^\$\d+ · 3 walls$/);
      expect(overlay).toMatchObject({ valid: true, styleId: DEFAULT_INTERIOR_WALL });
      expect(t.toasts).toEqual([]);
      expect(t.builds).toEqual([{ type: 'addWalls', edges: ['h:2:5', 'h:3:5', 'h:4:5'], style: DEFAULT_INTERIOR_WALL }]);
    },
  );

  it('the label matches what the default finish costs on the same sim', () => {
    const a = dragWall(DEFAULT_INTERIOR_WALL).label;
    const b = dragWall('nope').label;
    expect(b).toBe(a);
  });

  it('every real wall finish is kept as picked (no silent swap of valid choices)', () => {
    for (const s of WALL_STYLES) {
      expect(knownWallStyle(s.id)).toBe(s.id);
      expect(sanitizeBuildTool({ kind: 'wall', style: s.id })).toEqual({ kind: 'wall', style: s.id });
      expect(sanitizeBuildTool({ kind: 'paintWall', styleId: s.id, wholeRoom: true })).toEqual({ kind: 'paintWall', styleId: s.id, wholeRoom: true });
    }
  });

  it('room / floor / paint tools normalise unknown finishes too; malformed tools are still rejected', () => {
    expect(sanitizeBuildTool({ kind: 'room', floor: 'nope', wallStyle: 'nope' })).toEqual({ kind: 'room', floor: knownFloorStyle('nope'), wallStyle: DEFAULT_INTERIOR_WALL });
    expect(sanitizeBuildTool({ kind: 'room', floor: null, wallStyle: 'nope' })).toEqual({ kind: 'room', floor: null, wallStyle: DEFAULT_INTERIOR_WALL });
    expect(sanitizeBuildTool({ kind: 'floor', styleId: 'nope' })).toEqual({ kind: 'floor', styleId: 'floor_planks_worn' });
    expect(sanitizeBuildTool({ kind: 'floor', styleId: null })).toEqual({ kind: 'floor', styleId: null });
    expect(sanitizeBuildTool({ kind: 'paintWall', styleId: 'nope' })).toEqual({ kind: 'paintWall', styleId: DEFAULT_INTERIOR_WALL, wholeRoom: false });
    for (const bad of [{ kind: 'wall' }, { kind: 'wall', style: '' }, { kind: 'wall', style: 7 }, { kind: 'wall', style: 'x'.repeat(65) }, { kind: 'paintWall' }, { kind: 'room', floor: null }])
      expect(sanitizeBuildTool(bad)).toBeNull();
  });

  it('the real planner still refuses an unknown style when called directly (the game never sends one)', () => {
    const sim = realSim();
    const p = sim.build.preview({ type: 'addWalls', edges: ['h:2:5'], style: 'not_a_style' });
    expect(p.ok).toBe(false);
  });
});
