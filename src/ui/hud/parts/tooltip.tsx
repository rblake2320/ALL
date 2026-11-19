/**
 * Delegated tooltips. Any element inside the HUD can opt in with data attributes (use the `tip()` helper):
 *   data-tip-title  bold first line          data-tip        body text ("\n" = new line)
 *   data-tip-keys   KEYMAP action → key chips data-tip-kbd    literal key labels, comma separated
 *   data-tip-place  preferred side           data-tip-tone   'good' | 'bad' | 'warm' (title colour)
 * One TooltipLayer (mounted by Hud) shows them after a short hover delay, instantly on keyboard focus,
 * re-reads live content while open, and hides on pointerdown / Escape / scroll.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { hotkeyLabels, isMac, type KeyAction } from '../lib/keys';
import { placeTooltip, type Placement } from '../lib/layout';
import { onEscapeClaimed } from './hooks';

export interface TipSpec {
  title?: string | null;
  body?: string | null;
  keys?: KeyAction | null;
  kbd?: string | string[] | null;
  place?: Placement;
  tone?: 'good' | 'bad' | 'warm' | null;
}

/** Data attributes for a tooltip. Spread onto any element: <button {...tip({ title: 'Pause', keys: 'pause' })}>. */
export function tip(spec: TipSpec): Record<string, string> {
  const out: Record<string, string> = {};
  if (spec.title) out['data-tip-title'] = spec.title;
  if (spec.body) out['data-tip'] = spec.body;
  if (!spec.title && !spec.body) out['data-tip'] = '';
  if (spec.keys) out['data-tip-keys'] = spec.keys;
  if (spec.kbd) out['data-tip-kbd'] = Array.isArray(spec.kbd) ? spec.kbd.join(',') : spec.kbd;
  if (spec.place) out['data-tip-place'] = spec.place;
  if (spec.tone) out['data-tip-tone'] = spec.tone;
  return out;
}

interface Shown {
  el: HTMLElement;
  title: string;
  body: string;
  keys: string[];
  place: Placement;
  tone: string;
}

const SELECTOR = '[data-tip],[data-tip-title]';
const HOVER_DELAY = 380;
const WARM_MS = 500;

function read(el: HTMLElement): Shown | null {
  const title = el.getAttribute('data-tip-title') ?? '';
  const body = el.getAttribute('data-tip') ?? '';
  const keysAttr = el.getAttribute('data-tip-keys');
  const kbdAttr = el.getAttribute('data-tip-kbd');
  const keys = [
    ...(keysAttr ? hotkeyLabels(keysAttr as KeyAction, 2, { mac: isMac() }) : []),
    ...(kbdAttr ? kbdAttr.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  if (!title && !body && keys.length === 0) return null;
  const placeAttr = el.getAttribute('data-tip-place');
  const place: Placement = placeAttr === 'bottom' || placeAttr === 'left' || placeAttr === 'right' ? placeAttr : 'top';
  return { el, title, body, keys, place, tone: el.getAttribute('data-tip-tone') ?? '' };
}

function same(a: Shown | null, b: Shown | null): boolean {
  if (!a || !b) return a === b;
  return a.el === b.el && a.title === b.title && a.body === b.body && a.keys.join() === b.keys.join() && a.tone === b.tone;
}

let seq = 0;

/** Mount once. `scope` limits tooltips to elements inside it (the HUD root). */
export function TooltipLayer({ scope }: { scope: { current: HTMLElement | null } }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmUntil = useRef(0);
  const shownRef = useRef<Shown | null>(null);
  const [id] = useState(() => `hud-tip-${++seq}`);
  shownRef.current = shown;

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      if (shownRef.current) warmUntil.current = performance.now() + WARM_MS;
      setShown(null);
    };
    const inScope = (el: Element | null): HTMLElement | null => {
      if (!el || !(el instanceof Element)) return null;
      const target = el.closest(SELECTOR) as HTMLElement | null;
      if (!target) return null;
      const root = scope.current;
      if (root && !root.contains(target)) return null;
      return target;
    };
    const show = (target: HTMLElement, immediate: boolean) => {
      clear();
      const s = read(target);
      if (!s) {
        hide();
        return;
      }
      if (immediate || performance.now() < warmUntil.current || shownRef.current) {
        setShown(s);
        return;
      }
      timer.current = setTimeout(() => {
        if (target.isConnected) setShown(read(target));
      }, HOVER_DELAY);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const t = inScope(e.target as Element);
      if (!t) {
        if (shownRef.current || timer.current) hide();
        return;
      }
      if (shownRef.current?.el === t) return;
      show(t, false);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || typeof el.matches !== 'function') return;
      let visible = false;
      try {
        visible = el.matches(':focus-visible');
      } catch {
        visible = true;
      }
      const t = inScope(el);
      if (t && visible) show(t, true);
    };
    const onFocusOut = () => {
      if (shownRef.current && document.activeElement !== shownRef.current.el) hide();
    };
    const onDown = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shownRef.current) hide();
    };
    const onLeaveWindow = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onLeaveWindow, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', onDown, { capture: true, passive: true });
    // Esc that closes a HUD layer is stopped at the window, so it never reaches the listener above.
    const offEscape = onEscapeClaimed(() => {
      if (shownRef.current) hide();
    });
    return () => {
      clear();
      offEscape();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onLeaveWindow, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('wheel', onDown, true);
    };
  }, [scope]);

  // Live refresh (content changes, target moves or disappears) while visible.
  useEffect(() => {
    if (!shown) return;
    const iv = setInterval(() => {
      const cur = shownRef.current;
      if (!cur) return;
      if (!cur.el.isConnected) {
        setShown(null);
        return;
      }
      const next = read(cur.el);
      if (!next) setShown(null);
      else if (!same(cur, next)) setShown(next);
      else position();
    }, 250);
    return () => clearInterval(iv);
  }, [shown?.el]);

  // aria-describedby wiring
  useEffect(() => {
    if (!shown) return;
    const el = shown.el;
    const prev = el.getAttribute('aria-describedby');
    if (!prev || !prev.split(' ').includes(id)) el.setAttribute('aria-describedby', prev ? `${prev} ${id}` : id);
    return () => {
      const cur = el.getAttribute('aria-describedby');
      if (!cur) return;
      const rest = cur.split(' ').filter((x) => x !== id).join(' ');
      if (rest) el.setAttribute('aria-describedby', rest);
      else el.removeAttribute('aria-describedby');
    };
  }, [shown?.el]);

  const position = () => {
    const cur = shownRef.current;
    const tipEl = tipRef.current;
    if (!cur || !tipEl) return;
    const r = cur.el.getBoundingClientRect();
    const size = { w: tipEl.offsetWidth, h: tipEl.offsetHeight };
    const pos = placeTooltip({ x: r.left, y: r.top, w: r.width, h: r.height }, size, { w: window.innerWidth, h: window.innerHeight }, cur.place, 8, 6);
    tipEl.style.left = `${Math.round(pos.x)}px`;
    tipEl.style.top = `${Math.round(pos.y)}px`;
    tipEl.setAttribute('data-placement', pos.placement);
    tipEl.style.visibility = 'visible';
    const a = arrowRef.current;
    if (a) {
      if (pos.placement === 'top' || pos.placement === 'bottom') {
        a.style.left = `${Math.round(pos.arrow - 4)}px`;
        a.style.top = '';
      } else {
        a.style.top = `${Math.round(pos.arrow - 4)}px`;
        a.style.left = '';
      }
    }
  };

  useLayoutEffect(() => {
    position();
  });

  if (!shown) return null;
  const bodyLines = shown.body ? shown.body.split('\n') : [];
  return (
    <div ref={tipRef} id={id} role="tooltip" class={`ui-tooltip hud-tooltip${shown.tone ? ` is-${shown.tone}` : ''}`} style={{ visibility: 'hidden' }}>
      {(shown.title || shown.keys.length > 0) && (
        <div class="ui-tooltip__row">
          {shown.title ? <span class="ui-tooltip__title">{shown.title}</span> : <span />}
          {shown.keys.length > 0 && (
            <span class="hud-tooltip__keys">
              {shown.keys.map((k) => (
                <kbd class="ui-kbd" key={k}>
                  {k}
                </kbd>
              ))}
            </span>
          )}
        </div>
      )}
      {bodyLines.map((line, i) => (
        <div class={shown.title || shown.keys.length ? 'ui-tooltip__body' : 'hud-tooltip__plain'} key={i}>
          {line}
        </div>
      ))}
      <div ref={arrowRef} class="ui-tooltip__arrow" />
    </div>
  );
}
