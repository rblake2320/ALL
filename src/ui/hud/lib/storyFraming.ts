/**
 * W-116 (D-065, owner playtest #1): frame the current Act 1 step's target object clear of every HUD panel. DOM side of
 * src/shared/framing.ts: collects the on-screen HUD panel rects (`[data-hud-region]` — top bar, household, agent
 * panel, queue, quests panel, story card, catalog, …), picks the free spot nearest the screen centre for the target
 * and its marker (pickFramePoint, the placeCalloutAvoiding-style free-spot scan), and asks the controller to pan there.
 */
import type { GameController } from '../../../game/contracts';
import { anchorInBox, pickFramePoint, STORY_FRAME_BOX, type FrameRect } from '../../../shared/framing';

/** Tight fallback box: the mailbox-sized object (bottom) and the marker tip ~45 px above it. */
export const COMPACT_FRAME_BOX = { w: 64, h: 76 };
export const COMPACT_FRAME_ANCHOR = 0.7;

/** Extra clearance (CSS px) around each HUD panel. */
export const PANEL_PAD = 8;
/** Phone: height of the action-queue slot above the agent panel (44 px tiles + label + gaps). */
export const PHONE_QUEUE_SLOT = 72;

/** Visible HUD panel rects in viewport CSS px (zero-size and hidden ones skipped). Never throws. */
export function hudPanelRects(root: ParentNode | null = typeof document !== 'undefined' ? document : null): FrameRect[] {
  const out: FrameRect[] = [];
  if (!root) return out;
  try {
    const phone = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-phone');
    for (const region of Array.from(root.querySelectorAll<HTMLElement>('[data-hud-region]'))) {
      // the action-queue container spans the screen width; what covers the world is its list (the bubble)
      const el = region.classList.contains('hud-queue') ? region.querySelector<HTMLElement>('.hud-queue__list') ?? region : region;
      const b = el.getBoundingClientRect();
      // phone: an idle queue line grows into a taller active bubble the moment a zombie starts something — reserve it
      const r = phone && el !== region && b.height > 1 && b.height < PHONE_QUEUE_SLOT ? { left: b.left, top: b.bottom - PHONE_QUEUE_SLOT, width: b.width, height: PHONE_QUEUE_SLOT } : b;
      if (!(r.width > 1 && r.height > 1)) continue;
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      if (cs && (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0)) continue;
      // a region wrapper may span the screen while only its children are visible (top-centre stack): use children
      if (r.width * r.height > 0.5 * window.innerWidth * window.innerHeight) continue;
      // a little breathing room around every panel
      out.push({ x: r.left - PANEL_PAD, y: r.top - PANEL_PAD, w: r.width + 2 * PANEL_PAD, h: r.height + 2 * PANEL_PAD });
    }
    // phone: the action queue pops up above the agent panel whenever a zombie starts something — keep that slot free
    // even while it is empty, so the target is not covered a moment later
    // (only while the queue itself is not on screen — when it is, its own rect is already in the list)
    const qr = root.querySelector<HTMLElement>('.hud-queue__list')?.getBoundingClientRect();
    const queueShown = !!qr && qr.width > 1 && qr.height > 1;
    const agent = !queueShown && phone ? root.querySelector<HTMLElement>('.hud-agent') : null;
    const ar = agent?.getBoundingClientRect();
    if (ar && ar.width > 1 && ar.height > 1) out.push({ x: ar.left, y: ar.top - PHONE_QUEUE_SLOT, w: ar.width, h: PHONE_QUEUE_SLOT });
  } catch {
    /* framing is a convenience */
  }
  return out;
}

/** Screen point (canvas CSS px) where the target should land, clear of the HUD. */
export function storyFramePoint(avoid: readonly FrameRect[], viewport: { w: number; h: number }, canvasOffset = { x: 0, y: 0 }): { x: number; y: number; overlap: number } {
  const centre = { x: viewport.w / 2, y: viewport.h / 2 };
  let c = pickFramePoint(viewport, avoid, STORY_FRAME_BOX, centre);
  let p = anchorInBox(c);
  if (c.overlap > 0) {
    // a small phone (360×640) with the story card up has no room for the roomy box: settle for the object and its
    // marker alone (COMPACT_FRAME_BOX) when that is clear (or covers less)
    const k = pickFramePoint(viewport, avoid, COMPACT_FRAME_BOX, centre, 8, 4);
    if (k.overlap < c.overlap) {
      c = k;
      p = anchorInBox(k, COMPACT_FRAME_BOX, COMPACT_FRAME_ANCHOR);
    }
  }
  return { x: p.x - canvasOffset.x, y: p.y - canvasOffset.y, overlap: c.overlap };
}

/** Frame the running story step's target (false when there is none). */
export function frameStoryTarget(game: GameController, opts: { instant?: boolean } = {}): boolean {
  const t = game.storyTarget;
  if (!t) return false;
  return frameObjectClear(game, t.objectId, opts);
}

/** W-123: frame any object clear of every HUD panel (quest rows' "Go"; same spot search as "Show me"). */
export function frameObjectClear(game: GameController, objectId: string, opts: { instant?: boolean } = {}): boolean {
  if (typeof objectId !== 'string' || !objectId || typeof window === 'undefined') return false;
  let off = { x: 0, y: 0 };
  try {
    const canvas = document.getElementById('game-canvas');
    const r = canvas?.getBoundingClientRect();
    if (r) off = { x: r.left, y: r.top };
  } catch {
    off = { x: 0, y: 0 };
  }
  const p = storyFramePoint(hudPanelRects(), { w: window.innerWidth, h: window.innerHeight }, off);
  return game.frameObject(objectId, { screen: { x: p.x, y: p.y }, instant: !!opts.instant });
}

/** W-129: how long after a Go framing a newly opened HUD panel / tutorial tip still triggers one re-frame. */
export const REFRAME_WINDOW_MS = 3000;

/** Identity of the HUD regions now on screen (class + hint id), to spot one that appears after the framing. */
function regionKeys(): Set<string> {
  const out = new Set<string>();
  try {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-hud-region]'))) {
      const b = el.getBoundingClientRect();
      if (b.width > 1 && b.height > 1) out.add(`${String(el.className).split(' ')[0]}:${el.dataset.hintId ?? ''}`);
    }
  } catch {
    /* no DOM: nothing to watch */
  }
  return out;
}

/**
 * W-129: frame `objectId` clear of the HUD, then keep it clear for REFRAME_WINDOW_MS. Clicking Go selects a zombie,
 * which can open its panel for the first time and fire a tutorial tip (the phone "Needs" tip landed right on the
 * just-framed mailbox). When a HUD region that was not there at framing time appears inside the window, frame once
 * more with it included. One re-frame at most: the camera never chases a panel that keeps moving.
 */
export function frameObjectClearSettled(game: GameController, objectId: string, opts: { instant?: boolean; now?: () => number; raf?: (cb: () => void) => void } = {}): boolean {
  const ok = frameObjectClear(game, objectId, opts);
  if (!ok || typeof window === 'undefined') return ok;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const raf = opts.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const before = regionKeys();
  const t0 = now();
  // a new region usually animates in (pop / slide): wait until its box has held still for SETTLE_MS, else the
  // re-frame avoids its first, smallest frame and the target still ends up under it
  let seenAt = -1;
  let lastSig = '';
  let stableSince = -1;
  const tick = (): void => {
    const t = now();
    if (seenAt < 0 && [...regionKeys()].some((k) => !before.has(k))) seenAt = t;
    if (seenAt >= 0) {
      const sig = hudPanelRects().map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join('|');
      if (sig !== lastSig) {
        lastSig = sig;
        stableSince = t;
      } else if (t - stableSince >= SETTLE_MS || t - seenAt >= SETTLE_MAX_MS) {
        frameObjectClear(game, objectId, opts);
        return;
      }
      raf(tick);
      return;
    }
    if (t - t0 < REFRAME_WINDOW_MS) raf(tick);
  };
  raf(tick);
  return ok;
}

/** W-129: a new HUD region must hold still this long before the re-frame measures it (and at most this long). */
export const SETTLE_MS = 180;
export const SETTLE_MAX_MS = 1200;
