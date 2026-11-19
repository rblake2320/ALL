import { describe, expect, it } from 'vitest';
import { SHELL_TOAST_MAX, SHELL_TOAST_MS, selectShellToasts, tickToastClocks } from '../../../src/ui/shell/toastLogic';

const toast = (id: number, extra: Record<string, unknown> = {}) => ({ id, kind: 'good', title: `T${id}`, text: 'x', agentId: null, objectId: null, createdAt: id * 10, ...extra });

describe('selectShellToasts', () => {
  it('returns newest first, capped', () => {
    const list = [toast(1), toast(2), toast(3), toast(4), toast(5)];
    expect(selectShellToasts(list).map((t) => t.id)).toEqual([5, 4, 3]);
    expect(selectShellToasts(list, 1).map((t) => t.id)).toEqual([5]);
    expect(selectShellToasts(list, 0)).toEqual([]);
    expect(selectShellToasts(list, NaN).length).toBe(SHELL_TOAST_MAX);
    expect(selectShellToasts(list, -4)).toEqual([]);
    expect(selectShellToasts(list, 2.9).length).toBe(2);
  });
  it('breaks createdAt ties by list order (later = newer)', () => {
    const list = [toast(9, { createdAt: 5 }), toast(3, { createdAt: 5 }), toast(7, { createdAt: 5 })];
    expect(selectShellToasts(list).map((t) => t.id)).toEqual([7, 3, 9]);
  });
  it('drops garbage, duplicates and empty toasts; never throws', () => {
    const list: unknown[] = [
      null,
      undefined,
      42,
      'toast',
      [],
      { id: 'x', title: 'bad id' },
      { id: NaN, title: 'nan id' },
      { id: Infinity, title: 'inf id' },
      { id: 1, title: '   ', text: '' },
      toast(2),
      toast(2, { title: 'duplicate' }),
      { id: 3, title: 42, text: 'Only text' },
      { id: 4, kind: 'constructor', title: 'Odd kind', createdAt: 'yesterday' },
      { id: 5, kind: '__proto__', title: 'Proto kind', createdAt: -Infinity },
    ];
    const out = selectShellToasts(list, 10);
    expect(out.map((t) => t.id).sort()).toEqual([2, 3, 4, 5]);
    expect(out.find((t) => t.id === 2)?.title).toBe('T2');
    const textOnly = out.find((t) => t.id === 3)!;
    expect(textOnly.title).toBe('Only text');
    expect(textOnly.text).toBe('');
    expect(out.find((t) => t.id === 4)?.kind).toBe('info');
    expect(out.find((t) => t.id === 5)?.kind).toBe('info');
    for (const t of out) expect(Number.isFinite(t.createdAt)).toBe(true);
    expect(selectShellToasts(null)).toEqual([]);
    expect(selectShellToasts(undefined)).toEqual([]);
    expect(selectShellToasts({ length: 3 } as never)).toEqual([]);
  });
  it('does not mutate its input', () => {
    const list = [toast(1), toast(2)];
    const copy = JSON.stringify(list);
    selectShellToasts(list);
    expect(JSON.stringify(list)).toBe(copy);
  });
});

describe('tickToastClocks', () => {
  it('starts new toasts at the full lifetime (no time charged before they showed) and counts down', () => {
    let r = tickToastClocks({}, [1, 2], 1000, new Set());
    expect(r.next).toEqual({ 1: SHELL_TOAST_MS, 2: SHELL_TOAST_MS });
    expect(r.expired).toEqual([]);
    r = tickToastClocks(r.next, [1, 2], 1000, new Set());
    expect(r.next).toEqual({ 1: SHELL_TOAST_MS - 1000, 2: SHELL_TOAST_MS - 1000 });
    r = tickToastClocks(r.next, [1, 2], SHELL_TOAST_MS - 1000, new Set());
    expect(r.expired.sort()).toEqual([1, 2]);
    expect(r.next).toEqual({});
  });
  it('pauses hovered toasts (or all of them)', () => {
    const start = { 1: 3000, 2: 3000 };
    let r = tickToastClocks(start, [1, 2], 2500, new Set([2]));
    expect(r.next).toEqual({ 1: 500, 2: 3000 });
    r = tickToastClocks(start, [1, 2], 99999, true);
    expect(r.next).toEqual(start);
    expect(r.expired).toEqual([]);
  });
  it('forgets toasts that left the screen and ignores bad ids', () => {
    const r = tickToastClocks({ 1: 100, 9: 100 }, [1, NaN, Infinity, 'x' as never, 1], 10, new Set());
    expect(r.next).toEqual({ 1: 90 });
  });
  it('treats negative/NaN elapsed as no time and caps huge jumps at one lifetime', () => {
    expect(tickToastClocks({ 1: 400 }, [1], -5000, new Set()).next).toEqual({ 1: 400 });
    expect(tickToastClocks({ 1: 400 }, [1], NaN, new Set()).next).toEqual({ 1: 400 });
    // A toast that appeared while the tab was throttled still gets its full time on screen…
    expect(tickToastClocks({}, [1], 10 * 60_000, new Set())).toEqual({ next: { 1: SHELL_TOAST_MS }, expired: [] });
    // …while one already on screen cannot outlive a giant gap.
    expect(tickToastClocks({ 1: SHELL_TOAST_MS }, [1], 1e12, new Set()).expired).toEqual([1]);
  });
  it('repairs corrupt clock values and bad lifetimes', () => {
    const r = tickToastClocks({ 1: NaN, 2: Infinity } as never, [1, 2], 0, new Set(), -1);
    expect(r.next).toEqual({ 1: SHELL_TOAST_MS, 2: SHELL_TOAST_MS });
    expect(tickToastClocks(null, [3], 0, false, 1000).next).toEqual({ 3: 1000 });
  });
});
