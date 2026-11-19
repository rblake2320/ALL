/**
 * Build-mode surface styles. The renderer generates procedural textures from `pattern` + colours;
 * the simulation charges `price`; the UI shows `name` and a swatch.
 */
export type WallPattern = 'plaster' | 'stripes' | 'damask' | 'brick' | 'wood' | 'tile' | 'stone' | 'wallpaperFloral';
export type FloorPattern = 'planks' | 'checker' | 'carpet' | 'stone' | 'tile' | 'dirt' | 'parquet' | 'marble';

export interface WallStyle {
  id: string;
  name: string;
  price: number; // per segment side
  pattern: WallPattern;
  base: string;
  accent: string;
}

export interface FloorStyle {
  id: string;
  name: string;
  price: number; // per tile
  pattern: FloorPattern;
  base: string;
  accent: string;
}

export const WALL_STYLES: WallStyle[] = [
  { id: 'wall_plaster_bone', name: 'Bone Plaster', price: 2, pattern: 'plaster', base: '#d9cfb8', accent: '#bfb398' },
  { id: 'wall_plaster_moss', name: 'Moss Plaster', price: 2, pattern: 'plaster', base: '#8fa184', accent: '#76896c' },
  { id: 'wall_stripes_plum', name: 'Plum Pinstripe', price: 4, pattern: 'stripes', base: '#5b3f6e', accent: '#4a3259' },
  { id: 'wall_stripes_mint', name: 'Embalmer Mint Stripe', price: 4, pattern: 'stripes', base: '#a9cbb7', accent: '#8fb39e' },
  { id: 'wall_damask_crimson', name: 'Crimson Damask', price: 6, pattern: 'damask', base: '#6e2a35', accent: '#8a3a46' },
  { id: 'wall_damask_midnight', name: 'Midnight Damask', price: 6, pattern: 'damask', base: '#25294a', accent: '#363c66' },
  { id: 'wall_floral_faded', name: 'Faded Funeral Florals', price: 5, pattern: 'wallpaperFloral', base: '#c9b9a0', accent: '#8e6a6a' },
  { id: 'wall_brick_soot', name: 'Sooty Brick', price: 5, pattern: 'brick', base: '#6e4a3e', accent: '#4a3028' },
  { id: 'wall_wood_panel', name: 'Coffin Oak Panelling', price: 7, pattern: 'wood', base: '#5e4030', accent: '#4a3124' },
  { id: 'wall_tile_morgue', name: 'Morgue Tile', price: 6, pattern: 'tile', base: '#cfd8d2', accent: '#aab7b0' },
  { id: 'wall_stone_crypt', name: 'Crypt Stone', price: 8, pattern: 'stone', base: '#7d7a72', accent: '#5f5c55' },
  { id: 'wall_exterior_siding', name: 'Peeling Siding', price: 3, pattern: 'wood', base: '#7a8a8a', accent: '#5d6b6b' },
];

export const FLOOR_STYLES: FloorStyle[] = [
  { id: 'floor_planks_worn', name: 'Worn Planks', price: 5, pattern: 'planks', base: '#7a5a3e', accent: '#5e4430' },
  { id: 'floor_planks_dark', name: 'Ebony Planks', price: 8, pattern: 'planks', base: '#3e2c22', accent: '#2c1f18' },
  { id: 'floor_parquet', name: 'Mourning Parquet', price: 10, pattern: 'parquet', base: '#8a6440', accent: '#6a4a2e' },
  { id: 'floor_checker_bw', name: 'Diner Checker', price: 7, pattern: 'checker', base: '#e6e0d0', accent: '#2a2a2e' },
  { id: 'floor_checker_moss', name: 'Moss Checker', price: 7, pattern: 'checker', base: '#a3b38f', accent: '#4f5e45' },
  { id: 'floor_carpet_plum', name: 'Plum Shag Carpet', price: 6, pattern: 'carpet', base: '#5b3f6e', accent: '#4b3260' },
  { id: 'floor_carpet_blood', name: 'Wine-Dark Carpet', price: 6, pattern: 'carpet', base: '#5a1f28', accent: '#46161e' },
  { id: 'floor_tile_morgue', name: 'Morgue Tile', price: 8, pattern: 'tile', base: '#d4dcd6', accent: '#b0bdb5' },
  { id: 'floor_stone_crypt', name: 'Crypt Flagstone', price: 9, pattern: 'stone', base: '#77736b', accent: '#5a5650' },
  { id: 'floor_marble_black', name: 'Black Marble', price: 14, pattern: 'marble', base: '#1f1f24', accent: '#56565e' },
  { id: 'floor_dirt_packed', name: 'Packed Grave Dirt', price: 1, pattern: 'dirt', base: '#5a4634', accent: '#463626' },
  { id: 'floor_mud_yard', name: 'Rain-Soaked Yard Mud', price: 1, pattern: 'dirt', base: '#39352b', accent: '#282b24' },
  { id: 'floor_leaf_litter', name: 'Autumn Leaf Litter', price: 1, pattern: 'dirt', base: '#705334', accent: '#a77b42' },
];

export const DEFAULT_INTERIOR_WALL = 'wall_plaster_bone';
export const DEFAULT_EXTERIOR_WALL = 'wall_exterior_siding';
export const WALL_SEGMENT_PRICE = 15;
export const WALL_SEGMENT_REFUND = 10;

export const WALL_STYLE_BY_ID: Record<string, WallStyle> = Object.fromEntries(WALL_STYLES.map((s) => [s.id, s]));
export const FLOOR_STYLE_BY_ID: Record<string, FloorStyle> = Object.fromEntries(FLOOR_STYLES.map((s) => [s.id, s]));
