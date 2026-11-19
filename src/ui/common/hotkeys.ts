/**
 * Key combo parsing/matching in the KEYMAP format ('Escape', 'ctrl+KeyZ', 'shift+Slash') and display labels.
 * `ctrl` also matches the ⌘ key so Mac players get Cmd+Z for free.
 */

export interface KeyCombo {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyLike {
  code: string;
  key?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODS = new Set(['ctrl', 'control', 'cmd', 'meta', 'mod', 'shift', 'alt', 'option']);

/** Parse 'ctrl+shift+KeyZ'. Returns null for empty/invalid input (e.g. 'ctrl+', '+', ''). */
export function parseCombo(combo: string): KeyCombo | null {
  if (typeof combo !== 'string') return null;
  const parts = combo.split('+').map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => p.length === 0)) return null;
  const out: KeyCombo = { code: '', ctrl: false, shift: false, alt: false };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lower = p.toLowerCase();
    const isLast = i === parts.length - 1;
    if (!isLast) {
      if (!MODS.has(lower)) return null;
      if (lower === 'shift') out.shift = true;
      else if (lower === 'alt' || lower === 'option') out.alt = true;
      else out.ctrl = true;
    } else {
      if (MODS.has(lower)) return null;
      out.code = p;
    }
  }
  return out.code ? out : null;
}

/** Exact match: required modifiers held and no extra ones. */
export function matchCombo(e: KeyLike, combo: KeyCombo | string | null): boolean {
  const c = typeof combo === 'string' ? parseCombo(combo) : combo;
  if (!c || !e || typeof e.code !== 'string') return false;
  if (e.code !== c.code) return false;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  return ctrl === c.ctrl && !!e.shiftKey === c.shift && !!e.altKey === c.alt;
}

/** True if any combo in the list matches. */
export function matchAny(e: KeyLike, combos: readonly string[] | string): boolean {
  const list = typeof combos === 'string' ? [combos] : combos;
  for (const c of list) if (matchCombo(e, c)) return true;
  return false;
}

const LABELS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadEnter: 'Num Enter',
  NumpadDecimal: 'Num .',
  CapsLock: 'Caps',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
};

/** 'KeyQ' → 'Q', 'Digit1' → '1', 'Numpad7' → 'Num 7', 'F10' → 'F10', 'ArrowUp' → '↑'. Unknown codes pass through. */
export function keyLabel(code: string): string {
  if (typeof code !== 'string' || code.length === 0) return '?';
  if (Object.prototype.hasOwnProperty.call(LABELS, code)) return LABELS[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return code;
}

/** Combo string → display parts, e.g. 'ctrl+shift+KeyZ' → ['Ctrl', 'Shift', 'Z']. */
export function comboLabels(combo: string): string[] {
  const c = parseCombo(combo);
  if (!c) return [typeof combo === 'string' && combo ? combo : '?'];
  const out: string[] = [];
  if (c.ctrl) out.push('Ctrl');
  if (c.alt) out.push('Alt');
  if (c.shift) out.push('Shift');
  out.push(keyLabel(c.code));
  return out;
}

/** True when the event target is a text-entry element (hotkeys should usually not fire there). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return el.isContentEditable === true;
}

const ARIA_KEYS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: '+',
  NumpadSubtract: '-',
};

/**
 * KEYMAP combos → an `aria-keyshortcuts` value ('ctrl+KeyZ' → 'Control+Z'; several combos are space-separated).
 * Invalid combos are skipped; returns undefined when nothing is left (so the attribute is omitted).
 */
export function ariaKeyShortcuts(combos: string | readonly string[] | null | undefined): string | undefined {
  const list = typeof combos === 'string' ? [combos] : Array.isArray(combos) ? combos : [];
  const out: string[] = [];
  for (const combo of list) {
    const c = parseCombo(combo);
    if (!c) continue;
    let key: string | null = null;
    if (Object.prototype.hasOwnProperty.call(ARIA_KEYS, c.code)) key = ARIA_KEYS[c.code];
    else if (/^Key[A-Z]$/.test(c.code)) key = c.code.slice(3);
    else if (/^(Digit|Numpad)[0-9]$/.test(c.code)) key = c.code.slice(-1);
    else if (/^F([1-9]|1[0-2])$/.test(c.code)) key = c.code;
    if (!key) continue;
    const mods = [c.ctrl ? 'Control' : null, c.alt ? 'Alt' : null, c.shift ? 'Shift' : null].filter(Boolean);
    const value = [...mods, key].join('+');
    if (!out.includes(value)) out.push(value);
  }
  return out.length ? out.join(' ') : undefined;
}
