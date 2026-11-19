/** Pure save-related text + id helpers shared by Pause, Quit and Save/Load. Total: garbage in, sane output. */
import type { SaveSlotInfo } from '../../persistence/contracts';
import { t } from '../../i18n';
import { formatNumber, formatSavedAgo } from '../common/format';

export type SaveTone = 'ok' | 'never' | 'failed';

/** What the controller exposes about the last save (GameController.lastSaveLabel / lastSavedAt / lastSaveFailed). */
export interface SaveState {
  label?: string | null;
  savedAt?: number | null;
  failed?: boolean | null;
}

/**
 * Sentence + tone for "when was this saved". Prefers the localisable `lastSavedAt` (formatted here, "Last saved
 * 12 min ago"); otherwise shows the controller's `lastSaveLabel` verbatim — it is a complete phrase ("Saved 12 min
 * ago", "Save failed") — and only prefixes a bare time ("12 minutes ago"). Nothing known = never saved.
 */
export function saveStatus(state: SaveState | string | null | undefined, nowMs: number = Date.now()): { text: string; tone: SaveTone } {
  const src: SaveState = typeof state === 'string' || state === null || state === undefined ? { label: state ?? null } : typeof state === 'object' ? state : {};
  const raw = typeof src.label === 'string' ? src.label.replace(/\s+/g, ' ').trim() : '';
  const failed = src.failed === true || /\bfail/i.test(raw);
  if (failed) return { text: raw || t('pause.saveFailed'), tone: 'failed' };
  const at = src.savedAt;
  if (typeof at === 'number' && Number.isFinite(at) && at > 0 && Number.isFinite(nowMs)) {
    return { text: t('pause.lastSave', { label: formatSavedAgo(at, nowMs) }), tone: 'ok' };
  }
  if (!raw) return { text: t('pause.neverSaved'), tone: 'never' };
  const isPhrase = /^(saved|save|saving|autosaved|not saved|never saved|unsaved)\b/i.test(raw);
  return { text: isPhrase ? raw : t('pause.lastSave', { label: raw }), tone: 'ok' };
}

/** PLATFORM's canonical slot id rule (lowercase, 1–40 of [a-z0-9_-], never a Windows device name). */
export function isValidSlotId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(id);
}

/**
 * A fresh slot id for "New save" (the controller's default slot is one manual slot per world, so without an id a
 * second "new" save would silently overwrite the first). Time-based, unique against `existing`, always valid, never
 * an autosave/emergency id.
 */
export function newSaveSlotId(existing: readonly unknown[] | null | undefined, nowMs: number): string {
  const taken = new Set<string>();
  if (Array.isArray(existing)) for (const e of existing) if (typeof e === 'string') taken.add(e.toLowerCase());
  // Wrap absurd clocks (1e308, Number.MAX_VALUE) so the id stays short: 2^48 ms ≈ 8,900 years ≤ 10 base-36 chars.
  const stamp = typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs > 0 ? Math.floor(nowMs) % 2 ** 48 : 0;
  const base = `save-${stamp.toString(36)}`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
  // Astronomically unlikely; still valid and distinct from every probe above.
  return `${base}-x${taken.size.toString(36)}`.slice(0, 40);
}

/** Name to show for a slot: its own name (autosave suffix dropped — the badge says it), else household, else id. */
export function slotDisplayName(slot: Pick<SaveSlotInfo, 'name' | 'slotId' | 'isAutosave'> & { meta?: Partial<SaveSlotInfo['meta']> | null }): string {
  let name = typeof slot.name === 'string' ? slot.name.replace(/\s+/g, ' ').trim() : '';
  if (slot.isAutosave) name = name.replace(/\s*[(\[]\s*auto-?save\s*[)\]]\s*$/i, '').trim();
  if (name) return name;
  const household = typeof slot.meta?.householdName === 'string' ? slot.meta.householdName.trim() : '';
  if (household) return household;
  return typeof slot.slotId === 'string' && slot.slotId ? slot.slotId : t('saveLoad.newSave');
}

/** "Day 9,999" (grouped) or null for garbage. */
export function dayLabel(day: unknown): string | null {
  return typeof day === 'number' && Number.isFinite(day) ? t('saveLoad.day', { day: formatNumber(Math.floor(day)) }) : null;
}
