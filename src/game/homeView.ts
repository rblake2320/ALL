/**
 * What the home service screens show (docs/contract-requests/home-build-system.md steps 3-4), as plain data computed from
 * the world: the Hearth and its upgrades, the home bonuses in force, one zombie's Wardrobe, the Embalming gate and the
 * Crypt vault. PURE: the screen (src/ui/hud/dialogs/HomeServiceDialog.tsx) renders it and dispatches `{ type: 'home' }`
 * commands; the sim (src/sim/systems/homeServices) decides every outcome again.
 */
import { HEARTH_UPGRADES, hearthPowered, homeLifeBonus, setProgress, type HearthEffect, type LifeBonus } from '../shared/homeBuild';
import { HEARTH_OBJECT, MATERIAL_IDS, MAX_SAVED_BUILDS, STASH_CAPS, SWAP_COOLDOWN_MIN, type MaterialId } from '../shared/homeServices';
import { placedItems } from '../sim/spatial/homeBuildRules';
import { TICK_MINUTES, type WorldState } from '../sim/types';
import { timeInfo } from '../sim/time';
import { homeBonusesLive } from '../sim/engine/homeBonus';
import { buildHomeObjects } from '../sim/spatial/build/region';

const FEELINGS: Readonly<Record<string, string>> = { wellInterred: 'Well Interred', cosyParlour: 'Cosy Parlour', wellFed: 'Well Fed' };

/** One line per life bonus; never a fight stat (CB-2). */
export function describeBonus(b: LifeBonus): string[] {
  const out: string[] = [];
  if (b.restRestorePct) out.push(`Rest restores ${b.restRestorePct}% faster`);
  if (b.freshnessPerHourAsleep) out.push(`+${b.freshnessPerHourAsleep} Freshness per hour asleep`);
  if (b.funGainPct) out.push(`${b.funGainPct}% more Fun from fun things`);
  if (b.skillGainPct) out.push(`Skills grow ${b.skillGainPct}% faster`);
  // shown, not applied: there is no garden growth in the game yet (home-build-system.md section 3)
  if (b.gardenGrowthPct) out.push(`The garden grows ${b.gardenGrowthPct}% faster (inactive: there is no garden growth in the game yet)`);
  if (b.startOfDayFeeling) out.push(`Start each day feeling ${FEELINGS[b.startOfDayFeeling] ?? b.startOfDayFeeling}`);
  return out;
}

function describeEffect(e: HearthEffect): string {
  if (e.kind === 'buildOption') return e.option === 'loadoutSlot' ? 'Opens a second loadout slot for builds' : 'Opens a perk slot for builds';
  return describeBonus(e.bonus).join(', ');
}

export type HearthStatus = 'owned' | 'buy' | 'needs' | 'poor' | 'cold';

export interface HearthRowView {
  id: string;
  name: string;
  cost: number;
  effect: string;
  status: HearthStatus;
  /** Why it cannot be bought now, or a short state line. */
  note: string | null;
}

export interface SetLineView {
  name: string;
  pieces: number;
  tier: number;
  /** Pieces needed for the next bonus, or null at the top tier. */
  nextAt: number | null;
}

export interface HearthView {
  /** Do the home bonuses count in this world (home build on, or the Hearth placed)? */
  live: boolean;
  placed: boolean;
  powered: boolean;
  essence: number;
  rows: HearthRowView[];
  /** Everything the home gives the household's life right now (sets + Hearth wards), one line each. */
  bonuses: string[];
  sets: SetLineView[];
}

const hasObject = (w: Pick<WorldState, 'objects' | 'town'>, defId: string): boolean => Object.values(buildHomeObjects(w)).some((o) => o.defId === defId);

export function hearthView(w: WorldState): HearthView {
  const hs = w.homeServices;
  const hearth = hs?.hearth ?? { essence: 0, owned: [] };
  const powered = hearthPowered(w.household?.utilitiesOn === true);
  const items = placedItems(w);
  const rows: HearthRowView[] = HEARTH_UPGRADES.map((u) => {
    const owned = hearth.owned.includes(u.id);
    const missing = u.requires && !hearth.owned.includes(u.requires) ? HEARTH_UPGRADES.find((x) => x.id === u.requires)?.name ?? u.requires : null;
    let status: HearthStatus = 'buy';
    let note: string | null = null;
    if (owned) {
      status = 'owned';
      note = powered ? 'Active' : 'Switched off while the power is cut';
    } else if (missing) {
      status = 'needs';
      note = `Unlock ${missing} first`;
    } else if (!powered) {
      status = 'cold';
      note = 'The Hearth is cold: pay the utilities first';
    } else if (hearth.essence < u.cost) {
      status = 'poor';
      note = `Needs ${u.cost} Rot Essence (you have ${Math.floor(hearth.essence)})`;
    }
    return { id: u.id, name: u.name, cost: u.cost, effect: describeEffect(u.effect), status, note };
  });
  const sets: SetLineView[] = setProgress(items).map((p) => {
    const next = [2, 4, 6].find((t) => p.pieces < t) ?? null;
    return { name: p.set.name, pieces: p.pieces, tier: p.tier, nextAt: next };
  });
  const live = homeBonusesLive(w);
  return {
    live,
    placed: hasObject(w, HEARTH_OBJECT),
    powered,
    essence: Math.floor(hearth.essence),
    rows,
    bonuses: live ? describeBonus(homeLifeBonus(items, hearth, w.household?.utilitiesOn === true)) : [],
    sets,
  };
}

export interface WardrobeView {
  agentId: string;
  slots: { id: string; name: string; active: boolean }[];
  max: number;
  /** Ticks until the next swap is allowed (0 = ready). */
  swapReadyInTicks: number;
  cooldownMinutes: number;
}

export function wardrobeView(w: WorldState, agentId: string): WardrobeView {
  const wd = w.homeServices?.wardrobe?.[agentId];
  const cool = Math.ceil(SWAP_COOLDOWN_MIN / TICK_MINUTES);
  const left = wd && wd.lastSwapTick !== null ? Math.max(0, cool - (w.tick - wd.lastSwapTick)) : 0;
  return {
    agentId,
    slots: (wd?.slots ?? []).map((s) => ({ id: s.id, name: s.name, active: s.id === wd?.activeId })),
    max: MAX_SAVED_BUILDS,
    swapReadyInTicks: left,
    cooldownMinutes: SWAP_COOLDOWN_MIN,
  };
}

export function respecView(w: WorldState, agentId: string): { ready: boolean; note: string } {
  const last = w.homeServices?.respecDay?.[agentId];
  const day = timeInfo(w.tick).day;
  return last === day ? { ready: false, note: 'The table has done its work for today. Come back tomorrow.' } : { ready: true, note: 'One respec per zombie per day. It never costs anything.' };
}

const MATERIAL_NAME: Readonly<Record<MaterialId, string>> = { scrap: 'Scrap Metal', wood: 'Salvaged Wood', cloth: 'Cloth Scraps', bone: 'Bone', glass: 'Glass', wire: 'Wire & Springs', ecto: 'Ectoplasm' };

export function vaultView(w: WorldState): { id: MaterialId; name: string; count: number; cap: number }[] {
  const s = w.homeServices?.stash;
  return MATERIAL_IDS.map((id) => ({ id, name: MATERIAL_NAME[id], count: s?.[id] ?? 0, cap: STASH_CAPS[id] }));
}
