/**
 * Camera framing around the HUD (W-116, D-065, owner playtest #1: the first objective — the mailbox — sat behind the agent
 * panel). Two pure pieces, unit-tested in tests/unit/shared/framing.test.ts:
 *
 *  - `pickFramePoint` — where on screen a target (plus its marker) should sit so that a box of `box` size around it
 *    covers NO HUD panel: the free spot nearest the preferred point (the viewport centre), scanned like the phone
 *    callout's free-spot search (src/ui/hud/lib/phoneLayout.ts placeCalloutAvoiding); if nothing is free, the spot with
 *    the least overlap.
 *  - `solveFocus` — the camera focus that puts a world point at that screen spot, by Newton steps on a projection
 *    callback (the renderer projects with the camera's goal pose, so the result is exact for perspective cameras).
 */

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FrameSize {
  w: number;
  h: number;
}
export interface ScreenPoint {
  x: number;
  y: number;
}

const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function rectOverlap(a: FrameRect, b: FrameRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Screen point (the CENTRE of a `box`-sized area) nearest `preferred` whose box overlaps none of `avoid` and stays
 * `margin` inside the viewport. Ties go to the nearest point; with no free spot, the least overlap wins.
 * `overlap` reports the covered area at the returned point (0 = fully clear).
 */
export function pickFramePoint(viewport: FrameSize, avoid: readonly FrameRect[], box: FrameSize, preferred?: ScreenPoint, margin = 8, step = 8): ScreenPoint & { overlap: number } {
  const vw = Math.max(0, fin(viewport?.w));
  const vh = Math.max(0, fin(viewport?.h));
  const bw = Math.min(Math.max(0, fin(box?.w)), Math.max(0, vw - 2 * margin));
  const bh = Math.min(Math.max(0, fin(box?.h)), Math.max(0, vh - 2 * margin));
  const px = fin(preferred?.x, vw / 2);
  const py = fin(preferred?.y, vh / 2);
  const rects = (avoid ?? []).filter((r) => r && fin(r.w) > 0 && fin(r.h) > 0).map((r) => ({ x: fin(r.x), y: fin(r.y), w: fin(r.w), h: fin(r.h) }));
  const cost = (cx: number, cy: number) => rects.reduce((s, r) => s + rectOverlap({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }, r), 0);
  const x0 = margin + bw / 2;
  const x1 = Math.max(x0, vw - margin - bw / 2);
  const y0 = margin + bh / 2;
  const y1 = Math.max(y0, vh - margin - bh / 2);
  const clampX = (x: number) => Math.min(Math.max(x, x0), x1);
  const clampY = (y: number) => Math.min(Math.max(y, y0), y1);
  // the preferred point itself first (the common case: nothing in the way)
  const p0 = { x: clampX(px), y: clampY(py) };
  const c0 = cost(p0.x, p0.y);
  if (c0 === 0) return { ...p0, overlap: 0 };
  let best = { ...p0, overlap: c0, d: 0 };
  const s = Math.max(2, fin(step, 8));
  for (let y = y0; y <= y1 + 1e-6; y += s) {
    for (let x = x0; x <= x1 + 1e-6; x += s) {
      const o = cost(x, y);
      const d = Math.hypot(x - px, y - py);
      if (o < best.overlap || (o === best.overlap && d < best.d)) best = { x, y, overlap: o, d };
    }
  }
  return { x: best.x, y: best.y, overlap: best.overlap };
}

/**
 * Camera focus (world x/z) at which `project(focusX, focusZ)` — the target's screen position for that focus — lands on
 * `desired`. Newton iterations with a numerical Jacobian (`h` world units). Returns null if the projection is unusable
 * (target behind the camera, singular Jacobian) — the caller then simply centres the target.
 */
export function solveFocus(
  project: (fx: number, fz: number) => ScreenPoint | null,
  start: { x: number; z: number },
  desired: ScreenPoint,
  iterations = 4,
  h = 0.5,
  tolerancePx = 1,
): { x: number; z: number; error: number } | null {
  let fx = fin(start?.x);
  let fz = fin(start?.z);
  let err = Infinity;
  for (let i = 0; i <= iterations; i++) {
    const p = project(fx, fz);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const ex = fin(desired?.x) - p.x;
    const ey = fin(desired?.y) - p.y;
    err = Math.hypot(ex, ey);
    if (err <= tolerancePx || i === iterations) break;
    const px = project(fx + h, fz);
    const pz = project(fx, fz + h);
    if (!px || !pz) return null;
    // J = d(screen)/d(focus): columns = screen change per unit focus x / z
    const a = (px.x - p.x) / h;
    const c = (px.y - p.y) / h;
    const b = (pz.x - p.x) / h;
    const d = (pz.y - p.y) / h;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
    fx += (d * ex - b * ey) / det;
    fz += (-c * ex + a * ey) / det;
    if (!Number.isFinite(fx) || !Number.isFinite(fz)) return null;
  }
  return { x: fx, z: fz, error: err };
}

/**
 * The box a story target needs clear on screen: the object plus the marker floating above it. The target point sits
 * `anchorFrac` of the way down the box (the marker takes the top part).
 */
export const STORY_FRAME_BOX: FrameSize = { w: 150, h: 210 };
export const STORY_FRAME_ANCHOR = 0.62;

/** Screen point for the target itself, given the free box centre from pickFramePoint. */
export function anchorInBox(centre: ScreenPoint, box: FrameSize = STORY_FRAME_BOX, anchorFrac = STORY_FRAME_ANCHOR): ScreenPoint {
  return { x: centre.x, y: centre.y - box.h / 2 + box.h * anchorFrac };
}
