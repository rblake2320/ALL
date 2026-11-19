/** Engine-side relationship gates for social interactions (SocialDef min/max/status). */
import type { InteractionDef } from '../contracts';
import type { AgentState } from '../types';
import { peekRel } from './context';
import type { Engine } from './types';
import { isNum } from './util';

export type GateResult = { ok: true } | { ok: false; reason: string; /** status gates hide the entry, thresholds grey it out */ hide: boolean };

export function socialGate(eng: Engine, actor: AgentState, target: AgentState, def: InteractionDef): GateResult {
  const s = def.social;
  if (!s) return { ok: true };
  const r = peekRel(eng, actor.id, target.id);
  const status = s.status ?? 'any';
  const together = r.partners || r.engaged || r.married;
  let statusOk = true;
  switch (status) {
    case 'notPartnered':
      statusOk = !together;
      break;
    case 'partners':
      statusOk = r.partners;
      break;
    case 'engaged':
      statusOk = r.engaged;
      break;
    case 'married':
      statusOk = r.married;
      break;
    case 'partnersOrMore':
      statusOk = together;
      break;
    case 'notMarried':
      statusOk = !r.married;
      break;
    default:
      statusOk = true;
  }
  if (!statusOk) return { ok: false, reason: 'Not the right time for that', hide: true };
  if (isNum(s.minFriendship) && r.friendship < s.minFriendship) return { ok: false, reason: 'Not close enough yet', hide: false };
  if (isNum(s.maxFriendship) && r.friendship > s.maxFriendship) return { ok: false, reason: 'You get along too well for that', hide: false };
  if (isNum(s.minRomance) && r.romance < s.minRomance) return { ok: false, reason: 'Not enough romance yet', hide: false };
  return { ok: true };
}
