/** Notification log drawer: every sim notification (newest first), filter by kind, click to look, mark read. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Notification } from '../../../sim/types';
import { timeInfo } from '../../../sim/time';
import { markNotificationsRead } from '../lib/commands';
import { safe } from '../lib/safe';
import { hudStore, useHudStore } from '../lib/store';
import { IconButton } from '../parts/controls';
import { ChipRail } from '../parts/ChipRail';
import { useEscape, useGame } from '../parts/hooks';
import { useOverflowFade } from '../parts/scroll';
import { Icon } from '../parts/icons';
import { ht } from '../strings';
import { KIND_ICON, focusNotice } from './Toasts';

export function NotificationLog() {
  const game = useGame();
  const ui = useHudStore();
  const open = ui.logOpen;
  const all = safe('log.notifications', () => game.sim?.state.notifications ?? [], [] as Notification[]).filter((n) => n && typeof n.id === 'number');
  // Remember what was unread when the drawer opened so the highlight survives marking everything read.
  const [unreadAtOpen, setUnreadAtOpen] = useState<Set<number>>(() => new Set());
  const wasOpen = useRef(false);
  const close = () => {
    hudStore.set({ logOpen: false });
    game.playUi('uiClose');
  };
  useEscape(close, open, () => hudStore.get().logOpen);
  const drawer = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setUnreadAtOpen(new Set(all.filter((n) => !n.read).map((n) => n.id)));
      if (all.some((n) => !n.read)) markNotificationsRead(game);
      // Keyboard continuity: move into the drawer (its first Tab stop) and come back to the opener on close.
      const prev = document.activeElement as HTMLElement | null;
      returnFocus.current = prev && prev !== document.body ? prev : null;
      requestAnimationFrame(() => {
        const d = drawer.current;
        (d?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? d?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
      });
    } else if (!open && wasOpen.current) {
      const active = document.activeElement;
      if ((!active || active === document.body || !active.isConnected) && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
    wasOpen.current = open;
  }, [open]);
  useOverflowFade(listRef, 'y', [open, ui.logFilter, all.length === 0]);
  if (!open) return null;
  const kinds = Array.from(new Set(all.map((n) => n.kind))).filter((k) => KIND_ICON[k]);
  const filter = ui.logFilter === 'all' || kinds.includes(ui.logFilter as Notification['kind']) ? ui.logFilter : 'all';
  const list = all.filter((n) => filter === 'all' || n.kind === filter).slice().reverse();
  const nowDay = safe('log.time', () => game.sim?.time().day ?? 1, 1);
  return (
    <aside ref={drawer} class="hud-log ui-panel ui-panel--solid ui-interactive" aria-label={ht('log.title')} data-hud-region="70">
      <header class="hud-log__head">
        <Icon name="bell" size="1.25rem" />
        <h2 class="hud-log__title u-display">{ht('log.title')}</h2>
        <IconButton icon="close" label={ht('log.close')} size="sm" onClick={close} tipSpec={{ title: ht('log.close'), kbd: 'Esc', place: 'left' }} />
      </header>
      <div class="hud-log__filters">
      <ChipRail<string>
        label={ht('log.filter')}
        value={filter}
        onChange={(k) => {
          hudStore.set({ logFilter: k });
          game.playUi('uiTab');
        }}
        chips={['all', ...kinds].map((k) => ({
          value: k,
          label: ht(`kind.${k}`),
          count: k === 'all' ? all.length : all.filter((n) => n.kind === k).length,
          icon: k !== 'all' ? <Icon name={KIND_ICON[k as Notification['kind']]} size="0.8125rem" /> : undefined,
        }))}
      />
      </div>
      {list.length === 0 ? (
        <div class="ui-empty hud-log__empty">
          <div class="ui-empty__icon">
            <Icon name="bell" size="1.5rem" />
          </div>
          <p class="ui-empty__text">{all.length === 0 ? ht('log.empty') : ht('log.emptyFilter')}</p>
        </div>
      ) : (
        <ol ref={listRef} class="hud-log__list hud-ofl-y">
          {list.map((n) => {
            const t = timeInfo(n.tick);
            const when = t.day === nowDay ? t.label.replace(/^\S+\s/, '') : `${t.label}`;
            const actionable = !!(n.agentId || n.objectId);
            return (
              <li key={n.id} class={`hud-logitem${unreadAtOpen.has(n.id) ? ' is-unread' : ''}`} data-kind={n.kind}>
                <button type="button" class="hud-logitem__btn" disabled={!actionable} onClick={() => focusNotice(game, n.agentId, n.objectId) && game.playUi('uiClick')}>
                  <span class="hud-logitem__icon" aria-hidden="true">
                    <Icon name={KIND_ICON[n.kind] ?? 'info'} size="1rem" />
                  </span>
                  <span class="hud-logitem__text">
                    <span class="hud-logitem__title">{n.title}</span>
                    {n.text && <span class="hud-logitem__body">{n.text}</span>}
                  </span>
                  <span class="hud-logitem__when u-num">
                    {when}
                    <span class="hud-logitem__day">{ht('top.day', { day: t.day })}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
