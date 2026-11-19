/**
 * Neutral first-run age gate (docs/MONETIZATION.md §1): one question, year of birth, no hint about any threshold, no
 * pre-filled answer. Only the resulting bracket is stored (EconomyFacade.answerAgeGate). Shown once over the main
 * menu on first run ("Not now" defers it; the store asks again inline before anything can be unlocked).
 */
import { useState } from 'preact/hooks';
import type { EconomyFacade } from '../../economy/facade';
import { Button, Modal } from '../common';
import { st } from './strings';
import './store.css';

/**
 * Typing in the year field must not reach window-level game/menu hotkeys, but the dialog's own keyboard contract
 * has to keep working: Escape closes the modal (Modal's panel handler) and Tab / Shift+Tab are cycled by its focus
 * trap. Everything else stays inside the field.
 */
export function ageFieldKeyDown(e: { key: string; stopPropagation(): void }): void {
  if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
}

export function AgeGateForm({ econ, onDone }: { econ: EconomyFacade; onDone?: () => void }) {
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    const r = econ.answerAgeGate(year.trim());
    if (r === 'ok') {
      setError(null);
      onDone?.();
    } else setError(r === 'invalid' ? st('age.invalid') : st('age.locked'));
  };
  return (
    <form class="st-age" onSubmit={submit} noValidate>
      <p class="st-age__prompt" id="st-age-prompt">
        {st('age.prompt')}
      </p>
      <p class="st-age__body">{st('age.body')}</p>
      <div class="st-age__row">
        <label class="st-age__label" for="st-age-year">
          {st('age.label')}
        </label>
        <span class="ui-input-wrap st-age__wrap">
        <input
          id="st-age-year"
          class="ui-input st-age__input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          pattern="[0-9]{4}"
          value={year}
          aria-describedby={error ? 'st-age-err' : 'st-age-prompt'}
          aria-invalid={error ? 'true' : 'false'}
          data-autofocus=""
          data-testid="age-year"
          onInput={(e) => setYear((e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 4))}
          onKeyDown={ageFieldKeyDown}
        />
        </span>
        <Button type="submit" variant="primary" data-testid="age-continue">
          {st('age.continue')}
        </Button>
      </div>
      {error ? (
        <p id="st-age-err" class="st-age__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function AgeGateDialog({ econ, onClose }: { econ: EconomyFacade; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title={st('age.title')} size="sm" closeOnBackdrop={false} footer={<Button variant="ghost" onClick={onClose}>{st('age.later')}</Button>} class="st-age-dialog">
      <AgeGateForm econ={econ} onDone={onClose} />
    </Modal>
  );
}
