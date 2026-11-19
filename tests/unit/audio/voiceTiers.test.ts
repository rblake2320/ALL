import { describe, expect, it } from 'vitest';
import { VOICE_TIERS, VOICE_TIER_IDS, nextVoiceTier, voiceTierFor } from '../../../src/shared/voiceTiers';

describe('the voice tiers (D-087, data only)', () => {
  it('start with Groanish at rank 1, and every tier unlocks at a strictly higher rank than the one before', () => {
    expect(VOICE_TIERS.map((t) => t.id)).toEqual([...VOICE_TIER_IDS]);
    expect(VOICE_TIERS[0]).toMatchObject({ id: 'groan', name: 'Groanish', unlockRank: 1 });
    for (let i = 1; i < VOICE_TIERS.length; i++) expect(VOICE_TIERS[i].unlockRank, VOICE_TIERS[i].id).toBeGreaterThan(VOICE_TIERS[i - 1].unlockRank);
  });

  it('are exactly the owner decision: mumbled words at 15, short phrases at 25, normal voice at 40', () => {
    expect(VOICE_TIERS.map((t) => [t.id, t.unlockRank])).toEqual([['groan', 1], ['mumble', 15], ['phrases', 25], ['normal', 40]]);
  });

  it('gives the right voice at every boundary and beyond', () => {
    const at = (r: number) => voiceTierFor(r).id;
    expect([1, 14, 15, 24, 25, 39, 40, 41, 100, 1000].map(at)).toEqual(['groan', 'groan', 'mumble', 'mumble', 'phrases', 'phrases', 'normal', 'normal', 'normal', 'normal']);
    expect(at(14.9)).toBe('groan');
    expect(at(15.2)).toBe('mumble');
  });

  it('NEGATIVE CONTROL: an unknown or broken rank never unlocks a better voice (fail closed)', () => {
    for (const bad of [undefined, null, NaN, -5, 0, Infinity, '40', {}, [], true]) expect(voiceTierFor(bad).id, String(bad)).toBe(bad === Infinity ? 'groan' : 'groan');
  });

  it('says what unlocks next and how far away it is, and nothing at the top', () => {
    expect(nextVoiceTier(1)).toMatchObject({ tier: { id: 'mumble' }, ranksToGo: 14 });
    expect(nextVoiceTier(15)).toMatchObject({ tier: { id: 'phrases' }, ranksToGo: 10 });
    expect(nextVoiceTier(39)).toMatchObject({ tier: { id: 'normal' }, ranksToGo: 1 });
    expect(nextVoiceTier(40)).toBeNull();
    expect(nextVoiceTier(undefined)).toMatchObject({ tier: { id: 'mumble' } });
  });
});
