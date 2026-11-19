/**
 * Keyboard reach of a HUD region mounted BESIDE the `.hud` root (src/ui/hud/parts/keynav.ts, useHudKeyboard).
 * The shell mounts the economy HUD — Bones / Store / Quests, `.st-hud[data-hud-region="15"]` (src/ui/store/
 * EconomyHud.tsx via StoreLayer in App.tsx) — as a sibling of `.sh-screen-host`, not inside `.hud`. F6 and Tab were
 * scoped to `.hud`, so a keyboard-only player could never focus the Store button, the Quests chevron, a quest row or
 * its Go / Shop button. Proves:
 *  1. F6 / Shift+F6 stop on that block, in region order (top bar 10 → economy 15 → household 20 → world);
 *  2. Tab from a keyboard-focused control in the block walks on through it (the controller never sees it as "next
 *     zombie") and wraps from its last stop to the first `.hud` stop;
 *  3. Tab from the last `.hud` stop goes on into the block, Shift+Tab from the first `.hud` stop back to its last stop;
 *  4. controls: with no such block Tab still wraps inside `.hud`, and a mouse-focused control in the block keeps Tab as
 *     the game's "next zombie".
 *
 * The suite runs in node (no DOM library in the project), so this drives the REAL listeners that useHudKeyboard
 * installs against a small fake DOM: `preact/hooks` useEffect is mocked to run the effect at once, and window /
 * document / elements are duck types that implement only what keynav.ts and lib/focus.ts call. `press` models the
 * event path of the real page: window capture (F6, modality) → document bubble (HUD Tab) → window bubble (the game
 * controller: Tab = cycleZombie + preventDefault, src/game/input/index.ts) → the browser's own Tab if nobody
 * prevented it. An unsupported selector throws, so the fake can never silently match the wrong thing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ cleanups: [] as Array<(() => void) | void> }));
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => (() => void) | void) => {
    effects.cleanups.push(fn());
  },
}));

import { useHudKeyboard } from '../../../src/ui/hud/parts/keynav';

type Fn = (e: unknown) => void;

function eventTarget() {
  const fns: Array<{ type: string; fn: Fn; capture: boolean }> = [];
  return {
    addEventListener(type: string, fn: Fn, capture?: boolean) {
      fns.push({ type, fn, capture: capture === true });
    },
    removeEventListener(type: string, fn: Fn, capture?: boolean) {
      const i = fns.findIndex((l) => l.type === type && l.fn === fn && l.capture === (capture === true));
      if (i >= 0) fns.splice(i, 1);
    },
    fire(type: string, capture: boolean, e: unknown) {
      for (const l of fns.slice()) if (l.type === type && l.capture === capture) l.fn(e);
    },
  };
}

function matches(el: El, selector: string): boolean {
  return selector.split(',').some((raw) => {
    const s = raw.trim();
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
    if (attr) return attr[1] in el.attrs && (attr[2] === undefined || el.attrs[attr[1]] === attr[2]);
    if (/^[a-z]+$/.test(s)) return el.tagName === s.toUpperCase();
    throw new Error(`fake DOM: unsupported selector "${s}"`);
  });
}

interface Page {
  win: ReturnType<typeof eventTarget>;
  doc: ReturnType<typeof eventTarget>;
  body: El;
  active: El;
  /** Tab presses that reached the game controller (each one would select the next zombie). */
  zombieCycles: number;
}
let page: Page;

class El {
  readonly children: El[] = [];
  parent: El | null = null;
  hidden = false;
  disabled = false;
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string> = {},
    kids: El[] = [],
  ) {
    for (const k of kids) this.append(k);
  }
  append(k: El): El {
    k.parent = this;
    this.children.push(k);
    return k;
  }
  get name(): string {
    return this.attrs.name ?? this.tagName.toLowerCase();
  }
  get isConnected(): boolean {
    return page.body.contains(this);
  }
  get tabIndex(): number {
    return 'tabindex' in this.attrs ? Number(this.attrs.tabindex) : this.tagName === 'BUTTON' ? 0 : -1;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  contains(n: unknown): boolean {
    for (let p = n as El | null; p; p = p.parent) if (p === this) return true;
    return false;
  }
  closest(selector: string): El | null {
    for (let p: El | null = this; p; p = p.parent) if (matches(p, selector)) return p;
    return null;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(selector: string): El[] {
    return this.descendants().filter((d) => matches(d, selector));
  }
  getBoundingClientRect() {
    return { width: 40, height: 20 };
  }
  getClientRects() {
    return [{}];
  }
  /** Every scrollIntoView call on this element (its options), in order. */
  readonly scrolls: unknown[] = [];
  scrollIntoView(opts?: unknown): void {
    this.scrolls.push(opts);
  }
  focus(): void {
    page.active = this;
    page.doc.fire('focusin', true, { target: this });
  }
  blur(): void {
    if (page.active === this) page.active = page.body;
  }
}

const button = (name: string) => new El('BUTTON', { name });

/**
 * The game screen as App.tsx lays it out: #game-canvas, `.sh-screen-host > .hud` with two regions, and (optionally)
 * the economy HUD as a sibling layer: Store button, Quests chevron, one quest row (li, tabindex 0) holding its Go button.
 */
function mount(withEconomy: boolean): void {
  const body = new El('BODY', { name: 'body' });
  page = { win: eventTarget(), doc: eventTarget(), body, active: body, zombieCycles: 0 };
  const canvas = body.append(new El('CANVAS', { id: 'game-canvas', tabindex: '-1', name: 'world' }));
  const hud = new El('DIV', { class: 'hud' }, [
    new El('DIV', { 'data-hud-region': '10' }, [button('pause'), button('speed')]),
    new El('DIV', { 'data-hud-region': '20' }, [button('portrait')]),
  ]);
  body.append(new El('DIV', { class: 'sh-screen-host' }, [hud]));
  if (withEconomy) {
    const row = new El('LI', { tabindex: '0', name: 'quest-row' }, [button('go')]);
    body.append(new El('DIV', { class: 'st-hud', 'data-hud-region': '15' }, [button('store'), button('chevron'), row]));
  }
  vi.stubGlobal('window', page.win);
  vi.stubGlobal('document', {
    addEventListener: page.doc.addEventListener,
    removeEventListener: page.doc.removeEventListener,
    body,
    get activeElement() {
      return page.active;
    },
    querySelector: () => null, // no modal layer is open in these scenes (keynav modalOpen)
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    getElementById: (id: string) => body.descendants().find((d) => d.attrs.id === id) ?? null,
  });
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }));
  useHudKeyboard({ current: hud as unknown as HTMLElement });
  canvas.focus(); // the player is in the world
}

function find(name: string): El {
  const el = page.body.descendants().find((d) => d.name === name);
  if (!el) throw new Error(`fake DOM: no element named "${name}"`);
  return el;
}

/** Focus that arrived by keyboard (the last input before the focus change was a key): what F6 / Tab / arrows leave. */
function keyboardFocus(name: string): void {
  page.win.fire('keydown', true, { key: 'Shift', code: 'ShiftLeft' });
  find(name).focus();
}

/** The browser's own Tab: next / previous tab stop in document order; past either end focus leaves the page. */
function nativeTab(backwards: boolean): void {
  const stops = page.body.descendants().filter((d) => d.tabIndex >= 0 && !d.disabled && !d.hidden);
  const next = stops[stops.indexOf(page.active) + (backwards ? -1 : 1)];
  if (next) next.focus();
  else page.active = page.body;
}

function press(key: 'F6' | 'Tab', shiftKey = false): string {
  const e = {
    key,
    code: key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: page.active,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  page.win.fire('keydown', true, e);
  if (!e.stopped) page.doc.fire('keydown', false, e);
  if (!e.stopped && key === 'Tab') {
    page.zombieCycles++;
    e.defaultPrevented = true;
  }
  if (key === 'Tab' && !e.defaultPrevented) nativeTab(shiftKey);
  return page.active.name;
}

const pressAll = (key: 'F6' | 'Tab', times: number, shiftKey = false): string[] => Array.from({ length: times }, () => press(key, shiftKey));

afterEach(() => {
  for (const c of effects.cleanups.splice(0)) if (typeof c === 'function') c();
  vi.unstubAllGlobals();
});

describe('HUD region mounted beside .hud (economy HUD: Bones / Store / Quests)', () => {
  it('F6 stops on it in region order, Shift+F6 walks back through it', () => {
    mount(true);
    expect(pressAll('F6', 4)).toEqual(['pause', 'store', 'portrait', 'world']);
    expect(pressAll('F6', 4, true)).toEqual(['portrait', 'store', 'pause', 'world']);
  });

  it('Tab from a keyboard-focused control in it walks on through the block, then wraps to the first .hud stop', () => {
    mount(true);
    keyboardFocus('store');
    expect(pressAll('Tab', 3)).toEqual(['chevron', 'quest-row', 'go']);
    expect(press('Tab')).toBe('pause');
    expect(page.zombieCycles).toBe(0); // none of those Tabs reached the controller as "next zombie"
  });

  it('Tab from the last .hud stop goes on into it; Shift+Tab from the first .hud stop goes back to its last stop', () => {
    mount(true);
    keyboardFocus('portrait');
    expect(press('Tab')).toBe('store');
    expect(press('Tab', true)).toBe('portrait');
    expect(pressAll('Tab', 2, true)).toEqual(['speed', 'pause']);
    expect(press('Tab', true)).toBe('go');
    expect(page.zombieCycles).toBe(0);
  });

  it('the hop between .hud and it scrolls the newly focused stop into view (the quest panel scrolls; the hop uses preventScroll)', () => {
    mount(true);
    keyboardFocus('pause');
    // Shift+Tab from the first .hud stop lands on the LAST Go button, which can sit below the fold of the quest panel
    expect(press('Tab', true)).toBe('go');
    expect(find('go').scrolls).toEqual([{ block: 'nearest', inline: 'nearest' }]);
    keyboardFocus('portrait');
    expect(press('Tab')).toBe('store');
    expect(find('store').scrolls).toEqual([{ block: 'nearest', inline: 'nearest' }]);
    expect(page.zombieCycles).toBe(0);
  });

  it('control: with no region beside .hud, Tab still wraps inside .hud and F6 cycles as before', () => {
    mount(false);
    expect(pressAll('F6', 3)).toEqual(['pause', 'portrait', 'world']);
    expect(pressAll('F6', 2)).toEqual(['pause', 'portrait']);
    expect(press('Tab')).toBe('pause');
    expect(press('Tab', true)).toBe('portrait');
    expect(page.zombieCycles).toBe(0);
  });

  it('control: a mouse-focused control in it keeps Tab as the game\'s "next zombie"', () => {
    mount(true);
    page.win.fire('pointerdown', true, {});
    find('store').focus();
    expect(press('Tab')).toBe('store');
    expect(page.zombieCycles).toBe(1);
  });
});
