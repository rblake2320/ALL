/**
 * "Report a bug / Send feedback" dialog (W-110 §1). Opened from the pause menu, Settings → Help, the crash screen and
 * F8 — always AFTER `feedback.capture()` took the screenshot, so the picture never shows this dialog.
 *
 * Child safety (D-033, docs/SECURITY.md T10): the bracket comes from the draft (fails closed to under-13). Under-13:
 * preset chips only — no text box is rendered and no "attach my save". 13+: free text (≤ 2,000) + optional save.
 * Accessibility: Modal (focus trap, Esc closes the innermost layer, focus restored to the opener), a radiogroup for
 * the type, aria-pressed chips, labelled controls, errors in role="alert", the result announced in a live region and
 * focus moved to it — completable with the keyboard alone.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { FeedbackFacade, SubmitResult } from '../../game/feedback';
import { defaultForm, rulesFor, textLength, togglePreset, type FeedbackForm, type FormError } from '../../feedback/form';
import { PRESET_IDS, PRESETS_MAX, REPORT_AREAS, TEXT_MAX, type PresetId, type ReportArea, type ReportType } from '../../feedback/schema';
import { Button, Modal, Segmented, Select, Toggle } from '../common';
import { cx } from '../common/cx';
import { Icon } from '../icons';
import { ft } from './strings';
import './feedback.css';

/** Keys typed in the text box stay there; Escape (close) and Tab (focus trap) still reach the dialog. */
export function textKeyDown(e: { key: string; stopPropagation(): void }): void {
  if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
}

export function errorText(e: FormError): string {
  if (e === 'tooLong') return ft('err.tooLong', { max: TEXT_MAX });
  if (e === 'presetsOnly') return ft('err.presetsOnly');
  if (e === 'empty' || e === 'badPreset' || e === 'tooManyPresets') return ft('err.empty');
  return ft('err.generic');
}

type Done = { id: string; dropped: string[] } | null;

export function FeedbackDialog({ service, onClose }: { service: FeedbackFacade; onClose: () => void }) {
  const draft = service.draft;
  const [form, setForm] = useState<FeedbackForm>(() => defaultForm(draft?.area ?? 'menu', !!draft?.crash));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done>(null);
  const [unstoredId, setUnstoredId] = useState<string | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [queued, setQueued] = useState<number | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done) doneRef.current?.focus({ preventScroll: true });
  }, [done]);
  if (!draft) return null;
  const rules = rulesFor(draft.bracket);
  const set = (patch: Partial<FeedbackForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };
  const close = () => {
    service.discard();
    onClose();
  };

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    let r: SubmitResult;
    try {
      r = await service.submit(form);
    } catch {
      r = { ok: false, reason: 'storage', error: 'unexpected error' };
    }
    setBusy(false);
    if (r.ok) {
      setDone({ id: r.id, dropped: r.dropped });
      void service.outbox().then((l) => setQueued(l.length));
      return;
    }
    if (r.reason === 'invalid') setError(errorText(r.errors[0]));
    else if (r.reason === 'saveTooLarge') setError(ft('err.saveTooLarge'));
    else if (r.reason === 'storage') {
      setError(ft('err.storage', { error: r.error.slice(0, 120) }));
      setUnstoredId(draft.id);
    } else setError(ft('err.generic'));
  };

  const exportNow = async (id: string) => {
    const ok = await service.exportReport(id).catch(() => false);
    setExportState(ok ? 'ok' : 'fail');
  };

  const doneFooter = done ? (
    <>
      <Button variant="secondary" icon="export" onClick={() => exportNow(done.id)} data-testid="feedback-export">
        {ft('done.export')}
      </Button>
      <span class="ui-modal__footer-spacer" />
      <Button variant="primary" icon="check" onClick={close} data-testid="feedback-done">
        {ft('done.close')}
      </Button>
    </>
  ) : null;
  const doneBody = done ? (
    <>
      <div class="fb-done" role="status" aria-live="polite">
        <h3 class="fb-done__title" tabIndex={-1} ref={doneRef} data-testid="feedback-thanks">
          {ft('done.title', { id: done.id })}
        </h3>
        <p class="fb-done__id">
          <span class="u-eyebrow">{ft('done.id')}</span> <code data-testid="feedback-id">{done.id}</code>
        </p>
        <p class="fb-done__text">{ft('done.text')}</p>
        {done.dropped.length ? <p class="fb-note is-warn">{ft('done.dropped', { ids: done.dropped.join(', ') })}</p> : null}
        {queued !== null ? <p class="fb-note">{ft('outbox.count', { count: queued })}</p> : null}
      </div>
      <p class="fb-status" role="status" aria-live="polite" data-testid="feedback-export-status">
        {exportState === 'ok' ? ft('done.exported') : exportState === 'fail' ? ft('done.exportFailed') : ''}
      </p>
    </>
  ) : null;

  const len = textLength(form.text);
  const shot = draft.screenshot;
  return (
    <Modal
      onClose={close}
      title={ft('title')}
      subtitle={done ? undefined : ft('subtitle')}
      icon="flag"
      size="md"
      class="fb-dialog"
      footer={
        doneFooter ?? <>
          {unstoredId ? (
            <Button variant="ghost" icon="export" onClick={() => exportNow(unstoredId)}>
              {ft('done.export')}
            </Button>
          ) : null}
          <span class="ui-modal__footer-spacer" />
          <Button variant="ghost" onClick={close}>
            {ft('cancel')}
          </Button>
          <Button variant="primary" icon="check" loading={busy} onClick={() => void submit()} data-testid="feedback-send">
            {busy ? ft('sending') : ft('send')}
          </Button>
        </>
      }
    >
      {doneBody ?? <form class="fb-form" onSubmit={(e) => void submit(e)} noValidate data-bracket={draft.bracket} data-testid="feedback-form">
        <div class="fb-row">
          <span class="fb-label" id="fb-type-label">
            {ft('type.label')}
          </span>
          <Segmented<ReportType>
            value={form.type}
            onChange={(v) => set({ type: v })}
            labelledBy="fb-type-label"
            options={[
              { value: 'bug', label: ft('type.bug'), icon: 'warning' },
              { value: 'idea', label: ft('type.idea'), icon: 'lightning' },
              { value: 'praise', label: ft('type.praise'), icon: 'heart' },
            ]}
          />
        </div>
        <div class="fb-row">
          <span class="fb-label" id="fb-area-label">
            {ft('area.label')}
          </span>
          <Select<ReportArea> value={form.area} onChange={(v) => set({ area: v })} labelledBy="fb-area-label" options={REPORT_AREAS.map((a) => ({ value: a, label: ft(`area.${a}`) }))} />
        </div>
        <fieldset class="fb-chips" aria-describedby="fb-chips-hint">
          <legend class="fb-label">{ft('presets.label')}</legend>
          <p class="fb-hint" id="fb-chips-hint">
            {rules.freeText ? ft('presets.hint', { max: PRESETS_MAX }) : `${ft('kids.note')} ${ft('presets.hint', { max: PRESETS_MAX })}`}
          </p>
          <div class="fb-chips__list" data-testid="feedback-chips">
            {PRESET_IDS.map((p: PresetId, i) => {
              const on = form.presets.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  class={cx('fb-chip', on && 'is-on')}
                  aria-pressed={on ? 'true' : 'false'}
                  data-preset={p}
                  data-autofocus={i === 0 ? true : undefined}
                  onClick={() => set({ presets: togglePreset(form.presets, p) })}
                >
                  {on ? <Icon name="check" size="0.875rem" /> : null}
                  {ft(`preset.${p}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        {rules.freeText ? (
          <div class="fb-row fb-row--text">
            <label class="fb-label" for="fb-text">
              {ft('text.label')}
            </label>
            <textarea
              id="fb-text"
              class="ui-input fb-text"
              rows={5}
              value={form.text}
              placeholder={ft('text.placeholder')}
              aria-describedby="fb-text-counter fb-text-privacy"
              aria-invalid={len > TEXT_MAX ? 'true' : 'false'}
              data-testid="feedback-text"
              onKeyDown={textKeyDown}
              onInput={(e: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => {
                const v = Array.from(e.currentTarget.value).slice(0, TEXT_MAX).join('');
                if (v !== e.currentTarget.value) e.currentTarget.value = v;
                set({ text: v });
              }}
            />
            <div class="fb-text__meta">
              <span class="fb-hint" id="fb-text-privacy">
                {ft('text.privacy')}
              </span>
              <span class={cx('fb-counter', len >= TEXT_MAX && 'is-max')} id="fb-text-counter">
                {ft('text.counter', { n: len, max: TEXT_MAX })}
              </span>
            </div>
          </div>
        ) : null}
        <div class="fb-row fb-shot">
          {shot ? (
            form.includeScreenshot ? (
              <figure class="fb-shot__fig">
                <img class="fb-shot__img" src={shot.url} width={shot.width} height={shot.height} alt={ft('shot.alt')} data-testid="feedback-shot" />
                <figcaption>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => set({ includeScreenshot: false })} data-testid="feedback-shot-remove">
                    {ft('shot.remove')}
                  </Button>
                </figcaption>
              </figure>
            ) : (
              <p class="fb-note">
                {ft('shot.removed')}{' '}
                <Button size="sm" variant="ghost" icon="camera" onClick={() => set({ includeScreenshot: true })}>
                  {ft('shot.restore')}
                </Button>
              </p>
            )
          ) : (
            <p class="fb-note">{ft('shot.none')}</p>
          )}
        </div>
        {rules.attachSave ? (
          <div class="fb-row fb-toggle">
            <div>
              <span class="fb-label" id="fb-save-label">
                {ft('save.label')}
              </span>
              <p class="fb-hint" id="fb-save-desc">
                {draft.saveAvailable ? ft('save.desc') : ft('save.unavailable')}
              </p>
            </div>
            <Toggle checked={form.attachSave} disabled={!draft.saveAvailable} onChange={(v) => set({ attachSave: v })} labelledBy="fb-save-label" describedBy="fb-save-desc" id="fb-save" />
          </div>
        ) : null}
        <p class="fb-hint fb-diag">
          <Icon name="info" size="0.875rem" /> {ft('diag.note')}
        </p>
        <p class="fb-error" role="alert" data-testid="feedback-error">
          {error ?? ''}
        </p>
      </form>}
    </Modal>
  );
}
