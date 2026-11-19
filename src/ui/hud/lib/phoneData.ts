/** Builds phone-action availability for the selected zombie from the controller (shared by Career tab + Phone dialog). */
import type { GameController } from '../../../game/contracts';
import { num } from './format';
import { phoneOptions, PARTY_HOST_MIN_FUN, type PhoneAction, type PhoneOption } from './phone';
import { safe } from './safe';

export function phoneOptionsFor(game: GameController, agentId: string | null): Record<PhoneAction, PhoneOption> {
  const sim = game.sim;
  const agent = sim && agentId ? safe('phone.agent', () => sim.agent(agentId), undefined) : undefined;
  const entries = sim && agentId ? safe('phone.menu', () => sim.menu(agentId, { kind: 'self' }), []) : [];
  const household = sim ? safe('phone.household', () => sim.household(), []) : [];
  const canHost = household.some((m) => {
    if (m.presence !== 'onLot') return false;
    const a = safe('phone.host', () => sim?.agent(m.id), undefined);
    return num(a?.needs?.fun) >= PARTY_HOST_MIN_FUN;
  });
  const party = sim ? safe('phone.party', () => sim.party(), null) : null;
  const townies = sim && agentId ? safe('phone.townies', () => sim.townies(agentId), []) : [];
  return phoneOptions(entries, {
    hasCareer: !!agent?.career,
    funds: num(sim?.state.household.funds),
    partyActive: !!party?.active,
    canHost,
    townieCount: townies.length,
    sickDaysUsed: num(agent?.career?.sickDaysUsed),
    atHome: agent ? agent.presence === 'onLot' : false,
  });
}

/** Run a phone action for the selected zombie (UI sound + error containment). */
export function runPhone(game: GameController, action: PhoneAction | 'joinCareer', params?: Record<string, string | number | boolean>): void {
  try {
    game.phone(action === 'joinCareer' ? 'findJob' : action, params);
    game.playUi('uiConfirm');
  } catch {
    game.playUi('uiError');
  }
}
