/**
 * HUD dialog shell (shell `.ui-modal` markup): backdrop click + Escape close, focus trap, focus restore,
 * aria-modal labelling. Rendered inside the HUD when `game.dialog` matches.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon, type HudIconName } from './icons';
import { releaseFocus } from '../lib/focus';
import { useEscape, useGameStatic } from './hooks';
import { useOverflowFade } from './scroll';
import { ht } from '../strings';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  id: string;
  title: ComponentChildren;
  eyebrow?: ComponentChildren;
  subtitle?: ComponentChildren;
  icon?: HudIconName | string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tall?: boolean;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  class?: string;
  /**
   * Element id to focus first, or 'close' for the close button (use it when the body opens with an irreversible
   * action such as spending points). Default: the first focusable control in the body, then the close button.
   */
  initialFocus?: string;
  /** Replaces the visible title (e.g. an inline rename field); the title text stays as the dialog's label. */
  titleEditor?: ComponentChildren;
}

export function HudDialog({ id, title, eyebrow, subtitle, icon, size = 'md', tall, onClose, children, footer, class: cls, initialFocus, titleEditor }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const game = useGameStatic();
  // live only while the controller still shows THIS dialog (a dialog it closed must not swallow the next Esc)
  useEscape(onClose, true, () => game.dialog === id);
  useOverflowFade(bodyRef, 'y');

  const opener = useRef<HTMLElement | null>(null);
  // Closed by anything but Esc (a tile that runs a phone action, the controller, another dialog replacing this one):
  // hand focus back to the opener at once, like the interaction menu (backlog #16) — until the next coalesced render
  // the still-mounted dialog would otherwise keep the keyboard and stop the player's next hotkey.
  useEffect(() => {
    try {
      return game.subscribe(() => {
        if (game.dialog !== id) releaseFocus(ref.current, opener.current);
      });
    } catch {
      return undefined;
    }
  }, [game, id]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    opener.current = prev;
    const el = ref.current;
    if (el) {
      const target =
        (initialFocus === 'close' ? el.querySelector<HTMLElement>('.ui-modal__close') : null) ??
        (initialFocus && initialFocus !== 'close' ? (el.querySelector(`#${CSS.escape(initialFocus)}`) as HTMLElement | null) : null) ??
        (el.querySelector(`.ui-modal__body ${FOCUSABLE.split(',').join(`, .ui-modal__body `)}`) as HTMLElement | null) ??
        (el.querySelector(FOCUSABLE) as HTMLElement | null);
      (target ?? el).focus({ preventScroll: true });
    }
    return () => {
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') {
      // keep game hotkeys (WASD, digits) from firing while typing/navigating inside a dialog
      if (!e.ctrlKey && !e.metaKey && e.key !== 'Escape') e.stopPropagation();
      return;
    }
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    e.stopPropagation();
  };

  return (
    <div class="ui-modal-layer hud-dialog-layer" role="presentation">
      <div class="ui-modal-backdrop" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        class={['ui-modal', `ui-modal--${size}`, tall ? 'ui-modal--tall' : '', 'hud-dialog', `hud-dialog--${id}`, cls ?? ''].filter(Boolean).join(' ')}
        onKeyDown={onKeyDown}
      >
        <header class="ui-modal__header ui-modal__header--rule">
          {icon && (
            <span class="hud-dialog__icon" aria-hidden="true">
              <Icon name={icon} size="1.5rem" />
            </span>
          )}
          <div class="ui-modal__heading">
            {eyebrow && <div class="ui-modal__eyebrow u-eyebrow">{eyebrow}</div>}
            <h2 id={`${id}-title`} class={`ui-modal__title${titleEditor ? ' u-sr-only' : ''}`}>
              {title}
            </h2>
            {titleEditor}
            {subtitle && <p class="ui-modal__subtitle">{subtitle}</p>}
          </div>
          <button type="button" class="ui-iconbtn ui-iconbtn--sm ui-modal__close" aria-label={ht('dialog.close')} data-tip-title={ht('dialog.close')} data-tip-kbd="Esc" onClick={onClose}>
            <Icon name="close" size="1.0625rem" />
          </button>
        </header>
        <div ref={bodyRef} class="ui-modal__body hud-ofl-y">
          {children}
        </div>
        {footer && <footer class="ui-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}
