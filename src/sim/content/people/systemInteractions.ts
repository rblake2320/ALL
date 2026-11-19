/**
 * Phone interactions (group 'Phone', targetKind 'self', behaviour 'phone', 5 game minutes) plus the hidden
 * system-only interactions that drive careers and visitors.
 *
 * phone_*  — params.action selects what the `phone` behaviour does on completion; menu children come from
 *            behaviour.choices (townies to invite, careers to join).
 * career_goToWork — queued by `careers` 30 min before a shift at system priority; walks to the lot exit and the
 *            behaviour turns the zombie into presence 'atWork'.
 * visit_*  — queued by `townies` for walk-bys and visitors (behaviour `visit`).
 */
import type { InteractionDef, StageDef } from '../../contracts';
import { BEHAVIOR, CAREER_IDS, PHONE_IDS as P, REQ, VISIT_IDS as V } from './ids';

export const PHONE_MINUTES = 5;

function phoneStage(): StageDef {
  return { target: { kind: 'here' }, duration: PHONE_MINUTES, anim: 'phone', carry: 'phone', sfxStart: 'phoneDial', bubble: 'phone', voice: 'neutral' };
}

function phone(id: string, label: string, action: string, menuOrder: number, extra: Partial<InteractionDef> = {}): InteractionDef {
  return {
    id,
    label,
    group: 'Phone',
    icon: 'phone',
    targetKind: 'self',
    behavior: BEHAVIOR.phone,
    stage: phoneStage(),
    autonomous: false,
    playerAllowed: true,
    tags: ['phone'],
    menuOrder,
    ...extra,
    requires: [{ id: 'household' }, { id: 'arms', params: { min: 1 } }, ...(extra.requires ?? [])],
    params: { action, ...(extra.params ?? {}) },
  };
}

export const PHONE_INTERACTIONS: InteractionDef[] = [
  phone(P.inviteOver, 'Invite Over', 'invite', 1),
  phone(P.throwParty, 'Throw a Party', 'party', 2, {
    icon: 'party',
    requires: [
      { id: 'needAbove', params: { need: 'fun', min: 30, reason: 'Too gloomy to host a party' } },
      { id: REQ.noPartyActive },
    ],
    params: { maxGuests: 6, durationMin: 240 },
  }),
  // Autonomous ONLY as an emergency: advertised like a meal (GDD pizza serving = 50 hunger) so hungry / feral
  // zombies consider it, but the `phone` behaviour's adjustScore vetoes it unless the lot has nothing else to eat
  // (no working fridge or microwave, no meal out), the household can pay and no order went out in the last 3 h.
  phone(P.orderPizza, 'Order Brain Pizza', 'pizza', 3, { icon: 'pizza', autonomous: true, advertise: { hunger: 50 } }),
  phone(P.findJob, 'Get a Job', 'findJob', 4, { icon: 'work', requires: [{ id: REQ.noCareer }] }),
  phone(P.quitJob, 'Quit Job', 'quitJob', 5, { icon: 'work', requires: [{ id: REQ.hasCareer }] }),
  phone(P.callInSick, 'Call in Sick', 'callInSick', 6, {
    icon: 'sad',
    requires: [{ id: REQ.hasCareer }, { id: REQ.sickDayAvailable }],
  }),
];

const HIDDEN_SYSTEM = { hidden: true, autonomous: false, playerAllowed: false } as const;

export const SYSTEM_INTERACTIONS: InteractionDef[] = [
  {
    id: CAREER_IDS.goToWork,
    label: 'Go to Work',
    icon: 'work',
    targetKind: 'self',
    behavior: BEHAVIOR.career,
    stage: { target: { kind: 'exit' }, duration: 0.25, anim: 'wave', bubble: 'work', voice: 'groan' },
    ...HIDDEN_SYSTEM,
    // Player may cancel it from the queue (the carpool honks again; use Call in Sick to really skip work).
    interruptible: true,
    tags: ['work'],
  },
  {
    id: V.walkBy,
    label: 'Strolling By',
    icon: 'wave',
    targetKind: 'tile',
    behavior: BEHAVIOR.visit,
    stage: { target: { kind: 'target' }, duration: 0.25, anim: 'idle' },
    ...HIDDEN_SYSTEM,
    interruptible: true,
    tags: ['visit', 'walkBy'],
    params: { kind: 'walkBy' },
  },
  {
    id: V.linger,
    label: 'Waiting',
    icon: 'question',
    targetKind: 'self',
    behavior: BEHAVIOR.visit,
    // Up to 20 min, but ends a minute after nobody is waving at them any more (see the `visit` behaviour).
    stage: { target: { kind: 'here' }, duration: 20, anim: 'idle', bubble: 'question' },
    ...HIDDEN_SYSTEM,
    interruptible: true,
    tags: ['visit'],
    params: { kind: 'linger' },
  },
  {
    id: V.waitAtDoor,
    label: 'Waiting at the Door',
    icon: 'house',
    targetKind: 'tile',
    behavior: BEHAVIOR.visit,
    // The doorbell is rung by the `visit` behaviour (per-visit ring schedule: every 20 min, max 3), not by a
    // stage sfxStart — a door wait the engine restarts after a social must not ring again straight away.
    stage: {
      target: { kind: 'tileNear', radius: 1.5, of: 'target' },
      fallback: { kind: 'target' },
      duration: 1e9,
      anim: 'idle',
      bubble: 'house',
      voice: 'question',
    },
    ...HIDDEN_SYSTEM,
    interruptible: true,
    tags: ['visit', 'waiting'],
    params: { kind: 'waitAtDoor', ringEveryMin: 20, maxRings: 3 },
  },
  {
    id: V.leave,
    label: 'Heading Home',
    icon: 'wave',
    targetKind: 'self',
    behavior: BEHAVIOR.visit,
    stages: [
      { target: { kind: 'here' }, duration: 0.75, anim: 'wave', bubble: 'wave', voice: 'happy' },
      { target: { kind: 'exit' }, duration: 0.25, anim: 'idle' },
    ],
    ...HIDDEN_SYSTEM,
    interruptible: false,
    tags: ['visit', 'leave'],
    params: { kind: 'leave' },
  },
];
