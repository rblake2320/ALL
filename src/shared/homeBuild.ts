/**
 * Home build rules (docs/contract-requests/home-build-system.md, W-152 follow-up): what a zombie home borrows from the
 * reference game's bases. PURE data and rules, no sim, no UI, no clock: every function takes the state it needs and
 * returns a new value, so the sim, the Build mode and the tests share one source of truth.
 *
 *  - Snap points for the first FREE_PLACEMENT_AT (20) placed items, then Free Placement (a milestone, never relocked).
 *  - Service points and a decoration budget per home tier; working furniture only on a service point.
 *  - Furniture sets: 2 / 4 / 6 placed pieces of one set give LIFE bonuses (never a fight stat, CB-2).
 *  - The Hearth: Rot Essence earned in play unlocks home upgrades; the Hearth runs on the household's utilities, so
 *    unpaid utilities switch the upgrades off until paid. No upgrade adds a fight stat.
 *  - Permissions: visit / use / decorate / defend, child-safe defaults.
 * The numbers (budgets, costs) are the economy's to tune; they live in the tables below and nowhere else.
 */

// ───────────────────────────────────────────── snap points → Free Placement ─────────────────────────────────────────────

/** Placed items needed before Free Placement unlocks; until then objects go on snap points only. */
export const FREE_PLACEMENT_AT = 20;

export const SNAP_KINDS = ['wall', 'floor', 'ceiling', 'garden'] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];

/** The few facts about an object the rules need (a subset of the catalogue's PhysicalSpec). */
export interface PlaceableInfo {
  id: string;
  /** 'floor' | 'wall' | 'door' | 'window' | 'item' (src/shared/catalog.ts PlacementKind). */
  placement: string;
  category?: string;
  tags?: readonly string[];
  outdoorOnly?: boolean;
}

/** Which kind of snap point an object can go on: a wall point, a floor point, a ceiling point or a garden point. */
export function snapKindFor(o: PlaceableInfo): SnapKind {
  if (o.placement === 'wall' || o.placement === 'door' || o.placement === 'window') return 'wall';
  if (o.outdoorOnly || o.category === 'outdoor' || o.tags?.includes('outdoorLight')) return 'garden';
  if (o.tags?.includes('ceilingLight')) return 'ceiling';
  return 'floor';
}

/** Spacing of the snap points: a floor point every 2 tiles, a garden point every 3, a wall point every 2 edges. */
export const SNAP_STEP: Readonly<Record<SnapKind, number>> = Object.freeze({ floor: 2, garden: 3, wall: 2, ceiling: 2 });

/**
 * Is the spot a snap point of `kind`? Floor and garden points are tiles (x, z) on the snap lattice; wall points are
 * wall edges whose coordinate ALONG the wall is on the lattice (`h:x:z` runs along x, `v:x:z` along z). A pure
 * function of the coordinates, so the sim, the ghost preview and the markers all agree.
 */
export function isSnapSpot(kind: SnapKind, spot: { x: number; z: number } | { edge: string }): boolean {
  const step = SNAP_STEP[kind];
  if ('edge' in spot) {
    const m = /^([hv]):(-?\d+):(-?\d+)$/.exec(spot.edge);
    if (!m) return false;
    return Number(m[1] === 'h' ? m[2] : m[3]) % step === 0;
  }
  return Math.floor(spot.x) % step === 0 && Math.floor(spot.z) % step === 0;
}

export interface HomeBuildState {
  tier: HomeTierId;
  /** Every item the household has ever placed (selling one does not take it back: the milestone is about practice). */
  placedEver: number;
  /** Free Placement was unlocked (at placedEver >= FREE_PLACEMENT_AT); stays on. */
  freePlacement: boolean;
}

export function newHomeBuildState(tier: HomeTierId = 'starter'): HomeBuildState {
  return { tier, placedEver: 0, freePlacement: false };
}

/** 'snap': only snap points offer a spot; 'free': any legal spot. */
export function placementMode(s: HomeBuildState): 'snap' | 'free' {
  return s.freePlacement || s.placedEver >= FREE_PLACEMENT_AT ? 'free' : 'snap';
}

/** Count one more placed item; `unlockedNow` is true exactly for the placement that unlocks Free Placement. */
export function registerPlacement(s: HomeBuildState): { state: HomeBuildState; unlockedNow: boolean } {
  const placedEver = s.placedEver + 1;
  const was = placementMode(s) === 'free';
  const freePlacement = s.freePlacement || placedEver >= FREE_PLACEMENT_AT;
  return { state: { ...s, placedEver, freePlacement }, unlockedNow: freePlacement && !was };
}

// ───────────────────────────────────────────── tiers, service points, caps ─────────────────────────────────────────────

export const HOME_TIER_IDS = ['starter', 'cottage', 'townhouse', 'manor'] as const;
export type HomeTierId = (typeof HOME_TIER_IDS)[number];

export interface HomeTierDef {
  id: HomeTierId;
  name: string;
  /** Placed decoration / furniture items (doors and windows are structure and do not count). */
  decorBudget: number;
  /** Working furniture (services) the home can hold. */
  servicePoints: number;
}

/** Placeholder numbers for the economy to set; the rules and tests read only this table. */
export const HOME_TIERS: Readonly<Record<HomeTierId, HomeTierDef>> = Object.freeze({
  starter: { id: 'starter', name: 'Fixer-upper', decorBudget: 60, servicePoints: 2 },
  cottage: { id: 'cottage', name: 'Cottage', decorBudget: 90, servicePoints: 3 },
  townhouse: { id: 'townhouse', name: 'Townhouse', decorBudget: 130, servicePoints: 4 },
  manor: { id: 'manor', name: 'Manor', decorBudget: 180, servicePoints: 6 },
});

export const SERVICE_KINDS = ['wardrobe', 'embalming', 'vault', 'workbench', 'boneGate', 'sparring'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * Which object is which service. `station_embalming` exists today; the others are the planned service furniture of
 * build step 3 (ids reserved here so a service can never be placed as plain decoration once they exist).
 */
export const SERVICE_FURNITURE: Readonly<Record<string, { service: ServiceKind; planned: boolean }>> = Object.freeze({
  station_embalming: { service: 'embalming', planned: false },
  wardrobe_coffin: { service: 'wardrobe', planned: false },
  vault_crypt: { service: 'vault', planned: false },
  workbench_bone: { service: 'workbench', planned: false },
  gate_bone: { service: 'boneGate', planned: false },
  dummy_sparring: { service: 'sparring', planned: true },
});

export function serviceOf(defId: string): ServiceKind | null {
  return SERVICE_FURNITURE[defId]?.service ?? null;
}

/** A placed object as the rules see it. */
export interface PlacedItem {
  /** Instance id (unique per placed object). */
  id: string;
  defId: string;
}

const isStructure = (o: { placement: string }) => o.placement === 'door' || o.placement === 'window';

export type PlaceRefusal = 'limit:decor' | 'limit:service' | 'wrongSnapKind' | 'noSnapPoint';

export type PlaceCheck = { ok: true; service: ServiceKind | null } | { ok: false; reason: PlaceRefusal; message: string };

export function decorCount(items: readonly PlacedItem[], info: (defId: string) => PlaceableInfo | undefined): number {
  let n = 0;
  for (const it of items) {
    const i = info(it.defId);
    if (!i || isStructure(i) || serviceOf(it.defId)) continue;
    n++;
  }
  return n;
}

export function servicesPlaced(items: readonly PlacedItem[]): number {
  return items.filter((it) => serviceOf(it.defId) !== null).length;
}

export function servicePointsLeft(s: HomeBuildState, items: readonly PlacedItem[]): number {
  return Math.max(0, HOME_TIERS[s.tier].servicePoints - servicesPlaced(items));
}

/**
 * May the household place `obj` now? `snap` is what the player is aiming at while in snap mode (the kind of point, or
 * null for "no snap point"); it is ignored in Free Placement. Refusals carry a typed reason and a player-facing line.
 */
export function canPlace(
  s: HomeBuildState,
  items: readonly PlacedItem[],
  obj: PlaceableInfo,
  info: (defId: string) => PlaceableInfo | undefined,
  snap?: SnapKind | null,
): PlaceCheck {
  const service = serviceOf(obj.id);
  const tier = HOME_TIERS[s.tier];
  if (service) {
    if (servicesPlaced(items) >= tier.servicePoints) {
      return { ok: false, reason: 'limit:service', message: `All ${tier.servicePoints} service points of the ${tier.name} are in use.` };
    }
  } else if (!isStructure(obj) && decorCount(items, info) >= tier.decorBudget) {
    return { ok: false, reason: 'limit:decor', message: `The ${tier.name} holds ${tier.decorBudget} items; that is all it can take.` };
  }
  // snap points are for the first FREE_PLACEMENT_AT items; AMENITIES (service furniture) stay on points for good
  // (the reference game: "amenities stay node-only")
  if (placementMode(s) === 'snap' || service !== null) {
    if (snap === null || snap === undefined) return { ok: false, reason: 'noSnapPoint', message: service ? 'Working furniture goes on a glowing service point.' : 'Place it on one of the glowing snap points. Free Placement unlocks after ' + FREE_PLACEMENT_AT + ' items.' };
    if (snap !== snapKindFor(obj)) return { ok: false, reason: 'wrongSnapKind', message: `That is a ${snap} point; this item goes on a ${snapKindFor(obj)} point.` };
  }
  return { ok: true, service };
}

// ───────────────────────────────────────────── furniture sets (life bonuses) ─────────────────────────────────────────────

/**
 * What a home bonus may change. LIFE only (Rest, Freshness, Fun, skill gain, garden growth, a feeling): there is no
 * key for damage, health, armour, speed or anything else a fight reads (CB-2, D-085 "no real-money fight power").
 */
export interface LifeBonus {
  /** % faster Rest recovery while sleeping. */
  restRestorePct?: number;
  /** Freshness points per hour asleep. */
  freshnessPerHourAsleep?: number;
  /** % more Fun from fun activities. */
  funGainPct?: number;
  /** % more skill XP. */
  skillGainPct?: number;
  /** % faster garden growth. */
  gardenGrowthPct?: number;
  /** A feeling (moodlet id) the household starts the day with. */
  startOfDayFeeling?: string;
}

export const LIFE_BONUS_KEYS = ['restRestorePct', 'freshnessPerHourAsleep', 'funGainPct', 'skillGainPct', 'gardenGrowthPct', 'startOfDayFeeling'] as const;
/** Words that would make a bonus a fight stat; the tests refuse any key or id containing one. */
export const FIGHT_STAT_WORDS = ['damage', 'health', 'armor', 'armour', 'defense', 'defence', 'attack', 'crit', 'speed', 'power', 'dps', 'hp'] as const;

export const SET_THRESHOLDS = [2, 4, 6] as const;
export type SetThreshold = (typeof SET_THRESHOLDS)[number];

export interface FurnitureSetDef {
  id: string;
  name: string;
  /** Object ids (the catalogue's); a piece belongs to exactly one set; duplicates of a piece count once. */
  pieces: readonly string[];
  bonuses: Readonly<Record<SetThreshold, LifeBonus>>;
}

export const FURNITURE_SETS: readonly FurnitureSetDef[] = Object.freeze([
  {
    id: 'mausoleum',
    name: 'Mausoleum',
    pieces: ['coffin_pine', 'lamp_skull', 'pew_salvaged', 'door_crypt', 'candelabra_drippy', 'sarcophagus_cryo'],
    bonuses: { 2: { restRestorePct: 10 }, 4: { freshnessPerHourAsleep: 1 }, 6: { startOfDayFeeling: 'wellInterred' } },
  },
  {
    id: 'gothicParlour',
    name: 'Gothic Parlour',
    pieces: ['sofa_velvet', 'table_wake', 'window_gothic', 'painting_greatgrand', 'rug_rag', 'sconce_candle'],
    bonuses: { 2: { funGainPct: 5 }, 4: { restRestorePct: 5 }, 6: { startOfDayFeeling: 'cosyParlour' } },
  },
  {
    id: 'necroKitchen',
    name: 'Necro Kitchen',
    pieces: ['stove_necrochef', 'fridge_cryo', 'counter_slab', 'espresso_embalmer', 'sink_rusty', 'microwave_nuke'],
    bonuses: { 2: { skillGainPct: 5 }, 4: { funGainPct: 5 }, 6: { skillGainPct: 5, startOfDayFeeling: 'wellFed' } },
  },
  {
    id: 'arcadeDen',
    name: 'Arcade Den',
    pieces: ['tv_seance', 'arcade_tombstone', 'stereo_boombox', 'desk_hauntedpc', 'armchair_tattered', 'table_bonechess'],
    bonuses: { 2: { funGainPct: 8 }, 4: { skillGainPct: 5 }, 6: { funGainPct: 7, startOfDayFeeling: 'highScore' } },
  },
  {
    id: 'graveGarden',
    name: 'Grave Garden',
    pieces: ['headstone_decor', 'tree_gnarled', 'plant_carnivorous', 'plant_deadfern', 'lantern_post', 'mailbox_crooked'],
    bonuses: { 2: { gardenGrowthPct: 10 }, 4: { gardenGrowthPct: 10 }, 6: { gardenGrowthPct: 10, startOfDayFeeling: 'greenFingers' } },
  },
]);

const SET_OF_PIECE: ReadonlyMap<string, FurnitureSetDef> = new Map(FURNITURE_SETS.flatMap((s) => s.pieces.map((p) => [p, s] as const)));

export interface SetProgress {
  set: FurnitureSetDef;
  /** Distinct pieces of this set placed. */
  pieces: number;
  /** The highest threshold reached (0 = none). */
  tier: 0 | SetThreshold;
  /** Every bonus earned so far (thresholds up to `tier`), in order. */
  earned: LifeBonus[];
}

/** Progress of every set that has at least one piece placed. */
export function setProgress(items: readonly PlacedItem[]): SetProgress[] {
  const have = new Map<string, Set<string>>();
  for (const it of items) {
    const set = SET_OF_PIECE.get(it.defId);
    if (!set) continue;
    (have.get(set.id) ?? have.set(set.id, new Set()).get(set.id)!).add(it.defId);
  }
  const out: SetProgress[] = [];
  for (const set of FURNITURE_SETS) {
    const n = have.get(set.id)?.size ?? 0;
    if (n === 0) continue;
    const reached = SET_THRESHOLDS.filter((t) => n >= t);
    out.push({ set, pieces: n, tier: (reached[reached.length - 1] ?? 0) as 0 | SetThreshold, earned: reached.map((t) => set.bonuses[t]) });
  }
  return out;
}

/** Add two life bonuses: numbers add, the latest feeling wins. */
export function addLifeBonus(a: LifeBonus, b: LifeBonus): LifeBonus {
  const out: LifeBonus = { ...a };
  for (const k of LIFE_BONUS_KEYS) {
    if (k === 'startOfDayFeeling') {
      if (b.startOfDayFeeling) out.startOfDayFeeling = b.startOfDayFeeling;
    } else if (b[k] !== undefined) out[k] = (out[k] ?? 0) + (b[k] as number);
  }
  return out;
}

export function sumLifeBonuses(list: readonly LifeBonus[]): LifeBonus {
  return list.reduce((acc, b) => addLifeBonus(acc, b), {} as LifeBonus);
}

/** The home set bonus in force for the placed items (the sum over every set's earned thresholds). */
export function setBonuses(items: readonly PlacedItem[]): LifeBonus {
  return sumLifeBonuses(setProgress(items).flatMap((p) => p.earned));
}

// ───────────────────────────────────────────── the Hearth ─────────────────────────────────────────────

export type BuildOption = 'loadoutSlot' | 'perkSlot';

export type HearthEffect = { kind: 'buildOption'; option: BuildOption } | { kind: 'ward'; bonus: LifeBonus };

export interface HearthUpgradeDef {
  id: string;
  name: string;
  /** Rot Essence, earned in play (never sold). */
  cost: number;
  /** Another upgrade that must be owned first. */
  requires?: string;
  effect: HearthEffect;
}

export const HEARTH_UPGRADES: readonly HearthUpgradeDef[] = Object.freeze([
  { id: 'loadoutSlot2', name: 'Second loadout slot', cost: 40, effect: { kind: 'buildOption', option: 'loadoutSlot' } },
  { id: 'perkSlot', name: 'Perk slot', cost: 60, requires: 'loadoutSlot2', effect: { kind: 'buildOption', option: 'perkSlot' } },
  { id: 'wardRest', name: 'Ward of Rest', cost: 50, effect: { kind: 'ward', bonus: { restRestorePct: 5 } } },
  { id: 'wardFresh', name: 'Ward of Freshness', cost: 50, effect: { kind: 'ward', bonus: { freshnessPerHourAsleep: 1 } } },
  { id: 'wardGarden', name: 'Ward of the Garden', cost: 40, effect: { kind: 'ward', bonus: { gardenGrowthPct: 10 } } },
  { id: 'wardSkill', name: 'Ward of Learning', cost: 80, requires: 'wardRest', effect: { kind: 'ward', bonus: { skillGainPct: 5 } } },
]);

const UPGRADE_BY_ID: ReadonlyMap<string, HearthUpgradeDef> = new Map(HEARTH_UPGRADES.map((u) => [u.id, u]));

export interface HearthState {
  /** Rot Essence the household holds. */
  essence: number;
  /** Upgrade ids bought (kept when the power is cut; they are only switched off). */
  owned: readonly string[];
}

export const newHearthState = (essence = 0): HearthState => ({ essence, owned: [] });

/** The Hearth runs on the household's utilities: power cut (unpaid bills) = every upgrade off. */
export function hearthPowered(utilitiesOn: boolean): boolean {
  return utilitiesOn === true;
}

export type BuyUpgradeResult = { ok: true; state: HearthState; spent: number } | { ok: false; reason: 'unknown' | 'owned' | 'needs' | 'essence' | 'unpowered'; message: string };

export function buyHearthUpgrade(h: HearthState, id: string, utilitiesOn: boolean): BuyUpgradeResult {
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return { ok: false, reason: 'unknown', message: 'That upgrade does not exist.' };
  if (h.owned.includes(id)) return { ok: false, reason: 'owned', message: 'Already unlocked.' };
  if (u.requires && !h.owned.includes(u.requires)) return { ok: false, reason: 'needs', message: `Unlock ${UPGRADE_BY_ID.get(u.requires)?.name ?? u.requires} first.` };
  if (!hearthPowered(utilitiesOn)) return { ok: false, reason: 'unpowered', message: 'The Hearth is cold: pay the utilities first.' };
  if (h.essence < u.cost) return { ok: false, reason: 'essence', message: `Needs ${u.cost} Rot Essence (you have ${Math.floor(h.essence)}).` };
  return { ok: true, state: { essence: h.essence - u.cost, owned: [...h.owned, id] }, spent: u.cost };
}

/** The upgrades in force: all owned ones while powered, none while the utilities are off (paying restores them). */
export function activeHearthUpgrades(h: HearthState, utilitiesOn: boolean): HearthUpgradeDef[] {
  if (!hearthPowered(utilitiesOn)) return [];
  return h.owned.map((id) => UPGRADE_BY_ID.get(id)).filter((u): u is HearthUpgradeDef => !!u);
}

/** House-wide life buffs of the Hearth wards. */
export function hearthWards(h: HearthState, utilitiesOn: boolean): LifeBonus {
  return sumLifeBonuses(activeHearthUpgrades(h, utilitiesOn).flatMap((u) => (u.effect.kind === 'ward' ? [u.effect.bonus] : [])));
}

/** Extra build options the Hearth opens (loadout / perk slots). */
export function hearthBuildOptions(h: HearthState, utilitiesOn: boolean): BuildOption[] {
  return activeHearthUpgrades(h, utilitiesOn).flatMap((u) => (u.effect.kind === 'buildOption' ? [u.effect.option] : []));
}

/** Everything a home gives the household's life right now: sets plus Hearth wards. */
export function homeLifeBonus(items: readonly PlacedItem[], h: HearthState, utilitiesOn: boolean): LifeBonus {
  return addLifeBonus(setBonuses(items), hearthWards(h, utilitiesOn));
}

// ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

/** Four levels per visitor group, each includes the ones before it. */
export const PERMISSION_LEVELS = ['visit', 'use', 'decorate', 'defend'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];
export const VISITOR_GROUPS = ['stranger', 'friend', 'crew'] as const;
export type VisitorGroup = (typeof VISITOR_GROUPS)[number];

export type HomeAction = 'enter' | 'useService' | 'placeItem' | 'standGuard' | 'takeItem' | 'spendHearth';

const NEEDS: Readonly<Record<HomeAction, PermissionLevel | 'owner'>> = { enter: 'visit', useService: 'use', placeItem: 'decorate', standGuard: 'defend', takeItem: 'owner', spendHearth: 'owner' };

/** May a visitor with `level` do `action`? Stored goods and Hearth upgrades are household-only, whatever the level. */
export function permits(level: PermissionLevel, action: HomeAction): boolean {
  const need = NEEDS[action];
  if (need === 'owner') return false;
  return PERMISSION_LEVELS.indexOf(level) >= PERMISSION_LEVELS.indexOf(need);
}

/** Defaults: strangers visit, friends use services, crew decorate. A child profile never gets more than visit. */
export function defaultPermission(group: VisitorGroup, childProfile = false): PermissionLevel {
  if (childProfile) return 'visit';
  return group === 'stranger' ? 'visit' : group === 'friend' ? 'use' : 'decorate';
}
