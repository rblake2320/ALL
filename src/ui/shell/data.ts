/**
 * Shell data: fallback trait/aspiration content (mirrors GDD §8/§12 — ids identical to the sim content) used
 * when `game.sim?.content` is unavailable (Create-a-Zombie runs before a simulation exists), plus colour
 * palettes and constants. Runtime content always wins via `traitList()` / `aspirationList()`.
 */
import type { BubbleIcon, ContentRegistry } from '../../sim/contracts';

export const MAX_MEMBERS = 4;
export const NAME_MAX = 16;
export const HOUSEHOLD_NAME_MAX = 24;
export const SAVE_NAME_MAX = 40;
export const TRAITS_REQUIRED = 3;

/** GDD §6: starting funds per lot (+$500 per member beyond the first). */
export const LOT_FUNDS = { derelict: 2500, starter: 6500, empty: 22000 } as const;
export const EXTRA_MEMBER_FUNDS = 500;

export interface LotInfo {
  id: 'derelict' | 'starter' | 'empty';
  /** From the controller's LotTemplate when available (else null → use i18n copy). */
  name: string | null;
  description: string | null;
  startingFunds: number;
}

/** Resolve lot info, preferring the controller's `lotTemplates`; tolerant of missing/garbage entries. */
export function lotInfo(id: 'derelict' | 'starter' | 'empty', templates: readonly { id: string; name?: string; description?: string; startingFunds?: number }[] | null | undefined): LotInfo {
  const tpl = Array.isArray(templates) ? templates.find((x) => x && x.id === id) : undefined;
  const funds = tpl && typeof tpl.startingFunds === 'number' && Number.isFinite(tpl.startingFunds) && tpl.startingFunds >= 0 ? Math.round(tpl.startingFunds) : (LOT_FUNDS[id] ?? LOT_FUNDS.starter);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { id, name: str(tpl?.name), description: str(tpl?.description), startingFunds: funds };
}

export function startingFunds(lot: 'derelict' | 'starter' | 'empty', members: number, baseFunds?: number): number {
  const base = typeof baseFunds === 'number' && Number.isFinite(baseFunds) ? baseFunds : (LOT_FUNDS[lot] ?? LOT_FUNDS.starter);
  const m = Number.isFinite(members) ? Math.max(1, Math.min(MAX_MEMBERS, Math.floor(members))) : 1;
  return base + (m - 1) * EXTRA_MEMBER_FUNDS;
}

export interface TraitInfo {
  id: string;
  name: string;
  description: string;
  icon: BubbleIcon;
  conflicts: string[];
  reward: boolean;
}

export interface AspirationInfo {
  id: string;
  name: string;
  description: string;
  icon: BubbleIcon;
  milestones: { id: string; label: string; points: number }[];
}

export const FALLBACK_TRAITS: TraitInfo[] = [
  { id: 'gourmand', name: 'Gourmand', icon: 'plate', reward: false, conflicts: [], description: 'Brains are a lifestyle. Gets hungry faster, cooks with flair and has more fun at every meal.' },
  { id: 'neatFreak', name: 'Neat Freak', icon: 'soap', reward: false, conflicts: ['slob'], description: 'Can’t stand dirty dishes or flies and adores cleaning. Odor Control fades a little faster.' },
  { id: 'slob', name: 'Slob', icon: 'flies', reward: false, conflicts: ['neatFreak'], description: 'Never tidies up and never minds mess or stench. Somehow smells a bit less.' },
  { id: 'nightOwl', name: 'Night Owl', icon: 'zzz', reward: false, conflicts: [], description: 'Comes alive after dark: happier and less tired at night, grumpier by day.' },
  { id: 'socialButterfly', name: 'Social Butterfly', icon: 'chat', reward: false, conflicts: ['loner'], description: 'Craves company and loves parties. Chats go better, but loneliness bites sooner.' },
  { id: 'loner', name: 'Loner', icon: 'house', reward: false, conflicts: ['socialButterfly'], description: 'Needs far less company and dislikes crowds and parties.' },
  { id: 'hopelessRomantic', name: 'Hopeless Romantic', icon: 'heart', reward: false, conflicts: [], description: 'Falls hard and fast: romance grows 50% quicker. Pines when single too long.' },
  { id: 'grumpy', name: 'Grumpy', icon: 'angry', reward: false, conflicts: ['cheerful'], description: 'Permanently a little miserable. Mean remarks land better; jokes do not.' },
  { id: 'cheerful', name: 'Cheerful', icon: 'happy', reward: false, conflicts: ['grumpy', 'hothead'], description: 'Unreasonably upbeat for a corpse. Better base mood and better jokes.' },
  { id: 'clumsy', name: 'Clumsy', icon: 'limb', reward: false, conflicts: [], description: 'Limbs fall off twice as often and stoves catch fire more. Finds it hilarious.' },
  { id: 'vain', name: 'Vain', icon: 'mirror', reward: false, conflicts: [], description: 'Loves mirrors and looking fresh. Mood soars when well preserved and sinks when rotting.' },
  { id: 'lazy', name: 'Lazy', icon: 'tv', reward: false, conflicts: ['ambitious'], description: 'Tires quickly, naps gladly and gets extra fun from TV. Learns fitness slowly.' },
  { id: 'ambitious', name: 'Ambitious', icon: 'work', reward: false, conflicts: ['lazy'], description: 'Driven to the top: better job performance and faster skill gains.' },
  { id: 'bookworm', name: 'Bookworm', icon: 'book', reward: false, conflicts: [], description: 'Reading is twice the fun, and logic comes easily.' },
  { id: 'partyAnimal', name: 'Party Animal', icon: 'party', reward: false, conflicts: [], description: 'Gets bored faster, dances harder and makes every party better.' },
  { id: 'artistic', name: 'Artistic', icon: 'paint', reward: false, conflicts: [], description: 'Paints with feeling: faster creativity and more fun at the easel.' },
  { id: 'hothead', name: 'Hothead', icon: 'fire', reward: false, conflicts: ['cheerful'], description: 'Quick to argue, and furious moods last twice as long.' },
  { id: 'squeamish', name: 'Squeamish', icon: 'disgusted', reward: false, conflicts: [], description: 'A zombie who is grossed out by limbs and embalming. Ironic, really.' },
  { id: 'wellPreserved', name: 'Well Preserved', icon: 'ice', reward: true, conflicts: [], description: 'Freshness fades 30% slower.' },
  { id: 'ironStitches', name: 'Iron Stitches', icon: 'stitch', reward: true, conflicts: [], description: 'Limbs never fall off.' },
  { id: 'castIronStomach', name: 'Cast-Iron Stomach', icon: 'pizza', reward: true, conflicts: [], description: 'Immune to food poisoning.' },
  { id: 'silverTongue', name: 'Silver Tongue', icon: 'sparkle', reward: true, conflicts: [], description: 'Social interactions succeed 15% more often.' },
  { id: 'deepSleeper', name: 'Deep Sleeper', icon: 'coffin', reward: true, conflicts: [], description: 'Rest restores 30% faster.' },
];

export const FALLBACK_ASPIRATIONS: AspirationInfo[] = [
  {
    id: 'tycoon',
    name: 'Undead Tycoon',
    icon: 'money',
    description: 'Money can’t buy life, but it can buy a very nice coffin.',
    milestones: [
      { id: 'funds5k', label: 'Have $5,000', points: 250 },
      { id: 'career3', label: 'Reach career level 3', points: 400 },
      { id: 'funds25k', label: 'Have $25,000', points: 600 },
      { id: 'career5', label: 'Reach career level 5', points: 1000 },
    ],
  },
  {
    id: 'afterparty',
    name: 'Life of the Afterparty',
    icon: 'party',
    description: 'Become the most popular corpse in Wormwood Heights.',
    milestones: [
      { id: 'friends3', label: 'Make 3 friends', points: 250 },
      { id: 'party', label: 'Throw a party', points: 350 },
      { id: 'friends6', label: 'Make 6 friends', points: 550 },
      { id: 'legendary', label: 'Throw a Legendary Party', points: 900 },
    ],
  },
  {
    id: 'eternalRomance',
    name: 'Eternal Romance',
    icon: 'ring',
    description: 'Till death do us part? Been there. Find a love that outlasts the grave.',
    milestones: [
      { id: 'kiss', label: 'Share a first kiss', points: 250 },
      { id: 'partners', label: 'Become partners', points: 400 },
      { id: 'married', label: 'Get married', points: 600 },
      { id: 'romance100', label: 'Reach romance 100', points: 900 },
    ],
  },
  {
    id: 'masterPreserver',
    name: 'Master Preserver',
    icon: 'embalm',
    description: 'Perfect the science of staying fresh — for yourself and everyone you love.',
    milestones: [
      { id: 'mortuary3', label: 'Reach Mortuary Science 3', points: 250 },
      { id: 'embalmOther', label: 'Embalm another zombie', points: 400 },
      { id: 'mortuary7', label: 'Reach Mortuary Science 7', points: 600 },
      { id: 'fresh7', label: 'Keep household Freshness ≥ 70 for 7 days', points: 1000 },
    ],
  },
  {
    id: 'renaissanceCorpse',
    name: 'Renaissance Corpse',
    icon: 'paint',
    description: 'Master the arts and sciences. Death is no excuse to stop learning.',
    milestones: [
      { id: 'creativity3', label: 'Reach Creativity 3', points: 250 },
      { id: 'sellPainting', label: 'Sell a painting', points: 350 },
      { id: 'creativity7', label: 'Reach Creativity 7', points: 600 },
      { id: 'threeSkills', label: 'Get three skills to level 5', points: 1000 },
    ],
  },
];

/** Selectable traits (non-reward), preferring live content. */
export function traitList(content: ContentRegistry | null | undefined): TraitInfo[] {
  const defs = content?.traits ? Object.values(content.traits) : [];
  if (defs.length > 0) {
    return defs
      .filter((d) => d && typeof d.id === 'string' && !d.reward)
      .map((d) => ({
        id: d.id,
        name: d.name || d.id,
        description: d.description || '',
        icon: d.icon,
        conflicts: Array.isArray(d.conflicts) ? d.conflicts.filter((c) => typeof c === 'string') : [],
        reward: false,
      }));
  }
  return FALLBACK_TRAITS.filter((tr) => !tr.reward);
}

export function aspirationList(content: ContentRegistry | null | undefined): AspirationInfo[] {
  const defs = content?.aspirations ? Object.values(content.aspirations) : [];
  if (defs.length > 0) {
    return defs
      .filter((d) => d && typeof d.id === 'string')
      .map((d) => ({
        id: d.id,
        name: d.name || d.id,
        description: d.description || '',
        icon: d.icon,
        milestones: Array.isArray(d.milestones)
          ? d.milestones
              .filter((m) => m && typeof m === 'object' && typeof m.id === 'string')
              .map((m) => ({ id: m.id, label: typeof m.label === 'string' ? m.label : m.id, points: Number.isFinite(m.points) ? m.points : 0 }))
          : [],
      }));
  }
  return FALLBACK_ASPIRATIONS;
}

/** Swatch palettes (names via i18n key `color.<id>`). */
export const HAIR_COLORS = [
  { id: 'pitch', value: '#1f1a1a' },
  { id: 'soot', value: '#3b2f2f' },
  { id: 'chestnut', value: '#5a3a26' },
  { id: 'auburn', value: '#8a4a2b' },
  { id: 'ginger', value: '#b06a35' },
  { id: 'straw', value: '#c9b27a' },
  { id: 'ash', value: '#d8d0c0' },
  { id: 'grey', value: '#8f8f8a' },
  { id: 'wine', value: '#6e2a35' },
  { id: 'plum', value: '#5b3f6e' },
  { id: 'moss', value: '#4f6b45' },
  { id: 'midnight', value: '#2c3e5a' },
] as const;

export const EYE_COLORS = [
  { id: 'sulphur', value: '#f2e86d' },
  { id: 'toxic', value: '#9fe870' },
  { id: 'cryo', value: '#7fe0ff' },
  { id: 'ember', value: '#ff9a4a' },
  { id: 'milky', value: '#e8e0c8' },
  { id: 'bloodshot', value: '#d0606f' },
  { id: 'lilac', value: '#b48cff' },
  { id: 'teal', value: '#55d6be' },
] as const;

export const CLOTHES_COLORS = [
  { id: 'plum', value: '#6b4f8a' },
  { id: 'slate', value: '#3a3f55' },
  { id: 'wine', value: '#6e2a35' },
  { id: 'moss', value: '#3f5a4a' },
  { id: 'rust', value: '#a5532f' },
  { id: 'mustard', value: '#b8963e' },
  { id: 'soot', value: '#2a2420' },
  { id: 'parchment', value: '#d9cfb8' },
  { id: 'mortuary', value: '#4a6a7a' },
  { id: 'olive', value: '#6b6a3a' },
  { id: 'mauve', value: '#8a3a5c' },
  { id: 'midnight', value: '#1f2a3a' },
] as const;

export const SHOE_COLORS = [
  { id: 'soot', value: '#2a2420' },
  { id: 'leather', value: '#4a3326' },
  { id: 'tan', value: '#7a5a3e' },
  { id: 'ebony', value: '#1f1f24' },
  { id: 'wine', value: '#6e2a35' },
  { id: 'slate', value: '#3a3f55' },
] as const;

/** Number of loading tips (keys loading.tip.1..N in en.ts). */
export const LOADING_TIP_COUNT = 14;
