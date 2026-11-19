/**
 * Pure geometry for the procedural zombie portrait (100×100 viewBox, bust view). Every function tolerates
 * garbage input (NaN, unknown styles, bad colours) and always returns valid path data.
 */
import { SKIN_TONES, type ZombieAppearance } from '../../shared/appearance';
import { safeHex, shadeHex, mixHex } from './color';

export interface PortraitDims {
  /** Head centre y. */
  cy: number;
  /** Half width / half height of the head. */
  hw: number;
  hh: number;
  /** Top of skull and chin y. */
  top: number;
  chin: number;
}

const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const c01 = (v: unknown, d: number) => Math.min(1, Math.max(0, n(v, d)));
const f = (v: number) => (Math.round(v * 100) / 100).toString();

export function portraitDims(app: Partial<ZombieAppearance> | null | undefined): PortraitDims {
  const build = c01(app?.build, 0.4);
  const height = c01(app?.height, 0.5);
  const hw = 15 + build * 4.5;
  const hh = 18.5 + height * 2.5 - build * 0.8;
  const cy = 45;
  return { cy, hw, hh, top: cy - hh, chin: cy + hh };
}

export function skinColor(app: Partial<ZombieAppearance> | null | undefined): string {
  const idx = Math.floor(n(app?.skinTone, 0));
  const tone = SKIN_TONES[Math.min(SKIN_TONES.length - 1, Math.max(0, idx))] ?? SKIN_TONES[0];
  return safeHex(tone, '#9fb88a');
}

export interface PortraitPalette {
  skin: string;
  skinShade: string;
  skinDeep: string;
  skinLight: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  /** Light rim so dark hair reads against the portrait backdrop. */
  hairRim: string;
  top: string;
  topShade: string;
  eye: string;
}

export function portraitPalette(app: Partial<ZombieAppearance> | null | undefined): PortraitPalette {
  const skin = skinColor(app);
  const hair = safeHex(app?.hairColor, '#3b2f2f');
  const top = safeHex(app?.topColor, '#6b4f8a');
  return {
    skin,
    skinShade: shadeHex(mixHex(skin, '#3b304b', 0.18), -0.12),
    skinDeep: shadeHex(mixHex(skin, '#2b1f33', 0.35), -0.3),
    skinLight: shadeHex(skin, 0.18),
    hair,
    hairShade: shadeHex(hair, -0.3),
    hairLight: shadeHex(hair, 0.22),
    hairRim: mixHex(hair, '#e8e0c8', 0.38),
    top,
    topShade: shadeHex(top, -0.28),
    eye: safeHex(app?.eyeColor, '#f2e86d'),
  };
}

/** Slightly crooked egg-shaped head (chin nudged right for character). */
export function headPath(d: PortraitDims): string {
  const { cy, hw, hh } = d;
  const x = 50;
  return (
    `M${f(x)} ${f(cy - hh)}` +
    `C${f(x + hw * 0.78)} ${f(cy - hh)} ${f(x + hw)} ${f(cy - hh * 0.55)} ${f(x + hw)} ${f(cy - hh * 0.04)}` +
    `C${f(x + hw)} ${f(cy + hh * 0.46)} ${f(x + hw * 0.6)} ${f(cy + hh * 0.96)} ${f(x + 1.2)} ${f(cy + hh)}` +
    `C${f(x - hw * 0.62)} ${f(cy + hh * 0.96)} ${f(x - hw * 1.03)} ${f(cy + hh * 0.46)} ${f(x - hw * 1.03)} ${f(cy - hh * 0.04)}` +
    `C${f(x - hw * 1.03)} ${f(cy - hh * 0.56)} ${f(x - hw * 0.78)} ${f(cy - hh)} ${f(x)} ${f(cy - hh)}Z`
  );
}

/** Shoulders + torso silhouette at the bottom of the frame. */
export function shouldersPath(build: number): string {
  const b = c01(build, 0.4);
  const sw = 33 + b * 7; // half shoulder width
  return `M${f(50 - sw - 6)} 104C${f(50 - sw - 4)} 88 ${f(50 - sw + 2)} 80 ${f(50 - 11)} 76.5C${f(46)} 75.5 ${f(54)} 75.5 ${f(50 + 11)} 76.5C${f(50 + sw - 2)} 80 ${f(50 + sw + 4)} 88 ${f(50 + sw + 6)} 104Z`;
}

export interface HairShapes {
  /** Drawn behind the head. */
  back: string[];
  /** Drawn over the head (fringe, caps). */
  front: string[];
  /** Thin strand lines (stroked). */
  strands: string[];
}

/** Hair silhouettes per style. Unknown styles fall back to 'messy'. */
export function hairShapes(style: string | null | undefined, d: PortraitDims): HairShapes {
  const { cy, hw, hh, top } = d;
  const L = 50 - hw * 1.03;
  const R = 50 + hw;
  const brow = cy - hh * 0.42;
  const cap = (lift: number, hairline: number) =>
    `M${f(L - 0.8)} ${f(hairline)}` +
    `C${f(L - 1.5)} ${f(cy - hh * 0.75)} ${f(50 - hw * 0.7)} ${f(top - lift)} ${f(50)} ${f(top - lift)}` +
    `C${f(50 + hw * 0.72)} ${f(top - lift)} ${f(R + 1.5)} ${f(cy - hh * 0.75)} ${f(R + 0.8)} ${f(hairline)}` +
    `C${f(R - 2)} ${f(hairline - 4)} ${f(50 + hw * 0.4)} ${f(brow - 3.5)} ${f(50)} ${f(brow - 3)}` +
    `C${f(50 - hw * 0.4)} ${f(brow - 3.5)} ${f(L + 2)} ${f(hairline - 4)} ${f(L - 0.8)} ${f(hairline)}Z`;

  switch (style) {
    case 'bald':
      return {
        back: [],
        front: [],
        strands: [`M${f(48)} ${f(top + 0.6)}c-1.4-3 .6-5 2.6-5.4`, `M${f(51.5)} ${f(top + 0.4)}c.2-2.4 1.8-3.6 3.6-3.4`],
      };
    case 'buzz':
      return { back: [], front: [cap(0.9, cy - hh * 0.32)], strands: [] };
    case 'bob': {
      const bottom = cy + hh * 0.42;
      return {
        back: [
          `M${f(L - 4.5)} ${f(bottom)}C${f(L - 7)} ${f(cy - hh * 0.4)} ${f(50 - hw * 0.8)} ${f(top - 4)} 50 ${f(top - 4)}C${f(50 + hw * 0.8)} ${f(top - 4)} ${f(R + 7)} ${f(cy - hh * 0.4)} ${f(R + 4.5)} ${f(bottom)}C${f(R + 2)} ${f(bottom + 3)} ${f(R - 1)} ${f(bottom + 2)} ${f(R - 1.5)} ${f(bottom - 1)}L${f(L + 1.5)} ${f(bottom - 1)}C${f(L + 1)} ${f(bottom + 2)} ${f(L - 2)} ${f(bottom + 3)} ${f(L - 4.5)} ${f(bottom)}Z`,
        ],
        front: [
          `M${f(L - 1.5)} ${f(cy - hh * 0.05)}C${f(L - 2)} ${f(cy - hh * 0.8)} ${f(50 - hw * 0.6)} ${f(top - 2.5)} 50 ${f(top - 2.5)}C${f(50 + hw * 0.65)} ${f(top - 2.5)} ${f(R + 2)} ${f(cy - hh * 0.8)} ${f(R + 1.5)} ${f(cy - hh * 0.05)}C${f(R - 1)} ${f(brow - 1)} ${f(50 + hw * 0.5)} ${f(brow + 0.5)} ${f(50 + 3)} ${f(brow - 1.5)}C${f(50 - 2)} ${f(brow + 1.2)} ${f(50 - hw * 0.6)} ${f(brow + 0.5)} ${f(L - 1.5)} ${f(cy - hh * 0.05)}Z`,
        ],
        strands: [],
      };
    }
    case 'bun':
      return {
        back: [],
        front: [cap(1.5, cy - hh * 0.28), `M${f(50 - 6.5)} ${f(top - 5)}a6.5 6 0 1 0 13 0a6.5 6 0 1 0 -13 0Z`],
        strands: [`M${f(46.5)} ${f(top - 6)}c2-2.6 5-2.6 7 0`],
      };
    case 'mohawk':
      return {
        back: [],
        front: [
          `M${f(45.5)} ${f(brow - 3)}L${f(44)} ${f(top - 4)}L${f(47)} ${f(top - 2)}L${f(46.5)} ${f(top - 11)}L${f(50)} ${f(top - 5)}L${f(51.5)} ${f(top - 13)}L${f(53.5)} ${f(top - 5)}L${f(56.5)} ${f(top - 10)}L${f(55.5)} ${f(top - 1)}L${f(57)} ${f(top - 2)}L${f(54.5)} ${f(brow - 3)}Z`,
        ],
        strands: [],
      };
    case 'long': {
      const bottom = cy + hh + 22;
      return {
        back: [
          `M${f(L - 5)} ${f(bottom)}C${f(L - 9)} ${f(cy)} ${f(L - 6)} ${f(top - 3)} 50 ${f(top - 3.5)}C${f(R + 6)} ${f(top - 3)} ${f(R + 9)} ${f(cy)} ${f(R + 5)} ${f(bottom)}Z`,
        ],
        front: [
          `M${f(L - 1.8)} ${f(cy + hh * 0.2)}C${f(L - 2.5)} ${f(cy - hh * 0.85)} ${f(50 - hw * 0.5)} ${f(top - 2.6)} ${f(50 + 2)} ${f(top - 2.6)}C${f(50 + hw * 0.7)} ${f(top - 2.6)} ${f(R + 2)} ${f(cy - hh * 0.7)} ${f(R + 1.8)} ${f(cy + hh * 0.2)}C${f(R - 0.5)} ${f(cy - hh * 0.3)} ${f(50 + hw * 0.5)} ${f(brow - 2)} ${f(50 - 2)} ${f(brow - 3.5)}C${f(50 - hw * 0.45)} ${f(brow - 1)} ${f(L + 1)} ${f(cy - hh * 0.25)} ${f(L - 1.8)} ${f(cy + hh * 0.2)}Z`,
        ],
        strands: [],
      };
    }
    case 'combover':
      return {
        back: [],
        front: [
          `M${f(L - 0.5)} ${f(cy - hh * 0.2)}C${f(L - 1)} ${f(cy - hh * 0.62)} ${f(L + 2)} ${f(cy - hh * 0.8)} ${f(L + 5)} ${f(cy - hh * 0.82)}C${f(L + 3.5)} ${f(cy - hh * 0.55)} ${f(L + 3)} ${f(cy - hh * 0.35)} ${f(L + 3)} ${f(cy - hh * 0.2)}Z`,
          `M${f(R + 0.5)} ${f(cy - hh * 0.2)}C${f(R + 1)} ${f(cy - hh * 0.55)} ${f(R - 1)} ${f(cy - hh * 0.72)} ${f(R - 3.5)} ${f(cy - hh * 0.75)}C${f(R - 2.5)} ${f(cy - hh * 0.5)} ${f(R - 2.2)} ${f(cy - hh * 0.35)} ${f(R - 2.2)} ${f(cy - hh * 0.2)}Z`,
        ],
        strands: [
          `M${f(L + 3)} ${f(cy - hh * 0.72)}C${f(L + 8)} ${f(top - 2)} ${f(R - 6)} ${f(top - 1.5)} ${f(R - 1)} ${f(cy - hh * 0.62)}`,
          `M${f(L + 3.5)} ${f(cy - hh * 0.6)}C${f(L + 9)} ${f(top + 1.5)} ${f(R - 7)} ${f(top + 2)} ${f(R - 2)} ${f(cy - hh * 0.5)}`,
          `M${f(L + 4)} ${f(cy - hh * 0.48)}C${f(L + 10)} ${f(top + 4.5)} ${f(R - 8)} ${f(top + 5)} ${f(R - 3)} ${f(cy - hh * 0.4)}`,
        ],
      };
    case 'pigtails':
      return {
        back: [
          `M${f(L - 4)} ${f(cy - 4)}c-6 2-7.5 12-4.5 19.5c1.3 3.2 4.2 2.6 4.6-.4c.6-4.9 2.2-10.6 5.4-15.4Z`,
          `M${f(R + 4)} ${f(cy - 4)}c6 2 7.5 12 4.5 19.5c-1.3 3.2-4.2 2.6-4.6-.4c-.6-4.9-2.2-10.6-5.4-15.4Z`,
        ],
        front: [
          cap(1.4, cy - hh * 0.2),
          `M${f(L - 3.8)} ${f(cy - 5.5)}a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z`,
          `M${f(R - 0.6)} ${f(cy - 5.5)}a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z`,
        ],
        strands: [],
      };
    case 'afro': {
      const r = hw + 9.5;
      const ccx = 50;
      const ccy = cy - hh * 0.35;
      let d = '';
      const bumps = 13;
      for (let i = 0; i <= bumps; i++) {
        const a = Math.PI * 0.98 + (i / bumps) * Math.PI * 1.04;
        const x = ccx + r * Math.cos(a);
        const y = ccy + r * 0.92 * Math.sin(a);
        if (i === 0) d += `M${f(x)} ${f(y + 10)}L${f(x)} ${f(y)}`;
        else d += `Q${f(ccx + (r + 4.2) * Math.cos(a - Math.PI / bumps / 1.04 / 2))} ${f(ccy + (r + 4.2) * 0.92 * Math.sin(a - Math.PI / bumps / 1.04 / 2))} ${f(x)} ${f(y)}`;
      }
      d += `L${f(ccx + r * Math.cos(Math.PI * 2.02))} ${f(ccy + r * 0.92 * Math.sin(Math.PI * 2.02) + 10)}Z`;
      return { back: [d], front: [cap(2.5, cy - hh * 0.25)], strands: [] };
    }
    case 'messy':
    default: {
      const hl = cy - hh * 0.3;
      return {
        back: [],
        front: [
          `M${f(L - 1)} ${f(hl + 2)}C${f(L - 3)} ${f(cy - hh * 0.8)} ${f(50 - hw * 0.8)} ${f(top - 3)} ${f(50 - hw * 0.45)} ${f(top - 2.5)}L${f(50 - hw * 0.5)} ${f(top - 7)}L${f(50 - hw * 0.15)} ${f(top - 3.2)}L${f(50 + hw * 0.05)} ${f(top - 8.5)}L${f(50 + hw * 0.3)} ${f(top - 3)}L${f(50 + hw * 0.62)} ${f(top - 6.5)}L${f(50 + hw * 0.66)} ${f(top - 1.8)}C${f(R + 2.5)} ${f(cy - hh * 0.75)} ${f(R + 2)} ${f(hl - 2)} ${f(R + 0.5)} ${f(hl + 2)}L${f(R - 2.4)} ${f(hl - 1.6)}L${f(50 + hw * 0.45)} ${f(brow - 1)}L${f(50 + hw * 0.18)} ${f(brow - 4.5)}L${f(50 - hw * 0.12)} ${f(brow - 0.8)}L${f(50 - hw * 0.42)} ${f(brow - 4)}L${f(50 - hw * 0.7)} ${f(brow - 0.5)}L${f(L + 1.6)} ${f(hl - 1.2)}Z`,
        ],
        strands: [],
      };
    }
  }
}

export interface EyeShape {
  /** Socket shadow ellipses: [cx, cy, rx, ry]. */
  sockets: [number, number, number, number][];
  /** Sclera ellipses. */
  whites: [number, number, number, number][];
  /** Iris circles: [cx, cy, r]. */
  irises: [number, number, number][];
  /** Pupils: [cx, cy, r]. */
  pupils: [number, number, number][];
  /** Lids drawn in skin colour over the eye (paths). */
  lids: string[];
  /** Lid lines (stroked, dark). */
  lines: string[];
}

export function eyeShapes(style: string | null | undefined, d: PortraitDims): EyeShape {
  const ey = d.cy + 1.5;
  const lx = 50 - 7.2;
  const rx = 50 + 7.8;
  const lid = (x: number, y: number, w: number, h: number, cover: number) =>
    `M${f(x - w - 0.6)} ${f(y)}C${f(x - w)} ${f(y - h - 1.4)} ${f(x + w)} ${f(y - h - 1.4)} ${f(x + w + 0.6)} ${f(y)}L${f(x + w + 0.6)} ${f(y - h + cover)}C${f(x + w * 0.5)} ${f(y - h + cover + 0.9)} ${f(x - w * 0.5)} ${f(y - h + cover + 0.9)} ${f(x - w - 0.6)} ${f(y - h + cover)}Z`;
  const lidLine = (x: number, y: number, w: number, h: number, cover: number) =>
    `M${f(x - w - 0.4)} ${f(y - h + cover)}C${f(x - w * 0.5)} ${f(y - h + cover + 0.9)} ${f(x + w * 0.5)} ${f(y - h + cover + 0.9)} ${f(x + w + 0.4)} ${f(y - h + cover)}`;
  switch (style) {
    case 'wide':
      return {
        sockets: [[lx, ey, 6.2, 5.8], [rx, ey, 6.2, 5.8]],
        whites: [[lx, ey, 4.9, 4.9], [rx, ey, 4.9, 4.9]],
        irises: [[lx + 0.4, ey + 0.3, 2.6], [rx - 0.2, ey + 0.3, 2.6]],
        pupils: [[lx + 0.4, ey + 0.3, 1.05], [rx - 0.2, ey + 0.3, 1.05]],
        lids: [],
        lines: [],
      };
    case 'mismatched':
      return {
        sockets: [[lx, ey, 6.6, 6.2], [rx, ey - 0.8, 4.4, 4.2]],
        whites: [[lx, ey, 5.2, 5.2], [rx, ey - 0.8, 3.1, 3.1]],
        irises: [[lx + 0.5, ey + 0.4, 2.7], [rx, ey - 0.6, 1.7]],
        pupils: [[lx + 0.5, ey + 0.4, 1.1], [rx, ey - 0.6, 0.75]],
        lids: [lid(rx, ey - 0.8, 3.1, 3.1, 1.6)],
        lines: [lidLine(rx, ey - 0.8, 3.1, 3.1, 1.6)],
      };
    case 'sleepy':
      return {
        sockets: [[lx, ey, 5.6, 4.6], [rx, ey, 5.6, 4.6]],
        whites: [[lx, ey + 0.4, 4.3, 3.4], [rx, ey + 0.4, 4.3, 3.4]],
        irises: [[lx, ey + 1.3, 2.4], [rx, ey + 1.3, 2.4]],
        pupils: [[lx, ey + 1.4, 1], [rx, ey + 1.4, 1]],
        lids: [lid(lx, ey + 0.4, 4.3, 3.4, 4.6), lid(rx, ey + 0.4, 4.3, 3.4, 4.6)],
        lines: [lidLine(lx, ey + 0.4, 4.3, 3.4, 4.6), lidLine(rx, ey + 0.4, 4.3, 3.4, 4.6)],
      };
    case 'beady':
      return {
        sockets: [[lx, ey, 4.4, 4], [rx, ey, 4.4, 4]],
        whites: [],
        irises: [[lx, ey, 2.1], [rx, ey, 2.1]],
        pupils: [],
        lids: [],
        lines: [],
      };
    case 'droopy':
    default:
      return {
        sockets: [[lx, ey, 5.9, 5.1], [rx, ey, 5.9, 5.1]],
        whites: [[lx, ey, 4.5, 3.9], [rx, ey, 4.5, 3.9]],
        irises: [[lx + 0.3, ey + 0.7, 2.45], [rx - 0.1, ey + 0.7, 2.45]],
        pupils: [[lx + 0.3, ey + 0.8, 1], [rx - 0.1, ey + 0.8, 1]],
        lids: [lid(lx, ey, 4.5, 3.9, 2.9), lid(rx, ey, 4.5, 3.9, 2.6)],
        lines: [lidLine(lx, ey, 4.5, 3.9, 2.9), lidLine(rx, ey, 4.5, 3.9, 2.6)],
      };
  }
}

/** Mouth path for an expression. */
export function mouthPath(expression: string | null | undefined, d: PortraitDims): string {
  const y = d.cy + Math.min(13.5, d.hh * 0.66);
  switch (expression) {
    case 'happy':
    case 'flirty':
      return `M${f(43)} ${f(y - 1)}C${f(46)} ${f(y + 3.6)} ${f(54.5)} ${f(y + 3.6)} ${f(57.5)} ${f(y - 1.4)}`;
    case 'sad':
      return `M${f(43.5)} ${f(y + 1.6)}C${f(46.5)} ${f(y - 1.8)} ${f(53.5)} ${f(y - 1.8)} ${f(56.5)} ${f(y + 1.2)}`;
    case 'angry':
      return `M${f(43.5)} ${f(y + 0.8)}L${f(47)} ${f(y - 0.4)}L${f(50.5)} ${f(y + 0.6)}L${f(54)} ${f(y - 0.4)}L${f(57)} ${f(y + 0.6)}`;
    case 'shocked':
      return `M${f(48)} ${f(y)}a2.6 3 0 1 0 5.2 0a2.6 3 0 1 0 -5.2 0Z`;
    default:
      return `M${f(43)} ${f(y)}C${f(47)} ${f(y + 1.4)} ${f(53)} ${f(y + 0.6)} ${f(57.5)} ${f(y - 0.9)}`;
  }
}

/** Small deterministic hash for stable per-zombie variation. */
export function appearanceSeed(app: Partial<ZombieAppearance> | null | undefined): number {
  const s = `${app?.hairColor ?? ''}|${app?.topColor ?? ''}|${app?.skinTone ?? ''}|${app?.eyeColor ?? ''}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
