/**
 * Adversarial tests for the UI-HUD finishing pass: focus hand-back when the interaction menu closes (backlog #16),
 * HUD keyboard entry (F6 regions, Tab ownership, focus modality), moodlet totals (engine semantics: `mood` already
 * includes stacks), thumbnail retry windows and the allocation-free bubble placement loop.
 */
import { describe, expect, it } from 'vitest';
import type { MoodletView } from '../../../src/sim/contracts';
import type { BubbleAnchor } from '../../../src/render/contracts';
import { moodletStacks, moodletTotal, strongestMoodlets } from '../../../src/ui/hud/agent/tabsA';
import { placeBubbles } from '../../../src/ui/hud/bubbles/BubbleLayer';
import { failureBlocks, THUMB_RETRY_MS } from '../../../src/ui/hud/buy/thumbs';
import { focusExit, UI_OWNED_SELECTOR, type FocusTargetLike } from '../../../src/ui/hud/lib/focus';
import { menuKey } from '../../../src/ui/hud/menu/InteractionMenu';
import { hudOwnsTab, keyboardModality, nextRegion, tabWrap } from '../../../src/ui/hud/parts/keynav';
import { UI_OWNED_SELECTOR as CONTROLLER_UI_OWNED } from '../../../src/game/input/keyboard';

// ───────────────────────────── focus hand-back (backlog #16) ─────────────────────────────

/** Minimal element stand-ins: a tree of nodes, `contains` walks parents, `closest` matches a role set. */
function node(opts: { parent?: Fake | null; roles?: string[]; connected?: boolean; focusable?: boolean } = {}): Fake {
  const n: Fake = {
    parent: opts.parent ?? null,
    roles: opts.roles ?? [],
    isConnected: opts.connected ?? true,
    focus: opts.focusable === false ? undefined : () => undefined,
    blur: () => undefined,
    closest(sel: string) {
      for (let cur: Fake | null = n; cur; cur = cur.parent) {
        if (cur.roles.some((r) => sel.includes(`[role="${r}"]`) || (r === 'modal' && sel.includes('[aria-modal="true"]')))) return cur;
      }
      return null;
    },
    contains(other: unknown) {
      for (let cur = other as Fake | null; cur; cur = cur.parent) if (cur === n) return true;
      return false;
    },
  };
  return n;
}
interface Fake extends FocusTargetLike {
  parent: Fake | null;
  roles: string[];
  contains(other: unknown): boolean;
}

describe('focusExit (interaction menu close path)', () => {
  const doc = node();
  const body = node({ parent: doc });
  const canvas = node({ parent: body });
  const layer = node({ parent: body, roles: ['menu'] });
  const row = node({ parent: layer });

  it('gives focus back to the element that opened the menu (the world canvas)', () => {
    expect(focusExit(row, canvas, layer, [body, doc])).toBe('opener');
  });
  it('does nothing when focus already left the menu', () => {
    expect(focusExit(canvas, canvas, layer)).toBe('none');
    expect(focusExit(null, canvas, layer)).toBe('none');
    expect(focusExit(undefined, canvas, layer)).toBe('none');
  });
  it('blurs when there is no usable opener', () => {
    expect(focusExit(row, null, layer)).toBe('blur');
    expect(focusExit(row, body, layer, [body, doc])).toBe('blur'); // body / documentElement are not targets
    expect(focusExit(row, node({ parent: body, connected: false }), layer)).toBe('blur'); // detached
    expect(focusExit(row, node({ parent: body, focusable: false }), layer)).toBe('blur'); // no focus()
    expect(focusExit(row, row, layer)).toBe('blur'); // opener IS the focused row
    expect(focusExit(row, node({ parent: layer }), layer)).toBe('blur'); // opener inside the closing menu
  });
  it('never hands focus to a UI-owned element (the next hotkey would be swallowed again)', () => {
    const dialog = node({ parent: body, roles: ['dialog'] });
    expect(focusExit(row, node({ parent: dialog }), layer)).toBe('blur');
    const other = node({ parent: body, roles: ['alertdialog'] });
    expect(focusExit(row, node({ parent: other }), layer)).toBe('blur');
    const modal = node({ parent: body, roles: ['modal'] });
    expect(focusExit(row, node({ parent: modal }), layer)).toBe('blur');
  });
  it('survives hostile scopes and elements', () => {
    const throwing = { contains: () => { throw new Error('boom'); } };
    expect(focusExit(row, canvas, throwing)).toBe('none');
    expect(focusExit(row, canvas, null)).toBe('none');
    const evil: FocusTargetLike = { focus: () => undefined, closest: () => { throw new Error('bad selector'); } };
    expect(focusExit(row, evil, layer)).toBe('opener');
  });
  it('uses exactly the controller selector for "keys belong to the UI"', () => {
    expect(UI_OWNED_SELECTOR).toBe(CONTROLLER_UI_OWNED);
  });
});

describe('menuKey', () => {
  it('identifies a menu by actor, title and position', () => {
    expect(menuKey({ actorId: 'a1', title: 'Fridge', x: 10, y: 20 })).toBe('a1|Fridge|10|20');
    expect(menuKey({ actorId: 'a1', title: 'Fridge', x: 10, y: 20 })).not.toBe(menuKey({ actorId: 'a1', title: 'Fridge', x: 11, y: 20 }));
  });
  it('is empty for no menu', () => {
    expect(menuKey(null)).toBe('');
    expect(menuKey(undefined)).toBe('');
  });
});

// ───────────────────────────── HUD keyboard entry ─────────────────────────────

describe('nextRegion (F6 cycling with the world as a stop)', () => {
  it('walks world → 0 → … → n-1 → world', () => {
    const seq: number[] = [];
    let cur = -1;
    for (let i = 0; i < 5; i++) seq.push((cur = nextRegion(cur, 3, 1)));
    expect(seq).toEqual([0, 1, 2, -1, 0]);
  });
  it('Shift+F6 walks backwards and wraps through the world', () => {
    expect(nextRegion(-1, 3, -1)).toBe(2);
    expect(nextRegion(0, 3, -1)).toBe(-1);
    expect(nextRegion(2, 3, -1)).toBe(1);
  });
  it('treats junk positions as the world and junk counts as no regions', () => {
    expect(nextRegion(99, 3, 1)).toBe(0);
    expect(nextRegion(Number.NaN, 3, 1)).toBe(0);
    expect(nextRegion(1.5, 3, 1)).toBe(0);
    expect(nextRegion(0, 0, 1)).toBe(-1);
    expect(nextRegion(0, -4, 1)).toBe(-1);
    expect(nextRegion(0, Number.POSITIVE_INFINITY, 1)).toBe(-1);
    expect(nextRegion(0, 1, 1)).toBe(-1);
    expect(nextRegion(-1, 1, 1)).toBe(0);
  });
});

describe('tabWrap', () => {
  it('wraps only at the ends', () => {
    expect(tabWrap(4, 5, false)).toBe(0);
    expect(tabWrap(0, 5, true)).toBe(4);
    expect(tabWrap(2, 5, false)).toBeNull();
    expect(tabWrap(2, 5, true)).toBeNull();
  });
  it('enters the list when the focused element is not in it', () => {
    expect(tabWrap(-1, 5, false)).toBe(0);
    expect(tabWrap(-1, 5, true)).toBe(4);
    expect(tabWrap(Number.NaN, 3, false)).toBe(0);
  });
  it('has nowhere to go in an empty list', () => {
    expect(tabWrap(0, 0, false)).toBeNull();
    expect(tabWrap(0, Number.NaN, true)).toBeNull();
  });
  it('single element: Tab stays on it (wrap to itself)', () => {
    expect(tabWrap(0, 1, false)).toBe(0);
    expect(tabWrap(0, 1, true)).toBe(0);
  });
});

describe('hudOwnsTab', () => {
  const btn = { tagName: 'BUTTON' };
  it('navigates the HUD only for keyboard-focused HUD controls outside dialogs/menus', () => {
    expect(hudOwnsTab(btn, true, false, true)).toBe(true);
    expect(hudOwnsTab(btn, true, false, false)).toBe(false); // mouse focus: Tab stays "next zombie"
    expect(hudOwnsTab(btn, false, false, true)).toBe(false); // not in the HUD
    expect(hudOwnsTab(btn, true, true, true)).toBe(false); // dialogs / menus trap Tab themselves
  });
  it('text fields always own Tab (the controller ignores editable targets anyway)', () => {
    expect(hudOwnsTab({ tagName: 'input' }, true, false, false)).toBe(true);
    expect(hudOwnsTab({ tagName: 'TEXTAREA' }, true, false, false)).toBe(true);
    expect(hudOwnsTab({ tagName: 'DIV', isContentEditable: true }, true, false, false)).toBe(true);
  });
  it('rejects junk targets', () => {
    expect(hudOwnsTab(null, true, false, true)).toBe(false);
    expect(hudOwnsTab({}, true, false, true)).toBe(true); // an element we know nothing about: trust the modality
    expect(hudOwnsTab({ tagName: 42 as unknown as string }, true, false, false)).toBe(false);
  });
});

describe('keyboardModality', () => {
  it('the latest input decides', () => {
    expect(keyboardModality(200, 100)).toBe(true);
    expect(keyboardModality(100, 200)).toBe(false);
    expect(keyboardModality(100, 100)).toBe(true); // same stamp: keyboard (programmatic focus inside a keydown)
  });
  it('treats missing stamps as "never"', () => {
    expect(keyboardModality(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(keyboardModality(Number.NaN, 5)).toBe(false);
    expect(keyboardModality(5, Number.NaN)).toBe(true);
  });
});

// ───────────────────────────── moodlets: engine semantics ─────────────────────────────

const ml = (id: string, mood: number, stacks = 1): MoodletView => ({ id, label: id, description: '', mood, stacks, icon: 'happy', kind: mood >= 0 ? 'good' : 'bad', remaining: null });

describe('moodletTotal / moodletStacks', () => {
  it('reports the engine total as is (views.ts already multiplies by stacks)', () => {
    expect(moodletTotal(ml('a', -15, 3))).toBe(-15);
    expect(moodletTotal(ml('b', 8))).toBe(8);
  });
  it('junk → 0 / 1', () => {
    expect(moodletTotal(null)).toBe(0);
    expect(moodletTotal(ml('n', Number.NaN))).toBe(0);
    expect(moodletTotal({ mood: Number.POSITIVE_INFINITY } as MoodletView)).toBe(0);
    expect(moodletStacks(null)).toBe(1);
    expect(moodletStacks(ml('s', 1, 0))).toBe(1);
    expect(moodletStacks(ml('s', 1, -2))).toBe(1);
    expect(moodletStacks(ml('s', 1, 2.9))).toBe(2);
    expect(moodletStacks(ml('s', 1, Number.NaN))).toBe(1);
  });
  it('a stacked moodlet ranks by its total, never by total × stacks', () => {
    // engine: def −6 × 3 stacks → mood −18; the bug ranked it as −54 above a −30 moodlet
    expect(strongestMoodlets([ml('stack', -18, 3), ml('big', -30)], 1).map((m) => m.id)).toEqual(['big']);
  });
});

// ───────────────────────────── thumbnails: retry window ─────────────────────────────

describe('failureBlocks', () => {
  it('blocks a retry only within the window', () => {
    expect(failureBlocks(1000, 1000 + THUMB_RETRY_MS - 1)).toBe(true);
    expect(failureBlocks(1000, 1000 + THUMB_RETRY_MS)).toBe(false);
    expect(failureBlocks(undefined, 5)).toBe(false);
  });
  it('a clock that went backwards (or junk) never blocks forever', () => {
    expect(failureBlocks(5000, 1000)).toBe(false);
    expect(failureBlocks(Number.NaN, 1000)).toBe(false);
    expect(failureBlocks(1000, Number.NaN)).toBe(true);
    expect(failureBlocks(1000, 1500, -3)).toBe(true); // junk window → default window
    expect(failureBlocks(1000, 1000 + THUMB_RETRY_MS + 1, Number.NaN)).toBe(false);
  });
});

// ───────────────────────────── bubbles: allocation-free placement ─────────────────────────────

type Bubble = { key: number; agentId: string; icon: string; style: 'thought' | 'speech' | 'shout'; positive: boolean; until: number };

/** A fake bubble element that counts style writes. */
function fakeEl() {
  const writes = { transform: 0, visibility: 0, zIndex: 0 };
  const values: Record<string, string> = { transform: '', visibility: 'hidden', zIndex: '' };
  const style = {} as Record<string, string>;
  for (const k of Object.keys(values) as (keyof typeof writes)[]) {
    Object.defineProperty(style, k, {
      get: () => values[k],
      set: (v: string) => {
        writes[k]++;
        values[k] = v;
      },
    });
  }
  return { el: { style } as unknown as HTMLDivElement, writes, values };
}

describe('placeBubbles', () => {
  const b = (key: number, agentId: string): Bubble => ({ key, agentId, icon: 'tv', style: 'thought', positive: true, until: Infinity });
  const setup = (anchors: () => unknown) => {
    const game = { renderer: { bubbleAnchors: anchors } } as never;
    return { game, byAgent: new Map<string, BubbleAnchor>(), placed: new Map() };
  };

  it('positions a visible bubble and does not rewrite an unchanged frame', () => {
    const e = fakeEl();
    const els = new Map([[1, e.el]]);
    const s = setup(() => [{ agentId: 'a1', x: 100, y: 200, visible: true, scale: 1 }]);
    placeBubbles(s.game, [b(1, 'a1')], els, new Map(), new Map(), s.byAgent, s.placed);
    expect(e.values.visibility).toBe('visible');
    expect(e.values.transform).toContain('translate(100.0px, 194.0px)');
    expect(e.values.zIndex).toBe('1200');
    const before = { ...e.writes };
    for (let i = 0; i < 10; i++) placeBubbles(s.game, [b(1, 'a1')], els, new Map(), new Map(), s.byAgent, s.placed);
    expect(e.writes).toEqual(before); // standing still: zero DOM writes
  });

  it('moves only when the anchor really moved, and keeps reusing its maps', () => {
    const e = fakeEl();
    const els = new Map([[1, e.el]]);
    let x = 100;
    const s = setup(() => [{ agentId: 'a1', x, y: 200, visible: true, scale: 1 }]);
    const byAgent = s.byAgent;
    placeBubbles(s.game, [b(1, 'a1')], els, new Map(), new Map(), byAgent, s.placed);
    x = 100.01; // sub-threshold jitter
    placeBubbles(s.game, [b(1, 'a1')], els, new Map(), new Map(), byAgent, s.placed);
    expect(e.writes.transform).toBe(1);
    x = 140;
    placeBubbles(s.game, [b(1, 'a1')], els, new Map(), new Map(), byAgent, s.placed);
    expect(e.writes.transform).toBe(2);
    expect(e.values.transform).toContain('translate(140.0px');
    expect(s.byAgent).toBe(byAgent);
  });

  it('stacks bubbles of one zombie upwards; a leaving bubble keeps its last slot', () => {
    const e1 = fakeEl();
    const e2 = fakeEl();
    const els = new Map([
      [1, e1.el],
      [2, e2.el],
    ]);
    const s = setup(() => [{ agentId: 'a1', x: 0, y: 500, visible: true, scale: 1 }]);
    placeBubbles(s.game, [b(1, 'a1'), b(2, 'a1')], els, new Map([[1, 0]]), new Map([[2, 1]]), s.byAgent, s.placed);
    const y1 = Number(/, ([-\d.]+)px\)/.exec(e1.values.transform)![1]);
    const y2 = Number(/, ([-\d.]+)px\)/.exec(e2.values.transform)![1]);
    expect(y2).toBeLessThan(y1); // slot 1 sits above slot 0
  });

  it('hides bubbles whose zombie has no (valid) anchor and never throws on hostile renderers', () => {
    const e = fakeEl();
    const els = new Map([[1, e.el]]);
    const cases: (() => unknown)[] = [
      () => [],
      () => null,
      () => [{ agentId: 'a1', x: Number.NaN, y: 3, visible: true, scale: 1 }],
      () => [{ agentId: 'a1', x: 1, y: 3, visible: false, scale: 1 }],
      () => [null, 7, { agentId: 42 }, { agentId: 'a1', x: 'left', y: 3, visible: true }],
      () => {
        throw new Error('renderer gone');
      },
    ];
    for (const anchors of cases) {
      const s = setup(anchors);
      expect(() => placeBubbles(s.game, [b(1, 'a1')], els, new Map(), new Map(), s.byAgent, s.placed)).not.toThrow();
      expect(e.values.visibility).toBe('hidden');
    }
  });

  it('clamps absurd scales and forgets bubbles that are gone', () => {
    const e = fakeEl();
    const els = new Map([[1, e.el]]);
    const s = setup(() => [{ agentId: 'a1', x: 1, y: 1, visible: true, scale: 1e9 }]);
    placeBubbles(s.game, [b(1, 'a1'), b(9, 'a1')], els, new Map(), new Map(), s.byAgent, s.placed);
    expect(e.values.transform).toContain('scale(1.200)');
    els.delete(1);
    s.placed.set(5, { x: 0, y: 0, s: 1, z: 0, visible: true });
    placeBubbles(s.game, [], els, new Map(), new Map(), s.byAgent, s.placed);
    placeBubbles(s.game, [b(2, 'a1')], els, new Map(), new Map(), s.byAgent, s.placed);
    expect(s.placed.has(1)).toBe(false);
    expect(s.placed.has(5)).toBe(false);
  });
});

// ───────────────────────────── real-content labels ─────────────────────────────

import { cleanActivityLabel, partyEndsTime } from '../../../src/ui/hud/lib/format';

describe('partyEndsTime', () => {
  it('keeps SIM-PEOPLE’s complete phrases verbatim (no "Ends Ends")', () => {
    expect(partyEndsTime('Ends 1:16 AM')).toEqual({ when: '1:16 AM' });
    expect(partyEndsTime('ends: 1:16 AM')).toEqual({ when: '1:16 AM' });
    expect(partyEndsTime('Party’s over')).toEqual({ phrase: 'Party’s over' });
    expect(partyEndsTime('Ends')).toEqual({ phrase: 'Ends' });
  });
  it('wraps the engine fallback’s bare times', () => {
    expect(partyEndsTime('Today 11:30 PM')).toEqual({ when: 'Today 11:30 PM' });
    expect(partyEndsTime('Tomorrow 1:16 AM')).toEqual({ when: 'Tomorrow 1:16 AM' });
    expect(partyEndsTime('Mon 1:16 AM')).toEqual({ when: 'Mon 1:16 AM' });
    expect(partyEndsTime('1:16 AM')).toEqual({ when: '1:16 AM' });
    expect(partyEndsTime('in 3h')).toEqual({ when: 'in 3h' });
  });
  it('junk → a placeholder time, never throws', () => {
    expect(partyEndsTime(undefined)).toEqual({ when: '—' });
    expect(partyEndsTime(42)).toEqual({ when: '—' });
    expect(partyEndsTime('   ')).toEqual({ when: '—' });
    expect(partyEndsTime('  Ends   1:16   AM ')).toEqual({ when: '1:16 AM' });
  });
});

describe('cleanActivityLabel', () => {
  it('repairs the gerund of an ellipsis label', () => {
    expect(cleanActivityLabel('Cook…ing')).toBe('Cooking');
    expect(cleanActivityLabel('Cook...ing')).toBe('Cooking');
    expect(cleanActivityLabel('Cook…ing Cerebellum Stew')).toBe('Cooking Cerebellum Stew');
  });
  it('leaves ordinary labels alone', () => {
    expect(cleanActivityLabel('Slamming the Door Dramatically')).toBe('Slamming the Door Dramatically');
    expect(cleanActivityLabel('Waiting… for pizza')).toBe('Waiting… for pizza');
    expect(cleanActivityLabel('  Watching   TV ')).toBe('Watching TV');
  });
  it('junk → empty (callers fall back to "Idle")', () => {
    expect(cleanActivityLabel(null)).toBe('');
    expect(cleanActivityLabel(undefined)).toBe('');
    expect(cleanActivityLabel(7)).toBe('');
  });
});

// ───────────────────────────── Esc layers: stale vs closing ─────────────────────────────

import { escapeTarget, liveLayers } from '../../../src/ui/hud/parts/hooks';

describe('liveLayers (Esc claims)', () => {
  type L = { id: string; closingAt: number; isOpen: (() => boolean) | null };
  const L = (id: string, closingAt = Number.NEGATIVE_INFINITY, isOpen: (() => boolean) | null = null): L => ({ id, closingAt, isOpen });
  const at = 10_000;

  it('keeps open layers and drops ones the controller already closed', () => {
    const stack = [L('drawer', undefined, () => true), L('menu', undefined, () => false)];
    expect(liveLayers(stack, at).map((l) => l.id)).toEqual(['drawer']);
  });
  it('a layer WE just closed still claims the quick second Esc (grace window), even if the controller agrees it is closed', () => {
    const stack = [L('dialog', at - 50, () => false)];
    expect(liveLayers(stack, at).map((l) => l.id)).toEqual(['dialog']);
    expect(escapeTarget(liveLayers(stack, at), at)).toBeNull(); // claimed, but nothing to run → swallowed, no pause menu
    expect(liveLayers(stack, at + 1000).map((l) => l.id)).toEqual([]); // grace over, closed → not ours
  });
  it('all layers stale → nothing to claim (the key belongs to the controller)', () => {
    expect(liveLayers([L('a', undefined, () => false), L('b', undefined, () => false)], at)).toEqual([]);
  });
  it('layers without a predicate are always live; a throwing predicate counts as open (never falls through)', () => {
    const stack = [L('legacy'), L('broken', undefined, () => { throw new Error('boom'); })];
    expect(liveLayers(stack, at).map((l) => l.id)).toEqual(['legacy', 'broken']);
  });
  it('the target is the newest live, non-closing layer', () => {
    const stack = [L('drawer', undefined, () => true), L('dialog', at - 10, () => false), L('menu', undefined, () => false)];
    const live = liveLayers(stack, at);
    expect(live.map((l) => l.id)).toEqual(['drawer', 'dialog']);
    expect(escapeTarget(live, at)?.id).toBe('drawer'); // dialog is closing → skipped, menu stale → dropped
  });
  it('clock junk: a future closingAt is not "closing"', () => {
    const stack = [L('x', at + 500, () => false)];
    expect(liveLayers(stack, at)).toEqual([]);
  });
});
