/**
 * Backlog #19 (F6 in Help), #20 (wrench icon) and #21 (shell keyframes compositor-only + reduced motion).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { KEYMAP } from '../../../src/game/contracts';
import { BUBBLE_ICONS } from '../../../src/sim/contracts';
import { KEY_GROUPS, KeyMapTable, groupedActions } from '../../../src/ui/shell/KeyMapTable';
import { t } from '../../../src/i18n';
import { comboLabels } from '../../../src/ui/common/hotkeys';
import { Icon, hasIcon, iconNames } from '../../../src/ui/icons';
import { BUBBLE_ICON_DEFS } from '../../../src/ui/common/iconData/bubble';
import { hasIcon as hudHasIcon, Icon as HudIcon } from '../../../src/ui/hud/parts/icons';

type AnyNode = VNode<Record<string, unknown>> | string | number | null | undefined | boolean | AnyNode[];

function walk(n: AnyNode, out: VNode<Record<string, unknown>>[] = []): VNode<Record<string, unknown>>[] {
  if (Array.isArray(n)) {
    for (const c of n) walk(c, out);
  } else if (n && typeof n === 'object') {
    out.push(n);
    walk(n.props.children as AnyNode, out);
  }
  return out;
}
const text = (n: AnyNode): string =>
  Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props.children as AnyNode) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';

describe('#19 Help documents F6 / Shift+F6 (KEYMAP.focusHud)', () => {
  it('focusHud sits in exactly one group, and the groups still cover KEYMAP exactly once', () => {
    expect(KEY_GROUPS.filter((g) => g.actions.includes('focusHud')).map((g) => g.id)).toEqual(['general']);
    const g = groupedActions();
    expect(new Set(g).size).toBe(g.length);
    expect([...g].sort()).toEqual(Object.keys(KEYMAP).sort());
  });

  it('has a real label (not the raw key) and both chips render with readable labels', () => {
    expect(t('keys.focusHud')).not.toBe('keys.focusHud');
    expect(t('keys.focusHud')).toMatch(/HUD/);
    const nodes = walk(KeyMapTable({ columns: 2 }) as AnyNode);
    const dts = nodes.filter((n) => n.type === 'dt');
    const i = dts.findIndex((n) => text(n) === t('keys.focusHud'));
    expect(i).toBeGreaterThanOrEqual(0);
    // its <dd> lists Kbd chips for both combos, in KEYMAP order
    const dds = nodes.filter((n) => n.type === 'dd');
    const combos = walk(dds[i].props.children as AnyNode)
      .map((n) => n.props.combo)
      .filter((c): c is string => typeof c === 'string');
    expect(combos).toEqual(['F6', 'shift+F6']);
    expect(comboLabels('F6')).toEqual(['F6']);
    expect(comboLabels('shift+F6').join('+')).toMatch(/Shift.*F6/);
  });
});

describe('#20 wrench icon', () => {
  it("'wrench' is a BubbleIcon with a real glyph in both icon sets (not the fallback)", () => {
    expect(BUBBLE_ICONS).toContain('wrench');
    expect(new Set(BUBBLE_ICONS).size).toBe(BUBBLE_ICONS.length);
    expect(hasIcon('wrench')).toBe(true);
    expect(iconNames).toContain('wrench');
    expect(hudHasIcon('wrench')).toBe(true);
    const def = BUBBLE_ICON_DEFS.wrench;
    expect(def.length).toBeGreaterThan(0);
    for (const p of def) {
      const d = typeof p === 'string' ? p.replace(/^[FTD] /, '') : p.d;
      expect(d).toMatch(/^M/);
      expect(d).not.toMatch(/NaN|undefined|Infinity/);
    }
    // differs from the fallback glyph an unknown name gets
    const paths = (n: AnyNode) => walk(n).filter((x) => x.type === 'path').map((x) => x.props.d);
    expect(paths(Icon({ name: 'wrench' }) as AnyNode)).not.toEqual(paths(Icon({ name: 'definitely-not-an-icon' }) as AnyNode));
    expect(HudIcon({ name: 'wrench' })).toBeTruthy();
  });

  it('the wrench outline stays inside the 24px grid after its 45° rotation', () => {
    const def = BUBBLE_ICON_DEFS.wrench.find((p) => typeof p !== 'string' && !p.soft) as { d: string; transform?: string };
    expect(def.transform).toBe('rotate(45 12 12)');
    const nums = def.d.match(/-?\d*\.?\d+/g)!.map(Number);
    // absolute vertices of the path (M/V/h/A endpoints) are all within 10.5 of the centre → within [1.5, 22.5] rotated
    const pts: [number, number][] = [
      [10.25, 19.5], [10.25, 10.4], [10.5, 2.01], [10.5, 5.25], [13.5, 5.25], [13.5, 2.01], [13.75, 10.4], [13.75, 19.5], [12, 21.25],
    ];
    expect(nums.length).toBeGreaterThan(10);
    for (const [x, y] of pts) expect(Math.hypot(x - 12, y - 12)).toBeLessThanOrEqual(10.5);
  });
});

// ───────────────────────── #21 CSS ─────────────────────────

const css = (f: string) => readFileSync(resolve(__dirname, '../../../src/ui/theme', f), 'utf8');
const ALL = css('base.css') + '\n' + css('meters.css') + '\n' + readFileSync(resolve(__dirname, '../../../src/ui/hud/household/household.css'), 'utf8');

/** Body of `@keyframes name { … }` (balanced braces). */
function keyframes(src: string, name: string): string {
  const start = src.indexOf(`@keyframes ${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
const props = (body: string) => [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('#21 shell alert keyframes are compositor-only and respect reduced motion', () => {
  it.each(['ui-portrait-alert', 'ui-pulse-critical'])('%s animates only opacity / transform', (name) => {
    const all = stripComments(ALL);
    expect(all.split(`@keyframes ${name}`).length - 1, 'defined once').toBe(1);
    const p = props(keyframes(all, name));
    expect(p.length).toBeGreaterThan(0);
    expect(p.filter((x) => x !== 'opacity' && x !== 'transform')).toEqual([]);
  });

  it('the animations run on pseudo-elements, never on the SVG ring or the track box itself', () => {
    const all = stripComments(ALL);
    const rules = [...all.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const users = rules.filter((r) => /animation\s*:\s*ui-(portrait-alert|pulse-critical)\b/.test(r.body));
    expect(users.map((r) => r.sel).sort()).toEqual(['.ui-need.is-critical .ui-need__track::after', '.ui-portrait.is-alert.has-ring::after']);
    for (const r of users) expect(r.body).toMatch(/will-change\s*:\s*opacity/);
  });

  it('prefers-reduced-motion (system) and html.reduce-motion (setting) both stop both pulses', () => {
    const all = stripComments(ALL);
    const media = [...all.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    for (const sel of ['.ui-portrait.is-alert.has-ring::after', '.ui-need.is-critical .ui-need__track::after']) {
      const inMedia = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*animation\\s*:\\s*none');
      expect(media, `media ${sel}`).toMatch(inMedia);
      const inSetting = new RegExp('html\\.reduce-motion ' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*animation\\s*:\\s*none');
      expect(all, `setting ${sel}`).toMatch(inSetting);
    }
  });

  it('the portrait only gets the overlay ring when it has a ring (alert without ring draws nothing new)', () => {
    // Portrait uses hooks (no DOM renderer in this node suite) — the class wiring is checked at source level and in
    // the real-game Playwright run.
    const src = readFileSync(resolve(__dirname, '../../../src/ui/common/Portrait.tsx'), 'utf8');
    expect(src).toMatch(/alert && 'is-alert', !!ring && 'has-ring'/);
    expect(stripComments(ALL)).not.toMatch(/\.ui-portrait\.is-alert::after/); // never without .has-ring
  });
});
