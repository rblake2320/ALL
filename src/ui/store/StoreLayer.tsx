/**
 * Everything economy-related the shell mounts (one line in App.tsx): the Store dialog (dialog id 'store'), the
 * first-run age gate over the main menu, and the in-game economy HUD.
 */
import { useState } from 'preact/hooks';
import type { Screen } from '../../game/contracts';
import { useGame } from '../hooks';
import { StoreDialog } from './StoreDialog';
import { AgeGateDialog } from './AgeGate';
import { EconomyHud } from './EconomyHud';
import { useEconomy } from './useEconomy';

export function StoreLayer({ screen }: { screen: Screen }) {
  const game = useGame();
  const econ = useEconomy();
  const [gateDismissed, setGateDismissed] = useState(false);
  if (!econ) return null;
  const storeOpen = (game.dialog as string) === 'store';
  const showGate = screen === 'menu' && econ.needsAgeGate && !gateDismissed && game.dialog === null;
  return (
    <>
      {screen === 'game' ? <EconomyHud /> : null}
      {storeOpen ? <StoreDialog onClose={() => game.closeDialog()} /> : null}
      {showGate ? <AgeGateDialog econ={econ} onClose={() => setGateDismissed(true)} /> : null}
    </>
  );
}
