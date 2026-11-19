import { describe, expect, it } from 'vitest';
import { SaveManagerImpl, type SaveManagerOptions } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { decodeMetaRecord } from '../../../src/persistence/slotMeta';
import type { WorldState } from '../../../src/sim/types';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { MIGRATIONS } from '../../../src/persistence/migrations';
import { makeMeta, makeWorld, silentLogger } from './fixtures';

function manager(over: Partial<SaveManagerOptions> = {}) {
  const backend = over.backend ?? createMemoryBackend();
  let t = Date.parse('2026-11-05T12:00:00.000Z');
  const mgr = new SaveManagerImpl({ backend, logger: silentLogger, now: () => (t += 1000), ...over });
  return { mgr, backend: backend as ReturnType<typeof createMemoryBackend> };
}

describe('SaveManager — save/load round trip', () => {
  for (const compress of [true, false]) {
    it(`saves and loads an identical world (${compress ? 'gzip' : 'plain'})`, async () => {
      const { mgr, backend } = manager({ compress });
      const w = makeWorld();
      const r = await mgr.save('slot1', 'First save', w, makeMeta(), { playMinutes: 90 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.info).toMatchObject({ slotId: 'slot1', name: 'First save', playMinutes: 90, isAutosave: false, recoveredFromBackup: false });
      expect([...backend.store.keys()].sort()).toEqual(['slot:slot1:meta', 'slot:slot1:primary']);
      const primary = backend.store.get('slot:slot1:primary')!;
      expect(primary[0] === 0x1f && primary[1] === 0x8b).toBe(compress);
      const l = await mgr.load('slot1');
      expect(l.ok).toBe(true);
      if (!l.ok) return;
      expect(canonicalJson(l.world)).toBe(canonicalJson(w));
      expect(l.warnings).toEqual([]);
      expect(l.info.recoveredFromBackup).toBe(false);
      expect(l.info.bytes).toBe(primary.byteLength);
    });
  }

  it('snapshots the world at call time (later mutation does not leak into the save)', async () => {
    const { mgr } = manager();
    const w = makeWorld();
    const p = mgr.save('slot1', 'x', w, makeMeta());
    w.household.funds = 999999;
    w.agents.a1.firstName = 'Mutated';
    expect((await p).ok).toBe(true);
    const l = await mgr.load('slot1');
    expect(l.ok && l.world.household.funds).toBe(makeWorld().household.funds);
    expect(l.ok && l.world.agents.a1.firstName).toBe('Mort');
  });

  it('second save rotates the previous good save into the backup', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    const firstPrimary = backend.store.get('slot:slot1:primary')!.slice();
    await mgr.save('slot1', 'v2', makeWorld(2), makeMeta());
    expect(backend.store.get('slot:slot1:backup')).toEqual(firstPrimary);
    const l = await mgr.load('slot1');
    expect(l.ok && l.world.seed).toBe(makeWorld(2).seed);
  });

  it('keeps createdAt across saves, advances savedAt monotonically even if the clock goes backwards', async () => {
    let t = Date.parse('2026-11-05T12:00:00.000Z');
    const { mgr } = manager({ now: () => t });
    const a = await mgr.save('slot1', 'a', makeWorld(), makeMeta());
    t -= 3_600_000; // clock jumps back an hour
    const b = await mgr.save('slot1', 'b', makeWorld(), makeMeta());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.info.createdAt).toBe(a.info.createdAt);
    expect(b.info.savedAt > a.info.savedAt).toBe(true);
    // A fresh manager (new session) still orders after the existing save.
    const fresh = new SaveManagerImpl({ backend: mgr.backend, logger: silentLogger, now: () => t - 10_000_000 });
    const c = await fresh.save('slot1', 'c', makeWorld(), makeMeta());
    expect(c.ok && c.info.savedAt > b.info.savedAt).toBe(true);
  });

  it('keeps playMinutes when the caller omits it; rejects garbage playMinutes', async () => {
    const { mgr } = manager();
    await mgr.save('slot1', 'a', makeWorld(), makeMeta(), { playMinutes: 77 });
    const b = await mgr.save('slot1', 'b', makeWorld(), makeMeta());
    expect(b.ok && b.info.playMinutes).toBe(77);
    const c = await mgr.save('slot1', 'c', makeWorld(), makeMeta(), { playMinutes: NaN });
    expect(c.ok && c.info.playMinutes).toBe(77);
  });

  it('autosave slot is flagged; slot ids are case-insensitive', async () => {
    const { mgr } = manager();
    const a = await mgr.save('AutoSave', 'Autosave', makeWorld(), makeMeta(), { autosave: true });
    expect(a.ok && a.info.slotId).toBe('autosave');
    expect(a.ok && a.info.isAutosave).toBe(true);
    const l = await mgr.load('AUTOSAVE');
    expect(l.ok && l.info.isAutosave).toBe(true);
  });
});

describe('SaveManager — input validation', () => {
  it('rejects bad slot ids (incl. Windows device names) with code invalid', async () => {
    const { mgr, backend } = manager();
    for (const id of ['', 'a/b', '../x', 'a b', 'x'.repeat(41), 'con', 'NUL', 'com1', 'lpt9', 'slot:1', 'é']) {
      const r = await mgr.save(id, 'x', makeWorld(), makeMeta());
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid');
      const l = await mgr.load(id);
      expect(!l.ok && l.code).toBe('invalid');
    }
    expect(backend.store.size).toBe(0);
  });

  it('refuses to persist non-JSON worlds (NaN, cycles) and structurally broken worlds', async () => {
    const { mgr, backend } = manager();
    const nan = makeWorld();
    nan.tick = NaN;
    const r1 = await mgr.save('slot1', 'x', nan, makeMeta());
    expect(!r1.ok && r1.code).toBe('invalid');
    if (!r1.ok) expect(r1.error).toMatch(/non-finite number.*\$\.tick/);
    const cyc = makeWorld() as WorldState & { self?: unknown };
    cyc.self = cyc;
    expect((await mgr.save('slot1', 'x', cyc, makeMeta())).ok).toBe(false);
    const broken = makeWorld() as unknown as Record<string, unknown>;
    delete broken.agents;
    const r3 = await mgr.save('slot1', 'x', broken as unknown as WorldState, makeMeta());
    expect(!r3.ok && r3.code).toBe('invalid');
    if (!r3.ok) expect(r3.error).toMatch(/nothing was written/);
    expect(backend.store.size).toBe(0);
  });

  it('sanitizes meta: hostile thumbnail/names are neutralized', async () => {
    const { mgr } = manager();
    const r = await mgr.save('slot1', '‮evil\u0000 name', makeWorld(), {
      ...makeMeta(),
      householdName: 'x'.repeat(500),
      memberNames: ['ok', 42 as unknown as string, '', 'n'.repeat(100)],
      thumbnail: 'javascript:alert(1)',
      day: -5,
      funds: Infinity,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.name).toBe('evil name');
    expect(r.info.meta.householdName).toHaveLength(64);
    expect(r.info.meta.memberNames).toEqual(['ok', 'n'.repeat(64)]);
    expect(r.info.meta.thumbnail).toBeNull();
    expect(r.info.meta.day).toBe(0);
    expect(r.info.meta.funds).toBe(0);
    const ok = await mgr.save('slot2', 'n', makeWorld(), { ...makeMeta(), thumbnail: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(ok.ok && ok.info.meta.thumbnail).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('SaveManager — recovery', () => {
  it('falls back to the backup when the primary is corrupted (and says so)', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    await mgr.save('slot1', 'v2', makeWorld(2), makeMeta());
    const p = backend.store.get('slot:slot1:primary')!;
    p[Math.floor(p.length / 2)] ^= 0x10;
    const l = await mgr.load('slot1');
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.world.seed).toBe(makeWorld(1).seed);
    expect(l.info.recoveredFromBackup).toBe(true);
    expect(l.warnings[0]).toMatch(/previous save was restored/);
    // The listing now reflects the recovery.
    const [info] = await mgr.listSlots();
    expect(info.recoveredFromBackup).toBe(true);
  });

  it('the next save after a corrupt primary does NOT rotate the corrupt file over the good backup', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    await mgr.save('slot1', 'v2', makeWorld(2), makeMeta());
    const goodBackup = backend.store.get('slot:slot1:backup')!.slice();
    backend.store.set('slot:slot1:primary', utf8Encode('{"format":"afterlife-lease-save", truncated'));
    const r = await mgr.save('slot1', 'v3', makeWorld(3), makeMeta());
    expect(r.ok).toBe(true);
    expect(backend.store.get('slot:slot1:backup')).toEqual(goodBackup);
    const l = await mgr.load('slot1');
    expect(l.ok && l.world.seed).toBe(makeWorld(3).seed);
  });

  it('missing primary + good backup loads the backup', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    await mgr.save('slot1', 'v2', makeWorld(2), makeMeta());
    backend.store.delete('slot:slot1:primary');
    const l = await mgr.load('slot1');
    expect(l.ok && l.info.recoveredFromBackup).toBe(true);
    expect(l.ok && l.warnings[0]).toMatch(/missing/);
  });

  it('both copies corrupt -> corrupt (listed as damaged, deletable); nothing -> not_found', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    await mgr.save('slot1', 'v2', makeWorld(2), makeMeta());
    backend.store.set('slot:slot1:primary', new Uint8Array([1, 2, 3]));
    backend.store.set('slot:slot1:backup', new Uint8Array([4, 5, 6]));
    backend.store.delete('slot:slot1:meta');
    const l = await mgr.load('slot1');
    expect(!l.ok && l.code).toBe('corrupt');
    const slots = await mgr.listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toMatch(/Damaged save/);
    await mgr.remove('slot1');
    expect(backend.store.size).toBe(0);
    const nf = await mgr.load('slot1');
    expect(!nf.ok && nf.code).toBe('not_found');
  });

  it('structurally invalid primary (checksum OK) falls back to backup with code preserved otherwise', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    // Craft a checksummed-but-invalid save by bypassing validation: write through a raw manager whose
    // world lacks agents but which is otherwise a perfect envelope.
    const { buildEnvelope } = await import('../../../src/persistence/envelope');
    const bad = makeWorld() as unknown as Record<string, unknown>;
    bad.agents = 'nope';
    const env = await buildEnvelope({
      payloadText: canonicalJson(bad),
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameVersion: 't',
      slotId: 'slot1',
      name: 'bad',
      createdAt: '2026-01-01T00:00:00.000Z',
      savedAt: '2027-01-01T00:00:00.000Z',
      playMinutes: 1,
      meta: makeMeta(),
    });
    backend.store.set('slot:slot1:backup', backend.store.get('slot:slot1:primary')!);
    backend.store.set('slot:slot1:primary', utf8Encode(env.text));
    const l = await mgr.load('slot1');
    expect(l.ok && l.info.recoveredFromBackup).toBe(true);
    backend.store.delete('slot:slot1:backup');
    const l2 = await mgr.load('slot1');
    expect(!l2.ok && l2.code).toBe('invalid');
  });

  it('read errors surface as io', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    backend.read = async () => {
      throw new Error('EIO: disk on fire');
    };
    const l = await mgr.load('slot1');
    expect(!l.ok && l.code).toBe('io');
  });
});

describe('SaveManager — listing, latest, remove', () => {
  it('lists slots newest first with meta, latest() is the newest', async () => {
    const { mgr } = manager();
    await mgr.save('a', 'A', makeWorld(), makeMeta({ day: 1 }));
    await mgr.save('b', 'B', makeWorld(), makeMeta({ day: 2 }));
    await mgr.save('autosave', 'Auto', makeWorld(), makeMeta({ day: 3 }), { autosave: true });
    await mgr.save('a', 'A2', makeWorld(), makeMeta({ day: 4 }));
    const list = await mgr.listSlots();
    expect(list.map((s) => s.slotId)).toEqual(['a', 'autosave', 'b']);
    expect(list[0].name).toBe('A2');
    expect(list[0].meta.day).toBe(4);
    expect(list[1].isAutosave).toBe(true);
    expect((await mgr.latest())?.slotId).toBe('a');
  });

  it('rebuilds missing/damaged meta records from the save itself (self-healing listing)', async () => {
    const { mgr, backend } = manager();
    await mgr.save('a', 'A', makeWorld(), makeMeta({ householdName: 'Alpha' }));
    await mgr.save('b', 'B', makeWorld(), makeMeta({ householdName: 'Beta' }));
    backend.store.delete('slot:a:meta');
    const m = backend.store.get('slot:b:meta')!;
    m[5] ^= 1;
    const list = await mgr.listSlots();
    expect(list.map((s) => s.meta.householdName).sort()).toEqual(['Alpha', 'Beta']);
    expect(await decodeMetaRecord(backend.store.get('slot:a:meta')!, 'a')).not.toBeNull();
    expect(await decodeMetaRecord(backend.store.get('slot:b:meta')!, 'b')).not.toBeNull();
  });

  it('meta for a different slot (copied file) is not trusted', async () => {
    const { mgr, backend } = manager();
    await mgr.save('a', 'A', makeWorld(), makeMeta({ householdName: 'Alpha' }));
    await mgr.save('b', 'B', makeWorld(), makeMeta({ householdName: 'Beta' }));
    backend.store.set('slot:b:meta', backend.store.get('slot:a:meta')!);
    const list = await mgr.listSlots();
    expect(list.find((s) => s.slotId === 'b')?.meta.householdName).toBe('Beta');
  });

  it('orphan meta records are cleaned up and not listed; foreign keys are ignored', async () => {
    const { mgr, backend } = manager();
    await mgr.save('a', 'A', makeWorld(), makeMeta());
    backend.store.set('slot:ghost:meta', backend.store.get('slot:a:meta')!);
    backend.store.set('slot:../evil:primary', new Uint8Array([1]));
    backend.store.set('slot:UPPER:primary', new Uint8Array([1]));
    backend.store.set('unrelated', new Uint8Array([1]));
    const list = await mgr.listSlots();
    expect(list.map((s) => s.slotId)).toEqual(['a']);
    expect(backend.store.has('slot:ghost:meta')).toBe(false);
  });

  it('remove deletes every key of the slot and is idempotent', async () => {
    const { mgr, backend } = manager();
    await mgr.save('a', 'A', makeWorld(), makeMeta());
    await mgr.save('a', 'A', makeWorld(), makeMeta());
    await mgr.save('b', 'B', makeWorld(), makeMeta());
    await mgr.remove('A');
    await mgr.remove('a');
    await mgr.remove('../nope');
    expect([...backend.store.keys()].every((k) => k.startsWith('slot:b:'))).toBe(true);
    expect((await mgr.listSlots()).map((s) => s.slotId)).toEqual(['b']);
  });

  it('listSlots rejects (does not pretend "no saves") when the backend cannot list', async () => {
    const { mgr, backend } = manager();
    backend.list = async () => {
      throw new Error('boom');
    };
    await expect(mgr.listSlots()).rejects.toThrow(/could not list saves/);
  });

  it('latest() is null with no saves', async () => {
    const { mgr } = manager();
    expect(await mgr.latest()).toBeNull();
  });
});

describe('SaveManager — export / import', () => {
  it('exports pretty, self-verifying JSON with a safe filename; imports into a new slot', async () => {
    const { mgr } = manager();
    await mgr.save('slot1', 'Mine', makeWorld(), makeMeta({ householdName: 'Família Ñoño / <script>', day: 12 }), { playMinutes: 30 });
    const ex = await mgr.exportSlot('slot1');
    expect(ex).not.toBeNull();
    if (!ex) return;
    expect(ex.filename).toBe('afterlife-familia-nono-script-day12.alsave');
    const text = utf8DecodeStrict(ex.data);
    expect(text.split('\n').length).toBeGreaterThan(50);
    expect(text).toMatch(/^\{\n {2}"createdAt"/);
    const imp = await mgr.importFile(ex.data);
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    expect(imp.slotId).toMatch(/^import-\d{8}-\d{6}$/);
    expect(canonicalJson(imp.world)).toBe(canonicalJson(makeWorld()));
    expect(imp.info.playMinutes).toBe(30);
    const again = await mgr.importFile(ex.data);
    expect(again.ok && again.slotId).not.toBe(imp.slotId);
    expect((await mgr.listSlots()).length).toBe(3);
  });

  it('exports from the backup when the primary is damaged; null for unknown slots', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(1), makeMeta());
    await mgr.save('slot1', 'v2', makeWorld(2), makeMeta());
    backend.store.set('slot:slot1:primary', new Uint8Array([0x1f, 0x8b, 0, 0]));
    const ex = await mgr.exportSlot('slot1');
    expect(ex).not.toBeNull();
    const imp = await mgr.importFile(ex!.data, 'restored');
    expect(imp.ok && imp.world.seed).toBe(makeWorld(1).seed);
    expect(await mgr.exportSlot('nope')).toBeNull();
    expect(await mgr.exportSlot('../x')).toBeNull();
  });

  it('import accepts gzip, CRLF-converted and BOM-prefixed files; rejects tampering and garbage', async () => {
    const { mgr, backend } = manager();
    await mgr.save('slot1', 'v1', makeWorld(), makeMeta());
    const gz = backend.store.get('slot:slot1:primary')!;
    expect((await mgr.importFile(gz)).ok).toBe(true);
    const ex = (await mgr.exportSlot('slot1'))!;
    const crlf = utf8Encode('﻿' + utf8DecodeStrict(ex.data).replace(/\n/g, '\r\n'));
    expect((await mgr.importFile(crlf)).ok).toBe(true);
    const tampered = utf8Encode(utf8DecodeStrict(ex.data).replace('"funds": 1500', '"funds": 9999999'));
    const t = await mgr.importFile(tampered);
    expect(!t.ok && t.code).toBe('corrupt');
    for (const junk of [new Uint8Array(0), utf8Encode('hello'), new Uint8Array([0x1f, 0x8b, 1, 2])]) {
      const r = await mgr.importFile(junk);
      expect(!r.ok && r.code).toBe('corrupt');
    }
    const notBytes = await mgr.importFile('a string' as unknown as Uint8Array);
    expect(!notBytes.ok && notBytes.code).toBe('invalid');
    const badSlot = await mgr.importFile(ex.data, 'bad/slot');
    expect(!badSlot.ok && badSlot.code).toBe('invalid');
  });

  it('import of a future-version save is refused with future_version', async () => {
    const backend = createMemoryBackend();
    // One schema newer than this build, independent of the current version.
    const future = SAVE_SCHEMA_VERSION + 1;
    const newer = new SaveManagerImpl({ backend, schemaVersion: future, migrations: [...MIGRATIONS, { from: SAVE_SCHEMA_VERSION, to: future, migrate() {} }], logger: silentLogger });
    const w = { ...makeWorld(), schemaVersion: future };
    await newer.save('slot1', 'n', w, makeMeta());
    const ex = (await newer.exportSlot('slot1'))!;
    const older = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger });
    const r = await older.importFile(ex.data);
    expect(!r.ok && r.code).toBe('future_version');
  });

  it('semantic repair hook runs on load/import; a throwing hook is contained', async () => {
    const calls: string[] = [];
    const { mgr } = manager({
      repair: async (world) => {
        calls.push('repair');
        return { world: { ...world, flags: { ...world.flags, repaired: true } }, warnings: ['fixed dangling reservation'] };
      },
    });
    await mgr.save('slot1', 'v1', makeWorld(), makeMeta());
    expect(calls).toEqual([]); // saving never runs semantic repair
    const l = await mgr.load('slot1');
    expect(l.ok && l.world.flags.repaired).toBe(true);
    expect(l.ok && l.warnings).toContain('fixed dangling reservation');
    const throwing = manager({
      backend: mgr.backend,
      repair: async () => {
        throw new Error('engine bug');
      },
    });
    const l2 = await throwing.mgr.load('slot1');
    expect(l2.ok).toBe(true);
    expect(l2.ok && l2.warnings.join(' ')).toMatch(/semantic repair failed.*engine bug/);
    const garbageRepair = manager({ backend: mgr.backend, repair: async () => ({ world: { nope: true } as unknown as WorldState, warnings: [] }) });
    const l3 = await garbageRepair.mgr.load('slot1');
    expect(l3.ok && l3.world.agents.a1).toBeDefined();
    expect(l3.ok && l3.warnings.join(' ')).toMatch(/discarded/);
  });
});
