/**
 * Procedural wallpaper atlas (canvas). One cell per WALL_STYLES entry (1 m wide × WALL_HEIGHT tall, periodic
 * horizontally with a 1 m period so neighbouring segments line up), plus trim and cap cells.
 * Canvas row 0 is the TOP of the wall; the floor is at the cell's bottom edge.
 */
import { WALL_STYLES, type WallStyle } from '../../shared/styles';
import { hashString } from '../core/math';
import { wallAtlasLayout, WALL_CAP_SLOT, WALL_TRIM_SLOT, type AtlasLayout } from './atlasLayout';
import { ctx2d, drawPeriodic, fillSlot, makeCanvas, mix, mixHex, periodicNoise, range, rngFor, shade, type Ctx2D, type Rng } from '../world/canvasUtil';

export const WALL_TRIM_COLOR = '#4b3d36';
export const WALL_CAP_COLOR = '#3a3138';

export interface WallAtlas {
  canvas: HTMLCanvasElement;
  layout: AtlasLayout;
}

interface Ctx {
  /** px per metre */
  m: number;
  w: number;
  h: number;
  /** canvas y for a height above the floor (metres) */
  y(metres: number): number;
}

export function buildWallAtlas(pxPerM?: number): WallAtlas {
  const job = wallAtlasJob(pxPerM);
  while (!job.step()) {
    /* synchronous */
  }
  return job.result;
}

/** Same atlas, generated one cell per macrotask so a loading screen keeps animating. */
export async function buildWallAtlasAsync(pxPerM?: number, yieldFn: () => Promise<void> = yieldTask): Promise<WallAtlas> {
  const job = wallAtlasJob(pxPerM);
  while (!job.step()) await yieldFn();
  return job.result;
}

function yieldTask(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function wallAtlasJob(pxPerM?: number): { step(): boolean; result: WallAtlas } {
  const layout = wallAtlasLayout(pxPerM);
  const canvas = makeCanvas(layout.width, layout.height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#6a6060';
  ctx.fillRect(0, 0, layout.width, layout.height);
  let i = 0;
  return {
    result: { canvas, layout },
    step(): boolean {
      if (i < WALL_STYLES.length) {
        const style = WALL_STYLES[i];
        const cell = layout.cells[i];
        try {
          drawWallCell(ctx, cell.px, cell.py, cell.pw, cell.ph, layout.gutter, style);
        } catch (err) {
          fillSlot(ctx, cell.px, cell.py, cell.pw, cell.ph, layout.gutter, style.base);
          console.warn('[render] wall pattern failed', style.id, err);
        }
        i++;
        return false;
      }
      const trim = layout.cells[WALL_TRIM_SLOT];
      fillSlot(ctx, trim.px, trim.py, trim.pw, trim.ph, layout.gutter, WALL_TRIM_COLOR);
      const cap = layout.cells[WALL_CAP_SLOT];
      fillSlot(ctx, cap.px, cap.py, cap.pw, cap.ph, layout.gutter, WALL_CAP_COLOR);
      return true;
    },
  };
}

function drawWallCell(ctx: Ctx2D, cx: number, cy: number, cw: number, ch: number, gutter: number, style: WallStyle): void {
  const k: Ctx = { m: cw, w: cw, h: ch, y: (metres) => ch - metres * cw };
  const seed = hashString(style.id);
  fillSlot(ctx, cx, cy, cw, ch, gutter, style.base);
  const exterior = style.id.includes('siding') || style.id.includes('exterior');
  drawPeriodic(ctx, cx, cy, cw, ch, gutter, true, false, (c) => {
    const r = rngFor(seed);
    switch (style.pattern) {
      case 'plaster':
        plaster(c, k, style, r);
        break;
      case 'stripes':
        stripes(c, k, style, r);
        break;
      case 'damask':
        damask(c, k, style, r);
        break;
      case 'brick':
        brick(c, k, style, r);
        break;
      case 'wood':
        if (exterior) siding(c, k, style, r);
        else panelling(c, k, style, r);
        break;
      case 'tile':
        tile(c, k, style, r);
        break;
      case 'stone':
        stone(c, k, style, r);
        break;
      case 'wallpaperFloral':
        floral(c, k, style, r);
        break;
      default:
        plaster(c, k, style, r);
    }
    const masonry = style.pattern === 'brick' || style.pattern === 'stone';
    if (exterior) foundation(c, k);
    else if (!masonry) {
      crown(c, k, style);
      baseboard(c, k);
    }
    grime(c, k, masonry || exterior ? 0.22 : 0.14);
  });
  periodicNoise(ctx, cx, cy, cw, ch, gutter, style.pattern === 'plaster' ? 0.06 : 0.04, seed, { grain: 0.55, cell: Math.round(cw / 6) });
}

// ───────────── shared trims ─────────────

function baseboard(c: Ctx2D, k: Ctx): void {
  const top = k.y(0.12);
  c.fillStyle = '#3d2d25';
  c.fillRect(-2, top, k.w + 4, k.h - top + 2);
  c.fillStyle = 'rgba(255,235,210,0.18)';
  c.fillRect(-2, top, k.w + 4, Math.max(1, k.m * 0.012));
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(-2, top - Math.max(1, k.m * 0.006), k.w + 4, Math.max(1, k.m * 0.006));
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(-2, k.y(0.035), k.w + 4, Math.max(1, k.m * 0.008));
}

function crown(c: Ctx2D, k: Ctx, style: WallStyle): void {
  const h = Math.max(2, k.m * 0.07);
  c.fillStyle = shade(style.base, 0.18);
  c.fillRect(-2, 0, k.w + 4, h);
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(-2, h, k.w + 4, Math.max(1, k.m * 0.01));
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(-2, h * 0.45, k.w + 4, Math.max(1, k.m * 0.008));
}

function foundation(c: Ctx2D, k: Ctx): void {
  const top = k.y(0.2);
  c.fillStyle = '#5b5752';
  c.fillRect(-2, top, k.w + 4, k.h - top + 2);
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(-2, top, k.w + 4, Math.max(1, k.m * 0.01));
  c.strokeStyle = 'rgba(30,28,26,0.35)';
  c.lineWidth = Math.max(1, k.m * 0.006);
  for (let x = 0; x < 2; x++) {
    const px = (x + 0.5) * (k.w / 2);
    c.beginPath();
    c.moveTo(px, top);
    c.lineTo(px, k.h);
    c.stroke();
  }
  // fascia board at the top
  c.fillStyle = '#4c5656';
  c.fillRect(-2, 0, k.w + 4, k.m * 0.09);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(-2, k.m * 0.09, k.w + 4, Math.max(1, k.m * 0.012));
}

function grime(c: Ctx2D, k: Ctx, strength: number): void {
  const g = c.createLinearGradient(0, k.y(0.6), 0, k.h);
  g.addColorStop(0, 'rgba(30,22,20,0)');
  g.addColorStop(1, `rgba(30,22,20,${strength})`);
  c.fillStyle = g;
  c.fillRect(-2, k.y(0.6), k.w + 4, k.h);
  const t = c.createLinearGradient(0, 0, 0, k.y(2.2));
  t.addColorStop(0, `rgba(25,20,24,${strength * 0.6})`);
  t.addColorStop(1, 'rgba(25,20,24,0)');
  c.fillStyle = t;
  c.fillRect(-2, 0, k.w + 4, k.y(2.2));
}

// ───────────── patterns ─────────────

function plaster(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  for (let i = 0; i < 70; i++) {
    const x = r() * k.w;
    const y = r() * k.h;
    const rad = range(r, 0.04, 0.22) * k.m;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    const a = range(r, 0.05, 0.14);
    g.addColorStop(0, r() < 0.5 ? mix(s.accent, s.accent, 0, a) : shade(s.base, 0.15, a * 0.8));
    g.addColorStop(1, mix(s.accent, s.accent, 0, 0));
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // trowel streaks
  c.strokeStyle = shade(s.accent, -0.1, 0.06);
  c.lineWidth = Math.max(1, k.m * 0.01);
  for (let i = 0; i < 14; i++) {
    const x = r() * k.w;
    const y = r() * k.h;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + range(r, -0.1, 0.1) * k.m, y + 0.1 * k.m, x + range(r, -0.15, 0.15) * k.m, y + range(r, 0.15, 0.35) * k.m);
    c.stroke();
  }
  // a hairline crack
  if (r() < 0.9) crack(c, r() * k.w, k.y(range(r, 0.8, 2.2)), k.m * range(r, 0.2, 0.45), r, 'rgba(60,45,40,0.35)', k.m);
}

function crack(c: Ctx2D, x: number, y: number, len: number, r: Rng, color: string, m: number): void {
  c.strokeStyle = color;
  c.lineWidth = Math.max(1, m * 0.005);
  c.beginPath();
  c.moveTo(x, y);
  let px = x;
  let py = y;
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    px += range(r, -0.3, 0.3) * (len / steps) * 2;
    py += (len / steps) * range(r, 0.6, 1.2);
    c.lineTo(px, py);
  }
  c.stroke();
}

function stripes(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const n = 8;
  const sw = k.w / n;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) {
      c.fillStyle = s.accent;
      c.fillRect(i * sw, 0, sw, k.h);
    }
    c.fillStyle = shade(s.accent, -0.25, 0.55);
    c.fillRect(i * sw + sw * 0.5 - Math.max(0.5, k.m * 0.002), 0, Math.max(1, k.m * 0.004), k.h);
  }
  // fine pinstripes
  c.fillStyle = shade(s.base, 0.25, 0.35);
  for (let i = 0; i < n; i++) c.fillRect(i * sw, 0, Math.max(1, k.m * 0.003), k.h);
  // chair rail + wainscot
  const rail = k.y(0.92);
  c.fillStyle = shade(s.accent, -0.2);
  c.fillRect(-2, rail, k.w + 4, k.y(0.12) - rail);
  for (let p = 0; p < 2; p++) {
    const x0 = p * (k.w / 2) + k.m * 0.05;
    const pw = k.w / 2 - k.m * 0.1;
    c.strokeStyle = shade(s.accent, -0.45, 0.6);
    c.lineWidth = Math.max(1, k.m * 0.008);
    c.strokeRect(x0, rail + k.m * 0.08, pw, k.y(0.2) - rail - k.m * 0.08);
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.strokeRect(x0 + k.m * 0.01, rail + k.m * 0.09, pw, k.y(0.2) - rail - k.m * 0.08);
  }
  c.fillStyle = '#4a3a30';
  c.fillRect(-2, rail - k.m * 0.035, k.w + 4, k.m * 0.05);
  c.fillStyle = 'rgba(255,230,200,0.2)';
  c.fillRect(-2, rail - k.m * 0.035, k.w + 4, Math.max(1, k.m * 0.008));
  void r;
}

function motif(c: Ctx2D, x: number, y: number, s: number, color: string): void {
  // symmetric ornament: draw the right half and mirror it
  c.save();
  c.translate(x, y);
  c.fillStyle = color;
  for (const dir of [1, -1]) {
    c.save();
    c.scale(dir, 1);
    c.beginPath();
    c.moveTo(0, -s);
    c.bezierCurveTo(s * 0.35, -s * 0.75, s * 0.25, -s * 0.35, s * 0.55, -s * 0.3);
    c.bezierCurveTo(s * 0.95, -s * 0.25, s * 0.85, s * 0.2, s * 0.45, s * 0.12);
    c.bezierCurveTo(s * 0.3, s * 0.35, s * 0.55, s * 0.6, s * 0.2, s * 0.75);
    c.bezierCurveTo(s * 0.1, s * 0.85, s * 0.05, s, 0, s * 1.05);
    c.closePath();
    c.fill();
    // scroll curl
    c.beginPath();
    c.arc(s * 0.62, -s * 0.05, s * 0.12, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.ellipse(0, -s * 0.05, s * 0.12, s * 0.28, 0, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = 'source-over';
  c.restore();
}

function damask(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const cols = 2;
  const rowH = 0.46 * k.m;
  const rows = Math.ceil(k.h / rowH) + 1;
  const sz = k.m * 0.15;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 === 0 ? 0 : 0.5;
    for (let col = 0; col <= cols; col++) {
      const x = ((col + off) / cols) * k.w;
      const y = row * rowH + rowH * 0.5;
      motif(c, x, y, sz, mix(s.accent, s.accent, 0, 0.85));
      c.fillStyle = shade(s.accent, 0.1, 0.6);
      c.beginPath();
      c.arc(x + k.w / cols / 2, y + rowH / 2, sz * 0.12, 0, Math.PI * 2);
      c.fill();
    }
  }
  void r;
}

function brick(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const mortar = mix(s.base, '#b9ad9c', 0.45);
  c.fillStyle = mortar;
  c.fillRect(-2, 0, k.w + 4, k.h);
  const course = 0.075 * k.m;
  const joint = Math.max(1.5, 0.012 * k.m);
  const len = k.w / 4;
  const rows = Math.ceil(k.h / course);
  for (let row = 0; row < rows; row++) {
    const y = k.h - (row + 1) * course;
    const off = row % 2 === 0 ? 0 : len / 2;
    for (let i = -1; i <= 4; i++) {
      const x = i * len + off;
      const t = r();
      const dark = r() < 0.12 ? -0.35 : 0;
      c.fillStyle = shade(mixHex(s.base, s.accent, t * 0.7), dark + range(r, -0.06, 0.06));
      c.fillRect(x + joint / 2, y + joint / 2, len - joint, course - joint);
      c.fillStyle = 'rgba(255,240,220,0.08)';
      c.fillRect(x + joint / 2, y + joint / 2, len - joint, Math.max(1, joint * 0.6));
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(x + joint / 2, y + course - joint * 1.2, len - joint, Math.max(1, joint * 0.5));
    }
  }
  // soot bloom near the top
  const g = c.createLinearGradient(0, 0, 0, k.h * 0.5);
  g.addColorStop(0, 'rgba(20,15,15,0.28)');
  g.addColorStop(1, 'rgba(20,15,15,0)');
  c.fillStyle = g;
  c.fillRect(-2, 0, k.w + 4, k.h * 0.5);
}

function panelling(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const boards = 7;
  const bw = k.w / boards;
  for (let i = 0; i < boards; i++) {
    c.fillStyle = shade(s.base, range(r, -0.1, 0.08));
    c.fillRect(i * bw, 0, bw, k.h);
    // grain
    c.strokeStyle = shade(s.accent, -0.2, 0.18);
    c.lineWidth = Math.max(1, k.m * 0.003);
    for (let g = 0; g < 4; g++) {
      const gx = i * bw + range(r, 0.15, 0.85) * bw;
      c.beginPath();
      c.moveTo(gx, 0);
      for (let y = 0; y <= k.h; y += k.m * 0.25) c.lineTo(gx + Math.sin(y * 0.02 + g * 3 + i) * bw * 0.06, y);
      c.stroke();
    }
    c.fillStyle = 'rgba(15,8,5,0.55)';
    c.fillRect(i * bw - Math.max(0.5, k.m * 0.003), 0, Math.max(1, k.m * 0.006), k.h);
  }
  // raised wainscot panels below 1 m
  const top = k.y(1.0);
  const bot = k.y(0.14);
  c.fillStyle = shade(s.accent, -0.05);
  c.fillRect(-2, top, k.w + 4, bot - top);
  for (let p = 0; p < 2; p++) {
    const x0 = p * (k.w / 2) + k.m * 0.06;
    const pw = k.w / 2 - k.m * 0.12;
    const y0 = top + k.m * 0.08;
    const ph = bot - top - k.m * 0.16;
    c.fillStyle = shade(s.base, 0.04);
    c.fillRect(x0, y0, pw, ph);
    c.fillStyle = 'rgba(255,230,200,0.12)';
    c.fillRect(x0, y0, pw, Math.max(1, k.m * 0.01));
    c.fillRect(x0, y0, Math.max(1, k.m * 0.01), ph);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(x0, y0 + ph - Math.max(1, k.m * 0.01), pw, Math.max(1, k.m * 0.01));
    c.fillRect(x0 + pw - Math.max(1, k.m * 0.01), y0, Math.max(1, k.m * 0.01), ph);
  }
  c.fillStyle = shade(s.accent, -0.3);
  c.fillRect(-2, top - k.m * 0.03, k.w + 4, k.m * 0.045);
  c.fillStyle = 'rgba(255,220,190,0.18)';
  c.fillRect(-2, top - k.m * 0.03, k.w + 4, Math.max(1, k.m * 0.008));
}

function siding(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const board = 0.16 * k.m;
  const rows = Math.ceil(k.h / board);
  for (let row = 0; row < rows; row++) {
    const y = k.h - (row + 1) * board;
    const g = c.createLinearGradient(0, y, 0, y + board);
    const tone = range(r, -0.05, 0.05);
    g.addColorStop(0, shade(s.base, 0.1 + tone));
    g.addColorStop(0.85, shade(s.base, -0.05 + tone));
    g.addColorStop(1, shade(s.accent, -0.35));
    c.fillStyle = g;
    c.fillRect(-2, y, k.w + 4, board);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(-2, y + board - Math.max(1, k.m * 0.01), k.w + 4, Math.max(1, k.m * 0.01));
    // butt joint somewhere on the board
    const jx = r() * k.w;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(jx, y, Math.max(1, k.m * 0.004), board);
    // peeling paint revealing grey wood
    if (r() < 0.45) {
      const px = r() * k.w;
      const pw = range(r, 0.06, 0.22) * k.m;
      const ph = board * range(r, 0.3, 0.7);
      c.fillStyle = '#8b8577';
      c.beginPath();
      c.ellipse(px, y + board * 0.45, pw / 2, ph / 2, range(r, -0.2, 0.2), 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = shade(s.base, 0.35, 0.7);
      c.lineWidth = Math.max(1, k.m * 0.004);
      c.stroke();
    }
    // nail heads
    c.fillStyle = 'rgba(40,30,25,0.5)';
    for (let n = 0; n < 2; n++) {
      c.beginPath();
      c.arc((n + 0.25) * (k.w / 2), y + board * 0.25, Math.max(0.8, k.m * 0.005), 0, Math.PI * 2);
      c.fill();
    }
  }
  // corner/edge weathering streaks
  c.fillStyle = 'rgba(40,50,45,0.08)';
  for (let i = 0; i < 6; i++) c.fillRect(r() * k.w, 0, k.m * range(r, 0.01, 0.03), k.h * range(r, 0.3, 0.8));
}

function tile(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const tileTop = 1.5;
  const cols = 6;
  const size = k.w / cols;
  const grout = Math.max(1.5, k.m * 0.01);
  // plaster above
  c.fillStyle = mix(s.base, '#e8e0c8', 0.35);
  c.fillRect(-2, 0, k.w + 4, k.y(tileTop));
  c.fillStyle = shade(s.accent, -0.15);
  c.fillRect(-2, k.y(0.12), k.w + 4, k.h);
  const y0 = k.y(tileTop);
  c.fillStyle = shade(s.accent, -0.12);
  c.fillRect(-2, y0, k.w + 4, k.y(0.12) - y0);
  const rows = Math.ceil(((tileTop - 0.12) * k.m) / size);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < cols; i++) {
      const x = i * size;
      const y = k.y(0.12) - (row + 1) * size;
      if (y < y0 - 1) continue;
      const g = c.createLinearGradient(x, y, x + size, y + size);
      const v = range(r, -0.04, 0.04);
      g.addColorStop(0, shade(s.base, 0.12 + v));
      g.addColorStop(1, shade(s.base, -0.05 + v));
      c.fillStyle = g;
      c.fillRect(x + grout / 2, y + grout / 2, size - grout, size - grout);
    }
  }
  // bullnose border row
  c.fillStyle = shade(s.accent, -0.25);
  c.fillRect(-2, y0 - k.m * 0.035, k.w + 4, k.m * 0.05);
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fillRect(-2, y0 - k.m * 0.035, k.w + 4, Math.max(1, k.m * 0.008));
}

function stone(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  const mortar = shade(s.accent, -0.35);
  c.fillStyle = mortar;
  c.fillRect(-2, 0, k.w + 4, k.h);
  const gap = Math.max(1.5, 0.014 * k.m);
  let y = k.h;
  while (y > -k.m * 0.3) {
    const ch = range(r, 0.2, 0.32) * k.m;
    // block widths for this course sum exactly to the 1 m period (seamless wrap), starting at a random offset;
    // per-block randomness is drawn up front so both passes (and the periodic copies) match exactly
    const blocks: { bw: number; t: number; seeds: number[]; moss: number }[] = [];
    let total = 0;
    while (total < k.w - 0.25 * k.m) {
      const bw = range(r, 0.3, 0.6) * k.m;
      blocks.push({ bw, t: r(), seeds: [r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r()], moss: r() < 0.5 ? r() : -1 });
      total += bw;
    }
    if (blocks.length === 0) blocks.push({ bw: k.w, t: r(), seeds: new Array(12).fill(0.5), moss: -1 });
    else blocks[blocks.length - 1].bw += k.w - total;
    let x = r() * k.w - k.w;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of blocks) {
        stoneBlock(c, k, s, x, y, b.bw, ch, gap, b.t, b.seeds, b.moss);
        x += b.bw;
      }
    }
    y -= ch;
  }
}

function stoneBlock(c: Ctx2D, k: Ctx, s: WallStyle, x: number, y: number, bw: number, ch: number, gap: number, t: number, seeds: number[], moss: number): void {
  c.fillStyle = mix(s.base, s.accent, t * 0.8);
  roundRect(c, x + gap / 2, y - ch + gap / 2, bw - gap, ch - gap, Math.max(2, k.m * 0.02));
  c.fill();
  const g = c.createLinearGradient(0, y - ch, 0, y);
  g.addColorStop(0, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  c.fillStyle = g;
  c.fill();
  c.fillStyle = 'rgba(20,20,20,0.18)';
  for (let i = 0; i < 6; i++) c.fillRect(x + seeds[i * 2] * bw, y - seeds[i * 2 + 1] * ch, Math.max(1, k.m * 0.008), Math.max(1, k.m * 0.008));
  if (moss >= 0 && y > k.y(0.6)) {
    c.fillStyle = 'rgba(96,120,70,0.35)';
    c.beginPath();
    c.ellipse(x + moss * bw, y - ch * 0.1, bw * 0.25, ch * 0.18, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function roundRect(c: Ctx2D, x: number, y: number, w: number, h: number, rad: number): void {
  const rr = Math.max(0, Math.min(rad, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

function flower(c: Ctx2D, x: number, y: number, s: number, petal: string, leaf: string, rot: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = leaf;
  for (const a of [0.6, 2.6, 4.4]) {
    c.save();
    c.rotate(a);
    c.beginPath();
    c.ellipse(s * 1.2, 0, s * 0.75, s * 0.28, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    c.save();
    c.rotate((i / 5) * Math.PI * 2);
    c.beginPath();
    c.ellipse(0, -s * 0.55, s * 0.36, s * 0.55, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.fillStyle = 'rgba(240,220,170,0.7)';
  c.beginPath();
  c.arc(0, 0, s * 0.22, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function floral(c: Ctx2D, k: Ctx, s: WallStyle, r: Rng): void {
  // faint stripes
  c.fillStyle = shade(s.base, 0.08, 0.6);
  for (let i = 0; i < 4; i++) c.fillRect(i * (k.w / 4), 0, k.w / 8, k.h);
  const rowH = 0.42 * k.m;
  const rows = Math.ceil(k.h / rowH) + 1;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 === 0 ? 0.25 : 0.75;
    for (let col = -1; col <= 1; col++) {
      const x = (col + off) * (k.w / 2) * 1;
      const y = row * rowH + rowH * 0.4;
      flower(c, x, y, k.m * 0.055, mix(s.accent, s.accent, 0, 0.75), 'rgba(111,127,94,0.55)', range(r, -0.5, 0.5));
      c.fillStyle = shade(s.accent, 0.2, 0.45);
      c.beginPath();
      c.arc(x + k.w * 0.25, y + rowH * 0.5, k.m * 0.012, 0, Math.PI * 2);
      c.fill();
    }
  }
  // water stain (funeral florals are faded)
  const sx = r() * k.w;
  const sy = k.y(range(r, 1.4, 2.3));
  const g = c.createRadialGradient(sx, sy, 0, sx, sy, k.m * 0.3);
  g.addColorStop(0, 'rgba(120,95,60,0.14)');
  g.addColorStop(0.85, 'rgba(120,95,60,0.08)');
  g.addColorStop(1, 'rgba(120,95,60,0)');
  c.fillStyle = g;
  c.fillRect(sx - k.m * 0.3, sy - k.m * 0.3, k.m * 0.6, k.m * 0.6);
}
