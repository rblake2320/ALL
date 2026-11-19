/**
 * Quests plugin (docs/MONETIZATION.md §2; README.md in this folder). `questsSystem` = the shipped content;
 * `createQuestsSystem(defs)` builds one over other defs (tests, content packs).
 */
import { ALL_QUESTS } from '../../content/quests';
import { createQuestsSystem } from './system';

export { createQuestsSystem, MAX_STORY_ACTIVE, NEIGHBOURHOOD_SLOTS, QUESTS_SYSTEM_ID, STATE_EVAL_TICKS } from './system';
export * from './objectives';
export { createQuestsState, deriveWorldId, grantIdOf, healQuestsState, MAX_GRANTS } from './state';
export { pickDailyTasks, DAILY_TASKS_PER_DAY } from './daily';
export { validateQuests, validateDailyPool, validateObjective, KNOWN_STATS, DAILY_KINDS } from './validate';

export const questsSystem = createQuestsSystem(ALL_QUESTS);
export const questSystems = [questsSystem];
