/**
 * Preset name picker (security review 2026-11-05, D-3 / L-7; docs/MONETIZATION.md §1 "under-13: no free-text UGC").
 *
 * Zombie, household and save names end up in exported `.alsave` files, which can be shared. For a profile in the
 * under-13 bracket — and, failing closed, one whose age question is not answered yet — names are chosen from the
 * existing preset lists (the sim people content name pools) instead of typed, so a child cannot put a real name or
 * other personal details into a file. Profiles 13+ keep free text. With no economy yet (boot) it fails closed too:
 * presets, then free text once an answered 13+ profile loads.
 */
import { useEffect, useMemo } from 'preact/hooks';
import type { AgeBracket } from '../../shared/economy';
import { FIRST_NAMES, LAST_NAMES } from '../../sim/content/people/names';
import { freeTextNamesForBracket } from '../../game/names';
import { t } from '../../i18n';
import { useEconomy } from '../store/useEconomy';
import { Select } from '../common/Select';
import { useUid } from '../common/uid';

export type PresetNameKind = 'first' | 'last' | 'household' | 'save';

const SAVE_PRESET_KEYS = ['main', 'backup', 'story', 'party', 'build', 'experiment'] as const;

/** Free text is allowed only for an answered 13+ profile. No economy yet (boot) fails closed, like an unanswered age. Pure. */
export function freeTextNamesAllowed(econ: { age: { bracket: AgeBracket } } | null): boolean {
  return freeTextNamesForBracket(econ?.age.bracket); // the same rule the game layer enforces (household rename)
}

export function useFreeTextNames(): boolean {
  return freeTextNamesAllowed(useEconomy());
}

/** The preset list for a field. `extra` = generated defaults (e.g. "The Grimsbys — Day 3") offered first. */
export function presetNames(kind: PresetNameKind, extra: readonly string[] = []): string[] {
  const base = kind === 'first' ? FIRST_NAMES : kind === 'save' ? SAVE_PRESET_KEYS.map((k) => t(`saveLoad.preset.${k}`)) : LAST_NAMES;
  const out: string[] = [];
  for (const n of [...extra, ...base]) if (n && !out.includes(n)) out.push(n);
  return out;
}

export interface PresetNameFieldProps {
  label: string;
  kind: PresetNameKind;
  value: string;
  onChange: (v: string) => void;
  /** Generated names that are not typed by the player (random household / default save name). */
  extra?: readonly string[];
  id?: string;
  class?: string;
}

export function PresetNameField({ label, kind, value, onChange, extra = [], id, class: cls }: PresetNameFieldProps) {
  const uid = useUid();
  const labelId = `${id ?? uid}-label`;
  const options = useMemo(() => presetNames(kind, extra), [kind, extra.join('\u0000')]);
  // A value that is not a preset (typed before, e.g. on another profile) is replaced, never re-offered.
  const current = options.includes(value) ? value : options[0];
  useEffect(() => {
    if (current !== value) onChange(current);
  }, [current, value]);
  return (
    <div class={cls ? `ui-field ${cls}` : 'ui-field'} data-preset-names={kind}>
      <span class="ui-field__label" id={labelId}>
        <span>{label}</span>
        <span class="ui-field__hint">{t('names.presetHint')}</span>
      </span>
      <Select<string> id={id} labelledBy={labelId} value={current} options={options.map((n) => ({ value: n, label: n }))} onChange={onChange} />
    </div>
  );
}
