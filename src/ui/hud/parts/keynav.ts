/**
 * Keyboard access to the HUD in the REAL game.
 *
 * KEYMAP binds Tab / Shift+Tab to "next / previous zombie" (controller, window bubble phase), so in the game Tab never
 * moved focus between HUD controls — keyboard-only players could not reach the agent tabs, phone, buy catalog, …
 * This module gives the HUD two keyboard entry points without changing what Tab means to mouse players:
 *
 *  - **F6 / Shift+F6** cycles the HUD regions (top bar → Bones / Store / Quests → household → zombie panel → action
 *    queue → party/letters → toasts → notices → buy/build panel → back to the world), focusing each region's tab stop
 *    with a visible ring. The Bones / Store / Quests block is the shell's economy HUD, mounted beside the `.hud` root:
 *    a `[data-hud-region]` outside the root is still part of the F6 cycle and of the Tab order (after the root's stops).
 *  - **Tab / Shift+Tab while a HUD control has KEYBOARD focus** (it was reached with F6, Tab or arrow keys — or it is
 *    a text field) moves to the next / previous HUD control: the HUD stops the event before it reaches the
 *    controller, and wraps at the ends so focus never falls out of the HUD into the browser chrome. A control that
 *    got focus from a mouse click keeps Tab as the game's "next zombie". (`:focus-visible` cannot tell the two apart
 *    here: Chromium flips it on at the very keydown we are deciding about, so the modality is tracked explicitly.)
 *
 * Modal dialogs (aria-modal) and the interaction menu (role=menu) keep their own Tab handling; the choice letter and the
 * tutorial tip are part of the HUD's Tab cycle and F6 regions.
 * Pure helpers (region cycling, focus-mode decision) are unit-tested; the DOM glue never throws.
 */
import { useEffect } from 'preact/hooks';
import { focusWorld } from '../lib/focus';

/** Region attribute: `data-hud-region="<order>"` (lower first). */
export const REGION_ATTR = 'data-hud-region';

/**
 * Containers that manage Tab themselves: modal dialogs (focus trap) and the interaction menu (its own Tab handler).
 * Non-modal HUD layers — the choice letter (alertdialog) and the tutorial tip (dialog) — are ordinary HUD stops.
 */
export const OWN_TAB_SELECTOR = '[aria-modal="true"], [role="menu"]';

const TABBABLE_SELECTOR = 'button, [href], input, select, textarea, summary, [tabindex]';

/**
 * Next region for F6 among `count` regions, with the WORLD as an extra stop (-1): world → 0 → 1 → … → count-1 → world.
 * `current` = index of the region holding focus (-1 = none / world). Shift (dir -1) walks backwards.
 */
export function nextRegion(current: number, count: number, dir: 1 | -1): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return -1;
  const cur = Number.isInteger(current) && current >= 0 && current < n ? current : -1;
  // positions 0..n where n is the world stop
  const pos = cur === -1 ? n : cur;
  const next = (((pos + (dir === -1 ? -1 : 1)) % (n + 1)) + (n + 1)) % (n + 1);
  return next === n ? -1 : next;
}

/** Wrap target for Tab inside the HUD: index to focus when Tab would leave the list, or null to let the browser move. */
export function tabWrap(index: number, count: number, backwards: boolean): number | null {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return null;
  if (!Number.isInteger(index) || index < 0 || index >= n) return backwards ? n - 1 : 0;
  if (!backwards && index === n - 1) return 0;
  if (backwards && index === 0) return n - 1;
  return null;
}

/**
 * Whether Tab from this focused element should navigate the HUD (true) or stay the game's "next zombie" (false).
 * `keyboardFocus` = the element got focus from the keyboard (see keyboardModality); text fields always count.
 */
export function hudOwnsTab(target: { tagName?: string; isContentEditable?: boolean } | null, insideHud: boolean, insideOwnTab: boolean, keyboardFocus: boolean): boolean {
  if (!target || !insideHud || insideOwnTab) return false;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true) return true;
  return keyboardFocus;
}

function visible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** Tab stops inside `scope` in DOM order (skips dialogs, disabled, hidden, tabindex<0). */
export function tabbables(scope: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR))) {
    if (el.tabIndex < 0) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    if (el.closest(OWN_TAB_SELECTOR) || el.closest('[inert]')) continue;
    if (!visible(el)) continue;
    out.push(el);
  }
  return out;
}

/** Visible HUD regions in order. */
export function regions(root: ParentNode): HTMLElement[] {
  const list = Array.from(root.querySelectorAll<HTMLElement>(`[${REGION_ATTR}]`)).filter((el) => visible(el) && tabbables(el).length > 0);
  return list.sort((a, b) => Number(a.getAttribute(REGION_ATTR)) - Number(b.getAttribute(REGION_ATTR)));
}

/**
 * Input modality of the CURRENT focus: was it set by the keyboard (true) or by a pointer (false)? Decided at focusin
 * from whichever input came last. `lastKey`/`lastPointer` are event timestamps (ms).
 */
export function keyboardModality(lastKey: number, lastPointer: number): boolean {
  const k = Number.isFinite(lastKey) ? lastKey : Number.NEGATIVE_INFINITY;
  const p = Number.isFinite(lastPointer) ? lastPointer : Number.NEGATIVE_INFINITY;
  return k >= p;
}

/**
 * The element that held KEYBOARD focus has left the page or been disabled (an action finished and its queue chip
 * unmounted, a toast expired): the browser drops focus on <body>, and the keyboard player is nowhere. Decide where it
 * goes instead: 'region' = the first Tab stop of the region it was in, 'world' = the game canvas, 'none' = leave it
 * (pointer focus, focus still alive or already moved elsewhere, or a modal owns focus).
 * Found on the Spark CI runner: F6 landed on a control that disappeared within 80 ms and focus sat on <body>.
 */
export function lostFocusAction(wasKeyboard: boolean, focusedAlive: boolean, activeIsBody: boolean, modal: boolean, regionHasStops: boolean): 'none' | 'region' | 'world' {
  if (wasKeyboard !== true || focusedAlive === true || activeIsBody !== true || modal === true) return 'none';
  return regionHasStops === true ? 'region' : 'world';
}

const modality = {
  lastKey: Number.NEGATIVE_INFINITY,
  lastPointer: Number.NEGATIVE_INFINITY,
  focused: null as EventTarget | null,
  keyboard: false,
  /** HUD region that held the focused element (null = none): where focus returns if the element disappears. */
  region: null as HTMLElement | null,
};

function stamp(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Any modal layer open (shell or HUD dialog): F6 / Tab belong to its focus trap. */
function modalOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"], .ui-modal-layer [role="dialog"]');
}

/**
 * Install F6 region cycling + HUD Tab ownership for the HUD rooted at `rootRef` (the `.hud` element, read at event
 * time so a HUD that mounts its root later still works). Listeners: window keydown in the CAPTURE phase for F6 (the
 * controller binds nothing to F6; the browser's own F6 is prevented) and a document keydown in the BUBBLE phase for
 * Tab — it runs after the focused widget's own handlers and is stopped before the controller's window listener.
 */
export function useHudKeyboard(rootRef: { current: HTMLElement | null }): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onF6 = (e: KeyboardEvent) => {
      if (e.key !== 'F6' && e.code !== 'F6') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const root = rootRef.current;
      if (!root || !root.isConnected) return;
      try {
        if (modalOpen()) return;
        // every HUD region in the page: the economy HUD (Bones / Store / Quests, region 15) is mounted BESIDE the root
        const list = regions(document);
        e.preventDefault();
        e.stopPropagation();
        const active = document.activeElement as HTMLElement | null;
        const cur = active ? list.findIndex((r) => r.contains(active)) : -1;
        const next = nextRegion(cur, list.length, e.shiftKey ? -1 : 1);
        if (next === -1) {
          // the world stop is the canvas itself (W-118: blurring left focus on <body>, so a later dialog chain had no
          // opener to return to)
          if (!focusWorld(document) && active && root.contains(active)) active.blur();
          return;
        }
        // the region's first Tab stop (a roving group's only stop is already its checked item)
        tabbables(list[next])[0]?.focus({ preventScroll: true });
      } catch {
        /* keyboard glue must never break the game */
      }
    };
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const root = rootRef.current;
      if (!root) return;
      try {
        const t = e.target as HTMLElement | null;
        if (!t || typeof t.closest !== 'function') return;
        const owns = hudOwnsTab(t, root.contains(t) || !!t.closest(`[${REGION_ATTR}]`), !!t.closest(OWN_TAB_SELECTOR), modality.focused === t && modality.keyboard);
        if (!owns) return;
        e.stopPropagation(); // the controller never sees it: Tab moves focus instead of cycling zombies
        // the HUD's Tab order: the root's stops, then those of each region mounted beside it (the economy HUD)
        const lists = [tabbables(root), ...regions(document).filter((r) => !root.contains(r)).map(tabbables)].filter((l) => l.length > 0);
        const s = lists.findIndex((l) => l.includes(t));
        // a focused item that is not a Tab stop itself (a roving item whose tabIndex updates on the next render):
        // the browser's own order from it is right — only wrap from the real first / last stop
        if (s < 0) return;
        const list = lists[s];
        if (tabWrap(list.indexOf(t), list.length, e.shiftKey) !== null) {
          // leaving this list: on to the first stop of the next one (Shift: the last stop of the previous one), round all
          e.preventDefault();
          const to = lists[(s + (e.shiftKey ? lists.length - 1 : 1)) % lists.length];
          const el = to[e.shiftKey ? to.length - 1 : 0];
          el.focus({ preventScroll: true });
          // the last stop of a scrolled list can be out of its panel's view: bring it in (the page itself never scrolls)
          el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }
      } catch {
        /* never throw from input handlers */
      }
    };
    // modality: the latest input before each focus change decides whether that focus is "keyboard focus"
    const onAnyKey = () => {
      modality.lastKey = stamp();
    };
    const onAnyPointer = () => {
      modality.lastPointer = stamp();
    };
    // keyboard focus must never be stranded on <body> by a control that unmounts or is disabled under it
    const rescue = () => {
      try {
        const f = modality.focused as (HTMLElement & { disabled?: boolean }) | null;
        if (!f || !modality.keyboard) return;
        const alive = f.isConnected === true && f.disabled !== true;
        const region = modality.region && modality.region.isConnected ? modality.region : null;
        const stops = region ? tabbables(region) : [];
        const action = lostFocusAction(modality.keyboard, alive, document.activeElement === document.body, modalOpen(), stops.length > 0);
        if (action === 'none') return;
        modality.lastKey = stamp(); // the rescued focus is still keyboard focus
        if (action === 'region') stops[0].focus({ preventScroll: true });
        else if (!focusWorld(document)) modality.focused = null;
      } catch {
        /* keyboard glue must never break the game */
      }
    };
    let observer: MutationObserver | null = null;
    let observed: HTMLElement | null = null;
    // attached lazily (and re-attached if the HUD root is replaced): the root may mount after this effect ran
    const watch = (root: HTMLElement | null) => {
      try {
        if (!root || root === observed || typeof MutationObserver === 'undefined') return;
        observer?.disconnect();
        observer = new MutationObserver(rescue);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
        observed = root;
      } catch {
        observer = null;
        observed = null;
      }
    };
    watch(rootRef.current);
    // A region mounted BESIDE the root (the economy HUD: Bones / Store / Quests) is watched while it holds focus: its
    // controls unmount too (the phone panel folds after Go, a finished quest row goes), and focus must not be stranded.
    let extObserver: MutationObserver | null = null;
    let extObserved: HTMLElement | null = null;
    const watchOutside = (region: HTMLElement | null) => {
      try {
        if (region === extObserved) return;
        extObserver?.disconnect();
        extObserver = null;
        extObserved = null;
        if (!region || typeof MutationObserver === 'undefined') return;
        extObserver = new MutationObserver(rescue);
        extObserver.observe(region, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
        // the region itself being removed is a change of its parent's children
        if (region.parentElement) extObserver.observe(region.parentElement, { childList: true });
        extObserved = region;
      } catch {
        extObserver = null;
        extObserved = null;
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      modality.focused = e.target;
      modality.keyboard = keyboardModality(modality.lastKey, modality.lastPointer);
      const t = e.target as HTMLElement | null;
      const root = rootRef.current;
      watch(root);
      const region = t && typeof t.closest === 'function' ? (t.closest(`[${REGION_ATTR}]`) as HTMLElement | null) : null;
      const inRoot = !!(t && root && root.contains(t));
      modality.region = inRoot ? region : region && !(root && root.contains(region)) ? region : null;
      watchOutside(!inRoot && modality.region ? modality.region : null);
    };
    window.addEventListener('keydown', onAnyKey, true);
    window.addEventListener('pointerdown', onAnyPointer, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('keydown', onF6, true);
    document.addEventListener('keydown', onTab);
    return () => {
      observer?.disconnect();
      extObserver?.disconnect();
      window.removeEventListener('keydown', onAnyKey, true);
      window.removeEventListener('pointerdown', onAnyPointer, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('keydown', onF6, true);
      document.removeEventListener('keydown', onTab);
    };
  }, []);
}
