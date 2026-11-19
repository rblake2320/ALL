/** Pure spatial keyboard navigation for grouped tile grids (CAZ body picker). */

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * Index of the tile to move to from `cur`. Left/Right follow reading order (so they flow across rows and
 * category groups); Up/Down go to the nearest row above/below — whatever group it belongs to — and pick the tile
 * whose centre is horizontally closest. Edges stay put. Garbage rects are ignored.
 */
export function spatialNeighbor(rects: readonly TileRect[], cur: number, key: NavKey): number {
  const n = rects.length;
  if (n === 0) return 0;
  const c = Number.isInteger(cur) && cur >= 0 && cur < n ? cur : 0;
  if (key === 'ArrowRight') return Math.min(n - 1, c + 1);
  if (key === 'ArrowLeft') return Math.max(0, c - 1);
  const ok = (r: TileRect | undefined): r is TileRect => !!r && [r.x, r.y, r.w, r.h].every(Number.isFinite);
  const me = rects[c];
  if (!ok(me)) return c;
  const cx = me.x + me.w / 2;
  const cy = me.y + me.h / 2;
  const tol = Math.max(1, me.h / 2);
  const down = key === 'ArrowDown';
  let rowY: number | null = null;
  for (const r of rects) {
    if (!ok(r)) continue;
    const ry = r.y + r.h / 2;
    if (down ? ry > cy + tol : ry < cy - tol) {
      if (rowY === null || (down ? ry < rowY : ry > rowY)) rowY = ry;
    }
  }
  if (rowY === null) return c;
  let best = c;
  let bestDx = Infinity;
  rects.forEach((r, i) => {
    if (!ok(r)) return;
    const ry = r.y + r.h / 2;
    if (Math.abs(ry - rowY!) > tol) return;
    const dx = Math.abs(r.x + r.w / 2 - cx);
    if (dx < bestDx) {
      bestDx = dx;
      best = i;
    }
  });
  return best;
}
