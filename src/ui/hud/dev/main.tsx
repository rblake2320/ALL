/**
 * UI-HUD dev harness entry (dev/ui-hud.html). Renders the real Hud() against a mock GameController inside the
 * shell's `.ui-root`, over a stand-in world backdrop. Query params: see ./params.ts. `window.__hud` exposes the
 * mock controller + HUD store for Playwright scripts.
 */
import { render } from 'preact';
import '../../theme/index';
import { applyThemeSettings } from '../../theme/index';
import { GameContext } from '../parts/hooks';
import { Hud } from '../Hud';
import { hudStore, AGENT_TABS, type AgentTab } from '../lib/store';
import { Backdrop } from './Backdrop';
import { CompareSheet } from './CompareSheet';
import { IconSheet } from './IconSheet';
import { MockController } from './mockGame';
import { readParams } from './params';
import { PortraitSheet } from './PortraitSheet';

const params = readParams(location.search);
const root = document.getElementById('app')!;
const world = document.getElementById('world')!;

if (params.view === 'icons') render(<IconSheet />, root);
else if (params.view === 'compare') render(<CompareSheet />, root);
else if (params.view === 'portraits') render(<PortraitSheet />, root);
else {
  const game = new MockController(params);
  hudStore.set({
    agentTab: (AGENT_TABS as string[]).includes(params.tab) ? (params.tab as AgentTab) : 'needs',
    logOpen: params.log,
    logFilter: params.logFilter,
    inviteMode: params.inviteParty ? 'party' : 'invite',
    buySearch: params.query,
    agentCollapsed: params.collapsed,
    buyFocus: params.placing,
  });
  const sync = () => applyThemeSettings(game.settings);
  sync();
  game.subscribe(sync);
  if (params.hotkeys) game.installHotkeys();
  (window as unknown as { __hud: unknown }).__hud = { game, store: hudStore };
  render(<Backdrop night={params.night || params.fullMoon} moon={params.fullMoon} mode={params.mode} />, world);
  const App = () => (
    <GameContext.Provider value={game}>
      <div class="ui-root">
        <Hud />
      </div>
    </GameContext.Provider>
  );
  render(<App />, root);
  if (params.live) {
    setInterval(() => {
      if (game.speed === 0) return;
      game.advance(4 * game.speed);
    }, 250);
  }
}
