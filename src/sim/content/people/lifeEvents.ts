/**
 * People-owned random life events (GDD §13). The `events` system evaluates EVERY LifeEventDef in the registry
 * hourly (any module may contribute defs): condition true → roll hourlyChance → run `effect` or offer `choice`.
 * Cooldowns are declarative through the `eventCooldown` condition; the runner stamps the fire tick.
 */
import type { LifeEventDef } from '../../contracts';
import { COND, EFFECT } from './ids';

/** Extra condition kind registered by the events system: { id, hours } — true when `id` hasn't fired for `hours`. */
export const EVENT_COOLDOWN_KIND = 'eventCooldown';

const and = (...all: { kind: string; params: Record<string, unknown> }[]) => ({ kind: 'and', params: { all } });
const cooldown = (id: string, hours: number) => ({ kind: EVENT_COOLDOWN_KIND, params: { id, hours } });
const mailTime = { kind: COND.clockBetween, params: { from: 9, to: 10 } };
const hasMailbox = { kind: COND.lotHasTag, params: { tag: 'mailbox' } };

export const PEOPLE_LIFE_EVENTS: LifeEventDef[] = [
  {
    id: 'ev_neighbourComplains',
    hourlyChance: 0.3,
    condition: and({ kind: COND.reekingOutdoors, params: {} }, { kind: COND.clockBetween, params: { from: 7, to: 22 } }, cooldown('ev_neighbourComplains', 12)),
    effect: { id: EFFECT.neighbourComplains, params: { friendship: -8 } },
  },
  {
    id: 'ev_lotteryTicket',
    hourlyChance: 0.01,
    condition: and(mailTime, hasMailbox, cooldown('ev_lotteryTicket', 20)),
    effect: { id: EFFECT.lottery, params: { amount: 500 } },
  },
  {
    id: 'ev_fanLetter',
    hourlyChance: 0.1,
    condition: and(mailTime, hasMailbox, { kind: COND.householdHome, params: { min: 1 } }, cooldown('ev_fanLetter', 72)),
    effect: { id: EFFECT.fanLetter, params: { min: 5, max: 25 } },
  },
  {
    id: 'ev_chainLetter',
    hourlyChance: 0.08,
    condition: and(mailTime, hasMailbox, { kind: COND.householdHome, params: { min: 1 } }, cooldown('ev_chainLetter', 96)),
    choice: {
      id: 'ev_chainLetter',
      title: 'A Chain Letter',
      text: '“Forward this to ten acquaintances within one moon or a CURSE shall befall thee.” It is written in what is hopefully red ink. There is a smiley face at the bottom.',
      options: [
        { label: 'Forward it to ten acquaintances', effect: EFFECT.chainLetter, params: { forward: true }, tooltip: 'Curse delegated. The acquaintances may be slightly annoyed.' },
        { label: 'Toss it in the bin', effect: EFFECT.chainLetter, params: { forward: false, safe: true }, tooltip: 'Bold. Possibly cursed. Probably fine.' },
      ],
    },
  },
  {
    id: 'ev_ravenThief',
    hourlyChance: 0.02,
    condition: and({ kind: COND.clockBetween, params: { from: 7, to: 19 } }, { kind: COND.householdHome, params: { min: 1 } }, { kind: 'funds', params: { min: 10 } }, cooldown('ev_ravenThief', 48)),
    effect: { id: EFFECT.ravenThief, params: { min: 10, max: 40 } },
  },
  {
    id: 'ev_graveRobber',
    hourlyChance: 0.04,
    condition: and({ kind: COND.clockBetween, params: { from: 3, to: 4 } }, { kind: COND.noOutdoorLight, params: {} }, cooldown('ev_graveRobber', 72)),
    effect: { id: EFFECT.graveRobber, params: { maxValue: 300 } },
  },
];
