/** Personality tab: pick exactly three traits (conflicts disabled with reasons) and one aspiration. */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { t } from '../../../../i18n';
import { Icon } from '../../../icons';
import { Badge } from '../../../common/Badge';
import { Tooltip } from '../../../common/Tooltip';
import { cx } from '../../../common/cx';
import { formatNumber } from '../../../common/format';
import { traitBlockReason, toggleTrait } from '../../cazLogic';
import { TRAITS_REQUIRED, type TraitInfo } from '../../data';
import type { MemberEditorProps } from './CazLookTabs';

function blockText(id: string, selected: string[], traits: TraitInfo[]): string | null {
  const r = traitBlockReason(id, selected, traits);
  if (!r) return null;
  if (r.kind === 'full') return t('caz.traitFull');
  const other = traits.find((x) => x.id === r.withId);
  return t('caz.traitConflict', { trait: other?.name ?? r.withId });
}

function shake(el: HTMLElement) {
  el.classList.remove('is-refused');
  void el.offsetWidth;
  el.classList.add('is-refused');
}

export function PersonalityTab({ member, update, traits, aspirations, issues, showErrors }: MemberEditorProps) {
  const selected = member.traits ?? [];
  const [focusId, setFocusId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const detail = traits.find((x) => x.id === focusId) ?? traits.find((x) => x.id === selected[selected.length - 1]) ?? null;
  const detailBlock = detail ? blockText(detail.id, selected, traits) : null;
  const count = selected.length;

  const onGridKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const btns = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('.sh-trait') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const cols = 2;
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols;
    btns[Math.min(btns.length - 1, Math.max(0, i + delta))]?.focus();
  };

  return (
    <div class="sh-tab sh-tab--personality">
      <div class="sh-tab__head">
        <h3 class="ui-section-title" id="caz-traits">
          {t('caz.traits')}
        </h3>
        <Badge tone={count === TRAITS_REQUIRED ? 'accent' : 'warm'} class="sh-trait-count">
          {t('caz.traitsCount', { count })}
        </Badge>
      </div>
      <p class="sh-hint">{t('caz.traitsHint')}</p>
      {showErrors
        ? issues
            .filter((i) => i.field === 'traits')
            .map((i, k) => (
              <p key={k} class="sh-inline-issue" role="alert">
                <Icon name="warning" size="0.875rem" />
                {i.message}
              </p>
            ))
        : null}
      <div class="sh-traits" role="group" aria-labelledby="caz-traits" ref={gridRef} onKeyDown={onGridKey}>
        {traits.map((tr) => {
          const on = selected.includes(tr.id);
          const block = on ? null : traitBlockReason(tr.id, selected, traits);
          const reason = on ? null : blockText(tr.id, selected, traits);
          const btn = (
            <button
              key={tr.id}
              type="button"
              role="checkbox"
              class={cx('sh-trait', on && 'is-on', block?.kind === 'conflict' && 'is-blocked', block?.kind === 'full' && 'is-full')}
              aria-checked={on ? 'true' : 'false'}
              aria-disabled={reason ? 'true' : undefined}
              aria-describedby="caz-trait-detail"
              onClick={(e) => {
                if (reason) {
                  shake(e.currentTarget as HTMLElement);
                  setFocusId(tr.id);
                  return;
                }
                update({ traits: toggleTrait(selected, tr.id, traits) });
              }}
              onPointerEnter={() => setFocusId(tr.id)}
              onFocus={() => setFocusId(tr.id)}
            >
              <span class="sh-trait__icon" aria-hidden="true">
                <Icon name={tr.icon} size="1rem" />
                {/* State badges sit on the icon (not beside the name) so names keep their width in narrow layouts;
                    the check/lock shapes keep "chosen" and "blocked" readable without colour. */}
                {on ? (
                  <span class="sh-trait__badge sh-trait__badge--on">
                    <Icon name="check" size="0.625rem" strokeWidth={3} />
                  </span>
                ) : block?.kind === 'conflict' ? (
                  <span class="sh-trait__badge sh-trait__badge--lock">
                    <Icon name="lock" size="0.5625rem" strokeWidth={2.5} />
                  </span>
                ) : null}
              </span>
              <span class="sh-trait__name">{tr.name}</span>
            </button>
          );
          return reason ? (
            <Tooltip key={tr.id} content={reason} block>
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })}
      </div>
      <div class="sh-trait-detail" id="caz-trait-detail" aria-live="polite">
        {detail ? (
          <>
            <div class="sh-trait-detail__title">
              <Icon name={detail.icon} size="1rem" />
              <span>{detail.name}</span>
              {selected.includes(detail.id) ? (
                <Badge tone="accent" caps>
                  {t('caz.traitSelected')}
                </Badge>
              ) : null}
            </div>
            <p class="sh-trait-detail__text">{detail.description}</p>
            {detailBlock ? (
              <p class="sh-trait-detail__block">
                <Icon name="lock" size="0.8125rem" />
                {detailBlock}
              </p>
            ) : null}
          </>
        ) : (
          <p class="sh-trait-detail__text u-faint">{t('caz.traitDetailHint')}</p>
        )}
      </div>

      <h3 class="ui-section-title" id="caz-asp">
        {t('caz.aspiration')}
      </h3>
      <p class="sh-hint">{t('caz.aspirationHint')}</p>
      {showErrors
        ? issues
            .filter((i) => i.field === 'aspiration')
            .map((i, k) => (
              <p key={k} class="sh-inline-issue" role="alert">
                <Icon name="warning" size="0.875rem" />
                {i.message}
              </p>
            ))
        : null}
      <div class="sh-asps" role="radiogroup" aria-labelledby="caz-asp">
        {aspirations.map((a, i) => {
          const on = member.aspiration === a.id;
          const idx = aspirations.findIndex((x) => x.id === member.aspiration);
          const total = a.milestones.reduce((s, m) => s + (Number.isFinite(m.points) ? m.points : 0), 0);
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={on ? 'true' : 'false'}
              tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
              class={cx('sh-asp', on && 'is-on')}
              onClick={() => update({ aspiration: on ? null : a.id })}
              onKeyDown={(e) => {
                if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
                e.preventDefault();
                const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
                const n = aspirations[(i + dir + aspirations.length) % aspirations.length];
                update({ aspiration: n.id });
                const parent = (e.currentTarget as HTMLElement).parentElement;
                (parent?.querySelectorAll<HTMLElement>('.sh-asp')[(i + dir + aspirations.length) % aspirations.length])?.focus();
              }}
            >
              <span class="sh-asp__icon" aria-hidden="true">
                <Icon name={a.icon} size="1.25rem" />
              </span>
              <span class="sh-asp__text">
                <span class="sh-asp__name">{a.name}</span>
                <span class="sh-asp__desc">{a.description}</span>
                <span class="sh-asp__meta">
                  {t('caz.milestoneCount', { count: a.milestones.length })} · {t('caz.points', { points: formatNumber(total) })}
                </span>
              </span>
              {on ? (
                <span class="sh-asp__check" aria-hidden="true">
                  <Icon name="check" size="0.875rem" strokeWidth={2.5} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
