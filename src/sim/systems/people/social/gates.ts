/**
 * Social availability gates (GDD §9 "Gate" column). `engineGates` adds the min/max friendship + min romance
 * checks the engine menu already performs (greyed entries); the behaviour re-checks everything at begin and
 * startStage because the world may change while the actor walks over.
 */
import type { InteractionDef, SimContext } from '../../../contracts';
import type { AgentState } from '../../../types';
import { OUTCOME } from '../../../content/people/ids';
import { firstName, flagNum, householdMembers, isCouple, isGuest, isHousehold, isWalker, minutesToTicks, num, partnerOf, peekRel } from '../util';

export const HOUSEHOLD_CAP = 8;

export function checkGates(
  ctx: SimContext,
  actor: AgentState,
  target: AgentState | null | undefined,
  def: InteractionDef,
  opts: { engineGates: boolean },
): true | string {
  const s = def.social;
  if (!s) return 'Not a social interaction';
  if (!target) return 'They’re not here';
  if (target.id === actor.id) return 'Can’t do that to yourself';
  const tName = firstName(target);
  if (target.role === 'service') return `${tName} is on the clock`;
  if (target.presence !== 'onLot') return `${tName} isn’t here`;
  if (actor.presence !== 'onLot') return 'Not here';

  const gate = typeof def.params?.gate === 'string' ? def.params.gate : 'met';
  const rel = peekRel(ctx, actor.id, target.id);
  const walker = isWalker(target);

  switch (gate) {
    case 'feral': {
      // Feral nibble (backlog #14): only a starving (feral) zombie bites, never a passer-by, once per cooldown.
      if (!actor.status?.feral) return `${firstName(actor)} isn’t that hungry`;
      if (walker) return `${tName} is just walking by`;
      const cooldown = minutesToTicks(num(def.params?.cooldownMin, 180));
      if (ctx.state.tick - flagNum(ctx, `nibble:${actor.id}`, -1e12) < cooldown) return 'Still chewing on the last bite';
      break;
    }
    case 'walkBy':
      if (!walker) return `${tName} isn’t walking by`;
      if (!isHousehold(ctx, actor)) return 'Household only';
      break;
    case 'visitorWaiting':
      if (!isGuest(target) || !target.visit) return `${tName} isn’t visiting`;
      if (target.visit.leaving) return `${tName} is leaving`;
      if (target.visit.welcomed) return `${tName} is already inside`;
      break;
    case 'visitor':
      if (!isGuest(target) || !target.visit) return `${tName} isn’t visiting`;
      if (target.visit.leaving) return `${tName} is already leaving`;
      if (s.outcome === OUTCOME.inviteToStay && !target.visit.welcomed) return 'Welcome them in first';
      break;
    case 'notMet':
      if (walker) return 'Wave them over first';
      if (rel.met) return 'Already acquainted';
      break;
    default:
      if (walker) return 'Wave them over first';
      // Friendly small talk doubles as the introduction ("auto first interaction"); the rest needs an introduction.
      if (!rel.met && def.params?.autoIntroduce !== true) return 'You haven’t been introduced';
  }

  // Relationship status gates.
  switch (s.status) {
    case 'notPartnered': {
      if (isCouple(rel)) return 'Already together';
      const pa = partnerOf(ctx, actor.id);
      if (pa && pa !== target.id) return `${firstName(actor)} is already spoken for`;
      const pt = partnerOf(ctx, target.id);
      if (pt && pt !== actor.id) return `${tName} is already spoken for`;
      break;
    }
    case 'partners':
      if (rel.married) return 'Already married';
      if (rel.engaged) return 'Already engaged';
      if (!rel.partners) return 'You need to be partners first';
      break;
    case 'engaged':
      if (rel.married) return 'Already married';
      if (!rel.engaged) return 'You need to be engaged first';
      break;
    case 'married':
      if (!rel.married) return 'Not married';
      break;
    case 'partnersOrMore':
      if (!isCouple(rel)) return 'You’re not a couple';
      break;
    case 'notMarried':
      if (rel.married) return 'Already married';
      break;
    default:
      break;
  }

  // Outcome-specific gates.
  if (s.outcome === OUTCOME.bestFriends && rel.bestFriends) return 'Already best friends';
  if (s.outcome === OUTCOME.moveIn) {
    if (!isHousehold(ctx, actor)) return 'Household only';
    if (isHousehold(ctx, target) || target.role === 'household') return `${tName} already lives here`;
    if (target.role !== 'townie') return `${tName} can’t move in`;
    const minF = num(def.params?.moveInMinFriendship, 50);
    if (!isCouple(rel) && num(rel.friendship, 0) < minF) return `Needs friendship ${minF} or a partner`;
    const cap = num(def.params?.householdCap, HOUSEHOLD_CAP);
    if (householdMembers(ctx).filter((m) => m.presence !== 'gone').length >= cap) return `The crypt is full (${cap} max)`;
  }

  if (opts.engineGates) {
    if (s.minFriendship !== undefined && num(rel.friendship, 0) < s.minFriendship) return `Needs friendship ${s.minFriendship}`;
    if (s.maxFriendship !== undefined && num(rel.friendship, 0) > s.maxFriendship) return 'Too friendly for that';
    if (s.minRomance !== undefined && num(rel.romance, 0) < s.minRomance) return `Needs romance ${s.minRomance}`;
  }
  return true;
}
