/**
 * DEV ONLY — placeholder catalog thumbnails: an isometric prism sized from the physical footprint/height, shaded
 * in the item's tint (or first variant), with a small category accent. Returned as an SVG data URL, the same
 * shape of value the real renderer returns (PNG data URL).
 */
import { PHYSICAL_BY_ID } from '../../../shared/catalog';
import { mixHex, parseHex } from '../lib/format';

const CAT_COLOR: Record<string, string> = {
  seating: '#6b4f8a',
  surfaces: '#7a5a3e',
  kitchen: '#b7c2bd',
  preservation: '#8fb7c4',
  beds: '#6b4a35',
  electronics: '#4a4a5e',
  hobbies: '#8a6a4a',
  decor: '#6f8f5e',
  lighting: '#a5532f',
  outdoor: '#77736b',
  misc: '#8a7a5a',
  doors: '#5e4030',
  windows: '#5d6b6b',
};

export function thumbSvg(defId: string, tint: string | null): string {
  const spec = PHYSICAL_BY_ID[defId];
  const cat = spec?.category ?? 'misc';
  const base = tint && parseHex(tint) ? tint : spec?.variants?.[0] ?? CAT_COLOR[cat] ?? '#8a7a5a';
  const w = Math.max(1, Math.min(3, spec?.footprint.w ?? 1));
  const d = Math.max(1, Math.min(3, spec?.footprint.d ?? 1));
  const flat = cat === 'doors' || cat === 'windows';
  const hgt = flat ? 2.1 : Math.max(0.15, Math.min(2.2, spec?.height ?? 1));
  const s = 34 / Math.max(w, d, hgt * 0.9, 1.4);
  const cos = Math.cos(Math.PI / 6);
  const sin = 0.5;
  const P = (x: number, y: number, z: number) => [64 + (x - z) * cos * s, 82 + (x + z) * sin * s - y * s];
  const cx = w / 2;
  const cz = d / 2;
  const q = (pts: number[][]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const box = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, col: string) => {
    const top = [P(x0 - cx, y1, z0 - cz), P(x1 - cx, y1, z0 - cz), P(x1 - cx, y1, z1 - cz), P(x0 - cx, y1, z1 - cz)];
    const left = [P(x0 - cx, y1, z1 - cz), P(x1 - cx, y1, z1 - cz), P(x1 - cx, y0, z1 - cz), P(x0 - cx, y0, z1 - cz)];
    const right = [P(x1 - cx, y1, z0 - cz), P(x1 - cx, y1, z1 - cz), P(x1 - cx, y0, z1 - cz), P(x1 - cx, y0, z0 - cz)];
    return `<polygon points="${q(left)}" fill="${col}"/><polygon points="${q(right)}" fill="${mixHex(col, '#120d18', 0.32)}"/><polygon points="${q(top)}" fill="${mixHex(col, '#fff4dc', 0.2)}"/>`;
  };
  let body = '';
  const shadow = `<ellipse cx="64" cy="${(82 + (w + d) * 0.25 * s).toFixed(1)}" rx="${(26 + (w + d) * 7).toFixed(1)}" ry="${(9 + (w + d) * 2.5).toFixed(1)}" fill="#000" opacity="0.28"/>`;
  switch (cat) {
    case 'seating':
      body = box(0, 0, w, d, 0.25, 0.48, base) + box(0, 0, w, 0.22, 0.48, hgt, mixHex(base, '#000', 0.1));
      break;
    case 'surfaces':
      body = box(0.08, 0.08, 0.2, 0.2, 0, hgt - 0.08, '#3b2a22') + box(w - 0.2, d - 0.2, w - 0.08, d - 0.08, 0, hgt - 0.08, '#3b2a22') + box(0.08, d - 0.2, 0.2, d - 0.08, 0, hgt - 0.08, '#3b2a22') + box(0, 0, w, d, hgt - 0.1, hgt, base);
      break;
    case 'beds':
      body = box(0.1, 0, w - 0.1, d, 0, hgt, base) + box(0.25, 0.15, w - 0.25, d - 0.15, hgt, hgt + 0.04, '#e8e0c8');
      break;
    case 'electronics': {
      body = box(0.1, 0.25, w - 0.1, d - 0.05, 0, hgt, base);
      const sx0 = 0.22;
      const sx1 = w - 0.22;
      const scr = [P(sx0 - cx, hgt - 0.15, d - 0.05 - cz), P(sx1 - cx, hgt - 0.15, d - 0.05 - cz), P(sx1 - cx, 0.25, d - 0.05 - cz), P(sx0 - cx, 0.25, d - 0.05 - cz)];
      body += `<polygon points="${q(scr)}" fill="#9fe870" opacity="0.85"/>`;
      break;
    }
    case 'decor':
      if (defId.startsWith('rug')) body = box(0, 0, w, d, 0, 0.05, base);
      else if (defId.startsWith('plant')) {
        body = box(0.3, 0.3, 0.7, 0.7, 0, 0.35, '#7a4a35');
        const [x, y] = P(0, 0.75, 0);
        body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s * 0.42).toFixed(1)}" fill="${defId.includes('dead') ? '#7a6a4a' : '#5f8a4a'}"/><circle cx="${(x - s * 0.25).toFixed(1)}" cy="${(y + s * 0.1).toFixed(1)}" r="${(s * 0.28).toFixed(1)}" fill="${defId.includes('dead') ? '#8a7a5a' : '#6f9f58'}"/>`;
      } else body = box(0, 0.8, w, 1, 0.6, 1.4, base);
      break;
    case 'lighting': {
      body = box(0.42, 0.42, 0.58, 0.58, 0, hgt * 0.85, '#3b302f');
      const [x, y] = P(0, hgt * 0.9, 0);
      body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s * 0.5).toFixed(1)}" fill="#ffb35a" opacity="0.28"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s * 0.2).toFixed(1)}" fill="#ffd08f"/>`;
      break;
    }
    case 'doors':
    case 'windows': {
      body = box(0, 0.45, 1, 0.55, 0, hgt, base);
      if (cat === 'windows') {
        const g = [P(0.18 - cx, 1.7, 0.55 - cz), P(0.82 - cx, 1.7, 0.55 - cz), P(0.82 - cx, 0.6, 0.55 - cz), P(0.18 - cx, 0.6, 0.55 - cz)];
        body += `<polygon points="${q(g)}" fill="#7fe0ff" opacity="0.55"/>`;
      } else {
        const [x, y] = P(0.8 - cx, 1, 0.55 - cz);
        body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#ffd08f"/>`;
      }
      break;
    }
    case 'outdoor':
      body = defId.startsWith('tree') ? box(0.4, 0.4, 0.6, 0.6, 0, hgt, '#4a3a30') + box(0.1, 0.1, 0.9, 0.9, hgt * 0.6, hgt * 0.66, '#4a3a30') : box(0.15, 0.4, 0.85, 0.6, 0, hgt, base);
      break;
    case 'kitchen':
    case 'preservation':
    case 'hobbies':
    case 'misc':
    default:
      body = box(0.06, 0.06, w - 0.06, d - 0.06, 0, hgt, base);
      break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${shadow}<g stroke="#120d18" stroke-opacity="0.35" stroke-width="0.8" stroke-linejoin="round">${body}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
