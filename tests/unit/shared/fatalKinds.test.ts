/**
 * W-149 (docs/DESIGN_OPEN_WORLD.md §5.1, OW-20): a missing WebGL context is told to the player in its own words.
 */
import { describe, expect, it } from 'vitest';
import { NO_3D_FATAL, fatalKind } from '../../../src/shared/fatalKinds';
import { en } from '../../../src/i18n/en';
import { createHarness } from '../game/controllerHarness';

describe('fatal kinds (W-149)', () => {
  it('only the exact no-3D message is no3d; everything else, garbage included, is generic', () => {
    expect(fatalKind(NO_3D_FATAL)).toBe('no3d');
    for (const m of [null, undefined, '', 0, {}, [], NO_3D_FATAL + ' ', NO_3D_FATAL.toLowerCase(), 'WebGL', 'The renderer stopped working (the graphics driver may have reset). Your game was saved — reload to continue.']) {
      expect(fatalKind(m)).toBe('generic');
    }
  });

  it('a renderer that cannot start raises exactly that message (so the screen is the no-3D one)', async () => {
    const h = await createHarness({ setup: ({ renderer }) => (renderer.failInit = true) });
    await h.until(() => h.game.fatalError !== null);
    expect(h.game.fatalError).toBe(NO_3D_FATAL);
    expect(fatalKind(h.game.fatalError)).toBe('no3d');
  });

  it('the no-3D screen has every string it shows, and the words name the cause and the remedies', () => {
    const keys = ['eyebrow', 'title', 'text', 'tryTitle', 'try1', 'try2', 'try3', 'retry', 'hint'].map((k) => `fatal.no3d.${k}`);
    const dict = en as Record<string, string>;
    for (const k of keys) expect(typeof dict[k] === 'string' && dict[k].trim().length > 0, k).toBe(true);
    expect(dict['fatal.no3d.text']).toMatch(/WebGL/);
    expect(dict['fatal.no3d.text']).toMatch(/saves are safe/);
    expect(dict['fatal.no3d.try1']).toMatch(/acceleration/);
    expect(dict['fatal.no3d.title']).not.toMatch(/error|crash/i);
  });
});
