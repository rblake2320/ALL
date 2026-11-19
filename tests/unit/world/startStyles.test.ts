import { expect, it } from 'vitest';
import { FLOOR_STYLES } from '../../../src/shared/styles';

// Exact shipped values at S1/S2 pin71d290f. New terrain cannot silently alter old saves' appearance/value.
const original = [
  ['floor_planks_worn', 'Worn Planks', 5, 'planks', '#7a5a3e', '#5e4430'],
  ['floor_planks_dark', 'Ebony Planks', 8, 'planks', '#3e2c22', '#2c1f18'],
  ['floor_parquet', 'Mourning Parquet', 10, 'parquet', '#8a6440', '#6a4a2e'],
  ['floor_checker_bw', 'Diner Checker', 7, 'checker', '#e6e0d0', '#2a2a2e'],
  ['floor_checker_moss', 'Moss Checker', 7, 'checker', '#a3b38f', '#4f5e45'],
  ['floor_carpet_plum', 'Plum Shag Carpet', 6, 'carpet', '#5b3f6e', '#4b3260'],
  ['floor_carpet_blood', 'Wine-Dark Carpet', 6, 'carpet', '#5a1f28', '#46161e'],
  ['floor_tile_morgue', 'Morgue Tile', 8, 'tile', '#d4dcd6', '#b0bdb5'],
  ['floor_stone_crypt', 'Crypt Flagstone', 9, 'stone', '#77736b', '#5a5650'],
  ['floor_marble_black', 'Black Marble', 14, 'marble', '#1f1f24', '#56565e'],
  ['floor_dirt_packed', 'Packed Grave Dirt', 1, 'dirt', '#5a4634', '#463626'],
].map(([id, name, price, pattern, base, accent]) => ({ id, name, price, pattern, base, accent }));

it('preserves every original floor property and adds exactly two one-dollar dirt-pattern terrain styles', () => {
  expect(FLOOR_STYLES.slice(0, original.length)).toEqual(original);
  expect(FLOOR_STYLES.slice(original.length).map(s => ({ id: s.id, price: s.price, pattern: s.pattern }))).toEqual([
    { id: 'floor_mud_yard', price: 1, pattern: 'dirt' }, { id: 'floor_leaf_litter', price: 1, pattern: 'dirt' },
  ]);
  expect(new Set(FLOOR_STYLES.map(s => s.id)).size).toBe(FLOOR_STYLES.length);
});
