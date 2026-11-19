/**
 * UI hooks. The GameController is the only object the UI talks to; it is provided via GameContext.
 *
 *   useGame()            controller + re-render on every controller notification (coalesced to one per frame)
 *   useGameController()  controller only (no subscription) — for event handlers / children that subscribe otherwise
 *   useSelector(fn)      derived value; re-renders only when it changes (shallow compare)
 *   useHotkey(code, fn)  KEYMAP-style combos ('Escape', 'ctrl+KeyZ'); skips text inputs & already-handled events
 *   useElementSize(ref)  { width, height } via ResizeObserver
 *   useNow(ms)           Date.now() refreshed on an interval (countdowns, "saved 3 min ago")
 *   useRafLoop(fn)       per-frame callback with dt in seconds
 *   useInitialFocus(ref) keyboard continuity: focus a screen's default control when focus fell back to <body>
 */
import { createContext, type RefObject } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameController, Settings } from '../game/contracts';
import { shallowEqual } from './common/equality';
import { isEditableTarget, matchAny } from './common/hotkeys';

export const GameContext = createContext<GameController | null>(null);

type FrameId = number;

function requestFrame(cb: (t: number) => void): FrameId {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(() => cb(typeof performance !== 'undefined' ? performance.now() : Date.now()), 16) as unknown as FrameId;
}

function cancelFrame(id: FrameId): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

/** Subscribe to controller notifications, coalescing bursts into one callback per animation frame. */
export function subscribeCoalesced(game: GameController, onChange: () => void): () => void {
  let frame: FrameId = 0;
  let alive = true;
  let unsub: () => void = () => {};
  try {
    unsub = game.subscribe(() => {
      if (!alive || frame) return;
      frame = requestFrame(() => {
        frame = 0;
        if (alive) onChange();
      });
    });
  } catch (err) {
    if (typeof console !== 'undefined') console.error('[ui] controller.subscribe failed', err);
  }
  return () => {
    alive = false;
    if (frame) cancelFrame(frame);
    frame = 0;
    try {
      unsub();
    } catch {
      /* ignore */
    }
  };
}

/** The controller from context, without subscribing. Throws a descriptive error outside the provider. */
export function useGameController(): GameController {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame(): no GameContext provider above this component — render inside <App game={…} />');
  return game;
}

/** The controller; the calling component re-renders (at most once per frame) whenever the controller notifies. */
export function useGame(): GameController {
  const game = useGameController();
  const [, setTick] = useState(0);
  useEffect(() => subscribeCoalesced(game, () => setTick((n) => (n + 1) | 0)), [game]);
  return game;
}

/**
 * Derived state with change detection: the component re-renders only when `select(game)` returns a value that is
 * not shallow-equal to the previous one. The selector is re-run on every render too, so props changes apply.
 */
export function useSelector<T>(select: (game: GameController) => T, equal: (a: T, b: T) => boolean = shallowEqual): T {
  const game = useGameController();
  const [, setTick] = useState(0);
  const selectRef = useRef(select);
  const equalRef = useRef(equal);
  const lastRef = useRef<{ value: T } | null>(null);
  selectRef.current = select;
  equalRef.current = equal;

  let value = select(game);
  const last = lastRef.current;
  if (last && equal(last.value, value)) value = last.value;
  lastRef.current = { value };

  useEffect(
    () =>
      subscribeCoalesced(game, () => {
        let next: T;
        try {
          next = selectRef.current(game);
        } catch {
          setTick((n) => (n + 1) | 0); // let the render surface the error
          return;
        }
        const prev = lastRef.current;
        if (!prev || !equalRef.current(prev.value, next)) setTick((n) => (n + 1) | 0);
      }),
    [game],
  );
  return value;
}

/** Convenience: current settings (re-renders when any setting changes). */
export function useSettings(): Settings {
  return useSelector((g) => g.settings, Object.is);
}

export interface HotkeyOptions {
  enabled?: boolean;
  /** Fire even while typing in a text field (default false). */
  allowInInputs?: boolean;
  /** Call preventDefault() on match (default true) — this also marks the event handled for other listeners. */
  preventDefault?: boolean;
  /** Listen in the capture phase (default false). */
  capture?: boolean;
  /** Fire on auto-repeat (default false). */
  repeat?: boolean;
  /** Skip events another handler already handled (defaultPrevented). Default true. */
  ignoreHandled?: boolean;
}

/** Global keyboard shortcut using KEYMAP combo strings. */
export function useHotkey(
  combos: string | readonly string[],
  handler: (e: KeyboardEvent) => void,
  opts: HotkeyOptions = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = typeof combos === 'string' ? combos : combos.join('|');
  const { enabled = true, allowInInputs = false, preventDefault = true, capture = false, repeat = false, ignoreHandled = true } = opts;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || key.length === 0) return;
    const list = key.split('|');
    const onKey = (e: KeyboardEvent) => {
      if (ignoreHandled && e.defaultPrevented) return;
      if (!repeat && e.repeat) return;
      if (!allowInInputs && isEditableTarget(e.target)) return;
      if (!matchAny(e, list)) return;
      if (preventDefault) e.preventDefault();
      handlerRef.current(e);
    };
    window.addEventListener('keydown', onKey, capture);
    return () => window.removeEventListener('keydown', onKey, capture);
  }, [key, enabled, allowInInputs, preventDefault, capture, repeat, ignoreHandled]);
}

/** Observed CSS size of an element (rounded px). */
export function useElementSize<T extends Element>(ref: RefObject<T>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const el = ref.current;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

/** Date.now(), refreshed every `intervalMs` (min 50ms). Pass 0 to freeze. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!(intervalMs > 0)) return;
    const id = setInterval(() => setNow(Date.now()), Math.max(50, intervalMs));
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Calls `fn(dtSec, timeMs)` every animation frame while enabled. dt is clamped to 0.1s. */
export function useRafLoop(fn: (dtSec: number, timeMs: number) => void, enabled = true): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let frame: FrameId = 0;
    let last = -1;
    let alive = true;
    const tick = (t: number) => {
      if (!alive) return;
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      try {
        fnRef.current(dt, t);
      } finally {
        if (alive) frame = requestFrame(tick);
      }
    };
    frame = requestFrame(tick);
    return () => {
      alive = false;
      cancelFrame(frame);
    };
  }, [enabled]);
}

/** Keeps the latest value in a ref (stable identity for callbacks). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** True when nothing meaningful has focus (the focused control unmounted, or the page just loaded). */
export function focusIsLost(doc: Pick<Document, 'activeElement' | 'body' | 'documentElement'> | null = typeof document !== 'undefined' ? document : null): boolean {
  if (!doc) return false;
  const active = doc.activeElement as (Element & { isConnected?: boolean }) | null;
  return !active || active === doc.body || active === doc.documentElement || active.isConnected === false;
}

/**
 * Keyboard continuity across screens: when a screen mounts and focus was lost (the button that was pressed
 * unmounted, so focus fell back to <body>), focus `selector` inside `ref` (default `[data-autofocus]`). Never
 * steals focus from something the player is already in — e.g. a dialog that opened on top. Pointer users see no
 * ring: browsers only show :focus-visible for programmatic focus after keyboard interaction.
 */
export function useInitialFocus(ref: RefObject<HTMLElement>, selector = '[data-autofocus]', enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root || !focusIsLost()) return;
    let target: HTMLElement | null = null;
    try {
      target = root.matches(selector) ? root : root.querySelector<HTMLElement>(selector);
    } catch {
      target = null;
    }
    try {
      target?.focus({ preventScroll: true });
    } catch {
      /* detached / not focusable */
    }
  }, [enabled]);
}
