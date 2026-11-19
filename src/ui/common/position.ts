/**
 * Smart positioning for tooltips and popovers: try the preferred side, flip to the opposite side when it
 * doesn't fit, then the perpendicular sides, else the side with the most room; finally clamp into the viewport.
 */
export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Positioned {
  x: number;
  y: number;
  placement: Placement;
  /** Arrow offset along the tooltip edge (px from its left for top/bottom, from its top for left/right). */
  arrow: number;
}

const num = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

const OPPOSITE: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const PERP: Record<Placement, Placement[]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['top', 'bottom'],
  right: ['top', 'bottom'],
};

export function computePosition(
  anchorIn: RectLike,
  tipIn: Size,
  viewportIn: Size,
  preferred: Placement = 'top',
  gap = 8,
  margin = 8,
): Positioned {
  const a = { left: num(anchorIn.left), top: num(anchorIn.top), width: Math.max(0, num(anchorIn.width)), height: Math.max(0, num(anchorIn.height)) };
  const tip = { width: Math.max(0, num(tipIn.width)), height: Math.max(0, num(tipIn.height)) };
  const vp = { width: Math.max(0, num(viewportIn.width, 1)), height: Math.max(0, num(viewportIn.height, 1)) };
  const g = Math.max(0, num(gap, 8));
  const m = Math.max(0, num(margin, 8));
  const pref: Placement = OPPOSITE[preferred] ? preferred : 'top';

  const space: Record<Placement, number> = {
    top: a.top - m,
    bottom: vp.height - (a.top + a.height) - m,
    left: a.left - m,
    right: vp.width - (a.left + a.width) - m,
  };
  const need = (p: Placement) => (p === 'top' || p === 'bottom' ? tip.height + g : tip.width + g);
  const fits = (p: Placement) => space[p] >= need(p);

  const order: Placement[] = [pref, OPPOSITE[pref], ...PERP[pref]];
  let placement = order.find(fits);
  if (!placement) placement = order.reduce((best, p) => (space[p] - need(p) > space[best] - need(best) ? p : best), pref);

  const cx = a.left + a.width / 2;
  const cy = a.top + a.height / 2;
  let x: number;
  let y: number;
  if (placement === 'top' || placement === 'bottom') {
    x = cx - tip.width / 2;
    y = placement === 'top' ? a.top - g - tip.height : a.top + a.height + g;
  } else {
    y = cy - tip.height / 2;
    x = placement === 'left' ? a.left - g - tip.width : a.left + a.width + g;
  }
  const maxX = Math.max(m, vp.width - m - tip.width);
  const maxY = Math.max(m, vp.height - m - tip.height);
  x = Math.min(Math.max(x, m), maxX);
  y = Math.min(Math.max(y, m), maxY);

  const edge = 10;
  let arrow: number;
  if (placement === 'top' || placement === 'bottom') arrow = Math.min(Math.max(cx - x, edge), Math.max(edge, tip.width - edge));
  else arrow = Math.min(Math.max(cy - y, edge), Math.max(edge, tip.height - edge));

  return { x: Math.round(x), y: Math.round(y), placement, arrow: Math.round(arrow) };
}
