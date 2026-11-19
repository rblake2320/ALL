/**
 * Mounts the feedback dialog for `game.dialog === 'feedback'` (one line in App.tsx, like the StoreLayer) and the
 * entry-point helper every menu uses: capture FIRST (screenshot without the dialog), then open the dialog as a child
 * of whatever is open (closing it returns to the pause menu / settings).
 */
import { useState } from 'preact/hooks';
import type { GameController } from '../../game/contracts';
import type { ReportSource } from '../../feedback/schema';
import { useGame } from '../hooks';
import { closeShellDialog, openChildDialog, openRootDialog } from '../shell/nav';
import { FeedbackDialog } from './FeedbackDialog';

export function canReport(game: Pick<GameController, 'feedback'>): boolean {
  return !!game.feedback;
}

/** Entry points (pause menu, Settings → Help, main menu). */
export function openFeedback(game: GameController, source: ReportSource): void {
  const fb = game.feedback;
  if (!fb) return;
  try {
    fb.capture(source);
  } catch {
    return;
  }
  if (game.dialog) openChildDialog(game, 'feedback');
  else openRootDialog(game, 'feedback');
}

export function FeedbackLayer() {
  const game = useGame();
  const fb = game.feedback ?? null;
  const open = game.dialog === 'feedback' && !!fb;
  return open && fb ? <FeedbackHost game={game} /> : null;
}

function FeedbackHost({ game }: { game: GameController }) {
  const fb = game.feedback!;
  // Opened some other way (a test, a future caller) without a capture: capture now, once.
  useState(() => (fb.draft ? null : fb.capture('menu')));
  return <FeedbackDialog service={fb} onClose={() => closeShellDialog(game)} />;
}
