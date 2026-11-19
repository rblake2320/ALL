/**
 * People moodlets. Durations in game minutes. Ids come from ./ids (MOODLET) so systems and content never drift.
 * Modifier-only entries (tag 'modifier') are never added as instances: the people systems' moodModifiers read
 * their label + mood so the numbers stay declarative here.
 */
import type { MoodletDef } from '../../contracts';
import { MOODLET as M, MODIFIER_TAG } from './ids';

const H = 60;
const DAY = 24 * H;

export const PEOPLE_MOODLETS: MoodletDef[] = [
  // ─────────────── Careers ───────────────
  { id: M.promoted, label: 'Promoted!', description: 'Climbed the corporate ladder without losing a single finger on the rungs.', mood: 20, durationMin: DAY, maxStacks: 1, icon: 'trophy', kind: 'good', tags: ['career'] },
  { id: M.fired, label: 'Fired', description: 'Escorted off the premises by security, who held their nose the whole way.', mood: -20, durationMin: DAY, maxStacks: 1, icon: 'work', kind: 'bad', tags: ['career'] },
  { id: M.newJob, label: 'Gainfully Undead', description: 'A real job! With a lanyard! Mother would be proud, if she would stop haunting the attic.', mood: 8, durationMin: DAY, maxStacks: 1, icon: 'work', kind: 'good', tags: ['career'] },
  { id: M.quitJob, label: 'Free as a Corpse', description: 'Quit in a blaze of glory. Also a small blaze of the break-room microwave.', mood: 5, durationMin: 12 * H, maxStacks: 1, icon: 'happy', kind: 'good', tags: ['career'] },
  { id: M.firstDayJitters, label: 'First Day Jitters', description: 'What if nobody sits with them at lunch? What if their ear falls off in the meeting?', mood: -4, durationMin: 8 * H, maxStacks: 1, icon: 'question', kind: 'bad', tags: ['career'] },
  { id: M.goodDayAtWork, label: 'Good Day at Work', description: 'Productive, appreciated, and only slightly leaking. A rare trifecta.', mood: 10, durationMin: 8 * H, maxStacks: 1, icon: 'work', kind: 'good', tags: ['career'] },
  { id: M.badDayAtWork, label: 'Bad Day at Work', description: 'The printer jammed, the boss sighed, and someone ate their labelled brain from the fridge.', mood: -10, durationMin: 8 * H, maxStacks: 1, icon: 'work', kind: 'bad', tags: ['career'] },
  { id: M.workedLate, label: 'Worked Late', description: 'Stayed after hours. The fluorescent lights hum louder when you are the last one there.', mood: -6, durationMin: 6 * H, maxStacks: 1, icon: 'clock', kind: 'bad', tags: ['career'] },
  { id: M.playingHooky, label: 'Playing Hooky', description: '*cough* *cough* Definitely too sick to work. Extremely sick. Deathly, one might say.', mood: 4, durationMin: 10 * H, maxStacks: 1, icon: 'happy', kind: 'good', tags: ['career'] },
  { id: M.officeHero, label: 'Office Hero', description: 'Saved the day at work. Coworkers clapped. One clapped so hard their hand came off.', mood: 12, durationMin: 12 * H, maxStacks: 1, icon: 'star', kind: 'good', tags: ['career'] },
  { id: M.officeShame, label: 'Office Embarrassment', description: 'Became the subject of a company-wide email. It had a subject line in ALL CAPS.', mood: -8, durationMin: 12 * H, maxStacks: 1, icon: 'sad', kind: 'bad', tags: ['career'] },

  // ─────────────── Romance ───────────────
  { id: M.lovesick, label: 'Lovesick', description: 'A full week without a partner. They have started writing poems to the moon. The moon has not written back.', mood: -8, durationMin: null, maxStacks: 1, icon: 'heartBroken', kind: 'bad', tags: ['romance'] },
  { id: M.smitten, label: 'Smitten', description: 'Butterflies in the stomach. Possibly literal ones, but the feeling is lovely.', mood: 6, durationMin: 4 * H, maxStacks: 2, icon: 'heart', kind: 'good', tags: ['romance'] },
  { id: M.firstKiss, label: 'First Kiss', description: 'Lips met. Most of them. A moment to remember, assuming the memory doesn’t rot.', mood: 12, durationMin: 12 * H, maxStacks: 1, icon: 'heart', kind: 'good', tags: ['romance'] },
  { id: M.itsOfficial, label: 'It’s Official', description: 'Going steady! They’ve already picked out matching shrouds.', mood: 12, durationMin: DAY, maxStacks: 1, icon: 'rose', kind: 'good', tags: ['romance'] },
  { id: M.engaged, label: 'Engaged!', description: 'Said yes to forever. Which, given the circumstances, is a very long time.', mood: 15, durationMin: 2 * DAY, maxStacks: 1, icon: 'ring', kind: 'good', tags: ['romance'] },
  { id: M.newlyweds, label: 'Newlyweds', description: 'Till death do us part? Already handled. Now it’s just “do us”.', mood: 20, durationMin: 3 * DAY, maxStacks: 1, icon: 'ring', kind: 'good', tags: ['romance'] },
  { id: M.rejected, label: 'Rejected', description: 'Put their heart on the line and it came back with a polite note. The heart is in a jar now.', mood: -12, durationMin: 12 * H, maxStacks: 1, icon: 'heartBroken', kind: 'bad', tags: ['romance'] },
  { id: M.heartbroken, label: 'Heartbroken', description: 'It’s over. The heart, already not beating, has somehow managed to break.', mood: -25, durationMin: 3 * DAY, maxStacks: 1, icon: 'heartBroken', kind: 'bad', tags: ['romance'] },

  // ─────────────── Friendly / mean ───────────────
  { id: M.socialHigh, label: 'Riveting Conversation', description: 'Talked until their jaw needed re-stitching. Worth it.', mood: 8, durationMin: 4 * H, maxStacks: 1, icon: 'chat', kind: 'good', tags: ['social'] },
  { id: M.lonely, label: 'Lonely', description: 'Nobody to groan with all day. Even the houseflies have stopped visiting.', mood: -10, durationMin: 12 * H, maxStacks: 1, icon: 'sad', kind: 'bad', tags: ['social'] },
  { id: M.flattered, label: 'Flattered', description: 'Someone noticed the new mould patch. And they said it was “distinguished”.', mood: 6, durationMin: 4 * H, maxStacks: 2, icon: 'sparkle', kind: 'good', tags: ['social'] },
  { id: M.laughedTooHard, label: 'Laughed Too Hard', description: 'Laughed so hard a rib popped out. Popped it back in. Still giggling.', mood: 8, durationMin: 3 * H, maxStacks: 2, icon: 'joke', kind: 'good', tags: ['social'] },
  { id: M.juicyGossip, label: 'Juicy Gossip', description: 'Heard who’s been sneaking out of whose crypt. Must. Tell. Everyone.', mood: 5, durationMin: 4 * H, maxStacks: 1, icon: 'gossip', kind: 'good', tags: ['social'] },
  { id: M.warmHug, label: 'Cold Embrace', description: 'A hug at room temperature. The warmest thing a zombie can offer.', mood: 6, durationMin: 4 * H, maxStacks: 1, icon: 'happy', kind: 'good', tags: ['social'] },
  { id: M.bestFriendsForever, label: 'Best Fiends Forever', description: 'Swore eternal friendship. With their track record, “eternal” is a realistic timeframe.', mood: 15, durationMin: DAY, maxStacks: 1, icon: 'star', kind: 'good', tags: ['social'] },
  { id: M.nibbled, label: 'Love Nibble', description: 'Got a playful little bite. Tickled! Only lost a tiny bit of earlobe.', mood: 6, durationMin: 3 * H, maxStacks: 1, icon: 'bite', kind: 'good', tags: ['social'] },
  { id: M.chewedOn, label: 'Chewed On', description: 'A starving housemate took a bite out of them. There are teeth marks. Many teeth marks.', mood: -14, durationMin: 8 * H, maxStacks: 2, icon: 'bite', kind: 'bad', tags: ['social'] },
  { id: M.feralRemorse, label: 'Bit the Hand That Feeds', description: 'Hunger won. Somebody lost a chunk of shoulder. Breakfast is going to be awkward.', mood: -6, durationMin: 6 * H, maxStacks: 1, icon: 'bite', kind: 'bad', tags: ['social'] },
  { id: M.bitten, label: 'Bitten (Not the Fun Way)', description: 'That “playful” bite took a chunk. Boundaries, people. Boundaries.', mood: -8, durationMin: 6 * H, maxStacks: 1, icon: 'bite', kind: 'bad', tags: ['social'] },
  { id: M.embarrassed, label: 'Embarrassed', description: 'Tried to be smooth. Was not smooth. Will replay it at 3 AM for the next century.', mood: -8, durationMin: 4 * H, maxStacks: 1, icon: 'sad', kind: 'bad', tags: ['social'] },
  { id: M.awkward, label: 'Awkward', description: 'That conversation went somewhere strange and never came back.', mood: -4, durationMin: 2 * H, maxStacks: 2, icon: 'question', kind: 'bad', tags: ['social'] },
  { id: M.offended, label: 'Offended', description: 'Someone called their decay “patchy”. It is NOT patchy. It is artisanal.', mood: -10, durationMin: 8 * H, maxStacks: 2, icon: 'angry', kind: 'bad', tags: ['social'] },
  { id: M.furious, label: 'Furious', description: 'Steam is coming out of an ear. The other ear fell off last week.', mood: -15, durationMin: 3 * H, maxStacks: 1, icon: 'angry', kind: 'bad', tags: ['social', 'furious'] },
  { id: M.smellShamed, label: 'Smell-Shamed', description: 'The neighbours complained about the smell. Again. As if THEY smell like roses.', mood: -6, durationMin: 12 * H, maxStacks: 1, icon: 'flies', kind: 'bad', tags: ['social'] },
  { id: M.newRoommate, label: 'New Roommate', description: 'Someone new moved in! More company, fewer clean towels.', mood: 8, durationMin: DAY, maxStacks: 1, icon: 'house', kind: 'good', tags: ['social'] },
  { id: M.movedIn, label: 'Home Sweet Tomb', description: 'Moved in with three suitcases of grave dirt and a houseplant that bites.', mood: 10, durationMin: DAY, maxStacks: 1, icon: 'house', kind: 'good', tags: ['social'] },

  // ─────────────── Parties ───────────────
  { id: M.legendaryParty, label: 'Legendary Party', description: 'People will be talking about this one for decades. Several guests are still in the bathtub.', mood: 15, durationMin: DAY, maxStacks: 1, icon: 'party', kind: 'good', tags: ['party'] },
  { id: M.lameParty, label: 'Lame Party', description: 'Three guests, no music, one sad bowl of brain dip. The silence was deafening.', mood: -10, durationMin: 12 * H, maxStacks: 1, icon: 'sad', kind: 'bad', tags: ['party'] },
  { id: M.goodHost, label: 'Hostess with the Ghostess', description: 'Threw a perfectly respectable party. Nobody fell apart. Well, nobody important.', mood: 6, durationMin: 12 * H, maxStacks: 1, icon: 'party', kind: 'good', tags: ['party'] },

  // ─────────────── Trait conditions (moodModifiers only) ───────────────
  { id: M.nightOwlNight, label: 'Creature of the Night', description: 'Night Owl: the moon is up and so are they. Peak shambling hours.', mood: 8, durationMin: null, maxStacks: 1, icon: 'star', kind: 'good', tags: [MODIFIER_TAG] },
  { id: M.nightOwlDay, label: 'Daylight Grump', description: 'Night Owl: the sun is out and frankly it is being very loud about it.', mood: -5, durationMin: null, maxStacks: 1, icon: 'zzz', kind: 'bad', tags: [MODIFIER_TAG] },
  { id: M.vainFresh, label: 'Looking Fabulous', description: 'Vain: freshness above 80. Practically glowing. Possibly the formaldehyde.', mood: 10, durationMin: null, maxStacks: 1, icon: 'mirror', kind: 'good', tags: [MODIFIER_TAG] },
  { id: M.vainRotten, label: 'Hideous Blotches', description: 'Vain: freshness below 40. Has covered every mirror in the house with a sheet.', mood: -12, durationMin: null, maxStacks: 1, icon: 'mirror', kind: 'bad', tags: [MODIFIER_TAG] },
  { id: M.crowded, label: 'Too Many Zombies', description: 'Loner: four or more in one room. The walls are closing in. So is everyone’s smell.', mood: -5, durationMin: null, maxStacks: 1, icon: 'disgusted', kind: 'bad', tags: [MODIFIER_TAG] },
  { id: M.inTheirElement, label: 'In Their Element', description: 'Social Butterfly: a party! Everyone to talk to and nobody can leave.', mood: 8, durationMin: null, maxStacks: 1, icon: 'party', kind: 'good', tags: [MODIFIER_TAG] },

  // ─────────────── Life events ───────────────
  { id: M.moonstruck, label: 'Moonstruck', description: 'Full moon tonight. Everything feels a little howl-y and a little possible.', mood: 6, durationMin: 10 * H, maxStacks: 1, icon: 'star', kind: 'good', tags: ['event'] },
  { id: M.fanMail, label: 'Fan Mail', description: 'Someone out there wrote a whole letter about how great they are. It’s on the fridge now.', mood: 8, durationMin: DAY, maxStacks: 1, icon: 'mail', kind: 'good', tags: ['event'] },
  { id: M.cursedChainLetter, label: 'Cursed (Probably)', description: 'Didn’t forward the chain letter. Has been checking over their shoulder ever since.', mood: -6, durationMin: DAY, maxStacks: 1, icon: 'skull', kind: 'bad', tags: ['event'] },
  { id: M.chainLetterSpread, label: 'Curse Delegated', description: 'Forwarded the chain letter to ten acquaintances. Guilt-free. Mostly.', mood: 3, durationMin: 8 * H, maxStacks: 1, icon: 'mail', kind: 'good', tags: ['event'] },
  { id: M.outwittedByBird, label: 'Outwitted by a Bird', description: 'A raven swooped down and stole something shiny. It looked smug about it.', mood: -4, durationMin: 6 * H, maxStacks: 1, icon: 'sad', kind: 'bad', tags: ['event'] },
  { id: M.robbed, label: 'Robbed!', description: 'A grave-robber cleaned out the yard overnight. Ironic, considering who lives here.', mood: -8, durationMin: DAY, maxStacks: 1, icon: 'skull', kind: 'bad', tags: ['event'] },
  { id: M.lotteryWinner, label: 'Lottery Winner', description: 'A scratch card from the mail paid out! Spent it already, in their head, on embalming fluid.', mood: 15, durationMin: DAY, maxStacks: 1, icon: 'money', kind: 'good', tags: ['event'] },
  { id: M.secondWind, label: 'Second Wind', description: 'A jolt of something unholy. Feels fresh-out-of-the-ground again.', mood: 10, durationMin: DAY, maxStacks: 1, icon: 'lightning', kind: 'good', tags: ['event'] },
];
