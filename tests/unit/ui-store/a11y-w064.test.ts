/**
 * W-064 store / age-gate accessibility fixes (Sol W-023 A3, A4 — docs/desktop-reports/a11y-l10n.md on
 * desktop/sol-a11y). Browser-level evidence: tests/e2e/a11y.mjs (Escape from the year field, 390 px Store geometry).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ageFieldKeyDown } from '../../../src/ui/store/AgeGate';

const src = (p: string) => readFileSync(new URL(`../../../src/ui/${p}`, import.meta.url), 'utf8');

function key(k: string) {
  let stopped = false;
  ageFieldKeyDown({ key: k, stopPropagation: () => (stopped = true) });
  return stopped;
}

describe('A4: the age field no longer swallows Escape (AgeGate.tsx)', () => {
  it('Escape and Tab reach the Modal (close / focus trap); typing keys stay in the field', () => {
    expect(key('Escape')).toBe(false);
    expect(key('Tab')).toBe(false);
    for (const k of ['1', '9', 'Backspace', 'ArrowLeft', 'Enter', ' ', 'b', 'F5', 'Delete']) expect(key(k), k).toBe(true);
  });
  it('the field uses that handler instead of an unconditional stopPropagation', () => {
    const s = src('store/AgeGate.tsx');
    expect(s).toContain('onKeyDown={ageFieldKeyDown}');
    expect(s).not.toMatch(/onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
  it('no other UI text field swallows every key (the sweep Sol ran)', () => {
    // the only remaining blanket stopPropagation is the Buy search box, which handles Escape itself first
    for (const f of ['store/StoreDialog.tsx', 'shell/screens/CreateZombieScreen.tsx', 'shell/dialogs/SaveLoadDialog.tsx']) {
      expect(src(f), f).not.toMatch(/onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/);
    }
  });
});

describe('A3: Store stays readable and contained in a narrow window (store.css, overlays.css)', () => {
  const css = src('store/store.css');
  const overlays = src('theme/overlays.css');
  it('dialog text uses the floored type tokens, not raw rem sizes that collapse to ~4 px', () => {
    const dialogRules = css.split('\n').filter((l) => /^\.st-(card|age|bundle|note|status|parents|price|banner|grid|balance)/.test(l));
    expect(dialogRules.length).toBeGreaterThan(10);
    for (const l of dialogRules) expect(l, l).not.toMatch(/font-size:\s*[\d.]+rem/);
  });
  it('the card grid drops to one column instead of shrinking cards below a readable width', () => {
    expect(css).toMatch(/\.st-grid \{[^}]*minmax\(min\(100%, max\(15\.5rem, 220px\)\), 1fr\)/);
  });
  it('the Store body scrolls inside the panel and the tab bar scrolls sideways', () => {
    expect(css).toMatch(/\.st-dialog \.ui-modal__body \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.st-dialog \.ui-modal__tabs \{[^}]*overflow-x: auto/);
  });
  it('dialogs floor their type tokens and control heights (≥ 24 px targets, WCAG 2.5.8)', () => {
    const block = overlays.slice(overlays.indexOf('.ui-modal {\n  --fs-2xs'));
    for (const [tok, min] of [['--fs-2xs', 9.5], ['--fs-xs', 10.2], ['--fs-sm', 11], ['--fs-md', 12.75], ['--fs-lg', 14]] as const) {
      const m = new RegExp(`${tok}: max\\([\\d.]+rem, ([\\d.]+)px\\)`).exec(block);
      expect(m, tok).not.toBeNull();
      expect(Number(m![1]), tok).toBeGreaterThanOrEqual(min);
    }
    for (const tok of ['--ctl-h-sm', '--ctl-h-md', '--ctl-h-lg']) {
      const m = new RegExp(`${tok}: max\\([\\d.]+rem, ([\\d.]+)px\\)`).exec(block);
      expect(m, tok).not.toBeNull();
      expect(Number(m![1]), tok).toBeGreaterThanOrEqual(24);
    }
    expect(block).toMatch(/\.ui-modal \.ui-iconbtn--xs \{\s*--ib-size: max\(1\.5rem, 24px\)/);
  });
});
