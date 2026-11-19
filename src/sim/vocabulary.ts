/**
 * ENGINE-PROVIDED VOCABULARY — ids that SIM-ENGINE guarantees to implement, so content/systems authors
 * can reference them while the engine is being written. Domain modules add their own ids via SimSystem.
 * Placeholders in notify text: {actor} {target} {object} {amount}.
 */

/** Generic effects implemented by the engine. Param shapes documented inline. */
export const ENGINE_EFFECTS = {
  /** { deltas: Partial<Record<NeedId, number>>, who?: 'actor'|'target', raw?: boolean } */
  needs: 'needs',
  /** { id: MoodletId, who?: 'actor'|'target'|'both', chance?: number, durationMin?: number } */
  moodlet: 'moodlet',
  /** { id: MoodletId, who?: 'actor'|'target'|'both' } */
  removeMoodlet: 'removeMoodlet',
  /** { skill: SkillId, amount: number, who?: 'actor'|'target' } */
  xp: 'xp',
  /** { amount: number, reason: string } — on insufficient funds the interaction FAILS with "Can't afford". Idempotent per run+stage. */
  spend: 'spend',
  /** { amount: number, reason: string } — idempotent per run+stage. */
  earn: 'earn',
  /** { kind: NotificationKind, title: string, text: string } */
  notify: 'notify',
  /** { icon: BubbleIcon, style?: 'thought'|'speech'|'shout', who?: 'actor'|'target' } */
  bubble: 'bubble',
  /** { kind: FxKind, who?: 'actor'|'target'|'object' } */
  fx: 'fx',
  /** { id: SfxId } */
  sfx: 'sfx',
  /** { emotion: VoiceEmotion, who?: 'actor'|'target', durationMs?: number } */
  voice: 'voice',
  /** { defId: ObjectDefId, at: 'actorSurface'|'targetSurface'|'actorFloor'|'targetFloor'|'held', data?: Record<string, json> } */
  spawnItem: 'spawnItem',
  /** {} — delete the stage's target object */
  removeTarget: 'removeTarget',
  /** { to: 'destroy'|'floor'|'surface' } */
  releaseHeld: 'releaseHeld',
  /** {} — pick up the stage's target loose item into the actor's hand */
  holdTarget: 'holdTarget',
  /** { key: string, value: json } */
  setTargetData: 'setTargetData',
  /** { key: string, amount: number } */
  incTargetData: 'incTargetData',
  /** { chance: number } — target object may break (notification) */
  breakChance: 'breakChance',
  /** {} — fix target object */
  repair: 'repair',
  /** { key: string, amount?: number, perAgent?: boolean } */
  stat: 'stat',
  /** { item: CarryItem | null } — visual carry only */
  carry: 'carry',
  /** {} — target object's dirt = 0 */
  clearDirt: 'clearDirt',
  /** { interactionId, target: 'self'|'stageTarget'|'queuedTarget', source?: QueueSource, front?: boolean } */
  queue: 'queue',
  /** { presence: Presence } — walk off the lot then despawn */
  leaveLot: 'leaveLot',
} as const;

/** Generic requirements implemented by the engine. */
export const ENGINE_REQUIREMENTS = {
  /** {} — utilities on AND target object (if it needs power) not broken */
  power: 'power',
  notBroken: 'notBroken',
  broken: 'broken',
  /** { skill: SkillId, min: number } */
  skill: 'skill',
  /** { min: number } */
  funds: 'funds',
  /** { min: number } functional arms (ok|prosthetic) */
  arms: 'arms',
  /** { min: number } */
  legs: 'legs',
  /** { tag: string } some usable (not broken) object with the tag is on the lot */
  tagOnLot: 'tagOnLot',
  /** { id: TraitId } */
  trait: 'trait',
  notTrait: 'notTrait',
  household: 'household',
  targetHousehold: 'targetHousehold',
  targetNotHousehold: 'targetNotHousehold',
  targetVisitor: 'targetVisitor',
  targetWalkBy: 'targetWalkBy',
  /** { need: NeedId, max: number } */
  needBelow: 'needBelow',
  /** { need: NeedId, min: number } */
  needAbove: 'needAbove',
  outdoors: 'outdoors',
  indoors: 'indoors',
  notCarrying: 'notCarrying',
  /** { item?: CarryItem } */
  carrying: 'carrying',
  /** { key: string, equals?: json, min?: number, max?: number, truthy?: boolean } on target object data */
  targetData: 'targetData',
  /** { from: hour, to: hour } (wraps midnight) */
  hourBetween: 'hourBetween',
  notSelf: 'notSelf',
  targetOnLot: 'targetOnLot',
  /** target agent not asleep/passed out/away */
  targetAwake: 'targetAwake',
} as const;

/** Interactions the engine itself registers (content may reference them). */
export const ENGINE_INTERACTIONS = {
  goHere: 'engine_goHere',
  /** Hidden partner half of every agent-target social: target stops, faces actor, plays social.targetAnim. */
  respond: 'engine_respond',
  passOut: 'engine_passOut',
  /** params: { presence } — walk to exit and despawn. */
  exitLot: 'engine_exitLot',
  idleStretch: 'engine_idle_stretch',
  idleGroan: 'engine_idle_groan',
  idleWander: 'engine_idle_wander',
  idlePhone: 'engine_idle_phone',
  idleYawn: 'engine_idle_yawn',
  /** W-025 S3: knock on a neighbour's door (target: the door); an answered knock welcomes the knocker for 2 h. */
  knock: 'engine_knock',
} as const;

/** Behaviour keys the engine registers. Domain behaviours (social, cook, eat, goToWork, phone...) come from systems. */
export const ENGINE_BEHAVIORS = { standard: 'standard' } as const;

/** Queue priorities. */
export const PRIORITY = { auto: 100, player: 200, system: 300, critical: 400 } as const;
