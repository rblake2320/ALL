/**
 * Previewing a locked premium zombie on the Create-a-Zombie turntable (cazLogic.stageAppearance / keptTryOn).
 * The preview is a picture only: these tests pin that it never changes the member, that it ends when the player
 * moves on, and that the ownership rule still refuses the body if a preview were ever put into a household.
 */
import { describe, expect, it } from 'vitest';
import { defaultAppearance } from '../../../src/shared/appearance';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import { PREMIUM_BODY_IDS } from '../../../src/shared/premiumBodies';
import { keptTryOn, stageAppearance } from '../../../src/ui/shell/cazLogic';
import { canUseBody, unownedPremiumBody } from '../../../src/game/premiumAccess';
import { en } from '../../../src/i18n/en';

const HOSTILE: unknown[] = [undefined, null, '', 'classic', 'dragon', 'SEXTON', 'sexton ', ' sexton', 'sexton\u0000', '__proto__', 'constructor', 0, 1, NaN, true, {}, [], ['sexton'], { body: 'sexton' }, () => 'sexton'];

describe('stageAppearance', () => {
  it('shows every premium body without touching the member', () => {
    for (const id of PREMIUM_BODY_IDS) {
      const mine = Object.freeze({ ...defaultAppearance(), body: 'bride' });
      const before = JSON.stringify(mine);
      const shown = stageAppearance(mine as never, id);
      expect((shown as { body?: unknown }).body).toBe(id);
      expect(shown).not.toBe(mine);
      expect(JSON.stringify(mine)).toBe(before); // frozen: a write would also have thrown
      // everything but the body is the member's own look
      expect({ ...shown, body: 'bride' }).toEqual(mine);
    }
  });
  it('gives the member\'s own look back, the same object, for anything that is not a premium body', () => {
    const mine = Object.freeze(defaultAppearance());
    for (const v of [...HOSTILE, ...CAST_BODY_IDS]) expect(stageAppearance(mine, v)).toBe(mine);
  });
  it('a classic member previewing a premium body keeps no body of their own', () => {
    const mine = defaultAppearance();
    expect('body' in mine).toBe(false);
    stageAppearance(mine, 'sexton');
    expect('body' in mine).toBe(false);
  });
});

describe('keptTryOn', () => {
  it('keeps a preview only on the Body tab of the member it was started on', () => {
    for (const id of PREMIUM_BODY_IDS) {
      expect(keptTryOn(id, 'body', 0, 0)).toBe(id);
      expect(keptTryOn(id, 'body', 3, 3)).toBe(id);
      for (const tab of ['identity', 'hair', 'outfit', 'personality', 'voice', '', 'BODY', 'body ']) expect(keptTryOn(id, tab, 0, 0)).toBeNull();
      expect(keptTryOn(id, 'body', 1, 0)).toBeNull(); // switched to another zombie
      expect(keptTryOn(id, 'body', 0, -1)).toBeNull();
    }
  });
  it('never keeps a value that is not a premium body', () => {
    for (const v of [...HOSTILE, ...CAST_BODY_IDS]) expect(keptTryOn(v, 'body', 0, 0)).toBeNull();
  });
});

describe('a preview is not ownership', () => {
  const noProfile = [null, undefined, { ready: false, wallet: { entitlements: new Set(['body:sexton']) } }, { ready: true, wallet: { entitlements: new Set<string>() } }];
  it('the previewed look is refused by the ownership rule if it were ever put into a household', () => {
    for (const id of PREMIUM_BODY_IDS) {
      const shown = stageAppearance(defaultAppearance(), id);
      for (const economy of noProfile) {
        expect(canUseBody((shown as { body?: unknown }).body, economy as never)).toBe(false);
        expect(unownedPremiumBody({ agents: { a: { appearance: shown as never } } }, economy as never)).toBe(id);
      }
    }
  });
  it('control: a profile that owns the body may use it, so the rule above is not refusing everything', () => {
    const owner = { ready: true, wallet: { entitlements: new Set(['body:sexton']) } };
    expect(canUseBody('sexton', owner as never)).toBe(true);
    expect(unownedPremiumBody({ agents: { a: { appearance: { body: 'sexton' } } } }, owner as never)).toBeNull();
    expect(canUseBody('lowside', owner as never)).toBe(false);
  });
});

describe('text', () => {
  it('has every string the preview and the zombie card use', () => {
    const dict = en as Record<string, string>;
    for (const k of ['caz.premiumPreview', 'caz.premiumPreviewing', 'caz.premiumPreviewSr', 'caz.premiumPreviewingSr', 'caz.tryOnNotice', 'caz.tryOnStop', 'caz.tryOnStage', 'caz.tryOnStageSub', 'caz.zombieCard', 'caz.zombieCardHint', 'caz.zombieCardBrowse']) {
      expect(typeof dict[k], k).toBe('string');
      expect(dict[k].trim().length, k).toBeGreaterThan(0);
    }
    expect(dict['caz.tryOnNotice']).toContain('{name}');
    expect(dict['caz.tryOnStage']).toContain('{name}');
    // the preview must not read as a purchase or as owning the body
    for (const k of ['caz.premiumPreview', 'caz.tryOnNotice', 'caz.tryOnStage', 'caz.tryOnStageSub']) expect(dict[k].toLowerCase()).not.toMatch(/\b(buy|bought|unlocked|owned|yours)\b/);
  });
});
