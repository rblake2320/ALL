/** Ready-made playable characters using the existing cast kit; no new save fields or premium grants. */
import { defaultAppearance } from '../shared/appearance';
import type { CastKitBodyId } from '../shared/cast';
import type { NewMemberSpec } from '../sim/contracts';

interface StarterZombie {
  readonly id: string;
  readonly body: CastKitBodyId;
  readonly traits: readonly [string, string, string];
  readonly aspiration: string;
  readonly voicePitch: number;
}

export const STARTER_ZOMBIES: readonly StarterZombie[] = [
  { id: 'arrival', body: 'walker', traits: ['cheerful', 'bookworm', 'neatFreak'], aspiration: 'masterPreserver', voicePitch: 0.45 },
  { id: 'fixer', body: 'hardhat', traits: ['ambitious', 'neatFreak', 'loner'], aspiration: 'renaissanceCorpse', voicePitch: 0.3 },
  { id: 'caretaker', body: 'nurse', traits: ['neatFreak', 'bookworm', 'cheerful'], aspiration: 'masterPreserver', voicePitch: 0.65 },
  { id: 'reader', body: 'granny', traits: ['bookworm', 'nightOwl', 'loner'], aspiration: 'renaissanceCorpse', voicePitch: 0.55 },
  { id: 'goGetter', body: 'business', traits: ['ambitious', 'vain', 'nightOwl'], aspiration: 'tycoon', voicePitch: 0.35 },
  { id: 'partyStarter', body: 'clown', traits: ['socialButterfly', 'partyAnimal', 'cheerful'], aspiration: 'afterparty', voicePitch: 0.8 },
];

export type StarterZombiePatch = Pick<NewMemberSpec, 'appearance' | 'traits' | 'aspiration'>;

/** A fresh patch for the normal CAZ update path. Names and the household are deliberately kept. */
export function starterZombiePatch(id: unknown): StarterZombiePatch | null {
  if (typeof id !== 'string') return null;
  const preset = STARTER_ZOMBIES.find((p) => p.id === id);
  if (!preset) return null;
  return {
    appearance: { ...defaultAppearance(), body: preset.body, voicePitch: preset.voicePitch },
    traits: [...preset.traits],
    aspiration: preset.aspiration,
  };
}
