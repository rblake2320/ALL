import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { utf8DecodeStrict } from '../../../src/persistence/bytes';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { EconomyService } from '../../../src/economy/service';
import type { StorageBackend } from '../../../src/persistence/contracts';
import { quiet } from './helpers';

const T0 = Date.parse('2026-11-05T12:00:00Z');
function econ(backend: StorageBackend) {
  const profile = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: quiet, now: () => T0 });
  let r = 777;
  const svc = new EconomyService({ backend: () => Promise.resolve(backend), profile, now: () => T0, randomU32: () => (r = (r * 1103515245 + 12345) >>> 0), logger: quiet, broadcast: false });
  return { svc, profile };
}

async function decidedChildThenWipeAge() {
  const b = createMemoryBackend();
  const { svc } = econ(b);
  await svc.init();
  expect(svc.answerAgeGate(2016)).toBe('ok');
  await svc.ageSettled();
  for (const k of [...b.store.keys()]) if (k.includes('economy-age')) b.store.delete(k);
  return b;
}

describe('age gate: a failed prefs read (the ageDecided marker) fails closed', () => {
  it('transient: age + age-seen wiped, prefs read fails once at start-up -> must fail closed (prefs marker unread)', async () => {
    const b = await decidedChildThenWipeAge();
    const seen = new Set<string>();
    const flaky: StorageBackend = {
      ...b,
      read: async (k) => {
        if (k.includes('economy-prefs') && !seen.has(k)) {
          seen.add(k);
          throw new Error('EBUSY');
        }
        return b.read(k);
      },
    };
    const { svc: again } = econ(flaky);
    await again.init();
    expect({ gate: again.needsAgeGate, bracket: again.age.bracket }).toEqual({ gate: false, bracket: 'under13' });
  });

  it('persistent: age + age-seen wiped, prefs unreadable -> gate must not accept adult and write an adult record', async () => {
    const b = await decidedChildThenWipeAge();
    const broken: StorageBackend = {
      ...b,
      read: async (k) => {
        if (k.includes('economy-prefs')) throw new Error('EIO');
        return b.read(k);
      },
    };
    const { svc: again } = econ(broken);
    await again.init();
    const ans = again.answerAgeGate(1990);
    await again.ageSettled();
    const stored = [...b.store].filter(([k]) => k.includes('economy-age') && !k.includes('seen')).map(([k, v]) => [k, utf8DecodeStrict(v).includes('"adult"')]);
    expect({ ans, bracket: again.age.bracket, stored }).toEqual({ ans: 'locked', bracket: 'under13', stored: [] });
  });
});
