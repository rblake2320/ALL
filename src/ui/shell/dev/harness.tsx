/**
 * DEV ONLY — UI-SHELL harness entry (dev/ui-shell.html). Query params:
 *   view=app|icons|components|portraits     screen=boot|loading|menu|newGame|caz|game|gameOver
 *   dialog=settings|saveLoad|pause|help|confirmQuit|credits|diagnostics
 *   saves=many|one|none|recovered|stress   caz=default|full|errors|single|long   fatal=<message>   crash=1
 *   scale=1.2   motion=reduce   cb=1   quality=low   quit=0   loading=0.4   animate=1   freeze=1   hud=real
 *   stress=1 (longest names, $9,999,999, 8 members, day 9,999 — implies saves=stress, caz=long)   toasts=1
 *   crash=overlay (throws inside a portal tree)   lastSave=<controller phrase, '' = never saved>
 */
import { render } from 'preact';
import '../../theme';
import '../shell.css';
import '../caz.css';
import '../dialogs.css';
import './harness.css';
import { App } from '../../App';
import { GameContext } from '../../hooks';
import { applyThemeSettings } from '../../theme';
import type { DialogId, Screen } from '../../../game/contracts';
import { createMockGame, type MockOptions } from './mockGame';
import { Backdrop } from './Backdrop';
import { ComponentGallery, IconSheet, PortraitSheet } from './Gallery';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'app';
const screen = (q.get('screen') ?? 'menu') as Screen;
const num = (k: string) => {
  const v = q.get(k);
  return v === null ? undefined : Number(v);
};

if (q.get('freeze') === '1') document.documentElement.dataset.freeze = '1';

const opts: MockOptions = {
  screen,
  dialog: (q.get('dialog') as DialogId) ?? null,
  saves: (q.get('saves') as MockOptions['saves']) ?? (q.get('stress') === '1' ? 'stress' : 'many'),
  caz: (q.get('caz') as MockOptions['caz']) ?? (q.get('stress') === '1' ? 'long' : 'default'),
  stress: q.get('stress') === '1',
  toasts: q.get('toasts') === '1',
  fatal: q.get('fatal'),
  canQuit: q.get('quit') !== '0',
  loading: num('loading'),
  animateLoading: q.get('animate') === '1',
  lastSaveLabel: q.get('lastSave') ?? undefined,
  settings: {
    ...(num('scale') !== undefined ? { uiScale: num('scale') } : {}),
    ...(q.get('motion') === 'reduce' ? { reduceMotion: true } : {}),
    ...(q.get('cb') === '1' ? { colorblindNeeds: true } : {}),
    ...(q.get('quality') ? { quality: q.get('quality') as 'low' } : {}),
  },
};

const game = createMockGame(opts);
(window as unknown as { __game: unknown }).__game = game;

const backdropHost = document.getElementById('backdrop');
const uiHost = document.getElementById('ui');

function Dev() {
  if (view === 'icons' || view === 'components' || view === 'portraits') {
    applyThemeSettings({ uiScale: opts.settings?.uiScale ?? 1, reduceMotion: !!opts.settings?.reduceMotion, colorblindNeeds: !!opts.settings?.colorblindNeeds });
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    return (
      <GameContext.Provider value={game}>
        <div class="ui-root dev-root">{view === 'icons' ? <IconSheet /> : view === 'components' ? <ComponentGallery /> : <PortraitSheet />}</div>
      </GameContext.Provider>
    );
  }
  return <App game={game} />;
}

if (backdropHost && view === 'app') render(<Backdrop variant={screen === 'game' ? 'game' : 'menu'} />, backdropHost);
if (uiHost) render(<Dev />, uiHost);
