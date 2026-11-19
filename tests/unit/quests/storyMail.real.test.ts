/**
 * W-116 owner playtest #2: the quest says the mailbox is stuffed with CONDEMNED letters, so checking it on the derelict
 * (Act 1) world must read the letter — never the empty-mailbox line — while the shack is condemned. Classic worlds
 * (starter lot, old saves) keep the ordinary letters. Real sim, real interaction, real notification.
 */
import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../../src/sim/types';
import { EMPTY_MAILBOX, LETTERS } from '../../../src/sim/content/home/flavour';
import { en } from '../../../src/i18n/en';
import type { EngineSimulation } from '../../../src/sim/engine';
import { newWorld, objectOf, opts, simOf, systemsWithQuests } from './helpers';

function checkMail(sim: EngineSimulation): string {
  const [a] = sim.state.household.memberIds;
  const mb = objectOf(sim, 'mailbox_crooked')!;
  expect(mb).toBeTruthy();
  const before = sim.state.notifications.length ? sim.state.notifications[sim.state.notifications.length - 1].id : -1;
  expect(sim.dispatch({ type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: mb } }).ok).toBe(true);
  for (let i = 0; i < 2400; i++) {
    sim.step();
    const n = sim.state.notifications.filter((x) => x.id > before && /checked the mail/.test(x.title));
    if (n.length) return n[n.length - 1].text;
  }
  throw new Error('mail never checked');
}

const world = (lot: 'derelict' | 'starter', seed: number) => {
  const systems = systemsWithQuests();
  const sim = simOf(newWorld({ ...opts(seed, 1), lotTemplate: lot }, systems), systems);
  sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
  return { sim, systems };
};

describe('W-116 the CONDEMNED letter (derelict / Act 1 world)', () => {
  it('checking the mailbox during "Squatter\'s Rights" reads the CONDEMNED letter, not the empty-mailbox text', () => {
    const { sim } = world('derelict', 31);
    expect(sim.state.flags['home.mail'] ?? 0).toBe(0); // the box really is empty of ordinary mail
    const text = checkMail(sim);
    expect(text).toContain(en['story.act1.claim.letter']);
    expect(text).toMatch(/CONDEMNED/);
    for (const line of EMPTY_MAILBOX) expect(text).not.toContain(line);
    expect(text.toLowerCase()).not.toMatch(/\bempty\b|nothing today/);
    // and the quest it belongs to completes from that very check
    expect(sim.state.quests!.completions.act1_claim).toBe(1);
  }, 120_000);

  it('after the claim and before the lease is paid an empty box still holds notices (never "empty"); after the lease: ordinary', () => {
    const { sim, systems } = world('derelict', 32);
    checkMail(sim);
    const again = checkMail(sim);
    expect(again).toContain(en['story.act1.claim.letterAgain']);
    for (const line of EMPTY_MAILBOX) expect(again).not.toContain(line);
    // real mail waiting: the ordinary letters are read out (the story line is only for an empty box)
    sim.engine.ctx.sys('economy').addMail(2);
    const real = checkMail(sim);
    expect(LETTERS.some((l) => real.includes(l))).toBe(true);
    // once the lease beat is done (the shack is legally theirs) the box can be empty again
    const s = sim.serialize() as WorldState;
    s.quests!.completions.act1_lease = 1;
    const later = simOf(s, systems);
    later.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    const empty = checkMail(later);
    expect(EMPTY_MAILBOX.some((l) => empty.includes(l))).toBe(true);
  }, 120_000);

  it('CLASSIC (starter lot) keeps the existing behaviour: an empty box says so', () => {
    const { sim } = world('starter', 33);
    sim.engine.ctx.sys('economy').addMail(0);
    const text = checkMail(sim);
    expect(text).not.toContain('CONDEMNED');
    expect(EMPTY_MAILBOX.some((l) => text.includes(l)) || LETTERS.some((l) => text.includes(l))).toBe(true);
  }, 120_000);

  it('the story line draws the same random numbers as the ordinary text (the RNG stream is unchanged)', () => {
    const a = world('derelict', 34).sim;
    const b = world('derelict', 34).sim;
    // b: same world with the story flag removed (ordinary text) — both check the same empty box
    delete b.state.flags.storyArc;
    checkMail(a);
    checkMail(b);
    expect(a.state.rng).toEqual(b.state.rng);
  }, 120_000);
});
