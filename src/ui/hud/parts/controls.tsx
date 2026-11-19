/**
 * Small HUD controls that render the UI-SHELL theme's class API (ui-btn, ui-iconbtn, ui-seg, ui-tabs, ui-need, ...)
 * so the HUD is visually identical to the shell. Local until src/ui/common/*.tsx lands; markup matches the CSS.
 */
import type { ButtonHTMLAttributes, ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { NeedView } from '../../../sim/contracts';
import { clamp, needColor, num, trendLevel } from '../lib/format';
import { Icon, type HudIconName } from './icons';
import { tip, type TipSpec } from './tooltip';
import { ht } from '../strings';

type Btn = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'label' | 'size'>;

export interface ButtonProps extends Btn {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: HudIconName | string;
  label: ComponentChildren;
  kbd?: string;
  block?: boolean;
  tipSpec?: TipSpec;
}

export function Button({ variant = 'secondary', size = 'md', icon, label, kbd, block, tipSpec, class: cls, ...rest }: ButtonProps) {
  const classes = ['ui-btn', `ui-btn--${variant}`, size !== 'md' ? `ui-btn--${size}` : '', block ? 'ui-btn--block' : '', cls ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" class={classes} {...(tipSpec ? tip(tipSpec) : {})} {...rest}>
      {icon && (
        <span class="ui-btn__icon">
          <Icon name={icon} size={size === 'sm' ? '1rem' : '1.125rem'} />
        </span>
      )}
      <span class="ui-btn__label">{label}</span>
      {kbd && <kbd class="ui-kbd ui-btn__kbd">{kbd}</kbd>}
    </button>
  );
}

export interface IconButtonProps extends Btn {
  icon: HudIconName | string;
  /** Accessible name (also the tooltip title unless tipSpec overrides). */
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  glass?: boolean;
  variant?: 'primary' | 'danger';
  pressed?: boolean;
  badge?: ComponentChildren;
  tipSpec?: TipSpec | null;
  iconSize?: string;
}

export function IconButton({ icon, label, size = 'md', glass, variant, pressed, badge, tipSpec, iconSize, class: cls, ...rest }: IconButtonProps) {
  const classes = ['ui-iconbtn', size !== 'md' ? `ui-iconbtn--${size}` : '', glass ? 'ui-iconbtn--glass' : '', variant ? `ui-iconbtn--${variant}` : '', cls ?? '']
    .filter(Boolean)
    .join(' ');
  const defaultIcon = size === 'xs' ? '0.875rem' : size === 'sm' ? '1.0625rem' : size === 'lg' ? '1.5rem' : '1.25rem';
  return (
    <button
      type="button"
      class={classes}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      {...(tipSpec === null ? {} : tip(tipSpec ?? { title: label }))}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? defaultIcon} />
      {/* visual only: the button's label carries what the badge says (WCAG 2.5.3 — no visible text outside the name) */}
      {badge !== undefined && badge !== null && badge !== false && (
        <span class="ui-iconbtn__badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="ui-kbd">{children}</kbd>;
}

export function Badge({
  tone,
  solid,
  caps,
  count,
  children,
  class: cls,
  ...rest
}: { tone?: 'accent' | 'warm' | 'danger' | 'info'; solid?: boolean; caps?: boolean; count?: boolean; children?: ComponentChildren } & JSX.HTMLAttributes<HTMLSpanElement>) {
  const classes = ['ui-badge', tone ? `ui-badge--${tone}` : '', solid ? 'ui-badge--solid' : '', caps ? 'ui-badge--caps' : '', count ? 'ui-badge--count' : '', cls ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <span class={classes} {...rest}>
      {children}
    </span>
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  icon?: HudIconName | string;
  disabled?: boolean;
  tipSpec?: TipSpec;
  /** Extra data-hint-anchor names for tutorial hints. */
  anchor?: string;
}

/** Radio-group segmented control with a sliding thumb and arrow-key navigation. */
/**
 * Position a sliding selection indicator after every render AND whenever the control itself resizes (UI scale,
 * viewport, late font load) — a resize with no re-render used to leave the thumb mid-way between two options.
 */
function useSlidingIndicator(ref: { current: HTMLElement | null }, place: () => void): void {
  const latest = useRef(place);
  latest.current = place;
  useLayoutEffect(() => {
    latest.current();
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      try {
        latest.current();
      } catch {
        /* layout glue must never throw */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size,
  label,
  iconOnly,
  block,
  class: cls,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'lg';
  label: string;
  iconOnly?: boolean;
  block?: boolean;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(ref, () => {
    const root = ref.current;
    const th = thumb.current;
    if (!root || !th) return;
    const sel = root.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!sel) {
      th.style.opacity = '0';
      return;
    }
    th.style.opacity = '1';
    th.style.left = `${sel.offsetLeft}px`;
    th.style.width = `${sel.offsetWidth}px`;
  });
  const enabled = options.filter((o) => !o.disabled);
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir || enabled.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      class={['ui-seg', size ? `ui-seg--${size}` : '', block ? 'ui-seg--block' : '', cls ?? ''].filter(Boolean).join(' ')}
      onKeyDown={onKey}
    >
      <span ref={thumb} class="ui-seg__thumb" aria-hidden="true" />
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            type="button"
            role="radio"
            key={String(o.value)}
            aria-checked={checked ? 'true' : 'false'}
            aria-label={iconOnly ? o.label : undefined}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            class="ui-seg__opt"
            data-hint-anchor={o.anchor}
            onClick={() => !checked && onChange(o.value)}
            {...(o.tipSpec ? tip(o.tipSpec) : iconOnly ? tip({ title: o.label }) : {})}
          >
            {o.icon && (
              <span class="ui-seg__icon">
                <Icon name={o.icon} size={size === 'sm' ? '0.95rem' : '1.125rem'} />
              </span>
            )}
            {!iconOnly && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: HudIconName | string;
  badge?: ComponentChildren;
  anchor?: string;
  tipSpec?: TipSpec;
}

/** ARIA tablist with roving tabindex, automatic activation and a sliding indicator. */
export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  idPrefix,
  iconOnly,
  variant = 'underline',
  fill,
  class: cls,
}: {
  value: T;
  tabs: TabDef<T>[];
  onChange: (v: T) => void;
  label: string;
  idPrefix: string;
  iconOnly?: boolean;
  variant?: 'underline' | 'pills';
  fill?: boolean;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(ref, () => {
    const root = ref.current;
    const el = ind.current;
    if (!root || !el) return;
    const sel = root.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!sel) return;
    el.style.left = `${sel.offsetLeft + 6}px`;
    el.style.width = `${Math.max(0, sel.offsetWidth - 12)}px`;
  });
  const onKey = (e: KeyboardEvent) => {
    let i = tabs.findIndex((t) => t.id === value);
    if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = tabs.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange(tabs[i].id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      class={['ui-tabs', `ui-tabs--${variant}`, fill ? 'ui-tabs--fill' : '', cls ?? ''].filter(Boolean).join(' ')}
      onKeyDown={onKey}
    >
      {tabs.map((t) => {
        const sel = t.id === value;
        return (
          <button
            type="button"
            role="tab"
            key={t.id}
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={sel ? 'true' : 'false'}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            aria-label={iconOnly ? t.label : undefined}
            tabIndex={sel ? 0 : -1}
            class="ui-tab"
            data-hint-anchor={t.anchor}
            onClick={() => onChange(t.id)}
            {...(t.tipSpec ? tip(t.tipSpec) : iconOnly ? tip({ title: t.label, place: 'top' }) : {})}
          >
            {t.icon && (
              <span class="ui-tab__icon">
                <Icon name={t.icon} size="1.125rem" />
              </span>
            )}
            {!iconOnly && <span>{t.label}</span>}
            {t.badge}
          </button>
        );
      })}
      {variant === 'underline' && <span ref={ind} class="ui-tabs__indicator" aria-hidden="true" />}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked ? 'true' : 'false'} aria-label={label} disabled={disabled} class="ui-toggle" onClick={() => onChange(!checked)}>
      {/* shell markup: the check rides on the thumb (a sibling glyph would sit half under it) */}
      <span class="ui-toggle__thumb">
        <span class="ui-toggle__glyph" aria-hidden="true">
          <Icon name="check" size="0.625rem" strokeWidth={3} />
        </span>
      </span>
    </button>
  );
}

export function ProgressBar({
  value,
  tone,
  size,
  label,
  still = true,
  class: cls,
}: {
  value: number;
  tone?: 'candle' | 'cryo' | 'bone';
  size?: 'sm' | 'lg';
  label?: string;
  still?: boolean;
  class?: string;
}) {
  const pct = clamp(num(value) * 100, 0, 100);
  return (
    <div
      class={['ui-progress', tone ? `ui-progress--${tone}` : '', size ? `ui-progress--${size}` : '', still ? 'ui-progress--still' : '', cls ?? ''].filter(Boolean).join(' ')}
      style={{ '--pct': pct.toFixed(1) }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div class="ui-progress__fill" />
    </div>
  );
}

const NEED_ICON: Record<string, string> = {
  hunger: 'hunger',
  energy: 'energy',
  preservation: 'freshness',
  social: 'social',
  fun: 'fun',
  hygiene: 'hygiene',
};

/** Need glyph (shell icon set names). */
export function needIcon(id: string): string {
  return NEED_ICON[id] ?? 'question';
}

export function needLabel(n: Pick<NeedView, 'id' | 'label'>): string {
  return n.label || ht(`need.${n.id}`);
}

function trendText(trend: number): string {
  const lvl = trendLevel(trend);
  const rate = Math.abs(num(trend)).toFixed(1);
  if (lvl > 0) return ht('needs.rising', { rate });
  if (lvl < 0) return ht('needs.falling', { rate });
  return ht('needs.steady');
}

/** Need meter (shell .ui-need markup) with trend chevrons, critical pulse, vitality cap hatching. */
export function NeedBar({ need, compact, row, tabIndex = 0 }: { need: NeedView; compact?: boolean; row?: boolean; tabIndex?: number }) {
  const value = clamp(num(need.value), 0, 100);
  const cap = clamp(num(need.cap, 100), 0, 100);
  const lvl = trendLevel(need.trend);
  const band = value < 30 ? 'low' : value < 65 ? 'mid' : 'high';
  const label = needLabel(need);
  const desc = ht(`need.${need.id}.desc`);
  const body = [
    ht('needs.value', { value: Math.round(value) }) + ' · ' + trendText(need.trend),
    cap < 100 ? ht('needs.cap', { cap: Math.round(cap) }) : '',
    desc.startsWith('hud.') ? '' : desc,
  ]
    .filter(Boolean)
    .join('\n');
  const arrows = Math.abs(lvl);
  return (
    <div
      class={['ui-need', compact ? 'ui-need--compact' : '', row ? 'ui-need--row' : '', need.critical ? 'is-critical' : '', 'hud-need'].filter(Boolean).join(' ')}
      style={{ '--pct': value.toFixed(1), '--cap': cap.toFixed(1), '--need-color': needColor(value) }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={`${label}: ${Math.round(value)} / 100. ${trendText(need.trend)}.${need.critical ? ` ${ht('needs.critical')}.` : ''}`}
      data-roving=""
      tabIndex={tabIndex}
      {...tip({ title: label + (need.critical ? ` — ${ht('needs.critical')}` : ''), body, tone: need.critical ? 'warm' : null })}
    >
      <span class="ui-need__icon" aria-hidden="true">
        <Icon name={needIcon(need.id)} size={compact ? '0.875rem' : '1rem'} />
      </span>
      <div class="ui-need__head">
        <span class="ui-need__label">{label}</span>
        {arrows > 0 && (
          <span class="ui-need__trend" data-dir={lvl > 0 ? 'up' : 'down'} aria-hidden="true">
            {Array.from({ length: arrows }, (_, i) => (
              <Icon key={i} name={lvl > 0 ? 'trendUp' : 'trendDown'} size="0.875rem" />
            ))}
          </span>
        )}
      </div>
      {/* colour-blind mode adds a band glyph + the number after the bar, so the label line never has to shrink */}
      <div class="hud-need__barrow">
        <div class="ui-need__track">
          <div class="ui-need__fill" data-band={band} />
          {cap < 100 && (
            <>
              <div class="ui-need__cap" />
              <div class="ui-need__capmark" />
            </>
          )}
        </div>
        <span class="hud-need__readout" aria-hidden="true">
          <span class="ui-need__glyph">
            <Icon name={band === 'low' ? 'warning' : band === 'mid' ? 'minus' : 'check'} size="0.75rem" strokeWidth={2.4} />
          </span>
          <span class="ui-need__value hud-need__value u-num">{Math.round(value)}</span>
        </span>
      </div>
    </div>
  );
}

export function Swatch({
  color,
  selected,
  onClick,
  label,
  size,
  pattern,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
  label: string;
  size?: 'sm' | 'lg';
  pattern?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected ? 'true' : 'false'}
      aria-label={label}
      class={['ui-swatch', size ? `ui-swatch--${size}` : ''].filter(Boolean).join(' ')}
      style={{ '--swatch': pattern ?? color }}
      onClick={onClick}
      {...tip({ title: label })}
    >
      <span class="ui-swatch__check" aria-hidden="true">
        <Icon name="check" size="0.8rem" strokeWidth={3} />
      </span>
    </button>
  );
}
