/**
 * How the zombie voice grows (D-087): DATA ONLY. The household's voice starts as Groanish and gets more of a voice as the
 * player's Afterlife Rank rises (docs/DESIGN_PROGRESSION.md section 1): mumbled words at rank 15, short phrases at 25 and the
 * normal spoken voice at 40 (about 30 days of regular play by that document's pacing targets). No audio and no rank system
 * exist behind this yet: the voice code reads `voiceTierFor(rank)` when they do. All voice audio stays synthesized.
 */
export const VOICE_TIER_IDS = ['groan', 'mumble', 'phrases', 'normal'] as const;
export type VoiceTierId = (typeof VOICE_TIER_IDS)[number];

export interface VoiceTier {
  id: VoiceTierId;
  name: string;
  /** Afterlife Rank at which this voice unlocks. */
  unlockRank: number;
}

/** In order; every tier unlocks at a strictly higher rank than the one before (tests/unit/audio/voiceTiers.test.ts). */
export const VOICE_TIERS: readonly VoiceTier[] = Object.freeze([
  { id: 'groan', name: 'Groanish', unlockRank: 1 },
  { id: 'mumble', name: 'Mumbled words', unlockRank: 15 },
  { id: 'phrases', name: 'Short phrases', unlockRank: 25 },
  { id: 'normal', name: 'Normal voice', unlockRank: 40 },
]);

/** The best voice a player of this rank has. An unknown, missing or broken rank gets the start voice (fail closed). */
export function voiceTierFor(rank: unknown): VoiceTier {
  const r = typeof rank === 'number' && Number.isFinite(rank) ? Math.floor(rank) : 0;
  let best = VOICE_TIERS[0];
  for (const t of VOICE_TIERS) if (r >= t.unlockRank) best = t;
  return best;
}

/** The next voice to unlock and how many ranks away it is, or null at the top. */
export function nextVoiceTier(rank: unknown): { tier: VoiceTier; ranksToGo: number } | null {
  const have = voiceTierFor(rank);
  const r = typeof rank === 'number' && Number.isFinite(rank) ? Math.floor(rank) : 0;
  const next = VOICE_TIERS.find((t) => t.unlockRank > Math.max(r, have.unlockRank));
  return next ? { tier: next, ranksToGo: next.unlockRank - Math.max(1, r) } : null;
}
