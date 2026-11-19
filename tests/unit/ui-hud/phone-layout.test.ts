/**
 * W-114 phone HUD layout: the viewport rule, the tip placement that keeps clear of the portrait / needs panel, the
 * 44 px queue geometry, and a static guard that phone.css can never reach the desktop layout.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEUE_GEOMETRY, queueCapacity, type Rect } from '../../../src/ui/hud/lib/layout';
import {
  isPhoneLayout,
  orientationOf,
  overlapArea,
  PHONE_MIN_TARGET,
  PHONE_QUERY,
  PHONE_SHORT_SIDE_MAX,
  phoneQueueGeometry,
  placeCalloutAvoiding,
} from '../../../src/ui/hud/lib/phoneLayout';

const inside = (r: Rect, vp: { w: number; h: number }, m: number) => r.x >= m - 0.01 && r.y >= m - 0.01 && r.x + r.w <= vp.w - m + 0.01 && r.y + r.h <= vp.h - m + 0.01;

describe('phone layout rule', () => {
  it('is a coarse pointer with a short side ≤ 500 px, in both orientations', () => {
    expect(isPhoneLayout(390, 844, true)).toBe(true);
    expect(isPhoneLayout(844, 390, true)).toBe(true);
    expect(isPhoneLayout(500, 900, true)).toBe(true);
    expect(isPhoneLayout(932, 430, true)).toBe(true);
    expect(isPhoneLayout(1024, 501, true)).toBe(false);
    expect(isPhoneLayout(1024, 768, true)).toBe(false); // a landscape tablet keeps the desktop HUD
    expect(isPhoneLayout(834, 1194, true)).toBe(false); // a portrait 11" tablet too
    // W-118: a window under 800 px wide is compact whatever the pointer (a 768 px portrait tablet got 1rem = 9.6 px)
    expect(isPhoneLayout(768, 1024, true)).toBe(true);
  });
  it('W-118: also applies to a compact mouse-driven window (unzoomed < 800 wide or < 450 tall), never to a zoomed desktop', () => {
    // Sol's audit: a 390 px mouse window kept the desktop HUD at 1rem = 4.9 px
    expect(isPhoneLayout(390, 844, false)).toBe(true);
    expect(isPhoneLayout(844, 390, false)).toBe(true);
    expect(isPhoneLayout(799, 600, false)).toBe(true);
    expect(isPhoneLayout(2000, 300, false)).toBe(true);
    expect(isPhoneLayout(800, 600, false)).toBe(false);
    expect(isPhoneLayout(1280, 450, false)).toBe(false);
    expect(isPhoneLayout(1280, 720, false)).toBe(false);
    // the same windows zoomed: CSS viewport = window / zoom, so the unzoomed size decides (WCAG 1.4.4 text scaling kept)
    expect(isPhoneLayout(640, 360, false, 2)).toBe(false); // 1280x720 at 200 %
    expect(isPhoneLayout(320, 180, false, 4)).toBe(false); // 1280x720 at 400 %
    expect(isPhoneLayout(400, 300, false, 2)).toBe(false); // 800x600 at 200 %
    expect(isPhoneLayout(640, 360, false)).toBe(true); // a real 640x360 window
    expect(isPhoneLayout(390, 844, false, Number.NaN)).toBe(true); // a garbage zoom reads as 1
  });
  it('treats missing / invalid sizes as unknown, not as tiny', () => {
    expect(isPhoneLayout(Number.NaN, Number.NaN, true)).toBe(false);
    expect(isPhoneLayout(0, 0, true)).toBe(false);
    expect(isPhoneLayout(Number.NaN, 390, true)).toBe(true);
    expect(isPhoneLayout(Number.NaN, Number.NaN, false)).toBe(false);
    expect(isPhoneLayout(-5, 0, false)).toBe(false);
    expect(isPhoneLayout(Infinity, Infinity, false)).toBe(false);
  });
  it('the media query encodes the same rule (coarse pointer AND (width ≤ 500 OR height ≤ 500))', () => {
    expect(PHONE_SHORT_SIDE_MAX).toBe(500);
    const clauses = PHONE_QUERY.split(',').map((c) => c.trim());
    expect(clauses).toEqual(['(pointer: coarse) and (max-width: 500px)', '(pointer: coarse) and (max-height: 500px)']);
  });
  it('orientation', () => {
    expect(orientationOf(390, 844)).toBe('portrait');
    expect(orientationOf(844, 390)).toBe('landscape');
    expect(orientationOf(500, 500)).toBe('portrait');
  });
});

describe('placeCalloutAvoiding (first-run tip on phone)', () => {
  const portrait = { w: 390, h: 844 };
  const landscape = { w: 844, h: 390 };
  const tip = { w: 200, h: 176 };

  it('overlapArea', () => {
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
  });

  it('portrait: a tip about the household portraits sits beside them and clear of the agent panel', () => {
    const household = { x: 8, y: 130, w: 64, h: 70 };
    const agent = { x: 8, y: 568, w: 374, h: 268 };
    const topbar = { x: 8, y: 8, w: 374, h: 110 };
    const p = placeCalloutAvoiding(household, tip, portrait, [household, agent, topbar], 12, 8);
    const box = { x: p.x, y: p.y, w: tip.w, h: tip.h };
    expect(overlapArea(box, household)).toBe(0);
    expect(overlapArea(box, agent)).toBe(0);
    expect(overlapArea(box, topbar)).toBe(0);
    expect(inside(box, portrait, 8)).toBe(true);
    expect(p.overlap).toBe(0);
    expect(p.placement).not.toBe('center');
  });

  it('an anchor inside the agent panel (needs bars) puts the tip beside the whole panel, never on it', () => {
    const agent = { x: 8, y: 568, w: 374, h: 268 };
    const needs = { x: 20, y: 700, w: 350, h: 100 };
    const p = placeCalloutAvoiding(needs, tip, portrait, [agent], 12, 8);
    const box = { x: p.x, y: p.y, w: tip.w, h: tip.h };
    expect(overlapArea(box, agent)).toBe(0);
    expect(p.placement).toBe('top');
    expect(box.y + box.h).toBeLessThanOrEqual(agent.y - 12 + 0.01);
  });

  it('landscape: clear of the left column (household + agent panel) and the top bar', () => {
    const household = { x: 8, y: 68, w: 64, h: 70 };
    const agent = { x: 80, y: 136, w: 340, h: 246 };
    const topbar = { x: 8, y: 8, w: 828, h: 52 };
    const p = placeCalloutAvoiding(household, tip, landscape, [household, agent, topbar], 12, 8);
    const box = { x: p.x, y: p.y, w: tip.w, h: tip.h };
    for (const r of [household, agent, topbar]) expect(overlapArea(box, r)).toBe(0);
    expect(inside(box, landscape, 8)).toBe(true);
  });

  it('an unanchored tip (zero-size point in the top bar) drops below the top bar', () => {
    const topbar = { x: 8, y: 8, w: 374, h: 110 };
    const p = placeCalloutAvoiding({ x: 195, y: 0, w: 0, h: 0 }, tip, portrait, [topbar], 12, 8);
    expect(p.y).toBeGreaterThanOrEqual(topbar.y + topbar.h);
    expect(p.overlap).toBe(0);
  });

  it('falls back to any free spot when no side of the anchor is free', () => {
    // anchor boxed in on every side; a free strip exists at the bottom-right
    const anchor = { x: 100, y: 100, w: 40, h: 40 };
    const walls = [
      { x: 0, y: 0, w: 390, h: 98 },
      { x: 0, y: 142, w: 390, h: 450 },
      { x: 0, y: 0, w: 98, h: 600 },
      { x: 142, y: 0, w: 248, h: 600 },
    ];
    const p = placeCalloutAvoiding(anchor, tip, portrait, walls, 12, 8);
    const box = { x: p.x, y: p.y, w: tip.w, h: tip.h };
    expect(p.placement).toBe('center');
    expect(walls.every((w) => overlapArea(box, w) === 0)).toBe(true);
    expect(inside(box, portrait, 8)).toBe(true);
  });

  it('when nothing is free it still returns an on-screen spot with the least overlap reported', () => {
    const all = { x: 0, y: 0, w: 390, h: 844 };
    const p = placeCalloutAvoiding({ x: 10, y: 10, w: 10, h: 10 }, tip, portrait, [all], 12, 8);
    expect(inside({ x: p.x, y: p.y, w: tip.w, h: tip.h }, portrait, 8)).toBe(true);
    expect(p.overlap).toBeGreaterThan(0);
  });

  it('never throws on garbage input', () => {
    const p = placeCalloutAvoiding({ x: Number.NaN, y: Number.NaN, w: -5, h: Number.NaN } as Rect, { w: Number.NaN, h: 10 }, { w: 390, h: 844 }, [null as unknown as Rect], 12, 8);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('phone action-queue geometry', () => {
  it('uses 44 px tiles: fewer tiles fit than with the desktop geometry in the same width', () => {
    const g = phoneQueueGeometry(10);
    expect(g.tile).toBeCloseTo((PHONE_MIN_TARGET + 6) / 10, 5);
    expect(g.tile).toBeGreaterThan(QUEUE_GEOMETRY.tile);
    const avail = 60; // rem
    expect(queueCapacity(avail, 8, 8, g)).toBeLessThan(queueCapacity(avail, 8, 8));
    expect(queueCapacity(avail, 8, 8, g)).toBeGreaterThan(0);
  });
  it('the default geometry is unchanged (desktop)', () => {
    expect(queueCapacity(40, 3)).toBe(queueCapacity(40, 3, 8, QUEUE_GEOMETRY));
    expect(queueCapacity(10, 3)).toBe(0);
  });
  it('a 374 px portrait queue shows the active item + 1 tile and folds the rest into +N', () => {
    // room = 37.4 − (4.4 + 0.6 + 16 + 0.6 + 4.4) − 1.4 = 10 rem: 2 tiles would fit, but 3 queued need the +N chip
    expect(queueCapacity(374 / 10, 3, 8, phoneQueueGeometry(10))).toBe(1);
    expect(queueCapacity(374 / 10, 2, 8, phoneQueueGeometry(10))).toBe(2);
  });
  it('bad rem falls back to 10 px', () => {
    expect(phoneQueueGeometry(Number.NaN)).toEqual(phoneQueueGeometry(10));
  });
});

describe('phone.css is scoped to phone mode only (desktop layout cannot change)', () => {
  const css = readFileSync(new URL('../../../src/ui/hud/phone.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // classes that only exist in phone-mode markup (TopBar's PhoneTopBar / MoreMenu)
  const PHONE_ONLY = ['.hud-topbar--phone', '.hud-clock--phone', '.hud-sys--phone', '.hud-modes--phone', '.hud-speedbox', '.hud-topbar__break', '.hud-topbar__more', '.hud-topbar__overflow', '.hud-overflow__'];
  /** Split a selector list on top-level commas (not inside :is(...) or [attr]). */
  const splitList = (list: string) => {
    const out: string[] = [];
    let nest = 0;
    let cur = '';
    for (const ch of list) {
      if (ch === '(' || ch === '[') nest++;
      if (ch === ')' || ch === ']') nest--;
      if (ch === ',' && nest === 0) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  const selectors: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      if (depth === 0) selectors.push(...splitList(buf));
      depth++;
      buf = '';
    } else if (ch === '}') {
      depth--;
      buf = '';
    } else if (depth === 0) buf += ch;
  }
  it('has rules', () => {
    expect(selectors.length).toBeGreaterThan(40);
  });
  it.each(selectors)('%s', (sel) => {
    const scoped = sel.startsWith('html[data-phone]') || sel.startsWith('.hud[data-phone]') || sel.startsWith(".hud[data-orient='") || PHONE_ONLY.some((c) => sel.startsWith(c));
    expect(scoped).toBe(true);
  });
});
