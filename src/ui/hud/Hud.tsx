/**
 * Hud() — the in-game HUD, mounted by App on the 'game' screen (inside the shell's `.ui-root`, under GameContext).
 * Adapts to game.mode (live / buy / build) and renders the HUD-owned dialogs (phone, careers, invite, rewards,
 * household). Every region sits in its own error boundary so a failing view never takes the HUD down.
 */
import { useEffect, useRef } from 'preact/hooks';
import { preloadCastArt, usedCastBodies } from '../common/castArtCache';
import type { GameController } from '../../game/contracts';
import { AgentPanel } from './agent/AgentPanel';
import { BubbleLayer } from './bubbles/BubbleLayer';
import { BuildTools } from './build/BuildTools';
import { BuyCatalog } from './buy/BuyCatalog';
import { PlacementBar } from './buy/PlacementBar';
import { ChoicePopup } from './choice/ChoicePopup';
import { CareersDialog } from './dialogs/CareersDialog';
import { HomeServiceDialog } from './dialogs/HomeServiceDialog';
import { HouseholdDialog } from './dialogs/HouseholdDialog';
import { InviteDialog } from './dialogs/InviteDialog';
import { PhoneDialog } from './dialogs/PhoneDialog';
import { RewardsDialog } from './dialogs/RewardsDialog';
import { HouseholdBar } from './household/HouseholdBar';
import { usePhoneLayout } from './lib/phoneLayout';
import { useHudStore } from './lib/store';
import { InteractionMenu } from './menu/InteractionMenu';
import { NotificationLog } from './notify/NotificationLog';
import { Toasts } from './notify/Toasts';
import { CursorLabel } from './overlay/CursorLabel';
import { FpsOverlay } from './overlay/FpsOverlay';
import { HintBubble } from './overlay/HintBubble';
import { PlacementAnnouncer } from './overlay/PlacementAnnouncer';
import { StoryGuide } from './overlay/StoryGuide';
import { Guard } from './parts/Guard';
import { useHudKeyboard } from './parts/keynav';
import { remPx, useGame, useViewport } from './parts/hooks';
import { TooltipLayer } from './parts/tooltip';
import { PartyHud } from './party/PartyHud';
import { ActionQueue } from './queue/ActionQueue';
import { TopBar, type Tier } from './topbar/TopBar';
import './hud.css';
import './phone.css';

/**
 * Width tiers (in rem, so they follow the shell's viewport + UI-scale sizing). Measured top-bar needs:
 * normal ≈ 78rem (labelled mode tabs), compact ≈ 70rem (icon tabs), tight drops camera buttons + day line.
 */
export function hudTier(viewportPx: number, rem: number): Tier {
  const w = Number.isFinite(viewportPx) && Number.isFinite(rem) && rem > 0 ? viewportPx / rem : 120;
  return w < 72 ? 'tight' : w < 81 ? 'compact' : 'normal';
}

/** Comma-joined cast bodies of the household + everyone on the lot ('' = none). Never throws. */
export function castBodiesKey(sim: GameController['sim']): string {
  if (!sim) return '';
  try {
    const apps = [...sim.household(), ...sim.onLotSummaries()].map((a) => a?.appearance);
    return usedCastBodies(apps).join(',');
  } catch {
    return '';
  }
}

export function Hud() {
  const game = useGame();
  const ui = useHudStore();
  const root = useRef<HTMLDivElement>(null);
  const vp = useViewport();
  // F6 cycles HUD regions; Tab moves between HUD controls while one has keyboard focus (parts/keynav.ts).
  useHudKeyboard(root);
  // Phone mode (W-114, lib/phoneLayout.ts): mirrored onto <html> while the HUD is mounted, so the root size, the
  // shell's in-game dialogs and the economy HUD (outside .hud) follow it too.
  const { phone, orient } = usePhoneLayout();
  useEffect(() => {
    const html = typeof document !== 'undefined' ? document.documentElement : null;
    if (!html) return undefined;
    if (phone) {
      html.setAttribute('data-phone', '');
      html.setAttribute('data-orient', orient);
    } else {
      html.removeAttribute('data-phone');
      html.removeAttribute('data-orient');
    }
    return () => {
      html.removeAttribute('data-phone');
      html.removeAttribute('data-orient');
    };
  }, [phone, orient]);
  const tier = hudTier(vp.w, remPx());
  // Offline play (W-050): cache the cast thumbnails this world shows (household + zombies on the lot) while online
  const castKey = castBodiesKey(game.sim);
  useEffect(() => {
    if (castKey) void preloadCastArt(castKey.split(','));
  }, [castKey]);
  if (!game.sim) return null;
  const mode = game.mode;
  const live = mode === 'live';
  return (
    <div ref={root} class={`hud hud--${mode}`} data-tier={tier} data-hud="" data-phone={phone ? '' : undefined} data-orient={phone ? orient : undefined}>
      <Guard name="topbar">
        <TopBar tier={tier} phone={phone} />
      </Guard>
      {live && (
        <>
          <Guard name="bubbles">
            <BubbleLayer />
          </Guard>
          <Guard name="household">
            <HouseholdBar />
          </Guard>
          <Guard name="agent">
            <AgentPanel />
          </Guard>
          <Guard name="queue">
            <ActionQueue tier={tier} phone={phone ? orient : null} />
          </Guard>
        </>
      )}
      <div class="hud-topcenter" data-hud-region="50">
        {live && (
          <Guard name="party">
            <PartyHud />
          </Guard>
        )}
        <Guard name="choice">
          <ChoicePopup />
        </Guard>
      </div>
      {!ui.logOpen && (
        <Guard name="toasts">
          <Toasts />
        </Guard>
      )}
      <Guard name="log">
        <NotificationLog />
      </Guard>
      {mode === 'buy' && (
        <Guard name="buy">
          <BuyCatalog />
        </Guard>
      )}
      {mode === 'buy' && (
        <Guard name="placement-bar">
          <PlacementBar />
        </Guard>
      )}
      {mode === 'build' && (
        <Guard name="build">
          <BuildTools />
        </Guard>
      )}
      {!live && (
        <Guard name="cursor">
          <CursorLabel />
        </Guard>
      )}
      {/* always mounted: a live region must exist before its first message (startPlacing also switches to Buy) */}
      <Guard name="placement-live">
        <PlacementAnnouncer />
      </Guard>
      {live && game.menu && (
        <Guard name="menu">
          <InteractionMenu />
        </Guard>
      )}
      <Guard name="hint">
        <HintBubble />
      </Guard>
      <Guard name="story-guide">
        <StoryGuide />
      </Guard>
      {game.settings?.showFps && (
        <Guard name="fps">
          <FpsOverlay />
        </Guard>
      )}
      <Guard name="dialogs">
        <HudDialogs game={game} />
      </Guard>
      <TooltipLayer scope={root} />
    </div>
  );
}

/** The dialogs the HUD owns; every other DialogId is rendered by the shell. */
export const HUD_DIALOGS = ['phone', 'careers', 'invite', 'rewards', 'household', 'homeService'] as const;

function HudDialogs({ game }: { game: GameController }) {
  switch (game.dialog) {
    case 'phone':
      return <PhoneDialog />;
    case 'careers':
      return <CareersDialog />;
    case 'invite':
      return <InviteDialog />;
    case 'rewards':
      return <RewardsDialog />;
    case 'household':
      return <HouseholdDialog />;
    case 'homeService':
      return <HomeServiceDialog />;
    default:
      return null;
  }
}

export default Hud;
