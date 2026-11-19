/**
 * W-113 New Game ("CAZ plot step"): the derelict claim is listed first and preselected, every lot has its copy, and
 * the card CSS keeps the tag and the name inside the card at phone widths (the bug: "FURNISHED COT…" spilling out and
 * plot names wrapping one word per line). The real-layout proof at 390×844 / 844×390 is tests/e2e/storyStart.mjs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_GAME_LOTS } from '../../../src/ui/shell/screens/NewGameScreen';
import { lotInfo, LOT_FUNDS, startingFunds } from '../../../src/ui/shell/data';
import { en } from '../../../src/i18n/en';
import { LOT_TEMPLATE_INFO } from '../../../src/sim/spatial';

const css = readFileSync(new URL('../../../src/ui/shell/shell.css', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../../../src/ui/shell/screens/NewGameScreen.tsx', import.meta.url), 'utf8');
const rule = (sel: string): string => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`no rule ${sel}`);
  return css.slice(i, css.indexOf('}', i));
};

describe('New Game lots', () => {
  it('derelict first, then starter (sandbox), then empty; derelict is the fallback selection', () => {
    expect(NEW_GAME_LOTS).toEqual(['derelict', 'starter', 'empty']);
    expect(screen).toContain("game.caz?.lotTemplate ?? 'derelict'");
    expect(screen).toContain('dataset={{ lot: id }}');
  });

  it('every lot has its copy; derelict is labelled as the story start, starter as move-in ready (sandbox)', () => {
    const s = en as Record<string, string>;
    for (const lot of NEW_GAME_LOTS) for (const k of ['name', 'tag', 'desc', 'f1', 'f2', 'f3']) expect(s[`newGame.lot.${lot}.${k}`], `${lot}.${k}`).toBeTruthy();
    expect(s['newGame.lot.derelict.tag']).toBe('Story start');
    expect(s['newGame.lot.starter.tag']).toBe('Move-in ready (sandbox)');
  });

  it('funds shown on the cards match the sim templates (+$500 per extra member)', () => {
    for (const t of LOT_TEMPLATE_INFO) {
      expect(LOT_FUNDS[t.id]).toBe(t.startingFunds);
      expect(lotInfo(t.id, LOT_TEMPLATE_INFO).startingFunds).toBe(t.startingFunds);
    }
    expect(startingFunds('derelict', 3, 2500)).toBe(3500);
    expect(lotInfo('derelict', LOT_TEMPLATE_INFO).name).toBe('The Condemned Shack on Mildew Lane');
    // garbage controller data falls back to the built-in numbers, never NaN
    expect(lotInfo('derelict', [{ id: 'derelict', startingFunds: Number.NaN }]).startingFunds).toBe(2500);
  });
});

describe('New Game card layout at phone widths (CSS contract)', () => {
  it('the lot grid collapses to one column instead of squeezing three cards side by side', () => {
    const r = rule('.sh-lots');
    expect(r).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*15rem\),\s*1fr\)\)/);
    expect(r).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(css).toMatch(/@media \(max-width: 640px\), \(max-aspect-ratio: 3\/4\) \{\s*\.sh-lots \{\s*grid-template-columns: 1fr;/);
  });

  it('the title row wraps; the tag shrinks and ellipsises inside the card; the name may shrink and never overflows', () => {
    expect(rule('.sh-lot__titlerow')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.sh-lot__titlerow')).toMatch(/min-width:\s*0/);
    const tag = rule('.sh-lot__tag.ui-badge');
    for (const p of [/max-width:\s*100%/, /min-width:\s*0/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/]) expect(tag).toMatch(p);
    const name = rule('.sh-lot__name');
    expect(name).toMatch(/min-width:\s*0/);
    expect(name).toMatch(/overflow-wrap:\s*break-word/);
    expect(name).toMatch(/flex:\s*1 1 9rem/);
    expect(screen).toContain('class="sh-lot__tag"');
  });
});
