/**
 * The shared town as something the game's renderer can draw.
 *
 * The renderer draws whatever world it is given. This file builds an ordinary game world on the shared town's seed
 * (so every browser sees the same street and the same houses), empties it of its own household, and then, every
 * frame, places one zombie per connected player where the town connection says they are. Nothing here is simulated:
 * `step()` is never called, the server decides where everybody stands.
 */
import { createNewWorld, createSimulation } from '../sim/index';
import type { SimulationAPI } from '../sim/contracts';
import type { AgentState } from '../sim/types';
import { tickAt } from '../sim/time';
import { defaultAppearance } from '../shared/appearance';
import { TOWN_NAMES, type TownLook } from '../shared/townNet/protocol';
import { regionIndexAt, townSceneOrigin, townStreetArea, TOWN_SEED, type WalkArea } from '../shared/townNet/street';

export interface TownActor {
  id: number;
  name: number;
  look: TownLook;
  x: number;
  z: number;
  facing: number;
  moving: boolean;
}

export interface TownScene {
  sim: SimulationAPI;
  area: WalkArea;
  /** The agent id the renderer knows a player by. */
  agentId(playerId: number): string;
  /** A world position in the renderer's own coordinates. */
  toScene(x: number, z: number): { x: number; z: number };
  /** Show exactly these zombies (the first is the player's own) at this town time. Returns how many are drawn. */
  show(actors: readonly TownActor[], day: number, minute: number): number;
}

export const agentIdOf = (playerId: number): string => `town_p${playerId}`;

export function createTownScene(): TownScene {
  const state = createNewWorld({
    seed: TOWN_SEED,
    householdName: 'Mildew Lane',
    members: [{ firstName: 'Nobody', lastName: '', appearance: defaultAppearance(), traits: [], aspiration: null }],
    lotTemplate: 'starter',
    difficulty: 'normal',
  });
  // keep one agent record as the pattern for town zombies, then empty the house: nobody lives in the shared town's lot
  const pattern = structuredClone(Object.values(state.agents)[0]) as AgentState;
  for (const id of Object.keys(state.agents)) delete state.agents[id];
  state.household.memberIds = [];
  const sim = createSimulation(state);
  const area = townStreetArea();
  const origin = townSceneOrigin();
  if (state.town?.homeLotId !== 'wormwood:mildew_n2') throw new Error('the shared town world is not centred on the expected lot');

  const show = (actors: readonly TownActor[], day: number, minute: number): number => {
    state.tick = tickAt(Math.max(1, Math.floor(day) + 1), Math.min(1439, Math.max(0, Math.floor(minute))));
    const wanted = new Set<string>();
    let drawn = 0;
    for (const a of actors) {
      const ri = regionIndexAt(area, a.x, a.z);
      if (ri < 0 || !Number.isFinite(a.facing)) continue; // outside the street: never drawn
      const region = area.regions[ri];
      const id = agentIdOf(a.id);
      wanted.add(id);
      const local = { x: a.x - region.placement.originX, z: a.z - region.placement.originZ };
      let ag = state.agents[id];
      if (!ag) {
        ag = structuredClone(pattern);
        ag.id = id;
        ag.role = 'townie';
        ag.firstName = TOWN_NAMES[a.name] ?? TOWN_NAMES[0];
        ag.lastName = '';
        ag.appearance = { ...a.look, voicePitch: 0.5 };
        ag.voiceSeed = a.id;
        ag.queue = [];
        ag.active = null;
        ag.path = null;
        ag.prevPos = { ...local };
        ag.prevFacing = a.facing;
        state.agents[id] = ag;
      } else {
        // a zombie that changed street segment keeps no stale "previous" position from the other segment's grid
        ag.prevPos = ag.regionId === region.id ? { ...ag.pos } : { ...local };
        ag.prevFacing = ag.facing;
      }
      ag.regionId = region.id;
      ag.pos = local;
      ag.facing = a.facing;
      ag.anim = a.moving ? 'walk' : 'idle';
      drawn += 1;
    }
    for (const id of Object.keys(state.agents)) if (!wanted.has(id)) delete state.agents[id];
    return drawn;
  };

  return { sim, area, agentId: agentIdOf, toScene: (x, z) => ({ x: x - origin.x, z: z - origin.z }), show };
}
