/**
 * Canvas helpers for procedural textures: canvas creation, deterministic RNG, periodic drawing into atlas cells
 * (so gutters contain the wrapped continuation), and periodic pixel noise.
 */
import { mulberry32 } from '../core/math';

export type Ctx2D = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): Ctx2D {
  const ctx = c.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

export interface Rng {
  (): number;
}

/** Fresh deterministic RNG for a seed (draw callbacks re-seed per periodic copy). */
export function rngFor(seed: number): Rng {
  return mulberry32(seed);
}

export function range(r: Rng, a: number, b: number): number {
  return a + (b - a) * r();
}

/** CSS colour from a hex string shifted in lightness (−1..1) — cheap multiplicative shade. */
export function shade(hex: string, amount: number, alpha = 1): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amount >= 0) {
    r += (255 - r) * amount;
    g += (255 - g) * amount;
    b += (255 - b) * amount;
  } else {
    r *= 1 + amount;
    g *= 1 + amount;
    b *= 1 + amount;
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

/** Mix two hex colours (t 0..1) into a CSS rgba string. */
export function mix(hexA: string, hexB: string, t: number, alpha = 1): string {
  const a = parseInt(hexA.replace('#', ''), 16);
  const b = parseInt(hexB.replace('#', ''), 16);
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bl)},${alpha})`;
}

/** Mix two hex colours (t 0..1) into a hex string (so it can be shaded further). */
export function mixHex(hexA: string, hexB: string, t: number): string {
  const a = parseInt(hexA.replace('#', ''), 16);
  const b = parseInt(hexB.replace('#', ''), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return '#' + v.toString(16).padStart(6, '0');
}

/**
 * Draw `draw` (in cell-local px, [0,cw]×[0,ch]) into the slot at (cx,cy) so the result tiles with period
 * (cw, ch) along the periodic axes; the gutter receives the wrapped continuation. Everything outside the
 * slot is clipped. `draw` must be deterministic for a given call (re-seed inside it).
 */
export function drawPeriodic(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  gutter: number,
  periodicX: boolean,
  periodicY: boolean,
  draw: (ctx: Ctx2D) => void,
): void {
  const xs = periodicX ? [-1, 0, 1] : [0];
  const ys = periodicY ? [-1, 0, 1] : [0];
  for (const oy of ys) {
    for (const ox of xs) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - gutter, cy - gutter, cw + gutter * 2, ch + gutter * 2);
      ctx.clip();
      ctx.translate(cx + ox * cw, cy + oy * ch);
      draw(ctx);
      ctx.restore();
    }
  }
}

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Periodic noise over a slot: per-pixel grain + smooth value noise of `cell` px, both wrapping with the cell
 * period so atlas gutters stay seamless. `amount` is the ± brightness variation (0..1).
 */
export function periodicNoise(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  gutter: number,
  amount: number,
  seed: number,
  opts: { grain?: number; cell?: number; tint?: [number, number, number] } = {},
): void {
  const x0 = Math.max(0, Math.floor(cx - gutter));
  const y0 = Math.max(0, Math.floor(cy - gutter));
  const w = Math.min(ctx.canvas.width - x0, Math.ceil(cw + gutter * 2));
  const h = Math.min(ctx.canvas.height - y0, Math.ceil(ch + gutter * 2));
  if (w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  const grain = opts.grain ?? 0.5;
  const cell = Math.max(2, opts.cell ?? 16);
  const nx = Math.max(1, Math.round(cw / cell));
  const ny = Math.max(1, Math.round(ch / cell));
  const sx = cw / nx;
  const sy = ch / ny;
  const tint = opts.tint ?? [1, 1, 1];
  for (let j = 0; j < h; j++) {
    const ly = (((y0 + j - cy) % ch) + ch) % ch;
    const gy = ly / sy;
    const iy = Math.floor(gy);
    const fy = gy - iy;
    const uy = fy * fy * (3 - 2 * fy);
    for (let i = 0; i < w; i++) {
      const lx = (((x0 + i - cx) % cw) + cw) % cw;
      const gx = lx / sx;
      const ix = Math.floor(gx);
      const fx = gx - ix;
      const ux = fx * fx * (3 - 2 * fx);
      const a = hash2(ix % nx, iy % ny, seed);
      const b = hash2((ix + 1) % nx, iy % ny, seed);
      const c = hash2(ix % nx, (iy + 1) % ny, seed);
      const e = hash2((ix + 1) % nx, (iy + 1) % ny, seed);
      const smooth = a + (b - a) * ux + (c - a) * uy + (a - b - c + e) * ux * uy;
      const white = hash2(Math.floor(lx), Math.floor(ly), seed + 7);
      const n = ((smooth - 0.5) * (1 - grain) + (white - 0.5) * grain) * 2 * amount;
      const k = (j * w + i) * 4;
      d[k] = Math.max(0, Math.min(255, d[k] * (1 + n * tint[0])));
      d[k + 1] = Math.max(0, Math.min(255, d[k + 1] * (1 + n * tint[1])));
      d[k + 2] = Math.max(0, Math.min(255, d[k + 2] * (1 + n * tint[2])));
    }
  }
  ctx.putImageData(img, x0, y0);
}

/** Fill a whole slot (cell + gutter) with a colour. */
export function fillSlot(ctx: Ctx2D, cx: number, cy: number, cw: number, ch: number, gutter: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(cx - gutter, cy - gutter, cw + gutter * 2, ch + gutter * 2);
}
