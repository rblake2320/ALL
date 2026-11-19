/**
 * upkeep system: wear & repair, fire lifecycle, lights & stereo loops, stench / mess / flies, room environment
 * mood, and the leisure behaviours (TV channels, reading genres, painting, dancing, sitting).
 */
import { describe, expect, it } from 'vitest';
import { DATA, IX, MOOD } from '../../../src/sim/content/home/ids';
import { startFire, spreadFrom } from '../../../src/sim/systems/home/upkeep/fire';
import { paintingValue } from '../../../src/sim/systems/home/upkeep/behaviors';
import { environmentMood } from '../../../src/sim/systems/home/upkeep/mess';
import { preservationDecayPerHour } from '../../../src/sim/systems/home/decay/rates';
import { tickAt } from '../../../src/sim/time';
import { FakeSim, kitchenLot } from './fakeCtx';

const obj = (sim: FakeSim, defId: string) => ({ kind: 'object' as const, id: sim.obj(defId).id });

describe('wear & repair', () => {
  it('a completed appliance use can break it: condition.broken, sparks, warning', () => {
    const sim = new FakeSim({ objects: [{ defId: 'tv_crt', x: 5, z: 5 }, { defId: 'sofa_moldy', x: 5, z: 8 }] });
    const a = sim.member();
    sim.forcedChance = true;
    sim.start(a, IX.watchTv, obj(sim, 'tv_crt'), { channel: 'horror' });
    sim.runToEnd(a);
    const tv = sim.obj('tv_crt');
    expect(tv.condition.broken).toBe(true); // rolled on the TV (queued target), not the sofa (stage object)
    expect(sim.obj('sofa_moldy').condition.broken).toBe(false);
    expect(sim.eventsOf('fx').some((e) => e.kind === 'zap' && e.objectId === tv.id)).toBe(true);
    expect(sim.notificationsText()).toMatch(/Flickering CRT broke/);
    expect(sim.canStart(a, IX.watchTv, obj(sim, 'tv_crt'))).toMatch(/broken/);
  });

  it('Repair fixes it; logic 5+ never gets zapped', () => {
    const sim = new FakeSim({ objects: [{ defId: 'microwave_nuke', x: 5, z: 5 }], members: [{ skills: { logic: 5 } }] });
    const a = sim.member();
    const mw = sim.obj('microwave_nuke');
    expect(sim.canStart(a, IX.repair, obj(sim, 'microwave_nuke'))).toMatch(/isn't broken/);
    mw.condition.broken = true;
    sim.forcedChance = true;
    sim.start(a, IX.repair, obj(sim, 'microwave_nuke'));
    sim.runToEnd(a);
    expect(mw.condition.broken).toBe(false);
    expect(sim.ctx.hasMoodlet(a, MOOD.zapped)).toBe(false);
    expect(sim.ctx.statValue('repairs', a.id)).toBe(1);
  });
});

describe('fire', () => {
  it('spreads to adjacent flammables, burns to ash after 60 min, and panics / singes nearby zombies', () => {
    const sim = new FakeSim({ objects: kitchenLot(), members: [{ pos: { x: 3.5, z: 3.4 } }] });
    const a = sim.member();
    a.rewardTraits.push('ironStitches');
    const stove = sim.obj('stove_greasefire');
    const fire = startFire(sim.ctx, stove)!;
    expect(fire.defId).toBe('item_fire');
    expect(stove.condition.burning).toBe(true);
    expect(startFire(sim.ctx, stove)!.id).toBe(fire.id); // already burning → same fire
    expect(sim.eventsOf('sfxLoop').some((e) => e.id === 'fireLoop' && e.on)).toBe(true);
    // neighbours: counter (4,2) and fridge (2,2); sink is plumbing → never burns
    sim.forcedChance = true;
    const spread = spreadFrom(sim.ctx, stove)!;
    expect(['counter_butcher', 'fridge_humming']).toContain(spread.defId === 'item_fire' ? sim.state.objects[spread.data.burningId as string].defId : '');
    sim.forcedChance = false;
    const pres = a.needs.preservation;
    sim.advance(5);
    expect(sim.ctx.hasMoodlet(a, MOOD.panicking)).toBe(true);
    expect(a.needs.preservation).toBeLessThan(pres - 0.8); // −10/h within 1.5 tiles
    sim.advance(56);
    expect(sim.state.objects[stove.id]).toBeUndefined();
    expect(sim.objs('item_ash').length).toBeGreaterThanOrEqual(1);
    expect(sim.objs('sink_rusty')).toHaveLength(1);
    expect(sim.eventsOf('sfxLoop').some((e) => e.id === 'fireLoop' && !e.on)).toBe(true);
  });

  it('Fight Fire: 70% success extinguishes; failure re-queues another attempt', () => {
    // an isolated sofa: nothing adjacent, so forced chances can't make the fire spread
    const sim = new FakeSim({ objects: [{ defId: 'sofa_moldy', x: 10, z: 10 }] });
    const a = sim.member();
    const stove = sim.obj('sofa_moldy');
    const fire = startFire(sim.ctx, stove)!;
    sim.forcedChance = false;
    sim.start(a, IX.fightFire, { kind: 'object', id: fire.id });
    sim.runToEnd(a);
    expect(sim.state.objects[fire.id]).toBeDefined();
    expect(a.queue[0]).toMatchObject({ interactionId: IX.fightFire, params: { attempt: 2 } });
    sim.forcedChance = true;
    a.queue = [];
    sim.start(a, IX.fightFire, { kind: 'object', id: fire.id });
    sim.runToEnd(a);
    expect(sim.state.objects[fire.id]).toBeUndefined();
    expect(stove.condition.burning).toBe(false);
    expect(sim.state.objects[stove.id]).toBeDefined();
    expect(sim.ctx.statValue('firesFought', a.id)).toBe(1);
  });

  it('never ignites non-flammables, held items or wall items', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'painting_greatgrand', x: 3, z: 9 }] });
    expect(startFire(sim.ctx, sim.obj('sink_rusty'))).toBeNull();
    expect(startFire(sim.ctx, sim.obj('painting_greatgrand'))).toBeNull();
    expect(startFire(sim.ctx, sim.obj('mailbox_crooked'))).toBeNull();
  });
});

describe('lights & stereo', () => {
  it('toggles lamps (labels follow state; candles say Light / Snuff Out)', () => {
    const sim = new FakeSim({ objects: [{ defId: 'lamp_skull', x: 3, z: 3 }, { defId: 'candelabra_drippy', x: 6, z: 3 }] });
    const a = sim.member();
    const beh = sim.sys('upkeep').behaviors!.toggle;
    const def = sim.content.interactions[IX.toggleLight];
    expect(beh.label!(sim.ctx, a, def, obj(sim, 'lamp_skull'))).toBe('Turn Off');
    expect(beh.label!(sim.ctx, a, def, obj(sim, 'candelabra_drippy'))).toBe('Snuff Out');
    sim.start(a, IX.toggleLight, obj(sim, 'lamp_skull'));
    sim.runToEnd(a);
    expect(sim.obj('lamp_skull').data.on).toBe(false);
    expect(beh.label!(sim.ctx, a, def, obj(sim, 'lamp_skull'))).toBe('Turn On');
  });

  it('the stereo plays a loop that follows the power; it can be switched off in a blackout but not on', () => {
    const sim = new FakeSim({ objects: [{ defId: 'stereo_boombox', x: 3, z: 3 }], systems: undefined });
    const a = sim.member();
    sim.start(a, IX.stereoToggle, obj(sim, 'stereo_boombox'));
    sim.runToEnd(a);
    const stereo = sim.obj('stereo_boombox');
    expect(stereo.data.playing).toBe(true);
    const loops = () => sim.eventsOf('sfxLoop').filter((e) => e.key === `stereo:${stereo.id}`);
    expect(loops().at(-1)!.on).toBe(true);
    sim.state.household.utilitiesOn = false;
    sim.sys('upkeep').tick!(sim.ctx, 0.25);
    expect(loops().at(-1)!.on).toBe(false);
    expect(sim.ctx.hasMoodlet(a, MOOD.powerOut)).toBe(true);
    const def = sim.content.interactions[IX.stereoToggle];
    expect(sim.sys('upkeep').behaviors!.toggle.available!(sim.ctx, a, def, obj(sim, 'stereo_boombox'))).toBe(true); // turning OFF is fine
    stereo.data.playing = false;
    expect(sim.sys('upkeep').behaviors!.toggle.available!(sim.ctx, a, def, obj(sim, 'stereo_boombox'))).toBe('The power is out');
  });

  it('init(loaded) re-emits loops for playing stereos and fires (audio state is not saved)', () => {
    const sim = new FakeSim({ objects: [{ defId: 'stereo_boombox', x: 3, z: 3, data: { playing: true } }, { defId: 'sofa_moldy', x: 8, z: 8 }] });
    startFire(sim.ctx, sim.obj('sofa_moldy'));
    sim.events = [];
    sim.sys('upkeep').init!(sim.ctx, true);
    const keys = sim.eventsOf('sfxLoop').filter((e) => e.on).map((e) => e.id);
    expect(keys).toEqual(expect.arrayContaining(['stereoMusic', 'fireLoop']));
  });
});

describe('mess, flies, stench, environment', () => {
  it('dishes draw flies after 6 h unless a powered zapper is near', () => {
    const sim = new FakeSim({ objects: [{ defId: 'item_dish', x: 3, z: 3, data: { createdTick: 0 } }, { defId: 'item_dish', x: 15, z: 15, data: { createdTick: 0 } }, { defId: 'zapper_fly', x: 4, z: 4 }] });
    sim.advance(7 * 60);
    const [near, far] = sim.objs('item_dish');
    expect(near.data.flies ?? false).toBe(false);
    expect(far.data.flies).toBe(true);
    sim.state.household.utilitiesOn = false;
    sim.sys('upkeep').hour!(sim.ctx, 1);
    expect(near.data.flies).toBe(true);
  });

  it('a reeking zombie gives others Stench Nearby, a diffuser softens it, slobs do not care', () => {
    const sim = new FakeSim({
      objects: [],
      members: [
        { firstName: 'Stinky', needs: { hygiene: 0 }, pos: { x: 5, z: 5 } },
        { firstName: 'Near', pos: { x: 6, z: 5 } },
        { firstName: 'Slob', traits: ['slob'], pos: { x: 5, z: 6 } },
        { firstName: 'Far', pos: { x: 15, z: 15 } },
      ],
    });
    const [stinky, near, slob, far] = [0, 1, 2, 3].map((i) => sim.member(i));
    sim.advance(5);
    expect(sim.ctx.hasMoodlet(stinky, MOOD.reeking)).toBe(true);
    expect(sim.ctx.hasMoodlet(near, MOOD.stenchNearby)).toBe(true);
    expect(sim.ctx.hasMoodlet(slob, MOOD.stenchNearby)).toBe(false);
    expect(sim.ctx.hasMoodlet(far, MOOD.stenchNearby)).toBe(false);
    near.moodlets = [];
    sim.addObject({ defId: 'diffuser_formaldehyde', x: 8, z: 8 });
    sim.advance(5);
    expect(sim.ctx.hasMoodlet(near, MOOD.faintStench)).toBe(true);
    expect(sim.ctx.hasMoodlet(near, MOOD.stenchNearby)).toBe(false);
  });

  it('Neat Freaks near mess get Disgusted by Mess', () => {
    const sim = new FakeSim({ objects: [{ defId: 'item_dish', x: 5, z: 5 }], members: [{ traits: ['neatFreak'], pos: { x: 6, z: 6 } }, { pos: { x: 6, z: 5 } }] });
    sim.advance(5);
    expect(sim.ctx.hasMoodlet(sim.member(0), MOOD.disgustedByMess)).toBe(true);
    expect(sim.ctx.hasMoodlet(sim.member(1), MOOD.disgustedByMess)).toBe(false);
  });

  it('room environment maps −10..10 to −8..+8; slobs ignore the bad part, neat freaks feel it 1.5×', () => {
    const sim = new FakeSim({ members: [{}, { traits: ['slob'] }, { traits: ['neatFreak'] }] });
    const [a, slob, neat] = [0, 1, 2].map((i) => sim.member(i));
    sim.env = 10;
    expect(environmentMood(sim.ctx, a)).toEqual([{ label: 'Lovely Surroundings', value: 8 }]);
    sim.env = -10;
    expect(environmentMood(sim.ctx, a)[0].value).toBe(-8);
    expect(environmentMood(sim.ctx, slob)).toEqual([]);
    expect(environmentMood(sim.ctx, neat)[0].value).toBe(-8);
    sim.env = -4;
    expect(environmentMood(sim.ctx, neat)[0].value).toBe(-5);
    sim.env = 0;
    expect(environmentMood(sim.ctx, a)).toEqual([]);
  });
});

describe('leisure behaviours', () => {
  it('TV: cooking channel teaches cooking, the Séance TV is 30% more fun, Lazy zombies ×1.3', () => {
    const run = (tv: string, traits: string[], channel: string) => {
      const sim = new FakeSim({ objects: [{ defId: tv, x: 5, z: 5 }, { defId: 'sofa_moldy', x: 5, z: 8 }], members: [{ traits, needs: { fun: 10 } }] });
      const a = sim.member();
      sim.forcedChance = false;
      sim.start(a, IX.watchTv, { kind: 'object', id: sim.obj(tv).id }, { channel });
      sim.advance(30);
      return a;
    };
    const base = run('tv_crt', [], 'soaps');
    const seance = run('tv_seance', [], 'soaps');
    const lazy = run('tv_crt', ['lazy'], 'soaps');
    const cooking = run('tv_crt', [], 'cooking');
    expect(base.needs.fun).toBeCloseTo(10 + 10, 1); // 20 fun/h (balance pass: was 14) × 30 min
    expect(seance.needs.fun - 10).toBeCloseTo((base.needs.fun - 10) * 1.3, 1);
    expect(lazy.needs.fun - 10).toBeCloseTo((base.needs.fun - 10) * 1.3, 1);
    expect(cooking.skills.cooking.xp).toBeCloseTo(3, 3);
    expect(base.needs.social).toBeGreaterThan(80); // soaps: parasocial company
  });

  it('reading: genre picks the skill; bookworms get double fun', () => {
    for (const [genre, skill, xp] of [['mortuary', 'mortuary', 35], ['logic', 'logic', 25], ['cookbook', 'cooking', 15]] as const) {
      const sim = new FakeSim({ objects: [{ defId: 'shelf_moldering', x: 3, z: 3 }, { defId: 'chair_creaky', x: 5, z: 5 }] });
      const a = sim.member();
      sim.start(a, IX.read, obj(sim, 'shelf_moldering'), { genre });
      sim.runToEnd(a);
      expect(a.skills[skill].xp + a.skills[skill].level * 100).toBeCloseTo(xp, 0);
      expect(a.carrying).toBeNull();
    }
    const sim = new FakeSim({ objects: [{ defId: 'shelf_moldering', x: 3, z: 3 }, { defId: 'chair_creaky', x: 5, z: 5 }], members: [{ needs: { fun: 0 } }, { traits: ['bookworm'], needs: { fun: 0 } }] });
    for (const m of [sim.member(0), sim.member(1)]) {
      sim.start(m, IX.read, obj(sim, 'shelf_moldering'), { genre: 'logic' });
      sim.runToEnd(m);
    }
    expect(sim.member(1).needs.fun).toBeCloseTo(sim.member(0).needs.fun * 2, 0);
  });

  it('painting: progress persists in easel data; finishing spawns a painting worth 40 + 25·c^1.35·rand(0.8,1.2)', () => {
    const sim = new FakeSim({ objects: [{ defId: 'easel_morbid', x: 3, z: 3 }], members: [{ skills: { creativity: 3 } }] });
    const a = sim.member();
    const easel = sim.obj('easel_morbid');
    sim.start(a, IX.paint, obj(sim, 'easel_morbid'));
    sim.runToEnd(a);
    const p1 = easel.data[DATA.progress] as number;
    expect(p1).toBeGreaterThan(0.3);
    expect(p1).toBeLessThan(1);
    expect(easel.data[DATA.artistId]).toBe(a.id);
    while (sim.objs('item_painting').length === 0) {
      sim.start(a, IX.paint, obj(sim, 'easel_morbid'));
      sim.runToEnd(a);
    }
    const painting = sim.obj('item_painting');
    const c = a.skills.creativity.level;
    const v = painting.data.value as number;
    expect(v).toBeGreaterThanOrEqual(Math.floor(40 + 25 * Math.pow(c, 1.35) * 0.8) - 1);
    expect(v).toBeLessThanOrEqual(Math.ceil(40 + 25 * Math.pow(c, 1.35) * 1.2) + 1);
    expect(easel.data[DATA.progress]).toBe(0);
    expect(sim.ctx.hasMoodlet(a, MOOD.artisticTriumph)).toBe(true);
    expect(paintingValue(sim.ctx, 0)).toBe(40);
  });

  it('dancing switches the stereo on and makes preservation decay ×1.5', () => {
    const sim = new FakeSim({ objects: [{ defId: 'stereo_boombox', x: 3, z: 3 }], tick: tickAt(1, 12 * 60) });
    const a = sim.member();
    sim.start(a, IX.dance, obj(sim, 'stereo_boombox'));
    expect(sim.obj('stereo_boombox').data.playing).toBe(true);
    expect(preservationDecayPerHour(sim.ctx, a)).toBeCloseTo(1.95, 6);
    sim.obj('stereo_boombox').data.playing = false;
    sim.advance(1);
    expect(a.active).toBeNull(); // music stopped → dance over
  });

  it('sitting next to someone else who is seated gives social', () => {
    const sim = new FakeSim({ objects: [{ defId: 'sofa_velvet', x: 3, z: 3 }], members: [{ needs: { social: 20 } }, { needs: { social: 20 } }] });
    const [a, b] = [sim.member(0), sim.member(1)];
    sim.start(a, IX.sit, obj(sim, 'sofa_velvet'));
    sim.start(b, IX.sit, obj(sim, 'sofa_velvet'));
    sim.advance(19);
    expect(a.needs.social).toBeGreaterThan(20.5);
  });
});
