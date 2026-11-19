/**
 * LOT TEMPLATES (SIM-SPATIAL) — createLotTemplate(id) + LOT_TEMPLATE_INFO.
 *
 * Coordinates: tile (x,z), X right, Z toward the street; the house front faces +Z (the sidewalk at z = 28).
 *
 * STARTER — "Fixer-Upper on Mildew Lane": an 11-wide cottage (x 9..19) whose bathroom juts one row out the back
 * (z 9) and whose interior walls don't quite line up — charmingly crooked.
 *
 *        x:  9    10    11    12    13    14 | 15    16    17    18    19
 *   z= 9                                     |       MIR   .     .     SHW      <- bathroom bump-out
 *   z=10    .    CFN   CAN   CHL   .     .  F|  .    .     .     .     .
 *   z=11    .    CFN   .     CHL   .     .   |  .    .     .     .     .
 *   z=12    .    .     .     .     .     .   |  .    .     .     .     .      bedroom (x 9..15) | bathroom (x 16..19)
 *   z=13    .    .     .     .     D     .   .  .    D     .     .     .
 *   z=14    LMP  .     TV    SHF   .     .  |TRS   .     .     .     FRG
 *   z=15    .    .     .     .     .    ARM |  .   CHR   CHR    .    STV
 *   z=16    COF  COF   RUG   RUG   .     .  D  .   TBL   TBL    .    CTR
 *   z=17    .    .     RUG   RUG   .     .  |  .   CHR   CHR    .    SNK
 *   z=18    .    SOF   SOF   .     .     .  |  .    .     .     .    CTR      living (x 9..14) | kitchen (x 15..19)
 *   z=19 ─────────────────────────── D (front door h:14:19) ──────────────
 *   z=19..26 flagstone path at x = 14; mailbox (15,26); lantern (13,25)
 *
 * Doors (door_splintered): front h:14:19, bedroom h:13:14, kitchen v:15:16, bathroom h:17:14.
 * Windows (window_grimy): h:11:19, v:9:16, h:17:19, v:20:17, h:11:10, v:9:12, h:18:9.
 * Yard: plot_budget (5,12) with headstone_decor (5,10) at its head, 2x tree_gnarled, lantern_post, mailbox.
 * Every object passes checkPlace / checkWallItem / checkOpening and every slot is reachable from both sidewalk
 * entry points (tests/unit/spatial/templates.test.ts).
 *
 * EMPTY — "Empty Plot": a mailbox by the sidewalk and one gnarled tree; nothing else.
 *
 * DERELICT — "The Condemned Shack on Mildew Lane" (W-113 story start, docs/systems/story-start.md): a small, run-down
 * two-room shack the zombie claims. Mostly bare on purpose — the player buys the kitchen and the shower.
 *
 *        x:  11    12    13    14    15 | 16    17    18
 *   z=13    CFN   .     .     .     .   |  .     .     .
 *   z=14    CFN   .     .     .     .   |  .     .    SNK      main room (x 11..15, worn planks, two rotten patches)
 *   z=15    .     .     .    TBL    .   |  .     .     .       back room (x 16..18, packed dirt)
 *   z=16  W .     .     .    CHR    .   D  .     .     .
 *   z=17    .     ~     ~     .     .   |  .     .     .       ~ = rotten boards (packed dirt)
 *   z=18    .     .     .     .     .   |  .     .     .
 *   z=19 ──────────── D (front door h:13:19) ─────── W (h:17:19) ──
 *   z=19..26 dirt path at x = 13; mailbox (14,26); one dead tree (5,21)
 *
 * Doors (door_splintered): front h:13:19, partition v:16:16. Windows (window_grimy): v:11:16, h:17:19.
 * One interior partition (x = 16). Inside: a pine coffin, a rickety table + one chair, a rusty sink. No fridge, stove,
 * microwave or shower.
 */
import type { LotTemplate, LotTemplateId } from '../../contracts';
import { buildRooms, fillFloor, floorObj, newLot, openingObj, wallObj, type TemplateObject, type TemplateResult, type TemplateRoom } from './builder';

export { linkOpenings, type TemplateObject, type TemplateResult } from './builder';

export const LOT_TEMPLATE_INFO: LotTemplate[] = [
  {
    id: 'derelict',
    name: 'The Condemned Shack on Mildew Lane',
    description:
      'A two-room shack with a busted coffin, a rickety table and a sink that coughs rust. Claim it, patch it, make it home — the story starts here.',
    startingFunds: 2500,
  },
  {
    id: 'starter',
    name: 'Fixer-Upper on Mildew Lane',
    description:
      'A charming, slightly crooked cottage with four furnished rooms, a burial plot out back and plenty of character (mostly mildew). Less house to buy means more money for embalming.',
    startingFunds: 6500,
  },
  {
    id: 'empty',
    name: 'Empty Plot',
    description:
      'A bare patch of Mildew Lane with a mailbox and one gnarled tree. Build the crypt of your dreams from scratch — the bank is feeling generous.',
    startingFunds: 22000,
  },
];

const STARTER_ROOMS: TemplateRoom[] = [
  { name: 'bedroom', x0: 9, z0: 10, x1: 16, z1: 14, floor: 'floor_planks_dark', wall: 'wall_damask_midnight' },
  { name: 'bathroom', x0: 16, z0: 9, x1: 20, z1: 14, floor: 'floor_tile_morgue', wall: 'wall_stripes_mint' },
  { name: 'living', x0: 9, z0: 14, x1: 15, z1: 19, floor: 'floor_planks_worn', wall: 'wall_stripes_plum' },
  { name: 'kitchen', x0: 15, z0: 14, x1: 20, z1: 19, floor: 'floor_checker_bw', wall: 'wall_tile_morgue' },
];

function starter(): TemplateResult {
  const lot = newLot();
  buildRooms(lot, STARTER_ROOMS);
  // Front path from the door to the curb verge.
  fillFloor(lot, 14, 19, 15, 27, 'floor_stone_crypt');

  const o: TemplateObject[] = [];
  // ── openings ──
  o.push(openingObj('door_splintered', 'h', 14, 19, '#4a3326')); // front door (street-facing wall)
  o.push(openingObj('door_splintered', 'h', 13, 14, '#6b4a35')); // living -> bedroom
  o.push(openingObj('door_splintered', 'v', 15, 16, '#6b4a35')); // living -> kitchen
  o.push(openingObj('door_splintered', 'h', 17, 14, '#8a6a4a')); // kitchen -> bathroom
  for (const [k, x, z] of [
    ['h', 11, 19],
    ['v', 9, 16],
    ['h', 17, 19],
    ['v', 20, 17],
    ['h', 11, 10],
    ['v', 9, 12],
    ['h', 18, 9],
  ] as const) {
    o.push(openingObj('window_grimy', k, x, z, '#6b4a35'));
  }

  // ── living room ──
  o.push(floorObj('tv_crt', 11, 14, 0, '#4a3326')); // screen faces +Z; viewing tiles (11,16) & (11,17) stay clear
  o.push(floorObj('sofa_moldy', 10, 18, 2, '#3f5a4a')); // faces -Z toward the TV
  o.push(floorObj('armchair_tattered', 14, 15, 1, '#6e3b3b')); // faces -X, angled at the TV
  o.push(floorObj('rug_rag', 11, 16, 0, '#5b3f6e')); // under the viewing tiles
  o.push(floorObj('table_coffinlid', 9, 16, 0, '#4a3326')); // beside the sofa's left seat
  o.push(floorObj('lamp_skull', 9, 14, 0));
  // A second real fun source (and the only Logic source for Necro-Tech promotions) — balance pass: with the TV alone a
  // worker's evenings were 26–31 % TV (docs/BALANCE.md). Back to the bedroom wall, reading spot (12,15) stays clear.
  o.push(floorObj('shelf_moldering', 12, 14, 0, '#4a3326'));
  o.push(wallObj('painting_greatgrand', 'v', 9, 15, 1)); // west wall, facing into the living room

  // ── kitchen + dining ──
  o.push(floorObj('fridge_humming', 19, 14, 1, '#cfd6c4')); // counter run along the east wall, fronts face -X
  o.push(floorObj('stove_greasefire', 19, 15, 1, '#d8cfb8'));
  o.push(floorObj('counter_butcher', 19, 16, 1, '#6b4a35'));
  o.push(floorObj('sink_rusty', 19, 17, 1, '#6b4a35')); // under the east window
  o.push(floorObj('counter_butcher', 19, 18, 1, '#6b4a35'));
  o.push(floorObj('trash_lidded', 15, 14, 0, '#6d7275'));
  o.push(floorObj('table_wake', 16, 16, 0, '#4a3326'));
  o.push(floorObj('chair_creaky', 16, 15, 0, '#6b4a35')); // north chairs face +Z (the table)
  o.push(floorObj('chair_creaky', 17, 15, 0, '#6b4a35'));
  o.push(floorObj('chair_creaky', 16, 17, 2, '#6b4a35')); // south chairs face -Z (the table)
  o.push(floorObj('chair_creaky', 17, 17, 2, '#6b4a35'));

  // ── bedroom ──
  o.push(floorObj('coffin_pine', 10, 10, 0, '#8a6a4a')); // heads at the back wall
  o.push(floorObj('candelabra_drippy', 11, 10, 0));
  // Balance pass "starter home restorer" (docs/BALANCE.md): the second coffin is a Chill-Rest — a freshness source that
  // does not depend on the fridge (a kitchen fire that took the fridge used to crumble an unattended household by day 5).
  o.push(floorObj('coffin_chillrest', 12, 10, 0, '#6b4a35'));
  o.push(floorObj('plant_deadfern', 15, 10, 0));
  o.push(wallObj('sconce_candle', 'h', 10, 14, 0)); // on the bedroom side of the bedroom/living wall

  // ── bathroom ──
  o.push(floorObj('mirror_cracked', 16, 9, 0, '#4a3326'));
  o.push(floorObj('shower_drizzle', 19, 9, 0, '#cfd6c4'));

  // ── yard ──
  o.push(floorObj('mailbox_crooked', 15, 26, 0));
  o.push(floorObj('lantern_post', 13, 25, 0));
  o.push(floorObj('plot_budget', 5, 12, 0));
  o.push(floorObj('headstone_decor', 5, 10, 0));
  o.push(floorObj('tree_gnarled', 4, 21, 0));
  o.push(floorObj('tree_gnarled', 24, 11, 0));
  return { lot, objects: o };
}

function empty(): TemplateResult {
  const lot = newLot();
  return {
    lot,
    objects: [floorObj('mailbox_crooked', 15, 26, 0), floorObj('tree_gnarled', 6, 21, 0)],
  };
}

const DERELICT_ROOMS: TemplateRoom[] = [
  { name: 'main', x0: 11, z0: 13, x1: 16, z1: 19, floor: 'floor_planks_worn', wall: 'wall_plaster_moss' },
  { name: 'back', x0: 16, z0: 13, x1: 19, z1: 19, floor: 'floor_dirt_packed', wall: 'wall_brick_soot' },
];

function derelict(): TemplateResult {
  const lot = newLot();
  buildRooms(lot, DERELICT_ROOMS);
  fillFloor(lot, 12, 17, 14, 18, 'floor_dirt_packed'); // rotten boards
  fillFloor(lot, 13, 19, 14, 27, 'floor_dirt_packed'); // trodden path to the curb
  const o: TemplateObject[] = [];
  o.push(openingObj('door_splintered', 'h', 13, 19, '#4a3326')); // front door
  o.push(openingObj('door_splintered', 'v', 16, 16, '#5e4430')); // main -> back room
  o.push(openingObj('window_grimy', 'v', 11, 16, '#5e4430'));
  o.push(openingObj('window_grimy', 'h', 17, 19, '#5e4430'));
  o.push(floorObj('coffin_pine', 11, 13, 0, '#6b5a4a')); // the busted coffin, head at the back wall
  o.push(floorObj('table_rickety', 14, 15, 0, '#5e4430'));
  o.push(floorObj('chair_creaky', 14, 16, 2, '#5e4430')); // faces -Z, toward the table
  o.push(floorObj('sink_rusty', 18, 14, 1, '#6b5a4a')); // against the back room's east wall
  o.push(floorObj('mailbox_crooked', 14, 26, 0));
  o.push(floorObj('tree_gnarled', 5, 21, 0));
  return { lot, objects: o };
}

/** Fresh (deep, unshared) lot + object list for a template id. Unknown ids fall back to the empty plot. */
export function createLotTemplate(id: LotTemplateId): TemplateResult {
  return id === 'starter' ? starter() : id === 'derelict' ? derelict() : empty();
}
