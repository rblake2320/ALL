/**
 * Focus hand-back for transient HUD layers (the interaction menu).
 *
 * KEYMAP ownership (src/game/contracts.ts): the controller ignores keys whose target sits inside `[role="menu"]` /
 * dialogs. The UI re-renders once per animation frame, so after Esc or a choice closes the menu its focused
 * `[role="menuitem"]` would stay in the DOM — and own the next hotkey — until that frame. Closing therefore moves focus
 * out SYNCHRONOUSLY (INTEGRATION_BACKLOG #16): back to whatever had it when the menu opened (normally the world canvas,
 * focused by the click that opened the menu), or — when that element is gone or itself UI-owned — to the world canvas
 * (W-118; it used to drop to <body>).
 *
 * The decision is pure (element-like duck types, unit-tested without a DOM); `releaseFocus` applies it and never throws.
 */

/** Same selector the controller uses for "keys belong to the UI" (src/game/input/keyboard.ts UI_OWNED_SELECTOR). */
export const UI_OWNED_SELECTOR = '[role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

export interface FocusTargetLike {
  isConnected?: boolean;
  focus?: (opts?: { preventScroll?: boolean }) => void;
  blur?: () => void;
  closest?: (selector: string) => unknown;
}

export interface FocusScopeLike {
  contains(node: unknown): boolean;
}

export type FocusExit = 'none' | 'opener' | 'blur';

function closestSafe(el: FocusTargetLike, selector: string): unknown {
  try {
    return typeof el.closest === 'function' ? el.closest(selector) : null;
  } catch {
    return null;
  }
}

function containsSafe(scope: FocusScopeLike | null | undefined, node: unknown): boolean {
  if (!scope || !node) return false;
  try {
    return typeof scope.contains === 'function' && scope.contains(node) === true;
  } catch {
    return false;
  }
}

/**
 * What to do with focus when a layer closes:
 *  - 'none'   — focus is not inside the layer (the player already moved on): leave it alone;
 *  - 'opener' — give it back to the element that had it when the layer opened;
 *  - 'blur'   — drop it (body), so the next key reaches the controller.
 */
export function focusExit(
  active: FocusTargetLike | null | undefined,
  opener: FocusTargetLike | null | undefined,
  layer: FocusScopeLike | null | undefined,
  roots: readonly unknown[] = [],
): FocusExit {
  if (!active || !containsSafe(layer, active)) return 'none';
  if (!opener || opener === active || roots.includes(opener)) return 'blur';
  if (opener.isConnected === false || typeof opener.focus !== 'function') return 'blur';
  if (containsSafe(layer, opener)) return 'blur';
  if (closestSafe(opener, UI_OWNED_SELECTOR)) return 'blur';
  return 'opener';
}

/**
 * Focus the game world canvas (#game-canvas, tabindex=-1 in index.html) when it is in the page and rendered.
 * Returns whether it now has focus. Used by F6's world stop (parts/keynav.ts) and as the last fallback when a layer
 * closes without a usable opener (W-118: Sol found focus stranded on <body> after F6 → Pause → Settings → Esc → Esc).
 */
export function focusWorld(doc: Document | null = typeof document !== 'undefined' ? document : null): boolean {
  try {
    const c = doc?.getElementById('game-canvas') as HTMLElement | null | undefined;
    if (!c || !c.isConnected || c.getClientRects().length === 0 || typeof c.focus !== 'function') return false;
    c.focus({ preventScroll: true });
    return doc?.activeElement === c;
  } catch {
    return false;
  }
}

/** Apply focusExit to the live document. Returns what was done (tests / diagnostics). Never throws. */
export function releaseFocus(layer: HTMLElement | null, opener: HTMLElement | null): FocusExit {
  try {
    if (!layer || typeof document === 'undefined') return 'none';
    const doc = layer.ownerDocument ?? document;
    const active = doc.activeElement as HTMLElement | null;
    const exit = focusExit(active, opener, layer, [doc.body, doc.documentElement]);
    if (exit === 'none' || !active) return exit;
    if (exit === 'opener' && opener) {
      opener.focus({ preventScroll: true });
      if (doc.activeElement === opener) return 'opener';
    }
    if (doc.activeElement && layer.contains(doc.activeElement)) (doc.activeElement as HTMLElement).blur?.();
    // W-118: not <body> — the world canvas, which the controller's hotkeys also reach (it is not UI-owned)
    focusWorld(doc);
    return 'blur';
  } catch {
    return 'none';
  }
}
