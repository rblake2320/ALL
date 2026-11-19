/**
 * HUD hooks. GameContext / useGame / useRafLoop come from UI-SHELL (src/ui/hooks.ts) so the HUD shares the App's
 * provider and its per-frame notification coalescing; the rest are small HUD-specific helpers.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { GameContext, useGame, useGameController, useRafLoop } from '../../hooks';
import { openModalCount } from '../../common/Modal';

export { GameContext, useGame, useRafLoop };

/** The controller without subscribing (for leaf components that animate on their own clock). */
export const useGameStatic = useGameController;

/** setInterval with the latest callback. */
export function useInterval(cb: () => void, ms: number | null): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (ms === null || !(ms > 0)) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Viewport size in CSS px (window.innerWidth/innerHeight), updated on resize. */
export function useViewport(): { w: number; h: number } {
  const read = () => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 720,
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

/**
 * Root font size cache. Invalidated by what can change it — a resize, or a change to the root element's inline style
 * (--ui-scale) / classes — so the per-frame bubble loop reads a number instead of building a key string (and
 * serialising the root's style) every frame. Without MutationObserver the value is re-read on every call.
 */
const rem = { value: 16, dirty: true, watching: false, observed: false };

function watchRem(): void {
  if (rem.watching || typeof window === 'undefined' || typeof document === 'undefined') return;
  rem.watching = true;
  const dirty = () => {
    rem.dirty = true;
  };
  window.addEventListener('resize', dirty, { passive: true });
  try {
    new MutationObserver(dirty).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-phone'] });
    rem.observed = true;
  } catch {
    rem.observed = false;
  }
}

/** Force the next remPx() to re-read the computed root font size (after a synchronous root style change). */
export function invalidateRem(): void {
  rem.dirty = true;
}

/**
 * Root font size in px (1rem) — the shell scales it with the viewport and the UI-scale setting. Cheap enough for
 * render paths and per-frame loops: the computed style is only read after something that can change it happened.
 */
export function remPx(): number {
  if (typeof document === 'undefined') return 16;
  watchRem();
  if (!rem.dirty && rem.observed) return rem.value;
  const v = parseFloat(getComputedStyle(document.documentElement).fontSize);
  rem.value = Number.isFinite(v) && v > 0 ? v : 16;
  rem.dirty = false;
  return rem.value;
}

/** Previous render's value. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

/** Close-on-outside-pointerdown for popovers. */
export function useOutsidePointer(refs: { current: HTMLElement | null }[], onOutside: () => void, active = true): void {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const on = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (refs.some((r) => r.current && r.current.contains(t))) return;
      cb.current();
    };
    // capture so we see the event even if something stops propagation
    document.addEventListener('pointerdown', on, true);
    return () => document.removeEventListener('pointerdown', on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/**
 * Escape layering: every open HUD layer (menu, drawer, dialog) pushes a handler; one window listener (capture phase)
 * gives Esc to the most recently opened layer only and marks the event handled, so the controller does not also
 * open the pause menu (CONTRACTS: controller hotkeys skip defaultPrevented events).
 *
 * A layer that was just told to close can stay mounted for a frame (game state re-renders are coalesced per frame).
 * Such a layer is skipped for CLOSING_GRACE_MS so a quick second Esc reaches the layer underneath instead of being
 * swallowed; if nothing else is open the key is still claimed, so it never falls through and opens the pause menu.
 * Handlers return 'stay' when they handled Esc without closing (e.g. the menu stepping back out of a flyout).
 * Auto-repeat is claimed but ignored: one press closes one layer.
 * A focused widget that uses Esc itself (a field being edited, a search box with text) marks itself or an ancestor
 * with [data-esc-local]; the stack then leaves that key to the widget's own handler.
 */
export type EscapeResult = void | 'stay';
interface EscapeEntry {
  run: () => EscapeResult;
  closingAt: number;
  /** Still open in the CONTROLLER's state? A layer closed elsewhere (a choice, the controller, a mode switch) stays
   *  mounted until the next coalesced render; until then it must not claim Esc (that key is a fresh press). */
  isOpen: (() => boolean) | null;
}

/**
 * Layers that may claim this Esc. A layer WE just closed (closingAt within the grace window) still counts — the quick
 * second Esc is claimed so it never opens the pause menu; a layer closed ELSEWHERE (isOpen() false: a choice, the
 * controller, a mode switch) does not — that Esc is a fresh press for whatever is underneath.
 */
export function liveLayers<T extends { isOpen: (() => boolean) | null; closingAt: number }>(stack: readonly T[], at: number, graceMs = CLOSING_GRACE_MS): T[] {
  return stack.filter((e) => {
    const age = at - e.closingAt;
    if (age >= 0 && age < graceMs) return true;
    if (!e.isOpen) return true;
    try {
      return e.isOpen() !== false;
    } catch {
      return true; // a broken predicate must not make Esc fall through to the pause menu
    }
  });
}
const CLOSING_GRACE_MS = 300;
const escapeStack: EscapeEntry[] = [];
const escapeObservers = new Set<() => void>();
let escapeListening = false;

/** Run fn whenever a HUD layer claims Esc (tooltips hide with it); returns the unsubscribe. */
export function onEscapeClaimed(fn: () => void): () => void {
  escapeObservers.add(fn);
  return () => {
    escapeObservers.delete(fn);
  };
}

/** True when the key event comes from inside a widget that handles Esc itself ([data-esc-local]). */
export function wantsLocalEscape(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el && typeof el.closest === 'function' && el.closest('[data-esc-local]') !== null;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Topmost layer that is not already closing (null when the stack is empty or every layer is on its way out). */
export function escapeTarget<T extends { closingAt: number }>(stack: readonly T[], at: number, graceMs = CLOSING_GRACE_MS): T | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const age = at - stack[i].closingAt;
    if (!(age >= 0 && age < graceMs)) return stack[i];
  }
  return null;
}

/**
 * W-064 "Escape closes the top dialog only": a shell / store Modal (portal layer, always drawn above the HUD) owns Esc
 * while it is open — its own handler closes it (topmost first). The HUD stack listens in the capture phase, so without
 * this a HUD layer underneath (notification log, hint bubble, interaction menu) would close instead.
 */
export function hudOwnsEscape(stackDepth: number, modalsOpen: number, localTarget: boolean): boolean {
  return stackDepth > 0 && !localTarget && !(modalsOpen > 0);
}

function onEscapeKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' && e.code !== 'Escape') return;
  if (!hudOwnsEscape(escapeStack.length, openModalCount(), wantsLocalEscape(e.target))) return;
  const at = now();
  const layers = liveLayers(escapeStack, at);
  // Every registered layer was already closed by the controller (it just hasn't unmounted yet): not our key.
  if (layers.length === 0) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  for (const fn of [...escapeObservers]) {
    try {
      fn();
    } catch {
      /* an observer must never block closing */
    }
  }
  if (e.repeat) return;
  const target = escapeTarget(layers, at);
  if (!target) return;
  let result: EscapeResult;
  try {
    result = target.run();
  } catch (err) {
    console.error('[hud] Escape handler failed', err);
    return;
  }
  if (result !== 'stay') target.closingAt = at;
}

/** Number of HUD layers currently claiming Esc (tests / diagnostics). */
export function escapeDepth(): number {
  return escapeStack.length;
}

export function useEscape(onEscape: () => EscapeResult, active = true, isOpen?: () => boolean): void {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  const open = useRef(isOpen);
  open.current = isOpen;
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const entry: EscapeEntry = { run: () => cb.current(), closingAt: -Infinity, isOpen: () => (open.current ? open.current() : true) };
    escapeStack.push(entry);
    if (!escapeListening) {
      window.addEventListener('keydown', onEscapeKey, true);
      escapeListening = true;
    }
    return () => {
      const i = escapeStack.lastIndexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
      if (escapeStack.length === 0 && escapeListening) {
        window.removeEventListener('keydown', onEscapeKey, true);
        escapeListening = false;
      }
    };
  }, [active]);
}

/** Measure an element after layout (returns a callback ref + the latest rect in viewport px). */
export function useMeasure<T extends HTMLElement>(): [(el: T | null) => void, DOMRect | null, { current: T | null }] {
  const elRef = useRef<T | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useCallback((el: T | null) => {
    elRef.current = el;
  }, []);
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, rect, elRef];
}

/** True when either the player's setting or the OS asks for reduced motion. */
export function useReducedMotion(game: GameController): boolean {
  const [os, setOs] = useState(() =>
    typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setOs(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return !!game.settings?.reduceMotion || os;
}
