/**
 * DEV ONLY — mock RendererAPI / AudioAPI and a 2D-canvas turntable PreviewStage so Create-a-Zombie has
 * something charming to show without WebGL.
 */
import type { AudioAPI, AudioVolumes } from '../../../audio/contracts';
import type { PreviewStage, RendererAPI } from '../../../render/contracts';
import { defaultAppearance, SKIN_TONES, type AnimState, type Expression, type LimbState, type ZombieAppearance } from '../../../shared/appearance';

function svgThumb(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 30% 38%)"/><stop offset="1" stop-color="hsl(${hue} 35% 16%)"/></linearGradient></defs><rect x="14" y="30" width="100" height="78" rx="14" fill="url(#g)"/><text x="64" y="76" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#e8e0c8">${label.slice(0, 10)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export class MockPreviewStage implements PreviewStage {
  private app: ZombieAppearance = defaultAppearance();
  private anim: AnimState = 'idle';
  private expr: Expression = 'neutral';
  private yaw = 0;
  private w = 300;
  private h = 400;
  private raf = 0;
  private t0 = performance.now();
  private disposed = false;
  constructor(private canvas: HTMLCanvasElement) {
    this.loop();
  }
  setAppearance(app: ZombieAppearance): void {
    this.app = { ...defaultAppearance(), ...app };
  }
  setLimbs(_l: LimbState): void {}
  setAnim(anim: AnimState): void {
    this.anim = anim;
  }
  setExpression(expr: Expression): void {
    this.expr = expr;
  }
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }
  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
  }
  private loop = () => {
    if (this.disposed) return;
    this.draw((performance.now() - this.t0) / 1000);
    this.raf = requestAnimationFrame(this.loop);
  };
  private draw(time: number) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = this.canvas.width / this.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const a = this.app;
    const freeze = document.documentElement.classList.contains('reduce-motion') || document.documentElement.dataset.freeze === '1';
    const tt = freeze ? 0.6 : time;
    const scale = (Math.min(this.w * 1.2, this.h) / 610) * (0.9 + (a.height ?? 0.5) * 0.2);
    const cx = this.w / 2;
    const floor = this.h * 0.875;
    const turn = Math.cos(this.yaw);
    const side = Math.sin(this.yaw);
    const bob = this.anim === 'dance' ? Math.abs(Math.sin(tt * 6)) * 14 : this.anim === 'walk' ? Math.abs(Math.sin(tt * 4)) * 5 : Math.sin(tt * 1.6) * 2;
    const sway = this.anim === 'dance' ? Math.sin(tt * 3) * 0.12 : this.anim === 'laugh' ? Math.sin(tt * 18) * 0.03 : Math.sin(tt * 0.9) * 0.025;
    const skin = SKIN_TONES[Math.min(SKIN_TONES.length - 1, Math.max(0, Math.floor(a.skinTone) || 0))];
    const bw = (0.82 + (a.build ?? 0.4) * 0.45) * (0.55 + 0.45 * Math.abs(turn));
    ctx.save();
    ctx.translate(cx, floor - bob * scale);
    ctx.scale(scale, scale);
    ctx.rotate(sway);
    const leg = (dir: number, phase: number) => {
      const swing = this.anim === 'walk' ? Math.sin(tt * 4 + phase) * 16 : this.anim === 'dance' ? Math.sin(tt * 6 + phase) * 10 : 0;
      ctx.save();
      ctx.translate(dir * 22 * bw, -150);
      ctx.rotate((swing * Math.PI) / 180);
      ctx.fillStyle = a.bottomStyle === 'skirt' ? skin : a.bottomColor;
      ctx.beginPath();
      ctx.roundRect(-13, 0, 26, a.bottomStyle === 'shorts' ? 150 : 150, 10);
      ctx.fill();
      if (a.bottomStyle === 'shorts') {
        ctx.fillStyle = skin;
        ctx.fillRect(-11, 70, 22, 70);
      }
      ctx.fillStyle = a.shoeColor;
      ctx.beginPath();
      ctx.roundRect(-16 + side * 6, 138, 36, 16, 8);
      ctx.fill();
      ctx.restore();
    };
    leg(-1, 0);
    leg(1, Math.PI);
    // torso
    ctx.fillStyle = a.topColor;
    ctx.beginPath();
    ctx.roundRect(-58 * bw, -300, 116 * bw, a.topStyle === 'dress' ? 210 : 160, 30);
    ctx.fill();
    if (a.bottomStyle === 'skirt' && a.topStyle !== 'dress') {
      ctx.fillStyle = a.bottomColor;
      ctx.beginPath();
      ctx.moveTo(-52 * bw, -150);
      ctx.lineTo(52 * bw, -150);
      ctx.lineTo(70 * bw, -80);
      ctx.lineTo(-70 * bw, -80);
      ctx.closePath();
      ctx.fill();
    }
    // arms
    const arm = (dir: number) => {
      // Rotation is clockwise-positive; "outward" for the right arm (dir = 1) is negative.
      let rot = -dir * (0.1 + Math.sin(tt * 1.2 + dir) * 0.03);
      let len = 1;
      if (this.anim === 'wave' && dir > 0) rot = -(2.45 + Math.sin(tt * 8) * 0.3);
      if (this.anim === 'dance') rot = -dir * (0.5 + 0.9 * Math.abs(Math.sin(tt * 3 + (dir > 0 ? 0 : 1.5))));
      if (this.anim === 'walk') {
        rot = -dir * 0.2;
        len = 0.58;
      }
      if (this.anim === 'groan') rot = -dir * 0.03;
      if (this.anim === 'laugh') rot = -dir * (0.25 + Math.abs(Math.sin(tt * 9)) * 0.1);
      ctx.save();
      ctx.translate(dir * 60 * bw, -285);
      ctx.rotate(rot);
      ctx.scale(1, len);
      ctx.fillStyle = a.topStyle === 'dress' || a.topStyle === 'tatters' || a.topStyle === 'tee' ? skin : a.topColor;
      ctx.beginPath();
      ctx.roundRect(-12, 0, 24, 140, 12);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, 146, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    arm(-1);
    arm(1);
    // head
    const headTilt = this.anim === 'groan' ? -0.35 : this.anim === 'laugh' ? Math.sin(tt * 18) * 0.06 : Math.sin(tt * 0.7) * 0.05;
    ctx.save();
    ctx.translate(0, -318);
    ctx.rotate(headTilt);
    const hw = 64 * (0.85 + (a.build ?? 0.4) * 0.2) * (0.8 + 0.2 * Math.abs(turn));
    if (a.hairStyle === 'long' || a.hairStyle === 'afro' || a.hairStyle === 'bob') {
      ctx.fillStyle = a.hairColor;
      ctx.beginPath();
      if (a.hairStyle === 'afro') ctx.arc(0, -86, 104, 0, Math.PI * 2);
      else ctx.roundRect(-hw - 12, -170, hw * 2 + 24, a.hairStyle === 'long' ? 230 : 150, 60);
      ctx.fill();
    }
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, -80, hw, 84, 0, 0, Math.PI * 2);
    ctx.fill();
    // face
    const fx = side * 30;
    const eye = (dx: number, big: number) => {
      ctx.fillStyle = '#efe8cf';
      ctx.beginPath();
      ctx.ellipse(fx + dx, -82, 14 * big, 12 * big, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = a.eyeColor;
      ctx.beginPath();
      ctx.arc(fx + dx + side * 4, -80, 7 * big, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22182a';
      ctx.beginPath();
      ctx.arc(fx + dx + side * 4, -80, 3 * big, 0, Math.PI * 2);
      ctx.fill();
    };
    if (Math.abs(turn) > 0.15 || side > 0) eye(-24 * Math.max(0.3, Math.abs(turn)), a.eyeStyle === 'wide' ? 1.25 : 1);
    if (Math.abs(turn) > 0.15 || side < 0) eye(24 * Math.max(0.3, Math.abs(turn)), a.eyeStyle === 'mismatched' ? 0.7 : a.eyeStyle === 'wide' ? 1.25 : 1);
    ctx.strokeStyle = '#3a2430';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const smile = this.expr === 'happy' ? 12 : this.expr === 'sleepy' ? -4 : 3;
    ctx.moveTo(fx - 22, -40);
    ctx.quadraticCurveTo(fx, -40 + smile, fx + 24, -42);
    ctx.stroke();
    // hair on top
    if (a.hairStyle !== 'bald') {
      ctx.fillStyle = a.hairColor;
      ctx.beginPath();
      if (a.hairStyle === 'mohawk') ctx.roundRect(-12 + fx * 0.3, -205, 24, 80, 10);
      else if (a.hairStyle === 'bun') {
        ctx.ellipse(0, -140, hw * 0.95, 40, 0, Math.PI, 0);
        ctx.arc(0, -178, 28, 0, Math.PI * 2);
      } else ctx.ellipse(0, -136, hw * 1.02, a.hairStyle === 'buzz' ? 30 : 48, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }
}

export function createMockRenderer(): RendererAPI {
  let wall: 'up' | 'cutaway' | 'down' = 'cutaway';
  return {
    init: async () => {},
    loadProgress: () => 1,
    attach: () => {},
    frame: () => {},
    consumeEvents: () => {},
    resize: () => {},
    setQuality: () => {},
    setPixelRatio: () => {},
    setViewMode: () => {},
    setWallMode: (m) => {
      wall = m;
    },
    getWallMode: () => wall,
    rotateCamera: () => {},
    orbit: () => {},
    zoom: () => {},
    pan: () => {},
    panWorld: () => {},
    focus: () => {},
    follow: () => {},
    getCamera: () => ({ target: { x: 15, z: 14 }, yaw: 0, distance: 22, pitch: 0.9 }),
    setCamera: () => {},
    pick: () => ({ kind: 'none' }),
    pickGrid: () => null,
    worldToScreen: () => ({ x: 0, y: 0, visible: false }),
    bubbleAnchors: () => [],
    setSelection: () => {},
    setHover: () => {},
    setPlacementGhost: () => {},
    setBuildOverlay: () => {},
    setHiddenObject: () => {},
    thumbnail: async (id) => svgThumb(id, (id.length * 37) % 360),
    createPreview: (canvas) => new MockPreviewStage(canvas),
    snapshot: () => '',
    fps: () => 60,
    dispose: () => {},
  };
}

export function createMockAudio(): AudioAPI {
  let volumes: AudioVolumes = { master: 0.8, music: 0.55, sfx: 0.8, voice: 0.75, ambient: 0.5, ui: 0.6 };
  let unlocked = false;
  return {
    unlock: async () => {
      unlocked = true;
    },
    get unlocked() {
      return unlocked;
    },
    setVolumes: (v) => {
      volumes = { ...volumes, ...v };
    },
    getVolumes: () => volumes,
    setMuted: () => {},
    setDucked: () => {},
    sfx: () => {},
    loop: () => {},
    stopAllLoops: () => {},
    voice: (seed, pitch, emotion, ms) => {
      console.info(`[mock audio] voice seed=${seed} pitch=${pitch.toFixed(2)} ${emotion} ${ms}ms`);
    },
    music: () => {},
    setGameSpeed: () => {},
    setAmbience: () => {},
    dispose: () => {},
  };
}

export { svgThumb };
