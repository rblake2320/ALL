import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_SLOT,
  SerialQueue,
  THUMB_MAX_BYTES,
  autosaveSlotFor,
  buildSaveMeta,
  captureThumbnail,
  isValidSlotId,
  manualSlotFor,
  sanitizeFilename,
  seedTag,
  withTimeout,
} from '../../../src/game/saves';
import { SaveFlow, type SaveFlowHost } from '../../../src/game/saveFlow';
import { GameSession } from '../../../src/game/session';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { FakeEnv, FakeRenderer, FakeSaves, FakeSim, flush, makeWorld } from './fakes';

describe('slot naming', () => {
  it('per-world autosave + manual slots from the seed; ids satisfy PLATFORM rules', () => {
    expect(seedTag(0xabc)).toBe('00000abc');
    expect(seedTag(-1)).toBe('ffffffff');
    expect(seedTag(NaN)).toBe('00000000');
    expect(autosaveSlotFor({ seed: 0xabc })).toBe('auto-00000abc');
    expect(manualSlotFor({ seed: 0xabc }, null)).toBe('save-00000abc');
    expect(manualSlotFor({ seed: 0xabc }, 'my-castle')).toBe('my-castle');
    for (const from of ['auto-00000abc', EMERGENCY_SLOT, 'autosave', 'autosave-3', 'bad slot!', 'x'.repeat(41), 'CON']) {
      expect(manualSlotFor({ seed: 0xabc }, from)).toBe('save-00000abc');
    }
    for (const id of ['auto-00000abc', 'save-ffffffff', EMERGENCY_SLOT]) expect(isValidSlotId(id)).toBe(true);
  });

  it.each(['', 'a b', '../etc', 'x'.repeat(41), 'nul', 'COM1', 'lpt9', 'é', 7, null])('rejects slot id %j', (id) => {
    expect(isValidSlotId(id)).toBe(false);
  });
});

describe('sanitizeFilename (Windows-safe exports)', () => {
  // Known save extensions (.alsave = PLATFORM's export format, .json) are kept; anything else gets .alsave.
  it.each([
    ['Rotwell — Day 3.json', 'Rotwell — Day 3.json'],
    ['afterlife-rotwell-day3.alsave', 'afterlife-rotwell-day3.alsave'],
    ['a<b>c:d"e/f\\g|h?i*j', 'a_b_c_d_e_f_g_h_i_j.alsave'],
    ['CON.json', '_CON.json'],
    ['nul', '_nul.alsave'],
    ['com1.backup', '_com1.backup.alsave'],
    ['COM\u00B9.alsave', '_COM\u00B9.alsave'],
    ['conin$', '_conin$.alsave'],
    ['trailing dots...', 'trailing dots.alsave'],
    ['  spaced  ', 'spaced.alsave'],
    ['..hidden', 'hidden.alsave'],
    ['', 'afterlife-lease-save.alsave'],
    ['tab\there\u0000', 'tab_here_.alsave'],
  ])('%j → %j', (input, out) => expect(sanitizeFilename(input)).toBe(out));

  it('bounds length and handles non-strings', () => {
    expect(sanitizeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(127);
    expect(sanitizeFilename(undefined)).toBe('afterlife-lease-save.alsave');
  });
});

describe('SaveMeta + thumbnails', () => {
  it('builds meta from the sim (members, day, time label, funds, lot value)', () => {
    const sim = new FakeSim(makeWorld({ householdName: 'Graves', members: ['Edna', 'Barnaby'] }));
    const meta = buildSaveMeta(sim, 'data:image/png;base64,AA');
    expect(meta).toMatchObject({ householdName: 'Graves', memberNames: ['Edna Rotwell', 'Barnaby Rotwell'], day: 1, timeLabel: 'Mon 9:00 AM', funds: 6500, lotValue: 12346 });
    expect(meta.thumbnail).toBe('data:image/png;base64,AA');
  });

  it('meta tolerates throwing views and drops oversize thumbnails', () => {
    const sim = new FakeSim(makeWorld());
    sim.time = () => {
      throw new Error('x');
    };
    sim.lotValue = () => NaN;
    const meta = buildSaveMeta(sim, 'data:image/png;base64,' + 'A'.repeat(THUMB_MAX_BYTES));
    expect(meta.day).toBe(1);
    expect(meta.lotValue).toBe(0);
    expect(meta.thumbnail).toBeNull();
  });

  it('captureThumbnail: small PNG kept, big PNG re-encoded, failures → null', async () => {
    const r = new FakeRenderer();
    const env = new FakeEnv();
    expect(await captureThumbnail(r, env)).toBe(r.snapshotValue);
    r.snapshotValue = 'data:image/png;base64,' + 'A'.repeat(THUMB_MAX_BYTES);
    expect(await captureThumbnail(r, env)).toBeNull(); // fake env cannot re-encode
    let quality = 0;
    const jpegEnv = { reencodeJpeg: async (_u: string, q: number) => ((quality = q), 'data:image/jpeg;base64,BB') };
    expect(await captureThumbnail(r, jpegEnv)).toBe('data:image/jpeg;base64,BB');
    expect(quality).toBe(0.8);
    r.snapshot = () => {
      throw new Error('context lost');
    };
    expect(await captureThumbnail(r, env)).toBeNull();
    r.snapshot = () => 'not a data url';
    expect(await captureThumbnail(r, env)).toBeNull();
  });
});

describe('SerialQueue / withTimeout', () => {
  it('an idle queue starts the job synchronously; a busy one waits its turn', async () => {
    const q = new SerialQueue();
    const log: string[] = [];
    let release!: () => void;
    const first = q.run(async () => {
      log.push('first:start');
      await new Promise<void>((r) => (release = r));
      log.push('first:end');
    });
    expect(log).toEqual(['first:start']); // synchronous start
    const second = q.run(async () => {
      log.push('second:start');
    });
    expect(log).toEqual(['first:start']); // queued behind the first
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(['first:start', 'first:end', 'second:start']);
    const sync = q.run(() => {
      throw new Error('sync throw');
    });
    await expect(sync).rejects.toThrow('sync throw');
    expect(q.busy).toBe(false);
  });

  it('runs jobs strictly one at a time, in order, even when some fail', async () => {
    const q = new SerialQueue();
    let active = 0;
    let max = 0;
    const order: number[] = [];
    const job = (n: number, fail = false) => async () => {
      active++;
      max = Math.max(max, active);
      await flush(3);
      order.push(n);
      active--;
      if (fail) throw new Error('job failed');
      return n;
    };
    const ps = [q.run(job(1)), q.run(job(2, true)).catch(() => -2), q.run(job(3))];
    expect(q.busy).toBe(true);
    expect(await Promise.all(ps)).toEqual([1, -2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(max).toBe(1);
    expect(q.busy).toBe(false);
  });

  it('withTimeout resolves the fallback on timeout or rejection', async () => {
    const env = new FakeEnv();
    const never = new Promise<string>(() => undefined);
    const p = withTimeout(never, 1000, env, () => 'late');
    env.advance(1000);
    expect(await p).toBe('late');
    expect(await withTimeout(Promise.reject(new Error('x')), 1000, env, () => 'rejected')).toBe('rejected');
    expect(await withTimeout(Promise.resolve('ok'), 1000, env, () => 'no')).toBe('ok');
  });
});

function flowHarness() {
  const env = new FakeEnv();
  const renderer = new FakeRenderer();
  const saves = new FakeSaves();
  const sim = new FakeSim(makeWorld({ seed: 0xbeef }));
  const session = new GameSession(sim, { loadedFrom: null, playMinutesBase: 12 }, () => undefined);
  const toasts: string[] = [];
  let screen: 'game' | 'menu' = 'game';
  let choice = false;
  const host: SaveFlowHost = {
    env,
    renderer,
    saves,
    session: () => session,
    screen: () => screen,
    settings: () => DEFAULT_SETTINGS,
    choicePending: () => choice,
    toast: (_k, t) => toasts.push(t),
    sfx: () => undefined,
    report: () => undefined,
    changed: () => undefined,
  };
  const flow = new SaveFlow(host);
  return { env, renderer, saves, sim, session, flow, toasts, setScreen: (s: 'game' | 'menu') => (screen = s), setChoice: (c: boolean) => (choice = c) };
}

describe('SaveFlow', () => {
  it('autosave writes the per-world autosave slot with meta + thumbnail and is idempotent per tick', async () => {
    const h = flowHarness();
    expect(await h.flow.autosaveNow('quit')).toBe('saved');
    const call = h.saves.saveCalls[0];
    expect(call.slotId).toBe('auto-0000beef');
    expect(call.opts?.autosave).toBe(true);
    expect(call.opts?.playMinutes).toBe(12);
    expect(call.meta.thumbnail).toBe(h.renderer.snapshotValue);
    expect(await h.flow.autosaveNow('hidden')).toBe('skipped');
    expect(h.saves.saveCalls.length).toBe(1);
    expect(h.flow.label()).toBe('Saved just now');
    h.env.wall += 3 * 60_000;
    expect(h.flow.label()).toBe('Saved 3 min ago');
  });

  it('the world is serialized synchronously at write start (consistent snapshot)', async () => {
    const h = flowHarness();
    h.sim.state.tick = 100;
    const p = h.flow.autosaveNow('x');
    h.sim.state.tick = 200; // sim keeps ticking while the write is in flight
    await p;
    expect(h.saves.saveCalls[0].tick).toBe(100);
  });

  it('manual saves go to the manual slot, never overlap other writes, and report failures without rejecting', async () => {
    const h = flowHarness();
    const release = h.saves.hold();
    const a = h.flow.saveGame();
    const b = h.flow.autosaveNow('interval');
    const c = h.flow.saveGame('slot-2', '  My Save  ');
    expect(h.flow.saving).toBe(true);
    release();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra.ok && rb === 'saved' && rc.ok).toBe(true);
    expect(h.saves.maxConcurrent).toBe(1);
    expect(h.saves.saveCalls.map((s) => s.slotId)).toEqual(['save-0000beef', 'auto-0000beef', 'slot-2']);
    expect(h.saves.saveCalls[2].name).toBe('My Save');
    h.saves.failSaves = 1;
    const fail = await h.flow.saveGame();
    expect(fail.ok).toBe(false);
    expect(h.flow.label()).toBe('Save failed');
    expect(h.toasts).toContain('Save failed');
    h.saves.throwOnSave = true;
    const thrown = await h.flow.saveGame();
    expect(thrown).toMatchObject({ ok: false, code: 'io' });
  });

  it('rejects invalid slot ids up front', async () => {
    const h = flowHarness();
    expect(await h.flow.saveGame('../../evil')).toMatchObject({ ok: false, code: 'invalid' });
    expect(h.saves.saveCalls.length).toBe(0);
  });

  it('autosave failures toast and retry with backoff', async () => {
    const h = flowHarness();
    h.saves.failSaves = 1;
    expect(await h.flow.autosaveNow('interval')).toBe('failed');
    expect(h.toasts).toContain('Autosave failed');
    expect(await h.flow.autosaveNow('interval')).toBe('saved');
  });

  it('emergency save: no thumbnail, bypasses the queue, at most once per session', async () => {
    const h = flowHarness();
    const release = h.saves.hold();
    void h.flow.saveGame(); // a stuck normal save
    const ok = h.flow.emergencySave();
    expect(await h.flow.emergencySave()).toBe(false); // concurrent call ignored
    release();
    expect(await ok).toBe(true);
    const em = h.saves.saveCalls.find((s) => s.slotId === EMERGENCY_SLOT)!;
    expect(em.meta.thumbnail).toBeNull();
    expect(await h.flow.emergencySave()).toBe(false); // already done
  });

  it('a serialize() crash becomes a failed result', async () => {
    const h = flowHarness();
    h.sim.serialize = () => {
      throw new Error('cyclic state');
    };
    expect(await h.flow.saveGame()).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('load / list / latest / remove never reject', async () => {
    const h = flowHarness();
    h.saves.load = async () => {
      throw new Error('io');
    };
    expect(await h.flow.load('x')).toMatchObject({ ok: false, code: 'io' });
    expect(await h.flow.load('')).toMatchObject({ ok: false, code: 'not_found' });
    h.saves.listSlots = async () => {
      throw new Error('io');
    };
    expect(await h.flow.list()).toEqual([]);
    h.saves.latest = async () => {
      throw new Error('io');
    };
    expect(await h.flow.latest()).toBeNull();
    h.saves.remove = async () => {
      throw new Error('locked');
    };
    await expect(h.flow.remove('x')).resolves.toBeUndefined();
    expect(h.toasts).toContain("Couldn't delete the save");
  });

  it('export downloads a Windows-safe file; missing slot toasts', async () => {
    const h = flowHarness();
    await h.flow.saveGame();
    await h.flow.exportSlot('save-0000beef');
    expect(h.env.downloads[0].filename).toBe('_CON.json');
    expect(h.env.downloads[0].mime).toBe('application/json');
    await h.flow.exportSlot('nope');
    expect(h.toasts).toContain('Export failed');
  });

  it('import validates the file before reading it', async () => {
    const h = flowHarness();
    const file = (size: number, body = '{}') => ({ size, arrayBuffer: async () => new TextEncoder().encode(body).buffer }) as unknown as File;
    expect(await h.flow.importFile(null as unknown as File)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.flow.importFile(file(0))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.flow.importFile(file(10 ** 9))).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
    expect((await h.flow.importFile(file(10, '{oops'))).ok).toBe(false);
    const good = await h.flow.importFile(file(10, JSON.stringify(makeWorld())));
    expect(good.ok).toBe(true);
    expect(h.toasts).toContain('Save imported');
  });

  it('nothing is autosaved for a game-over world', async () => {
    const h = flowHarness();
    h.session.gameOver = true;
    expect(await h.flow.autosaveNow('quit')).toBe('skipped');
  });
});
