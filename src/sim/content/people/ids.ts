/**
 * SIM-PEOPLE id vocabulary — every id this module registers (systems, behaviours, effects, requirements,
 * condition kinds, moodlets, stats, flags). Content and systems both import from here so they can never drift.
 * Documented in src/sim/systems/people/README.md.
 */

export const PEOPLE_MODULE_ID = 'people';

/** SimSystem ids (cross-module agreement: PEOPLE owns these five). */
export const SYS = {
  social: 'social',
  careers: 'careers',
  townies: 'townies',
  aspirations: 'aspirations',
  events: 'events',
} as const;

/** Systems owned by SIM-HOME that we call through ctx.sys(id) (always tolerating a missing api). */
export const HOME_SYS = {
  food: 'food',
  decay: 'decay',
  economy: 'economy',
  upkeep: 'upkeep',
} as const;

/** Behaviour keys registered by people systems. */
export const BEHAVIOR = {
  social: 'social',
  phone: 'phone',
  career: 'career',
  visit: 'visit',
} as const;

/** Effect ids registered by people systems (engine effects live in src/sim/vocabulary.ts). */
export const EFFECT = {
  /** Work-event option: { perf?, funds?, hunger?, energy?, fun?, social?, hygiene?, preservation?, xp?, moodlet?,
   *  text?, chance?, failPerf?, failFunds?, failMoodlet?, failText?, agentId? } */
  careerChoice: 'careerChoice',
  /** Consumable reward: { amount } — vitality (+ preservation headroom) for the actor, max 100. */
  addVitality: 'addVitality',
  neighbourComplains: 'event_neighbourComplains',
  lottery: 'event_lottery',
  fanLetter: 'event_fanLetter',
  /** Choice option: { forward: boolean } */
  chainLetter: 'event_chainLetter',
  ravenThief: 'event_ravenThief',
  graveRobber: 'event_graveRobber',
} as const;

/** Requirement ids registered by people systems. */
export const REQ = {
  hasCareer: 'hasCareer',
  noCareer: 'noCareer',
  sickDayAvailable: 'sickDayAvailable',
  noPartyActive: 'noPartyActive',
} as const;

/**
 * Condition kinds registered by people systems. The engine already provides `funds {min}`, `skill {skill,min}`,
 * `stat {key,min,perAgent?}`, `and/or/not`, `always/never`, `moodlet`, `trait`, `flag` — we reuse those.
 */
export const COND = {
  /** { min } — agent's career level (0 = unemployed). */
  careerLevel: 'careerLevel',
  /** { min, minFriendship? = 35 } — number of met agents with friendship >= minFriendship (or bestFriends). */
  friends: 'friends',
  /** { flag: 'kissed'|'partners'|'engaged'|'married'|'bestFriends' } — ever (kissed) / currently (others). */
  relationshipFlag: 'relationshipFlag',
  /** { min } — highest romance with anyone. */
  romanceMax: 'romanceMax',
  /** { count, level } — number of skills at >= level. */
  skillsAtLevel: 'skillsAtLevel',
  /** { days, min? = 70 } — consecutive days the household's average freshness stayed >= min. */
  freshStreak: 'freshStreak',
  /** { from, to } hours, wraps midnight; from === to = always. */
  clockBetween: 'clockBetween',
  /** { tag, min? = 1 } — non-broken objects with the tag on the lot. */
  lotHasTag: 'lotHasTag',
  /** {} — no working light stands outdoors (lantern posts etc.). */
  noOutdoorLight: 'noOutdoorLight',
  /** {} — an on-lot household member with hygiene 0 is outdoors. */
  reekingOutdoors: 'reekingOutdoors',
  /** { min? = 1 } — household members on the lot. */
  householdHome: 'householdHome',
} as const;

export const SOCIAL_IDS = {
  introduce: 'social_introduce',
  chat: 'social_chat',
  joke: 'social_joke',
  complimentRot: 'social_complimentRot',
  gossip: 'social_gossip',
  shareRecipe: 'social_shareRecipe',
  hug: 'social_hug',
  bestFriends: 'social_bestFriends',
  playfulBite: 'social_playfulBite',
  flirt: 'social_flirt',
  complimentSmell: 'social_complimentSmell',
  slowDance: 'social_slowDance',
  kiss: 'social_kiss',
  askPartner: 'social_askPartner',
  propose: 'social_propose',
  elope: 'social_elope',
  moveIn: 'social_moveIn',
  breakUp: 'social_breakUp',
  argue: 'social_argue',
  insultDecay: 'social_insultDecay',
  askToLeave: 'social_askToLeave',
  inviteStay: 'social_inviteStay',
  welcome: 'social_welcome',
  waveOver: 'social_waveOver',
} as const;

/**
 * Hidden socials outside the GDD §9 table (never in menus). `social_feralNibble` (GDD §3, backlog #14): a feral
 * zombie with no reachable food bites a housemate/guest — picked only by the engine's feral override.
 */
export const CRITICAL_SOCIAL_IDS = {
  feralNibble: 'social_feralNibble',
} as const;

export const PHONE_IDS = {
  inviteOver: 'phone_inviteOver',
  throwParty: 'phone_throwParty',
  orderPizza: 'phone_orderPizza',
  findJob: 'phone_findJob',
  quitJob: 'phone_quitJob',
  callInSick: 'phone_callInSick',
} as const;

export const CAREER_IDS = {
  goToWork: 'career_goToWork',
} as const;

export const VISIT_IDS = {
  walkBy: 'visit_walkBy',
  linger: 'visit_linger',
  waitAtDoor: 'visit_waitAtDoor',
  leave: 'visit_leave',
} as const;

/** Social special outcomes (SocialDef.outcome). */
export const OUTCOME = {
  introduce: 'introduce',
  becomePartners: 'becomePartners',
  propose: 'propose',
  marry: 'marry',
  moveIn: 'moveIn',
  breakUp: 'breakUp',
  askToLeave: 'askToLeave',
  inviteToStay: 'inviteToStay',
  welcome: 'welcome',
  waveOver: 'waveOver',
  bite: 'bite',
  bestFriends: 'bestFriends',
  feralNibble: 'feralNibble',
} as const;

/** Every moodlet id defined in content/people/moodlets.ts. */
export const MOODLET = {
  // careers
  promoted: 'promoted',
  fired: 'fired',
  newJob: 'newJob',
  quitJob: 'quitJob',
  firstDayJitters: 'firstDayJitters',
  goodDayAtWork: 'goodDayAtWork',
  badDayAtWork: 'badDayAtWork',
  workedLate: 'workedLate',
  playingHooky: 'playingHooky',
  officeHero: 'officeHero',
  officeShame: 'officeShame',
  // romance
  lovesick: 'lovesick',
  smitten: 'smitten',
  firstKiss: 'firstKiss',
  itsOfficial: 'itsOfficial',
  engaged: 'engaged',
  newlyweds: 'newlyweds',
  rejected: 'rejected',
  heartbroken: 'heartbroken',
  // friendly / mean
  socialHigh: 'socialHigh',
  lonely: 'lonely',
  flattered: 'flattered',
  laughedTooHard: 'laughedTooHard',
  juicyGossip: 'juicyGossip',
  warmHug: 'warmHug',
  bestFriendsForever: 'bestFriendsForever',
  nibbled: 'nibbled',
  bitten: 'bitten',
  chewedOn: 'chewedOn',
  feralRemorse: 'feralRemorse',
  embarrassed: 'embarrassed',
  awkward: 'awkward',
  offended: 'offended',
  furious: 'furious',
  smellShamed: 'smellShamed',
  newRoommate: 'newRoommate',
  movedIn: 'movedIn',
  // parties & visitors
  legendaryParty: 'legendaryParty',
  lameParty: 'lameParty',
  goodHost: 'goodHost',
  // trait/time conditions (applied through moodModifiers, never added as instances)
  nightOwlNight: 'nightOwlNight',
  nightOwlDay: 'nightOwlDay',
  vainFresh: 'vainFresh',
  vainRotten: 'vainRotten',
  crowded: 'crowded',
  inTheirElement: 'inTheirElement',
  // life events
  moonstruck: 'moonstruck',
  fanMail: 'fanMail',
  cursedChainLetter: 'cursedChainLetter',
  chainLetterSpread: 'chainLetterSpread',
  outwittedByBird: 'outwittedByBird',
  robbed: 'robbed',
  lotteryWinner: 'lotteryWinner',
  secondWind: 'secondWind',
} as const;

/** Stat keys written by people systems (ctx.stat). Per-agent where noted. */
export const STAT = {
  partiesThrown: 'partiesThrown', // global + per host
  legendaryParties: 'legendaryParties', // global + per host
  lameParties: 'lameParties', // global + per host
  kisses: 'kisses', // per agent (both participants)
  marriages: 'marriages', // global + per agent
  breakUps: 'breakUps', // global
  socials: 'socials', // per agent (actor)
  townsfolkMet: 'townsfolkMet', // per agent (household member who introduced themselves to a townie)
  promotions: 'promotions', // global + per agent
  firings: 'firings', // global + per agent
  shiftsWorked: 'shiftsWorked', // global + per agent
  shiftsMissed: 'shiftsMissed', // per agent
  wagesEarned: 'wagesEarned', // global + per agent
  townieVisits: 'townieVisits', // global
  movedIn: 'movedIn', // global
  milestones: 'milestones', // per agent
  lifeEvents: 'lifeEvents', // global
  feralNibbles: 'feralNibbles', // global + per agent (the biter)
} as const;

/**
 * Stat keys written by SIM-HOME that our aspiration milestones read. Our conditions accept either the per-agent
 * or the global counter (see README) so a naming mismatch degrades to "global" instead of "never".
 */
export const HOME_STAT = {
  paintingsSold: 'paintingsSold',
  embalmedOthers: 'embalmedOthers',
} as const;

/** Prefix for every key this module writes into WorldState.flags. */
export const FLAG_PREFIX = 'people:';

/** Moodlet tag marking modifier-only moodlets (their label/mood are read by moodModifiers). */
export const MODIFIER_TAG = 'modifier';
