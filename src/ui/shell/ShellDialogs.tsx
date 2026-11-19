/**
 * Renders the shell-owned dialogs by `game.dialog`: settings, saveLoad, pause, help, confirmQuit, credits,
 * diagnostics. (phone, careers, invite, rewards, household belong to the HUD.)
 */
import { useEffect } from 'preact/hooks';
import type { DialogId } from '../../game/contracts';
import { useGame } from '../hooks';
import { closeShellDialog, syncNav } from './nav';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { SaveLoadDialog } from './dialogs/SaveLoadDialog';
import { PauseDialog } from './dialogs/PauseDialog';
import { HelpDialog } from './dialogs/HelpDialog';
import { ConfirmQuitDialog } from './dialogs/ConfirmQuitDialog';
import { CreditsDialog } from './dialogs/CreditsDialog';
import { DiagnosticsDialog } from './dialogs/DiagnosticsDialog';

export const SHELL_DIALOGS: readonly Exclude<DialogId, null>[] = ['settings', 'saveLoad', 'pause', 'help', 'confirmQuit', 'credits', 'diagnostics'];

export function isShellDialog(d: DialogId): boolean {
  return d !== null && (SHELL_DIALOGS as readonly string[]).includes(d);
}

export function ShellDialogs() {
  const game = useGame();
  const dialog = game.dialog;
  useEffect(() => syncNav(dialog), [dialog]);
  const onClose = () => closeShellDialog(game);
  switch (dialog) {
    case 'settings':
      return <SettingsDialog onClose={onClose} />;
    case 'saveLoad':
      return <SaveLoadDialog onClose={onClose} />;
    case 'pause':
      return <PauseDialog onClose={onClose} />;
    case 'help':
      return <HelpDialog onClose={onClose} />;
    case 'confirmQuit':
      return <ConfirmQuitDialog onClose={onClose} />;
    case 'credits':
      return <CreditsDialog onClose={onClose} />;
    case 'diagnostics':
      return <DiagnosticsDialog onClose={onClose} />;
    default:
      return null;
  }
}
