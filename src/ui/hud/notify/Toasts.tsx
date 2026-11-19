/**
 * Toasts (top-right): newest first, max 5, kind-coloured, ~6 s of unhovered time before auto-dismiss, hover or
 * focus pauses. Clicking a toast looks at the zombie/object it is about.
 *
 * W-116: on the phone layout the toasts would sit on top of the Act 1 story card (the owner screenshot: "Your browser
 * may clear saves" over the intro text). While a story card (hint id `story:…`) is up there, toasts are DEFERRED —
 * not drawn, their clocks paused, nothing dropped — and appear once the card is skipped or hides by itself.
 *
 * Batch 1106: the same now holds on desktop. Since W-123 the toast stack moves to the LEFT of the open quest panel
 * (EconomyHud useToastAvoid), which puts it over the top-right corner of the centred story card at 1280 x 720
 * (tests/e2e/openingPolish.mjs caught it on the merged build). A story card is short-lived, so waiting loses nothing.
 */

/** Toasts wait while a story card is open, on every layout (`_phone` is kept for callers; it no longer matters). */
export function toastsDeferred(_phone: boolean, hintId: string | null | undefined): boolean {
  return typeof hintId === 'string' && hintId.startsWith('story:');
}
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameController, Toast } from '../../../game/contracts';
import type { NotificationKind } from '../../../sim/types';
import { advanceToastClocks, toastRemaining, visibleToasts, TOAST_LIFETIME_MS, type ToastClocks } from '../lib/toasts';
import { safe } from '../lib/safe';
import { useGame, useInterval } from '../parts/hooks';
import { usePhoneLayout } from '../lib/phoneLayout';
import { Icon } from '../parts/icons';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import './notify.css';

export const KIND_ICON: Record<NotificationKind, string> = {
  info: 'info',
  good: 'sparkle',
  bad: 'exclamation',
  warning: 'warning',
  money: 'money',
  career: 'career',
  social: 'chat',
  decay: 'skull',
  romance: 'heart',
  skill: 'skills',
};

/** Point the camera at whatever a notice is about. */
export function focusNotice(game: GameController, agentId: string | null, objectId: string | null): boolean {
  if (agentId && safe('notice.agent', () => game.sim?.agent(agentId), undefined)) {
    game.selectAgent(agentId, true);
    return true;
  }
  if (objectId && safe('notice.object', () => game.sim?.object(objectId), undefined)) {
    try {
      game.focusObject(objectId);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function Toasts() {
  const game = useGame();
  const { visible, overflow } = visibleToasts(Array.isArray(game.toasts) ? game.toasts : []);
  const clocks = useRef<ToastClocks>({});
  const [hovered, setHovered] = useState<Set<number>>(() => new Set());
  const bars = useRef(new Map<number, HTMLDivElement>());
  const overflowKey = overflow.join(',');
  const { phone } = usePhoneLayout();
  const deferred = toastsDeferred(phone, game.hint?.id);

  useEffect(() => {
    for (const id of overflow) game.dismissToast(id);
  }, [overflowKey]);

  useInterval(() => {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const r = advanceToastClocks(clocks.current, visible, performance.now(), hovered, TOAST_LIFETIME_MS, hidden || game.dialog !== null || deferred);
    clocks.current = r.clocks;
    for (const [id, el] of bars.current) el.style.transform = `scaleX(${toastRemaining(r.clocks[id]).toFixed(3)})`;
    for (const id of r.expired) game.dismissToast(id);
  }, visible.length > 0 ? 200 : null);

  if (visible.length === 0 || deferred) return null;
  const setHover = (id: number, on: boolean) =>
    setHovered((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  return (
    <ol class="hud-toasts" aria-live="polite" aria-label={ht('log.title')} data-hint-anchor="toasts" data-hud-region="60">
      {visible.map((t) => (
        <ToastItem
          key={t.id}
          t={t}
          game={game}
          barRef={(el) => {
            if (el) bars.current.set(t.id, el);
            else bars.current.delete(t.id);
          }}
          remaining={toastRemaining(clocks.current[t.id])}
          onHover={(on) => setHover(t.id, on)}
        />
      ))}
    </ol>
  );
}

function ToastItem({ t, game, barRef, remaining, onHover }: { t: Toast; game: GameController; barRef: (el: HTMLDivElement | null) => void; remaining: number; onHover: (on: boolean) => void }) {
  const kind = KIND_ICON[t.kind] ? t.kind : 'info';
  const actionable = !!(t.agentId || t.objectId);
  const open = () => {
    if (focusNotice(game, t.agentId, t.objectId)) {
      game.playUi('uiClick');
      game.dismissToast(t.id);
    }
  };
  return (
    <li
      class={`ui-toast hud-toast${actionable ? ' is-actionable' : ''}`}
      data-kind={kind}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocusIn={() => onHover(true)}
      onFocusOut={() => onHover(false)}
    >
      <span class="ui-toast__icon" aria-hidden="true">
        <Icon name={KIND_ICON[kind]} size="1.125rem" />
      </span>
      <button
        type="button"
        class="ui-toast__body hud-toast__main"
        onClick={open}
        disabled={!actionable}
        {...(actionable || t.title.length + t.text.length > 110 ? tip({ title: t.title, body: [t.text, actionable ? ht('toast.focus') : ''].filter(Boolean).join('\n'), place: 'left' }) : {})}
      >
        <div class="ui-toast__title">{t.title}</div>
        {t.text && <div class="ui-toast__text">{t.text}</div>}
      </button>
      <button
        type="button"
        class="ui-iconbtn ui-iconbtn--xs hud-toast__close"
        aria-label={ht('toast.dismiss')}
        onClick={() => {
          game.dismissToast(t.id);
          game.playUi('uiClose');
        }}
        {...tip({ title: ht('toast.dismiss'), place: 'left' })}
      >
        <Icon name="close" size="0.8125rem" />
      </button>
      <div ref={barRef} class="ui-toast__progress hud-toast__progress" style={{ transform: `scaleX(${remaining.toFixed(3)})` }} />
    </li>
  );
}
