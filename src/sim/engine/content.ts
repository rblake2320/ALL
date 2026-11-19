/**
 * engineContent — the interactions, moodlets and skills the engine itself owns (see README §1).
 */
import type { ContentModule, InteractionDef, MoodletDef, SkillDef } from '../contracts';
import { ENGINE_INTERACTIONS } from '../vocabulary';
import { SKILL_NAMES, SKILL_XP_PER_LEVEL } from './constants';

export const ENGINE_MODULE_ID = 'engine';

/** Engine-internal behaviour keys (only used by engine interactions). */
export const ENGINE_INTERNAL_BEHAVIORS = {
  respond: 'engine_respond',
  passOut: 'engine_passOut',
  exitLot: 'engine_exitLot',
  knock: 'engine_knock',
} as const;

export const ENGINE_MOODLETS = {
  sleptOnFloor: 'sleptOnFloor',
  feralHunger: 'feralHunger',
} as const;

const OPEN = 1e9;

const interactions: InteractionDef[] = [
  {
    id: ENGINE_INTERACTIONS.goHere,
    label: 'Go Here',
    icon: 'sparkle',
    targetKind: 'tile',
    stage: { target: { kind: 'target' }, duration: 0, anim: 'idle' },
    autonomous: false,
    playerAllowed: true,
    menuOrder: 0,
    tags: ['move'],
  },
  {
    id: ENGINE_INTERACTIONS.respond,
    label: 'Listening to {target}',
    icon: 'chat',
    targetKind: 'agent',
    behavior: ENGINE_INTERNAL_BEHAVIORS.respond,
    stage: { target: { kind: 'here' }, duration: OPEN, anim: 'listen' },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    interruptible: true,
    tags: ['social', 'respond'],
  },
  {
    id: ENGINE_INTERACTIONS.passOut,
    label: 'Passed Out',
    icon: 'zzz',
    targetKind: 'self',
    behavior: ENGINE_INTERNAL_BEHAVIORS.passOut,
    stages: [
      { target: { kind: 'here' }, duration: 0.75, anim: 'collapse', expression: 'sleepy', voice: 'groan' },
      {
        target: { kind: 'here' },
        duration: OPEN,
        anim: 'sleep',
        expression: 'sleepy',
        needsPerHour: { energy: 6 },
        stopWhen: { need: 'energy', atLeast: 40 },
        sfxLoop: 'snore',
        bubble: 'zzz',
      },
    ],
    moodletsOnComplete: [{ id: ENGINE_MOODLETS.sleptOnFloor }],
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    interruptible: false,
    tags: ['sleep'],
  },
  {
    // W-025 S3 (DESIGN_WORLD_LEVELS §1.5): offered on the doors of a neighbour's house, never on the home's
    id: ENGINE_INTERACTIONS.knock,
    label: 'Knock',
    icon: 'house',
    targetKind: 'object',
    behavior: ENGINE_INTERNAL_BEHAVIORS.knock,
    stage: { target: { kind: 'target' }, duration: 0.5, anim: 'idle' },
    autonomous: false,
    playerAllowed: true,
    tags: ['social', 'knock'],
  },
  {
    id: ENGINE_INTERACTIONS.exitLot,
    label: 'Leaving',
    icon: 'wave',
    targetKind: 'self',
    behavior: ENGINE_INTERNAL_BEHAVIORS.exitLot,
    stage: { target: { kind: 'exit' }, duration: 0.25, anim: 'idle' },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    interruptible: false,
    tags: ['leave'],
  },
  {
    id: ENGINE_INTERACTIONS.idleStretch,
    label: 'Stretch',
    icon: 'sparkle',
    targetKind: 'self',
    stage: { target: { kind: 'here' }, duration: 0.75, anim: 'stretch' },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    tags: ['idle'],
  },
  {
    id: ENGINE_INTERACTIONS.idleGroan,
    label: 'Groan',
    icon: 'skull',
    targetKind: 'self',
    stage: { target: { kind: 'here' }, duration: 0.75, anim: 'groan', voice: 'groan' },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    tags: ['idle'],
  },
  {
    id: ENGINE_INTERACTIONS.idleWander,
    label: 'Wander',
    icon: 'question',
    targetKind: 'self',
    stage: { target: { kind: 'tileNear', radius: 4, of: 'actor' }, fallback: { kind: 'here' }, duration: 0.5, anim: 'idle' },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    tags: ['idle'],
  },
  {
    id: ENGINE_INTERACTIONS.idlePhone,
    label: 'Check Phone',
    icon: 'phone',
    targetKind: 'self',
    stage: { target: { kind: 'here' }, duration: 3, anim: 'phone', carry: 'phone', needsPerHour: { fun: 4 } },
    requires: [{ id: 'arms', params: { min: 1 } }],
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    tags: ['idle'],
  },
  {
    id: ENGINE_INTERACTIONS.idleYawn,
    label: 'Yawn',
    icon: 'zzz',
    targetKind: 'self',
    stage: { target: { kind: 'here' }, duration: 0.5, anim: 'yawn', sfxStart: 'yawn', voice: 'yawn' },
    autonomous: false,
    playerAllowed: false,
    hidden: true,
    tags: ['idle'],
  },
];

const moodlets: MoodletDef[] = [
  {
    id: ENGINE_MOODLETS.sleptOnFloor,
    label: 'Slept on the Floor',
    description: 'Collapsed where they stood. The floorboards were not kind.',
    mood: -10,
    durationMin: 360,
    maxStacks: 1,
    icon: 'zzz',
    kind: 'bad',
  },
  {
    id: ENGINE_MOODLETS.feralHunger,
    label: 'Feral Hunger',
    description: 'BRAAAINS. All higher functions are suspended until something gets eaten.',
    mood: -10,
    durationMin: null,
    maxStacks: 1,
    icon: 'brain',
    kind: 'bad',
  },
];

const SKILL_ICONS = {
  cooking: 'plate',
  charisma: 'chat',
  mortuary: 'embalm',
  logic: 'chess',
  creativity: 'paint',
  fitness: 'dumbbell',
} as const;

/** Flavour text adopted from SIM-PEOPLE (decision #8: SkillDefs are engine-owned). */
const SKILL_DESCRIPTIONS = {
  cooking: 'The ancient art of making synthetic brains taste less synthetic. Level 10 chefs can flambé without losing eyebrows.',
  charisma: 'Charm that survives the smell. Practised in mirrors, perfected at parties, tested on neighbours.',
  mortuary: 'Embalming, stitching and the general upkeep of the recently-ish deceased. Keeps you fresh and employable.',
  logic: 'Chess, code and cold calculation. A big brain is useful; an intact one is a bonus.',
  creativity: 'Morbid masterpieces in oils and mild formaldehyde. Collectors pay handsomely for a good brooding portrait.',
  fitness: 'Strong joints mean fewer lost limbs. Leg day matters more when your legs are optional.',
} as const;

const skills: SkillDef[] = (Object.keys(SKILL_NAMES) as (keyof typeof SKILL_NAMES)[]).map((id) => ({
  id,
  name: SKILL_NAMES[id],
  description: SKILL_DESCRIPTIONS[id],
  icon: SKILL_ICONS[id],
  xpPerLevel: SKILL_XP_PER_LEVEL.slice(),
}));

export const engineContent: ContentModule = {
  id: ENGINE_MODULE_ID,
  interactions,
  moodlets,
  skills,
};

const IDLE_IDS = new Set<string>([
  ENGINE_INTERACTIONS.idleStretch,
  ENGINE_INTERACTIONS.idleGroan,
  ENGINE_INTERACTIONS.idleWander,
  ENGINE_INTERACTIONS.idlePhone,
  ENGINE_INTERACTIONS.idleYawn,
]);

export function isIdleInteraction(id: string): boolean {
  return IDLE_IDS.has(id);
}
