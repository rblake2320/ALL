/** checkInvariants(): human-readable violations of world-state invariants (empty = healthy). */
import { NEED_IDS, SKILL_IDS, SKILL_MAX_LEVEL } from '../types';
import { HARD_QUEUE_CAP, MAX_NOTIFICATIONS } from './constants';
import { isPosed } from './movement';
import { needCap } from './needs';
import type { Engine } from './types';
import { idNumber, isNum } from './util';
import { isAgentInActiveRegion, withAgentRegion } from './regions';

export function checkInvariantsOf(eng: Engine): string[] {
  const s = eng.state;
  const out: string[] = [];
  const v = (msg: string) => {
    if (out.length < 200) out.push(msg);
  };
  if (!isNum(s.household.funds) || s.household.funds < 0 || !Number.isInteger(s.household.funds)) v(`funds invalid: ${s.household.funds}`);
  if (!isNum(s.tick) || s.tick < 0) v(`tick invalid: ${s.tick}`);
  let maxId = 0;
  const uids = new Set<number>();
  for (const [key, a] of Object.entries(s.agents)) {
    if (a.id !== key) v(`agent key ${key} != id ${a.id}`);
    const n = idNumber(a.id);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
    if (!a.needs || typeof a.needs !== 'object') {
      v(`${a.id}.needs missing`);
      continue;
    }
    for (const need of NEED_IDS) {
      const val = a.needs[need];
      if (!isNum(val)) v(`${a.id}.${need} is not finite`);
      else if (val < -1e-9 || val > needCap(a, need) + 1e-9) v(`${a.id}.${need}=${val} outside [0, ${needCap(a, need)}]`);
    }
    if (!isNum(a.vitality) || a.vitality < 20 - 1e-9 || a.vitality > 100 + 1e-9) v(`${a.id}.vitality=${a.vitality} outside [20,100]`);
    for (const sk of SKILL_IDS) {
      const st = a.skills ? a.skills[sk] : undefined;
      if (!st || !isNum(st.level) || st.level < 0 || st.level > SKILL_MAX_LEVEL || !isNum(st.xp) || st.xp < 0) v(`${a.id}.skills.${sk} invalid`);
    }
    if (!Array.isArray(a.moodlets)) v(`${a.id}.moodlets is not a list`);
    for (const m of Array.isArray(a.moodlets) ? a.moodlets : []) {
      const def = eng.content.moodlets[m.id];
      if (!def) v(`${a.id} has unknown moodlet ${m.id}`);
      else if (!isNum(m.stacks) || m.stacks < 1 || m.stacks > Math.max(1, def.maxStacks)) v(`${a.id} moodlet ${m.id} stacks=${m.stacks}`);
    }
    if (!Array.isArray(a.queue)) v(`${a.id}.queue is not a list`);
    const queue = Array.isArray(a.queue) ? a.queue : [];
    if (queue.length > HARD_QUEUE_CAP) v(`${a.id} queue length ${queue.length}`);
    for (const q of queue) {
      if (uids.has(q.uid)) v(`duplicate uid ${q.uid}`);
      uids.add(q.uid);
      if (!eng.content.interactions[q.interactionId]) v(`${a.id} queued unknown interaction ${q.interactionId}`);
    }
    if (a.presence !== 'onLot') {
      if (a.active) v(`${a.id} is ${a.presence} but has an active interaction`);
      if (a.path) v(`${a.id} is ${a.presence} but has a path`);
    } else {
      if (!a.pos || !isNum(a.pos.x) || !isNum(a.pos.z)) v(`${a.id} position not finite`);
      else if (isAgentInActiveRegion(eng, a)) {
        // W-025 S3: checked against the grid of the agent's own region (the home's for every pre-world agent)
        withAgentRegion(eng, a, () => {
          const t = eng.spatial.tileOf(a.pos);
          if (!eng.spatial.inBounds(t.x, t.z)) v(`${a.id} off the grid at ${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)}`);
          else if (!isPosed(a) && !eng.spatial.isWalkable(t.x, t.z)) v(`${a.id} stuck inside blocked tile ${t.x},${t.z}`);
        });
      }
    }
    const r = a.active;
    if (r) {
      if (uids.has(r.uid)) v(`duplicate uid ${r.uid}`);
      uids.add(r.uid);
      if (!eng.content.interactions[r.interactionId]) v(`${a.id} runs unknown interaction ${r.interactionId}`);
      if (r.stageTarget.kind === 'object' && !s.objects[r.stageTarget.id]) v(`${a.id} run targets missing object ${r.stageTarget.id}`);
      if (r.partnerId) {
        const p = s.agents[r.partnerId];
        if (!p) v(`${a.id} partner ${r.partnerId} missing`);
        else if ((r.phase === 'run' || r.phase === 'wait') && p.active && p.active.partnerId !== a.id && p.active.partnerId !== null) {
          v(`${a.id} partner link to ${p.id} not mutual`);
        }
      }
      if (r.slot !== null && r.stageTarget.kind === 'object') {
        const o = s.objects[r.stageTarget.id];
        if (o && (o.reservedBy ?? {})[String(r.slot)] !== a.id) v(`${a.id} run slot ${r.slot} on ${o.id} not reserved by it`);
      }
    }
    if (a.carryObjectId) {
      const o = s.objects[a.carryObjectId];
      if (!o) v(`${a.id} carries missing object ${a.carryObjectId}`);
      else if (o.placement.kind !== 'held' || o.placement.agentId !== a.id) v(`${a.id} carries ${o.id} but it is not held by them`);
    }
  }
  for (const [key, o] of Object.entries(s.objects)) {
    if (o.id !== key) v(`object key ${key} != id ${o.id}`);
    const n = idNumber(o.id);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
    if (!eng.content.objects[o.defId]) v(`object ${o.id} has unknown def ${o.defId}`);
    const rb = o.reservedBy && typeof o.reservedBy === 'object' && !Array.isArray(o.reservedBy) ? o.reservedBy : null;
    if (!rb) v(`${o.id}.reservedBy is not a map`);
    for (const [slot, who] of Object.entries(rb ?? {})) {
      const a = s.agents[who];
      if (!a) v(`${o.id} slot ${slot} reserved by missing agent ${who}`);
      else if (!a.active || a.active.stageTarget.kind !== 'object' || a.active.stageTarget.id !== o.id || String(a.active.slot) !== slot) {
        v(`${o.id} slot ${slot} reservation by ${who} is stale`);
      }
    }
    if (!Array.isArray(o.inUseBy)) v(`${o.id}.inUseBy is not a list`);
    for (const who of Array.isArray(o.inUseBy) ? o.inUseBy : []) {
      const a = s.agents[who];
      if (!a || !a.active || (a.active.data._uo !== o.id && a.active.data._ut !== o.id)) v(`${o.id} inUseBy ${who} is stale`);
    }
    if (o.placement.kind === 'held') {
      const a = s.agents[o.placement.agentId];
      if (!a || a.carryObjectId !== o.id) v(`${o.id} held by ${o.placement.agentId} who doesn't carry it`);
    }
    if (o.placement.kind === 'loose' && o.placement.parentId && !s.objects[o.placement.parentId]) v(`${o.id} rests on missing ${o.placement.parentId}`);
  }
  for (const [key, r] of Object.entries(s.relationships)) {
    if (r.a >= r.b) v(`relationship ${key} not normalised`);
    if (key !== `${r.a}|${r.b}`) v(`relationship key ${key} mismatched`);
    if (!s.agents[r.a] || !s.agents[r.b]) v(`relationship ${key} references a missing agent`);
    if (!isNum(r.friendship) || r.friendship < -100 || r.friendship > 100) v(`relationship ${key} friendship ${r.friendship}`);
    if (!isNum(r.romance) || r.romance < 0 || r.romance > 100) v(`relationship ${key} romance ${r.romance}`);
  }
  for (const id of s.household.memberIds) if (!s.agents[id]) v(`household member ${id} missing`);
  if (s.notifications.length > MAX_NOTIFICATIONS) v(`notifications ${s.notifications.length} > ${MAX_NOTIFICATIONS}`);
  const nids = new Set<number>();
  for (const n of s.notifications) {
    if (nids.has(n.id)) v(`duplicate notification id ${n.id}`);
    nids.add(n.id);
    maxId = Math.max(maxId, n.id);
  }
  for (const u of uids) maxId = Math.max(maxId, u);
  if (!isNum(s.nextId) || s.nextId <= maxId) v(`nextId ${s.nextId} <= max used id ${maxId}`);
  const cids = new Set<string>();
  for (const c of s.choices) {
    if (cids.has(c.id)) v(`duplicate choice id ${c.id}`);
    cids.add(c.id);
  }
  return out;
}
