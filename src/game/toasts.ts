/**
 * Transient UI feedback owned by the controller: toast notifications and thought/speech bubbles.
 *
 * Toasts: de-duplicated (same kind+title+text, or same explicit merge key, within `dedupeMs`), at most `max`
 * kept (oldest dropped first). Per the contract the HUD owns the visible lifetime (~6 s, hover pauses, shows 5) and
 * calls dismissToast; the TTL here is only a ≥ 60 s safety net for when no HUD is mounted. Bubbles: one per agent (a new bubble
 * replaces the previous one), bounded list, expiring at `until`.
 * Both expose a stable array reference that only changes when the content changes (cheap UI memoisation).
 */
import type { Toast } from './contracts';
import type { AgentId, NotificationKind, ObjectId } from '../sim/types';

export interface ToastInput {
  kind: NotificationKind;
  title: string;
  text: string;
  agentId?: AgentId | null;
  objectId?: ObjectId | null;
  /** Toasts sharing a merge key within the dedupe window collapse into the first one. */
  mergeKey?: string;
  dedupeMs?: number;
}

/** Contract: the controller caps the list at 20 (the HUD shows at most 5). */
export const TOAST_MAX = 20;
export const TOAST_DEDUPE_MS = 2000;

const NOTIFICATION_KINDS: readonly NotificationKind[] = ['info', 'good', 'bad', 'warning', 'money', 'career', 'social', 'decay', 'romance', 'skill'];

export function isNotificationKind(v: unknown): v is NotificationKind {
  return typeof v === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(v);
}

/** Safety-net expiry (the HUD dismisses visible toasts much sooner). */
export function toastTtlMs(kind: NotificationKind): number {
  return kind === 'bad' || kind === 'warning' || kind === 'decay' ? 90_000 : 60_000;
}

function clip(s: unknown, max: number): string {
  const str = typeof s === 'string' ? s : s === null || s === undefined ? '' : String(s);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

export class ToastCenter {
  private items: Toast[] = [];
  private readonly expiry = new Map<number, number>();
  private readonly recent = new Map<string, number>();
  private nextId = 1;

  constructor(
    private readonly now: () => number,
    private readonly max: number = TOAST_MAX,
    private readonly dedupeMs: number = TOAST_DEDUPE_MS,
  ) {}

  list(): Toast[] {
    return this.items;
  }

  /** Returns the created toast, or null if it was de-duplicated / invalid. */
  push(input: ToastInput): Toast | null {
    const now = this.now();
    const kind: NotificationKind = isNotificationKind(input.kind) ? input.kind : 'info';
    const title = clip(input.title, 120);
    const text = clip(input.text, 400);
    if (title.length === 0 && text.length === 0) return null;
    const window = Number.isFinite(input.dedupeMs) && (input.dedupeMs as number) >= 0 ? (input.dedupeMs as number) : this.dedupeMs;
    this.forgetOld(now);
    const keys = [`c|${kind}|${title}|${text}`];
    if (input.mergeKey) keys.push(`m|${input.mergeKey}`);
    for (const k of keys) {
      const at = this.recent.get(k);
      if (at !== undefined && now - at < window) return null;
    }
    for (const k of keys) this.recent.set(k, now);
    const toast: Toast = {
      id: this.nextId++,
      kind,
      title,
      text,
      agentId: typeof input.agentId === 'string' ? input.agentId : null,
      objectId: typeof input.objectId === 'string' ? input.objectId : null,
      createdAt: now,
    };
    const next = this.items.concat(toast);
    while (next.length > this.max) {
      const dropped = next.shift();
      if (dropped) this.expiry.delete(dropped.id);
    }
    this.items = next;
    this.expiry.set(toast.id, now + toastTtlMs(kind));
    return toast;
  }

  /** True when a merge key was used within the dedupe window (lets callers skip duplicate sounds too). */
  recentlyMerged(mergeKey: string): boolean {
    const at = this.recent.get(`m|${mergeKey}`);
    return at !== undefined && this.now() - at < this.dedupeMs;
  }

  markMerged(mergeKey: string): void {
    this.recent.set(`m|${mergeKey}`, this.now());
  }

  dismiss(id: number): boolean {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    this.expiry.delete(id);
    return this.items.length !== before;
  }

  /** Drop expired toasts. Returns true if the list changed. */
  prune(now: number = this.now()): boolean {
    if (this.items.length === 0) return false;
    const keep = this.items.filter((t) => (this.expiry.get(t.id) ?? 0) > now);
    if (keep.length === this.items.length) return false;
    for (const t of this.items) if (!keep.includes(t)) this.expiry.delete(t.id);
    this.items = keep;
    return true;
  }

  clear(): void {
    this.items = [];
    this.expiry.clear();
    this.recent.clear();
  }

  private forgetOld(now: number): void {
    if (this.recent.size < 64) return;
    for (const [k, at] of this.recent) if (now - at > Math.max(this.dedupeMs, 10_000)) this.recent.delete(k);
  }
}

export interface Bubble {
  key: number;
  agentId: AgentId;
  icon: string;
  style: 'thought' | 'speech' | 'shout';
  positive: boolean;
  until: number;
}

export const BUBBLE_MAX = 16;

export class BubbleBoard {
  private items: Bubble[] = [];
  private nextKey = 1;

  constructor(private readonly max: number = BUBBLE_MAX) {}

  list(): Bubble[] {
    return this.items;
  }

  push(b: Omit<Bubble, 'key'>): Bubble | null {
    if (typeof b.agentId !== 'string' || typeof b.icon !== 'string' || !Number.isFinite(b.until)) return null;
    const style = b.style === 'speech' || b.style === 'shout' ? b.style : 'thought';
    const bubble: Bubble = { key: this.nextKey++, agentId: b.agentId, icon: b.icon, style, positive: b.positive !== false, until: b.until };
    const next = this.items.filter((x) => x.agentId !== b.agentId);
    next.push(bubble);
    while (next.length > this.max) next.shift();
    this.items = next;
    return bubble;
  }

  removeAgent(agentId: AgentId): boolean {
    const before = this.items.length;
    this.items = this.items.filter((b) => b.agentId !== agentId);
    return before !== this.items.length;
  }

  prune(now: number): boolean {
    if (this.items.length === 0) return false;
    const keep = this.items.filter((b) => b.until > now);
    if (keep.length === this.items.length) return false;
    this.items = keep;
    return true;
  }

  clear(): void {
    this.items = [];
  }
}
