/**
 * SIM-PEOPLE content module: traits, careers, aspirations + rewards, names, life events, people moodlets,
 * social / phone / career / visit interactions. SkillDefs are ENGINE-owned (CONTRACTS.md decision #8).
 */
import type { ContentModule } from '../../contracts';
import { ASPIRATIONS, REWARDS } from './aspirations';
import { CAREERS } from './careers';
import { PEOPLE_MODULE_ID } from './ids';
import { PEOPLE_LIFE_EVENTS } from './lifeEvents';
import { PEOPLE_MOODLETS } from './moodlets';
import { FIRST_NAMES, LAST_NAMES, OCCUPATIONS } from './names';
import { CRITICAL_SOCIALS, SOCIAL_INTERACTIONS } from './socialInteractions';
import { PHONE_INTERACTIONS, SYSTEM_INTERACTIONS } from './systemInteractions';
import { TRAITS } from './traits';

export const peopleContent: ContentModule = {
  id: PEOPLE_MODULE_ID,
  interactions: [...SOCIAL_INTERACTIONS, ...CRITICAL_SOCIALS, ...PHONE_INTERACTIONS, ...SYSTEM_INTERACTIONS],
  moodlets: PEOPLE_MOODLETS,
  traits: TRAITS,
  careers: CAREERS,
  aspirations: ASPIRATIONS,
  rewards: REWARDS,
  lifeEvents: PEOPLE_LIFE_EVENTS,
  names: { first: FIRST_NAMES, last: LAST_NAMES, occupations: OCCUPATIONS },
};

export * from './ids';
