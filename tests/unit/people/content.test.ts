/**
 * Content integrity: every GDD table row (§8 traits, §9 socials, §10 careers, §12 aspirations, reward costs),
 * id uniqueness, cross references resolvable, and the real engine validator reports nothing for people content.
 */
import { describe, expect, it } from 'vitest';
import { peopleContent } from '../../../src/sim/content/people';
import { SOCIAL_INTERACTIONS } from '../../../src/sim/content/people/socialInteractions';
import { PHONE_INTERACTIONS, SYSTEM_INTERACTIONS } from '../../../src/sim/content/people/systemInteractions';
import { TRAITS, PERSONALITY_TRAIT_IDS, REWARD_TRAIT_IDS } from '../../../src/sim/content/people/traits';
import { CAREERS } from '../../../src/sim/content/people/careers';
import { ASPIRATIONS, REWARDS } from '../../../src/sim/content/people/aspirations';
import { FIRST_NAMES, LAST_NAMES, OCCUPATIONS } from '../../../src/sim/content/people/names';
import { PEOPLE_MOODLETS } from '../../../src/sim/content/people/moodlets';
import { PEOPLE_LIFE_EVENTS } from '../../../src/sim/content/people/lifeEvents';
import { MOODLET, SOCIAL_IDS } from '../../../src/sim/content/people/ids';
import { peopleSystems } from '../../../src/sim/systems/people';
import { engineContent, loadContentFrom, validateContent } from '../../../src/sim/engine';
import { ENGINE_EFFECTS, ENGINE_REQUIREMENTS } from '../../../src/sim/vocabulary';
import { ANIM_STATES } from '../../../src/shared/appearance';

// GDD §9 table: [id, group, base, f ok, f fail, r ok | null, r fail | null]
const GDD_SOCIALS: [string, string, number, number, number, number | null, number | null][] = [
  ['social_introduce', 'Friendly', 0.95, 5, 1, null, null],
  ['social_chat', 'Friendly', 0.85, 4, -2, null, null],
  ['social_joke', 'Friendly', 0.7, 6, -4, null, null],
  ['social_complimentRot', 'Friendly', 0.75, 6, -3, null, null],
  ['social_gossip', 'Friendly', 0.75, 6, -3, null, null],
  ['social_shareRecipe', 'Friendly', 0.8, 5, -1, null, null],
  ['social_hug', 'Friendly', 0.8, 7, -5, null, null],
  ['social_bestFriends', 'Friendly', 0.7, 10, -10, null, null],
  ['social_playfulBite', 'Friendly', 0.6, 8, -10, null, null],
  ['social_flirt', 'Romantic', 0.65, 2, -3, 8, -4],
  ['social_complimentSmell', 'Romantic', 0.7, 2, -2, 7, -4],
  ['social_slowDance', 'Romantic', 0.7, 3, -2, 9, -5],
  ['social_kiss', 'Romantic', 0.7, 3, -6, 12, -8],
  ['social_askPartner', 'Romantic', 0.7, 5, -10, 10, -15],
  ['social_propose', 'Romantic', 0.75, 5, -15, 10, -25],
  ['social_elope', 'Romantic', 0.95, 10, 0, 10, 0],
  ['social_moveIn', 'Friendly', 0.75, 5, -8, null, null],
  ['social_breakUp', 'Mean', 0.95, -40, -40, -60, -60],
  ['social_argue', 'Mean', 0.8, -8, -4, -4, -2],
  ['social_insultDecay', 'Mean', 0.85, -14, -6, -8, -4],
  ['social_askToLeave', 'Mean', 0.95, -3, -3, null, null],
  ['social_inviteStay', 'Friendly', 0.8, 3, -1, null, null],
  ['social_welcome', 'Friendly', 1.0, 2, 0, null, null],
  ['social_waveOver', 'Friendly', 0.85, 2, 0, null, null],
];

// GDD §10 careers: [id, startHour, hours, days, [title, wage, reqLevel]×5] (L1 +$3 / L2 +$2 since the balance pass)
const GDD_CAREERS: [string, string, number, number, number[], [string, number, number][]][] = [
  ['retail', 'charisma', 22, 6, [0, 1, 2, 3, 4], [['Night Stocker', 17, 0], ['Cashier', 20, 1], ['Shift Lead', 24, 3], ['Assistant Manager', 32, 5], ['Store Manager', 44, 7]]],
  ['mortuary', 'mortuary', 9, 8, [0, 1, 2, 3, 4], [['Body Washer', 19, 0], ['Embalmer’s Assistant', 24, 2], ['Embalmer', 31, 4], ['Funeral Director', 43, 6], ['Chief Mortician', 60, 8]]],
  ['politics', 'charisma', 10, 7, [0, 1, 2, 3, 4], [['Campaign Volunteer', 15, 0], ['Council Aide', 22, 2], ['City Councilor', 30, 4], ['Deputy Mayor', 45, 6], ['Mayor of Wormwood', 70, 9]]],
  ['culinary', 'cooking', 16, 7, [2, 3, 4, 5, 6], [['Dishwasher', 16, 0], ['Line Cook', 21, 2], ['Sous Chef', 28, 4], ['Head Chef', 40, 6], ['Celebrity Brain Chef', 58, 8]]],
  ['necrotech', 'logic', 9, 8, [0, 1, 2, 3, 4], [['Tech Support Ghoul', 20, 0], ['Junior Coder', 27, 2], ['Senior Developer', 36, 4], ['Lead Architect', 50, 6], ['CTO of the Undead', 72, 8]]],
];

describe('people content: social interactions (GDD §9)', () => {
  it('defines every §9 row with exactly the GDD numbers', () => {
    expect(SOCIAL_INTERACTIONS.map((d) => d.id).sort()).toEqual(GDD_SOCIALS.map((r) => r[0]).sort());
    for (const [id, group, base, fo, ff, ro, rf] of GDD_SOCIALS) {
      const d = SOCIAL_INTERACTIONS.find((x) => x.id === id)!;
      expect(d.group, id).toBe(group);
      expect(d.targetKind, id).toBe('agent');
      expect(d.behavior, id).toBe('social');
      expect(d.social!.baseChance, id).toBe(base);
      expect(d.social!.friendship, id).toEqual([fo, ff]);
      if (ro === null) expect(d.social!.romance, id).toBeUndefined();
      else expect(d.social!.romance, id).toEqual([ro, rf]);
      expect(d.social!.social, id).toBe(8);
      expect(d.social!.charismaXp, id).toBe(6);
      if (id === 'social_waveOver') {
        // waved at from the yard (no chasing walkers down the sidewalk), adjacent as the fallback
        expect(d.stage!.target, id).toEqual({ kind: 'tileNear', radius: 5, of: 'target' });
        expect(d.stage!.fallback, id).toEqual({ kind: 'agentAdjacent' });
      } else expect(d.stage!.target.kind, id).toBe('agentAdjacent');
      expect(ANIM_STATES as readonly string[], id).toContain(d.stage!.anim);
      expect(ANIM_STATES as readonly string[], id).toContain(d.social!.targetAnim);
    }
  });

  it('uses GDD durations (10 min, kiss/hug 6, propose 12)', () => {
    for (const d of SOCIAL_INTERACTIONS) {
      const want = d.id === 'social_kiss' || d.id === 'social_hug' ? 6 : d.id === 'social_propose' ? 12 : 10;
      expect(d.stage!.duration, d.id).toBe(want);
    }
  });

  it('encodes the GDD gates', () => {
    const g = (id: string) => SOCIAL_INTERACTIONS.find((d) => d.id === id)!;
    expect(g('social_introduce').params!.gate).toBe('notMet');
    expect(g('social_introduce')).toMatchObject({ hidden: true, autonomous: true }); // auto first interaction
    for (const id of ['social_chat', 'social_joke', 'social_complimentRot']) expect(g(id).params!.autoIntroduce, id).toBe(true);
    expect(g('social_chat').params!.gate).toBe('met');
    expect(g('social_gossip').social!.minFriendship).toBe(20);
    expect(g('social_shareRecipe').social!.minFriendship).toBe(10);
    expect(g('social_shareRecipe').requires).toContainEqual({ id: 'skill', params: { skill: 'cooking', min: 2 } });
    expect(g('social_hug').social!.minFriendship).toBe(30);
    expect(g('social_bestFriends').social!.minFriendship).toBe(75);
    expect(g('social_playfulBite').social!.minFriendship).toBe(40);
    expect(g('social_flirt').social!.minFriendship).toBe(10);
    expect(g('social_complimentSmell').social!.minRomance).toBe(10);
    expect(g('social_slowDance').social!.minRomance).toBe(25);
    expect(g('social_kiss').social!.minRomance).toBe(40);
    expect(g('social_askPartner').social!.minRomance).toBe(60);
    expect(g('social_askPartner').social!.minFriendship).toBe(40);
    expect(g('social_askPartner').social!.status).toBe('notPartnered');
    expect(g('social_propose').social!.status).toBe('partners');
    expect(g('social_propose').social!.minRomance).toBe(80);
    expect(g('social_elope').social!.status).toBe('engaged');
    expect(g('social_breakUp').social!.status).toBe('partnersOrMore');
    expect(g('social_moveIn').params!.moveInMinFriendship).toBe(50);
    expect(g('social_moveIn').params!.householdCap).toBe(8);
    expect(g('social_welcome').params!.gate).toBe('visitorWaiting');
    expect(g('social_waveOver').params!.gate).toBe('walkBy');
    expect(g('social_askToLeave').params!.gate).toBe('visitor');
    expect(g('social_inviteStay').params!.gate).toBe('visitor');
  });

  it('special outcomes, fun and trait modifiers match the notes column', () => {
    const g = (id: string) => SOCIAL_INTERACTIONS.find((d) => d.id === id)!;
    const outcomes: Record<string, string> = {
      social_introduce: 'introduce', social_bestFriends: 'bestFriends', social_playfulBite: 'bite', social_askPartner: 'becomePartners',
      social_propose: 'propose', social_elope: 'marry', social_moveIn: 'moveIn', social_breakUp: 'breakUp', social_askToLeave: 'askToLeave',
      social_inviteStay: 'inviteToStay', social_welcome: 'welcome', social_waveOver: 'waveOver',
    };
    for (const [id, o] of Object.entries(outcomes)) expect(g(id).social!.outcome, id).toBe(o);
    expect(g('social_joke').social!.fun).toBe(8);
    expect(g('social_gossip').social!.fun).toBe(6);
    expect(g('social_joke').params!['targetTrait.grumpy']).toBe(-0.25);
    expect(g('social_joke').params!['actorTrait.cheerful']).toBe(0.15);
    expect(g('social_complimentRot').params!['targetTrait.vain']).toBe(0.2);
    for (const id of ['social_breakUp', 'social_argue', 'social_insultDecay', 'social_askToLeave']) {
      expect(g(id).params!['actorTrait.grumpy'], id).toBe(0.15);
      expect(g(id).params!['actorTrait.hothead'], id).toBe(0.2);
    }
    expect(g('social_insultDecay').social!.successMoodlets).toContainEqual({ id: 'offended', to: 'target' });
    expect(g('social_flirt').traitAd!.hopelessRomantic).toBeGreaterThan(0);
    expect(g('social_argue').traitAd!.hothead).toBeGreaterThan(0);
    expect(g('social_argue').traitAd!.grumpy).toBeGreaterThan(0);
    expect(g('social_joke').traitAd!.cheerful).toBeGreaterThan(0);
    expect(g('social_joke').traitAd!.partyAnimal).toBeGreaterThan(0);
  });

  it('friendly socials are visitor-allowed; romance/mean/hosting ones are not', () => {
    for (const d of SOCIAL_INTERACTIONS) {
      const hostOnly = ['social_welcome', 'social_waveOver', 'social_inviteStay', 'social_askToLeave', 'social_moveIn', 'social_bestFriends'].includes(d.id);
      if (d.group === 'Friendly' && !hostOnly) expect(d.visitorAllowed, d.id).toBe(true);
      else expect(d.visitorAllowed, d.id).toBe(false);
    }
  });
});

describe('people content: phone + system interactions', () => {
  it('phone interactions use group Phone, target self, behaviour phone, anim phone, 5 minutes', () => {
    expect(PHONE_INTERACTIONS.map((d) => d.id).sort()).toEqual(
      ['phone_callInSick', 'phone_findJob', 'phone_inviteOver', 'phone_orderPizza', 'phone_quitJob', 'phone_throwParty'].sort(),
    );
    for (const d of PHONE_INTERACTIONS) {
      expect(d.group).toBe('Phone');
      expect(d.targetKind).toBe('self');
      expect(d.behavior).toBe('phone');
      expect(d.stage!.anim).toBe('phone');
      expect(d.stage!.duration).toBe(5);
      // Only Order Brain Pizza is autonomous — as a gated emergency meal (phone behaviour adjustScore); every other
      // call is player-driven.
      expect(d.autonomous).toBe(d.id === 'phone_orderPizza');
      expect(d.requires![0]).toEqual({ id: 'household' });
    }
    expect(PHONE_INTERACTIONS.find((d) => d.id === 'phone_orderPizza')!.advertise).toEqual({ hunger: 50 });
  });

  it('system interactions are hidden, never autonomous, never player-queued', () => {
    expect(SYSTEM_INTERACTIONS.map((d) => d.id).sort()).toEqual(['career_goToWork', 'visit_leave', 'visit_linger', 'visit_waitAtDoor', 'visit_walkBy'].sort());
    for (const d of SYSTEM_INTERACTIONS) {
      expect(d.hidden).toBe(true);
      expect(d.autonomous).toBe(false);
      expect(d.playerAllowed).toBe(false);
    }
    expect(SYSTEM_INTERACTIONS.find((d) => d.id === 'career_goToWork')!.stage!.target.kind).toBe('exit');
    // the doorbell is rung by the visit behaviour on a per-visit schedule, never by a stage sfxStart (a door wait
    // the engine restarts after a social must not ring again at once)
    expect(SYSTEM_INTERACTIONS.find((d) => d.id === 'visit_waitAtDoor')!.stage!.sfxStart).toBeUndefined();
  });
});

describe('people content: traits (GDD §8)', () => {
  it('has all 18 personality + 5 reward traits', () => {
    expect(PERSONALITY_TRAIT_IDS).toHaveLength(18);
    expect(REWARD_TRAIT_IDS).toHaveLength(5);
    expect(TRAITS.map((t) => t.id).sort()).toEqual([...PERSONALITY_TRAIT_IDS, ...REWARD_TRAIT_IDS].sort());
    for (const t of TRAITS) expect(t.reward, t.id).toBe((REWARD_TRAIT_IDS as readonly string[]).includes(t.id));
  });

  it('conflicts are symmetric and match the GDD', () => {
    const byId = Object.fromEntries(TRAITS.map((t) => [t.id, t]));
    for (const t of TRAITS) for (const c of t.conflicts) expect(byId[c].conflicts, `${t.id}<->${c}`).toContain(t.id);
    expect(byId.neatFreak.conflicts).toEqual(['slob']);
    expect(byId.socialButterfly.conflicts).toEqual(['loner']);
    expect(byId.grumpy.conflicts).toEqual(['cheerful']);
    expect(byId.cheerful.conflicts.sort()).toEqual(['grumpy', 'hothead']);
    expect(byId.lazy.conflicts).toEqual(['ambitious']);
  });

  it('provides the agreed mult keys and GDD numbers', () => {
    const t = Object.fromEntries(TRAITS.map((x) => [x.id, x]));
    expect(t.clumsy.mult).toMatchObject({ limbLoss: 2, fireChance: 1.5 });
    expect(t.wellPreserved.mult).toMatchObject({ decay: 0.7 });
    expect(t.ironStitches.mult).toMatchObject({ limbLoss: 0 });
    expect(t.castIronStomach.mult).toMatchObject({ spoilSick: 0 });
    expect(t.ambitious.mult).toMatchObject({ careerPerf: 1.25 });
    expect(t.partyAnimal.mult).toMatchObject({ partyScore: 1.15 });
    expect(t.nightOwl.mult).toMatchObject({ nightEnergyDecay: 0.8 });
    expect(t.hothead.mult).toMatchObject({ 'moodletDuration:furious': 2 });
    expect(t.gourmand.needDecay).toEqual({ hunger: 1.2 });
    expect(t.gourmand.skillGain).toEqual({ cooking: 1.25 });
    expect(t.gourmand.tagAd!.cook).toBe(20);
    expect(t.neatFreak.needDecay).toEqual({ hygiene: 1.15 });
    expect(t.neatFreak.tagAd!.clean).toBe(40);
    expect(t.slob.needDecay).toEqual({ hygiene: 0.85 });
    expect(t.socialButterfly.needDecay).toEqual({ social: 1.3 });
    expect(t.socialButterfly.socialBonus).toBe(0.1);
    expect(t.loner.needDecay).toEqual({ social: 0.6 });
    expect(t.hopelessRomantic.romanceMult).toBe(1.5);
    expect(t.grumpy.baseMood).toBe(-6);
    expect(t.cheerful.baseMood).toBe(6);
    expect(t.vain.tagAd!.mirror).toBe(30);
    expect(t.lazy.needDecay).toEqual({ energy: 1.2 });
    expect(t.lazy.skillGain).toEqual({ fitness: 0.5 });
    expect(Object.values(t.ambitious.skillGain!).every((v) => v === 1.1)).toBe(true);
    expect(t.bookworm.skillGain).toEqual({ logic: 1.2 });
    expect(t.bookworm.mult!.readingFun).toBe(2);
    expect(t.partyAnimal.needDecay).toEqual({ fun: 1.2 });
    expect(t.artistic.skillGain).toEqual({ creativity: 1.3 });
    expect(t.silverTongue.socialBonus).toBe(0.15);
    expect(t.deepSleeper.needGain).toEqual({ energy: 1.3 });
  });
});

describe('people content: skills (GDD §7, engine-owned)', () => {
  it('registers no SkillDefs; the engine provides all six with the GDD xp curve', () => {
    expect(peopleContent.skills).toBeUndefined();
    const reg = loadContentFrom([engineContent, peopleContent]);
    expect(Object.keys(reg.skills).sort()).toEqual(['charisma', 'cooking', 'creativity', 'fitness', 'logic', 'mortuary']);
    for (const s of Object.values(reg.skills)) expect(s.xpPerLevel).toEqual([100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200]);
  });
});

describe('people content: careers (GDD §10)', () => {
  it('has all five tracks × five levels exactly per the table', () => {
    expect(CAREERS.map((c) => c.id).sort()).toEqual(GDD_CAREERS.map((c) => c[0]).sort());
    for (const [id, skill, start, hours, days, rows] of GDD_CAREERS) {
      const c = CAREERS.find((x) => x.id === id)!;
      expect(c.skill, id).toBe(skill);
      expect(c.levels).toHaveLength(5);
      c.levels.forEach((l, i) => {
        expect(l.title, `${id} L${i + 1}`).toBe(rows[i][0]);
        expect(l.wage, `${id} L${i + 1}`).toBe(rows[i][1]);
        expect(l.startHour).toBe(start);
        expect(l.hours).toBe(hours);
        expect(l.days).toEqual(days);
        const next = rows[i + 1];
        expect(l.promoteReq, `${id} L${i + 1}`).toEqual(next ? [{ skill, level: next[2] }] : []);
      });
    }
  });

  it('has three work events per track, each with a safe default and careerChoice options', () => {
    for (const c of CAREERS) {
      expect(c.workEvents, c.id).toHaveLength(3);
      for (const ev of c.workEvents) {
        expect(ev.options.length).toBeGreaterThanOrEqual(2);
        expect(ev.options.filter((o) => o.params.safe === true), ev.id).toHaveLength(1);
        for (const o of ev.options) {
          expect(o.effect).toBe('careerChoice');
          if (typeof o.params.moodlet === 'string') expect(PEOPLE_MOODLETS.map((m) => m.id)).toContain(o.params.moodlet);
          if (typeof o.params.failMoodlet === 'string') expect(PEOPLE_MOODLETS.map((m) => m.id)).toContain(o.params.failMoodlet);
        }
      }
    }
  });
});

describe('people content: aspirations + rewards (GDD §12, §8)', () => {
  it('has the five aspirations with GDD milestone points', () => {
    const pts = Object.fromEntries(ASPIRATIONS.map((a) => [a.id, a.milestones.map((m) => m.points)]));
    expect(pts).toEqual({
      tycoon: [250, 400, 600, 1000],
      afterparty: [250, 350, 550, 900],
      eternalRomance: [250, 400, 600, 900],
      masterPreserver: [250, 400, 600, 1000],
      renaissanceCorpse: [250, 350, 600, 1000],
    });
  });

  it('prices rewards per GDD', () => {
    const cost = Object.fromEntries(REWARDS.map((r) => [r.traitId ?? r.id, r.cost]));
    expect(cost).toEqual({ wellPreserved: 1200, ironStitches: 900, castIronStomach: 400, silverTongue: 700, deepSleeper: 500, reward_secondWind: 600 });
    expect(REWARDS.find((r) => r.id === 'reward_secondWind')!.effect).toEqual({ id: 'addVitality', params: { amount: 20 } });
  });
});

describe('people content: names, moodlets, life events', () => {
  it('has ~140 first names, ~90 last names, ~35 occupations, all unique', () => {
    expect(FIRST_NAMES.length).toBeGreaterThanOrEqual(140);
    expect(LAST_NAMES.length).toBeGreaterThanOrEqual(90);
    expect(OCCUPATIONS.length).toBeGreaterThanOrEqual(35);
    for (const list of [FIRST_NAMES, LAST_NAMES, OCCUPATIONS]) expect(new Set(list).size).toBe(list.length);
  });

  it('every moodlet in MOODLET is defined exactly once', () => {
    const ids = PEOPLE_MOODLETS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.values(MOODLET).sort());
    for (const m of PEOPLE_MOODLETS) {
      expect(m.label.length, m.id).toBeGreaterThan(2);
      expect(m.description.length, m.id).toBeGreaterThan(10);
    }
  });

  it('owns the six GDD §13 people life events', () => {
    expect(PEOPLE_LIFE_EVENTS.map((e) => e.id).sort()).toEqual(
      ['ev_chainLetter', 'ev_fanLetter', 'ev_graveRobber', 'ev_lotteryTicket', 'ev_neighbourComplains', 'ev_ravenThief'].sort(),
    );
    expect(PEOPLE_LIFE_EVENTS.find((e) => e.id === 'ev_lotteryTicket')!.hourlyChance).toBe(0.01);
    expect(PEOPLE_LIFE_EVENTS.find((e) => e.id === 'ev_graveRobber')!.hourlyChance).toBe(0.04);
  });
});

describe('people content: references resolve', () => {
  const effects = new Set<string>([...Object.values(ENGINE_EFFECTS), ...peopleSystems.flatMap((s) => Object.keys(s.effects ?? {}))]);
  const reqs = new Set<string>([...Object.values(ENGINE_REQUIREMENTS), ...peopleSystems.flatMap((s) => Object.keys(s.requirements ?? {}))]);
  const behaviors = new Set<string>(peopleSystems.flatMap((s) => Object.keys(s.behaviors ?? {})));

  it('every behaviour / requirement / effect id used by people content is registered', () => {
    for (const d of peopleContent.interactions ?? []) {
      expect(behaviors.has(d.behavior ?? 'standard'), d.id).toBe(true);
      for (const r of d.requires ?? []) expect(reqs.has(r.id), `${d.id} requires ${r.id}`).toBe(true);
    }
    for (const c of peopleContent.careers ?? []) for (const ev of c.workEvents) for (const o of ev.options) expect(effects.has(o.effect)).toBe(true);
    for (const r of peopleContent.rewards ?? []) if (r.effect) expect(effects.has(r.effect.id)).toBe(true);
    for (const ev of peopleContent.lifeEvents ?? []) {
      if (ev.effect) expect(effects.has(ev.effect.id), ev.id).toBe(true);
      for (const o of ev.choice?.options ?? []) expect(effects.has(o.effect), ev.id).toBe(true);
    }
  });

  it('every condition kind (incl. nested and/or/not) is registered by the engine or people systems', () => {
    const kinds = new Set<string>(['always', 'never', 'funds', 'skill', 'stat', 'moodlet', 'trait', 'flag', 'and', 'or', 'not', ...peopleSystems.flatMap((s) => Object.keys(s.conditions ?? {}))]);
    const walk = (c: { kind: string; params: Record<string, unknown> }, where: string) => {
      expect(kinds.has(c.kind), `${where}: ${c.kind}`).toBe(true);
      for (const sub of [...((c.params.all as never[]) ?? []), ...((c.params.any as never[]) ?? [])]) walk(sub, where);
      if (c.params.cond) walk(c.params.cond as never, where);
    };
    for (const a of peopleContent.aspirations ?? []) for (const m of a.milestones) walk(m.condition, m.id);
    for (const ev of peopleContent.lifeEvents ?? []) walk(ev.condition, ev.id);
  });

  it('the real engine validator finds no problems with engine + people content', () => {
    const reg = loadContentFrom([engineContent, peopleContent]);
    const problems = validateContent(reg, peopleSystems);
    expect(problems).toEqual([]);
  });

  it('social ids constant matches the content', () => {
    expect(Object.values(SOCIAL_IDS).sort()).toEqual(SOCIAL_INTERACTIONS.map((d) => d.id).sort());
  });
});
