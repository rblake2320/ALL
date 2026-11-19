/**
 * Settings: schema-tolerant merge of untrusted data (profile storage, UI patches) over a known-good base.
 *
 * Rules (adversarial-safe):
 *  - Only keys declared in SETTINGS_SCHEMA are read; unknown keys (incl. `__proto__`, `constructor`, `prototype`)
 *    are ignored, and the result is always a fresh object literal, so prototype pollution cannot propagate.
 *  - Only OWN DATA properties are read (via property descriptors), so getters / Proxies never execute user code
 *    paths that throw; any exception while reading a key just keeps the base value.
 *  - Wrong types, NaN and ±Infinity are dropped (base value kept); finite numbers are clamped to their range.
 *  - The schema is typed as `{ [K in keyof Settings]: FieldSpec }`, so adding a setting to the contract without a
 *    validation rule is a compile error here.
 */
import { DEFAULT_SETTINGS, type Settings } from './contracts';
import type { AudioVolumes } from '../audio/contracts';
import type { AutoQualityLevel } from '../render/contracts';

export const SETTINGS_PROFILE_KEY = 'settings';

type FieldSpec =
  | { t: 'bool' }
  | { t: 'num'; min: number; max: number; int?: boolean; allowZero?: boolean }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'volumes' };

export const SETTINGS_SCHEMA: { readonly [K in keyof Settings]: FieldSpec } = {
  // 'auto' added by W-039; a stored level (the player's choice) is kept, a missing / invalid one reads as 'auto'
  quality: { t: 'enum', values: ['auto', 'low', 'medium', 'high', 'ultra'] },
  // = ['unset', ...AUTO_LEVELS] (render/core/autoQuality.ts; asserted by tests/unit/game/autoQuality.test.ts — W-107 extends both)
  autoQuality: { t: 'enum', values: ['unset', 'low', 'medium', 'high'] satisfies readonly ('unset' | AutoQualityLevel)[] },
  // 0 = auto (devicePixelRatio, capped at 2); otherwise 0.5..3.
  pixelRatio: { t: 'num', min: 0.5, max: 3, allowZero: true },
  volumes: { t: 'volumes' },
  // W-150: missing in a stored profile (every profile from before it) reads as the default, off
  musicEnabled: { t: 'bool' },
  muted: { t: 'bool' },
  muteWhenUnfocused: { t: 'bool' },
  pauseWhenUnfocused: { t: 'bool' },
  autosaveMinutes: { t: 'num', min: 0, max: 60, int: true },
  edgeScroll: { t: 'bool' },
  cameraSpeed: { t: 'num', min: 0.5, max: 2 },
  invertZoom: { t: 'bool' },
  uiScale: { t: 'num', min: 0.8, max: 1.4 },
  reduceMotion: { t: 'bool' },
  miniatureFocus: { t: 'bool' },
  colorblindNeeds: { t: 'bool' },
  showFps: { t: 'bool' },
  autonomy: { t: 'enum', values: ['full', 'limited', 'off'] },
  autoPauseOnEvents: { t: 'bool' },
  tutorialEnabled: { t: 'bool' },
  snapBuilding: { t: 'bool' },
  language: { t: 'enum', values: ['en'] },
};

/** The volumes the audio engine gets: the player's sliders, with the music channel silent while music is off (W-150). */
export function effectiveVolumes(s: Pick<Settings, 'volumes' | 'musicEnabled'>): AudioVolumes {
  return { ...s.volumes, music: s.musicEnabled === true ? s.volumes.music : 0 };
}

export const VOLUME_CHANNELS: readonly (keyof AudioVolumes)[] = ['master', 'music', 'sfx', 'voice', 'ambient', 'ui'];

type Read = { ok: true; value: unknown } | { ok: false };

/** Read an own data property without invoking getters; never throws. */
export function readOwnData(obj: unknown, key: string): Read {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  try {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d || !('value' in d)) return { ok: false };
    return { ok: true, value: d.value };
  } catch {
    return { ok: false };
  }
}

function validNumber(v: unknown, spec: { min: number; max: number; int?: boolean; allowZero?: boolean }): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (spec.allowZero && v === 0) return 0;
  if (spec.allowZero && v < 0) return undefined;
  let n = spec.int ? Math.round(v) : v;
  if (n < spec.min) n = spec.min;
  if (n > spec.max) n = spec.max;
  return n;
}

function sanitizeVolumes(raw: unknown, base: AudioVolumes): AudioVolumes {
  const out: AudioVolumes = {
    master: base.master,
    music: base.music,
    sfx: base.sfx,
    voice: base.voice,
    ambient: base.ambient,
    ui: base.ui,
  };
  for (const ch of VOLUME_CHANNELS) {
    const r = readOwnData(raw, ch);
    if (!r.ok) continue;
    const n = validNumber(r.value, { min: 0, max: 1 });
    if (n !== undefined) out[ch] = n;
  }
  return out;
}

function sanitizeField<K extends keyof Settings>(key: K, raw: unknown, base: Settings): Settings[K] {
  const spec = SETTINGS_SCHEMA[key];
  const r = readOwnData(raw, key);
  if (spec.t === 'volumes') {
    return (r.ok ? sanitizeVolumes(r.value, base.volumes) : sanitizeVolumes(null, base.volumes)) as Settings[K];
  }
  if (!r.ok) return base[key];
  const v = r.value;
  switch (spec.t) {
    case 'bool':
      return (typeof v === 'boolean' ? v : base[key]) as Settings[K];
    case 'num': {
      const n = validNumber(v, spec);
      return (n === undefined ? base[key] : n) as Settings[K];
    }
    case 'enum':
      return (typeof v === 'string' && spec.values.includes(v) ? v : base[key]) as Settings[K];
  }
}

/** Defensive copy of a settings object (fresh volumes object). Assumes `s` is already valid. */
export function cloneSettings(s: Settings): Settings {
  return { ...s, volumes: { ...s.volumes } };
}

/**
 * Merge untrusted `raw` over `base` (default DEFAULT_SETTINGS). Never throws; never returns an alias of `base`
 * or of `raw`.
 */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  // Re-validate the base too, so a corrupted in-memory base can never leak through.
  const safeBase = base === DEFAULT_SETTINGS ? DEFAULT_SETTINGS : sanitizeAgainstDefaults(base);
  const out = {} as Record<keyof Settings, unknown>;
  for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
    out[key] = sanitizeField(key, raw, safeBase);
  }
  return out as unknown as Settings;
}

function sanitizeAgainstDefaults(base: Settings): Settings {
  const out = {} as Record<keyof Settings, unknown>;
  for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
    out[key] = sanitizeField(key, base, DEFAULT_SETTINGS);
  }
  return out as unknown as Settings;
}

/** Apply a UI patch (Partial<Settings>, possibly with partial volumes) to the current settings. */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  return sanitizeSettings(patch, current);
}

export function settingsEqual(a: Settings, b: Settings): boolean {
  for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
    if (key === 'volumes') {
      for (const ch of VOLUME_CHANNELS) if (a.volumes[ch] !== b.volumes[ch]) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/** Keys whose value differs (volumes compared per channel). */
export function changedSettings(a: Settings, b: Settings): (keyof Settings)[] {
  const out: (keyof Settings)[] = [];
  for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
    if (key === 'volumes') {
      if (VOLUME_CHANNELS.some((ch) => a.volumes[ch] !== b.volumes[ch])) out.push(key);
    } else if (a[key] !== b[key]) {
      out.push(key);
    }
  }
  return out;
}

/** Effective renderer pixel ratio: explicit value, or devicePixelRatio capped at 2 when 0 (auto). */
export function effectivePixelRatio(setting: number, devicePixelRatio: number): number {
  if (Number.isFinite(setting) && setting > 0) return Math.min(3, Math.max(0.5, setting));
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(2, Math.max(0.5, dpr));
}
