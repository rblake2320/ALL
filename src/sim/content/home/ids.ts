/**
 * SIM-HOME id vocabulary — every id this module registers or relies on (systems, behaviours, effects,
 * requirements, condition kinds, interactions, moodlets, recipes, stats, flags, object-data keys).
 * Content (src/sim/content/home) and systems (src/sim/systems/home) both import from here so they never drift.
 * Documented in src/sim/systems/home/README.md.
 */

export const HOME_MODULE_ID = 'home';

/** SimSystem ids (cross-module agreement: HOME owns these four). */
export const HOME_SYS = {
  decay: 'decay',
  food: 'food',
  economy: 'economy',
  upkeep: 'upkeep',
} as const;

/** People-owned systems we call through ctx.sys(id) (always tolerating a missing api). */
export const PEOPLE_SYS = {
  townies: 'townies',
  careers: 'careers',
  social: 'social',
} as const;

/** Behaviour keys registered by home systems (globally unique; people uses social/phone/career/visit). */
export const BEH = {
  // decay
  sleep: 'sleep',
  embalm: 'embalm',
  beEmbalmed: 'beEmbalmed',
  stitch: 'stitch',
  beStitched: 'beStitched',
  pickUpLimb: 'pickUpLimb',
  fitProsthetic: 'fitProsthetic',
  reanimate: 'reanimate',
  mourn: 'mourn',
  mirror: 'mirror',
  // food
  cook: 'cook',
  eat: 'eat',
  putAwayLeftovers: 'putAwayLeftovers',
  cleanFridge: 'cleanFridge',
  throwAway: 'throwAway',
  deliverPizza: 'deliverPizza',
  // economy
  payBills: 'payBills',
  checkMail: 'checkMail',
  repossess: 'repossess',
  sellPainting: 'sellPainting',
  // upkeep / leisure
  toggle: 'toggle',
  watchTv: 'watchTv',
  dance: 'dance',
  listen: 'listen',
  read: 'read',
  paint: 'paint',
  sit: 'sit',
  activity: 'activity',
  cleanUp: 'cleanUp',
  clearStuckMess: 'clearStuckMess',
  clearDishes: 'clearDishes',
  wipeDown: 'wipeDown',
  fightFire: 'fightFire',
  repair: 'repair',
  emptyTrash: 'emptyTrash',
  feedPlant: 'feedPlant',
  epitaph: 'epitaph',
  kitReanimate: 'kitReanimate',
} as const;

/** Effect ids registered by home systems (engine effects live in src/sim/vocabulary.ts). */
export const EFF = {
  /** {} — roll ObjectDef.breakChance (× actor traitMult('breakChance')) on the queued target object (else stage object). */
  wear: 'home_wear',
  /** { agentId? } — reanimate a crumbled household member (default: the bone pile target's owner). */
  reanimate: 'home_reanimate',
  /** { limb?: LimbId, agentId? } — knock a limb off (cheats / events). */
  loseLimb: 'home_loseLimb',
  /** { amount, agentId? } — change vitality (clamped 20..100; preservation re-capped). */
  vitality: 'home_vitality',
  /** { objectId?, tag? } — start a fire on an object (target object, explicit id, or a random object with tag). */
  startFire: 'home_startFire',
  /** { count? = 1 } — put letters in the mailbox. */
  addMail: 'home_addMail',
  /** {} — pay every outstanding bill (choice option / debug). */
  payBills: 'home_payBills',
  /** { tag? } — break a random working object (with tag) — "the fridge broke" life event. */
  breakRandom: 'home_breakRandom',
} as const;

/** Requirement ids registered by home systems. All accept `params.reason`. */
export const REQ = {
  /** target fridge has leftover servings */
  hasLeftovers: 'home_hasLeftovers',
  /** target fridge has spoiled leftovers */
  hasSpoiledLeftovers: 'home_hasSpoiledLeftovers',
  /** actor carries a fresh limb that belongs to the actor and is still missing */
  carryingOwnLimb: 'home_carryingOwnLimb',
  /** actor carries a fresh limb belonging to the target agent, still missing on them */
  carryingLimbOfTarget: 'home_carryingLimbOfTarget',
  /** target limb item: { owner: true|false } — actor is (not) its owner */
  limbOwner: 'home_limbOwner',
  /** target limb item is not rotten */
  limbFresh: 'home_limbFresh',
  /** target limb item's owner is on the lot, awake and still missing that limb */
  limbOwnerHere: 'home_limbOwnerHere',
  /** target limb item's owner (actor) is still missing that limb */
  limbStillMissing: 'home_limbStillMissing',
  /** actor has at least one missing limb */
  missingLimb: 'home_missingLimb',
  /** target agent can be embalmed (zombie, on lot, not fully fresh) */
  canBeEmbalmed: 'home_canBeEmbalmed',
  /** a Stitch-n-Mend table or embalming station is on the lot */
  stitchTools: 'home_stitchTools',
  /** target bone pile can still be reanimated (< 72 h) */
  reanimatable: 'home_reanimatable',
  /** some crumbled household member can still be reanimated */
  crumbledMember: 'home_crumbledMember',
  /** at least one unpaid bill */
  billsDue: 'home_billsDue',
  /** { min } target object's condition.dirt >= min */
  dirty: 'home_dirty',
  /** { min } target trash can fill >= min */
  trashFill: 'home_trashFill',
} as const;

/** Condition kinds registered by home systems (aspirations / life events). */
export const COND = {
  /** { min } number of dirty dishes on the lot */
  dishCount: 'home_dishCount',
  /** {} any on-lot zombie is reeking (hygiene 0) */
  anyReeking: 'home_anyReeking',
  /** {} any unpaid bill is past due */
  billsOverdue: 'home_billsOverdue',
  /** {} utilities are cut */
  powerOff: 'home_powerOff',
  /** {} something is burning */
  fireOnLot: 'home_fireOnLot',
  /** { min } household average freshness (living members) */
  avgFreshness: 'home_avgFreshness',
  /** {} the agent (or any household member) is missing a limb */
  missingLimb: 'home_anyMissingLimb',
} as const;

/** Every interaction id defined in content/home/interactions. */
export const IX = {
  // seating / rest
  sit: 'home_sit',
  nap: 'home_nap',
  contemplate: 'home_contemplate',
  sleep: 'home_sleep',
  // surfaces / cleaning
  wipeDown: 'home_wipeDown',
  cleanStove: 'home_cleanStove',
  cleanDish: 'home_cleanDish',
  cleanAsh: 'home_cleanAsh',
  /** W-131 batch: one-step recovery offered only after a recorded failed / no-effect clean on the same target. */
  clearStuckMess: 'home_clearStuckMess',
  /** Owner report: flies over a table that says 'Already spotless' — the flies are the dirty dishes ON it. */
  clearDishes: 'home_clearDishes',
  emptyTrash: 'home_emptyTrash',
  rummageTrash: 'home_rummageTrash',
  repair: 'home_repair',
  // kitchen
  cook: 'home_cook',
  cookAtStove: 'home_cookAtStove',
  grabJerky: 'home_grabJerky',
  eatLeftovers: 'home_eatLeftovers',
  grabSpray: 'home_grabSpray',
  cleanFridge: 'home_cleanFridge',
  microwaveBurrito: 'home_microwaveBurrito',
  brewEspresso: 'home_brewEspresso',
  washHands: 'home_washHands',
  haveServing: 'home_haveServing',
  putAwayLeftovers: 'home_putAwayLeftovers',
  throwAwayFood: 'home_throwAwayFood',
  // bath / preservation / body
  shower: 'home_shower',
  iceBath: 'home_iceBath',
  chillOut: 'home_chillOut',
  selfEmbalm: 'home_selfEmbalm',
  embalmOther: 'home_embalmOther',
  beEmbalmed: 'home_beEmbalmed',
  stitchSelf: 'home_stitchSelf',
  stitchSelfStation: 'home_stitchSelfStation',
  practiceStitch: 'home_practiceStitch',
  stitchOther: 'home_stitchOther',
  beStitched: 'home_beStitched',
  fitProsthetic: 'home_fitProsthetic',
  admireDecay: 'home_admireDecay',
  practiceSpeech: 'home_practiceSpeech',
  checkFreshness: 'home_checkFreshness',
  // limbs / death
  pickUpLimb: 'home_pickUpLimb',
  limbStitch: 'home_limbStitch',
  limbReattachOther: 'home_limbReattachOther',
  throwAwayLimb: 'home_throwAwayLimb',
  reanimate: 'home_reanimate',
  kitReanimate: 'home_kitReanimate',
  readKitManual: 'home_readKitManual',
  mournPile: 'home_mournPile',
  mournUrn: 'home_mournUrn',
  payRespects: 'home_payRespects',
  // leisure
  watchTv: 'home_watchTv',
  stereoToggle: 'home_stereoToggle',
  dance: 'home_dance',
  listenMusic: 'home_listenMusic',
  browseWeb: 'home_browseWeb',
  playVideoGames: 'home_playVideoGames',
  program: 'home_program',
  payBillsOnline: 'home_payBillsOnline',
  playChess: 'home_playChess',
  read: 'home_read',
  paint: 'home_paint',
  sellPainting: 'home_sellPainting',
  admirePainting: 'home_admirePainting',
  workout: 'home_workout',
  playArcade: 'home_playArcade',
  feedPlant: 'home_feedPlant',
  mournFern: 'home_mournFern',
  waterFern: 'home_waterFern',
  readEpitaph: 'home_readEpitaph',
  admirePortrait: 'home_admirePortrait',
  admireRug: 'home_admireRug',
  broodTree: 'home_broodTree',
  watchZapper: 'home_watchZapper',
  sniffDiffuser: 'home_sniffDiffuser',
  gazeWindow: 'home_gazeWindow',
  slamDoor: 'home_slamDoor',
  // household
  payBills: 'home_payBills',
  checkMail: 'home_checkMail',
  toggleLight: 'home_toggleLight',
  fightFire: 'home_fightFire',
  // service NPCs (hidden, system-queued)
  deliverPizza: 'home_deliverPizza',
  repossess: 'home_repossess',
} as const;

/** Every moodlet id defined in content/home/moodlets.ts. */
export const MOOD = {
  // limbs & decay
  lostLimb: 'lostLimb',
  grossedOut: 'grossedOut',
  hilariousLimb: 'hilariousLimb',
  squeamishHorror: 'squeamishHorror',
  butterfingers: 'butterfingers',
  stitchedUp: 'stitchedUp',
  woodenWonder: 'woodenWonder',
  fallingApart: 'fallingApart',
  mourning: 'mourning',
  backFromDead: 'backFromDead',
  freshAsADaisy: 'freshAsADaisy',
  embalmed: 'embalmed',
  coldSoak: 'coldSoak',
  // food
  deliciousMeal: 'deliciousMeal',
  questionableMeal: 'questionableMeal',
  ateStandingUp: 'ateStandingUp',
  familyDinner: 'familyDinner',
  foodPoisoning: 'foodPoisoning',
  caffeinated: 'caffeinated',
  // sleep
  tooFluffy: 'tooFluffy',
  sleptInDirt: 'sleptInDirt',
  wellRested: 'wellRested',
  rudeAwakening: 'rudeAwakening',
  // hygiene / mess / hazards
  reeking: 'reeking',
  stenchNearby: 'stenchNearby',
  faintStench: 'faintStench',
  disgustedByMess: 'disgustedByMess',
  spotless: 'spotless',
  panicking: 'panicking',
  zapped: 'zapped',
  // pets (living-things.md: the benefit of looked-after pets, by care tier)
  petCompanyHalf: 'petCompanyHalf',
  petCompanyFull: 'petCompanyFull',
  // home (furniture set bonuses: the feeling a household starts the day with)
  homeWellInterred: 'homeWellInterred',
  homeCosyParlour: 'homeCosyParlour',
  homeWellFed: 'homeWellFed',
  // money
  powerOut: 'powerOut',
  billsOverdue: 'billsOverdue',
  finalNotice: 'finalNotice',
  repossessed: 'repossessed',
  billsPaid: 'billsPaid',
  paintingSold: 'paintingSold',
  // hobbies & decor
  artisticTriumph: 'artisticTriumph',
  cathartic: 'cathartic',
  proudPlantParent: 'proudPlantParent',
  lookingGood: 'lookingGood',
  mirrorShock: 'mirrorShock',
  ancestralPride: 'ancestralPride',
  paidRespects: 'paidRespects',
  existentialCalm: 'existentialCalm',
  pleasantlyPickled: 'pleasantlyPickled',
  slamCatharsis: 'slamCatharsis',
  infomercialHaze: 'infomercialHaze',
  pumpedUp: 'pumpedUp',
  highScore: 'highScore',
} as const;

/** Recipe ids (content/home/recipes.ts). */
export const RECIPE = {
  brainLoaf: 'brainLoaf',
  brainJerky: 'brainJerky',
  cerebellumStew: 'cerebellumStew',
  frontalLasagna: 'frontalLasagna',
  medullaFlambe: 'medullaFlambe',
  brainBurrito: 'brainBurrito',
  brainPizza: 'brainPizza',
} as const;

/** Recipes offered by Cook… (stove-cooked). */
export const COOKABLE_RECIPES: readonly string[] = [RECIPE.brainLoaf, RECIPE.cerebellumStew, RECIPE.frontalLasagna, RECIPE.medullaFlambe];

/** Interaction / object tags the home systems read. People's trait tagAd keys: cook, clean, mirror, tv, nap,
 *  read, paint, dance, exercise, embalm, eat (src/sim/content/people/traits.ts). */
export const TAG = {
  sleep: 'sleep',
  nap: 'nap',
  strenuous: 'strenuous',
  dance: 'dance',
  exercise: 'exercise',
  cook: 'cook',
  eat: 'eat',
  clean: 'clean',
  mirror: 'mirror',
  tv: 'tv',
  read: 'read',
  paint: 'paint',
  embalm: 'embalm',
  music: 'music',
  handsOn: 'handsOn',
  fire: 'fire',
  repair: 'repair',
  mourn: 'mourn',
  service: 'service',
} as const;

/** Object-data keys written by home systems (ObjectState.data). */
export const DATA = {
  servings: 'servings',
  quality: 'quality',
  recipeId: 'recipeId',
  mealName: 'mealName',
  createdTick: 'createdTick',
  ageMin: 'ageMin',
  spoiled: 'spoiled',
  cookId: 'cookId',
  /** fridge: JSON string `[{s,q,r,a}]` (servings, quality, recipeId, age minutes) */
  leftovers: 'leftovers',
  leftoverServings: 'leftoverServings',
  spoiledServings: 'spoiledServings',
  /** easel 0..1 */
  progress: 'progress',
  artistId: 'artistId',
  /** stereo */
  playing: 'playing',
  /** lamps / candles */
  on: 'on',
  /** mailbox */
  mail: 'mail',
  bills: 'bills',
  flag: 'flag',
  /** trash can */
  fill: 'fill',
  /** dirty items */
  flies: 'flies',
  /** painting item */
  value: 'value',
  title: 'title',
  /** limb item (LimbItemData) */
  limbId: 'limbId',
  ownerId: 'ownerId',
  ownerName: 'ownerName',
  rotten: 'rotten',
  /** bone pile / urn */
  crumbledTick: 'crumbledTick',
  name: 'name',
  /** fire item */
  burningId: 'burningId',
  burnMin: 'burnMin',
  spreadMin: 'spreadMin',
  /** fire: id of the fire event (the original ignition) this fire belongs to — spreads are capped per event */
  fireEvent: 'fireEvent',
  /** plant */
  lastFedTick: 'lastFedTick',
} as const;

/** Stat keys written by home systems (ctx.stat). "both" = global + per agent. */
export const STAT = {
  mealsCooked: 'mealsCooked', // both
  mealsEaten: 'mealsEaten', // both
  limbsLost: 'limbsLost', // both
  limbsReattached: 'limbsReattached', // both
  prosthetics: 'prosthetics', // both
  crumbled: 'crumbled', // global
  reanimations: 'reanimations', // both (actor)
  billsPaid: 'billsPaid', // global
  billsIssued: 'billsIssued', // global
  powerCuts: 'powerCuts', // global
  repossessions: 'repossessions', // global
  paintingsFinished: 'paintingsFinished', // both
  paintingsSold: 'paintingsSold', // both (people aspiration reads per agent)
  embalmedOthers: 'embalmedOthers', // both (people aspiration reads per agent)
  selfEmbalms: 'selfEmbalms', // both
  firesStarted: 'firesStarted', // global
  firesFought: 'firesFought', // both
  objectsBroken: 'objectsBroken', // global
  repairs: 'repairs', // both
  pizzasOrdered: 'pizzasOrdered', // global
  dishesCleaned: 'dishesCleaned', // both
} as const;

/** Keys this module writes into WorldState.flags (all prefixed 'home.'). */
export const FLAG = {
  lastLimbHour: 'home.lastLimbHour',
  lastVitalityDay: 'home.lastVitalityDay',
  lastBillDay: 'home.lastBillDay',
  mail: 'home.mail',
  pizzaDue: 'home.pizza.due',
  pizzaBy: 'home.pizza.by',
  pizzaNpc: 'home.pizza.npc',
  pizzaSpawned: 'home.pizza.spawned',
  pizzaDelivered: 'home.pizza.delivered',
  repoNpc: 'home.repo.npc',
  repoTargets: 'home.repo.targets',
  repoOwed: 'home.repo.owed',
  repoStart: 'home.repo.start',
  repoTaken: 'home.repo.taken',
  powerSeen: 'home.power.seen',
  /** comma list of stereo ids whose music loop is currently on (upkeep/loops.ts) */
  stereoLoops: 'home.stereo.loops',
  /** prefix + fire event id → spreads so far (upkeep/fire.ts; max FIRE_MAX_SPREADS; cleared once every fire is out) */
  fireSpreadsPrefix: 'home.fire.spreads.',
  /** prefix + agent id → tick the zombie was last summoned to fight a fire (re-summon backoff) */
  fireCalledPrefix: 'home.fire.called.',
} as const;

/** Limb item def ids by limb kind. */
export const LIMB_ITEM = { arm: 'item_limb_arm', leg: 'item_limb_leg' } as const;

/** Item def ids spawned by home systems. */
export const ITEM = {
  meal: 'item_meal',
  pizza: 'item_pizza',
  dish: 'item_dish',
  limbArm: 'item_limb_arm',
  limbLeg: 'item_limb_leg',
  bonePile: 'item_bonepile',
  urn: 'item_urn',
  painting: 'item_painting',
  fire: 'item_fire',
  ash: 'item_ash',
} as const;
