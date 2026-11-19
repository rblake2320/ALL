/**
 * Probe (reconciliation, not for commit): keyboard focus on a control of the economy HUD (mounted BESIDE .hud) that
 * unmounts — e.g. the phone quest panel folds after Go, or a quest row completes — must not be stranded on <body>.
 * keynav's rescue() handles this for regions inside .hud only.
 */
import { afterEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ cleanups: [] as Array<(() => void) | void> }));
vi.mock('preact/hooks', () => ({ useEffect: (fn: () => (() => void) | void) => { effects.cleanups.push(fn()); } }));
import { useHudKeyboard } from '../../../src/ui/hud/parts/keynav';

type Fn = (e: unknown) => void;
function et() {
  const fns: Array<{ type: string; fn: Fn; capture: boolean }> = [];
  return {
    addEventListener(type: string, fn: Fn, capture?: boolean) { fns.push({ type, fn, capture: capture === true }); },
    removeEventListener() {},
    fire(type: string, capture: boolean, e: unknown) { for (const l of fns.slice()) if (l.type === type && l.capture === capture) l.fn(e); },
  };
}
function matches(el: El, selector: string): boolean {
  return selector.split(',').some((raw) => {
    const s = raw.trim();
    const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
    if (a) return a[1] in el.attrs && (a[2] === undefined || el.attrs[a[2] === undefined ? a[1] : a[1]] === a[2]);
    if (/^[a-z]+$/.test(s)) return el.tagName === s.toUpperCase();
    throw new Error('unsupported ' + s);
  });
}
const page = { win: et(), doc: et(), body: null as unknown as El, active: null as unknown as El };
class El {
  readonly children: El[] = []; parent: El | null = null; hidden = false; disabled = false;
  constructor(readonly tagName: string, readonly attrs: Record<string, string> = {}, kids: El[] = []) { for (const k of kids) this.append(k); }
  append(k: El) { k.parent = this; this.children.push(k); return k; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); const p = this.parent; this.parent = null; mutated(p); } }
  get name() { return this.attrs.name ?? this.tagName.toLowerCase(); }
  get isConnected() { return page.body.contains(this); }
  get tabIndex() { return 'tabindex' in this.attrs ? Number(this.attrs.tabindex) : this.tagName === 'BUTTON' ? 0 : -1; }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  contains(n: unknown) { for (let p = n as El | null; p; p = p.parent) if (p === this) return true; return false; }
  closest(s: string) { for (let p: El | null = this; p; p = p.parent) if (matches(p, s)) return p; return null; }
  descendants(): El[] { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  querySelectorAll(s: string) { return this.descendants().filter((d) => matches(d, s)); }
  getBoundingClientRect() { return { width: 40, height: 20 }; }
  scrollIntoView() {}
  focus() { page.active = this; page.doc.fire('focusin', true, { target: this }); }
  blur() { if (page.active === this) page.active = page.body; }
}
// MutationObserver as the browser does it: a callback fires only for mutations inside the observed subtree
const observers: Array<{ cb: () => void; target: El | null }> = [];
class MO { target: El | null = null; constructor(readonly cb: () => void) { observers.push(this as unknown as { cb: () => void; target: El | null }); }
  observe(t: El) { this.target = t; } disconnect() { this.target = null; } }
function mutated(parent: El) {
  // the browser drops focus from a removed element onto <body>
  if (!page.active.isConnected) page.active = page.body;
  for (const o of observers) if (o.target && o.target.contains(parent)) o.cb();
}
afterEach(() => { for (const c of effects.cleanups.splice(0)) if (typeof c === 'function') c(); vi.unstubAllGlobals(); });

function mount() {
  const body = new El('BODY'); page.body = body; page.active = body;
  body.append(new El('CANVAS', { id: 'game-canvas', tabindex: '-1', name: 'world' }));
  const hud = new El('DIV', { class: 'hud' }, [new El('DIV', { 'data-hud-region': '10' }, [new El('BUTTON', { name: 'pause' }), new El('BUTTON', { name: 'gone' })])]);
  body.append(new El('DIV', { class: 'sh-screen-host' }, [hud]));
  const panel = new El('SECTION', { name: 'panel' }, [new El('LI', { tabindex: '0', name: 'row' }, [new El('BUTTON', { name: 'go' })])]);
  body.append(new El('DIV', { class: 'st-hud', 'data-hud-region': '15' }, [new El('BUTTON', { name: 'store' }), panel]));
  vi.stubGlobal('window', page.win);
  vi.stubGlobal('MutationObserver', MO);
  vi.stubGlobal('document', { addEventListener: page.doc.addEventListener, removeEventListener: page.doc.removeEventListener, body,
    get activeElement() { return page.active; }, querySelector: () => null, querySelectorAll: (s: string) => body.querySelectorAll(s),
    getElementById: (id: string) => body.descendants().find((d) => d.attrs.id === id) ?? null });
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }));
  useHudKeyboard({ current: hud as unknown as HTMLElement });
  return { find: (n: string) => body.descendants().find((d) => d.name === n)! };
}
const kbFocus = (el: El) => { page.win.fire('keydown', true, { key: 'Shift' }); el.focus(); };

it('control: keyboard focus on a .hud control that unmounts is rescued to its region', () => {
  const { find } = mount();
  kbFocus(find('gone'));
  find('gone').remove();
  expect(page.active.name).toBe('pause');
});

it('keyboard focus on an economy HUD control that unmounts (phone panel folds after Go) is not stranded on <body>', () => {
  const { find } = mount();
  kbFocus(find('go'));
  find('panel').remove();
  expect(page.active.name).not.toBe('body');
});
