import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUBBLE_ICONS } from '../../../src/sim/contracts';
import { HAIR_STYLES, EYE_STYLES, defaultAppearance } from '../../../src/shared/appearance';
import { Icon, hasIcon, iconNames } from '../../../src/ui/icons';
import { BUBBLE_ICON_DEFS } from '../../../src/ui/common/iconData/bubble';
import { UI_ICON_DEFS } from '../../../src/ui/common/iconData/ui';
import { circle, gear, rrect, star } from '../../../src/ui/common/iconData/geom';
import {
  appearanceSeed,
  eyeShapes,
  hairShapes,
  headPath,
  mouthPath,
  portraitDims,
  portraitPalette,
  shouldersPath,
  skinColor,
} from '../../../src/ui/common/portraitParts';
import { parseHex } from '../../../src/ui/common/color';

const REQUIRED_UI = [
  'pause', 'play', 'speed1', 'speed2', 'speed3', 'ultra', 'live', 'buy', 'build', 'wallsUp', 'cutaway', 'wallsDown', 'rotateLeft',
  'rotateRight', 'settings', 'save', 'load', 'close', 'check', 'warning', 'info', 'money', 'bills', 'phone', 'trash', 'rotate', 'undo',
  'redo', 'sell', 'eyedropper', 'wall', 'room', 'door', 'window', 'floor', 'paint', 'deleteWall', 'camera', 'help', 'menu',
  'chevronLeft', 'chevronRight', 'chevronUp', 'chevronDown', 'plus', 'minus', 'user', 'users', 'lock', 'crown', 'search', 'filter',
  'bell', 'log', 'power', 'powerOff', 'freshness', 'energy', 'hunger', 'social', 'fun', 'hygiene', 'vitality', 'limbArm', 'limbLeg',
  'aspiration', 'career', 'skills', 'relationships', 'mood', 'quit', 'export', 'import', 'edit', 'dice', 'voice',
];

const partD = (p: unknown) => (typeof p === 'string' ? p.replace(/^[FTD] /, '') : (p as { d: string }).d);

describe('icon set', () => {
  it('covers every BubbleIcon', () => {
    expect(BUBBLE_ICONS.filter((n) => !hasIcon(n))).toEqual([]);
  });
  it('covers every UI icon from the spec', () => {
    expect(REQUIRED_UI.filter((n) => !hasIcon(n))).toEqual([]);
  });
  it('lists names sorted and unique', () => {
    expect([...iconNames].sort()).toEqual(iconNames);
    expect(new Set(iconNames).size).toBe(iconNames.length);
  });
  it('has well-formed path data (no NaN/undefined, starts with a moveto)', () => {
    for (const [name, def] of Object.entries({ ...BUBBLE_ICON_DEFS, ...UI_ICON_DEFS })) {
      expect(def.length, name).toBeGreaterThan(0);
      for (const p of def) {
        const d = partD(p);
        expect(d, name).toMatch(/^M/);
        expect(d, name).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
  it('renders a fallback for unknown names without throwing', () => {
    for (const bad of ['definitely-not', '', '__proto__', 'constructor', 42 as unknown as string]) {
      const vnode = Icon({ name: bad });
      expect(vnode).toBeTruthy();
      expect((vnode.props as { viewBox: string }).viewBox).toBe('0 0 24 24');
    }
  });
  it('is decorative by default and labelled when titled', () => {
    const plain = Icon({ name: 'coffin' }).props as Record<string, unknown>;
    expect(plain['aria-hidden']).toBe('true');
    const titled = Icon({ name: 'coffin', title: 'Coffin' }).props as Record<string, unknown>;
    expect(titled.role).toBe('img');
    expect(titled['aria-label']).toBe('Coffin');
  });
  it('every icon name the shell references exists', () => {
    const root = resolve(__dirname, '../../../src/ui');
    const misses: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== 'hud') walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(n)) continue;
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:icon|name)=["']([a-zA-Z0-9]+)["']/g)) {
          if (!hasIcon(m[1]) && !['definitely'].includes(m[1])) misses.push(`${m[1]} in ${n}`);
        }
        for (const m of src.matchAll(/\bicon:\s*'([a-zA-Z0-9]+)'/g)) if (!hasIcon(m[1])) misses.push(`${m[1]} in ${n}`);
      }
    };
    walk(root);
    expect(misses).toEqual([]);
  });
  it('geometry helpers stay finite on odd inputs', () => {
    expect(circle(12, 12, 0)).not.toMatch(/NaN/);
    expect(rrect(0, 0, 10, 4, 99)).not.toMatch(/NaN/);
    expect(rrect(0, 0, 10, 4, 0)).toMatch(/z$/);
    expect(star(12, 12, 9, 4, 2)).not.toMatch(/NaN/);
    expect(gear(12, 12, 9, 7, 1)).not.toMatch(/NaN/);
  });
});

describe('portrait geometry', () => {
  const garbage = [null, undefined, {}, { build: NaN, height: Infinity, skinTone: -4, hairStyle: 'nope', eyeStyle: 'x', hairColor: 'red', topColor: 7, eyeColor: '' }] as const;
  it('never emits NaN for any style or garbage appearance', () => {
    for (const app of [defaultAppearance(), ...garbage]) {
      const d = portraitDims(app as never);
      for (const v of Object.values(d)) expect(Number.isFinite(v)).toBe(true);
      expect(headPath(d)).not.toMatch(/NaN|Infinity/);
      expect(shouldersPath((app as { build?: number } | null)?.build ?? NaN)).not.toMatch(/NaN/);
      for (const style of [...HAIR_STYLES, 'unknown', null, undefined]) {
        const h = hairShapes(style as never, d);
        for (const p of [...h.back, ...h.front, ...h.strands]) expect(p, String(style)).not.toMatch(/NaN|Infinity|undefined/);
      }
      for (const style of [...EYE_STYLES, 'unknown', null]) {
        const e = eyeShapes(style as never, d);
        expect(e.irises.length).toBeGreaterThan(0);
        for (const arr of [...e.sockets, ...e.whites, ...e.irises, ...e.pupils]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
      }
      for (const ex of ['neutral', 'happy', 'sad', 'angry', 'shocked', 'flirty', 'bogus', undefined]) expect(mouthPath(ex, d)).not.toMatch(/NaN/);
    }
  });
  it('maps skin tones safely and produces valid palette colours', () => {
    expect(skinColor({ skinTone: 0 })).toBe('#9fb88a');
    expect(skinColor({ skinTone: 99 })).toBe('#9a8a7a');
    expect(skinColor({ skinTone: -3 })).toBe('#9fb88a');
    expect(skinColor({ skinTone: NaN })).toBe('#9fb88a');
    for (const app of garbage) {
      const pal = portraitPalette(app as never);
      for (const v of Object.values(pal)) expect(parseHex(v), v).not.toBeNull();
    }
  });
  it('build widens and height lengthens the head', () => {
    const slim = portraitDims({ build: 0, height: 0.5 });
    const stocky = portraitDims({ build: 1, height: 0.5 });
    expect(stocky.hw).toBeGreaterThan(slim.hw);
    expect(portraitDims({ height: 1 }).hh).toBeGreaterThan(portraitDims({ height: 0 }).hh);
  });
  it('seeds are stable and colour-sensitive', () => {
    const a = defaultAppearance();
    expect(appearanceSeed(a)).toBe(appearanceSeed({ ...a }));
    expect(appearanceSeed(a)).not.toBe(appearanceSeed({ ...a, hairColor: '#ffffff' }));
    expect(Number.isInteger(appearanceSeed(null))).toBe(true);
  });
});
