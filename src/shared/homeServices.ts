/**
 * Home services (docs/contract-requests/home-build-system.md §2 and §4 step 3, step 4): the PURE rules and the one save
 * shape behind the Hearth upgrade screen, the Wardrobe (saved builds), the Embalming table (respec gate), the Crypt vault
 * (the W-029 stash) and the Bone gate. No sim, no UI, no clock: every function takes the state it needs and returns a new
 * value, so the sim system, the screens and the tests share one source of truth.
 *
 * Nothing here touches a fight stat (CB-2): the Wardrobe stores and swaps whatever a build is, the Hearth gives life
 * bonuses and build OPTIONS (slots), the vault holds materials.
 *
 * `SavedBuildRecord` is the ONE place the Wardrobe's record type is defined. The zombie build data (feat/agent-build-state,
 * feat/zombie-build-data) plugs its real payload into `payload`; until then it is an opaque, bounded, JSON-safe value.
 */
import { type HearthState, newHearthState } from './homeBuild';

/**
 * Do zombies have builds to save, swap and respec yet? The build data (zombie-build-system.md, BuildRecord) lands from its own
 * branch; until it does, the Wardrobe lists what is stored but cannot save, and the Embalming table cannot respec. Whoever
 * integrates the build data flips this ONE flag and fills the payload (src/ui/hud/dialogs/HomeServiceDialog.tsx).
 */
export const BUILD_DATA_READY = false;

/** The Hearth is a fixed object, not a service (home-build-system.md section 2). */
export const HEARTH_OBJECT = 'hearth_stone';

/** The services that have a screen. The Workbench and the Bone gate are placed furniture only until crafting and the town map land. */
export const HOME_DIALOG_SERVICES = ['hearth', 'wardrobe', 'embalming', 'vault'] as const;
export type HomeDialogService = (typeof HOME_DIALOG_SERVICES)[number];

const DIALOG_SERVICE_OF: Readonly<Record<string, HomeDialogService>> = Object.freeze({
  hearth_stone: 'hearth',
  wardrobe_coffin: 'wardrobe',
  station_embalming: 'embalming',
  vault_crypt: 'vault',
});

/** Which home screen a placed object opens, or null. */
export const dialogServiceOf = (defId: string): HomeDialogService | null => DIALOG_SERVICE_OF[defId] ?? null;

// ───────────────────────────────────────────── Wardrobe: saved builds ─────────────────────────────────────────────

/** Saved builds per zombie (zombie-build-system.md §6b, MAX_SAVED_BUILDS). The Hearth does not raise this. */
export const MAX_SAVED_BUILDS = 4;
/** Game minutes between two swaps of one zombie's build (§6b: builds cannot be swapped mid-fight). */
export const SWAP_COOLDOWN_MIN = 10;
export const BUILD_NAME_MAX = 40;
/** A saved-build id is `b` + a canonical whole number 1..MAX_BUILD_ID (no sign, no leading zero, no exponent): at most 10 characters. */
export const MAX_BUILD_ID = 999_999_999;
export const BUILD_ID_RE = /^b[1-9][0-9]{0,8}$/;
export const isBuildId = (v: unknown): v is string => typeof v === 'string' && BUILD_ID_RE.test(v);
/** The number in a canonical id, or null for anything else. */
export const buildIdNumber = (v: unknown): number | null => (isBuildId(v) ? Number(v.slice(1)) : null);
/** Serialised payload bound, so a save can never be bloated through the Wardrobe. */
export const BUILD_PAYLOAD_MAX_CHARS = 8000;

/** What the Wardrobe stores. `payload` is the zombie's whole build (style, life, fight, gear, role, colours), owned by the build data. */
export interface SavedBuildRecord {
  id: string;
  name: string;
  payload: unknown;
}

export interface WardrobeState {
  slots: readonly SavedBuildRecord[];
  /** The record last swapped in (or saved as current), or null. */
  activeId: string | null;
  /** Tick of the last swap; null = never swapped. */
  lastSwapTick: number | null;
  /** Next record id number (ids are `b<n>`, never reused). */
  nextId: number;
}

/**
 * The seam for the zombie build data: ONE pure function that says whether a payload is a real build (null = fine, else the
 * reason). Registered once by the build data's adapter (it validates BuildRecord). Consulted BEFORE a build is saved and
 * BEFORE a swap commits, so a bad payload can never become the active build with nothing applied. A validator that throws
 * refuses (fail closed). None registered = any bounded JSON is accepted (the build data is not in the game yet).
 */
export type BuildPayloadValidator = (payload: unknown) => string | null;
let payloadValidator: BuildPayloadValidator | null = null;
export function setBuildPayloadValidator(fn: BuildPayloadValidator | null): void {
  payloadValidator = typeof fn === 'function' ? fn : null;
}
function payloadProblem(payload: unknown): string | null {
  if (!payloadValidator) return null;
  try {
    return payloadValidator(payload);
  } catch {
    return 'That build could not be checked.';
  }
}

export const newWardrobe = (): WardrobeState => ({ slots: [], activeId: null, lastSwapTick: null, nextId: 1 });

export type WardrobeRefusal = 'name' | 'payload' | 'full' | 'unknown' | 'cooldown' | 'blocked' | 'already';
export type WardrobeResult = { ok: true; state: WardrobeState; record: SavedBuildRecord } | { ok: false; reason: WardrobeRefusal; message: string };

/** Is the payload JSON-safe and within the bound? Returns the serialised length, or null when it cannot be stored. */
export function payloadSize(payload: unknown): number | null {
  try {
    const s = JSON.stringify(payload);
    return typeof s === 'string' ? s.length : null;
  } catch {
    return null;
  }
}

export function cleanBuildName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim();
  return n.length >= 1 && n.length <= BUILD_NAME_MAX ? n : null;
}

export function saveBuild(w: WardrobeState, name: unknown, payload: unknown): WardrobeResult {
  const n = cleanBuildName(name);
  if (!n) return { ok: false, reason: 'name', message: `A build name is 1 to ${BUILD_NAME_MAX} characters.` };
  const size = payloadSize(payload);
  if (size === null || size > BUILD_PAYLOAD_MAX_CHARS) return { ok: false, reason: 'payload', message: 'That build cannot be saved.' };
  const bad = payloadProblem(payload);
  if (bad) return { ok: false, reason: 'payload', message: bad };
  if (w.slots.length >= MAX_SAVED_BUILDS) return { ok: false, reason: 'full', message: `The Wardrobe holds ${MAX_SAVED_BUILDS} builds per zombie. Delete one first.` };
  // ids are never reused, so there is a last one: say so instead of minting an id the save format would refuse
  if (!Number.isInteger(w.nextId) || w.nextId < 1 || w.nextId > MAX_BUILD_ID) return { ok: false, reason: 'full', message: 'This Wardrobe has used every build number it has.' };
  const record: SavedBuildRecord = { id: `b${w.nextId}`, name: n, payload: JSON.parse(JSON.stringify(payload)) };
  return { ok: true, record, state: { ...w, slots: [...w.slots, record], nextId: w.nextId + 1 } };
}

export function deleteBuild(w: WardrobeState, id: string): WardrobeResult {
  const record = w.slots.find((s) => s.id === id);
  if (!record) return { ok: false, reason: 'unknown', message: 'That build is not in the Wardrobe.' };
  return { ok: true, record, state: { ...w, slots: w.slots.filter((s) => s.id !== id), activeId: w.activeId === id ? null : w.activeId } };
}

/**
 * Swap to a saved build. `blocked` is the reason the zombie cannot change build right now (a fight or an event), or null.
 * The cooldown is in ticks (the sim converts SWAP_COOLDOWN_MIN), counted from the last swap.
 */
export function swapBuild(w: WardrobeState, id: string, tick: number, cooldownTicks: number, blocked: string | null): WardrobeResult {
  const record = w.slots.find((s) => s.id === id);
  if (!record) return { ok: false, reason: 'unknown', message: 'That build is not in the Wardrobe.' };
  if (blocked) return { ok: false, reason: 'blocked', message: blocked };
  if (w.activeId === id) return { ok: false, reason: 'already', message: 'That build is already on.' };
  const bad = payloadProblem(record.payload);
  if (bad) return { ok: false, reason: 'payload', message: bad };
  if (w.lastSwapTick !== null && tick - w.lastSwapTick < cooldownTicks) {
    const left = cooldownTicks - (tick - w.lastSwapTick);
    return { ok: false, reason: 'cooldown', message: `Builds can be swapped again in ${left} tick${left === 1 ? '' : 's'}.` };
  }
  return { ok: true, record, state: { ...w, activeId: id, lastSwapTick: tick } };
}

// ───────────────────────────────────────────── Embalming table: respec gate ─────────────────────────────────────────────

/** One respec per zombie per game day: cheap and free (CB-2: never a sold respec), but not a way to swap mid-fight. */
export const RESPEC_PER_DAY = 1;

export function canRespec(lastRespecDay: number | null, day: number, blocked: string | null): { ok: true } | { ok: false; message: string } {
  if (blocked) return { ok: false, message: blocked };
  if (lastRespecDay !== null && lastRespecDay === day) return { ok: false, message: 'The table has done its work for today. Come back tomorrow.' };
  return { ok: true };
}

// ───────────────────────────────────────────── Crypt vault: the W-029 stash ─────────────────────────────────────────────

export const MATERIAL_IDS = ['scrap', 'wood', 'cloth', 'bone', 'glass', 'wire', 'ecto'] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

/** Stash cap per material (docs/systems/crafting-salvage.md §2). */
export const STASH_CAPS: Readonly<Record<MaterialId, number>> = Object.freeze({ scrap: 100, wood: 100, cloth: 100, bone: 100, glass: 100, wire: 100, ecto: 20 });

export type StashState = Readonly<Record<MaterialId, number>>;

export const newStash = (): StashState => ({ scrap: 0, wood: 0, cloth: 0, bone: 0, glass: 0, wire: 0, ecto: 0 });

export const isMaterial = (v: unknown): v is MaterialId => typeof v === 'string' && (MATERIAL_IDS as readonly string[]).includes(v);

export type StashResult = { ok: true; state: StashState; moved: number } | { ok: false; message: string };

/** Add units; anything over the cap is not taken (the rest is `moved` less than asked, never lost silently: the sim says so). */
export function stashAdd(s: StashState, id: MaterialId, units: number): StashResult {
  if (!Number.isInteger(units) || units <= 0) return { ok: false, message: 'Pick a whole number of units.' };
  const room = STASH_CAPS[id] - s[id];
  if (room <= 0) return { ok: false, message: 'The vault is full of that.' };
  const moved = Math.min(room, units);
  return { ok: true, state: { ...s, [id]: s[id] + moved }, moved };
}

export function stashTake(s: StashState, id: MaterialId, units: number): StashResult {
  if (!Number.isInteger(units) || units <= 0) return { ok: false, message: 'Pick a whole number of units.' };
  if (s[id] < units) return { ok: false, message: 'The vault does not hold that much.' };
  return { ok: true, state: { ...s, [id]: s[id] - units }, moved: units };
}

// ───────────────────────────────────────────── Rot Essence: how it is earned ─────────────────────────────────────────────

/**
 * Every Rot Essence source in ONE table, for the economy to tune. Sources that need a system that has not landed are
 * kept at 0 on purpose, so landing the system is one number, not a code change.
 */
export const ESSENCE_EARN = Object.freeze({
  /** A day the Hearth stood in the home with the utilities on. */
  hearthDay: 5,
  /** Per furniture-set bonus threshold in force that day (2, 4 and 6 pieces each count), capped by `setBonusCap`. */
  perSetThreshold: 1,
  setBonusCap: 6,
  /** Activities (Sol's S14: scavenge, dig, fish) pay Rot Essence once they exist. Zero until they land. */
  scavenge: 0,
  dig: 0,
  fish: 0,
});

/** Essence for one game day, given how many set thresholds are in force. 0 when the Hearth is missing or cold. */
export function essenceForDay(hearthPlaced: boolean, utilitiesOn: boolean, setThresholdsInForce: number): number {
  if (!hearthPlaced || !utilitiesOn) return 0;
  const n = Number.isFinite(setThresholdsInForce) ? Math.floor(setThresholdsInForce) : 0;
  const sets = Math.min(ESSENCE_EARN.setBonusCap, Math.max(0, n)) * ESSENCE_EARN.perSetThreshold;
  return ESSENCE_EARN.hearthDay + sets;
}

// ───────────────────────────────────────────── the save shape ─────────────────────────────────────────────

export interface HomeServicesState {
  version: 1;
  hearth: HearthState;
  /** Game day the daily essence was last credited (never credited twice for one day). -1 = never. */
  essenceDay: number;
  /** Per household member. */
  wardrobe: Readonly<Record<string, WardrobeState>>;
  /** Per household member: the game day of the last Embalming respec. */
  respecDay: Readonly<Record<string, number>>;
  /** The household's vault. */
  stash: StashState;
}

export const newHomeServicesState = (): HomeServicesState => ({ version: 1, hearth: newHearthState(0), essenceDay: -1, wardrobe: {}, respecDay: {}, stash: newStash() });
