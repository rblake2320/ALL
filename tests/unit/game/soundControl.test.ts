/**
 * Sound control: one-key mute (M) and an always-reachable master volume, remembered per profile. Mute silences the
 * whole engine (music, effects, ambience, UI sounds and the zombie voice share it) without touching the sliders; the
 * master volume is clamped to 0..1; both are stored with the profile settings and survive a reload.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, KEYMAP } from '../../../src/game/contracts';
import { sanitizeSettings } from '../../../src/game/settings';
import { createHarness, startedHarness } from './controllerHarness';
import { flush } from './fakes';

const lastMuted = (h: Awaited<ReturnType<typeof startedHarness>>) => h.audio.named('setMuted').at(-1)?.args[0];

describe('mute', () => {
  it('M is the mute key, and is off by default', () => {
    expect(KEYMAP.mute).toEqual(['KeyM']);
    expect(DEFAULT_SETTINGS.muted).toBe(false);
  });

  it('the M key mutes the whole engine and unmutes it again, and says so', async () => {
    const h = await startedHarness();
    expect(h.game.settings.muted).toBe(false);
    h.key('keydown', 'KeyM');
    h.key('keyup', 'KeyM');
    expect(h.game.settings.muted).toBe(true);
    expect(lastMuted(h)).toBe(true);
    expect(h.game.toasts.map((t) => t.title)).toContain('Sound off');
    h.key('keydown', 'KeyM');
    h.key('keyup', 'KeyM');
    expect(h.game.settings.muted).toBe(false);
    expect(lastMuted(h)).toBe(false);
    expect(h.game.toasts.map((t) => t.title)).toContain('Sound on');
  });

  it('muting does not touch any volume slider, and unmuting restores the same sound', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ volumes: { ...DEFAULT_SETTINGS.volumes, master: 0.35, voice: 0.6 }, musicEnabled: true });
    const volumes = JSON.stringify(h.game.settings.volumes);
    h.game.updateSettings({ muted: true });
    expect(JSON.stringify(h.game.settings.volumes)).toBe(volumes);
    expect(h.audio.named('setVolumes').at(-1)!.args[0]).toMatchObject({ master: 0.35, voice: 0.6 });
    h.game.updateSettings({ muted: false });
    expect(JSON.stringify(h.game.settings.volumes)).toBe(volumes);
  });

  it('works together with the window-focus mute: unfocusing and refocusing never unmutes a muted game, and unmuting while unfocused stays muted', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ muted: true });
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(lastMuted(h)).toBe(true); // refocus does not undo the player's mute
    h.game.updateSettings({ muted: false });
    expect(lastMuted(h)).toBe(false);
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    h.game.updateSettings({ muted: false });
    expect(lastMuted(h)).toBe(true); // unfocused: still silent for that reason
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(lastMuted(h)).toBe(false);
  });

  it('only a boolean can set it: junk in a stored profile is ignored', () => {
    for (const bad of ['true', 1, 'yes', null, {}, []]) expect(sanitizeSettings({ muted: bad }).muted, String(bad)).toBe(false);
    expect(sanitizeSettings({ muted: true }).muted).toBe(true);
  });
});

describe('master volume', () => {
  it('is clamped to 0..1 and ignores junk (NaN, Infinity, text, negative)', async () => {
    const h = await startedHarness();
    const set = (v: unknown) => h.game.updateSettings({ volumes: { ...h.game.settings.volumes, master: v as number } });
    set(0.5);
    expect(h.game.settings.volumes.master).toBe(0.5);
    set(7);
    expect(h.game.settings.volumes.master).toBe(1);
    set(-3);
    expect(h.game.settings.volumes.master).toBe(0);
    set(0.4);
    for (const junk of [NaN, Infinity, '0.9', null, undefined]) {
      set(junk);
      expect(h.game.settings.volumes.master, String(junk)).toBeGreaterThanOrEqual(0);
      expect(h.game.settings.volumes.master, String(junk)).toBeLessThanOrEqual(1);
    }
    expect(sanitizeSettings({ volumes: { master: 12 } }).volumes.master).toBe(1);
    expect(sanitizeSettings({ volumes: { master: -1 } }).volumes.master).toBe(0);
    expect(sanitizeSettings({ volumes: { master: NaN } }).volumes.master).toBe(DEFAULT_SETTINGS.volumes.master);
  });

  it('reaches the audio engine at once', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ volumes: { ...h.game.settings.volumes, master: 0.2 } });
    expect(h.audio.named('setVolumes').at(-1)!.args[0]).toMatchObject({ master: 0.2 });
  });
});

describe('persistence per profile', () => {
  it('mute and master volume are saved with the profile settings', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ muted: true, volumes: { ...h.game.settings.volumes, master: 0.3 } });
    await flush();
    expect(h.profile.data.get('settings')).toMatchObject({ muted: true, volumes: { master: 0.3 } });
  });

  it('a muted game stays muted after a reload, with the same master volume, and the engine is told before anything plays', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ muted: true, volumes: { ...h.game.settings.volumes, master: 0.3 } });
    await flush();
    const stored = h.profile.data.get('settings');
    const reloaded = await createHarness({ settings: stored });
    expect(reloaded.game.settings.muted).toBe(true);
    expect(reloaded.game.settings.volumes.master).toBe(0.3);
    expect(reloaded.audio.named('setMuted').some((c) => c.args[0] === true)).toBe(true);
    expect(reloaded.audio.named('setMuted').at(-1)!.args[0]).toBe(true);
  });

  it('an unmuted profile reloads unmuted, and a profile saved before this setting existed loads unmuted', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ muted: true });
    h.game.updateSettings({ muted: false });
    await flush();
    const reloaded = await createHarness({ settings: h.profile.data.get('settings') });
    expect(reloaded.game.settings.muted).toBe(false);
    const { muted: _gone, ...old } = DEFAULT_SETTINGS;
    const legacy = await createHarness({ settings: old });
    expect(legacy.game.settings.muted).toBe(false);
  });

  it('Reset Settings clears mute with the rest', async () => {
    const h = await startedHarness();
    h.game.updateSettings({ muted: true });
    h.game.resetSettings();
    expect(h.game.settings.muted).toBe(false);
    expect(lastMuted(h)).toBe(false);
  });
});
