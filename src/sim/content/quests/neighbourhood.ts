/**
 * Repeatable neighbourhood quests (docs/MONETIZATION.md §2). Two are offered at a time; a new one is chosen each
 * morning (deterministically, no RNG) among the quests whose prerequisites are done and whose cooldown has passed.
 */
import type { QuestDef } from '../../contracts';

type N = Omit<QuestDef, 'category' | 'steps'> & { label: string; objective: QuestDef['steps'][number]['objective'] };

const n = (q: N): QuestDef => {
  const { label, objective, ...rest } = q;
  return { ...rest, category: 'neighbourhood', steps: [{ id: 'goal', label, objective }] };
};

const AFTER_MEAL = ['story_firstMeal'];

export const NEIGHBOURHOOD_QUESTS: QuestDef[] = [
  n({ id: 'n_potluck', title: 'Potluck Prep', description: 'The block is hungry. Cook three meals.', icon: 'plate', label: 'Cook 3 meals', objective: { kind: 'stat', key: 'mealsCooked', count: 3 }, reward: { bones: 20 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_gourmet', title: 'Cerebellum Connoisseur', description: 'Mrs. Mortimer wants the stew recipe. Cook Cerebellum Stew (Cooking 2).', icon: 'plate', label: 'Cook Cerebellum Stew', objective: { kind: 'interaction', tags: ['cook'], match: { recipe: 'cerebellumStew' }, count: 1 }, reward: { bones: 30 }, requires: AFTER_MEAL, repeat: { cooldownDays: 3 } }),
  n({ id: 'n_dishDuty', title: 'Dish Duty', description: 'Flies are filing complaints. Clean five dirty dishes.', icon: 'dish', label: 'Clean 5 dishes', objective: { kind: 'stat', key: 'dishesCleaned', count: 5 }, reward: { bones: 15 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_fixer', title: 'Neighbourhood Fixer', description: 'Two broken things, two happy appliances.', icon: 'wrench', label: 'Repair 2 things', objective: { kind: 'stat', key: 'repairs', count: 2 }, reward: { bones: 25 }, requires: ['story_firstRepair'], repeat: { cooldownDays: 3 } }),
  n({ id: 'n_billsDue', title: 'Good Credit (Posthumous)', description: 'Pay the next bill before it is overdue.', icon: 'money', label: 'Pay a bill on time', objective: { kind: 'billsOnTime', count: 1 }, reward: { bones: 20 }, requires: ['story_bills'], repeat: { cooldownDays: 3 } }),
  n({ id: 'n_socialButterfly', title: 'Social Butterfly', description: 'Spread some undead cheer: six friendly chats, jokes or hugs.', icon: 'chat', label: 'Be friendly 6 times', objective: { kind: 'interaction', tags: ['friendly'], count: 6 }, reward: { bones: 20 }, requires: ['story_makeFriend'], repeat: { cooldownDays: 2 } }),
  n({ id: 'n_newFace', title: 'New Face in Town', description: 'Introduce yourself to someone you have never met.', icon: 'wave', label: 'Meet a new townie', objective: { kind: 'stat', key: 'townsfolkMet', count: 1 }, reward: { bones: 20 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_bestie', title: 'Thick as Grave Robbers', description: 'Turn a friendship into a Good Friendship.', icon: 'heart', label: 'Make a Good Friend', objective: { kind: 'friends', count: 1, atLeast: 60 }, reward: { bones: 35 }, requires: ['story_makeFriend'], repeat: { cooldownDays: 5 } }),
  n({ id: 'n_bookworm', title: 'Bookworm (Literal)', description: 'Read three times from the bookshelf.', icon: 'book', label: 'Read 3 times', objective: { kind: 'interaction', ids: ['home_read'], count: 3 }, reward: { bones: 15 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_artist', title: 'Morbid Masterpiece', description: 'Finish a painting at the easel.', icon: 'paint', label: 'Finish a painting', objective: { kind: 'stat', key: 'paintingsFinished', count: 1 }, reward: { bones: 25 }, requires: AFTER_MEAL, repeat: { cooldownDays: 3 } }),
  n({ id: 'n_gallery', title: 'Gallery Opening', description: 'Sell a painting to a collector of the macabre.', icon: 'money', label: 'Sell a painting', objective: { kind: 'stat', key: 'paintingsSold', count: 1 }, reward: { bones: 30 }, requires: AFTER_MEAL, repeat: { cooldownDays: 4 } }),
  n({ id: 'n_gymRat', title: 'Gym Rot', description: 'Work out three times. Mind the limbs.', icon: 'dumbbell', label: 'Work out 3 times', objective: { kind: 'interaction', tags: ['exercise'], count: 3 }, reward: { bones: 15 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_chessClub', title: 'Chess Club', description: 'Play two games of chess.', icon: 'chess', label: 'Play chess twice', objective: { kind: 'interaction', tags: ['chess'], count: 2 }, reward: { bones: 15 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_greenThumb', title: 'Green(ish) Thumb', description: 'Tend the plants three times.', icon: 'plant', label: 'Tend plants 3 times', objective: { kind: 'interaction', tags: ['plant'], count: 3 }, reward: { bones: 15 }, requires: AFTER_MEAL, repeat: { cooldownDays: 2 } }),
  n({ id: 'n_shiftWork', title: 'Clocking In', description: 'Work three shifts without quitting.', icon: 'work', label: 'Work 3 shifts', objective: { kind: 'stat', key: 'shiftsWorked', count: 3 }, reward: { bones: 30 }, requires: ['story_getJob'], repeat: { cooldownDays: 3 } }),
  n({ id: 'n_climber', title: 'Corporate Climber', description: 'Earn a promotion at work.', icon: 'trophy', label: 'Earn a promotion', objective: { kind: 'event', event: 'promotion', count: 1 }, reward: { bones: 50 }, requires: ['story_getJob'], repeat: { cooldownDays: 4 } }),
  n({ id: 'n_partyAnimal', title: 'Party Animal', description: 'The neighbours want another party.', icon: 'party', label: 'Throw a party', objective: { kind: 'stat', key: 'partiesThrown', count: 1 }, reward: { bones: 40 }, requires: ['story_party'], repeat: { cooldownDays: 4 } }),
  n({ id: 'n_embalmer', title: 'Embalming Season', description: 'Two embalmings keep the household fresh.', icon: 'embalm', label: 'Embalm twice', objective: { kind: 'interaction', tags: ['embalm'], count: 2 }, reward: { bones: 30 }, requires: ['story_embalming'], repeat: { cooldownDays: 3 } }),
  n({ id: 'n_shopper', title: 'Interior Decomposer', description: 'Buy and place a new decoration.', icon: 'sparkle', label: 'Place a new decoration', objective: { kind: 'own', tags: ['decor'], count: 1, fresh: true, holdMin: 30 }, reward: { bones: 20 }, requires: ['story_decorate'], repeat: { cooldownDays: 3 } }),
  n({ id: 'n_quietWeek', title: 'Still Standing', description: 'Keep the household going for three more days.', icon: 'clock', label: 'Survive 3 days', objective: { kind: 'days', count: 3 }, reward: { bones: 25 }, requires: AFTER_MEAL, repeat: { cooldownDays: 3 } }),
];
