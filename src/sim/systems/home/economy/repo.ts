/**
 * The Repo Ghoul (GDD §6): 6 days overdue → a service NPC arrives, walks to the most valuable sellable objects
 * (never doors/windows/mailboxes/bone piles/urns/loose items) and repossesses them — puff! — until the taken value
 * is ≥ 1.2 × owed, then clears every outstanding bill and leaves. Paying up while it's here sends it home.
 * State in flags (save-safe); a watchdog finishes the job remotely if the ghoul can't reach things.
 */
import type { InteractionBehavior, SimContext } from '../../../contracts';
import type { ObjectState } from '../../../types';
import { FLAG, IX, MOOD, STAT } from '../../../content/home/ids';
import { createServiceAgent } from '../services';
import {
  centerOf,
  clearFlag,
  compareIds,
  defOf,
  flagNum,
  flagStr,
  getAgent,
  getObj,
  livingMembers,
  minutesSince,
  moneyLabel,
  num,
  objName,
  queuedObject,
  runData,
  setFlag,
  sortedObjects,
} from '../util';
import { BILL_STAGE, owed, restorePower, syncBillMoodlets, unpaidBills } from './bills';
import { syncMailboxes } from './mail';
import { guardClear, guardDelaysRepo } from '../../pets/guard';

export const REPO_VALUE_FACTOR = 1.2;
export const REPO_WATCHDOG_MIN = 4 * 60;
export const REPO_MAX_QUEUED = 10;

const EXCLUDED_TAGS = ['door', 'window', 'mailbox', 'bonePile', 'urn'];

export function repoEligible(ctx: SimContext, o: ObjectState): boolean {
  const def = defOf(ctx, o);
  if (!def || !def.sellable || def.category === 'item') return false;
  if (o.placement.kind !== 'floor' && o.placement.kind !== 'wall') return false;
  if (o.condition?.burning) return false;
  return !def.tags.some((t) => EXCLUDED_TAGS.includes(t));
}

/** Most valuable first until the taken value reaches 1.2 × owed. */
export function chooseRepoTargets(ctx: SimContext, amountOwed: number): ObjectState[] {
  const goal = Math.max(0, amountOwed) * REPO_VALUE_FACTOR;
  const pool = sortedObjects(ctx)
    .filter((o) => repoEligible(ctx, o))
    .sort((a, b) => num(b.value, 0) - num(a.value, 0) || compareIds(a.id, b.id));
  const out: ObjectState[] = [];
  let sum = 0;
  for (const o of pool) {
    if (sum >= goal) break;
    out.push(o);
    sum += Math.max(0, num(o.value, 0));
  }
  return out;
}

export function repoActive(ctx: SimContext): boolean {
  return flagStr(ctx, FLAG.repoNpc, '') !== '';
}

function targetIds(ctx: SimContext): string[] {
  return flagStr(ctx, FLAG.repoTargets, '')
    .split(',')
    .filter((s) => s.length > 0);
}

/** Remove one object with the repo puff. Returns its value (0 if it was already gone). */
export function repossessObject(ctx: SimContext, id: string): number {
  const obj = getObj(ctx, id);
  if (!obj || !repoEligible(ctx, obj)) return 0;
  const value = Math.max(0, num(obj.value, 0));
  const pos = centerOf(ctx, obj);
  const name = objName(ctx, obj);
  ctx.removeObject(obj.id, 'Repossessed');
  ctx.emit({ type: 'fx', kind: 'puff', pos });
  ctx.emit({ type: 'sfx', id: 'repoGhoul', pos });
  setFlag(ctx, FLAG.repoTaken, flagNum(ctx, FLAG.repoTaken, 0) + value);
  ctx.notify({ kind: 'bad', title: 'Repossessed', text: `The Repo Ghoul took the ${name}. Poof.` });
  return value;
}

export function dispatchRepo(ctx: SimContext): boolean {
  if (repoActive(ctx)) return false;
  const amount = owed(ctx);
  if (amount <= 0) return false;
  const hh = ctx.state.household;
  const day = num(ctx.time?.day, 0);
  if (hh && hh.repoDispatchedDay === day) return false;
  // a Guard pet (W-013) barks the ghoul off for a while; asked again next hour until it is out of holds
  if (guardDelaysRepo(ctx)) return false;
  guardClear(ctx);
  const targets = chooseRepoTargets(ctx, amount);
  for (const b of unpaidBills(ctx)) b.stage = Math.max(b.stage, BILL_STAGE.repo);
  if (hh) hh.repoDispatchedDay = day;
  setFlag(ctx, FLAG.repoOwed, amount);
  setFlag(ctx, FLAG.repoTaken, 0);
  setFlag(ctx, FLAG.repoTargets, targets.map((t) => t.id).join(','));
  setFlag(ctx, FLAG.repoStart, ctx.state.tick);
  ctx.stat(STAT.repossessions, 1);
  ctx.emit({ type: 'music', mood: 'tense' });

  const npc = createServiceAgent(ctx, 'repo');
  if (npc) {
    try {
      ctx.spawnAgent(npc.id);
    } catch {
      /* handled below */
    }
  }
  if (!npc || npc.presence !== 'onLot') {
    finishRepo(ctx, 'remote');
    return true;
  }
  setFlag(ctx, FLAG.repoNpc, npc.id);
  let queued = 0;
  for (const t of targets.slice(0, REPO_MAX_QUEUED)) {
    if (ctx.queue(npc, { interactionId: IX.repossess, target: { kind: 'object', id: t.id }, source: 'system' })) queued++;
  }
  ctx.emit({ type: 'sfx', id: 'repoGhoul', agentId: npc.id });
  ctx.notify({
    kind: 'bad',
    title: 'The Repo Ghoul is here',
    text: `You owe ${moneyLabel(amount)}. A ghoul in a hi-vis vest is shuffling toward your nicest things with a clipboard. Pay now and it might leave empty-handed.`,
    agentId: npc.id,
  });
  if (queued === 0) finishRepo(ctx, 'remote');
  return true;
}

/**
 * Wrap up: anything still owed is covered by taking the remaining targets remotely; bills cleared; power back on;
 * household gets Repossessed; the ghoul leaves. `paid` = the household paid while it was here (nothing more taken).
 */
export function finishRepo(ctx: SimContext, why: 'done' | 'remote' | 'paid' | 'timeout'): void {
  const npc = getAgent(ctx, flagStr(ctx, FLAG.repoNpc, ''));
  if (why !== 'paid') {
    const goal = flagNum(ctx, FLAG.repoOwed, owed(ctx)) * REPO_VALUE_FACTOR;
    for (const id of targetIds(ctx)) {
      if (flagNum(ctx, FLAG.repoTaken, 0) >= goal) break;
      repossessObject(ctx, id);
    }
    for (const b of unpaidBills(ctx)) {
      b.paidTick = ctx.state.tick;
      b.stage = BILL_STAGE.repo;
    }
    for (const m of livingMembers(ctx)) ctx.addMoodlet(m, MOOD.repossessed);
    ctx.notify({
      kind: 'bad',
      title: 'Debts settled (the hard way)',
      text: `The Repo Ghoul took ${moneyLabel(flagNum(ctx, FLAG.repoTaken, 0))} worth of furniture and tore up the bills. The house echoes a little now.`,
    });
  } else {
    ctx.notify({ kind: 'good', title: 'Repo Ghoul sent packing', text: 'Paid in full! The Repo Ghoul sighs, tucks away its clipboard and shuffles off, disappointed.' });
  }
  restorePower(ctx);
  syncBillMoodlets(ctx);
  syncMailboxes(ctx);
  clearFlag(ctx, FLAG.repoNpc);
  clearFlag(ctx, FLAG.repoTargets);
  clearFlag(ctx, FLAG.repoOwed);
  clearFlag(ctx, FLAG.repoStart);
  clearFlag(ctx, FLAG.repoTaken);
  ctx.emit({ type: 'music', mood: 'normal' });
  if (npc && npc.presence === 'onLot') {
    try {
      ctx.sendOffLot(npc, 'gone', 'Job done');
    } catch {
      npc.presence = 'gone';
    }
  }
}

function hasPendingRepoWork(ctx: SimContext, npcId: string): boolean {
  const npc = getAgent(ctx, npcId);
  if (!npc) return false;
  if (npc.active && npc.active.interactionId === IX.repossess) return true;
  return Array.isArray(npc.queue) && npc.queue.some((q) => q.interactionId === IX.repossess);
}

/** Per-tick: paid off → leave; job done / ghoul gone / timed out → finish. */
export function tickRepo(ctx: SimContext): void {
  const npcId = flagStr(ctx, FLAG.repoNpc, '');
  if (!npcId) return;
  const npc = getAgent(ctx, npcId);
  if (owed(ctx) <= 0) {
    if (npc && npc.presence === 'onLot') {
      for (const q of (npc.queue ?? []).slice()) ctx.cancel(npc, q.uid, 'Paid in full');
    }
    finishRepo(ctx, 'paid');
    return;
  }
  if (!npc || npc.presence !== 'onLot') {
    finishRepo(ctx, 'remote');
    return;
  }
  if (minutesSince(ctx, flagNum(ctx, FLAG.repoStart, ctx.state.tick)) > REPO_WATCHDOG_MIN) {
    finishRepo(ctx, 'timeout');
    return;
  }
  if (!hasPendingRepoWork(ctx, npcId)) finishRepo(ctx, 'done');
}

export const repossessBehavior: InteractionBehavior = {
  startStage(ctx, _actor, run) {
    const obj = queuedObject(ctx, run);
    if (!obj || !repoEligible(ctx, obj)) return 'Already gone';
    return null;
  },
  completeStage(ctx, _actor, run) {
    runData(run).take = true;
  },
  end(ctx, _actor, run, _def, outcome) {
    if (outcome !== 'complete' || !runData(run).take) return;
    if (owed(ctx) <= 0) return; // paid while the ghoul was reaching for it
    const goal = flagNum(ctx, FLAG.repoOwed, owed(ctx)) * REPO_VALUE_FACTOR;
    if (flagNum(ctx, FLAG.repoTaken, 0) >= goal) return;
    const obj = queuedObject(ctx, run);
    if (obj) repossessObject(ctx, obj.id);
  },
};
