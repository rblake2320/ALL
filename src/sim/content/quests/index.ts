/** Shipped quest content: story chain (+ the Act 1 story-start arc, W-113), repeatable neighbourhood quests, daily-task pool (docs/MONETIZATION.md §2). */
import type { QuestDef } from '../../contracts';
import { NEIGHBOURHOOD_QUESTS } from './neighbourhood';
import { STORY_QUESTS } from './story';
import { ACT1_QUESTS } from './act1';

export { STORY_QUESTS } from './story';
export { ACT1_QUESTS, ACT1_ARC, ACT1_QUEST_IDS, ACT1_FINALE_ID } from './act1';
export { NEIGHBOURHOOD_QUESTS } from './neighbourhood';
export { DAILY_TASK_POOL, type DailyTaskDef } from './daily';

export const ALL_QUESTS: readonly QuestDef[] = [...STORY_QUESTS, ...ACT1_QUESTS, ...NEIGHBOURHOOD_QUESTS];
