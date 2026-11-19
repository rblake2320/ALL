/**
 * Daily-task pool (docs/MONETIZATION.md §2). Daily tasks are PROFILE-level and owned by the game layer (3 per day,
 * rotating at local midnight); the sim only provides this data and the objective evaluator
 * (src/sim/systems/quests/objectives.ts) the game layer runs on the drained event stream.
 * Only kinds that measure NEW activity are allowed here (validated): interaction, event, stat, friends, billsOnTime and
 * fresh `own` — never absolute levels/amounts that an old save would satisfy instantly.
 */
import type { ObjectiveDef } from '../../contracts';

export interface DailyTaskDef {
  id: string;
  title: string;
  objective: ObjectiveDef;
  bones: number;
}

export const DAILY_TASK_POOL: DailyTaskDef[] = [
  { id: 'd_cook2', title: 'Cook 2 meals', objective: { kind: 'stat', key: 'mealsCooked', count: 2 }, bones: 10 },
  { id: 'd_eat3', title: 'Eat 3 meals', objective: { kind: 'stat', key: 'mealsEaten', count: 3 }, bones: 8 },
  { id: 'd_fix', title: 'Fix something broken', objective: { kind: 'stat', key: 'repairs', count: 1 }, bones: 12 },
  { id: 'd_dishes3', title: 'Clean 3 dishes', objective: { kind: 'stat', key: 'dishesCleaned', count: 3 }, bones: 8 },
  { id: 'd_payBill', title: 'Pay a bill', objective: { kind: 'stat', key: 'billsPaid', count: 1 }, bones: 10 },
  { id: 'd_friend', title: 'Make a friend', objective: { kind: 'friends', count: 1 }, bones: 15 },
  { id: 'd_chat3', title: 'Chat 3 times', objective: { kind: 'interaction', ids: ['social_chat'], count: 3 }, bones: 8 },
  { id: 'd_joke2', title: 'Tell 2 jokes', objective: { kind: 'interaction', ids: ['social_joke'], count: 2 }, bones: 8 },
  { id: 'd_hug', title: 'Give a hug', objective: { kind: 'interaction', ids: ['social_hug'], count: 1 }, bones: 8 },
  { id: 'd_complimentRot', title: 'Compliment someone’s rot', objective: { kind: 'interaction', ids: ['social_complimentRot'], count: 1 }, bones: 8 },
  { id: 'd_gossip', title: 'Share some gossip', objective: { kind: 'interaction', ids: ['social_gossip'], count: 1 }, bones: 8 },
  { id: 'd_romance', title: 'Be romantic', objective: { kind: 'interaction', tags: ['romantic'], count: 1 }, bones: 10 },
  { id: 'd_meet', title: 'Meet a new townie', objective: { kind: 'stat', key: 'townsfolkMet', count: 1 }, bones: 10 },
  { id: 'd_invite', title: 'Invite someone over', objective: { kind: 'interaction', ids: ['phone_inviteOver'], count: 1 }, bones: 8 },
  { id: 'd_read2', title: 'Read twice', objective: { kind: 'interaction', ids: ['home_read'], count: 2 }, bones: 8 },
  { id: 'd_paint', title: 'Paint for a while', objective: { kind: 'interaction', ids: ['home_paint'], count: 1 }, bones: 8 },
  { id: 'd_finishPainting', title: 'Finish a painting', objective: { kind: 'stat', key: 'paintingsFinished', count: 1 }, bones: 12 },
  { id: 'd_workout2', title: 'Work out twice', objective: { kind: 'interaction', tags: ['exercise'], count: 2 }, bones: 8 },
  { id: 'd_chess', title: 'Play chess', objective: { kind: 'interaction', tags: ['chess'], count: 1 }, bones: 8 },
  { id: 'd_program', title: 'Write some code', objective: { kind: 'interaction', ids: ['home_program'], count: 1 }, bones: 8 },
  { id: 'd_games2', title: 'Play 2 games', objective: { kind: 'interaction', tags: ['game'], count: 2 }, bones: 8 },
  { id: 'd_tv2', title: 'Watch TV twice', objective: { kind: 'interaction', ids: ['home_watchTv'], count: 2 }, bones: 6 },
  { id: 'd_dance', title: 'Dance', objective: { kind: 'interaction', tags: ['dance'], count: 1 }, bones: 8 },
  { id: 'd_music', title: 'Listen to music', objective: { kind: 'interaction', ids: ['home_listenMusic'], count: 1 }, bones: 6 },
  { id: 'd_espresso', title: 'Brew an espresso', objective: { kind: 'interaction', ids: ['home_brewEspresso'], count: 1 }, bones: 6 },
  { id: 'd_shower', title: 'Take a shower', objective: { kind: 'interaction', ids: ['home_shower'], count: 1 }, bones: 6 },
  { id: 'd_preserve2', title: 'Restore Freshness twice', objective: { kind: 'interaction', tags: ['preserve'], count: 2 }, bones: 8 },
  { id: 'd_embalm', title: 'Get embalmed', objective: { kind: 'interaction', tags: ['embalm'], count: 1 }, bones: 12 },
  { id: 'd_stitch', title: 'Stitch something up', objective: { kind: 'interaction', tags: ['stitch'], count: 1 }, bones: 10 },
  { id: 'd_plant', title: 'Tend a plant', objective: { kind: 'interaction', tags: ['plant'], count: 1 }, bones: 6 },
  { id: 'd_trash', title: 'Take out the trash', objective: { kind: 'interaction', ids: ['home_emptyTrash'], count: 1 }, bones: 6 },
  { id: 'd_clean3', title: 'Clean up 3 times', objective: { kind: 'interaction', tags: ['clean'], count: 3 }, bones: 8 },
  { id: 'd_mail', title: 'Check the mail', objective: { kind: 'interaction', ids: ['home_checkMail'], count: 1 }, bones: 6 },
  { id: 'd_admire2', title: 'Admire the décor twice', objective: { kind: 'interaction', tags: ['admire'], count: 2 }, bones: 6 },
  { id: 'd_skillUp', title: 'Level up a skill', objective: { kind: 'event', event: 'skillUp', count: 1 }, bones: 12 },
  { id: 'd_shift', title: 'Work a shift', objective: { kind: 'stat', key: 'shiftsWorked', count: 1 }, bones: 10 },
  { id: 'd_nap', title: 'Take a nap', objective: { kind: 'interaction', ids: ['home_nap'], count: 1 }, bones: 6 },
  { id: 'd_coffinSleep', title: 'Sleep in a coffin', objective: { kind: 'interaction', ids: ['home_sleep'], targetTags: ['coffin'], count: 1 }, bones: 8 },
  { id: 'd_speech', title: 'Practise a speech', objective: { kind: 'interaction', ids: ['home_practiceSpeech'], count: 1 }, bones: 8 },
  { id: 'd_buyDecor', title: 'Place a new decoration', objective: { kind: 'own', tags: ['decor'], count: 1, fresh: true, holdMin: 15 }, bones: 10 },
];
