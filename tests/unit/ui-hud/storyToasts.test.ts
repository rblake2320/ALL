/**
 * W-116 follow-up: on the phone layout toasts never sit on the Act 1 story card — they are deferred (not drawn,
 * clocks paused, nothing dropped) while a `story:` card is up, and come back once it is gone.
 */
import { describe, expect, it } from 'vitest';
import { toastsDeferred } from '../../../src/ui/hud/notify/Toasts';
import { advanceToastClocks, TOAST_LIFETIME_MS } from '../../../src/ui/hud/lib/toasts';
import type { Toast } from '../../../src/game/contracts';

describe('toasts × story card (phone)', () => {
  it('deferred only on phone while a story card is open', () => {
    expect(toastsDeferred(true, 'story:intro')).toBe(true);
    expect(toastsDeferred(false, 'story:intro')).toBe(true); // desktop too: since W-123 the stack sits left of the quest panel, over the card
    expect(toastsDeferred(false, 'tip:buyMode')).toBe(false);
    expect(toastsDeferred(false, null)).toBe(false);
    expect(toastsDeferred(true, 'tip:buyMode')).toBe(false); // ordinary tips keep the toasts
    expect(toastsDeferred(true, null)).toBe(false);
    expect(toastsDeferred(true, undefined)).toBe(false);
  });

  it('a deferred toast does not age: its clock is paused for the whole card, so it is never lost', () => {
    const t = { id: 1, kind: 'warning', title: 'Your browser may clear saves', text: '…', agentId: null, objectId: null, createdAt: 0 } as unknown as Toast;
    let clocks = advanceToastClocks({}, [t], 0, new Set(), TOAST_LIFETIME_MS, true).clocks;
    for (let now = 1000; now <= 60_000; now += 1000) {
      const r = advanceToastClocks(clocks, [t], now, new Set(), TOAST_LIFETIME_MS, true);
      expect(r.expired).toEqual([]);
      clocks = r.clocks;
    }
    // card gone: the toast now runs its normal lifetime
    let expired: number[] = [];
    for (let now = 61_000; now <= 61_000 + TOAST_LIFETIME_MS + 2000 && expired.length === 0; now += 500) {
      const r = advanceToastClocks(clocks, [t], now, new Set(), TOAST_LIFETIME_MS, false);
      clocks = r.clocks;
      expired = r.expired;
    }
    expect(expired).toEqual([1]);
  });
});
