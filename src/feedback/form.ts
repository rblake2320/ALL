/**
 * The "Report a bug / Send feedback" form model (W-110 §1) — pure, shared by the dialog and the tests.
 *
 * Child safety (D-033, docs/SECURITY.md T10): the bracket FAILS CLOSED. Only an answered age gate of 13+ ('teen' /
 * 'adult') unlocks free text and "attach my save"; 'unknown', 'under13', a missing/broken economy or any junk value
 * is treated as under-13 → preset chips only, no text box, no save, nothing typed reaches the report.
 */
import { scrubText } from './pii';
import { PRESET_IDS, PRESETS_MAX, REPORT_AREAS, REPORT_TYPES, TEXT_MAX, type PresetId, type ReportArea, type ReportBracket, type ReportType } from './schema';

/** Map the economy's age bracket to the report bracket. Anything but an answered 13+ is under-13. */
export function reportBracket(ageBracket: unknown): ReportBracket {
  return ageBracket === 'teen' || ageBracket === 'adult' ? '13plus' : 'under13';
}

export interface FormRules {
  freeText: boolean;
  attachSave: boolean;
}

export function rulesFor(bracket: ReportBracket): FormRules {
  return bracket === '13plus' ? { freeText: true, attachSave: true } : { freeText: false, attachSave: false };
}

export interface FeedbackForm {
  type: ReportType;
  area: ReportArea;
  presets: PresetId[];
  text: string;
  includeScreenshot: boolean;
  attachSave: boolean;
}

export function defaultForm(area: ReportArea, crash: boolean): FeedbackForm {
  return { type: 'bug', area, presets: crash ? ['stuck'] : [], text: '', includeScreenshot: true, attachSave: false };
}

export type FormError = 'empty' | 'tooLong' | 'presetsOnly' | 'tooManyPresets' | 'badPreset' | 'saveNotAllowed' | 'badType' | 'badArea';

/** Code points (what the counter shows). */
export function textLength(s: string): number {
  return Array.from(s).length;
}

/** Validate a form for a bracket. Empty list = OK to send. */
export function validateForm(f: FeedbackForm, bracket: ReportBracket): FormError[] {
  const errs: FormError[] = [];
  const rules = rulesFor(bracket);
  if (!(REPORT_TYPES as readonly string[]).includes(f.type)) errs.push('badType');
  if (!(REPORT_AREAS as readonly string[]).includes(f.area)) errs.push('badArea');
  if (!Array.isArray(f.presets) || f.presets.some((p) => !(PRESET_IDS as readonly string[]).includes(p))) errs.push('badPreset');
  else if (new Set(f.presets).size > PRESETS_MAX) errs.push('tooManyPresets');
  const text = typeof f.text === 'string' ? f.text : '';
  if (!rules.freeText && text.length > 0) errs.push('presetsOnly');
  if (rules.freeText && textLength(text) > TEXT_MAX) errs.push('tooLong');
  if (!rules.attachSave && f.attachSave) errs.push('saveNotAllowed');
  const hasText = rules.freeText && filterText(text, []).trim().length > 0;
  if (!hasText && (!Array.isArray(f.presets) || f.presets.length === 0)) errs.push('empty');
  return errs;
}

/**
 * The text that is actually stored: capped at TEXT_MAX code points, control/bidi characters removed, and personal
 * data replaced (e-mails, phone numbers, links' query strings, user folders, the world's names) — see pii.ts.
 */
export function filterText(text: string, names: readonly string[]): string {
  const capped = Array.from(typeof text === 'string' ? text : '').slice(0, TEXT_MAX).join('');
  const scrubbed = scrubText(capped, { names });
  return Array.from(scrubbed.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n')).slice(0, TEXT_MAX).join('').trim();
}

/** Toggle a chip (keeps the original order, at most PRESETS_MAX). */
export function togglePreset(list: readonly PresetId[], id: PresetId): PresetId[] {
  if (list.includes(id)) return list.filter((p) => p !== id);
  if (list.length >= PRESETS_MAX) return [...list];
  return [...list, id];
}

/** What the player is doing → the report's area (editable in the form). */
export function areaFor(screen: string, mode: string, dialog: string | null): ReportArea {
  if (dialog === 'store') return 'store';
  if (screen === 'caz' || screen === 'newGame') return 'caz';
  if (screen === 'game') return mode === 'buy' ? 'buy' : mode === 'build' ? 'build' : 'live';
  return 'menu';
}
