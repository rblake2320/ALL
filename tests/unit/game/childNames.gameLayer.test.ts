/**
 * Reconcile probe (not for merge as-is): D-3 says a child / unanswered profile never puts a TYPED name into a world or
 * an exported save. The UI swaps the text fields for preset pickers, but the GameController API (exposed on
 * window.__afterlife.game in production builds) is the real boundary. These cases check the game layer.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { EconomyService } from '../../../src/economy/service';
import { CHILD_AGE_LIMIT } from '../../../src/shared/economy';
import { FIRST_NAMES, LAST_NAMES } from '../../../src/sim/content/people/names';
import { createHarness } from './controllerHarness';

const NOW = Date.parse('2026-11-12T12:00:00Z');

async function childEconomy(): Promise<EconomyService> {
  const b = createMemoryBackend();
  const now = () => NOW;
  const profile = new ProfileStoreImpl(() => Promise.resolve(b), { logger: { warn: () => undefined }, now });
  const econ = new EconomyService({ backend: () => Promise.resolve(b), profile, now, logger: { warn: () => undefined }, broadcast: false });
  await econ.init();
  expect(econ.answerAgeGate(new Date(NOW).getUTCFullYear() - (CHILD_AGE_LIMIT - 1))).toBe('ok');
  return econ;
}

const TYPED = 'Emma S 4th grade';
const isPreset = (n: string, pool: readonly string[]) => pool.includes(n.trim());

describe('D-3 game layer: a child profile cannot start a world with typed CAZ names', () => {
  it('updateCaz / updateCazMember with typed names, then startGame is refused: no world carries a typed name', async () => {
    const h = await createHarness({ economy: await childEconomy(), tutorial: { v: 1, seen: [] } });
    h.game.beginNewGame();
    h.game.updateCaz({ householdName: TYPED });
    h.game.updateCazMember(0, { firstName: 'Bobby Tables', lastName: TYPED });
    h.env.randoms.push(0xc0ffee);
    const before = h.simModule.worlds.length;
    await h.game.startGame();
    // Refused: the player stays in Create-a-Zombie and no world is created with the typed names.
    expect(h.game.screen).toBe('caz');
    expect(h.simModule.worlds.length).toBe(before);
    const opts = h.simModule.worlds.length > before ? h.simModule.worlds.at(-1) : undefined;
    // Either the start is refused (no world) or every name in the world is a preset.
    if (opts) {
      expect(isPreset(opts.householdName, LAST_NAMES), `household "${opts.householdName}"`).toBe(true);
      for (const m of opts.members) {
        expect(isPreset(m.firstName, FIRST_NAMES), `first "${m.firstName}"`).toBe(true);
        expect(isPreset(m.lastName, LAST_NAMES), `last "${m.lastName}"`).toBe(true);
      }
    }
  });
});

describe('D-3 game layer: a child profile cannot label a save with typed text', () => {
  it('saveGame(undefined, typed) never writes the typed label into the slot', async () => {
    const h = await createHarness({ economy: await childEconomy(), tutorial: { v: 1, seen: [] } });
    h.game.beginNewGame();
    h.env.randoms.push(0xc0ffee);
    const p = h.game.startGame();
    await h.until(() => h.game.screen === 'game' || h.game.screen === 'gameOver');
    await p;
    await h.game.saveGame(undefined, TYPED);
    expect(h.saves.saveCalls.map((c) => c.name)).not.toContain(TYPED);
  });
});
