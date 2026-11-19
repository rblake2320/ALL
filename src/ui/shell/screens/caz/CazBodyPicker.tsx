/**
 * Create-a-Zombie body-type picker: Classic + the 25 cast bodies (src/shared/cast.ts), grouped by category, as one
 * radio group with a roving tabindex. Arrow keys move spatially across the grouped grid (Up/Down jump between
 * category rows), Home/End go to the first/last body; selection follows focus like every other CAZ choice grid.
 * Each tile shows the baked thumbnail (assets/ui/cast/<id>.webp) or a silhouette placeholder if it fails to load.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { BodyId } from '../../../../shared/cast';
import { t } from '../../../../i18n';
import { Tooltip } from '../../../common/Tooltip';
import { cx } from '../../../common/cx';
import { useUid } from '../../../common/uid';
import { castGroups, castThumbUrl } from '../../../common/castArt';
import { spatialNeighbor, type TileRect } from './bodyNav';
import type { EconomyFacade } from '../../../../economy/facade';
import { BODY_UNLOCKS_LIVE, catalogEntry } from '../../../../economy/catalog';
import { isPremiumBodyId } from '../../../../shared/premiumBodies';
import { canUseBody } from '../../../../game/premiumAccess';

export interface CazBodyPickerProps {
  value: BodyId;
  onChange: (v: BodyId) => void;
  labelledBy: string;
  economy?: EconomyFacade | null;
}

function Silhouette() {
  return (
    <svg class="sh-body__ph" viewBox="0 0 40 48" aria-hidden="true">
      <circle cx="20" cy="12" r="7.5" />
      <path d="M7 46c0-12 5.5-20 13-20s13 8 13 20z" />
    </svg>
  );
}

function ClassicGlyph() {
  return (
    <svg class="sh-body__classic" viewBox="0 0 40 48" aria-hidden="true">
      <circle cx="20" cy="12" r="7.5" />
      <path d="M7 46c0-12 5.5-20 13-20s13 8 13 20z" />
      <path d="M14 10.5h3M23 10.5h3M15 16q5 2.5 10 0M10 33l4 2M27 31l3 3" fill="none" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

export function CazBodyPicker({ value, onChange, labelledBy, economy }: CazBodyPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useUid('body').replace(/[^A-Za-z0-9_-]/g, '');
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const groups = castGroups();
  const order: BodyId[] = ['classic', ...groups.flatMap((g) => g.bodies.map((b) => b.id))];
  const current = order.includes(value) ? value : 'classic';

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const btns = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    if (btns.length === 0) return;
    const focused = btns.findIndex((b) => b === document.activeElement);
    const cur = focused >= 0 ? focused : Math.max(0, order.indexOf(current));
    let next = cur;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = btns.length - 1;
    else {
      const rects: TileRect[] = btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      next = spatialNeighbor(rects, cur, e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown');
    }
    const id = order[next];
    if (id === undefined) return;
    // Always commit (idempotent): under load the UI may not have re-rendered since the last key, so `value` can be
    // stale and comparing against it would drop a real change (e.g. Home back to Classic after fast arrowing).
    if (canUseBody(id, economy)) onChange(id);
    btns[next]?.focus();
  };

  const tile = (id: BodyId, i: number) => {
    const checked = id === current;
    const name = t(`cast.${id}`);
    const blurb = t(`cast.${id}.blurb`);
    const descId = `${uid}-d-${id}`;
    const failed = broken.has(id);
    const locked = isPremiumBodyId(id) && !canUseBody(id, economy);
    const canSeePrice = economy?.ready === true && (economy.age?.bracket === 'adult' || economy.age?.bracket === 'teen');
    const price = locked && canSeePrice ? catalogEntry(`body:${id}`).priceGG : undefined;
    const status = locked ? [BODY_UNLOCKS_LIVE ? t('caz.premiumLocked') : t('caz.premiumComingSoon'), ...(price === undefined ? [] : [t('caz.premiumPrice', { price: price.toLocaleString('en-US') })])].join(' · ') : '';
    return (
      <Tooltip key={id} content={name} description={[blurb, status].filter(Boolean).join(' ')} block>
        <button
          type="button"
          role="radio"
          class={cx('ui-choice', 'sh-body', id === 'classic' && 'sh-body--classic')}
          aria-checked={checked ? 'true' : 'false'}
          aria-disabled={locked ? 'true' : undefined}
          aria-label={name}
          aria-describedby={descId}
          tabIndex={checked ? 0 : -1}
          data-body={id}
          data-index={i}
          onClick={() => !locked && id !== value && onChange(id)}
        >
          <span class="sh-body__art">
            {id === 'classic' ? (
              <ClassicGlyph />
            ) : failed ? (
              <Silhouette />
            ) : (
              <img
                src={castThumbUrl(id)}
                alt=""
                width={96}
                height={96}
                decoding="async"
                draggable={false}
                onError={() =>
                  setBroken((s) => {
                    if (s.has(id)) return s;
                    const n = new Set(s);
                    n.add(id);
                    return n;
                  })
                }
              />
            )}
          </span>
          <span class="ui-choice__label sh-body__name">{name}</span>
          {status ? <span class="sh-body__lock" aria-hidden="true">{status}</span> : null}
          <span id={descId} class="u-sr-only">
            {[blurb, failed ? t('caz.castThumbMissing') : '', status].filter(Boolean).join(' ')}
          </span>
        </button>
      </Tooltip>
    );
  };

  let n = 0;
  return (
    <div ref={ref} class="sh-bodies" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      <div class="sh-bodies__grid sh-bodies__grid--classic">{tile('classic', n++)}</div>
      {groups.map((g) => {
        const hid = `${uid}-cat-${g.category}`;
        return (
          <div key={g.category} class="sh-bodies__group" role="group" aria-labelledby={hid}>
            <h4 class="sh-bodies__cat" id={hid}>
              {t(`cast.category.${g.category}`)}
            </h4>
            <div class="sh-bodies__grid">{g.bodies.map((b) => tile(b.id, n++))}</div>
          </div>
        );
      })}
    </div>
  );
}
