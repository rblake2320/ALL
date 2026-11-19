/**
 * Gameplay ObjectDefs for EVERY physical spec in src/shared/catalog.ts. Each def spreads the physical spec and adds
 * interactions, environment score, depreciation, break chance, sellability and system params.
 *
 * Environment bands (task brief): cheap 0–1, nice 2–4, fancy 4–6, rugs 2–4, portrait 4, velvet sofa 5,
 * sarcophagus 6; items: dish −1, ash −3, fire −5, limb −2, bone pile −3, urn 3, painting 3.
 * Break chance: appliances 0.01–0.03 (fancy halves), everything else 0. Depreciation 0.15 (doors/windows 0.1).
 */
import type { ObjectDef } from '../../contracts';
import { PHYSICAL_SPECS, type PhysicalSpec } from '../../../shared/catalog';
import { IX } from './ids';

interface Extra {
  interactions: string[];
  env: number;
  breakChance?: number;
  params?: Record<string, number | string | boolean>;
}

const REPAIRABLE = [IX.repair];

/** Sleep params: energy/hygiene via engine scaleByObjectParam; the rest read by the decay system. */
const SLEEP_BASE = { energyPerHour: 10, hygienePerHour: 0, preservationPerHour: 0, sleepDecayMult: 0.5, vitalityPerSleep: 0 };

const EXTRAS: Record<string, Extra> = {
  // ─────────────── seating ───────────────
  chair_creaky: { interactions: [IX.sit], env: 0 },
  chair_ribcage: { interactions: [IX.sit], env: 2 },
  armchair_tattered: { interactions: [IX.sit], env: 1, params: { comfort: 1 } },
  sofa_moldy: { interactions: [IX.sit, IX.nap], env: 1, params: { comfort: 1 } },
  sofa_velvet: { interactions: [IX.sit, IX.nap], env: 5, params: { comfort: 2 } },
  pew_salvaged: { interactions: [IX.sit, IX.contemplate], env: 1 },
  // ─────────────── surfaces ───────────────
  table_rickety: { interactions: [IX.wipeDown], env: 0 },
  table_wake: { interactions: [IX.wipeDown], env: 2 },
  counter_butcher: { interactions: [IX.wipeDown], env: 1 },
  counter_slab: { interactions: [IX.wipeDown], env: 4 },
  table_coffinlid: { interactions: [IX.wipeDown], env: 2 },
  table_urnstand: { interactions: [IX.wipeDown], env: 1 },
  // ─────────────── kitchen ───────────────
  fridge_humming: {
    interactions: [IX.cook, IX.grabJerky, IX.eatLeftovers, IX.grabSpray, IX.cleanFridge, ...REPAIRABLE],
    env: 0,
    breakChance: 0.02,
    params: { spoilMult: 1, capacity: 30 },
  },
  fridge_cryo: {
    interactions: [IX.cook, IX.grabJerky, IX.eatLeftovers, IX.grabSpray, IX.cleanFridge, ...REPAIRABLE],
    env: 4,
    breakChance: 0.01,
    params: { spoilMult: 0.5, capacity: 40 },
  },
  stove_greasefire: {
    interactions: [IX.cookAtStove, IX.cleanStove, ...REPAIRABLE],
    env: 0,
    breakChance: 0.03,
    params: { fireMult: 1.25, qualityBonus: 0 },
  },
  stove_necrochef: {
    interactions: [IX.cookAtStove, IX.cleanStove, ...REPAIRABLE],
    env: 4,
    breakChance: 0.015,
    params: { fireMult: 0.5, qualityBonus: 1 },
  },
  microwave_nuke: { interactions: [IX.microwaveBurrito, ...REPAIRABLE], env: 0, breakChance: 0.03 },
  espresso_embalmer: { interactions: [IX.brewEspresso, ...REPAIRABLE], env: 1, breakChance: 0.02 },
  sink_rusty: { interactions: [IX.washHands], env: 0 },
  trash_lidded: { interactions: [IX.emptyTrash, IX.rummageTrash], env: 0, params: { capacity: 8 } },
  // ─────────────── preservation & bath ───────────────
  shower_drizzle: { interactions: [IX.shower], env: 0 },
  tub_icebath: { interactions: [IX.iceBath, ...REPAIRABLE], env: 2, breakChance: 0.015 },
  station_embalming: { interactions: [IX.selfEmbalm, IX.stitchSelfStation], env: 3 },
  table_stitchnmend: { interactions: [IX.stitchSelf, IX.practiceStitch], env: 1 },
  mirror_cracked: { interactions: [IX.admireDecay, IX.practiceSpeech, IX.checkFreshness], env: 2 },
  // ─────────────── beds ───────────────
  plot_budget: {
    interactions: [IX.sleep],
    env: 0,
    params: { ...SLEEP_BASE, energyPerHour: 10, hygienePerHour: -3, preservationPerHour: 1, sleepDecayMult: 0.5 },
  },
  coffin_pine: {
    interactions: [IX.sleep],
    env: 1,
    // GDD §4 restores: "Pine coffin sleep: preservation decay halted".
    params: { ...SLEEP_BASE, energyPerHour: 12, preservationPerHour: 0, sleepDecayMult: 0 },
  },
  coffin_chillrest: {
    interactions: [IX.sleep, IX.chillOut, ...REPAIRABLE],
    env: 3,
    breakChance: 0.01,
    params: { ...SLEEP_BASE, energyPerHour: 12, preservationPerHour: 4, sleepDecayMult: 0, refrigerated: true },
  },
  sarcophagus_cryo: {
    interactions: [IX.sleep, IX.chillOut, ...REPAIRABLE],
    env: 6,
    breakChance: 0.005,
    params: { ...SLEEP_BASE, energyPerHour: 13, preservationPerHour: 5, sleepDecayMult: 0, vitalityPerSleep: 2, refrigerated: true },
  },
  bed_normal: { interactions: [IX.sleep], env: 2, params: { ...SLEEP_BASE, energyPerHour: 9, sleepDecayMult: 0.5 } },
  // ─────────────── electronics ───────────────
  tv_crt: { interactions: [IX.watchTv, ...REPAIRABLE], env: 1, breakChance: 0.02, params: { tvFun: 1.0 } },
  tv_seance: { interactions: [IX.watchTv, ...REPAIRABLE], env: 5, breakChance: 0.01, params: { tvFun: 1.3 } },
  stereo_boombox: { interactions: [IX.stereoToggle, IX.dance, IX.listenMusic, ...REPAIRABLE], env: 1, breakChance: 0.02 },
  desk_hauntedpc: {
    interactions: [IX.browseWeb, IX.playVideoGames, IX.program, IX.payBillsOnline, ...REPAIRABLE],
    env: 2,
    breakChance: 0.02,
  },
  // ─────────────── hobbies ───────────────
  table_bonechess: { interactions: [IX.playChess], env: 3 },
  shelf_moldering: { interactions: [IX.read], env: 2 },
  easel_morbid: { interactions: [IX.paint], env: 2 },
  gym_limb: { interactions: [IX.workout], env: 1 },
  arcade_tombstone: { interactions: [IX.playArcade, ...REPAIRABLE], env: 3, breakChance: 0.02 },
  // ─────────────── decor ───────────────
  plant_deadfern: { interactions: [IX.mournFern, IX.waterFern], env: 1 },
  plant_carnivorous: { interactions: [IX.feedPlant], env: 3 },
  rug_rag: { interactions: [IX.admireRug], env: 2 },
  rug_funeral: { interactions: [IX.admireRug], env: 4 },
  painting_greatgrand: { interactions: [IX.admirePortrait], env: 4 },
  headstone_decor: { interactions: [IX.readEpitaph], env: 2 },
  tree_gnarled: { interactions: [IX.broodTree], env: 2 },
  zapper_fly: { interactions: [IX.watchZapper], env: 0, params: { radius: 5 } },
  diffuser_formaldehyde: { interactions: [IX.sniffDiffuser], env: 1 },
  mailbox_crooked: { interactions: [IX.payBills, IX.checkMail], env: 0 },
  kit_reanimation: { interactions: [IX.kitReanimate, IX.readKitManual], env: 0 },
  crate_prosthetic: { interactions: [IX.fitProsthetic], env: 0 },
  // ─────────────── lighting ───────────────
  lamp_skull: { interactions: [IX.toggleLight], env: 2 },
  candelabra_drippy: { interactions: [IX.toggleLight], env: 2, params: { candle: true } },
  // home services: working furniture, opened from the click menu (src/game/homeMenu.ts); the zombie dusts it between uses
  hearth_stone: { interactions: [IX.wipeDown], env: 4 },
  wardrobe_coffin: { interactions: [IX.wipeDown], env: 3 },
  vault_crypt: { interactions: [IX.wipeDown], env: 2 },
  workbench_bone: { interactions: [IX.wipeDown], env: 2 },
  gate_bone: { interactions: [IX.wipeDown], env: 4 },
  sconce_candle: { interactions: [IX.toggleLight], env: 2, params: { candle: true } },
  lantern_post: { interactions: [IX.toggleLight], env: 2 },
  // ─────────────── openings ───────────────
  door_splintered: { interactions: [IX.slamDoor], env: 0 },
  door_crypt: { interactions: [IX.slamDoor], env: 4 },
  window_grimy: { interactions: [IX.gazeWindow], env: 0 },
  window_gothic: { interactions: [IX.gazeWindow], env: 4 },
  // ─────────────── spawned items ───────────────
  item_meal: { interactions: [IX.haveServing, IX.putAwayLeftovers, IX.throwAwayFood], env: 0 },
  item_pizza: { interactions: [IX.haveServing, IX.putAwayLeftovers, IX.throwAwayFood], env: 0 },
  item_dish: { interactions: [IX.cleanDish], env: -1 },
  item_limb_arm: { interactions: [IX.pickUpLimb, IX.limbStitch, IX.limbReattachOther, IX.throwAwayLimb], env: -2 },
  item_limb_leg: { interactions: [IX.pickUpLimb, IX.limbStitch, IX.limbReattachOther, IX.throwAwayLimb], env: -2 },
  item_bonepile: { interactions: [IX.reanimate, IX.mournPile], env: -3 },
  item_urn: { interactions: [IX.mournUrn, IX.payRespects], env: 3 },
  item_painting: { interactions: [IX.sellPainting, IX.admirePainting], env: 3 },
  item_fire: { interactions: [IX.fightFire], env: -5 },
  item_ash: { interactions: [IX.cleanAsh], env: -3 },
};

/** W-131 batch: every object that has a cleaning interaction also offers Clear Stuck Mess (gated at run time). */
const CLEANING_IX = new Set<string>([IX.wipeDown, IX.cleanStove, IX.emptyTrash, IX.cleanDish, IX.cleanAsh, IX.cleanFridge]);
function withStuckRecovery(list: readonly string[]): string[] {
  const out = [...list];
  if (out.some((id) => CLEANING_IX.has(id)) && !out.includes(IX.clearStuckMess)) out.push(IX.clearStuckMess);
  // surfaces people eat at / put plates on: one click clears every dish on them
  if (out.includes(IX.wipeDown) && !out.includes(IX.clearDishes)) out.unshift(IX.clearDishes);
  return out;
}

function buildDef(spec: PhysicalSpec): ObjectDef {
  const extra = EXTRAS[spec.id];
  const isItem = spec.category === 'item';
  const isOpening = spec.placement === 'door' || spec.placement === 'window';
  return {
    ...spec,
    interactions: extra ? withStuckRecovery(extra.interactions) : [],
    env: extra ? extra.env : 0,
    depreciation: isOpening ? 0.1 : 0.15,
    breakChance: extra?.breakChance ?? 0,
    sellable: !isItem,
    params: { ...(extra?.params ?? {}) },
  };
}

export const HOME_OBJECTS: ObjectDef[] = PHYSICAL_SPECS.map(buildDef);

/** Spec ids that have no gameplay extras (should be empty — guarded by tests). */
export const OBJECTS_WITHOUT_EXTRAS: string[] = PHYSICAL_SPECS.filter((s) => !EXTRAS[s.id]).map((s) => s.id);

export const HOME_OBJECTS_BY_ID: Record<string, ObjectDef> = Object.fromEntries(HOME_OBJECTS.map((d) => [d.id, d]));
