/**
 * Selected-zombie panel (bottom-left): portrait, name, mood, current activity, phone/focus/collapse, and the
 * eight detail tabs (Needs, Mood, Skills, Jobs (W-124), Career, Relationships, Aspiration, Info).
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { usePhoneLayout } from '../lib/phoneLayout';
import type { GameController } from '../../../game/contracts';
import type { AgentSummary, MoodView } from '../../../sim/contracts';
import { cleanActivityLabel, formatSigned, num } from '../lib/format';
import { safe } from '../lib/safe';
import { AGENT_TABS, hudStore, useHudStore, type AgentTab } from '../lib/store';
import { IconButton, Tabs } from '../parts/controls';
import { useGame } from '../parts/hooks';
import { useOverflowFade } from '../parts/scroll';
import { Icon, type HudIconName } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import { memberState } from '../household/HouseholdBar';
import { MoodTab, NeedsTab, SkillsTab } from './tabsA';
import { AspirationTab, CareerTab, InfoTab, RelationshipsTab } from './tabsB';
import { JobsTab } from './JobsTab';
import './agent.css';

const TAB_ICON: Record<AgentTab, string> = {
  needs: 'vitality',
  mood: 'mood',
  skills: 'skills',
  jobs: 'check',
  career: 'career',
  relationships: 'relationships',
  aspiration: 'aspiration',
  info: 'idCard',
};

export const MOOD_ICON: Record<MoodView['band'], HudIconName> = {
  great: 'moodGreat',
  good: 'moodGood',
  fine: 'moodFine',
  uneasy: 'moodUneasy',
  miserable: 'moodMiserable',
};

/** Set (or with null remove) an inline custom property on <html> only when its value changes; never throws. */
export function setRootVar(html: { style: { getPropertyValue(n: string): string; setProperty(n: string, v: string): void; removeProperty(n: string): string } }, name: string, value: string | null): boolean {
  try {
    const cur = html.style.getPropertyValue(name);
    if (value === null) {
      if (!cur) return false;
      html.style.removeProperty(name);
      return true;
    }
    if (cur === value) return false;
    html.style.setProperty(name, value);
    return true;
  } catch {
    return false;
  }
}

/** Publish the panel's top + right edges (household bar fits above it, the phone queue beside it) while mounted. */
function usePanelTop(ref: { current: HTMLElement | null }, active: boolean, phone = false): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) {
      hudStore.set({ agentPanelTop: null, agentPanelRight: null });
      return;
    }
    const html = typeof document !== 'undefined' ? document.documentElement : null;
    const publish = () => {
      const r = el.getBoundingClientRect();
      hudStore.set({ agentPanelTop: Math.round(r.top), agentPanelRight: Math.round(r.right) });
      // W-118: the panel's top / right edges for CSS (phone.css keeps the toast stack clear of it on compact layouts).
      // Phone mode only, and only on a change: an inline custom property on <html> invalidates the style of the whole
      // document, which the desktop layout never needs.
      if (html) setRootVar(html, '--hud-agent-t', phone ? `${Math.round(r.top)}px` : null);
      if (html) setRootVar(html, '--hud-agent-r', phone ? `${Math.round(r.right)}px` : null);
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    window.addEventListener('resize', publish);
    el.addEventListener('animationend', publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', publish);
      el.removeEventListener('animationend', publish);
      hudStore.set({ agentPanelTop: null, agentPanelRight: null });
      if (html) setRootVar(html, '--hud-agent-t', null);
      if (html) setRootVar(html, '--hud-agent-r', null);
    };
  }, [active, phone]);
}

export function AgentPanel() {
  const game = useGame();
  const ui = useHudStore();
  const id = game.selectedAgentId;
  const sim = game.sim;
  const summary = id && sim ? safe('agent.summary', () => sim.summary(id), null) : null;
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const visible = !!(id && sim && summary);
  usePanelTop(sectionRef, visible, usePhoneLayout().phone);
  useOverflowFade(bodyRef, 'y', [id, ui.agentTab, ui.agentCollapsed, visible]);
  // phone: the tab strip scrolls sideways (phone.css); keep the selected tab on screen when it changes from elsewhere
  // (a quest "Go", a hint, the keyboard). `nearest` never scrolls the page, only the strip.
  useLayoutEffect(() => {
    const strip = bodyRef.current?.parentElement?.querySelector('.hud-agent__tabs');
    const sel = strip?.querySelector('[aria-selected="true"]') as { scrollIntoView?: (o: object) => void } | null | undefined;
    if (strip && strip.scrollWidth > strip.clientWidth + 1) sel?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [id, ui.agentTab, ui.agentCollapsed, visible]);
  if (!id || !sim || !summary) return null;
  const mood = safe('agent.mood', () => sim.mood(id), null);
  const state = memberState(game, summary);
  const band = mood?.band ?? summary.moodBand ?? 'fine';
  const moodLabel = mood?.label || ht(`band.${band}`);
  const activity =
    state === 'atWork' ? ht('status.atWork') : state === 'crumbled' ? ht('status.crumbled') : cleanActivityLabel(summary.activity) || (state === 'asleep' ? ht('status.asleep') : ht('agent.idle'));
  const activityIcon: HudIconName | string = state === 'atWork' ? 'work' : state === 'crumbled' ? 'skull' : summary.activityIcon ?? (state === 'asleep' ? 'zzz' : 'dots');
  const tab = ui.agentTab;
  const collapsed = ui.agentCollapsed;
  const panelId = 'hud-agent';
  return (
    <section ref={sectionRef} class={`hud-agent ui-panel ui-panel--ornate ui-interactive${collapsed ? ' is-collapsed' : ''}`} aria-label={summary.name} data-hint-anchor="agent-panel agent zombie-panel" data-hud-region="30">
      <header class="hud-agent__head">
        <button
          type="button"
          class="hud-agent__portrait"
          aria-label={`${ht('agent.focus')}: ${summary.name}`}
          onClick={() => game.selectAgent(id, true)}
          {...tip({ title: ht('agent.focus'), keys: 'focusSelected' })}
        >
          <Portrait size="4.25rem" appearance={summary.appearance} band={band} dimmed={state === 'crumbled'} />
        </button>
        <div class="hud-agent__titles">
          <h2 class="hud-agent__name u-display u-ellipsis" {...(summary.name.length > 22 ? tip({ title: summary.name }) : {})}>
            {summary.name}
          </h2>
          <div class="hud-agent__meta">
            <span
              class={`hud-moodchip is-${band}`}
              tabIndex={0}
              {...tip({ title: moodLabel, body: ht('agent.mood', { value: formatSigned(num(mood?.value ?? summary.mood)) }) })}
              aria-label={`${moodLabel}, ${ht('agent.mood', { value: formatSigned(num(mood?.value ?? summary.mood)) })}`}
            >
              <Icon name={MOOD_ICON[band] ?? 'moodFine'} size="1rem" />
              <span class="u-ellipsis">{moodLabel}</span>
            </span>
          </div>
          <div class="hud-agent__activity u-ellipsis" aria-live="polite" {...(activity.length > 26 ? tip({ title: activity }) : {})}>
            <Icon name={activityIcon} size="0.9375rem" />
            <span class="u-ellipsis">{activity}</span>
          </div>
        </div>
        <div class="hud-agent__actions">
          <IconButton
            icon="phone"
            label={ht('agent.phone')}
            glass
            class="hud-agent__phone"
            data-hint-anchor="phone phone-button"
            disabled={state === 'crumbled'}
            onClick={() => {
              game.playUi('uiOpen');
              game.openDialog('phone');
            }}
            tipSpec={{ title: ht('agent.phone'), body: ht('agent.phone.body') }}
          />
          <IconButton
            icon={collapsed ? 'chevronUp' : 'chevronDown'}
            label={collapsed ? ht('agent.expand') : ht('agent.collapse')}
            size="sm"
            onClick={() => hudStore.set({ agentCollapsed: !collapsed })}
          />
        </div>
      </header>
      {!collapsed && (
        <>
          <Tabs<AgentTab>
            label={ht('agent.tabs')}
            idPrefix={panelId}
            value={tab}
            iconOnly
            variant="pills"
            fill
            class="hud-agent__tabs"
            onChange={(t) => {
              hudStore.set({ agentTab: t });
              game.playUi('uiTab');
            }}
            tabs={AGENT_TABS.map((t) => ({ id: t, label: ht(`tab.${t}`), icon: TAB_ICON[t], anchor: `tab-${t}` }))}
          />
          <div ref={bodyRef} class="hud-agent__body ui-tabpanel hud-ofl-y" role="tabpanel" id={`${panelId}-panel-${tab}`} aria-labelledby={`${panelId}-tab-${tab}`} key={tab}>
            <TabBody game={game} tab={tab} summary={summary} />
          </div>
        </>
      )}
    </section>
  );
}

function TabBody({ game, tab, summary }: { game: GameController; tab: AgentTab; summary: AgentSummary }) {
  switch (tab) {
    case 'needs':
      return <NeedsTab game={game} summary={summary} />;
    case 'mood':
      return <MoodTab game={game} summary={summary} />;
    case 'skills':
      return <SkillsTab game={game} summary={summary} />;
    case 'jobs':
      return <JobsTab game={game} summary={summary} />;
    case 'career':
      return <CareerTab game={game} summary={summary} />;
    case 'relationships':
      return <RelationshipsTab game={game} summary={summary} />;
    case 'aspiration':
      return <AspirationTab game={game} summary={summary} />;
    case 'info':
      return <InfoTab game={game} summary={summary} />;
  }
}

/** Shared tab header: serif title on the left, contextual extras on the right. */
export function TabHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="hud-tabhead">
      <h3 class="hud-tabhead__title u-display">{title}</h3>
      <div class="hud-tabhead__extra">{children}</div>
    </div>
  );
}
