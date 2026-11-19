/**
 * Save-thumbnail encoding: cover-crop a rendered canvas into w×h and encode as JPEG, stepping the quality down
 * until the data URL fits the platform's SaveMeta.thumbnail budget (≤ 64 KB). Returns '' on failure.
 */
import { clamp, finiteOr } from './math';

/** ≈ 64 KB of data URL (platform SaveMeta.thumbnail limit). */
export const SNAPSHOT_MAX_CHARS = 64 * 1024;
const QUALITIES = [0.86, 0.72, 0.6, 0.45, 0.32];

/** Source rect that cover-crops a (sw×sh) image into the aspect of (dw×dh). Pure. */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const w0 = Math.max(1, finiteOr(sw, 1));
  const h0 = Math.max(1, finiteOr(sh, 1));
  const da = Math.max(1e-3, finiteOr(dw, 1)) / Math.max(1e-3, finiteOr(dh, 1));
  let w = w0;
  let h = h0;
  if (w0 / h0 > da) w = h0 * da;
  else h = w0 / da;
  return { x: (w0 - w) / 2, y: (h0 - h) / 2, w, h };
}

export function encodeSnapshot(src: HTMLCanvasElement, width: number, height: number, maxChars = SNAPSHOT_MAX_CHARS): string {
  const w = clamp(Math.floor(finiteOr(width, 320)), 16, 4096);
  const h = clamp(Math.floor(finiteOr(height, 180)), 16, 4096);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return '';
  const r = coverCrop(src.width, src.height, w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
  for (const q of QUALITIES) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= maxChars) return url;
  }
  // even the lowest quality is too big (huge request / very noisy frame): halve the size until it fits
  let cw = w;
  let ch = h;
  let prev: HTMLCanvasElement = c;
  for (let i = 0; i < 4 && cw > 16 && ch > 16; i++) {
    cw = Math.max(16, cw >> 1);
    ch = Math.max(16, ch >> 1);
    const s = document.createElement('canvas');
    s.width = cw;
    s.height = ch;
    const sg = s.getContext('2d');
    if (!sg) return '';
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(prev, 0, 0, cw, ch);
    const url = s.toDataURL('image/jpeg', QUALITIES[QUALITIES.length - 1]);
    if (url.length <= maxChars) return url;
    prev = s;
  }
  return '';
}
