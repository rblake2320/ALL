/**
 * W-039 / D-025 game wiring: 'auto' default + settings migration, renderer init / setQuality / setPixelRatio
 * arguments, write-back of the level Auto settled on, re-probe on Reset, sampling off behind loading screens.
 */
import { describe, expect, it } from 'vitest';
import type { AutoQualityStatus, GraphicsInfo, QualitySetting } from '../../../src/render/contracts';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { SETTINGS_SCHEMA, sanitizeSettings } from '../../../src/game/settings';
import { AUTO_LEVELS } from '../../../src/render/core/autoQuality';
import { createHarness } from './controllerHarness';
import type { FakeRenderer } from './fakes';
import { flush } from './fakes';

describe('settings: auto default + migration', () => {
  it('a new profile defaults to auto with no stored Auto result', () => {
    expect(DEFAULT_SETTINGS.quality).toBe('auto');
    expect(DEFAULT_SETTINGS.autoQuality).toBe('unset');
    expect(sanitizeSettings(null)).toMatchObject({ quality: 'auto', autoQuality: 'unset' });
  });

  it("a stored profile keeps the player's explicit level (every level), only missing / invalid values read as auto", () => {
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) {
      // a pre-W-039 profile: no autoQuality key at all
      expect(sanitizeSettings({ quality: q, pixelRatio: 0, showFps: true })).toMatchObject({ quality: q, autoQuality: 'unset', showFps: true });
    }
    for (const junk of [undefined, null, 'potato', 'AUTO', 3, {}, ['low']]) {
      expect(sanitizeSettings({ quality: junk }).quality).toBe('auto');
    }
    expect(sanitizeSettings({ quality: 'auto', autoQuality: 'low' })).toMatchObject({ quality: 'auto', autoQuality: 'low' });
    for (const junk of ['ultra', 'auto', '', null, 2]) expect(sanitizeSettings({ autoQuality: junk }).autoQuality).toBe('unset');
  });

  it('W-107 extension point: the stored Auto result accepts exactly the governor level list (one list to extend)', () => {
    const spec = SETTINGS_SCHEMA.autoQuality;
    expect(spec.t).toBe('enum');
    expect(spec.t === 'enum' ? [...spec.values] : null).toEqual(['unset', ...AUTO_LEVELS]);
    for (const l of AUTO_LEVELS) expect(sanitizeSettings({ quality: 'auto', autoQuality: l }).autoQuality).toBe(l);
    // Auto never resumes at Ultra today: a hand-edited profile cannot smuggle it in
    expect(sanitizeSettings({ quality: 'auto', autoQuality: 'ultra' }).autoQuality).toBe('unset');
  });
});

/** Fake renderer extended with the optional W-039 surface; records the 2-argument forms. */
function autoRenderer(r: FakeRenderer, state: { auto: AutoQualityStatus | null; level?: GraphicsInfo['level'] }): void {
  const fr = r as unknown as {
    calls: { name: string; args: unknown[] }[];
    setQuality: (q: QualitySetting, a?: unknown) => void;
    setPixelRatio: (p: number, e?: boolean) => void;
    graphicsInfo: () => GraphicsInfo;
    setAutoQualitySampling: (on: boolean) => void;
  };
  fr.setQuality = (q, a) => fr.calls.push({ name: 'setQuality', args: [q, a] });
  fr.setPixelRatio = (p, e) => fr.calls.push({ name: 'setPixelRatio', args: [p, e] });
  fr.setAutoQualitySampling = (on) => fr.calls.push({ name: 'sampling', args: [on] });
  fr.graphicsInfo = () => ({
    level: state.level ?? state.auto?.level ?? 'high',
    auto: state.auto,
    pixelRatio: 1,
    bufferWidth: 1280,
    bufferHeight: 720,
    supersampled: false,
    pixelRatioExplicit: false,
  });
}

const status = (o: Partial<AutoQualityStatus>): AutoQualityStatus => ({
  level: 'high', phase: 'probe', ceiling: 'high', gpuKind: 'discrete', gpu: 'test', lastP95: NaN, downgrades: 0, ...o,
});

describe('controller wiring', () => {
  it('init: an explicit stored level and explicit Pixel Ratio are passed as such (D-025)', async () => {
    const h = await createHarness({ settings: { quality: 'ultra', pixelRatio: 1 } });
    expect(h.renderer.last('init')!.args[1]).toEqual({ quality: 'ultra', pixelRatio: 1, pixelRatioExplicit: true, autoLevel: null });
  });

  it('init: a stored Auto result resumes without probing', async () => {
    const h = await createHarness({ settings: { quality: 'auto', autoQuality: 'low' } });
    expect(h.renderer.last('init')!.args[1]).toMatchObject({ quality: 'auto', autoLevel: 'low', pixelRatioExplicit: false });
  });

  it('pixel ratio changes carry the explicit flag (0 = auto -> false, any value -> true)', async () => {
    const h = await createHarness({ setup: ({ renderer }) => autoRenderer(renderer, { auto: null }) });
    h.game.updateSettings({ pixelRatio: 1 });
    expect(h.renderer.last('setPixelRatio')!.args).toEqual([1, true]);
    h.game.updateSettings({ pixelRatio: 0 });
    expect(h.renderer.last('setPixelRatio')!.args).toEqual([1.5, false]); // fake devicePixelRatio 1.5
  });

  it('persists the level Auto settled on once (probe still running -> nothing), without restarting Auto', async () => {
    const state = { auto: status({ phase: 'probe', level: 'high' }) as AutoQualityStatus | null };
    const h = await createHarness({ setup: ({ renderer }) => autoRenderer(renderer, state) });
    await h.frames(40, 16); // > 500 ms of slow ticks
    expect(h.game.settings.autoQuality).toBe('unset');
    const qualityCalls = h.renderer.count('setQuality');
    state.auto = status({ phase: 'watch', level: 'low', lastP95: 72.8 });
    await h.frames(40, 16);
    expect(h.game.settings).toMatchObject({ quality: 'auto', autoQuality: 'low' });
    await flush();
    expect(h.profile.data.get('settings')).toMatchObject({ quality: 'auto', autoQuality: 'low' });
    expect(h.renderer.count('setQuality')).toBe(qualityCalls); // the write-back never re-probes
    // a runtime downgrade later is persisted too
    state.auto = status({ phase: 'watch', level: 'low', downgrades: 1 });
    await h.frames(40, 16);
    expect(h.game.settings.autoQuality).toBe('low');
    expect(h.game.graphics?.auto?.level).toBe('low');
  });

  it('an explicit level is never overwritten by Auto, and choosing Auto again resumes from the stored result', async () => {
    const state = { auto: null as AutoQualityStatus | null, level: 'medium' as const };
    const h = await createHarness({ settings: { quality: 'medium', autoQuality: 'low' }, setup: ({ renderer }) => autoRenderer(renderer, state) });
    await h.frames(40, 16);
    expect(h.game.settings).toMatchObject({ quality: 'medium', autoQuality: 'low' });
    h.game.updateSettings({ quality: 'auto' });
    expect(h.renderer.last('setQuality')!.args).toEqual(['auto', 'low']);
    h.game.updateSettings({ quality: 'high' });
    expect(h.renderer.last('setQuality')!.args[0]).toBe('high');
  });

  it('Reset Settings clears the stored result and re-probes', async () => {
    const state = { auto: status({ phase: 'watch', level: 'medium' }) as AutoQualityStatus | null };
    const h = await createHarness({ settings: { quality: 'auto', autoQuality: 'medium' }, setup: ({ renderer }) => autoRenderer(renderer, state) });
    h.game.resetSettings();
    expect(h.game.settings.autoQuality).toBe('unset');
    expect(h.renderer.last('setQuality')!.args).toEqual(['auto', null]);
  });

  it('frame sampling is off behind the loading screen and on in the menu', async () => {
    const h = await createHarness({ setup: ({ renderer }) => autoRenderer(renderer, { auto: status({}) }) });
    const samples = h.renderer.calls.filter((c) => c.name === 'sampling').map((c) => c.args[0]);
    expect(samples).toContain(false); // loading frames (boot -> menu)
    await h.frames(3, 16);
    expect(h.renderer.last('sampling')!.args[0]).toBe(true);
  });
});
