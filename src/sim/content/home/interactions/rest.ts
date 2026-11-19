/**
 * Seating & sleep. Bed restore rates live in ObjectDef.params (energyPerHour / hygienePerHour are applied by the
 * engine through scaleByObjectParam; preservationPerHour / sleepDecayMult / vitalityPerSleep are applied by the
 * home `decay` system because they depend on power and on the decay model).
 */
import type { InteractionDef } from '../../../contracts';
import { BEH, IX, MOOD, TAG } from '../ids';
import { at, eff, OPEN, req } from './shared';

export const REST_INTERACTIONS: InteractionDef[] = [
  {
    id: IX.sit,
    label: 'Sit',
    icon: 'chat',
    targetKind: 'object',
    behavior: BEH.sit,
    stage: { target: at.target(), duration: 20, anim: 'sit', expression: 'neutral', bubble: 'happy', power: false },
    advertise: { fun: 1 },
    visitorAllowed: true,
    tags: ['seat'],
    menuOrder: 1,
  },
  {
    id: IX.nap,
    label: 'Nap',
    icon: 'zzz',
    targetKind: 'object',
    behavior: BEH.activity,
    stage: {
      target: at.target(),
      duration: 60,
      anim: 'sitTV',
      expression: 'sleepy',
      bubble: 'zzz',
      sfxLoop: 'snore',
      needsPerHour: { energy: 6, fun: 2 },
      power: false,
    },
    advertise: { energy: 6, fun: 2 },
    requires: [req.needBelow('energy', 90, 'Not tired')],
    tags: [TAG.sleep, TAG.nap],
    menuOrder: 2,
    // Autonomy naps only when actually drowsy (Lazy +15 used to nap at energy 89, all day, instead of sleeping).
    params: { funMultKey: 'napFun', autoNeed: 'energy', autoMax: 75, autoUrgency: 0 },
  },
  {
    id: IX.contemplate,
    label: 'Contemplate Mortality',
    icon: 'skull',
    targetKind: 'object',
    behavior: BEH.activity,
    stage: { target: at.target(), duration: 30, anim: 'sit', expression: 'sad', bubble: 'skull', needsPerHour: { fun: 6 }, power: false },
    advertise: { fun: 4 },
    moodletsOnComplete: [{ id: MOOD.existentialCalm }],
    visitorAllowed: true,
    tags: ['seat'],
    menuOrder: 2,
  },
  {
    id: IX.sleep,
    label: 'Sleep',
    icon: 'zzz',
    targetKind: 'object',
    behavior: BEH.sleep,
    stage: {
      target: at.target(),
      duration: OPEN,
      anim: 'sleep',
      expression: 'sleepy',
      bubble: 'zzz',
      sfxLoop: 'snore',
      needsPerHour: { energy: 1, hygiene: 1 },
      scaleByObjectParam: { energy: 'energyPerHour', hygiene: 'hygienePerHour' },
      stopWhen: { need: 'energy', atLeast: 98 },
      power: false,
      effectsOnComplete: [eff.wear()],
    },
    advertise: { energy: 80 },
    requires: [req.needBelow('energy', 95, 'Not tired')],
    interruptible: true,
    tags: [TAG.sleep],
    menuOrder: 1,
  },
];
