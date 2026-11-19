/**
 * UI root. `App({ game })` provides the GameController, applies UI-relevant settings to <html>
 * (--ui-scale, reduce-motion, colour-blind need bars, low-fx), routes screens, hosts the shell dialogs
 * and catches render crashes with a friendly fatal screen (copy diagnostics / emergency save / reload).
 */
import './theme';
import './shell/shell.css';
import './shell/caz.css';
import './shell/dialogs.css';
import { Component, type ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import type { GameController, Screen } from '../game/contracts';
import { GameContext, useGame } from './hooks';
import { applyThemeSettings, watchBrowserZoom } from './theme';
import { Hud } from './hud/Hud';
import { LoadingScreen } from './shell/screens/LoadingScreen';
import { MainMenu } from './shell/screens/MainMenu';
import { NewGameScreen } from './shell/screens/NewGameScreen';
import { CreateZombieScreen } from './shell/screens/CreateZombieScreen';
import { GameOverScreen } from './shell/screens/GameOverScreen';
import { ShellDialogs } from './shell/ShellDialogs';
import { ShellToasts } from './shell/ShellToasts';
import { FatalScreen } from './shell/FatalScreen';
import { StoreLayer } from './store/StoreLayer';
import { FeedbackLayer } from './feedback/FeedbackLayer';
import { UiErrorContext } from './common/Portal';

export function App({ game }: { game: GameController }) {
  return (
    <GameContext.Provider value={game}>
      <ErrorBoundary game={game}>
        <Shell />
      </ErrorBoundary>
    </GameContext.Provider>
  );
}

function ScreenView({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'menu':
      return <MainMenu />;
    case 'newGame':
      return <NewGameScreen />;
    case 'caz':
      return <CreateZombieScreen />;
    case 'game':
      return <Hud />;
    case 'gameOver':
      return <GameOverScreen />;
    case 'boot':
    case 'loading':
    default:
      return <LoadingScreen />;
  }
}

function Shell() {
  const game = useGame();
  const s = game.settings;
  const uiScale = s?.uiScale ?? 1;
  const reduceMotion = !!s?.reduceMotion;
  const colorblind = !!s?.colorblindNeeds;
  // Auto (W-039): the UI's low-fx mode follows the level Auto actually runs at (settings.autoQuality, persisted)
  const quality = s?.quality === 'auto' ? (s.autoQuality === 'unset' ? 'auto' : s.autoQuality) : (s?.quality ?? 'high');
  const language = s?.language ?? 'en';

  useEffect(() => {
    applyThemeSettings({ uiScale, reduceMotion, colorblindNeeds: colorblind, quality });
  }, [uiScale, reduceMotion, colorblind, quality]);
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);
  // browser zoom must scale text fully, not be undone by the window-fit root size (theme/scale.ts)
  useEffect(() => watchBrowserZoom(), []);

  if (game.fatalError) return <FatalScreen game={game} message={game.fatalError} />;

  const screen = game.screen;
  // Loading/boot keep one instance so tips don't restart between 'boot' and 'loading'.
  const key = screen === 'boot' ? 'loading' : screen;
  return (
    <div class="ui-root" data-screen={screen}>
      <div class="sh-screen-host" key={key}>
        <ScreenView screen={screen} />
      </div>
      <ShellDialogs />
      <StoreLayer screen={screen} />
      <FeedbackLayer />
      {/* In game the HUD owns toasts; elsewhere the shell shows them (import/export results, failed loads…). */}
      {screen !== 'game' ? <ShellToasts /> : null}
    </div>
  );
}

interface BoundaryState {
  error: { message: string; stack: string | null } | null;
}

function toBoundaryState(err: unknown): BoundaryState {
  const e = err instanceof Error ? err : new Error(String(err));
  return { error: { message: e.message || String(err), stack: e.stack ?? null } };
}

class ErrorBoundary extends Component<{ game: GameController; children: ComponentChildren }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static override getDerivedStateFromError(err: unknown): BoundaryState {
    return toBoundaryState(err);
  }

  override componentDidCatch(err: unknown) {
    if (typeof console !== 'undefined') console.error('[ui] fatal render error', err);
  }

  /** Overlays (dialogs, tooltips, toasts) render in separate portal trees; their boundaries forward crashes here. */
  private readonly reportOverlayError = (err: unknown) => {
    if (typeof console !== 'undefined') console.error('[ui] fatal render error (overlay)', err);
    if (!this.state.error) this.setState(toBoundaryState(err));
  };

  override render() {
    const { error } = this.state;
    if (error) return <FatalScreen game={this.props.game} message={error.message} stack={error.stack} />;
    return <UiErrorContext.Provider value={this.reportOverlayError}>{this.props.children}</UiErrorContext.Provider>;
  }
}
