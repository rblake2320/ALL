/**
 * Household bar (left edge): one portrait per household member with mood ring, critical-need badge and
 * at-work / crumbled / asleep states. Click selects, double-click focuses the camera; Tab cycles (controller).
 */
import type { GameController } from '../../../game/contracts';
import type { AgentSummary } from '../../../sim/contracts';
import { cleanActivityLabel } from '../lib/format';
import { safe } from '../lib/safe';
import { needIcon } from '../parts/controls';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { PHONE_GUTTER, usePhoneLayout } from '../lib/phoneLayout';
import { useHudStore } from '../lib/store';
import { remPx, useGame, useViewport } from '../parts/hooks';
import { scrollIntoViewIfNeeded, useOverflowFade } from '../parts/scroll';
import { Icon } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import './household.css';

export type MemberState = 'home' | 'asleep' | 'atWork' | 'crumbled' | 'away';

export function memberState(game: GameController, m: AgentSummary): MemberState {
  if (m.presence === 'crumbled') return 'crumbled';
  if (m.presence === 'atWork') return 'atWork';
  if (m.presence !== 'onLot') return 'away';
  const ag = safe('hh.agent', () => game.sim?.agent(m.id), undefined);
  if (ag?.anim === 'sleep' || ag?.status?.passedOut || m.activityIcon === 'zzz') return 'asleep';
  return 'home';
}

/** Bar geometry (rem) shared by the density decision below and household.css. */
export const HH_GEOMETRY = {
  top: 6, // gap + plaque
  pad: 0.875, // bar padding top + bottom
  normal: { chrome: 4.0, gap: 0.375 }, // item padding + portrait + gap above the name (name line added per rem)
  dense: { chrome: 3.0, gap: 0.2 },
} as const;

/**
 * Portrait density for `count` members in `availRem` of height: 'normal' (portrait + name), 'dense' (smaller
 * portraits, names in tooltips) or 'scroll' (dense, and the bar scrolls with edge fades). `rem` (px) resolves the
 * name line, whose font size has a 9.5px floor.
 */
export function householdDensity(count: number, availRem: number, rem = 16): 'normal' | 'dense' | 'scroll' {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return 'normal';
  const avail = Number.isNaN(availRem) ? Number.POSITIVE_INFINITY : availRem;
  const r = Number.isFinite(rem) && rem > 0 ? rem : 16;
  const nameLine = Math.max(0.6875, 9.5 / r) * 1.25;
  const need = (item: number, gap: number) => HH_GEOMETRY.pad + n * item + Math.max(0, n - 1) * gap;
  if (need(HH_GEOMETRY.normal.chrome + nameLine, HH_GEOMETRY.normal.gap) <= avail + 0.05) return 'normal';
  if (need(HH_GEOMETRY.dense.chrome, HH_GEOMETRY.dense.gap) <= avail + 0.05) return 'dense';
  return 'scroll';
}

export function HouseholdBar() {
  const game = useGame();
  const ui = useHudStore();
  const vp = useViewport();
  const members = safe('household', () => game.sim?.household() ?? [], []).filter((m) => m && m.presence !== 'gone');
  const navRef = useRef<HTMLElement>(null);
  const rem = remPx();
  const { phone, orient } = usePhoneLayout();
  // Room between the bar's top and the agent panel (or the bottom edge when no zombie is selected).
  const bottomPx = ui.agentPanelTop !== null && game.selectedAgentId ? ui.agentPanelTop : vp.h;
  let availRem = (bottomPx - rem * 0.75 - rem * HH_GEOMETRY.top) / rem;
  if (phone) {
    // Phone (phone.css): the bar starts under the (wrapping) top bar. Landscape: a full-height column left of the agent
    // panel. Portrait: above the action queue that sits on the full-width agent panel. Names always stay visible
    // (touch has no tooltips); the bar scrolls when the household does not fit.
    const top = parseFloat(document.documentElement.style.getPropertyValue('--hud-topbar-b')) || rem * HH_GEOMETRY.top;
    const bottom = orient === 'landscape' ? vp.h - PHONE_GUTTER : bottomPx - 72;
    availRem = (bottom - top - PHONE_GUTTER) / rem;
  }
  const density = phone ? 'normal' : householdDensity(members.length, availRem, rem);
  useOverflowFade(navRef, 'y', [members.length, density]);
  const selected = game.selectedAgentId;
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.hud-member.is-selected');
    if (el) scrollIntoViewIfNeeded(el, 'y', 6);
  }, [selected, density]);
  if (members.length === 0) return null;
  return (
    <nav
      ref={navRef}
      class={`hud-household ui-panel ui-interactive hud-ofl-y is-${density}`}
      data-hud-region="20"
      style={{ maxHeight: `${Math.max(3.5, availRem).toFixed(3)}rem` }}
      aria-label={ht('hh.label')}
      data-hint-anchor="household-portraits household household-bar portraits"
    >
      <ul class="hud-household__list">
        {members.map((m) => (
          <li key={m.id}>
            <Member game={game} m={m} selected={selected === m.id} dense={density !== 'normal'} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Member({ game, m, selected, dense }: { game: GameController; m: AgentSummary; selected: boolean; dense: boolean }) {
  const state = memberState(game, m);
  const critical = state === 'home' || state === 'asleep' ? m.criticalNeed : null;
  const needName = critical ? ht(`need.${critical}`) : '';
  const statusText =
    state === 'atWork' ? ht('hh.atWork') : state === 'crumbled' ? ht('hh.crumbled') : state === 'asleep' ? ht('hh.asleep') : state === 'away' ? ht('hh.away') : cleanActivityLabel(m.activity) || ht('agent.idle');
  const body = [
    `${m.moodBand ? ht(`band.${m.moodBand}`) : ''} · ${statusText}`,
    critical ? ht('hh.critical', { need: needName }) : '',
    ht('hh.select'),
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button
      type="button"
      class={`hud-member is-${state}${selected ? ' is-selected' : ''}${critical ? ' has-alert' : ''}`}
      aria-pressed={selected ? 'true' : 'false'}
      aria-label={`${m.name}. ${statusText}${critical ? `. ${ht('hh.critical', { need: needName })}` : ''}`}
      onClick={() => {
        if (!selected) game.playUi('uiClick');
        game.selectAgent(m.id);
      }}
      onDblClick={() => game.selectAgent(m.id, true)}
      {...tip({ title: m.name, body, keys: 'cycleZombie', place: 'right', tone: critical ? 'warm' : null })}
    >
      <Portrait
        size={dense ? '2.5rem' : '3.25rem'}
        appearance={m.appearance}
        band={m.moodBand}
        dimmed={state === 'atWork' || state === 'crumbled' || state === 'away'}
        alert={!!critical}
        selected={selected}
      />
      {state !== 'home' && (
        <span class={`hud-member__state is-${state}`} aria-hidden="true">
          <Icon name={state === 'atWork' ? 'work' : state === 'crumbled' ? 'skull' : state === 'asleep' ? 'zzz' : 'exit'} size="0.8125rem" />
        </span>
      )}
      {critical && (
        <span class="hud-member__alert" aria-hidden="true">
          <Icon name={needIcon(critical)} size="0.8125rem" />
        </span>
      )}
      <span class="hud-member__name u-ellipsis">{m.firstName || m.name}</span>
    </button>
  );
}
