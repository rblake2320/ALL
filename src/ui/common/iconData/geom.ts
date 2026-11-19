/**
 * Geometry helpers for the icon set (24px grid). Each returns SVG path data.
 * Part syntax used by icon definitions (see icons.tsx):
 *   'M…'      stroked path (1.75px, round caps/joins)
 *   'F M…'    filled with currentColor
 *   'T M…'    soft fill (22% opacity) — the duotone "volume" layer, draw before outlines
 *   'D M…'    dim stroke (45% opacity) — secondary detail lines
 *   { d, fill?, soft?, dim?, width?, transform?, dash? } for anything else
 */
export type IconPart =
  | string
  | { d: string; fill?: boolean; soft?: boolean; dim?: boolean; width?: number; transform?: string; dash?: string };
export type IconDef = readonly IconPart[];

const f = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Circle as a path. */
export function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`;
}

/** Ellipse as a path. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0z`;
}

/** Rounded rectangle as a path. */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
  return (
    `M${f(x + rr)} ${f(y)}h${f(w - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(rr)}` +
    `v${f(h - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(-rr)} ${f(rr)}` +
    `h${f(-(w - 2 * rr))}a${f(rr)} ${f(rr)} 0 0 1 ${f(-rr)} ${f(-rr)}` +
    `v${f(-(h - 2 * rr))}a${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(-rr)}z`
  );
}

/** Regular star polygon (points >= 3). */
export function star(cx: number, cy: number, rOuter: number, rInner: number, points = 5, rotDeg = -90): string {
  const n = Math.max(3, Math.floor(points));
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = ((rotDeg + (i * 180) / n) * Math.PI) / 180;
    d += `${i === 0 ? 'M' : 'L'}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }
  return d + 'z';
}

/** Gear outline with trapezoid teeth. */
export function gear(cx: number, cy: number, rOuter: number, rInner: number, teeth: number): string {
  const n = Math.max(4, Math.floor(teeth));
  const step = (Math.PI * 2) / n;
  const topHalf = step * 0.2;
  const baseHalf = step * 0.3;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2;
    const pts: [number, number][] = [
      [rInner, a - baseHalf],
      [rOuter, a - topHalf],
      [rOuter, a + topHalf],
      [rInner, a + baseHalf],
    ];
    for (let j = 0; j < pts.length; j++) {
      const [r, ang] = pts[j];
      const x = cx + r * Math.cos(ang);
      const y = cy + r * Math.sin(ang);
      if (i === 0 && j === 0) d += `M${f(x)} ${f(y)}`;
      else if (j === 0) d += `A${f(rInner)} ${f(rInner)} 0 0 1 ${f(x)} ${f(y)}`;
      else d += `L${f(x)} ${f(y)}`;
    }
  }
  const a0 = -Math.PI / 2 - baseHalf;
  d += `A${f(rInner)} ${f(rInner)} 0 0 1 ${f(cx + rInner * Math.cos(a0))} ${f(cy + rInner * Math.sin(a0))}z`;
  return d;
}

/** Radial rays (sun). */
export function rays(cx: number, cy: number, r0: number, r1: number, count: number, rotDeg = 0): string {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = ((rotDeg + (i * 360) / count) * Math.PI) / 180;
    d += `M${f(cx + r0 * Math.cos(a))} ${f(cy + r0 * Math.sin(a))}L${f(cx + r1 * Math.cos(a))} ${f(cy + r1 * Math.sin(a))}`;
  }
  return d;
}

/** Six-armed snowflake with side branches. */
export function snowflake(cx: number, cy: number, r: number): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    const ex = cx + r * Math.cos(a);
    const ey = cy + r * Math.sin(a);
    d += `M${f(cx)} ${f(cy)}L${f(ex)} ${f(ey)}`;
    const bx = cx + r * 0.58 * Math.cos(a);
    const by = cy + r * 0.58 * Math.sin(a);
    for (const s of [-1, 1]) {
      const b = a + s * 0.75;
      const bl = r * 0.3;
      d += `M${f(bx)} ${f(by)}L${f(bx + bl * Math.cos(b))} ${f(by + bl * Math.sin(b))}`;
    }
  }
  return d;
}

/** Classic heart centred on (12, 12) spanning ~3.5..20.5 × 4.5..20.25 (scaled via transform for variants). */
export const HEART =
  'M12 20.25C12 20.25 3.5 15.4 3.5 9.25 3.5 6.6 5.6 4.5 8.15 4.5c1.6 0 3 .8 3.85 2.1.85-1.3 2.25-2.1 3.85-2.1 2.55 0 4.65 2.1 4.65 4.75 0 6.15-8.5 11-8.5 11z';

/** Open hand (palm facing viewer, four fingers + thumb). */
export const HAND =
  'M8.25 12.75V6.6a1.3 1.3 0 0 1 2.6 0V11M10.85 11V5.15a1.3 1.3 0 0 1 2.6 0V11M13.45 11V6.1a1.3 1.3 0 0 1 2.6 0v5.15M16.05 11.25V8.6a1.3 1.3 0 0 1 2.6 0v4.9c0 4.1-2.75 7.25-6.6 7.25-2.55 0-4.2-1.15-5.45-3.05l-2.25-3.5a1.3 1.3 0 0 1 2.1-1.55l1.8 1.9';
