/**
 * Create-a-Zombie state: pure, immutable operations + validation.
 *
 * Patches coming from the UI are untrusted: names are length-capped (validation reports the precise rule),
 * appearance fields are validated one by one (an invalid field keeps its previous value), trait lists are
 * de-duplicated and stripped of non-string entries. Nothing is trimmed while typing (that would make spaces
 * impossible to type); trimming happens in `finalizeCaz` when the game starts.
 */
import type { CazState } from './contracts';
import type { NewGameOptions, NewMemberSpec } from '../sim/contracts';
import {
  ACCESSORIES,
  BOTTOM_STYLES,
  EYE_STYLES,
  HAIR_STYLES,
  SKIN_TONES,
  TOP_STYLES,
  type ZombieAppearance,
} from '../shared/appearance';
import { isCastBodyId } from '../shared/cast';
import { readOwnData } from './settings';
import { traitsConflict, type CazCatalog } from './gddCatalog';
import { NAME_MAX, nameKey, nameLength, nameProblem } from './names';

export { NAME_MAX, nameLength, nameProblem };

export const CAZ_MIN_MEMBERS = 1;
export const CAZ_MAX_MEMBERS = 4;
/** Hard cap applied while typing (validation still reports anything over NAME_MAX). */
export const NAME_INPUT_CAP = 64;
export const TRAITS_PER_ZOMBIE = 3;
/** AgentState.voiceSeed range the engine accepts (src/sim/engine/world.ts folds anything else into it). */
export const VOICE_SEED_MAX = 2147483646;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function capName(s: string): string {
  const cps = Array.from(s);
  return cps.length > NAME_INPUT_CAP ? cps.slice(0, NAME_INPUT_CAP).join('') : s;
}

/** A voice seed the UI may set: a non-negative integer within the engine's range; anything else is junk. */
export function isVoiceSeed(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= VOICE_SEED_MAX;
}

// ───────────────────────────── appearance ─────────────────────────────

function unit(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function color(v: unknown): string | undefined {
  return typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : undefined;
}

/** Field-by-field validated merge of an untrusted appearance over `base`. */
export function sanitizeAppearance(raw: unknown, base: ZombieAppearance): ZombieAppearance {
  const get = (k: keyof ZombieAppearance): unknown => {
    const r = readOwnData(raw, k);
    return r.ok ? r.value : undefined;
  };
  const skin = get('skinTone');
  const out: ZombieAppearance = {
    height: unit(get('height')) ?? base.height,
    build: unit(get('build')) ?? base.build,
    skinTone:
      typeof skin === 'number' && Number.isInteger(skin) && skin >= 0 && skin < SKIN_TONES.length ? skin : base.skinTone,
    hairStyle: oneOf(get('hairStyle'), HAIR_STYLES) ?? base.hairStyle,
    hairColor: color(get('hairColor')) ?? base.hairColor,
    topStyle: oneOf(get('topStyle'), TOP_STYLES) ?? base.topStyle,
    topColor: color(get('topColor')) ?? base.topColor,
    bottomStyle: oneOf(get('bottomStyle'), BOTTOM_STYLES) ?? base.bottomStyle,
    bottomColor: color(get('bottomColor')) ?? base.bottomColor,
    shoeColor: color(get('shoeColor')) ?? base.shoeColor,
    eyeStyle: oneOf(get('eyeStyle'), EYE_STYLES) ?? base.eyeStyle,
    eyeColor: color(get('eyeColor')) ?? base.eyeColor,
    accessory: oneOf(get('accessory'), ACCESSORIES) ?? base.accessory,
    stitches: typeof get('stitches') === 'boolean' ? (get('stitches') as boolean) : base.stitches,
    voicePitch: unit(get('voicePitch')) ?? base.voicePitch,
  };
  // Cast body (shared/cast.ts): a known id selects it, 'classic' clears it, anything else keeps the base's choice.
  // The key is only ever present with a cast id (never 'classic'/undefined), and last, so classic appearances
  // serialise exactly as they did before cast bodies existed.
  const body = get('body');
  const nextBody = isCastBodyId(body) ? body : body === 'classic' ? undefined : isCastBodyId(base.body) ? base.body : undefined;
  if (nextBody) out.body = nextBody;
  return out;
}

/** Strict check used by tests and by validation of randomly generated members. */
export function appearanceProblems(a: ZombieAppearance): string[] {
  const p: string[] = [];
  if (unit(a.height) !== a.height) p.push('height');
  if (unit(a.build) !== a.build) p.push('build');
  if (!(Number.isInteger(a.skinTone) && a.skinTone >= 0 && a.skinTone < SKIN_TONES.length)) p.push('skinTone');
  if (!oneOf(a.hairStyle, HAIR_STYLES)) p.push('hairStyle');
  if (!oneOf(a.topStyle, TOP_STYLES)) p.push('topStyle');
  if (!oneOf(a.bottomStyle, BOTTOM_STYLES)) p.push('bottomStyle');
  if (!oneOf(a.eyeStyle, EYE_STYLES)) p.push('eyeStyle');
  if (!oneOf(a.accessory, ACCESSORIES)) p.push('accessory');
  for (const k of ['hairColor', 'topColor', 'bottomColor', 'shoeColor', 'eyeColor'] as const) if (!color(a[k])) p.push(k);
  if (typeof a.stitches !== 'boolean') p.push('stitches');
  if (unit(a.voicePitch) !== a.voicePitch) p.push('voicePitch');
  if (a.body !== undefined && a.body !== 'classic' && !isCastBodyId(a.body)) p.push('body');
  return p;
}

// ───────────────────────────── member / state ops ─────────────────────────────

function cloneMember(m: NewMemberSpec): NewMemberSpec {
  return { ...m, appearance: { ...m.appearance }, traits: m.traits.slice() };
}

export function cloneCaz(s: CazState): CazState {
  return { ...s, members: s.members.map(cloneMember) };
}

function sanitizeTraits(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const t of v) if (typeof t === 'string' && t.length > 0 && t.length <= 64 && !out.includes(t)) out.push(t);
  return out.slice(0, 8);
}

/** Validated merge of an untrusted member patch. Unknown/invalid fields are ignored. */
export function sanitizeMemberPatch(current: NewMemberSpec, patch: unknown): NewMemberSpec {
  const next = cloneMember(current);
  const first = readOwnData(patch, 'firstName');
  if (first.ok && typeof first.value === 'string') next.firstName = capName(first.value);
  const last = readOwnData(patch, 'lastName');
  if (last.ok && typeof last.value === 'string') next.lastName = capName(last.value);
  const app = readOwnData(patch, 'appearance');
  if (app.ok) next.appearance = sanitizeAppearance(app.value, current.appearance);
  const traits = readOwnData(patch, 'traits');
  if (traits.ok) {
    const t = sanitizeTraits(traits.value);
    if (t) next.traits = t;
  }
  const asp = readOwnData(patch, 'aspiration');
  if (asp.ok && (asp.value === null || (typeof asp.value === 'string' && asp.value.length <= 64))) {
    next.aspiration = asp.value as string | null;
  }
  // Contract #17: the seed the CAZ voice preview used must reach createNewWorld (in-game voice = preview voice).
  const vs = readOwnData(patch, 'voiceSeed');
  if (vs.ok && isVoiceSeed(vs.value)) next.voiceSeed = vs.value;
  return next;
}

function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  if (!Number.isInteger(i) || i < 0) return 0;
  return Math.min(i, len - 1);
}

/** Top-level patch (householdName, activeIndex, lotTemplate, difficulty; members are replaced validated). */
export function patchCaz(state: CazState, patch: unknown, catalog: CazCatalog): CazState {
  const next = cloneCaz(state);
  const hn = readOwnData(patch, 'householdName');
  if (hn.ok && typeof hn.value === 'string') next.householdName = capName(hn.value);
  const lot = readOwnData(patch, 'lotTemplate');
  if (lot.ok && typeof lot.value === 'string' && catalog.lotTemplateIds.includes(lot.value)) {
    next.lotTemplate = lot.value as NewGameOptions['lotTemplate'];
  }
  const diff = readOwnData(patch, 'difficulty');
  if (diff.ok && typeof diff.value === 'string' && catalog.difficulties.includes(diff.value)) {
    next.difficulty = diff.value as NewGameOptions['difficulty'];
  }
  const members = readOwnData(patch, 'members');
  if (members.ok && Array.isArray(members.value) && members.value.length >= CAZ_MIN_MEMBERS) {
    const list = members.value.slice(0, CAZ_MAX_MEMBERS);
    const base = next.members;
    next.members = list.map((m, i) => sanitizeMemberPatch(base[i] ?? base[base.length - 1], m));
  }
  const ai = readOwnData(patch, 'activeIndex');
  if (ai.ok && typeof ai.value === 'number') next.activeIndex = clampIndex(ai.value, next.members.length);
  next.activeIndex = clampIndex(next.activeIndex, next.members.length);
  return next;
}

export function updateMember(state: CazState, index: number, patch: unknown): CazState {
  if (!Number.isInteger(index) || index < 0 || index >= state.members.length) return state;
  const next = cloneCaz(state);
  next.members[index] = sanitizeMemberPatch(state.members[index], patch);
  return next;
}

export function addMember(state: CazState, member: NewMemberSpec): CazState {
  if (state.members.length >= CAZ_MAX_MEMBERS) return state;
  const next = cloneCaz(state);
  next.members.push(cloneMember(member));
  next.activeIndex = next.members.length - 1;
  return next;
}

export function removeMember(state: CazState, index: number): CazState {
  if (state.members.length <= CAZ_MIN_MEMBERS) return state;
  if (!Number.isInteger(index) || index < 0 || index >= state.members.length) return state;
  const next = cloneCaz(state);
  next.members.splice(index, 1);
  if (next.activeIndex > index) next.activeIndex -= 1;
  next.activeIndex = clampIndex(next.activeIndex, next.members.length);
  return next;
}

export function replaceMember(state: CazState, index: number, member: NewMemberSpec): CazState {
  if (!Number.isInteger(index) || index < 0 || index >= state.members.length) return state;
  const next = cloneCaz(state);
  next.members[index] = cloneMember(member);
  return next;
}

// ───────────────────────────── validation ─────────────────────────────

function label(m: NewMemberSpec, i: number): string {
  return nameProblem(m.firstName) === null ? m.firstName.trim() : `Zombie ${i + 1}`;
}

function traitName(catalog: CazCatalog, id: string): string {
  return catalog.traits[id]?.name ?? id;
}

/** Field union of GameController.validateCazDetailed (contract decision #19). */
export type CazField = 'household' | 'householdName' | 'firstName' | 'lastName' | 'traits' | 'aspiration' | 'appearance';

/** A validation problem mapped to a member (null = household-level) and the field to show it next to. */
export interface CazIssue {
  memberIndex: number | null;
  field: CazField;
  message: string;
}

/**
 * Structured problems; empty = ready to start. Household-level problems that have no input of their own
 * (lot, difficulty, member count) use field 'household'; a corrupt appearance uses 'appearance' (contract #19).
 */
export function cazIssues(state: CazState | null, catalog: CazCatalog): CazIssue[] {
  const issues: CazIssue[] = [];
  const add = (memberIndex: number | null, field: CazField, message: string): void => {
    issues.push({ memberIndex, field, message });
  };
  if (!state) {
    // No CAZ state at all: a household-level problem with no input of its own (contract #19/#22 → 'household').
    add(null, 'household', 'Create a household first.');
    return issues;
  }
  const hp = nameProblem(state.householdName);
  if (hp === 'control') add(null, 'householdName', "The household name can't contain control characters.");
  else if (hp !== null) add(null, 'householdName', `Give your household a name (1–${NAME_MAX} characters).`);
  if (!catalog.lotTemplateIds.includes(state.lotTemplate)) add(null, 'household', 'Choose a lot to move into.');
  if (!catalog.difficulties.includes(state.difficulty)) add(null, 'household', 'Choose a difficulty.');
  const members = Array.isArray(state.members) ? state.members : [];
  if (members.length < CAZ_MIN_MEMBERS) add(null, 'household', 'Add at least one zombie.');
  if (members.length > CAZ_MAX_MEMBERS) add(null, 'household', `A household can have at most ${CAZ_MAX_MEMBERS} zombies.`);
  const firstNames = new Map<string, number>();
  members.forEach((m, i) => {
    if (!m || typeof m !== 'object') {
      add(i, 'firstName', `Zombie ${i + 1}: missing data.`);
      return;
    }
    const who = label(m, i);
    const fp = nameProblem(m.firstName);
    if (fp === 'control') add(i, 'firstName', `Zombie ${i + 1}: names can't contain control characters.`);
    else if (fp !== null) add(i, 'firstName', `Zombie ${i + 1}: first name must be 1–${NAME_MAX} characters.`);
    const lp = nameProblem(m.lastName);
    if (lp === 'control') add(i, 'lastName', `${who}: names can't contain control characters.`);
    else if (lp !== null) add(i, 'lastName', `${who}: last name must be 1–${NAME_MAX} characters.`);
    if (fp === null) {
      // Look-alikes collide too (NFC vs NFD, full-width letters, zero-width padding): see names.ts nameKey().
      const key = nameKey(m.firstName.trim());
      if (firstNames.has(key)) add(i, 'firstName', `Two zombies can't share the first name "${m.firstName.trim()}".`);
      else firstNames.set(key, i);
    }
    const traits = Array.isArray(m.traits) ? m.traits : [];
    if (traits.length !== TRAITS_PER_ZOMBIE) add(i, 'traits', `${who}: pick exactly ${TRAITS_PER_ZOMBIE} traits (${traits.length} chosen).`);
    const seen = new Set<string>();
    for (const t of traits) {
      if (seen.has(t)) {
        add(i, 'traits', `${who}: the same trait is chosen twice.`);
        continue;
      }
      seen.add(t);
      const def = catalog.traits[t];
      if (!def) add(i, 'traits', `${who}: "${t}" isn't a known trait.`);
      else if (def.reward) add(i, 'traits', `${who}: ${def.name} is a reward trait — earn it with aspiration points.`);
    }
    const uniq = Array.from(seen);
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) {
        if (traitsConflict(catalog, uniq[a], uniq[b])) {
          add(i, 'traits', `${who}: ${traitName(catalog, uniq[a])} and ${traitName(catalog, uniq[b])} can't be combined.`);
        }
      }
    }
    if (m.aspiration === null || m.aspiration === undefined || m.aspiration === '') add(i, 'aspiration', `${who}: choose an aspiration.`);
    else if (!catalog.aspirations[m.aspiration]) add(i, 'aspiration', `${who}: "${m.aspiration}" isn't a known aspiration.`);
    const ap = m.appearance ? appearanceProblems(m.appearance) : ['appearance'];
    if (ap.length > 0) add(i, 'appearance', `${who}: invalid appearance (${ap.join(', ')}).`);
  });
  return issues;
}

/** Player-facing problems; empty = ready to start. */
export function validateCazState(state: CazState | null, catalog: CazCatalog): string[] {
  return cazIssues(state, catalog).map((i) => i.message);
}

/** Trimmed, copy-safe options for createNewWorld. Call only after validateCazState returned []. */
export function finalizeCaz(state: CazState, seed: number): NewGameOptions {
  return {
    seed: seed >>> 0,
    householdName: state.householdName.trim(),
    members: state.members.map((m) => {
      const spec: NewMemberSpec = {
        firstName: m.firstName.trim(),
        lastName: m.lastName.trim(),
        appearance: { ...m.appearance },
        traits: m.traits.slice(),
        aspiration: m.aspiration,
      };
      if (isVoiceSeed(m.voiceSeed)) spec.voiceSeed = m.voiceSeed;
      return spec;
    }),
    lotTemplate: state.lotTemplate,
    difficulty: state.difficulty,
    // W-025 S7: the story start (derelict) is a seeded, validated generated lot. The sandbox "Move-in ready" starter
    // and the empty lot keep their shipped canonical layouts (variation off).
    ...(state.lotTemplate === 'derelict' ? { startVariation: true } : {}),
  };
}
