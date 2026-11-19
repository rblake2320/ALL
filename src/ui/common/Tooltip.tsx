/**
 * Tooltip: hover (with delay + warm-up), keyboard focus (immediate), Esc to dismiss, smart positioning that
 * follows the anchor while open. Rendered in the tooltip portal layer so panels never clip it.
 *
 *   <Tooltip content="Pause" hotkey="Space"><button …/></Tooltip>
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Portal } from './Portal';
import { Kbd } from './Kbd';
import { computePosition, type Placement } from './position';
import { cx } from './cx';
import { useUid } from './uid';

let lastHiddenAt = 0;
const WARM_MS = 450;

export interface TooltipProps {
  content: ComponentChildren;
  /** Optional secondary line. */
  description?: ComponentChildren;
  /** KEYMAP combo(s); the first one is shown. */
  hotkey?: string | readonly string[];
  placement?: Placement;
  /** Hover delay in ms (default 420). */
  delay?: number;
  disabled?: boolean;
  /** Anchor wrapper is a block/flex element instead of inline-flex. */
  block?: boolean;
  class?: string;
  children: ComponentChildren;
}

export function Tooltip({ content, description, hotkey, placement = 'top', delay = 420, disabled, block, class: cls, children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useUid();
  const has = !disabled && content !== null && content !== undefined && content !== '' && content !== false;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (immediate: boolean) => {
    if (!has) return;
    clear();
    const warm = performance.now() - lastHiddenAt < WARM_MS;
    if (immediate || warm || delay <= 0) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen((was) => {
      if (was) lastHiddenAt = performance.now();
      return false;
    });
  };

  useEffect(() => clear, []);
  useEffect(() => {
    if (!has) hide();
  }, [has]);

  // Link the tooltip to the focusable child for screen readers.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const target = anchor.querySelector<HTMLElement>('button, a, input, select, textarea, [tabindex]');
    if (!target) return;
    if (open) {
      const existing = target.getAttribute('aria-describedby');
      if (!existing?.split(' ').includes(id)) target.setAttribute('aria-describedby', existing ? `${existing} ${id}` : id);
    }
    return () => {
      const cur = target.getAttribute('aria-describedby');
      if (!cur) return;
      const rest = cur.split(' ').filter((x) => x !== id);
      if (rest.length) target.setAttribute('aria-describedby', rest.join(' '));
      else target.removeAttribute('aria-describedby');
    };
  }, [open, id]);

  const onFocusIn = (e: JSX.TargetedFocusEvent<HTMLSpanElement>) => {
    const t = e.target as HTMLElement | null;
    let visible = true;
    try {
      visible = !!t?.matches(':focus-visible');
    } catch {
      visible = true;
    }
    if (visible) show(true);
  };

  const combo = typeof hotkey === 'string' ? hotkey : hotkey?.[0];

  return (
    <span
      ref={anchorRef}
      class={cx('ui-tip-anchor', block && 'ui-tip-anchor--block', cls)}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch') show(false);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusIn={onFocusIn}
      onFocusOut={hide}
      onKeyDown={(e) => {
        // Dismiss, but let Esc continue to the dialog/game so one press both hides the tip and closes.
        if (e.key === 'Escape' && open) hide();
      }}
    >
      {children}
      {open && has ? (
        <Portal layer="tooltip">
          <TooltipBubble anchorRef={anchorRef} id={id} placement={placement} combo={combo} description={description}>
            {content}
          </TooltipBubble>
        </Portal>
      ) : null}
    </span>
  );
}

function TooltipBubble({
  anchorRef,
  id,
  placement,
  combo,
  description,
  children,
}: {
  anchorRef: { current: HTMLElement | null };
  id: string;
  placement: Placement;
  combo?: string;
  description?: ComponentChildren;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    let last = '';
    const place = () => {
      const a = anchorRef.current;
      const el = ref.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const key = `${r.left}|${r.top}|${r.width}|${r.height}|${w}|${h}|${vw}|${vh}`;
      if (key !== last) {
        last = key;
        const pos = computePosition(r, { width: w, height: h }, { width: vw, height: vh }, placement, 8, 8);
        el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
        el.setAttribute('data-placement', pos.placement);
        el.style.setProperty('--arrow', `${pos.arrow}px`);
        el.style.visibility = 'visible';
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [placement]);

  return (
    <div ref={ref} id={id} role="tooltip" class="ui-tooltip" style={{ visibility: 'hidden' }}>
      <div class="ui-tooltip__row">
        <span class="ui-tooltip__title">{children}</span>
        {combo ? <Kbd combo={combo} /> : null}
      </div>
      {description ? <div class="ui-tooltip__body">{description}</div> : null}
      <span class="ui-tooltip__arrow" aria-hidden="true" />
    </div>
  );
}
