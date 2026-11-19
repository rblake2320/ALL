/**
 * Upkeep / leisure behaviours: activity (generic), sit, toggle, watchTv, dance, listen, read, paint, cleanUp,
 * wipeDown, fightFire, emptyTrash, feedPlant, epitaph. Trait fun multipliers come from people's trait `mult`
 * (tvFun, napFun, readingFun, danceFun, paintingFun); object multipliers from ObjectDef.params (tvFun).
 */
import type { InteractionBehavior, InteractionDef, SimContext, StageDef } from '../../../contracts';
import type { ActiveInteraction, AgentState, ObjectState, SkillId } from '../../../types';
import { SKILL_IDS, TICK_MINUTES } from '../../../types';
import { DATA, ITEM, IX, MOOD, STAT, TAG } from '../../../content/home/ids';
import { EPITAPHS, FERN_LINES, INFOMERCIAL_PRODUCTS, KIT_MANUAL_LINES, PAINTING_TITLES } from '../../../content/home/flavour';
import { armCount, ONE_ARM_SLOWDOWN, safeSkill } from '../decay/limbs';
import { safePowered, traitMultSafe } from '../decay/rates';
import { floorPointNear } from '../services';
import {
  bubble,
  centerOf,
  clamp,
  dataBool,
  dataNum,
  dist,
  firstName,
  getObj,
  hasTag,
  isNum,
  num,
  objParam,
  objParamBool,
  onLotAgents,
  pickLine,
  queuedObject,
  runData,
  runSlotKind,
  safeDt,
  setData,
  stageObject,
  str,
  targetObject,
} from '../util';
import { leisureScore, NEVER } from '../autonomy';
import { extinguish, FIRE_FIGHT_SUCCESS } from './fire';
import { syncStereoLoops } from './loops';

const SIT_ANIMS = ['sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess'];

function currentStage(ctx: SimContext, def: InteractionDef, run: ActiveInteraction): StageDef | null {
  return ctx.content.stagesOf(def.id)[run.stage] ?? null;
}

function baseFunPerHour(ctx: SimContext, def: InteractionDef, run: ActiveInteraction): number {
  return Math.max(0, num(currentStage(ctx, def, run)?.needsPerHour?.fun, 0));
}

function isSkill(v: unknown): v is SkillId {
  return typeof v === 'string' && (SKILL_IDS as readonly string[]).includes(v);
}

/** One-armed zombies work at 1/1.35 speed on hands-on tasks. */
function handsFactor(ctx: SimContext, actor: AgentState, def: InteractionDef): number {
  return def.tags?.includes(TAG.handsOn) && armCount(ctx, actor) === 1 ? 1 / ONE_ARM_SLOWDOWN : 1;
}

function isNightHour(ctx: SimContext): boolean {
  const h = num(ctx.time?.hour, 12);
  return h >= 21 || h < 6;
}

/** Keep a standing pose when a seat-stage fell back to a tile / 'here'. */
function standingAnim(ctx: SimContext, actor: AgentState, def: InteractionDef, run: ActiveInteraction, anim: string): void {
  const st = currentStage(ctx, def, run);
  if (!st || !SIT_ANIMS.includes(st.anim)) return;
  if (runSlotKind(ctx, run) === 'sit') return;
  if (actor.anim !== anim) actor.anim = anim as AgentState['anim'];
}

function addFun(ctx: SimContext, actor: AgentState, perHour: number, dt: number): void {
  if (perHour !== 0 && Number.isFinite(perHour)) ctx.changeNeed(actor, 'fun', (perHour * dt) / 60);
}

// ─────────────────────────────── generic activity ───────────────────────────────

/**
 * params: xpSkill/xpPerHour (hands-on aware xp), funMultKey (trait mult on the stage's fun), autoNeed/autoMax
 * (autonomy only while need < max), nightPenalty (score × at night unless Night Owl), standingAnim,
 * highScoreChance (moodlet highScore on completion).
 */
export const activityBehavior: InteractionBehavior = {
  tick(ctx, actor, run, def, dt) {
    const m = safeDt(dt);
    if (m <= 0) return;
    const p = def.params ?? {};
    if (isSkill(p.xpSkill) && num(p.xpPerHour, 0) > 0) ctx.addXp(actor, p.xpSkill, ((num(p.xpPerHour, 0) * m) / 60) * handsFactor(ctx, actor, def));
    if (typeof p.funMultKey === 'string') addFun(ctx, actor, baseFunPerHour(ctx, def, run) * (traitMultSafe(ctx, actor, p.funMultKey) - 1), m);
    if (typeof p.standingAnim === 'string') standingAnim(ctx, actor, def, run, p.standingAnim);
  },
  completeStage(ctx, actor, _run, def) {
    const chance = num(def.params?.highScoreChance, 0);
    if (chance > 0 && ctx.rng.chance(chance)) {
      ctx.addMoodlet(actor, MOOD.highScore);
      bubble(ctx, actor, 'trophy', 'speech', true);
      ctx.emit({ type: 'voice', agentId: actor.id, emotion: 'happy', durationMs: 1200 });
    }
  },
  adjustScore(ctx, actor, def, _target, score) {
    const p = def.params ?? {};
    let s = score;
    if (typeof p.autoNeed === 'string') {
      const v = num(actor.needs?.[p.autoNeed as keyof AgentState['needs']], 100);
      const max = num(p.autoMax, 50);
      if (v >= max) return NEVER;
      // Urgency: the lower the need, the more it matters (crumbling is permanent-ish).
      s += (max - v) * num(p.autoUrgency, 0.8);
    }
    if (num(p.nightPenalty, 0) > 0 && isNightHour(ctx) && !ctx.hasTrait(actor, 'nightOwl')) s *= num(p.nightPenalty, 1);
    return leisureScore(ctx, actor, def, s);
  },
};

// ─────────────────────────────── sit ───────────────────────────────

function seatedNearby(ctx: SimContext, actor: AgentState, radius: number): AgentState[] {
  return onLotAgents(ctx).filter((o) => {
    if (o.id === actor.id || !o.active || o.active.phase !== 'run') return false;
    if (dist(o.pos, actor.pos) > radius) return false;
    return runSlotKind(ctx, o.active) === 'sit';
  });
}

export const sitBehavior: InteractionBehavior = {
  tick(ctx, actor, _run, _def, dt) {
    const m = safeDt(dt);
    const company = seatedNearby(ctx, actor, 2.5).length;
    if (company > 0) {
      ctx.changeNeed(actor, 'social', (3 * Math.min(3, company) * m) / 60);
      addFun(ctx, actor, 2, m);
    }
  },
  adjustScore(ctx, actor, def, target, score) {
    const seat = targetObject(ctx, target);
    if (!seat) return score;
    const near = onLotAgents(ctx).filter((o) => o.id !== actor.id && o.active?.phase === 'run' && dist(o.pos, centerOf(ctx, seat)) <= 2.5).length;
    return leisureScore(ctx, actor, def, near > 0 ? score + 6 + objParam(ctx, seat, 'comfort', 0) : score - 2);
  },
};

// ─────────────────────────────── toggle (lamps, stereo) ───────────────────────────────

function toggleKey(def: InteractionDef): string {
  return str(def.params?.key, 'on');
}

function isOn(ctx: SimContext, obj: ObjectState | null, def: InteractionDef): boolean {
  return dataBool(obj, toggleKey(def), def.params?.defaultOn !== false);
}

export function setPlaying(ctx: SimContext, obj: ObjectState, playing: boolean): void {
  setData(ctx, obj, DATA.playing, playing);
  syncStereoLoops(ctx);
}

export const toggleBehavior: InteractionBehavior = {
  label(ctx, _actor, def, target) {
    const obj = targetObject(ctx, target);
    const on = isOn(ctx, obj, def);
    const candle = objParamBool(ctx, obj, 'candle');
    const p = def.params ?? {};
    if (candle) return str(on ? p.candleOnLabel : p.candleOffLabel, on ? 'Snuff Out' : 'Light');
    return str(on ? p.onLabel : p.offLabel, on ? 'Turn Off' : 'Turn On');
  },
  available(ctx, _actor, def, target) {
    const obj = targetObject(ctx, target);
    if (!obj) return 'It’s gone';
    if (def.params?.needsPowerToStart === true && !isOn(ctx, obj, def) && !safePowered(ctx, obj)) return 'The power is out';
    return true;
  },
  completeStage(ctx, _actor, run, def) {
    const obj = queuedObject(ctx, run);
    if (!obj) return;
    const next = !isOn(ctx, obj, def);
    if (toggleKey(def) === DATA.playing) setPlaying(ctx, obj, next);
    else setData(ctx, obj, toggleKey(def), next);
  },
};

// ─────────────────────────────── TV ───────────────────────────────

export const TV_CHANNELS = [
  { id: 'horror', label: 'Horror Reruns' },
  { id: 'cooking', label: 'Cooking Channel' },
  { id: 'soaps', label: 'Soap Operas' },
  { id: 'infomercials', label: 'Infomercials' },
] as const;

function channelOf(v: unknown): string | null {
  return TV_CHANNELS.some((c) => c.id === v) ? (v as string) : null;
}

function addInUse(ctx: SimContext, obj: ObjectState, agentId: string): void {
  if (!Array.isArray(obj.inUseBy)) obj.inUseBy = [];
  if (!obj.inUseBy.includes(agentId)) {
    obj.inUseBy.push(agentId);
    ctx.markChanged(obj);
  }
}

function removeInUse(ctx: SimContext, obj: ObjectState | null, agentId: string): void {
  if (!obj || !Array.isArray(obj.inUseBy) || !obj.inUseBy.includes(agentId)) return;
  obj.inUseBy = obj.inUseBy.filter((a) => a !== agentId);
  ctx.markChanged(obj);
}

export const watchTvBehavior: InteractionBehavior = {
  choices() {
    return TV_CHANNELS.map((c) => ({ label: c.label, params: { channel: c.id }, available: true as const, cost: null, icon: 'tv' as const }));
  },
  begin(ctx, actor, run) {
    let ch = channelOf(run.params?.channel);
    if (!ch) {
      if (ctx.hasTrait(actor, 'gourmand')) ch = 'cooking';
      else if (ctx.hasTrait(actor, 'hopelessRomantic')) ch = 'soaps';
      else ch = TV_CHANNELS[Math.max(0, ctx.rng.weighted([4, 2, 3, 1]))].id;
    }
    runData(run).channel = ch;
    return null;
  },
  startStage(ctx, actor, run) {
    const tv = queuedObject(ctx, run);
    if (!tv) return 'The TV is gone';
    if (tv.condition?.broken) return 'The TV is broken';
    addInUse(ctx, tv, actor.id);
    runData(run).tvId = tv.id;
    return null;
  },
  tick(ctx, actor, run, def, dt) {
    const d = runData(run);
    const tv = getObj(ctx, d.tvId);
    if (!tv || tv.condition?.broken || !safePowered(ctx, tv)) return 'done';
    const m = safeDt(dt);
    const base = baseFunPerHour(ctx, def, run);
    const objMult = Math.max(0, objParam(ctx, tv, 'tvFun', 1));
    const traitMult = traitMultSafe(ctx, actor, 'tvFun');
    let extra = base * (objMult * traitMult - 1);
    switch (d.channel) {
      case 'horror':
        extra += 2;
        break;
      case 'cooking':
        ctx.addXp(actor, 'cooking', (6 * m) / 60);
        break;
      case 'soaps':
        ctx.changeNeed(actor, 'social', (3 * m) / 60);
        break;
      case 'infomercials':
        extra -= 4;
        break;
    }
    addFun(ctx, actor, extra, m);
    standingAnim(ctx, actor, def, run, 'idle');
  },
  adjustScore(ctx, actor, def, _target, score) {
    // stopWhen fun ≥ 98 would end the show at once when the zombie is already amused (Lazy +15 used to loop it).
    return leisureScore(ctx, actor, def, score);
  },
  end(ctx, actor, run, _def, outcome) {
    const d = runData(run);
    removeInUse(ctx, getObj(ctx, d.tvId), actor.id);
    if (outcome === 'complete' && d.channel === 'infomercials' && ctx.rng.chance(0.35)) {
      ctx.addMoodlet(actor, MOOD.infomercialHaze);
      bubble(ctx, actor, 'money', 'thought', true);
      if (run.source === 'player') {
        ctx.notify({ kind: 'info', title: 'Must… order…', text: `${firstName(actor)} now desperately wants ${pickLine(ctx, INFOMERCIAL_PRODUCTS, 'one')}.`, agentId: actor.id });
      }
    }
  },
};

// ─────────────────────────────── stereo: dance / listen ───────────────────────────────

function ensurePlaying(ctx: SimContext, run: ActiveInteraction): ObjectState | null {
  const stereo = queuedObject(ctx, run);
  if (!stereo) return null;
  if (!dataBool(stereo, DATA.playing, false)) setPlaying(ctx, stereo, true);
  return stereo;
}

export const danceBehavior: InteractionBehavior = {
  startStage(ctx, _actor, run) {
    return ensurePlaying(ctx, run) ? null : 'The stereo is gone';
  },
  tick(ctx, actor, run, def, dt) {
    const stereo = queuedObject(ctx, run);
    if (!stereo || !dataBool(stereo, DATA.playing, false) || !safePowered(ctx, stereo)) return 'done';
    addFun(ctx, actor, baseFunPerHour(ctx, def, run) * (traitMultSafe(ctx, actor, 'danceFun') - 1), safeDt(dt));
  },
  adjustScore(ctx, actor, def, _target, score) {
    return leisureScore(ctx, actor, def, score);
  },
};

export const listenBehavior: InteractionBehavior = {
  startStage(ctx, _actor, run) {
    return ensurePlaying(ctx, run) ? null : 'The stereo is gone';
  },
  adjustScore(ctx, actor, def, _target, score) {
    return leisureScore(ctx, actor, def, score);
  },
  tick(ctx, actor, run, def, dt) {
    const stereo = queuedObject(ctx, run);
    if (!stereo || !dataBool(stereo, DATA.playing, false) || !safePowered(ctx, stereo)) return 'done';
    if (safeDt(dt) > 0) standingAnim(ctx, actor, def, run, str(def.params?.standingAnim, 'listen'));
  },
};

// ─────────────────────────────── reading ───────────────────────────────

export const BOOK_GENRES = [
  { id: 'romance', label: 'Trashy Romance', skill: null, xp: 0, fun: 6 },
  { id: 'cookbook', label: 'Cookbook', skill: 'cooking' as SkillId, xp: 15, fun: 0 },
  { id: 'mortuary', label: 'Mortuary Textbook', skill: 'mortuary' as SkillId, xp: 35, fun: -3 },
  { id: 'logic', label: 'Logic Puzzles', skill: 'logic' as SkillId, xp: 25, fun: 2 },
] as const;

function genreOf(v: unknown): (typeof BOOK_GENRES)[number] | null {
  return BOOK_GENRES.find((g) => g.id === v) ?? null;
}

export const readBehavior: InteractionBehavior = {
  choices() {
    return BOOK_GENRES.map((g) => ({ label: g.label, params: { genre: g.id }, available: true as const, cost: null, icon: 'book' as const }));
  },
  begin(ctx, actor, run) {
    let g = genreOf(run.params?.genre);
    if (!g) {
      if (ctx.hasTrait(actor, 'hopelessRomantic')) g = BOOK_GENRES[0];
      else if (ctx.hasTrait(actor, 'gourmand')) g = BOOK_GENRES[1];
      else g = BOOK_GENRES[Math.max(0, ctx.rng.weighted([3, 2, 2, 2]))];
    }
    runData(run).genre = g.id;
    return null;
  },
  adjustScore(ctx, actor, def, _target, score) {
    return leisureScore(ctx, actor, def, score);
  },
  tick(ctx, actor, run, def, dt) {
    const stages = ctx.content.stagesOf(def.id);
    if (run.stage < stages.length - 1) return;
    const g = genreOf(runData(run).genre);
    const m = safeDt(dt);
    if (!g || m <= 0) return;
    if (g.skill && g.xp > 0) ctx.addXp(actor, g.skill, (g.xp * m) / 60);
    let extra = g.fun + (g.id === 'romance' && ctx.hasTrait(actor, 'hopelessRomantic') ? 4 : 0);
    extra += (baseFunPerHour(ctx, def, run) + g.fun) * (traitMultSafe(ctx, actor, 'readingFun') - 1);
    addFun(ctx, actor, extra, m);
    standingAnim(ctx, actor, def, run, str(def.params?.standingAnim, 'read'));
  },
};

// ─────────────────────────────── painting ───────────────────────────────

export const PAINTING_HOURS_AT_ZERO = 3;

export function paintingValue(ctx: SimContext, creativity: number): number {
  const c = clamp(num(creativity, 0), 0, 10);
  return Math.max(1, Math.round(40 + 25 * Math.pow(c, 1.35) * (0.8 + 0.4 * ctx.rng.next())));
}

function finishPainting(ctx: SimContext, actor: AgentState, easel: ObjectState): ObjectState | null {
  const creativity = safeSkill(ctx, actor, 'creativity');
  const value = paintingValue(ctx, creativity);
  const title = pickLine(ctx, PAINTING_TITLES, 'Untitled');
  const at = floorPointNear(ctx, centerOf(ctx, easel));
  let painting: ObjectState | null = null;
  try {
    painting = ctx.spawnObject(
      ITEM.painting,
      { kind: 'loose', x: at.x, z: at.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 },
      { data: { [DATA.value]: value, [DATA.title]: title, [DATA.artistId]: actor.id, [DATA.createdTick]: ctx.state.tick } },
    );
  } catch {
    painting = null;
  }
  setData(ctx, easel, DATA.progress, 0);
  setData(ctx, easel, DATA.artistId, null);
  ctx.addMoodlet(actor, MOOD.artisticTriumph);
  ctx.stat(STAT.paintingsFinished, 1);
  ctx.stat(STAT.paintingsFinished, 1, actor.id);
  ctx.emit({ type: 'fx', kind: 'sparkle', agentId: actor.id });
  ctx.notify({
    kind: 'skill',
    title: 'Masterpiece!',
    text: `${firstName(actor)} finished “${title}”. An art dealer would pay about $${value}. Sell it, or hang on to it for the ambience.`,
    agentId: actor.id,
    objectId: painting ? painting.id : null,
  });
  return painting;
}

export const paintBehavior: InteractionBehavior = {
  adjustScore(ctx, actor, def, _target, score) {
    // A 90-minute session: Artistic +25 used to win over dinner at hunger 14.
    return leisureScore(ctx, actor, def, score);
  },
  startStage(ctx, actor, run) {
    const easel = queuedObject(ctx, run);
    if (!easel) return 'The easel is gone';
    runData(run).easelId = easel.id;
    if (dataNum(easel, DATA.progress, 0) <= 0) setData(ctx, easel, DATA.artistId, actor.id);
    return null;
  },
  tick(ctx, actor, run, def, dt) {
    const easel = getObj(ctx, runData(run).easelId);
    if (!easel) return 'done';
    const m = safeDt(dt);
    if (m <= 0) return;
    const hands = handsFactor(ctx, actor, def);
    const creativity = safeSkill(ctx, actor, 'creativity');
    const p = def.params ?? {};
    if (isSkill(p.xpSkill)) ctx.addXp(actor, p.xpSkill, ((num(p.xpPerHour, 40) * m) / 60) * hands);
    addFun(ctx, actor, baseFunPerHour(ctx, def, run) * (traitMultSafe(ctx, actor, 'paintingFun') - 1), m);
    const before = clamp(dataNum(easel, DATA.progress, 0), 0, 1);
    const rate = (1 / PAINTING_HOURS_AT_ZERO) * (1 + 0.08 * creativity) * hands;
    const after = before + (rate * m) / 60;
    if (after >= 1) {
      finishPainting(ctx, actor, easel);
      return 'done';
    }
    if (!easel.data || typeof easel.data !== 'object') easel.data = {};
    easel.data[DATA.progress] = after;
    if (Math.floor(after * 20) !== Math.floor(before * 20)) ctx.markChanged(easel); // canvas visual every 5%
  },
};

// ─────────────────────────────── cleaning ───────────────────────────────

function heldBy(actor: AgentState, obj: ObjectState | null): boolean {
  return !!obj && obj.placement.kind === 'held' && obj.placement.agentId === actor.id;
}

export const cleanUpBehavior: InteractionBehavior = {
  completeStage(ctx, actor, run, def, stage) {
    const d = runData(run);
    const stages = ctx.content.stagesOf(def.id);
    const target = queuedObject(ctx, run);
    if (stage < stages.length - 1) {
      if (target && target.placement.kind === 'loose') ctx.holdItem(actor, target);
      return;
    }
    d.cleaned = true;
    const where = stageObject(ctx, run);
    if (where && hasTag(ctx, where, 'trash')) setData(ctx, where, DATA.fill, dataNum(where, DATA.fill, 0) + 1);
    if (ctx.hasTrait(actor, 'neatFreak')) ctx.addMoodlet(actor, MOOD.spotless);
    ctx.stat(STAT.dishesCleaned, 1);
    ctx.stat(STAT.dishesCleaned, 1, actor.id);
  },
  end(ctx, actor, run) {
    const target = queuedObject(ctx, run);
    if (!target) return;
    if (runData(run).cleaned) {
      if (heldBy(actor, target)) ctx.releaseHeld(actor, 'destroy');
      else ctx.removeObject(target.id, 'Cleaned up');
    } else if (heldBy(actor, target)) {
      ctx.releaseHeld(actor, 'floor');
    }
  },
  adjustScore(ctx, actor, def, target, score) {
    const obj = targetObject(ctx, target);
    if (!obj) return score;
    return leisureScore(ctx, actor, def, dataBool(obj, DATA.flies, false) ? score + 6 : score);
  },
};

export const wipeDownBehavior: InteractionBehavior = {
  completeStage(ctx, actor, run) {
    const obj = queuedObject(ctx, run);
    if (!obj) return;
    if (!obj.condition) obj.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
    obj.condition.dirt = 0;
    ctx.markChanged(obj);
    if (ctx.hasTrait(actor, 'neatFreak')) ctx.addMoodlet(actor, MOOD.spotless);
  },
  adjustScore(ctx, actor, def, target, score) {
    const obj = targetObject(ctx, target);
    return leisureScore(ctx, actor, def, score + num(obj?.condition?.dirt, 0) * 10);
  },
};

export const emptyTrashBehavior: InteractionBehavior = {
  completeStage(ctx, actor, run) {
    const trash = queuedObject(ctx, run);
    if (!trash) return;
    setData(ctx, trash, DATA.fill, 0);
    setData(ctx, trash, DATA.flies, false);
    if (ctx.hasTrait(actor, 'neatFreak')) ctx.addMoodlet(actor, MOOD.spotless);
  },
  adjustScore(ctx, actor, def, target, score) {
    const trash = targetObject(ctx, target);
    const cap = Math.max(1, objParam(ctx, trash, 'capacity', 8));
    return leisureScore(ctx, actor, def, score + (dataNum(trash, DATA.fill, 0) / cap) * 8);
  },
};

// ─────────────────────────────── fire ───────────────────────────────

export const MAX_FIRE_ATTEMPTS = 6;

export const fightFireBehavior: InteractionBehavior = {
  startStage(ctx, _actor, run) {
    return queuedObject(ctx, run) ? null : 'The fire is out';
  },
  completeStage(ctx, _actor, run) {
    runData(run).success = ctx.rng.chance(FIRE_FIGHT_SUCCESS);
  },
  end(ctx, actor, run, _def, outcome) {
    const fire = queuedObject(ctx, run);
    if (!fire || outcome !== 'complete') return;
    if (runData(run).success) {
      extinguish(ctx, fire, actor);
      return;
    }
    const attempt = Math.max(1, Math.floor(num(run.params?.attempt, 1)));
    bubble(ctx, actor, 'fire', 'shout', false);
    if (attempt < MAX_FIRE_ATTEMPTS) {
      // same source AND priority: a summoned (critical) firefighter keeps at it instead of dropping back to normal
      ctx.queue(actor, { interactionId: IX.fightFire, target: { kind: 'object', id: fire.id }, params: { attempt: attempt + 1 }, source: run.source, priority: run.priority, front: true });
    }
  },
};

// ─────────────────────────────── plants & flavour ───────────────────────────────

export const feedPlantBehavior: InteractionBehavior = {
  completeStage(ctx, _actor, run) {
    const plant = queuedObject(ctx, run);
    if (plant) setData(ctx, plant, DATA.lastFedTick, ctx.state.tick);
  },
  adjustScore(ctx, actor, def, target, score) {
    const plant = targetObject(ctx, target);
    const fed = plant?.data?.[DATA.lastFedTick];
    if (!isNum(fed)) return leisureScore(ctx, actor, def, score + 4);
    return leisureScore(ctx, actor, def, (ctx.state.tick - fed) * TICK_MINUTES >= 24 * 60 ? score + 4 : score - 6);
  },
};

const POOLS: Record<string, readonly string[]> = { epitaph: EPITAPHS, fern: FERN_LINES, kitManual: KIT_MANUAL_LINES };
const POOL_TITLES: Record<string, string> = { epitaph: 'The epitaph reads…', fern: 'The fern', kitManual: 'Reanimation Kit manual' };

export const epitaphBehavior: InteractionBehavior = {
  adjustScore(ctx, actor, def, _target, score) {
    return leisureScore(ctx, actor, def, score);
  },
  completeStage(ctx, actor, run, def) {
    const pool = str(def.params?.pool, 'epitaph');
    const line = pickLine(ctx, POOLS[pool] ?? EPITAPHS, '');
    if (!line) return;
    bubble(ctx, actor, pool === 'epitaph' ? 'skull' : pool === 'fern' ? 'plant' : 'book', 'thought', true);
    if (run.source === 'player') ctx.notify({ kind: 'info', title: POOL_TITLES[pool] ?? 'You read…', text: line, agentId: actor.id });
  },
};

