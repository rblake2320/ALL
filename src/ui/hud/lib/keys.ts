/**
 * KEYMAP → human-readable hotkey labels for tooltips ("Digit1" → "1", "ctrl+KeyZ" → "Ctrl+Z").
 * The controller owns hotkey handling; the HUD only *displays* hints.
 */
import { KEYMAP } from '../../../game/contracts';

export type KeyAction = keyof typeof KEYMAP;

const NAMED: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadEnter: 'Num Enter',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Delete: 'Del',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  Insert: 'Ins',
};

const MODS: Record<string, string> = { ctrl: 'Ctrl', control: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Meta', cmd: '⌘' };

/** Single physical key code → label. Unknown codes are returned as-is; non-strings → ''. */
export function codeLabel(code: unknown): string {
  if (typeof code !== 'string' || code.length === 0) return '';
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Num ${m[1]}`;
  m = /^F([0-9]{1,2})$/.exec(code);
  if (m) return code;
  return code;
}

/**
 * Chord ("ctrl+shift+KeyZ") → "Ctrl+Shift+Z". Special case: shift+Slash → "?".
 * `mac` swaps Ctrl for ⌘ (the controller maps ctrl to meta on macOS).
 */
export function keyLabel(chord: unknown, opts: { mac?: boolean } = {}): string {
  if (typeof chord !== 'string' || chord.trim() === '') return '';
  const parts = chord.split('+').map((p) => p.trim());
  // A trailing '+' (e.g. "ctrl++") means the plus key itself.
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(parts.length - 2, 2, '+');
  }
  const key = parts.pop() ?? '';
  const mods = parts.filter(Boolean).map((p) => p.toLowerCase());
  if (mods.length === 1 && mods[0] === 'shift' && key === 'Slash') return '?';
  const modLabels = mods.map((p) => (opts.mac && (p === 'ctrl' || p === 'control') ? '⌘' : MODS[p] ?? p));
  const k = key === '+' ? '+' : codeLabel(key);
  return [...modLabels, k].filter(Boolean).join('+');
}

/** Labels for a KEYMAP action (first `max` bindings, de-duplicated). */
export function hotkeyLabels(action: KeyAction, max = 2, opts: { mac?: boolean } = {}): string[] {
  const codes = Object.prototype.hasOwnProperty.call(KEYMAP, action) ? (KEYMAP as Record<string, readonly string[]>)[action] : undefined;
  if (!Array.isArray(codes)) return [];
  // NaN / non-numbers → the default 2; Infinity → every binding; anything below 1 → just the first.
  const cap = typeof max === 'number' && !Number.isNaN(max) ? Math.max(1, Math.floor(max)) : 2;
  const out: string[] = [];
  for (const c of codes) {
    const l = keyLabel(c, opts);
    if (l && !out.includes(l)) out.push(l);
    if (out.length >= cap) break;
  }
  return out;
}

/** "Space / 0" style hint string. */
export function hotkeyHint(action: KeyAction, max = 2, opts: { mac?: boolean } = {}): string {
  return hotkeyLabels(action, max, opts).join(' / ');
}

/** True when running on macOS (best effort; false outside the browser). */
export function isMac(): boolean {
  try {
    const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
    if (!nav) return false;
    return /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent || '');
  } catch {
    return false;
  }
}
