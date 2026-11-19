/**
 * Hotkeys: KEYMAP parsing and event matching.
 *
 * Combos are 'mod+mod+Code' with KeyboardEvent.code names (layout-independent physical keys). `ctrl` also matches
 * the Meta/Cmd key. Modifiers match EXACTLY (ctrl+KeyZ ≠ ctrl+shift+KeyZ), except for "shift-agnostic" actions
 * (camera pan/zoom/rotate, object rotate, zombie cycling) where Shift is a speed/direction modifier.
 */
import { KEYMAP } from '../contracts';

export type KeyAction = keyof typeof KEYMAP;

export interface KeyCombo {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  /** A UI widget already handled it (contract: controller hotkeys ignore these). */
  defaultPrevented?: boolean;
}

export const SHIFT_AGNOSTIC: ReadonlySet<KeyAction> = new Set<KeyAction>([
  'panUp',
  'panDown',
  'panLeft',
  'panRight',
  'zoomIn',
  'zoomOut',
  'rotateCamLeft',
  'rotateCamRight',
  'rotateObject',
  'cycleZombie',
]);

/**
 * KEYMAP entries that exist only so Help / tooltips can document them: another layer owns the key (F6 = HUD region
 * cycling). The resolver never binds them, so the controller neither acts on nor `preventDefault`s those keys and
 * the owning layer still receives them untouched.
 */
export const DOC_ONLY_ACTIONS: ReadonlySet<KeyAction> = new Set<KeyAction>(['focusHud']);

/** Held for continuous motion (applied per frame), not fired once. */
export const CONTINUOUS: ReadonlySet<KeyAction> = new Set<KeyAction>(['panUp', 'panDown', 'panLeft', 'panRight', 'zoomIn', 'zoomOut']);

/** Discrete actions that may auto-repeat while held. */
export const REPEATABLE: ReadonlySet<KeyAction> = new Set<KeyAction>(['rotateObject', 'rotateCamLeft', 'rotateCamRight', 'undo', 'redo', 'cycleZombie']);

const CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

export function parseCombo(spec: unknown): KeyCombo | null {
  if (typeof spec !== 'string' || spec.length === 0 || spec.length > 64) return null;
  const parts = spec.split('+').map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) return null;
  let ctrl = false;
  let shift = false;
  let alt = false;
  let code: string | null = null;
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta' || low === 'mod') {
      if (ctrl) return null;
      ctrl = true;
    } else if (low === 'shift') {
      if (shift) return null;
      shift = true;
    } else if (low === 'alt' || low === 'option') {
      if (alt) return null;
      alt = true;
    } else {
      if (code !== null || !CODE_RE.test(p)) return null;
      code = p;
    }
  }
  return code ? { code, ctrl, shift, alt } : null;
}

export function formatCombo(c: KeyCombo): string {
  return [c.ctrl ? 'ctrl' : null, c.shift ? 'shift' : null, c.alt ? 'alt' : null, c.code].filter(Boolean).join('+');
}

export function matchCombo(c: KeyCombo, e: KeyEventLike, shiftAgnostic = false): boolean {
  if (!e || e.code !== c.code) return false;
  const ctrl = !!e.ctrlKey || !!e.metaKey;
  if (ctrl !== c.ctrl) return false;
  if (!!e.altKey !== c.alt) return false;
  if (shiftAgnostic && !c.shift) return true;
  return !!e.shiftKey === c.shift;
}

interface Binding {
  action: KeyAction;
  combo: KeyCombo;
  specificity: number;
}

export class KeyResolver {
  private readonly bindings: Binding[] = [];
  readonly invalid: string[] = [];

  constructor(map: Readonly<Record<string, readonly string[]>> = KEYMAP) {
    for (const action of Object.keys(map) as KeyAction[]) {
      if (DOC_ONLY_ACTIONS.has(action)) continue;
      for (const spec of map[action] ?? []) {
        const combo = parseCombo(spec);
        if (!combo) {
          this.invalid.push(`${action}:${spec}`);
          continue;
        }
        this.bindings.push({ action, combo, specificity: Number(combo.ctrl) + Number(combo.shift) + Number(combo.alt) });
      }
    }
    // Most specific first so 'ctrl+shift+KeyZ' wins over anything looser.
    this.bindings.sort((a, b) => b.specificity - a.specificity);
  }

  resolve(e: KeyEventLike): KeyAction | null {
    for (const b of this.bindings) {
      if (matchCombo(b.combo, e, SHIFT_AGNOSTIC.has(b.action))) return b.action;
    }
    return null;
  }

  /** All actions an event matches (used by tests to prove the map is unambiguous). */
  matches(e: KeyEventLike): KeyAction[] {
    const out: KeyAction[] = [];
    for (const b of this.bindings) if (matchCombo(b.combo, e, SHIFT_AGNOSTIC.has(b.action)) && !out.includes(b.action)) out.push(b.action);
    return out;
  }

  combos(): readonly { action: KeyAction; combo: KeyCombo }[] {
    return this.bindings;
  }
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  closest?(selector: string): unknown;
}

/** Text fields, selects, sliders, contenteditable: their keys belong to the UI. */
export function isEditableTarget(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const el = t as ElementLike;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable === true) return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  if (role === 'textbox' || role === 'slider' || role === 'spinbutton' || role === 'combobox' || role === 'listbox') return true;
  try {
    if (typeof el.closest === 'function' && el.closest('[data-keys="capture"]')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Contract (KEYMAP ownership): keys inside open menus / dialogs belong to those UI widgets. */
export const UI_OWNED_SELECTOR = '[role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

export function isUiOwnedTarget(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const el = t as ElementLike;
  try {
    return typeof el.closest === 'function' && !!el.closest(UI_OWNED_SELECTOR);
  } catch {
    return false;
  }
}

/** Buttons/links activate on Space/Enter; let them. */
export function isActivationTarget(t: unknown, code: string): boolean {
  if (code !== 'Space' && code !== 'Enter' && code !== 'NumpadEnter') return false;
  if (!t || typeof t !== 'object') return false;
  const el = t as ElementLike;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return role === 'button' || role === 'menuitem' || role === 'tab' || role === 'checkbox' || role === 'switch' || role === 'option';
}

/** Browser defaults we must suppress in game (F5 reload, ctrl+S save page, F1 help, F3 find, Tab focus, ...). */
export function shouldPreventDefault(action: KeyAction | null, code: string): boolean {
  if (action !== null) return true;
  return code === 'F1' || code === 'F3' || code === 'F5' || code === 'F10';
}

/**
 * Keys whose browser default would wreck the session even while a dialog is open: reload (F5, ctrl+R), the
 * browser's help / find / menu-bar keys (F1, F3, F10) and "save page" / "print" (ctrl+S, ctrl+P). Everything else
 * — notably Tab, arrows, Space, Enter — keeps its default so keyboard users can reach and operate the dialog.
 */
export function isBrowserHazard(e: KeyEventLike): boolean {
  const c = e.code;
  if (c === 'F1' || c === 'F3' || c === 'F5' || c === 'F10') return true;
  const ctrl = !!e.ctrlKey || !!e.metaKey;
  return ctrl && !e.altKey && (c === 'KeyS' || c === 'KeyP' || c === 'KeyR');
}
