/**
 * Canvas-drawn particle atlas (8 × 4 cells of 64 px). Tintable frames are drawn white/grey (the particle colour
 * multiplies them); coins/bills carry their own colours. Frame ids: FXF in fxPool.ts.
 */
import { FXF, FX_ATLAS_COLS, FX_ATLAS_ROWS } from './fxPool';
import { ctx2d, makeCanvas, type Ctx2D } from '../world/canvasUtil';

const CELL = 64;

export function buildFxAtlas(): HTMLCanvasElement {
  const c = makeCanvas(FX_ATLAS_COLS * CELL, FX_ATLAS_ROWS * CELL);
  const ctx = ctx2d(c);
  ctx.clearRect(0, 0, c.width, c.height);
  const draw = (frame: number, fn: (g: Ctx2D) => void) => {
    const col = frame % FX_ATLAS_COLS;
    const row = Math.floor(frame / FX_ATLAS_COLS);
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * CELL, row * CELL, CELL, CELL);
    ctx.clip();
    ctx.translate(col * CELL + CELL / 2, row * CELL + CELL / 2);
    try {
      fn(ctx);
    } catch {
      /* a broken glyph must not break the atlas */
    }
    ctx.restore();
  };
  draw(FXF.puff, (g) => cloud(g, 5, 0.9, 11));
  draw(FXF.puff2, (g) => cloud(g, 7, 0.75, 23));
  draw(FXF.sparkle, (g) => star4(g, 28, 4));
  draw(FXF.glow, (g) => softDot(g, 30, 1));
  draw(FXF.heart, heart);
  draw(FXF.fly, fly);
  draw(FXF.wisp, wisp);
  draw(FXF.zee, (g) => glyph(g, 'Z', 44, 'bold'));
  draw(FXF.arrow, arrow);
  draw(FXF.coin, coin);
  draw(FXF.bill, bill);
  draw(FXF.ember, (g) => softDot(g, 14, 1.4));
  draw(FXF.flame, flame);
  draw(FXF.smoke, (g) => cloud(g, 6, 0.85, 37, true));
  draw(FXF.bone, bone);
  draw(FXF.splat, splat);
  draw(FXF.bolt1, (g) => bolt(g, 3));
  draw(FXF.bolt2, (g) => bolt(g, 9));
  draw(FXF.chunk, chunk);
  draw(FXF.dust, (g) => cloud(g, 8, 0.6, 51));
  draw(FXF.drop, drop);
  draw(FXF.ring, ring);
  draw(FXF.note1, (g) => note(g, false));
  draw(FXF.note2, (g) => note(g, true));
  draw(FXF.anger, anger);
  draw(FXF.confetti, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(-14, -9, 28, 18);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(-14, 3, 28, 6);
  });
  draw(FXF.streamer, streamer);
  draw(FXF.flake, flake);
  draw(FXF.shard, (g) => star4(g, 26, 2.5, true));
  draw(FXF.spark, spark);
  draw(FXF.tear, tear);
  draw(FXF.star, star5);
  return c;
}

function softDot(g: Ctx2D, r: number, core: number): void {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(Math.min(0.9, 0.25 * core), 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
}

function cloud(g: Ctx2D, lumps: number, alpha: number, seed: number, darkCore = false): void {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rnd();
    const d = 6 + rnd() * 10;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d * 0.8;
    const r = 13 + rnd() * 9;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const v = darkCore ? 200 : 255;
    gr.addColorStop(0, `rgba(${v},${v},${v},${alpha * 0.7})`);
    gr.addColorStop(0.6, `rgba(${v},${v},${v},${alpha * 0.35})`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function star4(g: Ctx2D, r: number, w: number, sharp = false): void {
  softDot(g, r * 0.45, 1);
  g.fillStyle = '#fff';
  for (let k = 0; k < 2; k++) {
    g.save();
    g.rotate((k * Math.PI) / 2);
    g.beginPath();
    g.moveTo(0, -r);
    g.quadraticCurveTo(w * (sharp ? 0.6 : 1), 0, 0, r);
    g.quadraticCurveTo(-w * (sharp ? 0.6 : 1), 0, 0, -r);
    g.fill();
    g.restore();
  }
}

function star5(g: Ctx2D): void {
  softDot(g, 18, 1);
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 22 : 9;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

function heart(g: Ctx2D): void {
  const path = () => {
    g.beginPath();
    g.moveTo(0, 20);
    g.bezierCurveTo(-30, 0, -22, -24, 0, -10);
    g.bezierCurveTo(22, -24, 30, 0, 0, 20);
    g.closePath();
  };
  g.fillStyle = 'rgba(255,255,255,1)';
  path();
  g.fill();
  g.strokeStyle = 'rgba(120,120,120,0.9)';
  g.lineWidth = 3;
  path();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.ellipse(-9, -8, 5, 3, -0.6, 0, Math.PI * 2);
  g.fill();
}

function fly(g: Ctx2D): void {
  g.fillStyle = 'rgba(210,225,235,0.75)';
  g.beginPath();
  g.ellipse(-9, -9, 9, 5, -0.6, 0, Math.PI * 2);
  g.ellipse(9, -9, 9, 5, 0.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.ellipse(0, 2, 8, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(0, -9, 6, 0, Math.PI * 2);
  g.fill();
}

function wisp(g: Ctx2D): void {
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    g.lineWidth = k === 0 ? 7 : 3;
    g.globalAlpha = k === 0 ? 0.35 : 0.9;
    g.beginPath();
    g.moveTo(-6, 26);
    g.bezierCurveTo(14, 12, -16, 0, 4, -10);
    g.bezierCurveTo(16, -18, -2, -24, 6, -28);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function glyph(g: Ctx2D, ch: string, size: number, weight: string): void {
  g.font = `${weight} ${size}px Georgia, "Palatino Linotype", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(60,60,80,0.75)';
  g.strokeText(ch, 0, 2);
  g.fillStyle = '#fff';
  g.fillText(ch, 0, 2);
}

function arrow(g: Ctx2D): void {
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(40,60,30,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -26);
  g.lineTo(20, -4);
  g.lineTo(8, -4);
  g.lineTo(8, 24);
  g.lineTo(-8, 24);
  g.lineTo(-8, -4);
  g.lineTo(-20, -4);
  g.closePath();
  g.fill();
  g.stroke();
}

function coin(g: Ctx2D): void {
  const gr = g.createRadialGradient(-6, -6, 2, 0, 0, 22);
  gr.addColorStop(0, '#fff2b0');
  gr.addColorStop(0.6, '#e2b34a');
  gr.addColorStop(1, '#9a6a1e');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 21, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#7a5216';
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = '#7a5216';
  g.font = 'bold 26px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', 0, 2);
}

function bill(g: Ctx2D): void {
  g.fillStyle = '#9fc98a';
  g.fillRect(-26, -14, 52, 28);
  g.strokeStyle = '#4f7a42';
  g.lineWidth = 2.5;
  g.strokeRect(-23, -11, 46, 22);
  g.fillStyle = '#4f7a42';
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
}

function flame(g: Ctx2D): void {
  const shape = (s: number) => {
    g.beginPath();
    g.moveTo(0, -28 * s);
    g.bezierCurveTo(14 * s, -6 * s, 18 * s, 10 * s, 0, 26 * s);
    g.bezierCurveTo(-18 * s, 10 * s, -14 * s, -6 * s, 0, -28 * s);
    g.closePath();
  };
  g.fillStyle = 'rgba(255,255,255,0.45)';
  shape(1);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  shape(0.72);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,1)';
  g.translate(0, 8);
  shape(0.42);
  g.fill();
}

function bone(g: Ctx2D): void {
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(120,110,90,0.9)';
  g.lineWidth = 2.5;
  g.save();
  g.rotate(-0.5);
  g.beginPath();
  g.rect(-16, -5, 32, 10);
  for (const x of [-18, 18])
    for (const y of [-6, 6]) {
      g.moveTo(x + 7, y);
      g.arc(x, y, 7, 0, Math.PI * 2);
    }
  g.fill();
  g.stroke();
  g.restore();
}

function splat(g: Ctx2D): void {
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = i % 2 === 0 ? 20 : 11;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(24, -8, 4, 0, Math.PI * 2);
  g.arc(-22, 12, 3, 0, Math.PI * 2);
  g.fill();
}

function bolt(g: Ctx2D, seed: number): void {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const pts: [number, number][] = [[0, -30]];
  for (let i = 1; i <= 6; i++) pts.push([(rnd() - 0.5) * 22, -30 + i * 10]);
  for (const [w, a] of [
    [9, 0.25],
    [4, 0.7],
    [1.6, 1],
  ] as [number, number][]) {
    g.strokeStyle = `rgba(255,255,255,${a})`;
    g.lineWidth = w;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.stroke();
  }
  // fork
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(pts[3][0], pts[3][1]);
  g.lineTo(pts[3][0] + 14, pts[3][1] + 12);
  g.stroke();
}

function chunk(g: Ctx2D): void {
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(100,95,85,0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-14, -6);
  g.lineTo(-4, -16);
  g.lineTo(12, -10);
  g.lineTo(16, 6);
  g.lineTo(2, 15);
  g.lineTo(-12, 9);
  g.closePath();
  g.fill();
  g.stroke();
}

function drop(g: Ctx2D): void {
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(0, -20);
  g.bezierCurveTo(12, -2, 12, 16, 0, 16);
  g.bezierCurveTo(-12, 16, -12, -2, 0, -20);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.beginPath();
  g.ellipse(-4, 4, 3, 5, 0, 0, Math.PI * 2);
  g.fill();
}

function ring(g: Ctx2D): void {
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2);
  g.stroke();
}

function note(g: Ctx2D, double: boolean): void {
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(40,30,50,0.8)';
  g.lineWidth = 2.5;
  const head = (x: number, y: number) => {
    g.beginPath();
    g.ellipse(x, y, 9, 6.5, -0.4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  if (double) {
    head(-12, 16);
    head(12, 10);
    g.fillRect(-5, -20, 4, 36);
    g.fillRect(19, -26, 4, 36);
    g.beginPath();
    g.moveTo(-5, -20);
    g.lineTo(23, -26);
    g.lineTo(23, -18);
    g.lineTo(-5, -12);
    g.closePath();
    g.fill();
    g.stroke();
  } else {
    head(-4, 16);
    g.fillRect(3, -24, 4, 40);
    g.beginPath();
    g.moveTo(7, -24);
    g.quadraticCurveTo(22, -16, 16, -2);
    g.quadraticCurveTo(18, -14, 7, -14);
    g.fill();
  }
}

function anger(g: Ctx2D): void {
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 7;
  for (let k = 0; k < 4; k++) {
    g.save();
    g.rotate((k * Math.PI) / 2 + Math.PI / 4);
    g.beginPath();
    g.moveTo(5, -5);
    g.quadraticCurveTo(16, -4, 18, -18);
    g.stroke();
    g.restore();
  }
}

function streamer(g: Ctx2D): void {
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-20, -14);
  g.bezierCurveTo(-4, -26, 4, 10, 20, 0);
  g.stroke();
}

function flake(g: Ctx2D): void {
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    g.save();
    g.rotate((k * Math.PI) / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -22);
    g.moveTo(0, -12);
    g.lineTo(6, -18);
    g.moveTo(0, -12);
    g.lineTo(-6, -18);
    g.stroke();
    g.restore();
  }
}

function spark(g: Ctx2D): void {
  softDot(g, 12, 1.5);
  g.strokeStyle = '#fff';
  g.lineWidth = 2.5;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    g.lineTo(Math.cos(a + 0.2) * 16, Math.sin(a + 0.2) * 16);
    g.lineTo(Math.cos(a - 0.1) * 26, Math.sin(a - 0.1) * 26);
    g.stroke();
  }
}

function tear(g: Ctx2D): void {
  drop(g);
}
