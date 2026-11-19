/**
 * W-013 click menu of a stray or a pet (src/game/petMenu.ts) and its Gameplay wiring on the REAL simulation:
 * the rows, the adopt gate, the `pet` command a row becomes, and that choosing a row really changes the sim.
 */
import { describe, expect, it } from 'vitest';
import { petCommandFor, petHoverLabel, petMenuFor, PET_ENTRY_PREFIX } from '../../../src/game/petMenu';
import type { PetsState } from '../../../src/sim/types';
import type { SimulationAPI } from '../../../src/sim/contracts';
import type { Gameplay } from '../../../src/game/gameplay';
import { startedHarness } from '../game/controllerHarness';
import * as sim from '../../../src/sim/index';

const body = { pos: { x: 5, z: 29 }, facing: 0, anim: 'idle' as const, goal: null, slot: -1, busyUntil: 0 };
const pets = (trust: number): PetsState => ({
  version: 1,
  nextId: 9,
  strays: [{ id: 's1', species: 'cat', name: 'Mittens', trait: 'lazy', place: 'street', trust, calmTick: 0, chaseCoolTick: 0, arrivedTick: 0, ...body }],
  pets: [{ id: 'p2', species: 'dog', name: 'Biscuit', trait: 'guard', adoptedTick: 0, needs: { appetite: 50, fun: 50, hygiene: 50, affection: 50 }, neglectMin: 0, guardUntil: 0, variant: 'normal' as const, ...body }],
  away: [],
  pending: [],
});

describe('petMenuFor', () => {
  it('a stray offers Offer Scraps, Befriend, Pet, Adopt and Chase; Adopt is explained until trust 70', () => {
    const m = petMenuFor({ pets: pets(40) }, 'stray', 's1')!;
    expect(m.title).toBe('Mittens the cat · trust 40/70');
    expect(m.entries.map((e) => e.label)).toEqual(['Offer Scraps', 'Befriend', 'Pet', 'Adopt', 'Chase']);
    const adopt = m.entries.find((e) => e.label === 'Adopt')!;
    expect(adopt.available).toBe(false);
    expect(adopt.reason).toBe('Needs trust 70 (now 40)');
    expect(petMenuFor({ pets: pets(70) }, 'stray', 's1')!.entries.find((e) => e.label === 'Adopt')!.available).toBe(true);
  });
  it('a pet offers Feed, Play and Cuddle; an animal that is gone has no menu', () => {
    const m = petMenuFor({ pets: pets(0) }, 'pet', 'p2')!;
    expect(m.entries.map((e) => e.label)).toEqual(['Feed', 'Play', 'Cuddle']);
    expect(petMenuFor({ pets: pets(0) }, 'pet', 'p9')).toBeNull();
    expect(petMenuFor({ pets: undefined }, 'stray', 's1')).toBeNull();
    expect(petHoverLabel({ pets: pets(0) }, 'pet', 'p2')).toBe('Biscuit the dog');
  });
  it('a row becomes the matching pet command, and nothing else does', () => {
    const rows = petMenuFor({ pets: pets(0) }, 'stray', 's1')!.entries;
    expect(petCommandFor(rows[0], 'a1')).toEqual({ type: 'pet', action: 'offerScraps', agentId: 'a1', strayId: 's1' });
    const care = petMenuFor({ pets: pets(0) }, 'pet', 'p2')!.entries[0];
    expect(petCommandFor(care, 'a2')).toEqual({ type: 'pet', action: 'feed', agentId: 'a2', petId: 'p2' });
    expect(petCommandFor({ ...care, interactionId: 'home_cook' }, 'a1')).toBeNull();
    expect(rows.every((r) => r.interactionId.startsWith(PET_ENTRY_PREFIX))).toBe(true);
  });
});

describe('Gameplay: click a stray, choose a row', () => {
  it('explains remote animal care while retaining ordinary off-home interaction menus', async () => {
    const h = await startedHarness({ realSim: { createNewWorld: sim.createNewWorld, createSimulation: sim.createSimulation, loadContent: sim.loadContent, LOT_TEMPLATES: sim.LOT_TEMPLATES } });
    const game = h.game as unknown as { selectAgent(id: string, focus?: boolean): void; menu: { entries: unknown[] } | null; sim: SimulationAPI; c: { play: Gameplay } };
    const actor = game.sim.state.agents[game.sim.state.household.memberIds[0]];
    game.selectAgent(actor.id, false);
    actor.regionId = 'street:mildew:2';
    game.c.play.openPetMenu('stray', game.sim.state.pets!.strays[0].id, 100, 100, { width: 1280, height: 720 });
    expect(game.menu).toBeNull();
    game.c.play.openMenuFor({ kind: 'self' }, 100, 100, { width: 1280, height: 720 });
    expect(game.menu?.entries.length).toBeGreaterThan(0);
  });

  it('opens the menu for the selected zombie and the choice reaches the pets system', async () => {
    const h = await startedHarness({ realSim: { createNewWorld: sim.createNewWorld, createSimulation: sim.createSimulation, loadContent: sim.loadContent, LOT_TEMPLATES: sim.LOT_TEMPLATES } });
    const game = h.game as unknown as { selectAgent(id: string, focus?: boolean): void; menu: { title: string; entries: { label: string; interactionId: string; available: boolean; params: Record<string, unknown> }[] } | null; chooseMenuEntry(e: unknown): void; sim: { state: { pets?: PetsState; household: { memberIds: string[] } } } };
    const state = game.sim.state;
    const stray = state.pets!.strays[0];
    game.selectAgent(state.household.memberIds[0], false);
    const play = (h.game as unknown as { c: { play: { openPetMenu(k: string, id: string, x: number, y: number, v: { width: number; height: number }): void } } }).c.play;
    play.openPetMenu('stray', stray.id, 100, 100, { width: 1280, height: 720 });
    expect(game.menu).not.toBeNull();
    expect(game.menu!.title).toContain(stray.name);
    const row = game.menu!.entries.find((e) => e.label === 'Befriend')!;
    const before = stray.trust;
    (state as unknown as { agents: Record<string, { pos: { x: number; z: number } }> }).agents[state.household.memberIds[0]].pos = { ...stray.pos }; // next to it: no walk first
    game.chooseMenuEntry(row);
    expect(state.pets!.strays.find((s) => s.id === stray.id)!.trust).toBeGreaterThan(before);
    expect(game.menu).toBeNull();
  });
});
