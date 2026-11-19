import { describe, expect, it } from 'vitest';
import type { ContentModule, InteractionDef, SimSystem } from '../../../src/sim/contracts';
import { engineContent } from '../../../src/sim/engine/content';
import { loadContentFrom } from '../../../src/sim/engine/registry';
import { validateContent } from '../../../src/sim/engine/validate';
import { fixtureContent } from '../../../src/sim/engine/fixtures/content';
import { fixtureSystems } from '../../../src/sim/engine/fixtures/systems';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';

const ix = (over: Partial<InteractionDef> & { id: string }): InteractionDef => ({
  label: 'Test',
  icon: 'star',
  targetKind: 'self',
  stage: { target: { kind: 'here' }, duration: 1, anim: 'idle' },
  ...over,
});

function problemsFor(mod: ContentModule, systems: SimSystem[] = fixtureSystems()): string[] {
  return validateContent(loadContentFrom([engineContent, fixtureContent, mod]), systems);
}

describe('loadContentFrom', () => {
  it('merges modules and exposes every engine interaction from the vocabulary', () => {
    const reg = loadContentFrom([engineContent, fixtureContent]);
    for (const id of Object.values(ENGINE_INTERACTIONS)) expect(reg.interactions[id]).toBeDefined();
    expect(reg.objects.fridge_humming.interactions).toContain('fx_snack');
    expect(Object.keys(reg.skills).sort()).toEqual(['charisma', 'cooking', 'creativity', 'fitness', 'logic', 'mortuary']);
    expect(reg.problems).toEqual([]);
  });

  it('normalises stage shorthand to a one-element list and prefers `stages`', () => {
    const reg = loadContentFrom([
      engineContent,
      {
        id: 't',
        interactions: [
          ix({ id: 't_short' }),
          ix({ id: 't_both', stages: [{ target: { kind: 'here' }, duration: 2, anim: 'sit' }, { target: { kind: 'here' }, duration: 3, anim: 'idle' }] }),
          { id: 't_none', label: 'x', icon: 'star', targetKind: 'self' } as InteractionDef,
        ],
      },
    ]);
    expect(reg.stagesOf('t_short')).toHaveLength(1);
    expect(reg.stagesOf('t_short')[0].duration).toBe(1);
    expect(reg.stagesOf('t_both').map((s) => s.duration)).toEqual([2, 3]);
    expect(reg.stagesOf('t_none')).toEqual([]);
    expect(reg.stagesOf('does_not_exist')).toEqual([]);
    // cached and stable
    expect(reg.stagesOf('t_both')).toBe(reg.stagesOf('t_both'));
  });

  it('detects duplicate ids across modules (first wins) and keeps going', () => {
    const a: ContentModule = { id: 'a', interactions: [ix({ id: 'dup', label: 'First' })], moodlets: [{ id: 'm', label: 'M', description: '', mood: 1, durationMin: 1, maxStacks: 1, icon: 'star', kind: 'good' }] };
    const b: ContentModule = { id: 'b', interactions: [ix({ id: 'dup', label: 'Second' })], moodlets: [{ id: 'm', label: 'M2', description: '', mood: 1, durationMin: 1, maxStacks: 1, icon: 'star', kind: 'good' }] };
    const reg = loadContentFrom([engineContent, a, b]);
    expect(reg.interactions.dup.label).toBe('First');
    expect(reg.problems.some((p) => p.includes("duplicate interaction id 'dup'"))).toBe(true);
    expect(reg.problems.some((p) => p.includes("duplicate moodlet id 'm'"))).toBe(true);
  });

  it('reports a skill redefinition as an override instead of a hard duplicate', () => {
    const reg = loadContentFrom([engineContent, { id: 'p', skills: [{ id: 'cooking', name: 'Cook!', description: '', icon: 'plate', xpPerLevel: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }] }]);
    expect(reg.skills.cooking.name).toBe('Cook!');
    expect(reg.problems.join('\n')).toMatch(/overrides the engine default/);
  });

  it('survives malformed modules without throwing', () => {
    const bad = [null, { id: 'x', interactions: 'nope' }, { id: 'y', objects: [{ name: 'no id' }] }, { id: 'x' }] as unknown as ContentModule[];
    const reg = loadContentFrom([engineContent, ...bad]);
    expect(reg.problems.length).toBeGreaterThanOrEqual(3);
    expect(reg.interactions[ENGINE_INTERACTIONS.goHere]).toBeDefined();
  });

  it('never mutates the source modules', () => {
    const before = JSON.stringify(fixtureContent);
    const reg = loadContentFrom([engineContent, fixtureContent]);
    reg.objects.fridge_humming.interactions.push('mutated');
    expect(JSON.stringify(fixtureContent)).toBe(before);
  });

  it('fills ObjectDef defaults for partial defs', () => {
    const spec = PHYSICAL_BY_ID.chair_creaky;
    const reg = loadContentFrom([engineContent, { id: 'o', objects: [{ ...spec, id: 'o_chair' } as never] }]);
    const d = reg.objects.o_chair;
    expect(d.interactions).toEqual([]);
    expect(d.depreciation).toBe(0.15);
    expect(d.sellable).toBe(true);
    expect(d.params).toEqual({});
  });
});

describe('validateContent', () => {
  it('accepts the engine + fixture content with the fixture systems', () => {
    expect(validateContent(loadContentFrom([engineContent, fixtureContent]), fixtureSystems())).toEqual([]);
  });

  it('flags behaviours that only an absent system would provide', () => {
    const out = validateContent(loadContentFrom([engineContent, fixtureContent]), []);
    expect(out.some((p) => p.includes("unknown behavior 'fx_social'"))).toBe(true);
  });

  it('flags unknown effect, requirement, moodlet, anim, slot, recipe and trait-conflict problems', () => {
    const spec = PHYSICAL_BY_ID.fridge_humming;
    const out = problemsFor({
      id: 'bad',
      objects: [{ ...spec, id: 'bad_fridge', interactions: ['bad_ix', 'no_such_ix'], env: 0, depreciation: 0.1, breakChance: 0, sellable: true, params: {} }],
      interactions: [
        ix({
          id: 'bad_ix',
          targetKind: 'object',
          stage: {
            target: { kind: 'target', slots: ['nope_slot'] },
            duration: 2,
            anim: 'moonwalk' as never,
            effectsOnStart: [{ id: 'teleport' }, { id: 'moodlet', params: { id: 'no_moodlet' } }],
          },
          requires: [{ id: 'isVampire' }],
          moodletsOnComplete: [{ id: 'ghost_moodlet' }],
          params: { recipeId: 'no_recipe' },
          behavior: 'no_behaviour',
        }),
      ],
      traits: [
        { id: 'bad_a', name: 'A', description: '', icon: 'star', conflicts: ['bad_b'], reward: false },
        { id: 'bad_b', name: 'B', description: '', icon: 'star', conflicts: [], reward: false },
      ],
    });
    const text = out.join('\n');
    expect(text).toMatch(/object 'bad_fridge': unknown interaction 'no_such_ix'/);
    expect(text).toMatch(/unknown effect 'teleport'/);
    expect(text).toMatch(/unknown moodlet 'no_moodlet'/);
    expect(text).toMatch(/unknown requirement 'isVampire'/);
    expect(text).toMatch(/moodletsOnComplete\[0\]: unknown moodlet 'ghost_moodlet'/);
    expect(text).toMatch(/anim 'moonwalk' is not in ANIM_STATES/);
    expect(text).toMatch(/uses slot 'nope_slot' the object doesn't have/);
    expect(text).toMatch(/unknown recipe 'no_recipe'/);
    expect(text).toMatch(/unknown behavior 'no_behaviour'/);
    expect(text).toMatch(/trait 'bad_a': conflict with 'bad_b' is not symmetric/);
  });

  it('accepts ids registered by systems and rejects colliding registrations', () => {
    const mod: ContentModule = { id: 'm', interactions: [ix({ id: 'm_ix', behavior: 'm_beh', requires: [{ id: 'm_req' }], stage: { target: { kind: 'here' }, duration: 1, anim: 'idle', effectsOnStart: [{ id: 'm_eff' }] } })] };
    const sys: SimSystem = { id: 'm_sys', effects: { m_eff: () => undefined }, requirements: { m_req: () => true }, behaviors: { m_beh: {} } };
    expect(problemsFor(mod, [...fixtureSystems(), sys])).toEqual([]);
    const clash: SimSystem = { id: 'clash', effects: { needs: () => undefined } };
    expect(problemsFor({ id: 'n' }, [...fixtureSystems(), clash]).join('\n')).toMatch(/effect id 'needs' is already registered/);
  });

  it('flags social defs with bad target anims, pair partners that do not exist, and nearestTag with no object', () => {
    const out = problemsFor({
      id: 's',
      interactions: [
        ix({ id: 's_social', targetKind: 'agent', behavior: 'fx_social', social: { baseChance: 1, friendship: [1, 0], social: 1, targetAnim: 'backflip' as never, voice: 'neutral' } }),
        ix({ id: 's_pair', targetKind: 'agent', pair: { partnerInteraction: 'ghost', partnerTarget: 'actor' } }),
        ix({ id: 's_tag', stage: { target: { kind: 'nearestTag', tag: 'unicorn' }, duration: 1, anim: 'idle' } }),
        ix({ id: 's_dur', stage: { target: { kind: 'here' }, duration: Number.NaN, anim: 'idle' } }),
      ],
    }).join('\n');
    expect(out).toMatch(/social.targetAnim 'backflip'/);
    expect(out).toMatch(/pair partner interaction 'ghost' unknown/);
    expect(out).toMatch(/nearestTag 'unicorn' matches no object/);
    expect(out).toMatch(/duration must be a finite number/);
  });
});
