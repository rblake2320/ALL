/**
 * Action queue (bottom-centre): the active interaction with a circular progress ring and the queued items;
 * cancel buttons on cancellable items (game.cancelQueueItem).
 */
import type { GameController } from '../../../game/contracts';
import type { QueueView } from '../../../sim/contracts';
import { clamp, formatPercent, num } from '../lib/format';
import { queueCapacity, ringDash } from '../lib/layout';
import { PHONE_GUTTER, phoneQueueGeometry } from '../lib/phoneLayout';
import { safe } from '../lib/safe';
import { useHudStore } from '../lib/store';
import { remPx, useGame, useViewport } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { ROVING_LIST } from '../parts/roving';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import './queue.css';

const MAX_QUEUED = 8;
/** FPS meter footprint (rem) reserved on the right when it is showing. */
const FPS_RESERVE = 10.5;
/** Notices drawer width + gap (rem, notify.css .hud-log). */
const LOG_RESERVE = 24.75;

export function ActionQueue({ tier, phone = null }: { tier?: 'normal' | 'compact' | 'tight'; phone?: 'portrait' | 'landscape' | null }) {
  const game = useGame();
  const ui = useHudStore();
  const vp = useViewport();
  const id = game.selectedAgentId;
  const sim = game.sim;
  if (!id || !sim) return null;
  const summary = safe('queue.summary', () => sim.summary(id), null);
  if (!summary || summary.presence !== 'onLot') return null;
  const items = safe('queue.view', () => sim.queueView(id), []);
  const active = items.find((i) => i.active) ?? null;
  const queued = items.filter((i) => !i.active);
  // The queue sits centred on screen but never under the agent panel (left) or the FPS meter (right):
  // .hud-queue is a 3-column grid whose side columns reserve that room; the tiles that fit are shown, the rest
  // collapse into "+N".
  const rem = remPx();
  const gap = 0.75;
  const left = (tier === 'tight' ? 24 : 27) + gap;
  // the Notices drawer runs the full height of the right edge while open
  const right = Math.max(game.settings?.showFps ? FPS_RESERVE : 0, ui.logOpen ? LOG_RESERVE : 0);
  const availRem = vp.w / rem - 2 * gap - left - right;
  // Phone (phone.css): portrait — full width just above the agent panel; landscape — right of the agent panel. The
  // 44 px tiles need their own geometry.
  const phoneStyle: Record<string, string> = {};
  let fit: number;
  if (phone) {
    const panelRight = ui.agentPanelRight;
    const leftPx = phone === 'landscape' && panelRight !== null ? panelRight + PHONE_GUTTER : PHONE_GUTTER;
    if (phone === 'portrait' && ui.agentPanelTop !== null) phoneStyle['--q-bottom'] = `${Math.max(0, Math.round(vp.h - ui.agentPanelTop + PHONE_GUTTER))}px`;
    if (phone === 'landscape') phoneStyle['--q-left-px'] = `${Math.round(leftPx)}px`;
    fit = queueCapacity((vp.w - leftPx - PHONE_GUTTER) / rem, queued.length, MAX_QUEUED, phoneQueueGeometry(rem));
  } else {
    fit = queueCapacity(availRem, queued.length, MAX_QUEUED);
  }
  const shown = queued.slice(0, fit);
  const more = queued.length - shown.length;
  return (
    <div class="hud-queue" style={{ '--q-left': `${left}rem`, '--q-right': `${right}rem`, ...phoneStyle }} data-hint-anchor="queue action-queue" data-hud-region="40">
      {/* one Tab stop: ← → walk the items (roving), Delete / Backspace cancels the focused one */}
      <ol class="hud-queue__list ui-interactive" aria-label={ht('queue.label')} {...ROVING_LIST}>
        {!active && queued.length === 0 && (
          <li class="hud-queue__idle">
            <Icon name="dots" size="1rem" />
            {ht('queue.idle')}
          </li>
        )}
        {active && <ActiveItem item={active} game={game} />}
        {shown.map((q, i) => (
          <QueuedItem key={q.uid} item={q} game={game} index={i} first={!active && i === 0} />
        ))}
        {more > 0 && (
          <li
            class="hud-queue__more u-num"
            data-roving=""
            tabIndex={!active && shown.length === 0 ? 0 : -1}
            aria-label={ht('queue.more', { count: more })}
            {...tip({ title: ht('queue.more', { count: more }), body: queued.slice(fit).map((q) => q.label).join('\n') })}
          >
            +{more}
          </li>
        )}
      </ol>
    </div>
  );
}

function sourceText(q: QueueView): string {
  return q.source === 'auto' ? ht('queue.auto') : q.source === 'system' ? ht('queue.system') : ht('queue.player');
}

function cancel(game: GameController, q: QueueView) {
  game.cancelQueueItem(q.uid);
  game.playUi('uiClose');
}

/**
 * Delete / Backspace on a focused queue item cancels it; focus moves to a neighbour right away (the item leaves with
 * the next render, and focus must not drop to <body> where the next key would mean something else).
 */
function cancelKey(game: GameController, q: QueueView) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (!q.cancellable) {
      game.playUi('uiError');
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const list = el.closest('[data-roving-group]');
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[data-roving]')) : [];
    const i = items.indexOf(el);
    const next = items[i + 1] ?? items[i - 1] ?? null;
    if (next) {
      next.tabIndex = 0;
      el.tabIndex = -1;
      next.focus({ preventScroll: true });
    }
    cancel(game, q);
  };
}

function ActiveItem({ item, game }: { item: QueueView; game: GameController }) {
  const p = clamp(num(item.progress), 0, 1);
  const r = 21;
  const { circumference, offset } = ringDash(p, r);
  return (
    <li class={`hud-qactive is-${item.source}`}>
      <span
        class="hud-qactive__ring"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 100)}
        aria-label={`${item.label}: ${ht('queue.progress', { pct: formatPercent(p) })}`}
        aria-keyshortcuts={item.cancellable ? 'Delete' : undefined}
        data-roving=""
        tabIndex={0}
        onKeyDown={cancelKey(game, item)}
        {...tip({ title: item.label, body: `${ht('queue.progress', { pct: formatPercent(p) })} · ${sourceText(item)}\n${ht('queue.keys')}` })}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r={r} class="hud-qactive__track" />
          <circle cx="24" cy="24" r={r} class="hud-qactive__arc" stroke-dasharray={circumference.toFixed(2)} stroke-dashoffset={offset.toFixed(2)} />
        </svg>
        <span class="hud-qactive__icon">
          <Icon name={item.icon} size="1.375rem" />
        </span>
      </span>
      <span class="hud-qactive__text">
        <span class="hud-qactive__label u-ellipsis">{item.label}</span>
        <span class="hud-qactive__sub u-ellipsis">{sourceText(item)}</span>
      </span>
      {item.cancellable ? (
        <button type="button" class="hud-qcancel" tabIndex={-1} aria-label={ht('queue.cancel', { label: item.label })} onClick={() => cancel(game, item)} {...tip({ title: ht('queue.cancel', { label: item.label }), kbd: 'Del' })}>
          <Icon name="close" size="0.8125rem" strokeWidth={2.2} />
        </button>
      ) : (
        <span class="hud-qlock" {...tip({ title: ht('queue.locked') })} aria-label={ht('queue.locked')}>
          <Icon name="lock" size="0.75rem" />
        </span>
      )}
    </li>
  );
}

function QueuedItem({ item, game, index, first }: { item: QueueView; game: GameController; index: number; first: boolean }) {
  return (
    <li class={`hud-qitem is-${item.source}`} style={{ '--i': index }}>
      <span
        class="hud-qitem__tile"
        data-roving=""
        tabIndex={first ? 0 : -1}
        aria-label={`${item.label} · ${sourceText(item)}${item.cancellable ? '' : ` · ${ht('queue.locked')}`}`}
        aria-keyshortcuts={item.cancellable ? 'Delete' : undefined}
        onKeyDown={cancelKey(game, item)}
        {...tip({ title: item.label, body: `${sourceText(item)}${item.cancellable ? `\n${ht('queue.keys')}` : ''}` })}
      >
        <Icon name={item.icon} size="1.1875rem" />
      </span>
      {item.cancellable && (
        <button type="button" class="hud-qcancel is-mini" tabIndex={-1} aria-label={ht('queue.cancel', { label: item.label })} onClick={() => cancel(game, item)} {...tip({ title: ht('queue.cancel', { label: item.label }), kbd: 'Del' })}>
          <Icon name="close" size="0.6875rem" strokeWidth={2.4} />
        </button>
      )}
    </li>
  );
}
