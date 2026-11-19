/**
 * The SFX table: exactly one recipe per SfxId (asserted in tests), plus bus routing, category, loop
 * behaviour and an expected maximum one-shot length used by the verification report.
 */
import type { SfxId } from '../../shared/audioIds';
import type { LoopFactory, OneShot } from '../synth/types';
import * as B from './build';
import * as LA from './life-a';
import * as LB from './life-b';
import * as L from './loops';
import * as S from './stingers';
import * as U from './ui';
import * as W from './world';

export type BusId = 'music' | 'sfx' | 'voice' | 'ambient' | 'ui';
export type SfxCategory = 'ui' | 'build' | 'life' | 'stinger' | 'ambient' | 'voice';

export interface SfxDef {
  play: OneShot;
  bus: BusId;
  cat: SfxCategory;
  /** Dedicated loop; otherwise the one-shot is re-triggered with `gap` seconds between repeats. */
  loop?: LoopFactory;
  gap?: readonly [number, number];
  /** Output trim for this sound (applied by the engine). */
  trim?: number;
}

/** Category length limits (seconds) for one-shots. Stingers/ambience may ring longer. */
export const MAX_DURATION: Readonly<Record<SfxCategory, number>> = {
  ui: 1.2,
  build: 1.2,
  life: 1.2,
  voice: 1.25,
  stinger: 2.6,
  ambient: 3.6,
};

const ui = (play: OneShot): SfxDef => ({ play, bus: 'ui', cat: 'ui', gap: [0.6, 1.5] });
const build = (play: OneShot, gap: readonly [number, number] = [0.6, 1.5]): SfxDef => ({ play, bus: 'sfx', cat: 'build', gap });
const life = (play: OneShot, gap: readonly [number, number] = [1, 2.5], loop?: LoopFactory): SfxDef => ({ play, bus: 'sfx', cat: 'life', gap, loop });
const sting = (play: OneShot): SfxDef => ({ play, bus: 'sfx', cat: 'stinger', gap: [2, 4] });
const amb = (play: OneShot, gap: readonly [number, number], loop?: LoopFactory): SfxDef => ({ play, bus: 'ambient', cat: 'ambient', gap, loop });
const voice = (play: OneShot, gap: readonly [number, number]): SfxDef => ({ play, bus: 'voice', cat: 'voice', gap });

const RAW_TABLE: Record<SfxId, SfxDef> = {
  // UI
  uiClick: ui(U.uiClick),
  uiHover: ui(U.uiHover),
  uiOpen: ui(U.uiOpen),
  uiClose: ui(U.uiClose),
  uiError: ui(U.uiError),
  uiConfirm: ui(U.uiConfirm),
  uiTab: ui(U.uiTab),
  uiToggle: ui(U.uiToggle),
  notify: ui(U.notify),
  notifyBad: ui(U.notifyBad),
  cash: ui(U.cash),
  cashLoss: ui(U.cashLoss),
  speedChange: ui(U.speedChange),
  modeLive: ui(U.modeLive),
  modeBuild: ui(U.modeBuild),
  modeBuy: ui(U.modeBuy),
  save: ui(U.save),
  // Build / buy
  placeObject: build(B.placeObject),
  placeInvalid: build(B.placeInvalid),
  rotateObject: build(B.rotateObject, [0.1, 0.3]),
  sellObject: build(B.sellObject),
  pickUpObject: build(B.pickUpObject),
  wallBuild: build(B.wallBuild, [0.1, 0.3]),
  wallDelete: build(B.wallDelete),
  floorPaint: build(B.floorPaint, [0.05, 0.2]),
  wallPaint: build(B.wallPaint, [0.1, 0.3]),
  doorPlace: build(B.doorPlace),
  undo: build(B.undo),
  // Life
  footstep: life(LA.footstep, [0.36, 0.48]),
  eat: life(LA.eat, [0.5, 1.2]),
  drink: life(LA.drink, [0.8, 1.6]),
  cook: life(LA.cook, [0.2, 0.5], L.cookLoop),
  chop: life(LA.chop, [0.18, 0.4]),
  fridgeOpen: life(LA.fridgeOpen, [3, 6]),
  microwave: life(LA.microwave, [1, 2], L.microwaveLoop),
  espresso: life(LA.espresso, [0.5, 1], L.espressoLoop),
  sinkWater: life(LA.sinkWater, [0.2, 0.5], L.sinkLoop),
  shower: life(LA.shower, [0.2, 0.5], L.showerLoop),
  bathSplash: life(LA.bathSplash, [0.8, 2.2]),
  iceCrack: life(LA.iceCrack, [1.5, 4]),
  snore: life(LA.snore, [1.5, 2.3], L.snoreLoop),
  yawn: voice(LA.yawn, [3, 6]),
  tvStatic: life(LA.tvStatic, [0.1, 0.3], L.tvStaticLoop),
  tvChatter: life(LA.tvChatter, [0.1, 0.4], L.tvChatterLoop),
  stereoMusic: life(LA.stereoMusic, [0.1, 0.3], L.stereoLoop),
  computerTyping: life(LA.computerTyping, [0.3, 1.2], L.typingLoop),
  arcadeBlips: life(LA.arcadeBlips, [0.1, 0.6], L.arcadeLoop),
  chessClack: life(LA.chessClack, [1.5, 4]),
  pageTurn: life(LA.pageTurn, [2, 5]),
  paintBrush: life(LA.paintBrush, [0.15, 0.5]),
  gymClank: life(LA.gymClank, [0.8, 1.6]),
  embalmPump: life(LA.embalmPump, [0.4, 0.7]),
  stitch: life(LA.stitch, [0.3, 0.7]),
  mirrorShimmer: life(LA.mirrorShimmer, [1.5, 3]),
  doorOpen: life(LB.doorOpen, [2, 4]),
  doorbell: life(LB.doorbell, [1.5, 3]),
  mailbox: life(LB.mailbox, [2, 4]),
  phoneRing: life(LB.phoneRing, [1.6, 1.6], L.phoneRingLoop),
  phoneDial: life(LB.phoneDial, [0.5, 1.5]),
  carpoolHonk: life(LB.carpoolHonk, [1.5, 3]),
  trashLid: life(LB.trashLid, [2, 4]),
  dishClatter: life(LB.dishClatter, [0.4, 1.2]),
  plantChomp: life(LB.plantChomp, [1, 2.5]),
  limbDrop: life(LB.limbDrop, [2, 4]),
  limbReattach: life(LB.limbReattach, [2, 4]),
  crumble: life(LB.crumble, [2, 4]),
  reanimate: sting(LB.reanimate),
  fireStart: life(LB.fireStart, [2, 4]),
  fireLoop: life(LB.fireLoop, [0.1, 0.3], L.fireLoopLoop),
  extinguish: life(LB.extinguish, [0.3, 0.8]),
  flies: life(LB.flies, [0.1, 0.3], L.fliesLoop),
  zap: life(LB.zap, [0.6, 2.5]),
  kiss: life(LB.kiss, [1.5, 3]),
  hug: life(LB.hug, [2, 4]),
  slap: life(LB.slap, [1.5, 3]),
  laugh: voice(LB.laugh, [0.8, 2.5]),
  cheer: voice(LB.cheer, [0.5, 1.5]),
  partyHorn: life(LB.partyHorn, [1, 3]),
  promotion: sting(S.promotion),
  skillUp: sting(S.skillUp),
  milestone: sting(S.milestone),
  fail: sting(S.fail),
  romanceSting: sting(S.romanceSting),
  sadSting: sting(S.sadSting),
  powerOff: life(W.powerOff, [2, 4]),
  powerOn: life(W.powerOn, [2, 4]),
  repoGhoul: sting(W.repoGhoul),
  pizzaArrive: life(W.pizzaArrive, [3, 5]),
  groanAmbient: amb(W.groanAmbient, [0.5, 2.5], L.groanLoop),
  owl: amb(W.owl, [3, 8]),
  wind: amb(W.wind, [0.5, 1], L.windLoop),
  crickets: amb(W.crickets, [0.2, 0.5], L.cricketsLoop),
  thunder: amb(W.thunder, [8, 20]),
  bark: life(W.bark, [2, 4]),
};

/**
 * Loudness trims (dB) from the offline verification (active-RMS targets: UI ≈ -24, build/life ≈ -23,
 * stingers ≈ -21, distant ambience ≈ -30). Applied by the engine and by the offline renderer.
 */
export const TRIM_DB: Partial<Record<SfxId, number>> = {
  uiHover: 2, uiOpen: 2, uiClose: 2, uiConfirm: 1, uiTab: 3, uiToggle: 1, speedChange: 2, modeBuy: 3, uiError: -5,
  rotateObject: 5, sellObject: 3, wallDelete: 2, floorPaint: 14, wallPaint: 6, undo: 3, placeInvalid: -4,
  eat: 12, drink: 2, cook: 4, fridgeOpen: 5, sinkWater: 7, bathSplash: 4, iceCrack: 6, snore: 6, computerTyping: 10,
  arcadeBlips: 4, pageTurn: 4, paintBrush: 11, embalmPump: 3, stitch: 9, doorOpen: 9, phoneRing: 7, dishClatter: 5,
  plantChomp: 3, limbReattach: 7, crumble: 3, fireStart: 6, flies: 3, kiss: 2, hug: 2, cheer: 10, partyHorn: 3,
  mirrorShimmer: 2, zap: -5, extinguish: -4, slap: -2, fail: -3, owl: -6, groanAmbient: 6, milestone: 2,
  romanceSting: 3, sadSting: 2, reanimate: 3, repoGhoul: 3, yawn: 2, laugh: 4, tvChatter: 4, stereoMusic: -2,
};

function applyTrims(raw: Record<SfxId, SfxDef>): Readonly<Record<SfxId, SfxDef>> {
  for (const [id, db] of Object.entries(TRIM_DB) as [SfxId, number][]) raw[id].trim = Math.pow(10, db / 20);
  return raw;
}

export const SFX_TABLE: Readonly<Record<SfxId, SfxDef>> = applyTrims(RAW_TABLE);

export function loopFactoryFor(def: SfxDef): LoopFactory {
  return def.loop ?? L.repeatLoop(def.play, def.gap ?? [1, 2]);
}

/** Internal ambience voices that are not part of the shared vocabulary. */
export const AMBIENT_EXTRAS = {
  crow: W.crow,
  rain: W.rain,
  howl: W.howl,
  rainLoop: L.rainLoop,
  windLoop: L.windLoop,
  cricketsLoop: L.cricketsLoop,
  moonLoop: L.moonLoop,
} as const;
