/**
 * Careers — GDD §10: five tracks × five levels, exactly per the table, plus three work-choice events per track.
 * Work-event options run the `careerChoice` effect (see EFFECT.careerChoice in ./ids for the param shape).
 * The option whose params carry `safe: true` is the auto-resolve default (after 2 game hours).
 */
import type { CareerDef, CareerLevelDef, WorkEventDef } from '../../contracts';
import type { SkillId } from '../../types';
import { EFFECT } from './ids';

const MON_FRI = [0, 1, 2, 3, 4];
const WED_SUN = [2, 3, 4, 5, 6];
const CC = EFFECT.careerChoice;

function levels(
  skill: SkillId,
  startHour: number,
  hours: number,
  days: number[],
  rows: [title: string, wage: number, reqToReachThisLevel: number][],
): CareerLevelDef[] {
  return rows.map(([title, wage], i) => {
    const next = rows[i + 1];
    return {
      title,
      wage,
      startHour,
      hours,
      days: days.slice(),
      promoteReq: next ? [{ skill, level: next[2] }] : [],
    };
  });
}

const retailEvents: WorkEventDef[] = [
  {
    id: 'retail_shoeReturn',
    title: 'The 3 AM Return',
    text: 'A customer in a moth-eaten cape wants to return a single shoe. They bought it in 1887. They have no receipt, but they do have a very convincing stare.',
    options: [
      { label: 'Process the return', effect: CC, params: { perf: 4, fun: -6, safe: true, text: 'Refunded one (1) Victorian shoe. The register wept.' } },
      { label: 'Charm them into buying the left one too', effect: CC, params: { chance: 0.55, perf: 9, xp: 25, moodlet: 'officeHero', text: 'Sold a matching shoe AND a shoehorn. Retail legend.', failPerf: -5, failMoodlet: 'embarrassed', failText: 'They left with both shoes and your name tag.' } },
      { label: 'Hide in the stockroom', effect: CC, params: { chance: 0.5, fun: 10, text: 'Nobody noticed. A perfect shift of crouching behind the paper towels.', failPerf: -7, failMoodlet: 'officeShame', failText: 'The manager found you inside a box labelled “Seasonal”.' } },
    ],
  },
  {
    id: 'retail_beanAvalanche',
    title: 'Bean Avalanche',
    text: 'An entire end-cap of canned beans has collapsed into aisle 6. The beans are rolling with intent.',
    options: [
      { label: 'Restack every single can', effect: CC, params: { perf: 7, energy: -12, moodlet: 'workedLate', text: 'Six hundred cans, perfectly aligned. Nobody will ever know.' } },
      { label: 'Put up a “Wet Floor” sign and walk away', effect: CC, params: { perf: -2, fun: 5, safe: true, text: 'It is not wet. It is beans. The sign is a lie and it works.' } },
      { label: 'Build a bean fort', effect: CC, params: { chance: 0.4, perf: 9, fun: 15, moodlet: 'officeHero', text: 'The fort went viral. Corporate called it “guerrilla merchandising”.', failPerf: -8, failMoodlet: 'officeShame', failText: 'The fort collapsed during the morning briefing.' } },
    ],
  },
  {
    id: 'retail_mysteryShopper',
    title: 'Mystery Shopper',
    text: 'Someone is wandering the aisles taking notes on a clipboard. Either a mystery shopper or a very thorough ghost.',
    options: [
      { label: 'Turn on the undead charm', effect: CC, params: { chance: 0.6, perf: 10, xp: 20, text: 'Five stars: “Clerk was attentive and only lightly decomposing.”', failPerf: -4, failMoodlet: 'embarrassed', failText: 'You complimented the clipboard. It was not the shopper.' } },
      { label: 'Offer a free sample of brain jerky', effect: CC, params: { perf: 5, safe: true, text: 'Nobody has ever refused free jerky. Science.' } },
      { label: 'Follow them suspiciously', effect: CC, params: { perf: -3, fun: 6, text: 'They wrote “clerk followed me for forty minutes”. Fair.' } },
    ],
  },
];

const mortuaryEvents: WorkEventDef[] = [
  {
    id: 'mortuary_familiarFace',
    title: 'A Familiar Face',
    text: 'The client on today’s slab looks exactly like your cousin Bartholomew. You check. It is not Bartholomew. Probably.',
    options: [
      { label: 'Do your finest work', effect: CC, params: { perf: 6, xp: 30, safe: true, text: 'A masterpiece of restorative art. Bartholomew would be proud. Wherever he is.' } },
      { label: 'Call Bartholomew, just in case', effect: CC, params: { perf: -2, social: 10, text: 'He picked up. You talked for an hour. The client waited patiently.' } },
      { label: 'Give them Bartholomew’s haircut', effect: CC, params: { chance: 0.5, perf: 8, fun: 10, text: 'The family loved it. “He looks so… Bartholomew.”', failPerf: -8, failMoodlet: 'officeShame', failText: 'The family did not know a Bartholomew. Awkward funeral.' } },
    ],
  },
  {
    id: 'mortuary_fluidShortage',
    title: 'Embalming Fluid Shortage',
    text: 'The supplier is out of embalming fluid and three viewings are scheduled for this afternoon.',
    options: [
      { label: 'Improvise with pickle brine', effect: CC, params: { chance: 0.5, perf: 10, xp: 25, moodlet: 'officeHero', text: 'Dill-scented clients are now a premium package.', failPerf: -10, failMoodlet: 'officeShame', failText: 'The viewing smelled like a deli. Several mourners got hungry.' } },
      { label: 'Pay for rush delivery yourself', effect: CC, params: { perf: 8, funds: -30, text: 'Expensive, but the boss noticed. You paid $30 for respect.' } },
      { label: 'Postpone the viewings', effect: CC, params: { perf: -4, safe: true, text: 'The clients did not complain. The families did.' } },
    ],
  },
  {
    id: 'mortuary_clientSatUp',
    title: 'The Client Sat Up',
    text: 'Halfway through the procedure, the client on the table sits up and asks what time it is. Professional courtesy suggests you answer.',
    options: [
      { label: 'Calmly lie them back down', effect: CC, params: { perf: 5, safe: true, text: '“Shh. It’s nap time.” They went right back down. A natural.' } },
      { label: 'Scream (professionally)', effect: CC, params: { perf: -3, fun: 6, moodlet: 'embarrassed', text: 'The scream echoed through the building. The client screamed back. Bonding.' } },
      { label: 'Hand them a job application', effect: CC, params: { chance: 0.5, perf: 12, moodlet: 'officeHero', text: 'Recruited a new embalmer’s assistant on the spot. HR is thrilled.', failPerf: -5, failText: 'They filled it out, then lay back down. The paperwork is a mess.' } },
    ],
  },
];

const politicsEvents: WorkEventDef[] = [
  {
    id: 'politics_babyKissing',
    title: 'Baby-Kissing Photo Op',
    text: 'The campaign needs a photo of you kissing a baby. The baby has seen you. The baby has opinions.',
    options: [
      { label: 'Kiss the baby', effect: CC, params: { chance: 0.55, perf: 10, xp: 20, text: 'The baby giggled! Front page! “Candidate Not Terrifying, Says Infant.”', failPerf: -8, failMoodlet: 'officeShame', failText: 'The baby cried. Then you cried. Then the photographer cried.' } },
      { label: 'Kiss the stroller instead', effect: CC, params: { perf: 3, safe: true, text: 'A bold, stroller-friendly platform. Polls are cautiously confused.' } },
      { label: 'Delegate the kissing', effect: CC, params: { perf: -2, fun: 4, text: 'An intern kissed the baby. The intern is now polling higher than you.' } },
    ],
  },
  {
    id: 'politics_scandalMemo',
    title: 'The Scandalous Memo',
    text: 'You found a memo proving the opposition plans to pave over the old cemetery. Several constituents live there.',
    options: [
      { label: 'Leak it to the press', effect: CC, params: { chance: 0.5, perf: 12, moodlet: 'officeHero', text: 'Scandal! Outrage! Your approval ratings rose from the grave.', failPerf: -12, failMoodlet: 'officeShame', failText: 'It was a memo about paving the CAFETERIA. Retraction printed.' } },
      { label: 'Shred it responsibly', effect: CC, params: { perf: 4, safe: true, text: 'Clean hands, clean conscience, clean shredder.' } },
      { label: 'Frame it for your office', effect: CC, params: { perf: -2, fun: 8, text: 'It looks great above the desk. Visitors find it threatening.' } },
    ],
  },
  {
    id: 'politics_townHall',
    title: 'Town Hall Heckler',
    text: 'A constituent at the town hall is yelling that zombies should “pay their fair share of air”. You don’t even breathe.',
    options: [
      { label: 'Debate them on the spot', effect: CC, params: { chance: 0.6, perf: 10, xp: 30, text: 'Devastating rebuttal. The heckler joined your campaign.', failPerf: -6, failMoodlet: 'embarrassed', failText: 'You lost the debate to a man holding a sandwich.' } },
      { label: 'Promise everyone a new cemetery', effect: CC, params: { perf: 6, safe: true, text: 'Thunderous applause. Now you need to find land for a cemetery.' } },
      { label: 'Pretend to take an urgent call', effect: CC, params: { perf: -2, fun: 5, text: 'You talked to the dial tone for twenty minutes. Very convincing.' } },
    ],
  },
];

const culinaryEvents: WorkEventDef[] = [
  {
    id: 'culinary_critic',
    title: 'Critic at Table Nine',
    text: 'The most feared food critic in Wormwood Heights has ordered the special. Nobody knows what the special is. Including you.',
    options: [
      { label: 'Improvise a brain flambé', effect: CC, params: { chance: 0.55, perf: 12, xp: 30, moodlet: 'officeHero', text: '“Transcendent. Smoky. I wept.” Four skulls out of four.', failPerf: -8, failMoodlet: 'officeShame', failText: 'The flambé set off the sprinklers. And the critic’s wig.' } },
      { label: 'Play it safe with the loaf', effect: CC, params: { perf: 4, safe: true, text: '“Competent. Loaf-like.” Could be worse.' } },
      { label: 'Comp the meal from your tips', effect: CC, params: { perf: 8, funds: -15, text: 'Generosity noted. The critic called you “charmingly desperate”.' } },
    ],
  },
  {
    id: 'culinary_grease',
    title: 'Grease Fire!',
    text: 'The deep fryer has developed ambitions and is now on fire. The line cooks are looking at you.',
    options: [
      { label: 'Smother it with a lid', effect: CC, params: { chance: 0.7, perf: 8, text: 'One lid, zero drama. Kitchen hero.', failPerf: -6, failPreservation: -5, failText: 'The lid melted. So did a bit of your eyebrow.' } },
      { label: 'Evacuate dramatically', effect: CC, params: { perf: -2, fun: 8, text: 'You yelled “EVERYONE OUT” with real passion. It was a small fire.' } },
      { label: 'Keep plating around it', effect: CC, params: { perf: 5, energy: -10, safe: true, text: 'Service never stopped. The fire went out on its own, eventually.' } },
    ],
  },
  {
    id: 'culinary_rat',
    title: 'A Rat in the Pantry',
    text: 'There is a rat in the pantry. It is wearing a tiny toque. It appears to be seasoning things.',
    options: [
      { label: 'Hire it as a sous-chef', effect: CC, params: { perf: -2, fun: 12, text: 'Honestly, its sauces are better than yours.' } },
      { label: 'Gently shoo it outside', effect: CC, params: { perf: 4, safe: true, text: 'The rat left with dignity and a small bag of herbs.' } },
      { label: 'Put rat on the menu', effect: CC, params: { chance: 0.5, perf: 10, text: '“Rustic.” “Bold.” “Is this legal?” Sold out by nine.', failPerf: -10, failMoodlet: 'officeShame', failText: 'The rat escaped mid-service. Pandemonium in the dining room.' } },
    ],
  },
];

const techEvents: WorkEventDef[] = [
  {
    id: 'tech_prodDown',
    title: 'Production Is Down',
    text: 'The Necro-Tech cloud is down. Every haunted smart-fridge in town is screaming. The CTO is looking at you.',
    options: [
      { label: 'Hotfix it live', effect: CC, params: { chance: 0.55, perf: 12, xp: 30, moodlet: 'officeHero', text: 'One semicolon. You saved the cloud with ONE semicolon.', failPerf: -10, failMoodlet: 'workedLate', failText: 'You took down the backup too. Pizza was ordered. Nobody went home.' } },
      { label: 'Roll back to yesterday', effect: CC, params: { perf: 5, safe: true, text: 'Back to the good old days of yesterday. Crisis averted.' } },
      { label: 'Turn it off and on again', effect: CC, params: { chance: 0.7, perf: 6, text: 'Classic. Timeless. It worked.', failPerf: -4, failText: 'It turned off. It did not turn on again.' } },
    ],
  },
  {
    id: 'tech_teamBuilding',
    title: 'Mandatory Team Building',
    text: 'HR has scheduled a trust-fall exercise. Your coworkers have varying numbers of arms.',
    options: [
      { label: 'Trust fall', effect: CC, params: { chance: 0.6, perf: 4, social: 15, text: 'Caught! By three people and a coat rack. Team spirit!', failPreservation: -4, failMoodlet: 'embarrassed', failText: 'Nobody caught you. Something cracked. Probably the floor.' } },
      { label: 'Hide under your desk', effect: CC, params: { perf: -3, fun: 5, text: 'Your desk is a fortress. A lonely, quiet, productive fortress.' } },
      { label: 'Volunteer to run it', effect: CC, params: { perf: 6, energy: -10, safe: true, text: 'You ran it. Everyone survived. Mostly. HR is impressed.' } },
    ],
  },
  {
    id: 'tech_hungryAi',
    title: 'The AI Demands Brains',
    text: 'The company chatbot has started ending every reply with “ALSO: BRAINS.” Customers are concerned. Some are intrigued.',
    options: [
      { label: 'Patch the training data', effect: CC, params: { perf: 6, xp: 20, safe: true, text: 'It now ends replies with “Have a nice day.” Unsettling, but compliant.' } },
      { label: 'Feed it a brain jerky', effect: CC, params: { perf: 2, fun: 8, text: 'It seems satisfied. It is now asking about dessert.' } },
      { label: 'Have it negotiate your raise', effect: CC, params: { chance: 0.4, perf: 4, funds: 100, text: 'The AI secured you a $100 bonus. It wants a cut. In brains.', failPerf: -8, failMoodlet: 'officeShame', failText: 'It emailed the whole company asking for YOUR brain specifically.' } },
    ],
  },
];

export const CAREERS: CareerDef[] = [
  {
    id: 'retail',
    name: 'Graveyard Shift Retail',
    description: 'Stock shelves, ring up midnight snacks and smile at customers who are mostly moths. Night owls welcome.',
    icon: 'money',
    skill: 'charisma',
    levels: levels('charisma', 22, 6, MON_FRI, [
      ['Night Stocker', 17, 0],
      ['Cashier', 20, 1],
      ['Shift Lead', 24, 3],
      ['Assistant Manager', 32, 5],
      ['Store Manager', 44, 7],
    ]),
    workEvents: retailEvents,
  },
  {
    id: 'mortuary',
    name: 'Mortuary Sciences',
    description: 'Wash, embalm and beautify the newly departed. A stable career in an industry with a very loyal clientele.',
    icon: 'embalm',
    skill: 'mortuary',
    levels: levels('mortuary', 9, 8, MON_FRI, [
      ['Body Washer', 19, 0],
      ['Embalmer’s Assistant', 24, 2],
      ['Embalmer', 31, 4],
      ['Funeral Director', 43, 6],
      ['Chief Mortician', 60, 8],
    ]),
    workEvents: mortuaryEvents,
  },
  {
    id: 'politics',
    name: 'Undead Politics',
    description: 'Shake hands (carefully), kiss babies (more carefully) and fight for zombie rights at City Hall.',
    icon: 'star',
    skill: 'charisma',
    levels: levels('charisma', 10, 7, MON_FRI, [
      ['Campaign Volunteer', 15, 0],
      ['Council Aide', 22, 2],
      ['City Councilor', 30, 4],
      ['Deputy Mayor', 45, 6],
      ['Mayor of Wormwood', 70, 9],
    ]),
    workEvents: politicsEvents,
  },
  {
    id: 'culinary',
    name: 'Culinary Arts',
    description: 'From dish pit to celebrity brain chef. Evenings and weekends, plus all the leftovers you can carry.',
    icon: 'plate',
    skill: 'cooking',
    levels: levels('cooking', 16, 7, WED_SUN, [
      ['Dishwasher', 16, 0],
      ['Line Cook', 21, 2],
      ['Sous Chef', 28, 4],
      ['Head Chef', 40, 6],
      ['Celebrity Brain Chef', 58, 8],
    ]),
    workEvents: culinaryEvents,
  },
  {
    id: 'necrotech',
    name: 'Necro-Tech',
    description: 'Write code that raises servers from the dead. Mostly turning things off and on again, but with spooky branding.',
    icon: 'computer',
    skill: 'logic',
    levels: levels('logic', 9, 8, MON_FRI, [
      ['Tech Support Ghoul', 20, 0],
      ['Junior Coder', 27, 2],
      ['Senior Developer', 36, 4],
      ['Lead Architect', 50, 6],
      ['CTO of the Undead', 72, 8],
    ]),
    workEvents: techEvents,
  },
];

export const CAREERS_BY_ID: Record<string, CareerDef> = Object.fromEntries(CAREERS.map((c) => [c.id, c]));
