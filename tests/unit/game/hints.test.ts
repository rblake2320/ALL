import { describe, expect, it } from 'vitest';
import { HINTS, HintEngine, MIN_GAP_MS, parseTutorialProgress, type HintFacts } from '../../../src/game/hints';

const facts = (over: Partial<HintFacts> = {}): HintFacts => ({
  inGame: true,
  mode: 'live',
  sessionSeconds: 0,
  playerSelected: false,
  menuOpened: false,
  queuedAction: false,
  speedChanged: false,
  enteredBuy: false,
  enteredBuild: false,
  billsOutstanding: 0,
  lowestFreshness: 90,
  anyCareer: false,
  choicePending: false,
  ...over,
});

function engine(seen: string[] = []) {
  const persisted: string[][] = [];
  const e = new HintEngine(seen, (ids) => persisted.push(ids));
  return { e, persisted };
}

describe('HintEngine', () => {
  it('starts with the selection hint and advances as the player learns', () => {
    const { e, persisted } = engine();
    let t = 10_000;
    e.update(facts(), t, true);
    expect(e.current?.id).toBe('select');
    t += 1000;
    e.update(facts({ playerSelected: true }), t, true);
    expect(e.current).toBeNull(); // retired; waiting out the gap
    expect(persisted.at(-1)).toContain('select');
    t += MIN_GAP_MS;
    e.update(facts({ playerSelected: true }), t, true);
    expect(e.current?.id).toBe('fridge');
  });

  it('only one hint at a time, with a minimum gap between hints', () => {
    const { e } = engine();
    e.update(facts(), 0, true);
    e.dismiss('select', 100);
    e.update(facts(), 200, true);
    expect(e.current).toBeNull();
    e.update(facts(), 100 + MIN_GAP_MS, true);
    expect(e.current?.id).toBe('fridge');
  });

  it('things the player already did are retired silently before ever showing', () => {
    const { e, persisted } = engine();
    e.update(facts({ playerSelected: true, menuOpened: true, speedChanged: true }), 0, true);
    expect(e.hasSeen('select')).toBe(true);
    expect(e.hasSeen('fridge')).toBe(true);
    expect(e.hasSeen('speed')).toBe(true);
    expect(e.current?.id).toBe('needs');
    expect(persisted.length).toBe(1);
  });

  it('info hints auto-hide and are marked seen', () => {
    const { e } = engine(['select', 'fridge']);
    e.update(facts(), 0, true);
    expect(e.current?.id).toBe('needs');
    e.update(facts(), 60_000, true);
    expect(e.current).toBeNull();
    expect(e.hasSeen('needs')).toBe(true);
  });

  it('context hints hide (without being marked seen) when their context goes away', () => {
    const { e } = engine(HINTS.map((h) => h.id).filter((id) => id !== 'buyHowTo'));
    e.update(facts({ mode: 'buy' }), 0, true);
    expect(e.current?.id).toBe('buyHowTo');
    e.update(facts({ mode: 'live' }), 1000, true);
    expect(e.current).toBeNull();
    expect(e.hasSeen('buyHowTo')).toBe(false);
    e.update(facts({ mode: 'buy' }), 1000 + MIN_GAP_MS, true);
    expect(e.current?.id).toBe('buyHowTo');
  });

  it('contextual gating: bills, freshness, careers', () => {
    const allButBills = HINTS.map((h) => h.id).filter((id) => id !== 'bills');
    const b = engine(allButBills).e;
    b.update(facts(), 0, true);
    expect(b.current).toBeNull();
    expect(b.hasSeen('bills')).toBe(false); // regression: must not be retired before the first bill arrives
    b.update(facts({ billsOutstanding: 120 }), 10_000, true);
    expect(b.current?.id).toBe('bills');
    b.update(facts({ billsOutstanding: 0 }), 11_000, true); // paid: hide, not yet "seen"
    expect(b.current).toBeNull();
    b.update(facts({ billsOutstanding: 80 }), 20_000, true);
    expect(b.current?.id).toBe('bills');
    b.update(facts({ billsOutstanding: 80 }), 51_000, true); // read for 30 s → seen
    expect(b.hasSeen('bills')).toBe(true);

    const f = engine(HINTS.map((h) => h.id).filter((id) => id !== 'freshness')).e;
    f.update(facts({ lowestFreshness: 80 }), 0, true);
    expect(f.current).toBeNull();
    f.update(facts({ lowestFreshness: 40 }), 10_000, true);
    expect(f.current?.id).toBe('freshness');
  });

  it('never shows while disabled, out of game, or during a choice popup', () => {
    const { e } = engine();
    e.update(facts(), 0, false);
    expect(e.current).toBeNull();
    e.update(facts({ inGame: false }), 10_000, true);
    expect(e.current).toBeNull();
    e.update(facts({ choicePending: true }), 20_000, true);
    expect(e.current).toBeNull();
  });

  it('dismiss of unknown ids is ignored; dismiss persists once', () => {
    const { e, persisted } = engine();
    expect(e.dismiss('nonsense', 0)).toBe(false);
    expect(e.dismiss('select', 0)).toBe(true);
    expect(e.dismiss('select', 0)).toBe(true);
    expect(persisted.length).toBe(1);
  });

  it('a throwing predicate is treated as false', () => {
    const persisted: string[][] = [];
    const e = new HintEngine([], (ids) => persisted.push(ids), [
      { id: 'boom', title: 'x', text: 'x', anchor: null, when: () => { throw new Error('bad'); } },
      { id: 'ok', title: 'y', text: 'y', anchor: null, when: () => true },
    ]);
    e.update(facts(), 0, true);
    expect(e.current?.id).toBe('ok');
  });
});

describe('parseTutorialProgress — corrupt profile data', () => {
  it.each([null, undefined, 42, 'seen', [], { seen: 'select' }, { seen: [1, null, {}] }, { v: 1 }])('%j → empty', (raw) => {
    expect(parseTutorialProgress(raw).size).toBe(0);
  });
  it('keeps only known ids', () => {
    expect(Array.from(parseTutorialProgress({ v: 1, seen: ['select', 'hack', 'bills', 'select'] })).sort()).toEqual(['bills', 'select']);
  });
  it('ignores prototype tricks', () => {
    expect(parseTutorialProgress(JSON.parse('{"__proto__": {"seen": ["select"]}}')).size).toBe(0);
  });
  it('no hint is "done" in a brand-new game (done must mean the player demonstrated it)', () => {
    const fresh = facts({ lowestFreshness: 100 });
    for (const h of HINTS) if (h.done) expect(h.done(fresh), h.id).toBe(false);
  });

  it('every hint has unique id, title and text', () => {
    expect(new Set(HINTS.map((h) => h.id)).size).toBe(HINTS.length);
    for (const h of HINTS) {
      expect(h.title.length).toBeGreaterThan(2);
      expect(h.text.length).toBeGreaterThan(10);
    }
  });
});
