/**
 * W-110 §5.1: the outbox survives a simulated crash mid-write and de-duplicates resends (idempotent ids); size and
 * count caps with an oldest-dropped notice; retention; damaged records are skipped, never thrown.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import type { StorageBackend } from '../../../src/persistence/contracts';
import { FeedbackOutbox, MAX_QUEUED, RETENTION_DAYS } from '../../../src/feedback/outbox';
import { idKey, newFeedbackId } from '../../../src/feedback/id';
import { validateReport } from '../../../src/feedback/schema';
import { memoryProfile, sealed } from './helpers';

const NOW = Date.parse('2026-11-06T12:00:00Z');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0);
}

function outboxOn(backend: StorageBackend & { store?: Map<string, Uint8Array> }, now = () => NOW) {
  const { store } = memoryProfile(backend as MemoryBackend);
  return new FeedbackOutbox({ store, backend, now });
}

function report(i: number, rnd = rng(i + 1)) {
  return sealed({ id: newFeedbackId(rnd), createdAt: new Date(NOW - (100 - i) * 60_000).toISOString(), text: `report ${i}` });
}

/** A backend that "crashes" (throws, and optionally tears the write) on the Nth write from now. */
function crashy(inner: MemoryBackend) {
  let countdown = Infinity;
  let tear = false;
  const b: MemoryBackend = {
    ...inner,
    store: inner.store,
    async write(key, data) {
      if (--countdown === 0) {
        if (tear) inner.store.set(key, data.slice(0, Math.floor(data.length / 2))); // non-atomic backend: half a record
        throw new Error('simulated crash');
      }
      return inner.write(key, data);
    },
  };
  return {
    backend: b,
    crashOnWrite(n: number, torn = false) {
      countdown = n;
      tear = torn;
    },
    heal() {
      countdown = Infinity;
    },
  };
}

describe('outbox basics', () => {
  it('put → list → get, survives a reload (new instance on the same storage)', async () => {
    const backend = createMemoryBackend();
    const ob = outboxOn(backend);
    const a = report(1);
    const b = report(2);
    expect((await ob.put(a)).ok).toBe(true);
    expect((await ob.put(b)).ok).toBe(true);
    const again = outboxOn(backend);
    const list = await again.list();
    expect(list.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(await again.get(a.id)).toEqual(a);
    expect(list[0]).toMatchObject({ type: 'bug', area: 'buy', hasScreenshot: true, hasSave: false, exportedAt: null });
  });

  it('idempotent: resending the same id replaces, never duplicates (double click, retry, resend after crash)', async () => {
    const backend = createMemoryBackend();
    const ob = outboxOn(backend);
    const a = report(1);
    const r1 = await ob.put(a);
    const r2 = await ob.put(a);
    const edited = sealed({ ...a, text: 'second try' });
    const r3 = await ob.put(edited);
    expect(r1).toMatchObject({ ok: true, replaced: false });
    expect(r2).toMatchObject({ ok: true, replaced: true });
    expect(r3).toMatchObject({ ok: true, replaced: true });
    // concurrent sends of one id still produce one entry
    await Promise.all([ob.put(a), ob.put(a), ob.put(a)]);
    const fresh = outboxOn(backend);
    expect((await fresh.list()).map((e) => e.id)).toEqual([a.id]);
    expect([...backend.store.keys()].filter((k) => k.startsWith('profile:fbr-') && !k.endsWith(':bak'))).toHaveLength(1);
  });

  it(`keeps at most ${MAX_QUEUED}: the oldest is dropped and reported`, async () => {
    const backend = createMemoryBackend();
    const ob = outboxOn(backend);
    const all = Array.from({ length: MAX_QUEUED + 3 }, (_, i) => report(i));
    const dropped: string[] = [];
    for (const r of all) {
      const res = await ob.put(r);
      expect(res.ok).toBe(true);
      if (res.ok) dropped.push(...res.dropped);
    }
    expect(dropped).toEqual(all.slice(0, 3).map((r) => r.id));
    const ids = (await outboxOn(backend).list()).map((e) => e.id);
    expect(ids).toEqual(all.slice(3).map((r) => r.id));
    // dropped records are gone from storage too (no resurrection on reload)
    for (const r of all.slice(0, 3)) expect(backend.store.has(`profile:${idKey(r.id)}`)).toBe(false);
  });

  it('refuses invalid or oversized reports without touching storage', async () => {
    const backend = createMemoryBackend();
    const ob = outboxOn(backend);
    const bad = { ...report(1), text: 'tampered' }; // checksum no longer matches
    expect((await ob.put(bad)).ok).toBe(false);
    expect(backend.store.size).toBe(0);
  });

  it(`drops reports older than ${RETENTION_DAYS} days on load`, async () => {
    const backend = createMemoryBackend();
    const old = sealed({ id: 'FB-00000-00001', createdAt: new Date(NOW - (RETENTION_DAYS + 1) * 86_400_000).toISOString() });
    const fresh = report(5);
    const ob = outboxOn(backend, () => NOW - (RETENTION_DAYS + 2) * 86_400_000);
    await ob.put(old);
    await ob.put(fresh);
    const later = outboxOn(backend);
    expect((await later.list()).map((e) => e.id)).toEqual([fresh.id]);
    expect(later.issues.join()).toMatch(/older than/);
  });

  it('a damaged record is skipped (with an issue), the rest still load; remove + markExported persist', async () => {
    const backend = createMemoryBackend();
    const ob = outboxOn(backend);
    const a = report(1);
    const b = report(2);
    const c = report(3);
    for (const r of [a, b, c]) await ob.put(r);
    // flip bytes in b's primary and drop its backup (bit rot)
    const key = `profile:${idKey(b.id)}`;
    const bytes = backend.store.get(key)!;
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    backend.store.delete(`${key}:bak`);
    const re = outboxOn(backend);
    expect((await re.list()).map((e) => e.id)).toEqual([a.id, c.id]);
    await re.markExported(a.id);
    expect(await re.remove(c.id)).toBe(true);
    const re2 = outboxOn(backend);
    const l = await re2.list();
    expect(l.map((e) => e.id)).toEqual([a.id]);
    expect(l[0].exportedAt).toBe(new Date(NOW).toISOString());
  });
});

describe('crash safety', () => {
  it('a crash at EVERY write of a put leaves a consistent outbox: old reports intact, the new one all-or-nothing', async () => {
    // count the writes one put needs
    const probe = crashy(createMemoryBackend());
    const p0 = outboxOn(probe.backend);
    for (let i = 0; i < 3; i++) await p0.put(report(i));
    let writes = 0;
    const counting: MemoryBackend = { ...probe.backend, store: probe.backend.store, write: async (k, d) => (writes++, probe.backend.write(k, d)) };
    await outboxOn(counting).put(report(9));
    expect(writes).toBeGreaterThanOrEqual(2);

    for (const torn of [false, true]) {
      for (let n = 1; n <= writes; n++) {
        const c = crashy(createMemoryBackend());
        const before = outboxOn(c.backend);
        const old = [report(0), report(1), report(2)];
        for (const r of old) expect((await before.put(r)).ok).toBe(true);
        const fresh = report(7);
        c.crashOnWrite(n, torn);
        const res = await outboxOn(c.backend).put(fresh).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
        c.heal();
        const after = outboxOn(c.backend); // "reload" after the crash
        const ids = (await after.list()).map((e) => e.id);
        for (const r of old) expect(ids, `crash at write ${n}${torn ? ' (torn)' : ''}`).toContain(r.id);
        const got = await after.get(fresh.id);
        if (res.ok) expect(got).toEqual(fresh); // reported stored → really stored
        if (got) expect(validateReport(got).ok).toBe(true); // never a torn report
        expect(ids.length).toBe(new Set(ids).size);
        // the resend after the crash is idempotent
        expect((await after.put(fresh)).ok).toBe(true);
        const final = (await outboxOn(c.backend).list()).map((e) => e.id);
        expect(final.filter((id) => id === fresh.id)).toHaveLength(1);
        expect(final).toHaveLength(4);
      }
    }
  });

  it('a record written just before a crash (order not yet updated) is adopted on reload', async () => {
    const backend = createMemoryBackend();
    const { store } = memoryProfile(backend);
    const orphan = report(4);
    await store.save(idKey(orphan.id), orphan); // record only — as if the order write never happened
    const ob = new FeedbackOutbox({ store, backend, now: () => NOW });
    expect((await ob.list()).map((e) => e.id)).toEqual([orphan.id]);
  });

  it('storage that throws on read/list degrades to an empty outbox, never an exception', async () => {
    const broken: StorageBackend = {
      ...createMemoryBackend(),
      read: async () => {
        throw new Error('io');
      },
      list: async () => {
        throw new Error('io');
      },
    };
    const ob = outboxOn(broken);
    expect(await ob.list()).toEqual([]);
  });

  it('quota exceeded → a typed failure (the UI keeps the report exportable)', async () => {
    const backend = createMemoryBackend({ quotaBytes: 300 });
    const ob = outboxOn(backend);
    const r = await ob.put(report(1));
    expect(r.ok).toBe(false);
  });
});
