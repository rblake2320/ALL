/**
 * In-game economy HUD (mounted by App on the 'game' screen, layered over the HUD; owns no HUD files): Bones counter,
 * Store button (KEYMAP.store, G), a collapsible Quests & daily tasks panel, and grant toasts ("+30 Bones — Quest
 * complete: …", auto-dismiss 5 s, hover pauses). Reads only GameController.economy.
 *
 * W-123 (D-070): every quest, daily-task and weekly-challenge row is a one-click action — click (or Enter on) the row
 * or its Go button and the selected (or best available) zombie heads off to do it (game.questGo); "Needs an easel ·
 * Shop" opens the Buy catalog filtered to what satisfies it; a blocked step shows its reason.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EconomyFacade, EconomyToast } from '../../economy/facade';
import { IconButton, ProgressBar } from '../common';
import { Icon } from '../icons';
import { useGame } from '../hooks';
import { usePhoneLayout } from '../hud/lib/phoneLayout';
import { formatCount } from '../../economy/pricing';
import { frameObjectClearSettled, frameStoryTarget } from '../hud/lib/storyFraming';
import { hudStore } from '../hud/lib/store';
import type { ComponentChildren } from 'preact';
import type { QuestGoResult, QuestRowRef } from '../../game/questGo';
import { st } from './strings';
import { useEconomy } from './useEconomy';
import './store.css';

export const TOAST_MS = 5000;

export function openStore(game: ReturnType<typeof useGame>, econ: EconomyFacade, source: 'menu' | 'hud' | 'buyLock' | 'hotkey', skuId: string | null = null, tab: Parameters<EconomyFacade['focusStore']>[0] = 'featured'): void {
  econ.focusStore(tab, skuId, source);
  game.openDialog('store');
}

/** Toast stack width (notify.css `.hud-toasts { width: 22rem }`) plus a gap: the room needed to sit left of the panel. */
const TOAST_ROOM_REM = 22.5;

/**
 * W-123: the desktop toast stack and the Quests panel both live under the top bar at the right edge, so a toast
 * covered the top of the open panel. Publish where the panel is (`--hud-quests-l` / `--hud-quests-b`) and how the stack
 * must avoid it (`html[data-toasts-avoid]`): to its left when the window leaves room for a whole toast, else below it.
 * Phone layouts keep their own placement (W-118, phone.css), so nothing is published there.
 */
export function useToastAvoid(ref: { current: HTMLElement | null }, active: boolean): void {
  useEffect(() => {
    const html = typeof document !== 'undefined' ? document.documentElement : null;
    const el = ref.current;
    const clear = () => {
      html?.removeAttribute('data-toasts-avoid');
      html?.style.removeProperty('--hud-quests-l');
      html?.style.removeProperty('--hud-quests-b');
    };
    if (!html || !el || !active) {
      clear();
      return;
    }
    const publish = () => {
      const r = el.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(html).fontSize) || 16;
      html.style.setProperty('--hud-quests-l', `${Math.round(r.left)}px`);
      html.style.setProperty('--hud-quests-b', `${Math.round(r.bottom)}px`);
      html.setAttribute('data-toasts-avoid', r.left >= TOAST_ROOM_REM * rem ? 'left' : 'below');
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', publish);
      clear();
    };
  }, [active, ref.current]);
}

export function EconomyHud() {
  const econ = useEconomy();
  const game = useGame();
  // null = the default for the layout: open on desktop, collapsed to the Quests chip on phone (W-114)
  const [openPref, setOpen] = useState<boolean | null>(null);
  const { phone } = usePhoneLayout();
  const open = openPref ?? !phone;
  const rootRef = useRef<HTMLDivElement>(null);
  useToastAvoid(rootRef, !phone && open && !!econ?.ready);
  if (!econ || !econ.ready) return null;
  const d = econ.daily;
  const quests = econ.quests;
  const target = game.storyTarget;
  const showMe = () => {
    // phone: the quest overlay covers the world — fold it first, then frame once the panel is gone
    if (phone) setOpen(false);
    game.playUi('uiClick');
    requestAnimationFrame(() => requestAnimationFrame(() => frameStoryTarget(game)));
  };
  const fold = () => {
    if (phone) setOpen(false);
  };
  const go = (ref: QuestRowRef) => {
    let r: QuestGoResult;
    try {
      r = game.questGo(ref, { frame: false });
    } catch {
      return;
    }
    if (r.kind === 'queue') {
      // phone: the quest overlay covers the world — fold it first, then frame once the panel is gone
      fold();
      const id = r.objectId;
      if (id) requestAnimationFrame(() => requestAnimationFrame(() => frameObjectClearSettled(game, id)));
    } else if (r.kind === 'missing' || (r.kind === 'mode' && r.mode === 'buy')) {
      const f = r.buyFilter;
      hudStore.set({ buySearch: '', buyFocus: null, buyFilter: f ? { label: f.label, defIds: f.defIds.slice() } : null });
      fold();
    } else if (r.kind === 'mode' && r.mode === 'build') {
      // the player's remembered wall style
      game.setBuildTool({ kind: 'wall', style: hudStore.get().styles.wall });
      fold();
    } else if (r.kind === 'mode') {
      fold();
    }
  };
  const pending = quests.length + d.tasks.filter((t) => !t.done).length + (d.weekly && !d.weekly.done ? 1 : 0);
  return (
    <div ref={rootRef} class="st-hud ui-interactive" data-hud-region="15" data-testid="economy-hud">
      <div class="st-hud__bar ui-panel">
        <span class="st-hud__bones" title={st('balance.bones.body')} data-testid="hud-bones">
          <span aria-hidden="true">
            <Icon name="skull" size="1rem" class="st-bones-glyph" />
            <span class="u-num">{formatCount(econ.wallet.bones)}</span>
          </span>
          <span class="u-sr-only">{st('hud.bones', { amount: formatCount(econ.wallet.bones) })}</span>
        </span>
        <button type="button" class="st-hud__store" onClick={() => openStore(game, econ, 'hud')} aria-keyshortcuts="G" data-testid="hud-store">
          <Icon name="buy" size="1rem" /> {st('hud.store')}
          <kbd class="ui-kbd st-hud__kbd">G</kbd>
        </button>
        {phone ? (
          <button type="button" class={`st-hud__questchip${open ? ' is-open' : ''}`} aria-label={st('hud.quests.toggle')} aria-expanded={open ? 'true' : 'false'} aria-controls="st-hud-panel" onClick={() => setOpen(!open)} data-testid="hud-quests-chip">
            <span aria-hidden="true">{st('hud.quests.chip')}</span>
            {pending > 0 ? (
              <span class="st-hud__questcount u-num" aria-hidden="true">
                {pending}
              </span>
            ) : null}
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size="1rem" />
          </button>
        ) : (
          <IconButton icon={open ? 'chevronUp' : 'chevronDown'} size="xs" label={st('hud.quests.toggle')} aria-expanded={open ? 'true' : 'false'} aria-controls="st-hud-panel" onClick={() => setOpen(!open)} />
        )}
      </div>
      <GrantToasts econ={econ} />
      {open ? (
        <section id="st-hud-panel" class="st-hud__panel ui-panel" aria-label={st('hud.quests')}>
          <h3 class="st-hud__h u-caps">{st('hud.story')}</h3>
          {quests.length === 0 ? <p class="st-hud__none">{st('hud.story.none')}</p> : null}
          <ul class="st-hud__list" role="list">
            {quests.map((q) => (
              <GoRow key={q.id} game={game} rowRef={{ source: 'quest', id: q.id, stepId: q.stepId ?? null }} title={q.title} step={q.step} done={q.done} onGo={go} testId={`quest-${q.id}`}>
                <div class="st-task__row">
                  <span class="st-task__title">{q.title}</span>
                  <span class="st-task__reward u-num">{st('hud.reward', { amount: q.bones })}</span>
                </div>
                {q.beat ? <p class="st-task__beat">{q.beat}</p> : null}
                <div class="st-task__steprow">
                  <div class="st-task__step">{q.step}</div>
                  {target && target.questId === q.id && (!q.stepId || q.stepId === target.stepId) ? (
                    <button type="button" class="st-task__show" onClick={showMe} aria-label={st('hud.showMe.label', { step: q.step })} data-testid="quest-show-me">
                      <Icon name="eye" size="0.85rem" /> {st('hud.showMe')}
                    </button>
                  ) : null}
                </div>
                {q.credited ? <div class="st-task__credited" data-testid="quest-credited">{st('hud.credited')}</div> : null}
                <ProgressBar value={Math.min(1, q.progress / Math.max(1, q.target))} label={`${q.step}: ${q.progress}/${q.target}`} size="sm" />
              </GoRow>
            ))}
          </ul>
          <h3 class="st-hud__h u-caps">
            {st('hud.daily')}
            {d.streak > 0 ? <span class="st-hud__streak"> · {st('hud.daily.streak', { count: d.streak })}</span> : null}
          </h3>
          {d.clockRollback ? <p class="st-hud__none">{st('hud.daily.rollback')}</p> : null}
          <ul class="st-hud__list" role="list">
            {d.tasks.map((t) => (
              <GoRow key={t.id} game={game} rowRef={{ source: 'daily', id: t.id }} title={t.title} step={t.title} done={t.done} onGo={go} testId={`task-${t.id}`}>
                <div class="st-task__row">
                  <span class="st-task__title">
                    {t.done ? <Icon name="check" size="0.85rem" /> : null} {t.title}
                  </span>
                  <span class="st-task__reward u-num">{t.done ? st('hud.done') : st('hud.reward', { amount: t.bones })}</span>
                </div>
                <ProgressBar value={t.progress / Math.max(1, t.target)} label={`${t.title}: ${t.progress}/${t.target}`} size="sm" />
              </GoRow>
            ))}
          </ul>
          {d.weekly ? (
            <>
              <h3 class="st-hud__h u-caps">{st('hud.weekly')}</h3>
              <ul class="st-hud__list" role="list">
                <GoRow game={game} rowRef={{ source: 'weekly', id: d.weekly.id }} title={d.weekly.title} step={d.weekly.title} done={d.weekly.done} onGo={go} testId={`weekly-${d.weekly.id}`}>
                  <div class="st-task__row">
                    <span class="st-task__title">{d.weekly.title}</span>
                    <span class="st-task__reward u-num">{d.weekly.done ? st('hud.done') : st('hud.reward', { amount: d.weekly.bones })}</span>
                  </div>
                  <ProgressBar value={d.weekly.progress / Math.max(1, d.weekly.target)} label={`${d.weekly.title}: ${d.weekly.progress}/${d.weekly.target}`} size="sm" />
                </GoRow>
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Did this event come from (inside) a button or link of the row — those handle themselves. */
function fromControl(e: Event): boolean {
  const t = e.target as Element | null;
  return !!t && typeof t.closest === 'function' && !!t.closest('button, a, input, [role="button"]');
}

interface GoRowProps {
  game: ReturnType<typeof useGame>;
  rowRef: QuestRowRef;
  title: string;
  step: string;
  done: boolean;
  onGo: (r: QuestRowRef) => void;
  testId: string;
  children: ComponentChildren;
}

/**
 * One quest / task row (W-123): the whole row is clickable (pointer) and Enter on the focused row runs it; the explicit
 * Go / Shop button is the accessible control (named "Go: <step>"; ≥ 44 px on phone). Below the step: what Go would do
 * when it can't simply go ("Needs an easel", or the blocked reason — shown, never silently ignored).
 */
function GoRow({ game, rowRef, title, step, done, onGo, testId, children }: GoRowProps) {
  let a: QuestGoResult | null = null;
  try {
    a = done || typeof game.questAction !== 'function' ? null : game.questAction(rowRef);
  } catch {
    a = null;
  }
  const actionable = !!a && a.kind !== 'blocked';
  const run = () => {
    if (!done) onGo(rowRef);
  };
  const shop = !!a && a.kind === 'missing';
  const aria = a && a.kind === 'missing' ? st('hud.go.shop.label', { step, need: a.need }) : st('hud.go.label', { step });
  return (
    <li
      class={`st-task st-task--go${done ? ' is-done' : ''}${actionable ? ' is-actionable' : ''}`}
      data-testid={testId}
      data-go-kind={a ? a.kind : 'none'}
      tabIndex={done ? undefined : 0}
      aria-label={done ? undefined : `${title}: ${step}`}
      onClick={(e) => {
        if (!fromControl(e)) run();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          run();
        }
      }}
    >
      {children}
      {!done && a ? (
        <div class="st-task__gorow">
          {a.kind === 'missing' ? (
            <span class="st-task__need" data-testid="quest-go-need">
              {st('hud.go.need', { need: a.need })}
            </span>
          ) : null}
          {a.kind === 'blocked' ? (
            <span class="st-task__why" data-testid="quest-go-why">
              {a.reason}
            </span>
          ) : null}
          {actionable ? (
            <button
              type="button"
              class="st-task__go"
              onClick={(e) => {
                e.stopPropagation();
                run();
              }}
              aria-label={aria}
              data-testid="quest-go"
            >
              <Icon name={shop ? 'buy' : 'play'} size="0.85rem" /> {shop ? st('hud.go.shop') : st('hud.go')}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function GrantToasts({ econ }: { econ: EconomyFacade }) {
  return (
    <div class="st-toasts" role="status" aria-live="polite" aria-label={st('toast.region')}>
      {econ.toasts.map((t) => (
        <GrantToast key={t.id} t={t} onDone={() => econ.dismissToast(t.id)} />
      ))}
    </div>
  );
}

function GrantToast({ t, onDone }: { t: EconomyToast; onDone: () => void }) {
  const [hover, setHover] = useState(false);
  const left = useRef(TOAST_MS);
  useEffect(() => {
    if (hover) return;
    const started = Date.now();
    const id = setTimeout(onDone, left.current);
    return () => {
      clearTimeout(id);
      left.current = Math.max(500, left.current - (Date.now() - started));
    };
  }, [hover]);
  return (
    <div class="st-toast ui-panel" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} data-testid="grant-toast">
      <Icon name="skull" size="1.1rem" class="st-bones-glyph" />
      <div>
        <div class="st-toast__title u-num">{t.title}</div>
        <div class="st-toast__text">{t.text}</div>
      </div>
    </div>
  );
}
