/**
 * Aspirations (GDD §12) and the Reward Store (GDD §8).
 * Milestone conditions use engine kinds (`funds`, `skill`, `stat`) and people kinds (COND in ./ids).
 */
import type { AspirationDef, RewardDef } from '../../contracts';
import { COND, EFFECT, HOME_STAT, STAT } from './ids';

export const ASPIRATIONS: AspirationDef[] = [
  {
    id: 'tycoon',
    name: 'Undead Tycoon',
    description: 'Money can’t buy life, but it can buy a very nice coffin. Build a fortune and climb to the top of a career.',
    icon: 'money',
    milestones: [
      { id: 'tycoon_funds5k', label: 'Have $5,000 in the household coffers', points: 250, condition: { kind: 'funds', params: { min: 5000 } } },
      { id: 'tycoon_career3', label: 'Reach level 3 in a career', points: 400, condition: { kind: COND.careerLevel, params: { min: 3 } } },
      { id: 'tycoon_funds25k', label: 'Have $25,000 in the household coffers', points: 600, condition: { kind: 'funds', params: { min: 25000 } } },
      { id: 'tycoon_career5', label: 'Reach the top of a career', points: 1000, condition: { kind: COND.careerLevel, params: { min: 5 } } },
    ],
  },
  {
    id: 'afterparty',
    name: 'Life of the Afterparty',
    description: 'Death is no excuse to stay home. Collect friends, throw parties, become a legend of the neighbourhood.',
    icon: 'party',
    milestones: [
      { id: 'afterparty_friends3', label: 'Make 3 friends', points: 250, condition: { kind: COND.friends, params: { min: 3 } } },
      { id: 'afterparty_party', label: 'Throw a party', points: 350, condition: { kind: 'stat', params: { key: STAT.partiesThrown, min: 1, perAgent: true } } },
      { id: 'afterparty_friends6', label: 'Make 6 friends', points: 550, condition: { kind: COND.friends, params: { min: 6 } } },
      { id: 'afterparty_legendary', label: 'Throw a Legendary Party', points: 900, condition: { kind: 'stat', params: { key: STAT.legendaryParties, min: 1, perAgent: true } } },
    ],
  },
  {
    id: 'eternalRomance',
    name: 'Eternal Romance',
    description: 'Love is stronger than death. Which is lucky, because death already happened. Find the one and keep them.',
    icon: 'heart',
    milestones: [
      { id: 'romance_firstKiss', label: 'Share a first kiss', points: 250, condition: { kind: COND.relationshipFlag, params: { flag: 'kissed' } } },
      { id: 'romance_partners', label: 'Become partners', points: 400, condition: { kind: COND.relationshipFlag, params: { flag: 'partners' } } },
      { id: 'romance_married', label: 'Get married', points: 600, condition: { kind: COND.relationshipFlag, params: { flag: 'married' } } },
      { id: 'romance_max', label: 'Reach 100 romance with someone', points: 900, condition: { kind: COND.romanceMax, params: { min: 100 } } },
    ],
  },
  {
    id: 'masterPreserver',
    name: 'Master Preserver',
    description: 'Freshness is a lifestyle. Master the mortuary arts and keep the whole household looking barely dead.',
    icon: 'embalm',
    milestones: [
      { id: 'preserver_mortuary3', label: 'Reach Mortuary Science 3', points: 250, condition: { kind: 'skill', params: { skill: 'mortuary', min: 3 } } },
      { id: 'preserver_embalmOther', label: 'Embalm another zombie', points: 400, condition: { kind: 'stat', params: { key: HOME_STAT.embalmedOthers, min: 1, perAgent: true } } },
      { id: 'preserver_mortuary7', label: 'Reach Mortuary Science 7', points: 600, condition: { kind: 'skill', params: { skill: 'mortuary', min: 7 } } },
      { id: 'preserver_freshWeek', label: 'Keep the household’s average freshness at 70+ for 7 days', points: 1000, condition: { kind: COND.freshStreak, params: { days: 7, min: 70 } } },
    ],
  },
  {
    id: 'renaissanceCorpse',
    name: 'Renaissance Corpse',
    description: 'A true artist of the afterlife. Paint, sell, and become accomplished in all things (except staying alive).',
    icon: 'paint',
    milestones: [
      { id: 'renaissance_creativity3', label: 'Reach Creativity 3', points: 250, condition: { kind: 'skill', params: { skill: 'creativity', min: 3 } } },
      { id: 'renaissance_sellPainting', label: 'Sell a painting', points: 350, condition: { kind: 'stat', params: { key: HOME_STAT.paintingsSold, min: 1, perAgent: true } } },
      { id: 'renaissance_creativity7', label: 'Reach Creativity 7', points: 600, condition: { kind: 'skill', params: { skill: 'creativity', min: 7 } } },
      { id: 'renaissance_threeSkills', label: 'Reach level 5 in three skills', points: 1000, condition: { kind: COND.skillsAtLevel, params: { count: 3, level: 5 } } },
    ],
  },
];

export const REWARDS: RewardDef[] = [
  {
    id: 'reward_wellPreserved',
    name: 'Well Preserved',
    description: 'Freshness drains 30% slower. Forever. Your open-casket days are behind you.',
    cost: 1200,
    kind: 'trait',
    traitId: 'wellPreserved',
    icon: 'ice',
  },
  {
    id: 'reward_ironStitches',
    name: 'Iron Stitches',
    description: 'Limbs never fall off. Surgical steel, double-knotted, guaranteed for eternity.',
    cost: 900,
    kind: 'trait',
    traitId: 'ironStitches',
    icon: 'stitch',
  },
  {
    id: 'reward_castIronStomach',
    name: 'Cast-Iron Stomach',
    description: 'Never get food poisoning again. Week-old leftovers? Delicacy.',
    cost: 400,
    kind: 'trait',
    traitId: 'castIronStomach',
    icon: 'plate',
  },
  {
    id: 'reward_silverTongue',
    name: 'Silver Tongue',
    description: 'Every social interaction is 15% more likely to succeed. Smooth as embalming fluid.',
    cost: 700,
    kind: 'trait',
    traitId: 'silverTongue',
    icon: 'sparkle',
  },
  {
    id: 'reward_deepSleeper',
    name: 'Deep Sleeper',
    description: 'Restore energy 30% faster while sleeping. Sleep like the dead — professionally.',
    cost: 500,
    kind: 'trait',
    traitId: 'deepSleeper',
    icon: 'coffin',
  },
  {
    id: 'reward_secondWind',
    name: 'Second Wind',
    description: 'A single-use jolt of unholy vigour: +20 vitality (max 100). The decay economy’s best-kept secret.',
    cost: 600,
    kind: 'consumable',
    effect: { id: EFFECT.addVitality, params: { amount: 20 } },
    icon: 'lightning',
  },
];
