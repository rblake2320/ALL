/**
 * Texture atlas layout for procedural wall/floor styles (pure; the drawing lives in *Patterns.ts).
 *
 * Every cell has a gutter filled with the periodic continuation of its pattern, so UVs may stray slightly
 * outside a cell (corner posts do) and mipmaps don't bleed neighbouring styles.
 * UVs follow three.js CanvasTexture conventions (flipY: canvas top row = v 1).
 */
import { WALL_STYLES, FLOOR_STYLES, DEFAULT_INTERIOR_WALL } from '../../shared/styles';
import { DIM } from '../../shared/dimensions';

export interface AtlasCell {
  /** Pixel rect of the cell interior on the canvas (top-left origin). */
  px: number;
  py: number;
  pw: number;
  ph: number;
  /** UV rect of the interior. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  gutter: number;
  cells: AtlasCell[];
}

export function gridLayout(count: number, cols: number, cellW: number, cellH: number, gutter: number): AtlasLayout {
  const c = Math.max(1, Math.floor(cols));
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / c));
  const slotW = cellW + gutter * 2;
  const slotH = cellH + gutter * 2;
  const width = c * slotW;
  const height = rows * slotH;
  const cells: AtlasCell[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % c;
    const row = Math.floor(i / c);
    const px = col * slotW + gutter;
    const py = row * slotH + gutter;
    cells.push({
      px,
      py,
      pw: cellW,
      ph: cellH,
      u0: px / width,
      u1: (px + cellW) / width,
      v1: 1 - py / height,
      v0: 1 - (py + cellH) / height,
    });
  }
  return { width, height, gutter, cells };
}

// ───────────── walls ─────────────

export const WALL_PX_PER_M = 192;
export const WALL_GUTTER = 24;
/** Slots: one per WALL_STYLES entry, then trim (reveals, wall ends) and cap (wall tops). */
export const WALL_TRIM_SLOT = WALL_STYLES.length;
export const WALL_CAP_SLOT = WALL_STYLES.length + 1;
export const WALL_SLOT_COUNT = WALL_STYLES.length + 2;

export function wallAtlasLayout(pxPerM = WALL_PX_PER_M): AtlasLayout {
  const w = Math.round(pxPerM);
  const h = Math.round(pxPerM * DIM.WALL_HEIGHT);
  return gridLayout(WALL_SLOT_COUNT, 4, w, h, Math.round((WALL_GUTTER * pxPerM) / WALL_PX_PER_M));
}

const WALL_INDEX: Record<string, number> = Object.fromEntries(WALL_STYLES.map((s, i) => [s.id, i]));
const DEFAULT_WALL_INDEX = WALL_INDEX[DEFAULT_INTERIOR_WALL] ?? 0;

/** Atlas slot for a wall style id; unknown ids use the default interior style. */
export function wallStyleSlot(styleId: unknown): number {
  if (typeof styleId !== 'string') return DEFAULT_WALL_INDEX;
  const i = WALL_INDEX[styleId];
  return i === undefined ? DEFAULT_WALL_INDEX : i;
}

// ───────────── floors ─────────────

export const FLOOR_PX_PER_M = 192;
/** Each floor cell covers this many metres (2×2 m → less visible repetition); tiles sample a quarter. */
export const FLOOR_CELL_METRES = 2;
export const FLOOR_GUTTER = 16;
export const FLOOR_SLOT_COUNT = FLOOR_STYLES.length + 1; // + fallback

export function floorAtlasLayout(pxPerM = FLOOR_PX_PER_M): AtlasLayout {
  const s = Math.round(pxPerM * FLOOR_CELL_METRES);
  return gridLayout(FLOOR_SLOT_COUNT, 4, s, s, Math.round((FLOOR_GUTTER * pxPerM) / FLOOR_PX_PER_M));
}

const FLOOR_INDEX: Record<string, number> = Object.fromEntries(FLOOR_STYLES.map((s, i) => [s.id, i]));
export const FLOOR_FALLBACK_SLOT = FLOOR_STYLES.length;

/** Atlas slot for a floor style id; unknown (non-null) ids use the fallback cell; null → -1 (no floor). */
export function floorStyleSlot(styleId: unknown): number {
  if (styleId === null || styleId === undefined || styleId === '') return -1;
  if (typeof styleId !== 'string') return FLOOR_FALLBACK_SLOT;
  const i = FLOOR_INDEX[styleId];
  return i === undefined ? FLOOR_FALLBACK_SLOT : i;
}

/**
 * UV rect for floor tile (x, z) inside its style cell: each tile maps to one quarter of the 2 m cell chosen by
 * (x mod 2, z mod 2), so patterns stay continuous across neighbouring tiles. World +Z maps to decreasing v
 * (canvas rows run toward the street).
 */
export function floorTileUV(cell: AtlasCell, x: number, z: number, out: { u0: number; v0: number; u1: number; v1: number }): { u0: number; v0: number; u1: number; v1: number } {
  const qx = ((Math.floor(x) % 2) + 2) % 2;
  const qz = ((Math.floor(z) % 2) + 2) % 2;
  const du = (cell.u1 - cell.u0) / 2;
  const dv = (cell.v1 - cell.v0) / 2;
  out.u0 = cell.u0 + qx * du;
  out.u1 = out.u0 + du;
  // canvas row 0 (top, v1) is world z = 0 of the cell
  out.v1 = cell.v1 - qz * dv;
  out.v0 = out.v1 - dv;
  return out;
}
