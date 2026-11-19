/**
 * Premium bodies on the runtime, against the REAL published files (public/assets/models/characters/premium/*.glb +
 * manifest.premium.json). Textures are stripped for Node (castFixture parseGlbWithoutTextures); geometry, skin, Rig
 * extras and the manifest are the shipped ones. Covers: both files of every design load as a one-draw cast rig and
 * play every state; the graphics level picks the file; a failed high file falls back to the low one; hostile
 * manifests cannot redirect a load; premium bodies are never dealt at random; saves keep them.
 */
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIM_STATES, defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import { CAST_BODIES, CAST_BODY_IDS, SCULPTED_BODY_IDS, castBody, isCastBodyId, normalizeBody } from '../../../src/shared/cast';
import {
  PREMIUM_BODIES, PREMIUM_BODY_IDS, isPremiumBodyId, premiumDetailForQuality, premiumGlbPath,
} from '../../../src/shared/premiumBodies';
import type { PremiumDetail } from '../../../src/shared/premiumBodies';
import { DIM } from '../../../src/shared/dimensions';
import { castGlbPath, parsePremiumManifest } from '../../../src/render/characters/cast';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import { CATALOG, BODY_PREFIX } from '../../../src/economy/catalog';
import { bodyForKey } from '../../../src/game/randomZombie';
import { townieBodies } from '../../../src/sim/systems/people/townies/castBodies';
import { castGroups, castThumbUrl } from '../../../src/ui/common/castArt';
import { parseGlbWithoutTextures } from './castFixture';
import { ROOT, loadGltf } from './helpers';

const ASSETS = resolve(ROOT, 'public/assets');
const MANIFEST = resolve(ASSETS, 'manifest.premium.json');
const spec = JSON.parse(readFileSync(resolve(ROOT, 'tools/blender/cast/premium/bodies.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};
const wy = (r: ZombieRigDebug, bone: string) => {
  r.root.updateMatrixWorld(true);
  return r.root.getObjectByName(bone)!.getWorldPosition(new THREE.Vector3()).y;
};
const triangles = (r: ZombieRigDebug): number => {
  let n = 0;
  r.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return n;
};

interface Rig { warnings: string[]; urls: string[]; f: ReturnType<typeof createCharacterFactory> }
function factory(o: { detail?: PremiumDetail; fail?: (url: string) => boolean; manifest?: unknown | 'missing' } = {}): Rig {
  const h: Rig = { warnings: [], urls: [], f: null as unknown as Rig['f'] };
  h.f = createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGltf(),
    warn: (m) => h.warnings.push(m),
    premiumDetail: o.detail ? () => o.detail! : undefined,
    loadCast: async (url) => {
      h.urls.push(url);
      if (o.fail?.(url)) throw new Error('HTTP 404');
      return parseGlbWithoutTextures(readFileSync(resolve(ASSETS, url.replace(/^\/assets\//, ''))));
    },
    loadCastManifest: async (url) => {
      if (url.endsWith('manifest.premium.json')) {
        if (o.manifest === 'missing') throw new Error('HTTP 404');
        return o.manifest ?? manifest;
      }
      return JSON.parse(readFileSync(resolve(ASSETS, 'manifest.cast.json'), 'utf8'));
    },
  });
  return h;
}

describe('premium body contract', () => {
  it('the TypeScript list and tools/blender/cast/premium/bodies.json are the same data', () => {
    expect(spec.bodies.map((b: any) => b.id)).toEqual([...PREMIUM_BODY_IDS]);
    for (const b of spec.bodies) {
      const d = PREMIUM_BODIES.find((x) => x.id === b.id)!;
      expect({ name: d.name, sourceId: d.sourceId, height: d.height, blurb: d.blurb })
        .toEqual({ name: b.name, sourceId: b.sourceId, height: b.height, blurb: b.blurb });
      expect(d.category).toBe('premium');
      expect(d.height).toBeLessThan(DIM.DOOR_HEIGHT);
    }
  });

  it('a premium id is a valid body everywhere a cast id is, and the cast kit list is still exactly the 25', () => {
    expect(CAST_BODY_IDS).toHaveLength(25);
    expect(CAST_BODIES).toHaveLength(25);
    expect(SCULPTED_BODY_IDS).toEqual([...CAST_BODY_IDS, ...PREMIUM_BODY_IDS]);
    for (const id of PREMIUM_BODY_IDS) {
      expect(isCastBodyId(id)).toBe(true);
      expect(isPremiumBodyId(id)).toBe(true);
      expect(normalizeBody(id)).toBe(id);
      expect(castBody(id).id).toBe(id);
      expect((CAST_BODY_IDS as readonly string[]).includes(id)).toBe(false);
    }
    for (const junk of ['Sexton', 'sexton ', 'sexton_low', '', null, 7, {}, ['sexton']]) {
      expect(isPremiumBodyId(junk)).toBe(false);
      expect(normalizeBody(junk)).toBe('classic');
    }
  });

  it('paths: high and low files, thumbnails in ui/premium; the graphics level picks the file', () => {
    expect(premiumGlbPath('sexton', 'high')).toBe('models/characters/premium/sexton.glb');
    expect(premiumGlbPath('sexton', 'low')).toBe('models/characters/premium/sexton_low.glb');
    expect(castGlbPath('lowside', 'low')).toBe('models/characters/premium/lowside_low.glb');
    expect(castGlbPath('walker', 'low')).toBe('models/characters/cast/walker.glb');
    expect(castThumbUrl('patient')).toMatch(/assets\/ui\/premium\/patient\.webp$/);
    expect(castThumbUrl('walker')).toMatch(/assets\/ui\/cast\/walker\.webp$/);
    expect(['low', 'medium', 'high', 'ultra'].map(premiumDetailForQuality)).toEqual(['low', 'low', 'high', 'high']);
    for (const unknown of [undefined, null, 'auto', 'HIGH', 3]) expect(premiumDetailForQuality(unknown)).toBe('low');
  });

  it('the store lists every premium body for Grave Gold only; the picker shows them first', () => {
    for (const id of PREMIUM_BODY_IDS) {
      const e = CATALOG.find((c) => c.contentId === `${BODY_PREFIX}${id}`)!;
      expect(e.tier).toBe('premium');
      expect(e.priceGG).toBeGreaterThan(800);
      expect(e.priceBones).toBeUndefined();
    }
    const groups = castGroups();
    expect(groups[0].category).toBe('premium');
    expect(groups[0].bodies.map((b) => b.id)).toEqual([...PREMIUM_BODY_IDS]);
    expect(groups.flatMap((g) => g.bodies).length).toBe(30);
  });

  it('a premium body is never dealt at random: not to townies, not by the randomiser', () => {
    for (let seed = 1; seed <= 400; seed++) {
      for (const b of townieBodies(seed, 24)) expect(isPremiumBodyId(b)).toBe(false);
    }
    for (let key = 0; key < 20000; key++) expect(isPremiumBodyId(bodyForKey(key))).toBe(false);
  });
});

describe('manifest.premium.json parsing', () => {
  it('reads the wanted representation of every body', () => {
    for (const detail of ['high', 'low'] as const) {
      const m = parsePremiumManifest(manifest, detail);
      expect([...m.keys()]).toEqual([...PREMIUM_BODY_IDS]);
      for (const b of manifest.bodies) {
        const e = m.get(b.id)!;
        const rep = b.representations[detail];
        expect(e.file).toBe(rep.file);
        expect(e.height).toBe(b.height);
        expect(e.pelvisRest).toEqual(rep.pelvisRest);
        expect(e.pelvisScale).toBe(rep.pelvisScale);
        expect(e.headTop).toBe(rep.headTop);
        expect(e.carryAnchors).toEqual(rep.carryAnchors);
      }
    }
  });

  it('junk, hostile and cross-wired manifests fall back to the conventional file of the wanted detail', () => {
    const conventional = (m: Map<string, { file: string }>, detail: PremiumDetail) => {
      for (const id of PREMIUM_BODY_IDS) expect(m.get(id)!.file).toBe(premiumGlbPath(id, detail));
    };
    for (const junk of [null, undefined, 3, 'x', [], {}, { bodies: 'no' }, { bodies: [null, 4, { id: 'walker' }, { id: 'sexton' }] }]) {
      conventional(parsePremiumManifest(junk, 'low') as never, 'low');
    }
    const hostile = {
      bodies: [
        { id: 'sexton', representations: { low: { file: 'models/characters/premium/sexton.glb' }, high: { file: '../../secrets.glb' } } },
        { id: 'lowside', representations: { low: { file: 'https://evil.example/x.glb' }, high: { file: '/etc/passwd' } } },
        { id: 'waitress', representations: { low: { file: 'models/characters/cast/walker.glb' }, high: [] } },
        { id: 'patient', representations: 'high' },
        { id: 'intruder', representations: { high: { file: 'models/characters/premium/intruder.glb' } } },
      ],
    };
    for (const detail of ['high', 'low'] as const) {
      const m = parsePremiumManifest(hostile, detail);
      expect(m.size).toBe(PREMIUM_BODY_IDS.length);
      conventional(m as never, detail);
    }
  });
});

describe('published premium bodies on the runtime', () => {
  for (const detail of ['high', 'low'] as const) {
    it(`${detail}: every body loads as a one-draw cast rig, plays all states, sits on the seat, stands on the floor`, async () => {
      const h = factory({ detail });
      const rigs = PREMIUM_BODY_IDS.map((id) => [id, h.f.create({ ...defaultAppearance(), body: id }, intactLimbs()) as ZombieRigDebug] as const);
      await h.f.ready;
      await h.f.castSettled();
      expect(h.warnings).toEqual([]);
      expect(h.urls.sort()).toEqual(PREMIUM_BODY_IDS.map((id) => `/assets/${premiumGlbPath(id, detail)}`).sort());
      for (const [id, r] of rigs) {
        const rep = manifest.bodies.find((b: any) => b.id === id).representations[detail];
        expect(r.kind, id).toBe('cast');
        expect(r.stats().drawCalls, id).toBe(1);
        expect(triangles(r), id).toBe(rep.triangles);
        r.setAnim('idle');
        step(r, 0.5);
        const feet = Math.min(wy(r, 'foot_L'), wy(r, 'foot_R'));
        expect(feet, `${id} feet`).toBeGreaterThan(-0.05);
        expect(feet, `${id} feet`).toBeLessThan(0.25);
        const top = r.headTop(new THREE.Vector3()).y;
        expect(Math.abs(top - rep.headTop), `${id} headTop ${top}`).toBeLessThan(0.2);
        expect(top, `${id} fits a door`).toBeLessThan(DIM.DOOR_HEIGHT);
        r.setAnim('sit');
        step(r, 0.6);
        expect(wy(r, 'pelvis'), `${id} seat`).toBeCloseTo(DIM.SEAT_HEIGHT + (rep.seatPelvisOffset?.[1] ?? 0), 2);
        for (const a of ANIM_STATES) {
          r.setAnim(a);
          r.update(0.05);
          r.root.updateMatrixWorld(true);
          r.root.traverse((o) => {
            const e = o.matrixWorld.elements;
            for (let i = 0; i < 16; i++) expect(Number.isFinite(e[i]), `${id} ${a} ${o.name}`).toBe(true);
          });
        }
        r.dispose();
      }
      h.f.dispose();
    });
  }

  it('the high file carries more triangles than the low file of the same design', async () => {
    const hi = factory({ detail: 'high' });
    const lo = factory({ detail: 'low' });
    const a = hi.f.create({ ...defaultAppearance(), body: 'fisherman' }, intactLimbs()) as ZombieRigDebug;
    const b = lo.f.create({ ...defaultAppearance(), body: 'fisherman' }, intactLimbs()) as ZombieRigDebug;
    await Promise.all([hi.f.ready, lo.f.ready]);
    await Promise.all([hi.f.castSettled(), lo.f.castSettled()]);
    expect(triangles(a)).toBeGreaterThan(triangles(b) * 2);
    expect(triangles(b)).toBeLessThanOrEqual(9000);
  });

  it('with no detail given the loader takes the high file', async () => {
    const h = factory();
    h.f.create({ ...defaultAppearance(), body: 'waitress' }, intactLimbs());
    await h.f.ready;
    await h.f.castSettled();
    expect(h.urls).toEqual(['/assets/models/characters/premium/waitress.glb']);
  });

  it('a high file that fails to load falls back to the low file, with one warning; the zombie gets the body', async () => {
    const h = factory({ detail: 'high', fail: (u) => u.endsWith('/patient.glb') });
    const r = h.f.create({ ...defaultAppearance(), body: 'patient' }, intactLimbs()) as ZombieRigDebug;
    await h.f.ready;
    await h.f.castSettled();
    expect(h.urls).toEqual(['/assets/models/characters/premium/patient.glb', '/assets/models/characters/premium/patient_low.glb']);
    expect(r.kind).toBe('cast');
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toMatch(/high-detail file of 'patient'/);
    expect(triangles(r)).toBeLessThanOrEqual(9000);
  });

  it('both files failing keeps the classic body, warns, and never retries; a low-only failure does not try the high file', async () => {
    const h = factory({ detail: 'high', fail: (u) => u.includes('/sexton') });
    const r = h.f.create({ ...defaultAppearance(), body: 'sexton' }, intactLimbs()) as ZombieRigDebug;
    await h.f.ready;
    await h.f.castSettled();
    expect(r.kind).toBe('gltf');   // the classic (zombie.glb) rig
    expect(h.urls).toHaveLength(2);
    expect(h.warnings.some((w) => /could not load cast body 'sexton'/.test(w))).toBe(true);
    h.f.create({ ...defaultAppearance(), body: 'sexton' }, intactLimbs());
    await h.f.castSettled();
    expect(h.urls).toHaveLength(2);

    const low = factory({ detail: 'low', fail: (u) => u.endsWith('_low.glb') });
    const q = low.f.create({ ...defaultAppearance(), body: 'lowside' }, intactLimbs()) as ZombieRigDebug;
    await low.f.ready;
    await low.f.castSettled();
    expect(q.kind).toBe('gltf');
    expect(low.urls).toEqual(['/assets/models/characters/premium/lowside_low.glb']);
  });

  it('a missing premium manifest warns once and still loads the conventional files', async () => {
    const h = factory({ detail: 'low', manifest: 'missing' });
    const rigs = (['sexton', 'waitress'] as const).map((id) => h.f.create({ ...defaultAppearance(), body: id }, intactLimbs()) as ZombieRigDebug);
    await h.f.ready;
    await h.f.castSettled();
    for (const r of rigs) expect(r.kind).toBe('cast');
    expect(h.warnings.filter((w) => /manifest\.premium\.json/.test(w))).toHaveLength(1);
  });

  it('a manifest that tries to point a premium body at another file is ignored', async () => {
    const hostile = JSON.parse(JSON.stringify(manifest));
    hostile.bodies[0].representations.low.file = 'models/characters/cast/walker.glb';
    const h = factory({ detail: 'low', manifest: hostile });
    h.f.create({ ...defaultAppearance(), body: hostile.bodies[0].id }, intactLimbs());
    await h.f.ready;
    await h.f.castSettled();
    expect(h.urls).toEqual([`/assets/${premiumGlbPath(hostile.bodies[0].id, 'low')}`]);
  });

  it('a premium body and a cast body live in one factory; the cast kit manifest is fetched separately', async () => {
    const h = factory({ detail: 'low' });
    const a = h.f.create({ ...defaultAppearance(), body: 'fisherman' }, intactLimbs()) as ZombieRigDebug;
    const b = h.f.create({ ...defaultAppearance(), body: 'walker' }, intactLimbs()) as ZombieRigDebug;
    await h.f.ready;
    await h.f.castSettled();
    expect([a.kind, b.kind]).toEqual(['cast', 'cast']);
    expect(h.urls.sort()).toEqual(['/assets/models/characters/cast/walker.glb', '/assets/models/characters/premium/fisherman_low.glb']);
    expect(h.warnings).toEqual([]);
  });
});

describe('the published files exist for every id', () => {
  it('high, low and thumbnail', () => {
    for (const id of PREMIUM_BODY_IDS) {
      for (const f of [premiumGlbPath(id, 'high'), premiumGlbPath(id, 'low'), `ui/premium/${id}.webp`]) {
        expect(existsSync(resolve(ASSETS, f)), f).toBe(true);
      }
    }
  });
});

describe('seated thigh lift (the builder\'s knee lift for long legs, applied by the runtime)', () => {
  const rest = new Map<string, THREE.Quaternion>();
  const info = (lift: number | undefined) => ({
    castRest: rest, zombieRest: rest, zombiePelvis: [0, 0.66, 0] as const, castPelvis: [0, 0.9, 0] as const,
    pelvisScale: 1.28, seatPelvisOffset: [0, 0, 0] as const, lyingOffset: [0, 0, 0] as const, sitThighLift: lift,
  });
  const clip = (name: string) => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('thigh_L.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack('thigh_R.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack('shin_L.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
  const bones = new Set(['thigh_L', 'thigh_R', 'shin_L', 'spine']);
  const angleOf = (c: THREE.AnimationClip, track: string): number => {
    const v = c.tracks.find((t) => t.name === track)!.values;
    return (2 * Math.acos(Math.min(1, Math.abs(v[3]))) * 180) / Math.PI;
  };

  it('raises both thighs by the given angle about X in sit clips only; other bones and other clips are untouched', async () => {
    const { retargetClip } = await import('../../../src/render/characters/cast');
    const sit = retargetClip(clip('sitEat'), info(24), bones);
    expect(angleOf(sit, 'thigh_L.quaternion')).toBeCloseTo(24, 4);
    expect(angleOf(sit, 'thigh_R.quaternion')).toBeCloseTo(24, 4);
    const v = sit.tracks.find((t) => t.name === 'thigh_L.quaternion')!.values;
    expect(v[0]).toBeLessThan(0);                       // qx(-lift): negative X component
    expect(Math.abs(v[1]) + Math.abs(v[2])).toBeCloseTo(0, 6);
    expect(angleOf(sit, 'shin_L.quaternion')).toBeCloseTo(0, 6);
    expect(angleOf(sit, 'spine.quaternion')).toBeCloseTo(0, 6);
    for (const other of ['walk', 'idle', 'sleep', 'cook']) {
      expect(angleOf(retargetClip(clip(other), info(24), bones), 'thigh_L.quaternion')).toBeCloseTo(0, 6);
    }
  });

  it('no lift, zero, negative, NaN and infinite values leave the clip as authored; a huge value is capped at 45', async () => {
    const { retargetClip, SIT_THIGH_LIFT_MAX } = await import('../../../src/render/characters/cast');
    for (const junk of [undefined, 0, -10, NaN, -Infinity]) {
      expect(angleOf(retargetClip(clip('sit'), info(junk), bones), 'thigh_L.quaternion')).toBeCloseTo(0, 6);
    }
    expect(SIT_THIGH_LIFT_MAX).toBe(45);
    expect(angleOf(retargetClip(clip('sit'), info(400), bones), 'thigh_L.quaternion')).toBeCloseTo(45, 4);
    expect(angleOf(retargetClip(clip('sit'), info(Infinity), bones), 'thigh_L.quaternion')).toBeCloseTo(0, 6);
  });

  it('on the real files: seated ankles stay above the floor, and lower without the lift', async () => {
    const stripped = JSON.parse(JSON.stringify(manifest));
    for (const b of stripped.bodies) for (const r of Object.values(b.representations) as any[]) { r.sitThighLift = 0; delete r.sitThighLiftByClip; }
    const ankle = async (m: unknown, id: (typeof PREMIUM_BODY_IDS)[number]): Promise<number> => {
      const h = factory({ detail: 'low', manifest: m });
      const r = h.f.create({ ...defaultAppearance(), body: id }, intactLimbs()) as ZombieRigDebug;
      await h.f.ready;
      await h.f.castSettled();
      r.setAnim('sit');
      step(r, 0.8);
      return Math.min(wy(r, 'foot_L'), wy(r, 'foot_R'));
    };
    for (const id of PREMIUM_BODY_IDS) {
      const lift = manifest.bodies.find((b: any) => b.id === id).representations.low.sitThighLift;
      expect(lift, id).toBeGreaterThan(0);
      const withLift = await ankle(manifest, id);
      const without = await ankle(stripped, id);
      expect(withLift, `${id} ankle with the lift`).toBeGreaterThan(0.02);
      expect(withLift - without, `${id} lift raises the ankle`).toBeGreaterThan(0.03);
    }
  });
});

describe('per-clip seated thigh lift', () => {
  const rest = new Map<string, THREE.Quaternion>();
  const mk = (name: string) => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('thigh_L.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
  const deg = (c: THREE.AnimationClip): number => (2 * Math.acos(Math.min(1, Math.abs(c.tracks[0].values[3]))) * 180) / Math.PI;
  const info = (byClip: unknown) => ({
    castRest: rest, zombieRest: rest, zombiePelvis: [0, 0.66, 0] as const, castPelvis: [0, 0.9, 0] as const,
    pelvisScale: 1.28, seatPelvisOffset: [0, 0, 0] as const, lyingOffset: [0, 0, 0] as const,
    sitThighLift: 20, sitThighLiftByClip: byClip as Record<string, number> | null,
  });

  it('a clip listed in the table uses its own angle (also 0); other sit clips use sitThighLift; non-sit clips none', async () => {
    const { retargetClip } = await import('../../../src/render/characters/cast');
    const table = { sitEat: 12, sitTV: 0, walk: 30 };
    const bones = new Set(['thigh_L']);
    expect(deg(retargetClip(mk('sitEat'), info(table), bones))).toBeCloseTo(12, 4);
    expect(deg(retargetClip(mk('sitTV'), info(table), bones))).toBeCloseTo(0, 6);
    expect(deg(retargetClip(mk('sit'), info(table), bones))).toBeCloseTo(20, 4);
    expect(deg(retargetClip(mk('walk'), info(table), bones))).toBeCloseTo(0, 6);
    expect(deg(retargetClip(mk('sitEat'), info(null), bones))).toBeCloseTo(20, 4);
    // inherited keys are not clips
    expect(deg(retargetClip(mk('sitEat'), info(Object.create({ sitEat: 40 })), bones))).toBeCloseTo(20, 4);
  });

  it('the manifest parser keeps valid pairs only', () => {
    const body = (v: unknown) => ({ bodies: [{ id: 'sexton', height: 1.86, representations: { low: { file: premiumGlbPath('sexton', 'low'), sitThighLift: 25.5, sitThighLiftByClip: v } } }] });
    const parsed = (v: unknown) => parsePremiumManifest(body(v), 'low').get('sexton')!.sitThighLiftByClip;
    expect(parsed({ sit: 25.5, sitEat: 19.5 })).toEqual({ sit: 25.5, sitEat: 19.5 });
    expect(parsed({ sit: 25.5, sitEat: NaN, sitTV: -1, sitRead: 46, 'sit Eat': 3, __proto__x: 4, sitChess: '12', sitTalk: Infinity })).toEqual({ sit: 25.5 });
    for (const junk of [null, undefined, 3, 'x', [], [1, 2], {}, { sit: 'a' }]) expect(parsed(junk)).toBeNull();
  });

  it('every published premium body has an angle for each of the seven sit clips, none above the single value', () => {
    for (const b of manifest.bodies) {
      for (const rep of ['high', 'low']) {
        const r = b.representations[rep];
        expect(Object.keys(r.sitThighLiftByClip).sort()).toEqual(['sit', 'sitChess', 'sitComputer', 'sitEat', 'sitRead', 'sitTV', 'sitTalk']);
        for (const v of Object.values(r.sitThighLiftByClip) as number[]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(r.sitThighLift);
        }
        expect(Math.max(...(Object.values(r.sitThighLiftByClip) as number[]))).toBe(r.sitThighLift);
      }
    }
  });

  it('on the real files: ankles within 3 cm of each other across the sit clips (no dangling in one pose)', async () => {
    const h = factory({ detail: 'low' });
    const rigs = PREMIUM_BODY_IDS.map((id) => [id, h.f.create({ ...defaultAppearance(), body: id }, intactLimbs()) as ZombieRigDebug] as const);
    await h.f.ready;
    await h.f.castSettled();
    for (const [id, r] of rigs) {
      const ys: number[] = [];
      for (const clip of ['sit', 'sitEat', 'sitRead', 'sitTV', 'sitComputer'] as const) {
        r.setAnim(clip);
        step(r, 0.8);
        ys.push(Math.min(wy(r, 'foot_L'), wy(r, 'foot_R')));
      }
      expect(Math.max(...ys) - Math.min(...ys), `${id} ${ys.map((y) => y.toFixed(3))}`).toBeLessThan(0.03);
    }
  });
});
