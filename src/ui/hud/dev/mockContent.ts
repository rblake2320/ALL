/**
 * DEV ONLY — content registry for the UI-HUD harness (objects with interactions/env, traits, moodlets, skills,
 * careers, aspirations, rewards). Self-contained so the harness never depends on other modules mid-edit.
 */
import { PHYSICAL_SPECS } from '../../../shared/catalog';
import type {
  AspirationDef,
  CareerDef,
  ContentRegistry,
  InteractionDef,
  MoodletDef,
  ObjectDef,
  RewardDef,
  SkillDef,
  StageDef,
  TraitDef,
} from '../../../sim/contracts';
import type { NeedId } from '../../../sim/types';

const st = (needs: Partial<Record<NeedId, number>>, skill?: Partial<Record<string, number>>): StageDef => ({
  target: { kind: 'target' },
  duration: 60,
  anim: 'idle',
  needsPerHour: needs,
  skillXpPerHour: skill as StageDef['skillXpPerHour'],
});

function ix(id: string, label: string, icon: InteractionDef['icon'], advertise: Partial<Record<NeedId, number>>, skill?: Partial<Record<string, number>>, extra: Partial<InteractionDef> = {}): InteractionDef {
  return { id, label, icon, targetKind: 'object', advertise, stage: st(advertise, skill), ...extra };
}

export const MOCK_INTERACTIONS: InteractionDef[] = [
  ix('home_sit', 'Sit', 'house', { energy: 6 }),
  ix('home_nap', 'Nap', 'zzz', { energy: 35 }),
  ix('home_sleep', 'Sleep', 'zzz', { energy: 90, preservation: 12 }),
  ix('home_sleepChill', 'Sleep (Chilled)', 'ice', { energy: 90, preservation: 40 }),
  ix('home_cook', 'Cook…', 'plate', { hunger: 55 }, { cooking: 40 }),
  ix('home_snack', 'Grab a Brain Jerky', 'brain', { hunger: 20 }, undefined, { cost: 5 }),
  ix('home_spray', 'Grab Preservative Spray', 'ice', { preservation: 8 }, undefined, { cost: 15 }),
  ix('home_microwave', 'Microwave a Brain Burrito', 'brain', { hunger: 40 }, undefined, { cost: 8 }),
  ix('home_espresso', 'Brew an Espresso', 'coffee', { energy: 22 }),
  ix('home_washHands', 'Wash Hands', 'soap', { hygiene: 20 }),
  ix('home_washDishes', 'Wash Dishes', 'dish', { hygiene: 4 }),
  ix('home_trash', 'Take Out the Trash', 'dish', { hygiene: 2 }),
  ix('home_shower', 'Take a Shower', 'shower', { hygiene: 70 }),
  ix('home_iceBath', 'Take an Ice Bath', 'ice', { preservation: 22, hygiene: 60 }),
  ix('home_selfEmbalm', 'Self-Embalm', 'embalm', { preservation: 45 }, { mortuary: 50 }, { cost: 40 }),
  ix('home_stitch', 'Stitch Back On', 'stitch', {}, { mortuary: 10 }),
  ix('home_mirror', 'Practice Speech', 'mirror', { fun: 8 }, { charisma: 30 }),
  ix('home_admire', 'Admire Decay', 'mirror', { fun: 12 }),
  ix('home_watchTv', 'Watch {target}', 'tv', { fun: 40 }),
  ix('home_cookingShow', 'Watch the Cooking Channel', 'tv', { fun: 20 }, { cooking: 6 }),
  ix('home_dance', 'Dance', 'dance', { fun: 40, social: 6 }, { fitness: 20 }),
  ix('home_listen', 'Listen to Music', 'music', { fun: 25 }),
  ix('home_browse', 'Browse the Web', 'computer', { fun: 30 }),
  ix('home_program', 'Write Spooky Code', 'computer', { fun: 10 }, { logic: 30 }),
  ix('home_payOnline', 'Pay Bills Online', 'money', {}),
  ix('home_chess', 'Play Bone Chess', 'chess', { fun: 30, social: 8 }, { logic: 30 }),
  ix('home_read', 'Read a Book', 'book', { fun: 25 }, { logic: 25 }),
  ix('home_study', 'Study Mortuary Science', 'book', { fun: 5 }, { mortuary: 35 }),
  ix('home_paint', 'Paint', 'paint', { fun: 35 }, { creativity: 40 }),
  ix('home_workout', 'Work Out', 'dumbbell', { fun: 10 }, { fitness: 45 }),
  ix('home_arcade', 'Play Grave Raiders', 'game', { fun: 50 }, { logic: 20 }),
  ix('home_feedPlant', 'Feed the Plant', 'plant', { fun: 6 }),
  ix('home_checkMail', 'Check the Mail', 'mail', {}),
  ix('home_payBills', 'Pay Bills', 'money', {}),
  ix('home_reanimate', 'Reanimate', 'lightning', {}),
  ix('home_fitProsthetic', 'Fit Prosthetic', 'limb', {}),
  ix('home_turnOn', 'Turn On', 'lightning', { fun: 2 }),
];

const OBJECT_IX: Record<string, string[]> = {
  chair_creaky: ['home_sit'],
  chair_ribcage: ['home_sit'],
  armchair_tattered: ['home_sit', 'home_nap'],
  sofa_moldy: ['home_sit', 'home_nap'],
  sofa_velvet: ['home_sit', 'home_nap'],
  pew_salvaged: ['home_sit'],
  fridge_humming: ['home_cook', 'home_snack', 'home_spray'],
  fridge_cryo: ['home_cook', 'home_snack', 'home_spray'],
  stove_greasefire: ['home_cook'],
  stove_necrochef: ['home_cook'],
  microwave_nuke: ['home_microwave'],
  espresso_embalmer: ['home_espresso'],
  sink_rusty: ['home_washHands', 'home_washDishes'],
  trash_lidded: ['home_trash'],
  shower_drizzle: ['home_shower'],
  tub_icebath: ['home_iceBath'],
  station_embalming: ['home_selfEmbalm', 'home_stitch'],
  table_stitchnmend: ['home_stitch'],
  mirror_cracked: ['home_mirror', 'home_admire'],
  plot_budget: ['home_sleep'],
  coffin_pine: ['home_sleep'],
  coffin_chillrest: ['home_sleepChill'],
  sarcophagus_cryo: ['home_sleepChill'],
  bed_normal: ['home_sleep', 'home_nap'],
  tv_crt: ['home_watchTv', 'home_cookingShow'],
  tv_seance: ['home_watchTv', 'home_cookingShow'],
  stereo_boombox: ['home_dance', 'home_listen'],
  desk_hauntedpc: ['home_browse', 'home_program', 'home_payOnline'],
  table_bonechess: ['home_chess'],
  shelf_moldering: ['home_read', 'home_study'],
  easel_morbid: ['home_paint'],
  gym_limb: ['home_workout'],
  arcade_tombstone: ['home_arcade'],
  plant_carnivorous: ['home_feedPlant'],
  mailbox_crooked: ['home_checkMail', 'home_payBills'],
  kit_reanimation: ['home_reanimate'],
  crate_prosthetic: ['home_fitProsthetic'],
  lamp_skull: ['home_turnOn'],
};

const ENV: Record<string, number> = {
  sofa_velvet: 4,
  rug_funeral: 5,
  rug_rag: 2,
  painting_greatgrand: 3,
  plant_deadfern: 1,
  plant_carnivorous: 3,
  candelabra_drippy: 2,
  lamp_skull: 2,
  sconce_candle: 2,
  chair_ribcage: 2,
  table_wake: 2,
  tree_gnarled: 3,
  headstone_decor: 2,
  sarcophagus_cryo: 3,
  tv_seance: 2,
  trash_lidded: -1,
  plot_budget: -2,
  pew_salvaged: 1,
  bed_normal: 1,
  window_gothic: 2,
  door_crypt: 1,
};

export const MOCK_OBJECTS: Record<string, ObjectDef> = Object.fromEntries(
  PHYSICAL_SPECS.map((s) => [
    s.id,
    {
      ...s,
      interactions: OBJECT_IX[s.id] ?? [],
      env: ENV[s.id] ?? 0,
      depreciation: 0.15,
      breakChance: 0,
      sellable: s.buyable,
      params: {},
    } satisfies ObjectDef,
  ]),
);

const trait = (id: string, name: string, icon: TraitDef['icon'], description: string, reward = false): TraitDef => ({ id, name, icon, description, conflicts: [], reward });

export const MOCK_TRAITS: TraitDef[] = [
  trait('gourmand', 'Gourmand', 'brain', 'Has opinions about cerebellum vintages. Eats with gusto, cooks with flair, gets peckish constantly.'),
  trait('neatFreak', 'Neat Freak', 'soap', 'Believes a clean crypt is a happy crypt. Dirty dishes cause visible eye-twitching.'),
  trait('slob', 'Slob', 'dish', 'Mess? What mess? Immune to stench, allergic to washing up.'),
  trait('nightOwl', 'Night Owl', 'zzz', 'Comes alive after dark (relatively speaking). Grumpy before noon.'),
  trait('socialButterfly', 'Social Butterfly', 'chat', 'Lives for company and parties. Gets lonely fast.'),
  trait('loner', 'Loner', 'house', 'Prefers the quiet of the crypt. Crowds of four or more are a nightmare.'),
  trait('hopelessRomantic', 'Hopeless Romantic', 'heart', 'Falls hard and fast. Lovesick after a week alone.'),
  trait('grumpy', 'Grumpy', 'angry', 'Perpetually unimpressed. Excellent at insults; terrible audience for jokes.'),
  trait('cheerful', 'Cheerful', 'happy', 'Sunny disposition for the recently deceased.'),
  trait('clumsy', 'Clumsy', 'limb', 'Limbs come off twice as often. Laughs it off, mostly.'),
  trait('vain', 'Vain', 'mirror', 'Loves a fresh look and a good mirror. Hates visible rot.'),
  trait('lazy', 'Lazy', 'tv', 'Naps are a lifestyle. Exercise is a rumour.'),
  trait('ambitious', 'Ambitious', 'work', 'Climbs the career ladder faster; learns faster too.'),
  trait('bookworm', 'Bookworm', 'book', 'Reading is twice as fun. Logic comes easily.'),
  trait('partyAnimal', 'Party Animal', 'party', 'Born to boogie — again. Parties score higher.'),
  trait('artistic', 'Artistic', 'paint', 'Paints with feeling and finds it deeply fun.'),
  trait('hothead', 'Hothead', 'angry', 'Picks fights. Stays furious twice as long.'),
  trait('squeamish', 'Squeamish', 'disgusted', 'A zombie who is grossed out by limbs. The irony is not lost on anyone.'),
  trait('wellPreserved', 'Well Preserved', 'ice', 'Freshness drains 30% slower.', true),
  trait('ironStitches', 'Iron Stitches', 'stitch', 'Limbs stay firmly attached. Always.', true),
  trait('castIronStomach', 'Cast-Iron Stomach', 'plate', 'Spoiled food holds no terrors.', true),
  trait('silverTongue', 'Silver Tongue', 'chat', 'Social interactions succeed far more often.', true),
  trait('deepSleeper', 'Deep Sleeper', 'zzz', 'Rest restores 30% faster.', true),
];

const ml = (id: string, label: string, mood: number, durationMin: number | null, icon: MoodletDef['icon'], description: string): MoodletDef => ({
  id,
  label,
  mood,
  durationMin,
  icon,
  description,
  maxStacks: 3,
  kind: mood > 0 ? 'good' : mood < 0 ? 'bad' : 'neutral',
});

export const MOCK_MOODLETS: MoodletDef[] = [
  ml('deliciousMeal', 'Delicious Meal', 10, 240, 'plate', 'That Frontal Lobe Lasagna was to die for. Again.'),
  ml('lostLimb', 'Lost a Limb', -15, 720, 'limb', 'An arm fell off in the middle of dinner. Somebody pick that up.'),
  ml('moonstruck', 'Moonstruck', 4, null, 'sparkle', 'The full moon makes everything feel a little peculiar.'),
  ml('familyDinner', 'Family Dinner', 8, 360, 'house', 'Ate together at the table, like a proper undead family.'),
  ml('stenchNearby', 'Stench Nearby', -10, 120, 'flies', 'Someone in this room has stopped bathing entirely.'),
  ml('promoted', 'Promoted!', 20, 1440, 'trophy', 'Moved up in the world, if not out of the grave.'),
  ml('backFromDead', 'Back From the Dead', 15, 1440, 'lightning', 'Reanimated! Feeling like a new corpse.'),
  ml('mourning', 'Mourning', -20, 2880, 'urn', 'A housemate has crumbled. The house feels emptier.'),
  ml('reeking', 'Reeking', -12, null, 'flies', 'Flies have started paying rent.'),
  ml('sleptOnFloor', 'Slept on the Floor', -10, 360, 'zzz', 'Passed out on the floorboards. Everything aches.'),
];

export const MOCK_SKILLS: SkillDef[] = [
  { id: 'cooking', name: 'Cooking', icon: 'plate', description: 'Better meals, fewer kitchen fires.', xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] },
  { id: 'charisma', name: 'Charisma', icon: 'chat', description: 'Smoother small talk and better first impressions.', xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] },
  { id: 'mortuary', name: 'Mortuary Science', icon: 'embalm', description: 'Embalming, stitching and the fine art of staying fresh.', xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] },
  { id: 'logic', name: 'Logic', icon: 'chess', description: 'Chess, code and other cold calculations.', xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] },
  { id: 'creativity', name: 'Creativity', icon: 'paint', description: 'Paintings that sell for more than the canvas.', xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] },
  { id: 'fitness', name: 'Fitness', icon: 'dumbbell', description: 'Sturdier limbs that stay attached.', xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] },
];

const lvl = (title: string, wage: number, startHour: number, hours: number, days: number[], promoteReq: { skill: SkillDef['id']; level: number }[] = []) => ({ title, wage, startHour, hours, days, promoteReq });
const WEEK = [0, 1, 2, 3, 4];

export const MOCK_CAREERS: CareerDef[] = [
  {
    id: 'retail',
    name: 'Graveyard Shift Retail',
    description: 'Stock shelves while the living sleep. Customers are rare and mostly lost.',
    icon: 'work',
    skill: 'charisma',
    levels: [lvl('Night Stocker', 14, 22, 6, WEEK, [{ skill: 'charisma', level: 1 }]), lvl('Cashier', 18, 22, 6, WEEK, [{ skill: 'charisma', level: 3 }]), lvl('Shift Lead', 24, 22, 6, WEEK, [{ skill: 'charisma', level: 5 }]), lvl('Assistant Manager', 32, 22, 6, WEEK, [{ skill: 'charisma', level: 7 }]), lvl('Store Manager', 44, 22, 6, WEEK)],
    workEvents: [],
  },
  {
    id: 'mortuary',
    name: 'Mortuary Sciences',
    description: 'Help other people look their best on the worst day of their lives. Professional interest only.',
    icon: 'embalm',
    skill: 'mortuary',
    levels: [lvl('Body Washer', 16, 9, 8, WEEK, [{ skill: 'mortuary', level: 2 }]), lvl("Embalmer's Assistant", 22, 9, 8, WEEK, [{ skill: 'mortuary', level: 4 }]), lvl('Embalmer', 31, 9, 8, WEEK, [{ skill: 'mortuary', level: 6 }]), lvl('Funeral Director', 43, 9, 8, WEEK, [{ skill: 'mortuary', level: 8 }]), lvl('Chief Mortician', 60, 9, 8, WEEK)],
    workEvents: [],
  },
  {
    id: 'politics',
    name: 'Undead Politics',
    description: 'Shake hands (carefully) and kiss babies (do not).',
    icon: 'chat',
    skill: 'charisma',
    levels: [lvl('Campaign Volunteer', 12, 10, 7, WEEK, [{ skill: 'charisma', level: 2 }]), lvl('Council Aide', 20, 10, 7, WEEK, [{ skill: 'charisma', level: 4 }]), lvl('City Councilor', 30, 10, 7, WEEK, [{ skill: 'charisma', level: 6 }]), lvl('Deputy Mayor', 45, 10, 7, WEEK, [{ skill: 'charisma', level: 9 }]), lvl('Mayor of Wormwood', 70, 10, 7, WEEK)],
    workEvents: [],
  },
  {
    id: 'culinary',
    name: 'Culinary Arts',
    description: 'Cook for the living without tasting the food. Mostly without tasting the food.',
    icon: 'plate',
    skill: 'cooking',
    levels: [lvl('Dishwasher', 13, 16, 7, [2, 3, 4, 5, 6], [{ skill: 'cooking', level: 2 }]), lvl('Line Cook', 19, 16, 7, [2, 3, 4, 5, 6], [{ skill: 'cooking', level: 4 }]), lvl('Sous Chef', 28, 16, 7, [2, 3, 4, 5, 6], [{ skill: 'cooking', level: 6 }]), lvl('Head Chef', 40, 16, 7, [2, 3, 4, 5, 6], [{ skill: 'cooking', level: 8 }]), lvl('Celebrity Brain Chef', 58, 16, 7, [2, 3, 4, 5, 6])],
    workEvents: [],
  },
  {
    id: 'necrotech',
    name: 'Necro-Tech',
    description: 'Have you tried turning it off and on again? Works on zombies too, sometimes.',
    icon: 'computer',
    skill: 'logic',
    levels: [lvl('Tech Support Ghoul', 17, 9, 8, WEEK, [{ skill: 'logic', level: 2 }]), lvl('Junior Coder', 25, 9, 8, WEEK, [{ skill: 'logic', level: 4 }]), lvl('Senior Developer', 36, 9, 8, WEEK, [{ skill: 'logic', level: 6 }]), lvl('Lead Architect', 50, 9, 8, WEEK, [{ skill: 'logic', level: 8 }]), lvl('CTO of the Undead', 72, 9, 8, WEEK)],
    workEvents: [],
  },
];

const mile = (id: string, label: string, points: number) => ({ id, label, points, condition: { kind: 'never', params: {} } });

export const MOCK_ASPIRATIONS: AspirationDef[] = [
  {
    id: 'masterPreserver',
    name: 'Master Preserver',
    description: 'Stay fresh. Keep everyone fresh. Become the envy of the embalming world.',
    icon: 'embalm',
    milestones: [mile('mp1', 'Reach Mortuary Science 3', 250), mile('mp2', 'Embalm another zombie', 400), mile('mp3', 'Reach Mortuary Science 7', 600), mile('mp4', 'Keep household Freshness above 70 for 7 days', 1000)],
  },
  {
    id: 'tycoon',
    name: 'Undead Tycoon',
    description: 'Money talks. Mostly it groans, but it talks.',
    icon: 'money',
    milestones: [mile('ty1', 'Have $5,000', 250), mile('ty2', 'Reach career level 3', 400), mile('ty3', 'Have $25,000', 600), mile('ty4', 'Reach career level 5', 1000)],
  },
];

export const MOCK_REWARDS: RewardDef[] = [
  { id: 'r_wellPreserved', name: 'Well Preserved', description: 'Freshness drains 30% slower. Forever.', cost: 1200, kind: 'trait', traitId: 'wellPreserved', icon: 'ice' },
  { id: 'r_ironStitches', name: 'Iron Stitches', description: 'Limbs never fall off again.', cost: 900, kind: 'trait', traitId: 'ironStitches', icon: 'stitch' },
  { id: 'r_castIron', name: 'Cast-Iron Stomach', description: 'Immune to food poisoning from spoiled leftovers.', cost: 400, kind: 'trait', traitId: 'castIronStomach', icon: 'plate' },
  { id: 'r_silverTongue', name: 'Silver Tongue', description: 'Every social interaction is 15% more likely to land.', cost: 700, kind: 'trait', traitId: 'silverTongue', icon: 'chat' },
  { id: 'r_deepSleeper', name: 'Deep Sleeper', description: 'Rest restores 30% faster in any coffin or bed.', cost: 500, kind: 'trait', traitId: 'deepSleeper', icon: 'zzz' },
  { id: 'r_secondWind', name: 'Second Wind', description: 'Restores 20 Vitality — the ceiling on Freshness — in one dose.', cost: 600, kind: 'consumable', icon: 'lightning' },
];

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));

export function mockContent(): ContentRegistry {
  const interactions = byId(MOCK_INTERACTIONS);
  return {
    objects: MOCK_OBJECTS,
    interactions,
    moodlets: byId(MOCK_MOODLETS),
    traits: byId(MOCK_TRAITS),
    skills: byId(MOCK_SKILLS),
    careers: byId(MOCK_CAREERS),
    aspirations: byId(MOCK_ASPIRATIONS),
    rewards: byId(MOCK_REWARDS),
    recipes: {},
    lifeEvents: [],
    names: { first: [], last: [], occupations: [] },
    stagesOf: (id: string) => {
      const d = interactions[id];
      return d ? d.stages ?? (d.stage ? [d.stage] : []) : [];
    },
  };
}
