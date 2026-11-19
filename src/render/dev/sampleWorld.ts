/**
 * DEV-ONLY hand-built WorldState for the render harness: a 30×30 lot with a five-room crooked house (doors,
 * windows, painted walls, floors), ~50 furnishings, loose items and a few zombies doing things (walking,
 * watching TV, sleeping in a coffin, dancing while reeking) plus a walk-by on the sidewalk.
 */
import type { AgentState, LotState, ObjectPlacement, ObjectState, WallSegment, WorldState } from '../../sim/types';
import { TICKS_PER_HOUR } from '../../sim/types';
import { defaultAppearance, type ZombieAppearance, type AnimState } from '../../shared/appearance';
import { DIM, localToWorld, rotYaw, type Rot } from '../../shared/dimensions';
import { PHYSICAL_BY_ID } from '../../shared/catalog';
import { tickAt } from '../../sim/time';
import { canonicalStartPick, newTown } from '../../shared/town';

export interface SampleOptions {
  stress?: boolean;
  /**
   * W-025 S5: give the world a `town` block (canonical start at wormwood:mildew_n2) so the renderer draws the walkable
   * world; `worldAgents` extra zombies stand in neighbour lots / streets (the AC-8 '32 agents' perf scene).
   */
  world?: boolean;
  worldAgents?: number;
  /** Extra props for the FX showcase (fire on the stove, bone pile glow…). */
  fx?: boolean;
}

const EXT = 'wall_exterior_siding';

export function emptyLot(): LotState {
  return {
    width: 30,
    depth: 30,
    buildable: { x0: 1, z0: 1, x1: 29, z1: 27 },
    sidewalkZ: 28,
    entryPoints: [
      { x: 0.5, z: 28.5 },
      { x: 29.5, z: 28.5 },
    ],
    walls: {},
    floors: new Array(900).fill(null),
    version: 1,
    wallVersion: 1,
    floorVersion: 1,
  };
}

function wall(lot: LotState, kind: 'h' | 'v', x: number, z: number, p0: string, p1: string): void {
  const seg: WallSegment = { paint: [p0, p1], openingId: null };
  lot.walls[`${kind}:${x}:${z}`] = seg;
}

function floorRect(lot: LotState, x0: number, z0: number, x1: number, z1: number, style: string): void {
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) lot.floors[z * lot.width + x] = style;
}

/** Room interior paint by tile (room rectangles). */
interface Room {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  paint: string;
  floor: string;
}

const ROOMS: Room[] = [
  { x0: 6, z0: 13, x1: 14, z1: 20, paint: 'wall_damask_crimson', floor: 'floor_parquet' }, // living
  { x0: 14, z0: 13, x1: 20, z1: 20, paint: 'wall_stripes_mint', floor: 'floor_checker_bw' }, // kitchen
  { x0: 6, z0: 8, x1: 12, z1: 13, paint: 'wall_floral_faded', floor: 'floor_carpet_plum' }, // bedroom
  { x0: 12, z0: 8, x1: 15, z1: 13, paint: 'wall_tile_morgue', floor: 'floor_tile_morgue' }, // bath
  { x0: 15, z0: 8, x1: 20, z1: 13, paint: 'wall_wood_panel', floor: 'floor_planks_dark' }, // study
];

function roomPaintAt(x: number, z: number): string {
  for (const r of ROOMS) if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return r.paint;
  return EXT;
}

function buildHouse(lot: LotState): void {
  // every edge between two different regions gets a wall, painted per side
  const inHouse = (x: number, z: number) => x >= 6 && x < 20 && z >= 8 && z < 20;
  const roomIndex = (x: number, z: number) => ROOMS.findIndex((r) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1);
  for (let z = 7; z <= 20; z++)
    for (let x = 5; x <= 20; x++) {
      // horizontal edge on line z between (x, z-1) and (x, z)
      if (x >= 6 && x < 20) {
        const a = inHouse(x, z - 1) ? roomIndex(x, z - 1) : -1;
        const b = inHouse(x, z) ? roomIndex(x, z) : -1;
        if (a !== b) wall(lot, 'h', x, z, roomPaintAt(x, z - 1), roomPaintAt(x, z));
      }
      // vertical edge on line x between (x-1, z) and (x, z)
      if (z >= 8 && z < 20) {
        const a = inHouse(x - 1, z) ? roomIndex(x - 1, z) : -1;
        const b = inHouse(x, z) ? roomIndex(x, z) : -1;
        if (a !== b) wall(lot, 'v', x, z, roomPaintAt(x - 1, z), roomPaintAt(x, z));
      }
    }
  for (const r of ROOMS) floorRect(lot, r.x0, r.z0, r.x1, r.z1, r.floor);
  // porch + garden path
  floorRect(lot, 9, 20, 12, 22, 'floor_stone_crypt');
  floorRect(lot, 10, 22, 11, 28, 'floor_stone_crypt');
}

let nextObj = 1;

function obj(world: WorldState, defId: string, placement: ObjectPlacement, extra: Partial<ObjectState> = {}): ObjectState {
  const id = `o${nextObj++}`;
  const o: ObjectState = {
    id,
    defId,
    placement,
    value: PHYSICAL_BY_ID[defId]?.price ?? 0,
    purchasedTick: 0,
    tint: null,
    condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data: {},
    reservedBy: {},
    inUseBy: [],
    rev: 1,
    ...extra,
  };
  world.objects[id] = o;
  return o;
}

const floor = (x: number, z: number, rot: Rot = 0): ObjectPlacement => ({ kind: 'floor', x, z, rot });
const loose = (x: number, y: number, z: number, facing = 0): ObjectPlacement => ({ kind: 'loose', x, y, z, facing, parentId: null, surfaceIndex: null });

function opening(world: WorldState, defId: string, edge: string): void {
  const o = obj(world, defId, { kind: 'opening', edge });
  const seg = world.lot.walls[edge];
  if (seg) seg.openingId = o.id;
}

function appearance(p: Partial<ZombieAppearance>): ZombieAppearance {
  return { ...defaultAppearance(), ...p };
}

function agent(world: WorldState, id: string, first: string, app: ZombieAppearance, x: number, z: number, facing: number, anim: AnimState, extra: Partial<AgentState> = {}): AgentState {
  const a: AgentState = {
    id,
    role: 'household',
    presence: 'onLot',
    firstName: first,
    lastName: 'Gravesend',
    appearance: app,
    traits: [],
    rewardTraits: [],
    aspiration: null,
    aspirationMilestones: [],
    aspirationPoints: 0,
    needs: { hunger: 70, energy: 70, preservation: 80, social: 60, fun: 60, hygiene: 70 },
    vitality: 100,
    moodlets: [],
    skills: {
      cooking: { level: 0, xp: 0 },
      charisma: { level: 0, xp: 0 },
      mortuary: { level: 0, xp: 0 },
      logic: { level: 0, xp: 0 },
      creativity: { level: 0, xp: 0 },
      fitness: { level: 0, xp: 0 },
    },
    career: null,
    limbs: { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' },
    pos: { x, z },
    prevPos: { x, z },
    posY: 0,
    facing,
    prevFacing: facing,
    path: null,
    pathIndex: 0,
    queue: [],
    active: null,
    anim,
    expression: 'neutral',
    carrying: null,
    carryObjectId: null,
    status: { zeroPreservationMinutes: 0, passedOut: false, feral: false, autonomyCooldownUntil: 0, lastSocialTick: 0, autonomyFails: 0, bonePileId: null, crumbledTick: null },
    visit: null,
    walkBy: null,
    voiceSeed: id.length * 7,
    createdTick: 0,
    occupation: null,
    ...extra,
  };
  world.agents[id] = a;
  return a;
}

/** World pose of a catalog slot on a placed floor object. */
export function slotPose(defId: string, x: number, z: number, rot: Rot, slotIndex = 0): { x: number; z: number; y: number; facing: number } {
  const spec = PHYSICAL_BY_ID[defId];
  const slot = spec?.slots[slotIndex];
  const pose = slot?.pose ?? { x: spec.footprint.w / 2, z: spec.footprint.d / 2, y: 0 };
  const p = localToWorld(spec.footprint.w, spec.footprint.d, x, z, rot, pose.x, pose.z);
  return { x: p.x, z: p.z, y: pose.y, facing: rotYaw(rot) + (slot?.facing ?? 0) };
}

export function buildSampleWorld(opts: SampleOptions = {}): WorldState {
  nextObj = 1;
  const lot = emptyLot();
  const world: WorldState = {
    schemaVersion: 1,
    seed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    tick: tickAt(1, 12 * 60),
    nextId: 1000,
    household: { name: 'Gravesend', funds: 6500, memberIds: ['a1', 'a2', 'a3', 'a4'], bills: [{ id: 'b1', issuedTick: 0, dueTick: 999999, amount: 120, paidTick: null, stage: 0 }], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot,
    agents: {},
    objects: {},
    relationships: {},
    notifications: [],
    choices: [],
    party: null,
    flags: {},
    stats: { counters: {}, agent: {} },
    settings: { autonomy: 'full', difficulty: 'normal', visitorsEnabled: true },
    gameOver: false,
  };
  buildHouse(lot);
  // doors & windows
  opening(world, 'door_crypt', 'h:10:20');
  opening(world, 'door_splintered', 'h:9:13');
  opening(world, 'door_splintered', 'h:13:13');
  opening(world, 'door_splintered', 'h:17:13');
  opening(world, 'door_splintered', 'v:14:16');
  opening(world, 'door_splintered', 'h:17:8');
  for (const e of ['h:7:20', 'h:16:20', 'h:18:20', 'v:6:15', 'v:6:10', 'v:20:16', 'v:20:10', 'h:8:8', 'h:14:8']) opening(world, 'window_grimy', e);
  opening(world, 'window_gothic', 'h:12:20');
  // living room
  obj(world, 'tv_crt', floor(9, 13, 0));
  const sofaObject = obj(world, 'sofa_velvet', floor(8, 17, 2), { tint: '#4b1f3a' });
  obj(world, 'rug_funeral', floor(8, 15, 0));
  obj(world, 'table_coffinlid', floor(9, 15, 0));
  obj(world, 'armchair_tattered', floor(12, 16, 1), { tint: '#3f5a4a' });
  obj(world, 'lamp_skull', floor(7, 13, 0));
  obj(world, 'shelf_moldering', floor(13, 13, 0));
  obj(world, 'candelabra_drippy', floor(12, 18, 0));
  obj(world, 'plant_deadfern', floor(6, 19, 0));
  obj(world, 'stereo_boombox', floor(6, 13, 3), { inUseBy: ['a4'] });
  obj(world, 'painting_greatgrand', { kind: 'wall', edge: 'h:11:13', side: 1 });
  obj(world, 'sconce_candle', { kind: 'wall', edge: 'v:6:17', side: 1 });
  obj(world, 'sconce_candle', { kind: 'wall', edge: 'v:14:18', side: 0 });
  // kitchen
  obj(world, 'microwave_nuke', floor(14, 13, 0));
  obj(world, 'counter_butcher', floor(15, 13, 0));
  obj(world, 'stove_greasefire', floor(16, 13, 0), opts.fx ? { condition: { broken: false, dirt: 0.2, burning: false, burnMinutes: 0 } } : {});
  obj(world, 'counter_slab', floor(17, 13, 0));
  obj(world, 'sink_rusty', floor(18, 13, 0));
  obj(world, 'fridge_humming', floor(19, 13, 0));
  obj(world, 'table_wake', floor(16, 16, 0));
  obj(world, 'chair_creaky', floor(16, 17, 2));
  obj(world, 'chair_creaky', floor(17, 17, 2));
  obj(world, 'chair_ribcage', floor(16, 15, 0));
  obj(world, 'chair_ribcage', floor(17, 15, 0));
  obj(world, 'trash_lidded', floor(19, 19, 2));
  obj(world, 'item_meal', loose(17, DIM.TABLE_HEIGHT, 16.5), { data: { servings: 3 } });
  obj(world, 'item_dish', loose(15.5, DIM.COUNTER_HEIGHT, 13.5), { data: { createdTick: 0 }, purchasedTick: 0 });
  obj(world, 'item_dish', loose(16.6, DIM.TABLE_HEIGHT, 16.3), { data: { createdTick: world.tick - 8 * TICKS_PER_HOUR } });
  obj(world, 'sconce_candle', { kind: 'wall', edge: 'v:20:14', side: 0 });
  // bedroom
  obj(world, 'coffin_pine', floor(7, 9, 0));
  obj(world, 'sarcophagus_cryo', floor(9, 9, 0));
  obj(world, 'mirror_cracked', floor(11, 8, 0));
  obj(world, 'lamp_skull', floor(6, 8, 0));
  obj(world, 'painting_greatgrand', { kind: 'wall', edge: 'v:6:11', side: 1 });
  // bath
  obj(world, 'shower_drizzle', floor(12, 8, 0));
  obj(world, 'tub_icebath', floor(13, 10, 3));
  obj(world, 'sink_rusty', floor(14, 8, 0));
  // study
  obj(world, 'desk_hauntedpc', floor(19, 11, 2));
  obj(world, 'easel_morbid', floor(16, 9, 0), { data: { progress: 0.6 } });
  obj(world, 'table_bonechess', floor(15, 11, 0));
  obj(world, 'gym_limb', floor(17, 8, 0));
  obj(world, 'shelf_moldering', floor(15, 8, 0));
  // yard
  obj(world, 'mailbox_crooked', floor(12, 26, 0), { data: { mail: 1 } });
  obj(world, 'lantern_post', floor(8, 22, 0));
  obj(world, 'lantern_post', floor(13, 22, 0));
  obj(world, 'headstone_decor', floor(3, 24, 0));
  obj(world, 'headstone_decor', floor(4, 25, 0));
  obj(world, 'tree_gnarled', floor(25, 9, 0));
  obj(world, 'tree_gnarled', floor(3, 5, 0));
  obj(world, 'plot_budget', floor(24, 20, 0));
  obj(world, 'zapper_fly', floor(22, 16, 0));
  obj(world, 'item_limb_arm', loose(11.4, 0, 15.6, 0.7));
  obj(world, 'item_bonepile', loose(21.5, 0, 23.5, 0));
  if (opts.fx) {
    obj(world, 'item_fire', loose(16.5, DIM.COUNTER_HEIGHT + 0.12, 13.5, 0));
    obj(world, 'item_ash', loose(23.5, 0, 25.5, 0));
  }
  // zombies
  agent(world, 'a1', 'Mortimer', appearance({ skinTone: 0, hairStyle: 'combover', hairColor: '#4a3b32', topStyle: 'cardigan', topColor: '#6e3b3b', bottomColor: '#3a3f55', height: 0.7 }), 11.5, 15.5, 0, 'walk', {
    path: [
      { x: 11.5, z: 15.5 },
      { x: 11.5, z: 14.5 },
      { x: 12.5, z: 14.5 },
      { x: 11.5, z: 16.5 },
    ],
  });
  const sofa = slotPose('sofa_velvet', 8, 17, 2, 1);
  agent(world, 'a2', 'Ophelia', appearance({ skinTone: 5, hairStyle: 'bob', hairColor: '#2d2236', topStyle: 'dress', topColor: '#2c2346', eyeColor: '#c8ff9a', height: 0.4 }), sofa.x, sofa.z, sofa.facing, 'sitTV', {
    posY: sofa.y, expression: 'happy',
    // Match a real seated interaction so AgentManager applies the same body-specific fit as gameplay.
    active: { uid: 1, interactionId: 'home_sit', target: { kind: 'object', id: sofaObject.id }, params: {}, source: 'player', priority: 200,
      queuedTick: world.tick, phase: 'run', stage: 0, stageTarget: { kind: 'object', id: sofaObject.id }, slot: 1,
      routeGoal: { x: sofa.x, z: sofa.z }, pose: sofa, startedRunTick: world.tick, elapsed: 0, duration: 60,
      partnerId: null, routeFails: 0, waitMinutes: 0, data: {}, canceled: false },
  });
  const coffin = slotPose('coffin_pine', 7, 9, 0, 0);
  agent(world, 'a3', 'Grimsby', appearance({ skinTone: 7, hairStyle: 'bald', topStyle: 'suit', topColor: '#25294a', height: 0.9, build: 0.7 }), coffin.x, coffin.z, coffin.facing, 'sleep', { posY: coffin.y, expression: 'sleepy' });
  agent(world, 'a4', 'Bertha', appearance({ skinTone: 3, hairStyle: 'bun', hairColor: '#7a3a2a', topStyle: 'blouse', topColor: '#7a6a3a', bottomStyle: 'skirt', bottomColor: '#4a3259', build: 0.8 }), 8.2, 14.3, 0.6, 'dance', {
    needs: { hunger: 50, energy: 60, preservation: 35, social: 70, fun: 90, hygiene: 6 },
    limbs: { armL: 'ok', armR: 'prosthetic', legL: 'ok', legR: 'ok' },
  });
  agent(world, 'a5', 'Ezekiel', appearance({ skinTone: 4, hairStyle: 'messy', topStyle: 'hoodie', topColor: '#3f5a4a', height: 0.55 }), 0.5, 28.5, Math.PI / 2, 'walk', {
    role: 'townie',
    path: [
      { x: 0.5, z: 28.5 },
      { x: 29.5, z: 28.5 },
    ],
  });
  if (opts.stress) addStress(world);
  if (opts.world) addWorld(world, opts.worldAgents ?? 0);
  return world;
}

/** W-025 S5: the walkable world around the sample lot (+ zombies in other regions, lot-local to their region). */
function addWorld(world: WorldState, extra: number): void {
  world.town = newTown(world.seed, canonicalStartPick('starter'));
  const spots: [string, number, number][] = [
    ['wormwood:mildew_n1', 14.5, 26.5],
    ['wormwood:mildew_n3', 15.5, 25.5],
    ['street:mildew:2', 8.5, 0.5],
    ['street:mildew:3', 20.5, 9.5],
    ['wormwood:mildew_s2', 13.5, 26.5],
    ['wormwood:mildew_s1', 16.5, 25.5],
    ['wormwood:mildew_s3', 12.5, 27.5],
    ['street:mildew:1', 25.5, 0.5],
  ];
  for (let i = 0; i < extra; i++) {
    const [regionId, x, z] = spots[i % spots.length];
    const ox = (Math.floor(i / spots.length) % 3) * 1.4;
    const a = agent(world, `w${i}`, `Neighbour${i}`, appearance({ skinTone: (i * 3) % 10, hairStyle: (['messy', 'afro', 'bun', 'bob', 'buzz'] as const)[i % 5], topColor: ['#3f5a4a', '#5b3f6e', '#7a6a3a', '#25294a'][i % 4] }), x + ox, z, Math.PI, i % 3 === 0 ? 'walk' : 'idle', {
      role: 'townie',
      path: i % 3 === 0 ? [{ x: x + ox, z }, { x: x + ox + 3, z }] : null,
    });
    a.regionId = regionId;
  }
}

/** Perf scene: 15 zombies and ~150 objects. */
function addStress(world: WorldState): void {
  const skins = [1, 2, 6, 8, 9];
  for (let i = 0; i < 10; i++) {
    const x = 2.5 + (i % 5) * 5;
    const z = 21.5 + Math.floor(i / 5) * 3;
    agent(world, `s${i}`, `Extra${i}`, appearance({ skinTone: skins[i % skins.length], hairStyle: (['messy', 'afro', 'mohawk', 'long', 'buzz'] as const)[i % 5], topColor: ['#5b3f6e', '#6e2a35', '#3f5a4a', '#7a6a3a'][i % 4] }), x, z, 0, 'walk', {
      path: [
        { x, z },
        { x: x + 2, z },
        { x: x + 2, z: z + 2 },
        { x, z: z + 2 },
      ],
      role: 'townie',
    });
  }
  const props = ['headstone_decor', 'lantern_post', 'plant_carnivorous', 'tree_gnarled', 'plant_deadfern', 'crate_prosthetic', 'kit_reanimation', 'diffuser_formaldehyde'];
  let n = 0;
  for (let z = 1; z < 8 && n < 100; z += 1)
    for (let x = 1; x < 29 && n < 100; x += 1) {
      if ((x + z) % 2 === 0) continue;
      obj(world, props[n % props.length], floor(x, z, (n % 4) as Rot));
      n++;
    }
}
