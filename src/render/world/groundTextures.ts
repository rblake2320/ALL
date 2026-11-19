/**
 * Procedural ground textures (canvas): grass, sidewalk concrete and asphalt. All periodic so they can repeat.
 */
import { ctx2d, drawPeriodic, makeCanvas, periodicNoise, range, rngFor, shade, type Ctx2D, type Rng } from './canvasUtil';

/** Grass: 4 m × 4 m tile at 128 px/m. */
export function grassCanvas(px = 512): HTMLCanvasElement {
  const c = makeCanvas(px, px);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#5a6e4d';
  ctx.fillRect(0, 0, px, px);
  drawPeriodic(ctx, 0, 0, px, px, 0, true, true, (g) => {
    const r = rngFor(1234);
    // patches: lusher, drier, darker
    for (let i = 0; i < 70; i++) {
      const x = r() * px;
      const y = r() * px;
      const rad = range(r, 20, 70);
      const kind = r();
      const col = kind < 0.4 ? 'rgba(112,130,90,0.2)' : kind < 0.7 ? 'rgba(140,132,92,0.18)' : 'rgba(50,62,44,0.24)';
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    blades(g, r, px, 4200);
    // clover / tiny pale flowers / pebbles
    for (let i = 0; i < 60; i++) {
      const x = r() * px;
      const y = r() * px;
      g.fillStyle = r() < 0.6 ? 'rgba(220,214,190,0.55)' : 'rgba(186,170,206,0.5)';
      g.beginPath();
      g.arc(x, y, range(r, 0.8, 1.6), 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * px;
      const y = r() * px;
      g.fillStyle = shade('#7d776c', range(r, -0.2, 0.2), 0.8);
      g.beginPath();
      g.ellipse(x, y, range(r, 1, 2.5), range(r, 0.8, 1.8), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  periodicNoise(ctx, 0, 0, px, px, 0, 0.07, 99, { grain: 0.6, cell: 32 });
  return c;
}

function blades(g: Ctx2D, r: Rng, px: number, n: number): void {
  const greens = ['#556a48', '#62784f', '#6e815a', '#4b5d41', '#7d855a', '#435339', '#878d64', '#6a6a4c'];
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * px;
    const y = r() * px;
    const len = range(r, 3, 9);
    const a = -Math.PI / 2 + range(r, -0.7, 0.7);
    g.strokeStyle = greens[Math.floor(r() * greens.length)];
    g.globalAlpha = range(r, 0.35, 0.85);
    g.lineWidth = range(r, 0.8, 1.6);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + range(r, -1.5, 1.5), y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Sidewalk concrete: 4 m (X, periodic) × 1 m (Z) at 128 px/m, slab joints every metre, cracks and moss. */
export function sidewalkCanvas(pxPerM = 128): HTMLCanvasElement {
  const w = pxPerM * 4;
  const h = pxPerM;
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#8f8b83';
  ctx.fillRect(0, 0, w, h);
  drawPeriodic(ctx, 0, 0, w, h, 0, true, false, (g) => {
    const r = rngFor(77);
    for (let s = 0; s < 4; s++) {
      const x = s * pxPerM;
      g.fillStyle = shade('#8f8b83', range(r, -0.08, 0.06));
      g.fillRect(x + 2, 2, pxPerM - 4, h - 4);
      // stains
      for (let i = 0; i < 4; i++) {
        const sx = x + r() * pxPerM;
        const sy = r() * h;
        const rad = range(r, 6, 22);
        const gr = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
        gr.addColorStop(0, `rgba(60,55,50,${range(r, 0.06, 0.16)})`);
        gr.addColorStop(1, 'rgba(60,55,50,0)');
        g.fillStyle = gr;
        g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      }
      // crack
      if (r() < 0.7) {
        g.strokeStyle = 'rgba(45,42,38,0.6)';
        g.lineWidth = 1.2;
        g.beginPath();
        let cx = x + r() * pxPerM;
        let cy = 2;
        g.moveTo(cx, cy);
        while (cy < h - 2) {
          cx += range(r, -8, 8);
          cy += range(r, 6, 16);
          g.lineTo(cx, Math.min(cy, h - 2));
        }
        g.stroke();
      }
      // joints with moss
      g.fillStyle = 'rgba(52,50,46,0.85)';
      g.fillRect(x - 1.5, 0, 3, h);
      g.fillStyle = 'rgba(92,120,70,0.5)';
      for (let i = 0; i < 6; i++) g.fillRect(x - 2, r() * h, 4, range(r, 2, 7));
    }
    // edges
    g.fillStyle = 'rgba(40,38,34,0.6)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
  });
  periodicNoise(ctx, 0, 0, w, h, 0, 0.08, 31, { grain: 0.75, cell: 16 });
  return c;
}

/** Asphalt: 4 m × 4 m at 64 px/m, periodic, with patches and tar snakes. */
export function asphaltCanvas(px = 256): HTMLCanvasElement {
  const c = makeCanvas(px, px);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#3a3a40';
  ctx.fillRect(0, 0, px, px);
  drawPeriodic(ctx, 0, 0, px, px, 0, true, true, (g) => {
    const r = rngFor(555);
    for (let i = 0; i < 30; i++) {
      const x = r() * px;
      const y = r() * px;
      const rad = range(r, 10, 40);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, r() < 0.5 ? 'rgba(70,70,76,0.35)' : 'rgba(30,30,34,0.35)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // patch
    g.fillStyle = 'rgba(48,48,54,0.9)';
    g.fillRect(px * 0.55, px * 0.2, px * 0.22, px * 0.16);
    g.strokeStyle = 'rgba(25,25,28,0.8)';
    g.strokeRect(px * 0.55, px * 0.2, px * 0.22, px * 0.16);
    // tar snakes
    g.strokeStyle = 'rgba(18,18,20,0.75)';
    g.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      let x = r() * px;
      let y = r() * px;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += range(r, -10, 10);
        y += range(r, 4, 12);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // speckle
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,120,126,0.35)' : 'rgba(15,15,18,0.4)';
      g.fillRect(r() * px, r() * px, 1, 1);
    }
  });
  periodicNoise(ctx, 0, 0, px, px, 0, 0.06, 7, { grain: 0.8, cell: 16 });
  return c;
}
