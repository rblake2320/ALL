/**
 * Thin wrappers over the controller's command methods (GameController.buyReward / renameHousehold /
 * markNotificationsRead — CONTRACTS decision #16): UI sound + fault containment, so a throwing controller or a
 * missing game never breaks a dialog. The HUD never dispatches to the sim directly.
 */
import type { GameController } from '../../../game/contracts';
import type { CommandResult } from '../../../sim/contracts';

function guard(run: () => CommandResult | void): CommandResult {
  try {
    const r = run();
    if (r === undefined) return { ok: true };
    if (!r || typeof r.ok !== 'boolean') return { ok: false, reason: 'No response' };
    return r;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function buyReward(game: GameController, agentId: string, rewardId: string): CommandResult {
  if (!agentId || !rewardId) return { ok: false, reason: 'Nothing selected' };
  const r = guard(() => game.buyReward(agentId, rewardId));
  game.playUi(r.ok ? 'milestone' : 'uiError');
  return r;
}

export function renameHousehold(game: GameController, name: string): CommandResult {
  const r = guard(() => game.renameHousehold(name));
  game.playUi(r.ok ? 'uiConfirm' : 'uiError');
  return r;
}

export function markNotificationsRead(game: GameController): CommandResult {
  return guard(() => game.markNotificationsRead());
}
