import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/game/contracts';
import {
  SETTINGS_SCHEMA,
  applySettingsPatch,
  changedSettings,
  cloneSettings,
  effectivePixelRatio,
  effectiveVolumes,
  readOwnData,
  sanitizeSettings,
  settingsEqual,
} from '../../../src/game/settings';
import { ProfileWriter, safeProfileLoad } from '../../../src/game/profile';
import { FakeProfile, flush } from './fakes';

const DEFAULTS_SNAPSHOT = JSON.stringify(DEFAULT_SETTINGS);

describe('sanitizeSettings — adversarial profile data', () => {
  it('returns defaults for non-objects', () => {
    for (const raw of [null, undefined, 42, 'settings', true, [], [1, 2], () => 1, Symbol('x')]) {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid values', () => {
    const s = sanitizeSettings({ quality: 'low', autonomy: 'off', invertZoom: true, autosaveMinutes: 10, uiScale: 1.2, volumes: { music: 0.1 } });
    expect(s.quality).toBe('low');
    expect(s.autonomy).toBe('off');
    expect(s.invertZoom).toBe(true);
    expect(s.autosaveMinutes).toBe(10);
    expect(s.uiScale).toBe(1.2);
    expect(s.volumes.music).toBe(0.1);
    expect(s.volumes.master).toBe(DEFAULT_SETTINGS.volumes.master);
  });

  it('drops wrong types (strings for numbers/booleans, numbers for enums)', () => {
    const s = sanitizeSettings({ quality: 3, pixelRatio: '2', invertZoom: 'true', edgeScroll: 1, autonomy: true, language: 'fr', volumes: { music: '0.5', sfx: null } });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('drops NaN / ±Infinity, clamps finite out-of-range numbers', () => {
    const s = sanitizeSettings({ uiScale: NaN, cameraSpeed: Infinity, autosaveMinutes: -Infinity, volumes: { master: NaN, music: 7, sfx: -2 } });
    expect(s.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(s.cameraSpeed).toBe(DEFAULT_SETTINGS.cameraSpeed);
    expect(s.autosaveMinutes).toBe(DEFAULT_SETTINGS.autosaveMinutes);
    expect(s.volumes.master).toBe(DEFAULT_SETTINGS.volumes.master);
    expect(s.volumes.music).toBe(1);
    expect(s.volumes.sfx).toBe(0);
    const t = sanitizeSettings({ uiScale: 99, cameraSpeed: 0.01, autosaveMinutes: 9999.4 });
    expect(t.uiScale).toBe(1.4);
    expect(t.cameraSpeed).toBe(0.5);
    expect(t.autosaveMinutes).toBe(60);
  });

  it('autosaveMinutes is an integer; 0 (off) survives', () => {
    expect(sanitizeSettings({ autosaveMinutes: 2.6 }).autosaveMinutes).toBe(3);
    expect(sanitizeSettings({ autosaveMinutes: 0 }).autosaveMinutes).toBe(0);
  });

  it('pixelRatio: 0 = auto is kept, negatives dropped, tiny values clamped to 0.5', () => {
    expect(sanitizeSettings({ pixelRatio: 0 }).pixelRatio).toBe(0);
    expect(sanitizeSettings({ pixelRatio: -1 }).pixelRatio).toBe(DEFAULT_SETTINGS.pixelRatio);
    expect(sanitizeSettings({ pixelRatio: 0.1 }).pixelRatio).toBe(0.5);
    expect(sanitizeSettings({ pixelRatio: 8 }).pixelRatio).toBe(3);
  });

  it('ignores unknown keys entirely (no extra properties in the result)', () => {
    const s = sanitizeSettings({ cheats: true, quality: 'medium', nested: { deep: 1 } }) as Settings & Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(Object.keys(SETTINGS_SCHEMA).sort());
    expect(s.cheats).toBeUndefined();
    expect(s.quality).toBe('medium');
  });

  it('is immune to prototype pollution keys from JSON', () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true, "quality": "low"}, "constructor": {"prototype": {"polluted2": true}}, "prototype": 1, "showFps": true}');
    const s = sanitizeSettings(raw) as Settings & Record<string, unknown>;
    expect(s.showFps).toBe(true);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    const v = sanitizeSettings({ volumes: JSON.parse('{"__proto__": {"music": 0}}') });
    expect(v.volumes.music).toBe(DEFAULT_SETTINGS.volumes.music);
  });

  it('never runs getters or trips over throwing Proxies', () => {
    let touched = false;
    const evil = {
      get quality() {
        touched = true;
        return 'low';
      },
    };
    expect(sanitizeSettings(evil).quality).toBe(DEFAULT_SETTINGS.quality);
    expect(touched).toBe(false);
    const proxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('trap');
        },
        get() {
          throw new Error('trap');
        },
      },
    );
    expect(sanitizeSettings(proxy)).toEqual(DEFAULT_SETTINGS);
    expect(readOwnData(proxy, 'quality')).toEqual({ ok: false });
  });

  it('inherited properties are not read', () => {
    const proto = { quality: 'low' };
    const child = Object.create(proto) as Record<string, unknown>;
    expect(sanitizeSettings(child).quality).toBe(DEFAULT_SETTINGS.quality);
  });

  it('never aliases or mutates DEFAULT_SETTINGS', () => {
    const s = sanitizeSettings({});
    expect(s).not.toBe(DEFAULT_SETTINGS);
    expect(s.volumes).not.toBe(DEFAULT_SETTINGS.volumes);
    s.volumes.master = 0;
    s.quality = 'low';
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(DEFAULTS_SNAPSHOT);
  });

  it('is idempotent and stable under round-trips through JSON', () => {
    const once = sanitizeSettings({ quality: 'ultra', volumes: { voice: 0.33 }, uiScale: 0.9 });
    expect(sanitizeSettings(once)).toEqual(once);
    expect(sanitizeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('fuzz: random garbage always yields a schema-valid object', () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const pool: unknown[] = [null, undefined, NaN, Infinity, -1, 0, 0.5, 1, 2, 99, '', 'low', 'high', 'full', 'en', true, false, [], {}, { master: 2 }];
    const keys = [...Object.keys(SETTINGS_SCHEMA), '__proto__', 'junk'];
    for (let i = 0; i < 500; i++) {
      const raw: Record<string, unknown> = {};
      for (const k of keys) if (rnd() < 0.5) raw[k] = pool[Math.floor(rnd() * pool.length)];
      const s = sanitizeSettings(raw);
      expect(['auto', 'low', 'medium', 'high', 'ultra']).toContain(s.quality);
      expect(['unset', 'low', 'medium', 'high']).toContain(s.autoQuality);
      expect(['full', 'limited', 'off']).toContain(s.autonomy);
      expect(typeof s.edgeScroll).toBe('boolean');
      expect(s.uiScale).toBeGreaterThanOrEqual(0.8);
      expect(s.uiScale).toBeLessThanOrEqual(1.4);
      expect(Number.isInteger(s.autosaveMinutes)).toBe(true);
      for (const v of Object.values(s.volumes)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('patches, equality, diffs', () => {
  it('applySettingsPatch merges partial volumes over the current values', () => {
    const cur = sanitizeSettings({ volumes: { music: 0.2, sfx: 0.3 } });
    const next = applySettingsPatch(cur, { volumes: { sfx: 0.9 } });
    expect(next.volumes.music).toBe(0.2);
    expect(next.volumes.sfx).toBe(0.9);
    expect(cur.volumes.sfx).toBe(0.3);
  });

  it('settingsEqual / changedSettings', () => {
    const a = cloneSettings(DEFAULT_SETTINGS);
    const b = applySettingsPatch(a, { showFps: true, volumes: { ui: 0.1 } });
    expect(settingsEqual(a, a)).toBe(true);
    expect(settingsEqual(a, b)).toBe(false);
    expect(changedSettings(a, b).sort()).toEqual(['showFps', 'volumes']);
  });

  it('effectivePixelRatio: auto caps devicePixelRatio at 2', () => {
    expect(effectivePixelRatio(0, 3)).toBe(2);
    expect(effectivePixelRatio(0, 1.25)).toBe(1.25);
    expect(effectivePixelRatio(0, NaN)).toBe(1);
    expect(effectivePixelRatio(2.5, 1)).toBe(2.5);
    expect(effectivePixelRatio(NaN, 0)).toBe(1);
  });
});

describe('ProfileWriter — serialized, coalescing, crash-tolerant', () => {
  it('coalesces bursts: last value wins, writes never overlap', async () => {
    const store = new FakeProfile();
    let inflight = 0;
    let maxInflight = 0;
    const orig = store.save.bind(store);
    store.save = async (k, v) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await flush(2);
      await orig(k, v);
      inflight--;
    };
    const w = new ProfileWriter(store, () => undefined);
    const ps = [1, 2, 3, 4, 5].map((n) => w.write('settings', { n }));
    await Promise.all(ps);
    await w.flush();
    expect(maxInflight).toBe(1);
    expect(store.saves.map((s) => (s.value as { n: number }).n)).toEqual([1, 5]);
    expect(store.data.get('settings')).toEqual({ n: 5 });
  });

  it('snapshots the value at write() time', async () => {
    const store = new FakeProfile();
    const w = new ProfileWriter(store, () => undefined);
    const obj = { a: 1 };
    const p = w.write('k', obj);
    obj.a = 2;
    await p;
    expect(store.data.get('k')).toEqual({ a: 1 });
  });

  it('reports failures without rejecting, and keeps working afterwards', async () => {
    const store = new FakeProfile();
    const errors: string[] = [];
    let fail = true;
    const orig = store.save.bind(store);
    store.save = async (k, v) => {
      if (fail) throw new Error('quota');
      return orig(k, v);
    };
    const w = new ProfileWriter(store, (key) => errors.push(key));
    await expect(w.write('settings', { x: 1 })).resolves.toBeUndefined();
    expect(errors).toEqual(['settings']);
    expect(w.failureCount).toBe(1);
    fail = false;
    await w.write('settings', { x: 2 });
    expect(store.data.get('settings')).toEqual({ x: 2 });
  });

  it('safeProfileLoad falls back on a throwing store', async () => {
    const store = new FakeProfile();
    store.failLoad = true;
    const errs: unknown[] = [];
    await expect(safeProfileLoad(store, 'settings', 'fallback', (e) => errs.push(e))).resolves.toBe('fallback');
    expect(errs.length).toBe(1);
  });
});

describe('music off by default (W-150)', () => {
  it('new and pre-W-150 profiles start with music off, slider value kept', () => {
    expect(DEFAULT_SETTINGS.musicEnabled).toBe(false);
    const old = sanitizeSettings({ quality: 'low', volumes: { music: 0.9 } });
    expect(old.musicEnabled).toBe(false);
    expect(old.volumes.music).toBe(0.9);
  });

  it('keeps a stored choice and rejects non-booleans', () => {
    expect(sanitizeSettings({ musicEnabled: true }).musicEnabled).toBe(true);
    expect(sanitizeSettings({ musicEnabled: 'true' }).musicEnabled).toBe(false);
    expect(sanitizeSettings({ musicEnabled: 1 }).musicEnabled).toBe(false);
  });

  it('sends the music channel as 0 while off and as the slider value while on; other channels untouched', () => {
    const off = effectiveVolumes(DEFAULT_SETTINGS);
    expect(off.music).toBe(0);
    expect({ ...off, music: DEFAULT_SETTINGS.volumes.music }).toEqual(DEFAULT_SETTINGS.volumes);
    const on = effectiveVolumes({ ...DEFAULT_SETTINGS, musicEnabled: true });
    expect(on).toEqual(DEFAULT_SETTINGS.volumes);
    expect(on).not.toBe(DEFAULT_SETTINGS.volumes);
  });

  it('turning music on is reported as a change', () => {
    expect(changedSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, musicEnabled: true })).toEqual(['musicEnabled']);
  });
});
