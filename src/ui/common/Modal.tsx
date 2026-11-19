/**
 * Modal dialog: portal, focus trap (Tab/Shift+Tab cycle), Esc to close (topmost modal only), optional
 * backdrop close, aria-modal + labelledby/describedby, focus restore on unmount.
 *
 * Esc handling: the panel's keydown handler closes the dialog, calls preventDefault() and stopPropagation()
 * so window-level game hotkeys don't also react. Inner widgets (Select, Tooltip) stop Esc first when open.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n';
import { Icon, type IconName } from '../icons';
import { IconButton } from './IconButton';
import { Portal } from './Portal';
import { cx } from './cx';
import { useUid } from './uid';

const stack: string[] = [];
const isTop = (id: string) => stack.length > 0 && stack[stack.length - 1] === id;

/** Number of open modals (HUD can use it to suspend its own hotkeys). */
export function openModalCount(): number {
  return stack.length;
}

/**
 * W-064 focus restore: what had focus before the FIRST modal of a chain opened (the canvas, a menu button). A child
 * dialog that replaces its parent (Pause -> Settings -> back to Pause) restores to a control that no longer exists;
 * focus then returns to this opener instead of falling to <body>.
 *
 * W-118 (Sol, real Chrome): a chain opened while focus sat on <body> (F6 to the world used to blur to body) kept a
 * STALE opener from an earlier chain (a main-menu button, long gone), so closing Pause left focus on <body>. Now each
 * chain records its own opener (or none), and when neither the dialog's own opener nor the chain opener is usable
 * (gone, disconnected, or <body>) focus falls back to the game world canvas — only once the last modal is closed.
 */
let chainOpener: HTMLElement | null = null;

function usable(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.isConnected !== false && typeof el.focus === 'function' && (typeof document === 'undefined' || (el !== document.body && el !== document.documentElement));
}

function rememberChainOpener(el: HTMLElement | null): void {
  chainOpener = usable(el) ? el : null;
}

/** The game world canvas (#game-canvas, tabindex=-1) when it is in the page and rendered; else null. */
function defaultWorldFallback(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.getElementById('game-canvas');
    return c && c.isConnected && c.getClientRects().length > 0 ? c : null;
  } catch {
    return null;
  }
}
let worldFallback: () => HTMLElement | null = defaultWorldFallback;

/**
 * Focus `prev` when it still exists, else the chain's opener, else (when no modal is left open) the game world
 * canvas; never throws. Returns the element focused (tests).
 */
export function restoreFocus(prev: HTMLElement | null, modalsLeft = 0): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  if (!(modalsLeft > 0)) {
    try {
      fallback = worldFallback();
    } catch {
      fallback = null;
    }
  }
  for (const el of [prev, chainOpener, fallback]) {
    if (!usable(el)) continue;
    try {
      el.focus({ preventScroll: true });
      return el;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** For tests. */
export function _setChainOpener(el: HTMLElement | null): void {
  chainOpener = el;
}

/** For tests: replace the world-canvas fallback (null restores the default). */
export function _setWorldFallback(fn: (() => HTMLElement | null) | null): void {
  worldFallback = fn ?? defaultWorldFallback;
}

/** For tests: start a modal chain the way the first Modal does (records `el` as the opener, or none). */
export function _beginChain(el: HTMLElement | null): void {
  rememberChainOpener(el);
}

/** Scroll a focused element into view inside its scrolling ancestors (nearest edge, both axes); never throws. */
export function revealFocused(el: Element | null): void {
  try {
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') (el as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch {
    /* never break focus handling */
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el === document.activeElement;
  });
}

export interface ModalProps {
  onClose: () => void;
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  eyebrow?: ComponentChildren;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Fixed tall height (tabbed dialogs keep a stable size between tabs). */
  tall?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  showClose?: boolean;
  headerRule?: boolean;
  bodyFlush?: boolean;
  footer?: ComponentChildren;
  /** Extra header content under the title. */
  headerExtra?: ComponentChildren;
  /** Full-width tab bar rendered under the header (e.g. <Tabs …/>). */
  tabs?: ComponentChildren;
  backdrop?: 'dim' | 'none';
  class?: string;
  bodyClass?: string;
  /** Accessible role: 'dialog' (default) or 'alertdialog' for confirmations. */
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
  children?: ComponentChildren;
}

export function Modal(props: ModalProps) {
  return (
    <Portal layer="dialog">
      <ModalInner {...props} />
    </Portal>
  );
}

function ModalInner({
  onClose,
  title,
  subtitle,
  eyebrow,
  icon,
  size = 'md',
  tall,
  closeOnBackdrop = true,
  closeOnEsc = true,
  showClose = true,
  headerRule,
  bodyFlush,
  footer,
  headerExtra,
  tabs,
  backdrop = 'dim',
  class: cls,
  bodyClass,
  role = 'dialog',
  describedBy,
  children,
}: ModalProps) {
  const id = useUid();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = `${id}-title`;
  const subId = `${id}-sub`;

  useLayoutEffect(() => {
    const prev = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    if (stack.length === 0) rememberChainOpener(prev);
    stack.push(id);
    const panel = panelRef.current;
    if (panel) {
      const auto = panel.querySelector<HTMLElement>('[data-autofocus]');
      (auto ?? panel).focus({ preventScroll: true });
    }
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      restoreFocus(prev, stack.length);
    };
  }, []);

  // Keep focus inside the topmost modal.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (!isTop(id)) return;
      const panel = panelRef.current;
      const target = e.target as Node | null;
      if (panel && target && panel.contains(target)) {
        // W-118 (WCAG 1.4.10 / 2.4.11): in a reflowed, scrolling dialog the focused control is always brought into
        // view — including focus moved by code with preventScroll (the Tab-wrap trap). 'nearest' = no-op when visible.
        if (target !== panel) revealFocused(target as Element);
        return;
      }
      if (!panel || !target) return;
      if ((target as Element).closest?.('.ui-portal--popover, .ui-portal--tooltip, .ui-portal--toast')) return;
      const first = focusableIn(panel)[0];
      (first ?? panel).focus({ preventScroll: true });
    };
    // Fallback Esc when focus somehow sits outside every dialog (e.g. on <body>).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTop(id) || !closeOnEsc) return;
      const panel = panelRef.current;
      if (panel && panel.contains(e.target as Node)) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKey);
    };
  }, [closeOnEsc]);

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!isTop(id)) return;
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      if (closeOnEsc) onCloseRef.current();
      return;
    }
    if (e.key === 'Tab') {
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div class="ui-modal-layer" onKeyDown={onKeyDown}>
      <div
        class={cx('ui-modal-backdrop', backdrop === 'none' && 'ui-modal-backdrop--none')}
        aria-hidden="true"
        onClick={() => closeOnBackdrop && isTop(id) && onCloseRef.current()}
      />
      <div
        ref={panelRef}
        class={cx('ui-modal', `ui-modal--${size}`, tall && 'ui-modal--tall', cls)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy ?? (subtitle ? subId : undefined)}
        tabIndex={-1}
      >
        <header class={cx('ui-modal__header', headerRule && !tabs ? 'ui-modal__header--rule' : null, tabs ? 'ui-modal__header--tabs' : null)}>
          {icon ? (
            <span class="ui-confirm__icon" aria-hidden="true">
              <Icon name={icon} size="1.375rem" />
            </span>
          ) : null}
          <div class="ui-modal__heading">
            {eyebrow ? <div class="u-eyebrow ui-modal__eyebrow">{eyebrow}</div> : null}
            <h2 class="ui-modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle ? (
              <p class="ui-modal__subtitle" id={subId}>
                {subtitle}
              </p>
            ) : null}
            {headerExtra}
          </div>
          {showClose ? <IconButton class="ui-modal__close" icon="close" label={t('common.close')} hotkey="Escape" size="sm" onClick={() => onCloseRef.current()} /> : null}
        </header>
        {tabs ? <div class="ui-modal__tabs">{tabs}</div> : null}
        <div class={cx('ui-modal__body', bodyFlush && 'ui-modal__body--flush', bodyClass)}>{children}</div>
        {footer ? <footer class="ui-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
