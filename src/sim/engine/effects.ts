/** Engine effect handlers (README §2). Params come from content data, so every read is defensive. */
import type { EffectContext, EffectHandler } from '../contracts';
import { BUBBLE_ICONS, FX_KINDS } from '../contracts';
import type { AgentState, NotificationKind, ObjectState, TargetRef } from '../types';
import { CARRY_ITEMS } from '../../shared/appearance';
import type { CarryItem } from '../../shared/appearance';
import { SFX_IDS, VOICE_EMOTIONS } from '../../shared/audioIds';
import type { SfxId, VoiceEmotion } from '../../shared/audioIds';
import { ENGINE_EFFECTS } from '../vocabulary';
import { isPresence } from './agents';
import { recordFault } from './faults';
import { isNeedId, isSkillId, traitMult } from './needs';
import { markChanged, objectCenter, objectName, spawnObject, tryObjectDef } from './objects';
import type { Engine } from './types';
import { cleanParams, isNum, str } from './util';

const NOTIFY_KINDS: readonly NotificationKind[] = ['info', 'good', 'bad', 'warning', 'money', 'career', 'social', 'decay', 'romance', 'skill'];
const BUBBLE_SET = new Set<string>(BUBBLE_ICONS);
const FX_SET = new Set<string>(FX_KINDS);
const SFX_SET = new Set<string>(SFX_IDS);
const VOICE_SET = new Set<string>(VOICE_EMOTIONS);
const CARRY_SET = new Set<string>(CARRY_ITEMS);

function subjects(ec: EffectContext, who: unknown): AgentState[] {
  const out: AgentState[] = [];
  const w = who === 'target' || who === 'both' ? who : 'actor';
  if ((w === 'actor' || w === 'both') && ec.actor) out.push(ec.actor);
  if ((w === 'target' || w === 'both') && ec.targetAgent && ec.targetAgent !== ec.actor) out.push(ec.targetAgent);
  return out;
}

export function fillText(eng: Engine, ec: EffectContext, text: unknown, amount?: unknown): string {
  const s = typeof text === 'string' ? text : '';
  return s
    .replace(/\{actor\}/g, ec.actor ? ec.actor.firstName : 'Someone')
    .replace(/\{target\}/g, ec.targetAgent ? ec.targetAgent.firstName : ec.targetObject ? objectName(eng, ec.targetObject) : 'someone')
    .replace(/\{object\}/g, ec.targetObject ? objectName(eng, ec.targetObject) : 'it')
    .replace(/\{amount\}/g, isNum(amount) ? String(Math.round(amount)) : String(amount ?? ''));
}

function moneyKey(eng: Engine, ec: EffectContext, p: Record<string, any>, kind: string): string | undefined {
  if (eng.effectKey) return `${eng.effectKey}:${kind}`;
  if (ec.choice) return `choice:${ec.choice.id}:${kind}`;
  return typeof p.key === 'string' && p.key ? p.key : undefined;
}

function failRun(eng: Engine, ec: EffectContext, reason: string): void {
  if (ec.run) eng.pendingFail.set(ec.run.uid, reason);
}

function jsonValue(v: unknown): string | number | boolean | null | undefined {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

function substituteData(ec: EffectContext, data: unknown, tick: number): ObjectState['data'] {
  const out: ObjectState['data'] = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [k, raw] of Object.entries(data as Record<string, unknown>)) {
    let v: unknown = raw;
    if (raw === '$tick') v = tick;
    else if (raw === '$actor') v = ec.actor ? ec.actor.id : null;
    else if (raw === '$target') v = ec.targetAgent ? ec.targetAgent.id : null;
    const j = jsonValue(v);
    if (j !== undefined) out[k] = j;
  }
  return out;
}

function floorNear(eng: Engine, defId: string, near: { x: number; z: number }, data: ObjectState['data']): ObjectState | null {
  let t: { x: number; z: number } | null = null;
  try {
    t = eng.spatial.nearestWalkable(near, 6);
  } catch (e) {
    recordFault(eng, 'spatial.nearestWalkable', e);
  }
  if (!t) return null;
  return spawnObject(eng, defId, { kind: 'loose', x: t.x + 0.5, z: t.z + 0.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data });
}

export function engineEffects(eng: Engine): Record<string, EffectHandler> {
  const E = ENGINE_EFFECTS;
  const h: Record<string, EffectHandler> = {
    [E.needs](ctx, ec, p) {
      const deltas = p && typeof p.deltas === 'object' && p.deltas ? (p.deltas as Record<string, unknown>) : {};
      for (const a of subjects(ec, p?.who)) {
        for (const [need, d] of Object.entries(deltas)) if (isNeedId(need) && isNum(d)) ctx.changeNeed(a, need, d, { raw: !!p.raw });
      }
    },
    [E.moodlet](ctx, ec, p) {
      const id = str(p?.id, '');
      if (!id) return;
      if (isNum(p.chance) && p.chance < 1 && !ctx.rng.chance(p.chance)) return;
      for (const a of subjects(ec, p.who)) {
        const src = a === ec.actor ? (ec.targetAgent?.id ?? ec.targetObject?.id ?? null) : (ec.actor?.id ?? null);
        ctx.addMoodlet(a, id, { sourceId: src, durationMin: isNum(p.durationMin) ? p.durationMin : undefined });
      }
    },
    [E.removeMoodlet](ctx, ec, p) {
      const id = str(p?.id, '');
      if (id) for (const a of subjects(ec, p.who)) ctx.removeMoodlet(a, id);
    },
    [E.xp](ctx, ec, p) {
      if (!isSkillId(p?.skill) || !isNum(p.amount)) return;
      for (const a of subjects(ec, p.who)) ctx.addXp(a, p.skill, p.amount);
    },
    [E.spend](ctx, ec, p) {
      const amount = isNum(p?.amount) ? p.amount : NaN;
      if (!isNum(amount) || amount < 0) throw new Error('spend: bad amount');
      const ok = ctx.spend(amount, str(p.reason, ec.def ? ec.def.label : 'Purchase'), moneyKey(eng, ec, p, 'spend'), { autonomous: !!ec.run && ec.run.source === 'auto' });
      if (!ok) failRun(eng, ec, "Can't afford");
    },
    [E.earn](ctx, ec, p) {
      const amount = isNum(p?.amount) ? p.amount : NaN;
      if (!isNum(amount) || amount < 0) throw new Error('earn: bad amount');
      ctx.earn(amount, str(p.reason, 'Income'), moneyKey(eng, ec, p, 'earn'));
    },
    [E.notify](ctx, ec, p) {
      const kind = NOTIFY_KINDS.includes(p?.kind) ? (p.kind as NotificationKind) : 'info';
      ctx.notify({
        kind,
        title: fillText(eng, ec, p?.title, p?.amount) || 'Notice',
        text: fillText(eng, ec, p?.text, p?.amount),
        agentId: ec.actor ? ec.actor.id : null,
        objectId: ec.targetObject ? ec.targetObject.id : null,
      });
    },
    [E.bubble](ctx, ec, p) {
      if (!BUBBLE_SET.has(p?.icon)) return;
      const style = p.style === 'speech' || p.style === 'shout' ? p.style : 'thought';
      for (const a of subjects(ec, p.who)) ctx.emit({ type: 'bubble', agentId: a.id, icon: p.icon, style, positive: p.positive === true ? true : undefined });
    },
    [E.fx](ctx, ec, p) {
      if (!FX_SET.has(p?.kind)) return;
      if (p.who === 'object') {
        if (ec.targetObject) ctx.emit({ type: 'fx', kind: p.kind, objectId: ec.targetObject.id, pos: objectCenter(eng, ec.targetObject) });
        return;
      }
      for (const a of subjects(ec, p.who)) ctx.emit({ type: 'fx', kind: p.kind, agentId: a.id, pos: { x: a.pos.x, z: a.pos.z } });
    },
    [E.sfx](ctx, ec, p) {
      if (!SFX_SET.has(p?.id)) return;
      const id = p.id as SfxId;
      if (ec.actor) ctx.emit({ type: 'sfx', id, agentId: ec.actor.id, pos: { x: ec.actor.pos.x, z: ec.actor.pos.z } });
      else if (ec.targetObject) ctx.emit({ type: 'sfx', id, objectId: ec.targetObject.id, pos: objectCenter(eng, ec.targetObject) });
      else ctx.emit({ type: 'sfx', id });
    },
    [E.voice](ctx, ec, p) {
      if (!VOICE_SET.has(p?.emotion)) return;
      const durationMs = isNum(p.durationMs) && p.durationMs > 0 ? Math.min(10000, p.durationMs) : 1200;
      for (const a of subjects(ec, p.who)) ctx.emit({ type: 'voice', agentId: a.id, emotion: p.emotion as VoiceEmotion, durationMs });
    },
    [E.spawnItem](ctx, ec, p) {
      const defId = str(p?.defId, '');
      if (!eng.content.objects[defId]) throw new Error(`spawnItem: unknown object def '${defId}'`);
      const data = substituteData(ec, p.data, eng.state.tick);
      const at = str(p.at, 'actorSurface');
      let obj: ObjectState | null = null;
      const actorPos = ec.actor ? { x: ec.actor.pos.x, z: ec.actor.pos.z } : null;
      const targetPos = ec.targetObject ? objectCenter(eng, ec.targetObject) : actorPos;
      if (at === 'held') {
        if (!ec.actor) throw new Error('spawnItem held: no actor');
        obj = spawnObject(eng, defId, { kind: 'held', agentId: ec.actor.id }, { data });
      } else if (at === 'targetSurface' && targetPos) {
        obj = ctx.placeItemNear(defId, targetPos, { data, preferSurfaceOf: ec.targetObject ? ec.targetObject.id : null });
      } else if (at === 'actorFloor' && actorPos) {
        obj = floorNear(eng, defId, actorPos, data);
      } else if (at === 'targetFloor' && targetPos) {
        obj = floorNear(eng, defId, targetPos, data);
      } else if (actorPos) {
        obj = ctx.placeItemNear(defId, actorPos, { data });
      }
      if (!obj) {
        // A packed lot is a gameplay situation, not a code fault: fail the run with a reason the player understands.
        const noun = (tryObjectDef(eng, defId)?.name ?? 'item').toLowerCase();
        if (ec.run) return failRun(eng, ec, `There's no room to put the ${noun} down`);
        throw new Error(`spawnItem: no room for '${defId}'`);
      }
      if (ec.run) ec.run.data.spawnedId = obj.id;
    },
    [E.removeTarget](ctx, ec) {
      const o = ec.targetObject;
      if (o && eng.state.objects[o.id]) ctx.removeObject(o.id, `The ${objectName(eng, o).toLowerCase()} was used up`);
    },
    [E.releaseHeld](ctx, ec, p) {
      if (!ec.actor) return;
      const to = p?.to === 'destroy' || p?.to === 'surface' ? p.to : 'floor';
      ctx.releaseHeld(ec.actor, to);
    },
    [E.holdTarget](ctx, ec) {
      const o = ec.targetObject;
      if (!ec.actor || !o || !eng.state.objects[o.id]) return failRun(eng, ec, "Can't pick that up");
      const k = o.placement.kind;
      if (k === 'held' && o.placement.kind === 'held' && o.placement.agentId === ec.actor.id) return;
      if (k !== 'loose') return failRun(eng, ec, "Can't pick that up");
      ctx.holdItem(ec.actor, o);
    },
    [E.setTargetData](ctx, ec, p) {
      const o = ec.targetObject;
      const key = str(p?.key, '');
      const v = jsonValue(p?.value);
      if (!o || !key || v === undefined) return;
      o.data[key] = v;
      ctx.markChanged(o);
    },
    [E.incTargetData](ctx, ec, p) {
      const o = ec.targetObject;
      const key = str(p?.key, '');
      if (!o || !key || !isNum(p?.amount)) return;
      const cur = o.data[key];
      o.data[key] = (isNum(cur) ? cur : 0) + p.amount;
      ctx.markChanged(o);
    },
    [E.breakChance](ctx, ec, p) {
      const o = ec.targetObject;
      if (!o || o.condition.broken) return;
      const def = tryObjectDef(eng, o);
      let chance = isNum(p?.chance) ? p.chance : def ? def.breakChance : 0;
      if (ec.actor) chance *= traitMult(eng, ec.actor, 'breakChance');
      if (!(chance > 0) || !ctx.rng.chance(chance)) return;
      o.condition.broken = true;
      ctx.markChanged(o);
      ctx.emit({ type: 'fx', kind: 'smoke', objectId: o.id, pos: objectCenter(eng, o) });
      ctx.emit({ type: 'sfx', id: 'fail', objectId: o.id, pos: objectCenter(eng, o) });
      ctx.notify({ kind: 'bad', title: `The ${objectName(eng, o).toLowerCase()} broke!`, text: 'Someone handy should repair it.', agentId: ec.actor ? ec.actor.id : null, objectId: o.id });
    },
    [E.repair](ctx, ec) {
      const o = ec.targetObject;
      if (!o || !o.condition.broken) return;
      o.condition.broken = false;
      ctx.markChanged(o);
      ctx.notify({ kind: 'good', title: `Fixed the ${objectName(eng, o).toLowerCase()}`, text: 'Good as new. Well, good as undead.', agentId: ec.actor ? ec.actor.id : null, objectId: o.id });
    },
    [E.stat](ctx, ec, p) {
      const key = str(p?.key, '');
      if (!key) return;
      const amount = isNum(p.amount) ? p.amount : 1;
      ctx.stat(key, amount, p.perAgent && ec.actor ? ec.actor.id : null);
    },
    [E.carry](_ctx, ec, p) {
      if (!ec.actor) return;
      const item = p ? p.item : null;
      ec.actor.carrying = item === null || item === undefined ? null : CARRY_SET.has(item) ? (item as CarryItem) : ec.actor.carrying;
    },
    [E.clearDirt](ctx, ec) {
      const o = ec.targetObject;
      if (!o) return;
      o.condition.dirt = 0;
      ctx.markChanged(o);
    },
    [E.queue](ctx, ec, p) {
      if (!ec.actor) return;
      const iid = str(p?.interactionId, '');
      if (!eng.content.interactions[iid]) throw new Error(`queue effect: unknown interaction '${iid}'`);
      let target: TargetRef = { kind: 'self' };
      if (p.target === 'stageTarget' && ec.run) target = { ...ec.run.stageTarget } as TargetRef;
      else if (p.target === 'queuedTarget' && ec.run) target = { ...ec.run.target } as TargetRef;
      const source = p.source === 'player' || p.source === 'system' || p.source === 'auto' ? p.source : ec.run ? ec.run.source : 'system';
      ctx.queue(ec.actor, { interactionId: iid, target, params: cleanParams(p.params), source, front: !!p.front });
    },
    [E.leaveLot](ctx, ec, p) {
      if (!ec.actor) return;
      const pres = isPresence(p?.presence) && p.presence !== 'onLot' ? p.presence : 'offLot';
      ctx.sendOffLot(ec.actor, pres, str(p?.reason, 'Leaving'));
    },
  };
  return h;
}
