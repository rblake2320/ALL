/**
 * Procedural floor atlas (canvas). One 2 m × 2 m cell per FLOOR_STYLES entry, periodic on both axes so floors
 * tile seamlessly across any number of tiles. Each tile samples one quarter (see atlasLayout.floorTileUV).
 */
import { FLOOR_STYLES, type FloorStyle } from '../../shared/styles';
import { hashString } from '../core/math';
import { floorAtlasLayout, FLOOR_FALLBACK_SLOT, type AtlasLayout } from './atlasLayout';
import { ctx2d, drawPeriodic, fillSlot, makeCanvas, mix, mixHex, periodicNoise, range, rngFor, shade, type Ctx2D, type Rng } from '../world/canvasUtil';

export interface FloorAtlas {
  canvas: HTMLCanvasElement;
  layout: AtlasLayout;
}

interface K {
  /** px per metre */
  m: number;
  /** cell size px (2 m) */
  s: number;
}

export function buildFloorAtlas(pxPerM?: number): FloorAtlas {
  const job = floorAtlasJob(pxPerM);
  while (!job.step()) {
    /* synchronous */
  }
  return job.result;
}

/** Same atlas, generated one cell per macrotask so a loading screen keeps animating. */
export async function buildFloorAtlasAsync(pxPerM?: number, yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))): Promise<FloorAtlas> {
  const job = floorAtlasJob(pxPerM);
  while (!job.step()) await yieldFn();
  return job.result;
}

function floorAtlasJob(pxPerM?: number): { step(): boolean; result: FloorAtlas } {
  const layout = floorAtlasLayout(pxPerM);
  const canvas = makeCanvas(layout.width, layout.height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#555';
  ctx.fillRect(0, 0, layout.width, layout.height);
  let i = 0;
  return {
    result: { canvas, layout },
    step(): boolean {
      if (i < FLOOR_STYLES.length) {
        const style = FLOOR_STYLES[i];
        const cell = layout.cells[i];
        try {
          drawFloorCell(ctx, cell.px, cell.py, cell.pw, layout.gutter, style);
        } catch (err) {
          fillSlot(ctx, cell.px, cell.py, cell.pw, cell.ph, layout.gutter, style.base);
          console.warn('[render] floor pattern failed', style.id, err);
        }
        i++;
        return false;
      }
      const fb = layout.cells[FLOOR_FALLBACK_SLOT];
      drawFloorCell(ctx, fb.px, fb.py, fb.pw, layout.gutter, { id: 'fallback', name: '', price: 0, pattern: 'planks', base: '#6a5a4a', accent: '#4e4236' });
      return true;
    },
  };
}

function drawFloorCell(ctx: Ctx2D, cx: number, cy: number, size: number, gutter: number, style: FloorStyle): void {
  const k: K = { m: size / 2, s: size };
  const seed = hashString(style.id);
  fillSlot(ctx, cx, cy, size, size, gutter, style.base);
  drawPeriodic(ctx, cx, cy, size, size, gutter, true, true, (c) => {
    const r = rngFor(seed);
    switch (style.pattern) {
      case 'planks':
        planks(c, k, style, r);
        break;
      case 'checker':
        checker(c, k, style, r);
        break;
      case 'carpet':
        carpet(c, k, style, r);
        break;
      case 'stone':
        flagstones(c, k, style, r);
        break;
      case 'tile':
        tiles(c, k, style, r);
        break;
      case 'dirt':
        dirt(c, k, style, r);
        break;
      case 'parquet':
        parquet(c, k, style, r);
        break;
      case 'marble':
        marble(c, k, style, r);
        break;
      default:
        planks(c, k, style, r);
    }
  });
  const noise = style.pattern === 'carpet' ? 0.16 : style.pattern === 'dirt' ? 0.14 : style.pattern === 'marble' ? 0.025 : 0.05;
  const grain = style.pattern === 'carpet' ? 0.85 : 0.5;
  periodicNoise(ctx, cx, cy, size, size, gutter, noise, seed, { grain, cell: Math.round(size / 12) });
}

// ───────────── patterns (cell-local px, periodic over k.s) ─────────────

function planks(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  const boards = 12;
  const bh = k.s / boards;
  const gap = Math.max(1.2, k.m * 0.006);
  for (let row = 0; row < boards; row++) {
    const y = row * bh;
    // joints: plank lengths summing to the period, starting at a random offset
    const lens: { len: number; tone: number; knot: number; grain: number[] }[] = [];
    let total = 0;
    while (total < k.s - 0.5 * k.m) {
      const len = range(r, 0.55, 1.35) * k.m;
      lens.push({ len, tone: range(r, -0.12, 0.1), knot: r() < 0.25 ? r() : -1, grain: [r(), r(), r(), r(), r()] });
      total += len;
    }
    lens[lens.length - 1].len += k.s - total;
    let x = r() * k.s - k.s;
    for (let pass = 0; pass < 2; pass++) {
      for (const p of lens) {
        plank(c, k, s, x, y, p.len, bh, gap, p.tone, p.knot, p.grain);
        x += p.len;
      }
    }
  }
}

function plank(c: Ctx2D, k: K, s: FloorStyle, x: number, y: number, len: number, bh: number, gap: number, tone: number, knot: number, grain: number[]): void {
  const base = mixHex(s.base, s.accent, Math.max(0, -tone) * 1.5);
  const g = c.createLinearGradient(0, y, 0, y + bh);
  g.addColorStop(0, shade(base, tone + 0.06));
  g.addColorStop(1, shade(base, tone - 0.05));
  c.fillStyle = g;
  c.fillRect(x, y, len, bh);
  // grain
  c.strokeStyle = shade(s.accent, -0.25, 0.22);
  c.lineWidth = Math.max(1, k.m * 0.004);
  for (let i = 0; i < 4; i++) {
    const gy = y + bh * (0.15 + grain[i] * 0.7);
    c.beginPath();
    c.moveTo(x, gy);
    const amp = bh * 0.08;
    for (let t = 1; t <= 8; t++) c.lineTo(x + (len * t) / 8, gy + Math.sin(t * 1.3 + grain[4] * 9 + i) * amp);
    c.stroke();
  }
  if (knot >= 0) {
    const kx = x + len * (0.2 + knot * 0.6);
    const ky = y + bh * 0.5;
    c.fillStyle = shade(s.accent, -0.35, 0.65);
    c.beginPath();
    c.ellipse(kx, ky, bh * 0.22, bh * 0.14, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = shade(s.accent, -0.2, 0.35);
    c.beginPath();
    c.ellipse(kx, ky, bh * 0.34, bh * 0.22, 0, 0, Math.PI * 2);
    c.stroke();
  }
  // gaps (long edge + end joint) and nail dots
  c.fillStyle = 'rgba(20,12,8,0.75)';
  c.fillRect(x, y + bh - gap, len, gap);
  c.fillRect(x + len - gap, y, gap, bh);
  c.fillStyle = 'rgba(25,18,14,0.6)';
  for (const fy of [0.3, 0.7]) {
    c.beginPath();
    c.arc(x + k.m * 0.03, y + bh * fy, Math.max(0.8, k.m * 0.005), 0, Math.PI * 2);
    c.fill();
  }
  // edge highlight
  c.fillStyle = 'rgba(255,235,210,0.08)';
  c.fillRect(x, y, len, Math.max(1, gap * 0.7));
}

function checker(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  const n = 8;
  const t = k.s / n;
  const grout = Math.max(1, k.m * 0.006);
  c.fillStyle = mix(s.base, s.accent, 0.5);
  c.fillRect(0, 0, k.s, k.s);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dark = (i + j) % 2 === 1;
      const col = dark ? s.accent : s.base;
      const v = range(r, -0.04, 0.04);
      const g = c.createLinearGradient(i * t, j * t, (i + 1) * t, (j + 1) * t);
      g.addColorStop(0, shade(col, v + 0.05));
      g.addColorStop(1, shade(col, v - 0.04));
      c.fillStyle = g;
      c.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
      // scuffs
      if (r() < 0.3) {
        c.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(40,30,20,0.06)';
        c.beginPath();
        c.ellipse(i * t + r() * t, j * t + r() * t, t * range(r, 0.1, 0.3), t * 0.06, r() * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
}

function carpet(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  // mottled pile
  for (let i = 0; i < 260; i++) {
    const x = r() * k.s;
    const y = r() * k.s;
    const rad = range(r, 0.04, 0.16) * k.m;
    c.fillStyle = r() < 0.5 ? mix(s.accent, s.accent, 0, 0.18) : shade(s.base, 0.12, 0.14);
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fill();
  }
  // tufts
  for (let i = 0; i < 1800; i++) {
    c.fillStyle = r() < 0.5 ? shade(s.base, 0.22, 0.35) : shade(s.accent, -0.3, 0.35);
    c.fillRect(r() * k.s, r() * k.s, Math.max(1, k.m * 0.007), Math.max(1, k.m * 0.007));
  }
  // worn walking path
  c.fillStyle = 'rgba(200,180,170,0.05)';
  c.beginPath();
  c.ellipse(k.s * 0.5, k.s * 0.5, k.s * 0.35, k.s * 0.18, 0.4, 0, Math.PI * 2);
  c.fill();
}

function flagstones(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  const mortar = shade(s.accent, -0.4);
  c.fillStyle = mortar;
  c.fillRect(0, 0, k.s, k.s);
  const gap = Math.max(2, k.m * 0.022);
  // recursive split of the cell into slabs
  const slabs: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    const big = Math.max(w, h);
    if (depth > 4 || big < 0.7 * k.m || (depth >= 2 && r() < 0.3)) {
      slabs.push([x, y, w, h]);
      return;
    }
    const f = range(r, 0.35, 0.65);
    if (w >= h) {
      split(x, y, w * f, h, depth + 1);
      split(x + w * f, y, w * (1 - f), h, depth + 1);
    } else {
      split(x, y, w, h * f, depth + 1);
      split(x, y + h * f, w, h * (1 - f), depth + 1);
    }
  };
  split(0, 0, k.s, k.s, 0);
  for (const [x, y, w, h] of slabs) {
    const t = r();
    c.fillStyle = mix(s.base, s.accent, t * 0.7);
    rounded(c, x + gap / 2, y + gap / 2, w - gap, h - gap, k.m * 0.04);
    c.fill();
    const g = c.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = g;
    c.fill();
    c.fillStyle = 'rgba(20,20,20,0.16)';
    for (let i = 0; i < 18; i++) c.fillRect(x + r() * w, y + r() * h, Math.max(1, k.m * 0.01), Math.max(1, k.m * 0.01));
    if (r() < 0.35) {
      c.strokeStyle = 'rgba(30,28,26,0.4)';
      c.lineWidth = Math.max(1, k.m * 0.005);
      c.beginPath();
      let px = x + r() * w;
      let py = y + gap;
      c.moveTo(px, py);
      for (let i = 0; i < 5; i++) {
        px += range(r, -0.08, 0.08) * k.m;
        py += (h - gap * 2) / 5;
        c.lineTo(px, py);
      }
      c.stroke();
    }
  }
  // moss in the joints
  c.fillStyle = 'rgba(100,128,72,0.22)';
  for (let i = 0; i < 40; i++) c.fillRect(r() * k.s, r() * k.s, k.m * 0.03, k.m * 0.012);
}

function rounded(c: Ctx2D, x: number, y: number, w: number, h: number, rad: number): void {
  const rr = Math.max(0, Math.min(rad, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function tiles(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  const n = 6;
  const t = k.s / n;
  const grout = Math.max(1.5, k.m * 0.012);
  c.fillStyle = shade(s.accent, -0.15);
  c.fillRect(0, 0, k.s, k.s);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = range(r, -0.05, 0.04);
      const g = c.createRadialGradient(i * t + t * 0.35, j * t + t * 0.3, t * 0.05, i * t + t * 0.5, j * t + t * 0.5, t * 0.8);
      g.addColorStop(0, shade(s.base, 0.1 + v));
      g.addColorStop(1, shade(s.base, -0.04 + v));
      c.fillStyle = g;
      c.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
      if (r() < 0.06) {
        c.strokeStyle = 'rgba(60,60,60,0.35)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(i * t + grout, j * t + r() * t);
        c.lineTo(i * t + t * r(), j * t + t - grout);
        c.stroke();
      }
    }
  }
}

function dirt(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  for (let i = 0; i < 160; i++) {
    const x = r() * k.s;
    const y = r() * k.s;
    const rad = range(r, 0.05, 0.25) * k.m;
    c.fillStyle = r() < 0.6 ? mix(s.accent, s.accent, 0, 0.25) : shade(s.base, 0.12, 0.2);
    c.beginPath();
    c.ellipse(x, y, rad, rad * range(r, 0.5, 1), r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  // pebbles
  for (let i = 0; i < 70; i++) {
    const x = r() * k.s;
    const y = r() * k.s;
    const rad = range(r, 0.008, 0.025) * k.m;
    c.fillStyle = shade('#8a8078', range(r, -0.3, 0.1));
    c.beginPath();
    c.ellipse(x, y, rad * 1.3, rad, r() * 3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath();
    c.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.4, 0, Math.PI * 2);
    c.fill();
  }
  // dry straws + roots
  c.lineWidth = Math.max(1, k.m * 0.005);
  for (let i = 0; i < 40; i++) {
    const x = r() * k.s;
    const y = r() * k.s;
    const a = r() * Math.PI;
    const l = range(r, 0.03, 0.09) * k.m;
    c.strokeStyle = r() < 0.6 ? 'rgba(150,140,90,0.45)' : 'rgba(40,28,20,0.45)';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

function parquet(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  const n = 4; // 0.5 m squares
  const sq = k.s / n;
  const strips = 4;
  const sw = sq / strips;
  const gap = Math.max(1, k.m * 0.005);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const horiz = (i + j) % 2 === 0;
      for (let st = 0; st < strips; st++) {
        const tone = range(r, -0.1, 0.08);
        const col = shade(mixHex(s.base, s.accent, r() * 0.5), tone);
        c.fillStyle = col;
        const x = horiz ? i * sq : i * sq + st * sw;
        const y = horiz ? j * sq + st * sw : j * sq;
        const w = horiz ? sq : sw;
        const h = horiz ? sw : sq;
        c.fillRect(x, y, w, h);
        c.strokeStyle = shade(s.accent, -0.3, 0.2);
        c.lineWidth = Math.max(1, k.m * 0.003);
        for (let g = 0; g < 2; g++) {
          c.beginPath();
          if (horiz) {
            const gy = y + h * (0.3 + g * 0.4);
            c.moveTo(x, gy);
            c.bezierCurveTo(x + w * 0.3, gy + h * 0.1, x + w * 0.6, gy - h * 0.1, x + w, gy);
          } else {
            const gx = x + w * (0.3 + g * 0.4);
            c.moveTo(gx, y);
            c.bezierCurveTo(gx + w * 0.1, y + h * 0.3, gx - w * 0.1, y + h * 0.6, gx, y + h);
          }
          c.stroke();
        }
        c.fillStyle = 'rgba(20,12,8,0.6)';
        if (horiz) c.fillRect(x, y + h - gap, w, gap);
        else c.fillRect(x + w - gap, y, gap, h);
      }
      c.strokeStyle = 'rgba(20,12,8,0.7)';
      c.lineWidth = gap * 1.4;
      c.strokeRect(i * sq, j * sq, sq, sq);
    }
  }
}

function marble(c: Ctx2D, k: K, s: FloorStyle, r: Rng): void {
  // soft cloudy base
  for (let i = 0; i < 90; i++) {
    const x = r() * k.s;
    const y = r() * k.s;
    const rad = range(r, 0.1, 0.4) * k.m;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, shade(s.base, range(r, 0.04, 0.12), 0.35));
    g.addColorStop(1, shade(s.base, 0, 0));
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // veins
  for (let v = 0; v < 9; v++) {
    let x = r() * k.s;
    let y = r() * k.s;
    const ang = r() * Math.PI * 2;
    const width = range(r, 0.6, 2.4) * (k.m / 96);
    c.strokeStyle = mix(s.accent, '#c8c8d0', r() * 0.5, range(r, 0.25, 0.6));
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(x, y);
    let a = ang;
    for (let sgm = 0; sgm < 14; sgm++) {
      a += range(r, -0.5, 0.5);
      const l = range(r, 0.08, 0.2) * k.m;
      const nx = x + Math.cos(a) * l;
      const ny = y + Math.sin(a) * l;
      c.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, nx, ny);
      x = nx;
      y = ny;
    }
    c.stroke();
  }
  // 1 m tiles with fine joints
  c.strokeStyle = 'rgba(0,0,0,0.45)';
  c.lineWidth = Math.max(1, k.m * 0.004);
  for (let i = 0; i <= 2; i++) {
    c.beginPath();
    c.moveTo(i * (k.s / 2), 0);
    c.lineTo(i * (k.s / 2), k.s);
    c.moveTo(0, i * (k.s / 2));
    c.lineTo(k.s, i * (k.s / 2));
    c.stroke();
  }
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i <= 2; i++) {
    c.beginPath();
    c.moveTo(i * (k.s / 2) + 1.5, 0);
    c.lineTo(i * (k.s / 2) + 1.5, k.s);
    c.stroke();
  }
}
