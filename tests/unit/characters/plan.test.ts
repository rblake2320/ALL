/** Pure helpers: appearance sanitising, visibility plan, limb rules, anim resolution, colour math (adversarial). */
import { describe, expect, it } from 'vitest';
import {
  ACCESSORIES, ANIM_STATES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES, defaultAppearance,
  intactLimbs,
} from '../../../src/shared/appearance';
import type { LimbState, ZombieAppearance } from '../../../src/shared/appearance';
import {
  blotchStrength, clamp01, isHexColor, mixRgb, parseHex, skinColor, skinToneIndex, toHex,
} from '../../../src/render/characters/colors';
import {
  buildInfluence, buildWidth, carryHand, heightScale, resolveAnim, sanitizeAnim, sanitizeAppearance, sanitizeCarry,
  sanitizeExpression, sanitizeLimbs, sanitizeSpeed, visibilityPlan,
} from '../../../src/render/characters/plan';
import { requiredNodes } from '../../../src/render/characters/names';

const app = (p: Partial<ZombieAppearance>): ZombieAppearance => ({ ...defaultAppearance(), ...p });
const limbs = (p: Partial<LimbState>): LimbState => ({ ...intactLimbs(), ...p });
const GARBAGE: unknown[] = [null, undefined, 0, NaN, 'zombie', [], () => 1, Symbol('x'), { hairStyle: 42 }, true];

describe('sanitizeAppearance', () => {
  it('returns defaults for garbage input without throwing', () => {
    for (const g of GARBAGE) expect(sanitizeAppearance(g)).toEqual(defaultAppearance());
  });

  it('replaces unknown style strings and bad colours field by field', () => {
    const s = sanitizeAppearance({
      ...defaultAppearance(), hairStyle: 'pompadour', topStyle: 'toga', bottomStyle: 'kilt', eyeStyle: 'laser',
      accessory: 'crown', hairColor: 'red', topColor: '#12', bottomColor: 123, shoeColor: '#GGGGGG', eyeColor: '',
    });
    const d = defaultAppearance();
    expect(s.hairStyle).toBe(d.hairStyle);
    expect(s.topStyle).toBe(d.topStyle);
    expect(s.bottomStyle).toBe(d.bottomStyle);
    expect(s.eyeStyle).toBe(d.eyeStyle);
    expect(s.accessory).toBe(d.accessory);
    expect(s.hairColor).toBe(d.hairColor);
    expect(s.topColor).toBe(d.topColor);
    expect(s.bottomColor).toBe(d.bottomColor);
    expect(s.shoeColor).toBe(d.shoeColor);
    expect(s.eyeColor).toBe(d.eyeColor);
  });

  it('clamps numeric fields and maps NaN / out-of-range skin tones safely', () => {
    expect(sanitizeAppearance(app({ height: NaN })).height).toBe(defaultAppearance().height);
    expect(sanitizeAppearance(app({ height: 5 })).height).toBe(1);
    expect(sanitizeAppearance(app({ build: -3 })).build).toBe(0);
    expect(sanitizeAppearance(app({ skinTone: 99 })).skinTone).toBe(SKIN_TONES.length - 1);
    expect(sanitizeAppearance(app({ skinTone: -5 })).skinTone).toBe(0);
    expect(sanitizeAppearance(app({ skinTone: NaN })).skinTone).toBe(0);
    expect(sanitizeAppearance({ ...defaultAppearance(), skinTone: '3' }).skinTone).toBe(0);
    expect(sanitizeAppearance(app({ skinTone: 2.6 })).skinTone).toBe(3);
    expect(sanitizeAppearance(app({ voicePitch: Infinity })).voicePitch).toBe(defaultAppearance().voicePitch);
  });

  it('keeps valid values untouched', () => {
    const a = app({ hairStyle: 'afro', topStyle: 'suit', bottomStyle: 'skirt', eyeStyle: 'beady', accessory: 'eyepatch',
      hairColor: '#abc', skinTone: 7, stitches: false });
    expect(sanitizeAppearance(a)).toEqual(a);
  });
});

describe('sanitize misc', () => {
  it('limbs: unknown conditions -> ok, missing keys -> ok', () => {
    expect(sanitizeLimbs({ armL: 'gone', legR: 'missing', foo: 'bar' })).toEqual(limbs({ legR: 'missing' }));
    for (const g of GARBAGE) expect(sanitizeLimbs(g)).toEqual(intactLimbs());
  });
  it('anim / expression / carry / speed', () => {
    expect(sanitizeAnim('moonwalk')).toBe('idle');
    expect(sanitizeAnim(undefined)).toBe('idle');
    expect(sanitizeExpression('smug')).toBe('neutral');
    expect(sanitizeCarry('sword')).toBeNull();
    expect(sanitizeCarry('pizza')).toBe('pizza');
    expect(sanitizeSpeed(NaN)).toBe(1);
    expect(sanitizeSpeed(-2)).toBe(1);
    // 0 is meaningful (RENDER passes it while a walker stands still): the cycle freezes
    expect(sanitizeSpeed(0)).toBe(0);
    expect(sanitizeSpeed(-0.0)).toBe(0);
    expect(sanitizeSpeed(-1e-9)).toBe(1);
    expect(sanitizeSpeed(Infinity)).toBe(1);
    expect(sanitizeSpeed('2' as unknown as number)).toBe(1);
    expect(sanitizeSpeed(1e9)).toBe(6);
    expect(sanitizeSpeed(0.001)).toBe(0.001);
  });
});

describe('visibilityPlan', () => {
  it('only ever references nodes that exist in the GLB contract', () => {
    const known = new Set(requiredNodes());
    for (const h of HAIR_STYLES) for (const t of TOP_STYLES) for (const b of BOTTOM_STYLES) {
      for (const acc of ACCESSORIES) {
        const p = visibilityPlan(app({ hairStyle: h, topStyle: t, bottomStyle: b, accessory: acc }), intactLimbs());
        for (const n of p.visible) expect(known.has(n), n).toBe(true);
      }
    }
  });

  it('shows exactly one eye set, one top body, at most one hair and one accessory', () => {
    for (const e of EYE_STYLES) for (const h of HAIR_STYLES) {
      const v = [...visibilityPlan(app({ eyeStyle: e, hairStyle: h }), intactLimbs()).visible];
      expect(v.filter((n) => n.startsWith('Eyes_'))).toEqual([`Eyes_${e}`]);
      expect(v.filter((n) => n.startsWith('Hair_'))).toEqual(h === 'bald' ? [] : [`Hair_${h}`]);
      expect(v.filter((n) => n.endsWith('_Body'))).toHaveLength(1);
    }
    expect([...visibilityPlan(app({ accessory: 'none' }), intactLimbs()).visible].some((n) => n.startsWith('Acc_'))).toBe(false);
  });

  it('missing limbs hide the limb, its sleeve / trouser leg and shoe, and show the stump', () => {
    const v = visibilityPlan(app({ topStyle: 'tee', bottomStyle: 'pants' }), limbs({ armL: 'missing', legR: 'missing' })).visible;
    expect(v.has('Stump_ArmL')).toBe(true);
    expect(v.has('Hand_L')).toBe(false);
    expect(v.has('ArmUpper_L')).toBe(false);
    expect(v.has('Top_tee_SleeveL')).toBe(false);
    expect(v.has('Top_tee_SleeveR')).toBe(true);
    expect(v.has('Stump_LegR')).toBe(true);
    expect(v.has('Bottom_pants_LegR')).toBe(false);
    expect(v.has('Shoe_R')).toBe(false);
    expect(v.has('Shoe_L')).toBe(true);
  });

  it('prosthetic limbs show the wooden part, keep clothing, hide flesh + shoe', () => {
    const v = visibilityPlan(app({ topStyle: 'hoodie' }), limbs({ armR: 'prosthetic', legL: 'prosthetic' })).visible;
    expect(v.has('Prosthetic_ArmR')).toBe(true);
    expect(v.has('Top_hoodie_SleeveR')).toBe(true);
    expect(v.has('Hand_R')).toBe(false);
    expect(v.has('Stump_ArmR')).toBe(false);
    expect(v.has('Prosthetic_LegL')).toBe(true);
    expect(v.has('Shoe_L')).toBe(false);
    expect(v.has('Bottom_pants_LegL')).toBe(true);
  });

  it('collapses the stitches of non-original limbs via morphs', () => {
    const p = visibilityPlan(app({ stitches: true }), limbs({ armL: 'missing', legR: 'prosthetic' }));
    expect(p.stitchMorphs).toEqual({ hide_armL: 1, hide_armR: 0, hide_legL: 0, hide_legR: 1 });
    expect(visibilityPlan(app({ stitches: false }), intactLimbs()).visible.has('Stitches')).toBe(false);
  });

  it('hides covered skin (draw-call savings) and handles style interactions', () => {
    const hoodie = visibilityPlan(app({ topStyle: 'hoodie', bottomStyle: 'pants' }), intactLimbs()).visible;
    expect(hoodie.has('ArmUpper_L')).toBe(false);
    expect(hoodie.has('LegLower_R')).toBe(false);
    expect(hoodie.has('Torso')).toBe(false);
    expect(hoodie.has('Hand_L')).toBe(true);
    const tatters = visibilityPlan(app({ topStyle: 'tatters', bottomStyle: 'shorts' }), intactLimbs()).visible;
    expect(tatters.has('Torso')).toBe(true);
    expect(tatters.has('LegLower_L')).toBe(true);
    const beanie = visibilityPlan(app({ hairStyle: 'afro', accessory: 'beanie' }), intactLimbs()).visible;
    expect(beanie.has('Hair_afro')).toBe(false);
    expect(beanie.has('Acc_beanie')).toBe(true);
    const bobBeanie = visibilityPlan(app({ hairStyle: 'bob', accessory: 'beanie' }), intactLimbs()).visible;
    expect(bobBeanie.has('Hair_bob')).toBe(true);
    const dress = visibilityPlan(app({ topStyle: 'dress', bottomStyle: 'shorts' }), intactLimbs()).visible;
    expect(dress.has('Bottom_shorts_Waist')).toBe(false);
    expect(dress.has('Bottom_shorts_LegL')).toBe(false);
    const dressPants = visibilityPlan(app({ topStyle: 'dress', bottomStyle: 'pants' }), intactLimbs()).visible;
    expect(dressPants.has('Bottom_pants_LegL')).toBe(true);
  });

  it('never throws on garbage', () => {
    for (const a of GARBAGE) for (const l of GARBAGE) expect(() => visibilityPlan(a, l)).not.toThrow();
  });
});

describe('body scaling', () => {
  it('height 0..1 maps to 0.88..1.08, build to 0.9..1.15 width', () => {
    expect(heightScale(0)).toBeCloseTo(0.88);
    expect(heightScale(1)).toBeCloseTo(1.08);
    expect(heightScale(NaN)).toBeCloseTo(0.98);
    expect(heightScale(-10)).toBeCloseTo(0.88);
    expect(buildWidth(0)).toBeCloseTo(0.9);
    expect(buildWidth(1)).toBeCloseTo(1.15);
    expect(buildInfluence(1)).toBeCloseTo(1);
    expect(buildInfluence(0)).toBeCloseTo(-2 / 3);
    expect(Number.isFinite(buildInfluence('wide'))).toBe(true);
  });
});

describe('resolveAnim / carryHand', () => {
  it('maps unknown states to idle and leaves intact zombies alone', () => {
    expect(resolveAnim('moonwalk', intactLimbs())).toEqual({ clip: 'idle', mirror: false, timeScale: 1 });
    for (const s of ANIM_STATES) {
      const r = resolveAnim(s, intactLimbs());
      expect(r.mirror).toBe(false);
      expect(r.clip).toBe(s === 'limp' ? 'walk' : s);
    }
  });
  it('walk with one leg -> limp (mirrored for the right leg); none -> crawl', () => {
    expect(resolveAnim('walk', limbs({ legL: 'missing' }))).toMatchObject({ clip: 'limp', mirror: false });
    expect(resolveAnim('walk', limbs({ legR: 'missing' }))).toMatchObject({ clip: 'limp', mirror: true });
    expect(resolveAnim('walk', limbs({ legL: 'missing', legR: 'missing' }))).toMatchObject({ clip: 'crawl', timeScale: 1 });
    expect(resolveAnim('idle', limbs({ legL: 'missing', legR: 'missing' }))).toMatchObject({ clip: 'crawl', timeScale: 0.35 });
    expect(resolveAnim('sit', limbs({ legL: 'missing', legR: 'missing' }))).toMatchObject({ clip: 'sit' });
    expect(resolveAnim('walk', limbs({ legL: 'prosthetic' }))).toMatchObject({ clip: 'walk' });
  });
  it('right-handed actions mirror when the right arm is missing', () => {
    expect(resolveAnim('wave', limbs({ armR: 'missing' }))).toMatchObject({ clip: 'wave', mirror: true });
    expect(resolveAnim('wave', limbs({ armR: 'missing', armL: 'missing' }))).toMatchObject({ mirror: false });
    expect(resolveAnim('wave', limbs({ armR: 'prosthetic' }))).toMatchObject({ mirror: false });
  });
  it('carry hand prefers the right, falls back to the left, null without arms', () => {
    expect(carryHand(intactLimbs())).toBe('R');
    expect(carryHand(limbs({ armR: 'missing' }))).toBe('L');
    expect(carryHand(limbs({ armR: 'missing', armL: 'missing' }))).toBeNull();
    expect(carryHand(limbs({ armR: 'prosthetic' }))).toBe('R');
    expect(carryHand('nonsense')).toBe('R');
  });
});

describe('colour math', () => {
  it('parses #rgb / #rrggbb / bare hex and rejects garbage', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHex('#f00')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseHex('00ff00')).toEqual({ r: 0, g: 1, b: 0 });
    expect(toHex(parseHex('nonsense', '#123456'))).toBe('#123456');
    expect(toHex(parseHex(42))).toBe('#808080');
    expect(toHex(parseHex('#12345', 'also bad'))).toBe('#808080');
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('#abcde')).toBe(false);
  });
  it('skin colour drifts toward the rot tint with decay and is safe for bad input', () => {
    const fresh = skinColor(0, 0);
    expect(toHex(fresh)).toBe(SKIN_TONES[0]);
    const rotten = skinColor(0, 1);
    expect(toHex(rotten)).not.toBe(SKIN_TONES[0]);
    expect(skinColor(0, NaN)).toEqual(fresh);
    expect(skinColor(0, 7)).toEqual(rotten);
    expect(skinColor(NaN, 0)).toEqual(fresh);
    expect(toHex(skinColor(999, 0))).toBe(SKIN_TONES[SKIN_TONES.length - 1]);
    expect(skinToneIndex(-1)).toBe(0);
    // rotting desaturates toward green-grey: the colour moves monotonically
    const a = skinColor(5, 0.2);
    const b = skinColor(5, 0.8);
    expect(Math.abs(b.g - parseHex('#7c8a5c').g)).toBeLessThan(Math.abs(a.g - parseHex('#7c8a5c').g));
  });
  it('blotch strength is 0 when fresh, 1 when rotten and monotonic', () => {
    expect(blotchStrength(0)).toBe(0);
    expect(blotchStrength(1)).toBeCloseTo(1);
    let prev = -1;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const v = blotchStrength(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(blotchStrength(NaN)).toBe(0);
  });
  it('clamps and mixes', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(mixRgb({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 5)).toEqual({ r: 1, g: 1, b: 1 });
  });
});
