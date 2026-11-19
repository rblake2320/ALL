/**
 * Household chores & hazards: mailbox, lights, fire fighting, plus the hidden service-NPC interactions
 * (pizza delivery, repossession) that home systems queue on the ghouls they spawn.
 */
import type { InteractionDef } from '../../../contracts';
import { BEH, IX, REQ, TAG } from '../ids';
import { at, req } from './shared';

export const HOUSEHOLD_INTERACTIONS: InteractionDef[] = [
  {
    id: IX.payBills,
    label: 'Pay Bills',
    icon: 'money',
    targetKind: 'object',
    behavior: BEH.payBills,
    stage: { target: at.target(['use']), duration: 5, anim: 'read', expression: 'focused', sfxStart: 'mailbox', bubble: 'money', power: false },
    // Autonomous only when a bill is due within 24 h / overdue and affordable (economy payBills.adjustScore). The
    // adBonus only gets it into the engine's candidate pool (pre-scores ≤ 0 or below the idle bar are never adjusted).
    adBonus: 14,
    requires: [req.home(REQ.billsDue)],
    tags: ['money'],
    menuOrder: 1,
  },
  {
    id: IX.checkMail,
    label: 'Check Mail',
    icon: 'mail',
    targetKind: 'object',
    behavior: BEH.checkMail,
    stage: { target: at.target(['use']), duration: 2, anim: 'read', expression: 'neutral', sfxStart: 'mailbox', bubble: 'mail', power: false },
    advertise: { fun: 1 },
    adBonus: 6, // gated in adjustScore (letters waiting)
    tags: ['mail'],
    menuOrder: 2,
  },
  {
    id: IX.toggleLight,
    label: 'Turn Off',
    icon: 'lightning',
    targetKind: 'object',
    behavior: BEH.toggle,
    stage: { target: at.nearTarget(1.6), duration: 0.5, anim: 'pickup', expression: 'neutral', sfxStart: 'uiToggle', power: false },
    autonomous: false,
    tags: ['light'],
    menuOrder: 1,
    params: { key: 'on', defaultOn: true, onLabel: 'Turn Off', offLabel: 'Turn On', candleOnLabel: 'Snuff Out', candleOffLabel: 'Light' },
  },
  {
    id: IX.fightFire,
    label: 'Fight Fire',
    icon: 'fire',
    targetKind: 'object',
    behavior: BEH.fightFire,
    stage: {
      target: at.target(['fight']),
      fallback: at.nearTarget(2),
      duration: 20,
      anim: 'clean',
      expression: 'shocked',
      sfxLoop: 'extinguish',
      bubble: 'fire',
      voice: 'scream',
      power: false,
    },
    adBonus: 60,
    tags: [TAG.fire],
    menuOrder: 1,
  },

  // ─────────────── service NPCs (hidden) ───────────────
  {
    id: IX.deliverPizza,
    label: 'Delivering Pizza',
    icon: 'pizza',
    targetKind: 'tile',
    behavior: BEH.deliverPizza,
    stage: {
      target: at.target(),
      duration: 2,
      anim: 'pickup',
      expression: 'happy',
      carry: 'pizza',
      sfxStart: 'pizzaArrive',
      bubble: 'pizza',
      voice: 'happy',
      power: false,
    },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    interruptible: false,
    tags: [TAG.service],
  },
  {
    id: IX.repossess,
    label: 'Repossessing',
    icon: 'money',
    targetKind: 'object',
    behavior: BEH.repossess,
    stage: { target: at.nearTarget(2.5), duration: 3, anim: 'pickup', expression: 'neutral', sfxStart: 'repoGhoul', bubble: 'money', power: false },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    interruptible: false,
    tags: [TAG.service],
  },
];
