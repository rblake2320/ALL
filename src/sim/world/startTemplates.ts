/** W-025 S7 lot data. Existing catalog objects only; unknown templates are refused. */
import { createLotTemplate } from '../spatial/templates';
import { buildRooms, fillFloor, floorObj, newLot, openingObj, wallObj, type TemplateResult, type TemplateRoom } from '../spatial/templates/builder';

export type StartTemplateId = 'derelict' | 'derelict_lean' | 'derelict_lshape' | 'starter' | 'empty' | 'wormwood_bungalow' | 'wormwood_townhouse';
export const START_TEMPLATE_IDS: readonly StartTemplateId[] = ['derelict', 'derelict_lean', 'derelict_lshape', 'starter', 'empty', 'wormwood_bungalow', 'wormwood_townhouse'];
const room = (name: string, x0: number, z0: number, x1: number, z1: number, floor = 'floor_planks_worn', wall = 'wall_plaster_moss'): TemplateRoom => ({ name, x0, z0, x1, z1, floor, wall });

function shack(lshape: boolean): TemplateResult {
  const lot = newLot();
  buildRooms(lot, lshape
    ? [room('main', 10, 13, 15, 19), room('back', 15, 11, 18, 17, 'floor_dirt_packed', 'wall_brick_soot')]
    : [room('main', 12, 11, 16, 19), room('back', 16, 11, 18, 19, 'floor_dirt_packed', 'wall_brick_soot')]);
  const front = lshape ? 12 : 14;
  fillFloor(lot, front, 19, front + 1, 27, 'floor_dirt_packed');
  const objects = [
    openingObj('door_splintered', 'h', front, 19),
    openingObj('door_splintered', 'v', lshape ? 15 : 16, lshape ? 15 : 16),
    openingObj('window_grimy', 'v', lshape ? 10 : 12, lshape ? 16 : 14),
    openingObj('window_grimy', 'h', lshape ? 16 : 17, lshape ? 11 : 19),
    floorObj('coffin_pine', lshape ? 10 : 12, lshape ? 13 : 11, 0),
    floorObj('table_rickety', lshape ? 12 : 14, 15, 0),
    floorObj('chair_creaky', lshape ? 12 : 14, 16, 2),
    floorObj('sink_rusty', 17, 12, 1),
    floorObj('mailbox_crooked', front + 1, 26, 0),
    floorObj('tree_gnarled', 5, 21, 0),
  ];
  return { lot, objects };
}

/** L1 §3.3 authored bungalow, including the empty study and porch. */
function bungalow(): TemplateResult {
  const lot = newLot();
  buildRooms(lot, [
    room('bedroom', 7, 11, 12, 15, 'floor_carpet_plum', 'wall_floral_faded'),
    room('bathroom', 12, 11, 15, 15, 'floor_tile_morgue', 'wall_tile_morgue'),
    room('study', 15, 11, 20, 15, 'floor_planks_worn', 'wall_plaster_bone'),
    room('living', 7, 15, 14, 20), room('kitchen', 14, 15, 20, 20, 'floor_checker_moss', 'wall_stripes_mint'),
  ]);
  fillFloor(lot, 8, 20, 18, 22, 'floor_planks_dark');
  fillFloor(lot, 10, 22, 12, 27, 'floor_stone_crypt');
  const objects = [
    ...([['h',10,20],['h',9,15],['h',13,15],['h',17,15],['v',14,17]] as const).map(([k,x,z]) => openingObj('door_splintered', k, x, z)),
    ...([['h',8,20],['h',12,20],['h',16,20],['h',18,20],['v',7,13],['h',9,11],['h',17,11],['v',20,12],['v',20,17]] as const).map(([k,x,z]) => openingObj('window_grimy', k, x, z)),
    floorObj('coffin_chillrest',7,11,0), floorObj('candelabra_drippy',8,11,0), floorObj('coffin_pine',9,11,0), floorObj('plant_deadfern',11,14,0),
    floorObj('mirror_cracked',12,11,0), floorObj('sink_rusty',13,11,0), floorObj('shower_drizzle',14,11,0),
    floorObj('tv_crt',8,15,0), floorObj('sofa_moldy',8,18,2), floorObj('shelf_moldering',11,15,0), floorObj('lamp_skull',7,15,0), floorObj('armchair_tattered',10,17,3),
    floorObj('fridge_humming',19,15,1), floorObj('counter_butcher',19,16,1), floorObj('stove_greasefire',19,17,1), floorObj('sink_rusty',19,18,1),
    floorObj('trash_lidded',14,15,0), floorObj('table_rickety',16,17,0), floorObj('chair_creaky',16,16,0), floorObj('chair_creaky',16,18,2),
    wallObj('painting_greatgrand','v',14,16,0), floorObj('pew_salvaged',12,20,0), floorObj('mailbox_crooked',12,26,0), floorObj('lantern_post',9,25,0),
    floorObj('plot_budget',24,12,0), floorObj('headstone_decor',24,10,0), floorObj('tree_gnarled',3,8,0), floorObj('tree_gnarled',25,22,0),
  ];
  return { lot, objects };
}

/** L1 §3.4 authored townhouse, with a real interior rather than a render-only shell. */
function townhouse(): TemplateResult {
  const lot = newLot();
  buildRooms(lot, [
    room('bedroom',11,6,15,11,'floor_planks_dark','wall_damask_crimson'),
    room('bathroom',15,6,18,11,'floor_tile_morgue','wall_stripes_mint'),
    room('kitchen',11,11,18,16,'floor_checker_bw','wall_tile_morgue'),
    room('parlour',11,16,18,21,'floor_parquet','wall_damask_midnight'),
  ]);
  fillFloor(lot,14,21,15,28,'floor_stone_crypt'); fillFloor(lot,18,15,22,16,'floor_stone_crypt');
  const objects = [
    openingObj('door_crypt','h',14,21),
    ...([['h',13,16],['h',12,11],['h',16,11],['v',18,15]] as const).map(([k,x,z]) => openingObj('door_splintered',k,x,z)),
    ...([['h',12,21],['h',16,21],['v',11,18],['v',18,18]] as const).map(([k,x,z]) => openingObj('window_gothic',k,x,z)),
    ...([['v',11,13],['h',13,6],['h',16,6],['v',18,8]] as const).map(([k,x,z]) => openingObj('window_grimy',k,x,z)),
    floorObj('coffin_chillrest',11,6,0),floorObj('candelabra_drippy',12,6,0),floorObj('coffin_pine',13,6,0),floorObj('plant_deadfern',14,10,0),
    floorObj('tub_icebath',15,6,0),floorObj('shower_drizzle',17,6,0),floorObj('mirror_cracked',17,10,1),
    floorObj('fridge_humming',17,11,1),floorObj('stove_greasefire',17,12,1),floorObj('counter_butcher',17,13,1),floorObj('sink_rusty',17,14,1),floorObj('trash_lidded',11,11,0),
    floorObj('table_wake',13,13,0),floorObj('chair_creaky',13,12,0),floorObj('chair_creaky',14,12,0),floorObj('chair_creaky',13,14,2),floorObj('chair_creaky',14,14,2),
    floorObj('tv_crt',12,16,0),floorObj('rug_rag',12,17,0),floorObj('sofa_moldy',11,19,2),floorObj('armchair_tattered',15,18,3),floorObj('shelf_moldering',16,16,0),floorObj('lamp_skull',17,20,0),floorObj('table_urnstand',11,16,0),
    wallObj('painting_greatgrand','v',11,17,1),wallObj('sconce_candle','h',14,11,0),floorObj('mailbox_crooked',15,26,0),floorObj('lantern_post',13,25,0),floorObj('plot_budget',22,12,0),floorObj('headstone_decor',22,10,0),floorObj('tree_gnarled',5,10,0),floorObj('tree_gnarled',24,22,0),
  ];
  return { lot, objects };
}

export function createStartTemplate(templateId: string): TemplateResult {
  switch (templateId) {
    case 'derelict': case 'starter': case 'empty': return createLotTemplate(templateId);
    case 'derelict_lean': return shack(false);
    case 'derelict_lshape': return shack(true);
    case 'wormwood_bungalow': return bungalow();
    case 'wormwood_townhouse': return townhouse();
    default: throw new Error(`Unknown start template: ${templateId}`);
  }
}
