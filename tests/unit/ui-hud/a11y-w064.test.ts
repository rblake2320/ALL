/**
 * W-064 HUD accessibility fixes from Sol's W-023 audit (docs/desktop-reports/a11y-l10n.md, branch desktop/sol-a11y):
 * A1 keyboard placement UI glue, A5 action-queue list semantics, A6 Notices badge contrast, and the
 * label-content-name-mismatch candidates (Notices count, catalog metadata).
 * Game-side placement behaviour: tests/unit/game/keyboardPlacement.test.ts. Browser evidence: tests/e2e/a11y.mjs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../../src/ui/common/color';
import { catalogCardText, isKeyboardClick } from '../../../src/ui/hud/buy/BuyCatalog';
import { liveText } from '../../../src/ui/hud/overlay/PlacementAnnouncer';
import { noticesLabel } from '../../../src/ui/hud/topbar/TopBar';

const src = (p: string) => readFileSync(new URL(`../../../src/ui/${p}`, import.meta.url), 'utf8');

describe('A5: the action queue keeps native list semantics', () => {
  it('no aria-orientation on the <ol> (not allowed on role=list; layout is CSS)', () => {
    const s = src('hud/queue/ActionQueue.tsx');
    const ol = /<ol[^>]*>/.exec(s)?.[0] ?? '';
    expect(ol).toContain('hud-queue__list');
    expect(ol).not.toContain('aria-orientation');
  });
});

describe('A6: Notices badge contrast', () => {
  it('the solid danger badge pair clears 4.5:1 for 11 px bold text (was 4.34:1)', () => {
    const comp = src('theme/components.css');
    const rule = /\.ui-badge--solid\.ui-badge--danger \{[^}]*color: (#[0-9a-f]{6});[^}]*background: (#[0-9a-f]{6});/i.exec(comp);
    expect(rule).not.toBeNull();
    expect(contrastRatio(rule![1], rule![2])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#fff3ef', '#c8455a')).toBeLessThan(4.5); // the old pair, for the record
  });
  it('the bills counter uses the same corrected pair', () => {
    const tb = src('hud/topbar/topbar.css');
    const rule = /\.hud-bills\.is-danger \.hud-bills__count \{[^}]*color: (#[0-9a-f]{6});[^}]*background: (#[0-9a-f]{6});/i.exec(tb);
    expect(rule).not.toBeNull();
    expect(contrastRatio(rule![1], rule![2])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('visible label ⊂ accessible name (WCAG 2.5.3 candidates from the audit)', () => {
  it('Notices: the unread count is in the button name; the red badge is hidden from AT', () => {
    expect(noticesLabel(0)).toBe('Notices');
    expect(noticesLabel(1)).toBe('Notices, 1 unread');
    expect(noticesLabel(140)).toBe('Notices, 140 unread');
    expect(noticesLabel(Number.NaN)).toBe('Notices');
    expect(src('hud/parts/controls.tsx')).toMatch(/<span class="ui-iconbtn__badge" aria-hidden="true">/);
    expect(src('hud/topbar/TopBar.tsx')).toContain('label={noticesLabel(unread)}');
  });
  it('catalog cards: name = visible name + price (from the content, W-118); env / power / Bones lock move to the description', () => {
    const it0 = { name: 'Dead Fern', price: 45, env: 2, needsPower: false };
    const a = catalogCardText(it0, true, null);
    expect(a.name).toBe('Dead Fern $45');
    expect(a.description).toBe('Environment +2');
    const b = catalogCardText({ ...it0, env: 0, needsPower: true }, false, 'Unlock in the store for 30 Bones');
    expect(b.name).toBe('Dead Fern $45, Can’t afford');
    expect(b.description).toBe('Needs power. Unlock in the store for 30 Bones');
    expect(catalogCardText({ ...it0, env: 0 }, true, null).description).toBe('');
    const card = src('hud/buy/BuyCatalog.tsx');
    expect(card).toMatch(/class=\{`hud-item__env u-num[^`]*`\} aria-hidden="true"/);
    expect(card).toContain('<BonesLock game={game} defId={it.defId} describedElsewhere />');
  });
});

describe('A1: keyboard placement UI glue', () => {
  it('keyboard-activated catalog clicks are recognised (Enter / Space give detail 0)', () => {
    expect(isKeyboardClick({ detail: 0 })).toBe(true);
    expect(isKeyboardClick({ detail: 1 })).toBe(false);
    expect(isKeyboardClick(null)).toBe(false);
    expect(isKeyboardClick({})).toBe(false);
  });
  it('the live region repeats an identical message by alternating an invisible suffix', () => {
    expect(liveText(null)).toBe('');
    expect(liveText({ seq: 2, text: "Can't place here: Blocks a doorway." })).toBe("Can't place here: Blocks a doorway.");
    expect(liveText({ seq: 3, text: "Can't place here: Blocks a doorway." })).toBe("Can't place here: Blocks a doorway.​");
    expect(liveText({ seq: 4, text: '   ' })).toBe('');
  });
  it('the HUD always mounts the placement live region (it must exist before its first message)', () => {
    const hud = src('hud/Hud.tsx');
    expect(hud).toMatch(/<Guard name="placement-live">\s*<PlacementAnnouncer \/>/);
    expect(src('hud/overlay/PlacementAnnouncer.tsx')).toMatch(/role="status" aria-live="polite" aria-atomic="true"/);
  });
  it('the catalog footer documents the keyboard placement keys', () => {
    const hints = src('hud/strings.ts');
    expect(hints).toContain("'buy.hint.arrows': 'Arrows'");
    expect(hints).toContain("'buy.hint.place': 'Place'");
  });
});
