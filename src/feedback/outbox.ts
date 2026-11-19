/**
 * Feedback outbox (W-110 §2 "outbox first"): every report is written locally before anything else, so a crash or
 * being offline never loses one. Reuses the save system's crash-safe store — no new storage layer:
 *
 *   profile:fbr-<id>       one report per ProfileStore record (checksummed, previous good copy rotated to :bak,
 *   profile:fbr-<id>:bak   atomic backend writes) — a crash mid-write leaves the old or the new record, never a torn one
 *   profile:feedback-outbox  { v, order[], exported{} } — the queue order; a CACHE: on load it is reconciled with the
 *                          records that really exist (backend.list adopts a record written just before a crash, before
 *                          its order entry), and an order entry whose record is gone / a tombstone is dropped.
 * Removal writes a tombstone (null) record first, then frees the backend keys, so a crash mid-removal reads as removed.
 *
 * Idempotent: the id is minted when the dialog opens; put() of an id that is already queued replaces that record
 * (same key) instead of adding a second one, so a double click, a retry or a resend after a crash never duplicates.
 * Caps: MAX_QUEUED reports (the oldest is dropped and reported back so the UI can say so), REPORT_MAX_CHARS each,
 * RETENTION_DAYS (older reports are removed on load — docs W-110 §4). Every report is re-validated on load; damaged
 * or invalid ones are skipped (and listed in `issues`), never thrown.
 */
import type { ProfileStore, StorageBackend } from '../persistence/contracts';
import { idFromKey, idKey, isFeedbackId } from './id';
import { REPORT_MAX_CHARS, encodeReport, validateReport, type FeedbackReport } from './schema';

export const OUTBOX_ORDER_KEY = 'feedback-outbox';
export const MAX_QUEUED = 10;
export const RETENTION_DAYS = 180;
const RECORD_PREFIX = 'profile:fbr-';

export interface OutboxEntry {
  id: string;
  createdAt: string;
  type: FeedbackReport['type'];
  area: FeedbackReport['area'];
  hasScreenshot: boolean;
  hasSave: boolean;
  exportedAt: string | null;
}

interface OrderRecord {
  v: 1;
  order: string[];
  exported: Record<string, string>;
}

export type PutResult = { ok: true; id: string; replaced: boolean; dropped: string[] } | { ok: false; error: string };

export interface OutboxPorts {
  store: ProfileStore;
  /** The same backend the ProfileStore writes to (list + remove only). Optional: without it orphans are not adopted. */
  backend?: Pick<StorageBackend, 'list' | 'remove'> | null;
  now?: () => number;
}

const EMPTY_ORDER: OrderRecord = { v: 1, order: [], exported: {} };

export class FeedbackOutbox {
  private readonly now: () => number;
  private cache: Map<string, FeedbackReport> | null = null;
  private order: string[] = [];
  private exported: Record<string, string> = {};
  private chain: Promise<unknown> = Promise.resolve();
  /** Problems found on the last load (damaged / invalid / expired records). */
  issues: string[] = [];

  constructor(private readonly ports: OutboxPorts) {
    this.now = ports.now ?? (() => Date.now());
  }

  /** Serialize every operation (reads re-use the loaded cache; writes never interleave). */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async load(): Promise<void> {
    if (this.cache) return;
    const issues: string[] = [];
    const stored = await this.ports.store.load<unknown>(OUTBOX_ORDER_KEY, null);
    const rec = stored && typeof stored === 'object' ? (stored as Partial<OrderRecord>) : EMPTY_ORDER;
    const order = Array.isArray(rec.order) ? rec.order.filter(isFeedbackId) : [];
    const exported: Record<string, string> = {};
    if (rec.exported && typeof rec.exported === 'object') {
      for (const [k, v] of Object.entries(rec.exported)) if (isFeedbackId(k) && typeof v === 'string' && v.length <= 40) exported[k] = v;
    }
    // Adopt records that exist but never made it into the order (crash between the two writes).
    let present: Set<string> | null = null;
    if (this.ports.backend) {
      try {
        const keys = await this.ports.backend.list(RECORD_PREFIX);
        present = new Set();
        for (const k of keys) {
          const id = idFromKey(k.replace(/^profile:/, '').replace(/:bak$/, ''));
          if (id) present.add(id);
        }
      } catch {
        present = null;
      }
    }
    const ids = [...order];
    if (present) for (const id of present) if (!ids.includes(id)) ids.push(id);
    const cache = new Map<string, FeedbackReport>();
    const cutoff = this.now() - RETENTION_DAYS * 86_400_000;
    for (const id of ids) {
      const raw = await this.ports.store.load<unknown>(idKey(id), null);
      if (raw === null) continue;
      const v = validateReport(raw);
      if (!v.ok) {
        issues.push(`${id}: ${v.errors[0]}`);
        continue;
      }
      if (v.report.id !== id) {
        issues.push(`${id}: record holds another id`);
        continue;
      }
      if (Date.parse(v.report.createdAt) < cutoff) {
        issues.push(`${id}: older than ${RETENTION_DAYS} days, removed`);
        await this.removeRecord(id);
        continue;
      }
      cache.set(id, v.report);
    }
    // queue order = createdAt (stable for adopted orphans), then id
    this.order = Array.from(cache.keys()).sort((a, b) => {
      const ra = cache.get(a)!;
      const rb = cache.get(b)!;
      return ra.createdAt < rb.createdAt ? -1 : ra.createdAt > rb.createdAt ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    for (const k of Object.keys(exported)) if (!cache.has(k)) delete exported[k];
    this.exported = exported;
    this.cache = cache;
    this.issues = issues;
  }

  /**
   * Remove = write a tombstone (null) through the ProfileStore first — that works on every store and a crash after it
   * already reads as "removed" — then free the bytes on the backend (backup before primary) when one is attached.
   */
  private async removeRecord(id: string): Promise<void> {
    await this.ports.store.save(idKey(id), null).catch(() => undefined);
    const b = this.ports.backend;
    if (!b) return;
    const key = `profile:${idKey(id)}`;
    await b.remove(`${key}:bak`).catch(() => undefined);
    await b.remove(key).catch(() => undefined);
  }

  private async saveOrder(): Promise<void> {
    await this.ports.store.save<OrderRecord>(OUTBOX_ORDER_KEY, { v: 1, order: [...this.order], exported: { ...this.exported } });
  }

  has(id: string): Promise<boolean> {
    return this.run(async () => {
      await this.load();
      return this.cache!.has(id);
    });
  }

  /** Store (or replace) a report. Validates first; the record is written BEFORE the queue order. */
  put(report: FeedbackReport): Promise<PutResult> {
    return this.run(async (): Promise<PutResult> => {
      const v = validateReport(report);
      if (!v.ok) return { ok: false, error: v.errors.join('; ') };
      if (encodeReport(report).length > REPORT_MAX_CHARS) return { ok: false, error: 'report is too large' };
      await this.load();
      const cache = this.cache!;
      const replaced = cache.has(report.id);
      try {
        await this.ports.store.save(idKey(report.id), report);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      cache.set(report.id, report);
      if (!replaced) this.order.push(report.id);
      const dropped: string[] = [];
      while (this.order.length > MAX_QUEUED) {
        const old = this.order.shift()!;
        cache.delete(old);
        delete this.exported[old];
        dropped.push(old);
      }
      try {
        await this.saveOrder();
      } catch {
        /* the record is safe; the order is rebuilt from the records on the next load */
      }
      for (const old of dropped) await this.removeRecord(old);
      return { ok: true, id: report.id, replaced, dropped };
    });
  }

  get(id: string): Promise<FeedbackReport | null> {
    return this.run(async () => {
      await this.load();
      return this.cache!.get(id) ?? null;
    });
  }

  list(): Promise<OutboxEntry[]> {
    return this.run(async () => {
      await this.load();
      return this.order.map((id) => {
        const r = this.cache!.get(id)!;
        return { id, createdAt: r.createdAt, type: r.type, area: r.area, hasScreenshot: r.screenshot !== null, hasSave: r.save !== null, exportedAt: this.exported[id] ?? null };
      });
    });
  }

  markExported(id: string): Promise<void> {
    return this.run(async () => {
      await this.load();
      if (!this.cache!.has(id)) return;
      this.exported[id] = new Date(this.now()).toISOString();
      await this.saveOrder().catch(() => undefined);
    });
  }

  remove(id: string): Promise<boolean> {
    return this.run(async () => {
      await this.load();
      if (!this.cache!.delete(id)) return false;
      this.order = this.order.filter((x) => x !== id);
      delete this.exported[id];
      await this.saveOrder().catch(() => undefined);
      await this.removeRecord(id);
      return true;
    });
  }

  /** Forget the in-memory cache (tests: a "reload" of the same storage). */
  invalidate(): void {
    this.cache = null;
  }
}
