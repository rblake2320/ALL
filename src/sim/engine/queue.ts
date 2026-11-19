/** Queue management: insertion order, cancel, interrupt, suspension (README §7). */
import type { AgentState, QueueItem, QueueSource, TargetRef } from '../types';
import { ENGINE_INTERACTIONS, PRIORITY } from '../vocabulary';
import { HARD_QUEUE_CAP } from './constants';
import { isIdleInteraction } from './content';
import { recordFault } from './faults';
import type { Engine } from './types';
import { cleanParams, isNum, isTargetRef } from './util';
import { finishRun, requestCancel } from './runner';
import { dropOrder } from './orders';

export function defaultPriority(source: QueueSource): number {
  return source === 'player' ? PRIORITY.player : source === 'system' ? PRIORITY.system : PRIORITY.auto;
}

function insertSorted(queue: QueueItem[], item: QueueItem, front: boolean): void {
  let i = 0;
  if (front) {
    while (i < queue.length && queue[i].priority > item.priority) i++;
  } else {
    while (i < queue.length && queue[i].priority >= item.priority) i++;
  }
  queue.splice(i, 0, item);
}

export function queueItem(
  eng: Engine,
  agent: AgentState,
  item: {
    interactionId: string;
    target: TargetRef;
    params?: Record<string, string | number | boolean>;
    source: QueueSource;
    priority?: number;
    front?: boolean;
  },
): QueueItem | null {
  if (!agent || !item) return null;
  const def = eng.content.interactions[item.interactionId];
  if (!def) {
    recordFault(eng, 'queue', `unknown interaction '${String(item.interactionId)}'`);
    return null;
  }
  if (agent.presence !== 'onLot') return null;
  if (!isTargetRef(item.target)) {
    recordFault(eng, 'queue', `bad target for '${item.interactionId}'`);
    return null;
  }
  if (!Array.isArray(agent.queue)) agent.queue = [];
  const source: QueueSource = item.source === 'player' || item.source === 'system' ? item.source : 'auto';
  const priority = isNum(item.priority) ? item.priority : defaultPriority(source);
  if (agent.queue.length >= HARD_QUEUE_CAP) {
    // A full queue still admits something that outranks its last item (a pass-out or feral meal must never be
    // locked out by a long to-do list): the lowest-priority, most recently queued item makes room.
    let low = 0;
    for (let i = 1; i < agent.queue.length; i++) if (agent.queue[i].priority <= agent.queue[low].priority) low = i;
    if (!(priority > agent.queue[low].priority)) return null;
    const [bumped] = agent.queue.splice(low, 1);
    if (bumped) dropOrder(eng, agent, bumped, 'queueFull');
  }
  const qi: QueueItem = {
    uid: eng.ctx.newUid(),
    interactionId: def.id,
    target: { ...item.target } as TargetRef,
    params: cleanParams(item.params),
    source,
    priority,
    queuedTick: eng.state.tick,
  };
  insertSorted(agent.queue, qi, !!item.front);
  return qi;
}

/**
 * Can the player cancel this active run? The contract flag is `interruptible` ("can be cancelled once running"):
 * hidden system items such as Go to Work stay cancellable while interruptible. The lot exit is the exception —
 * ctx.sendOffLot always restarts it, so offering a cancel would be a lie.
 */
export function playerCancellable(eng: Engine, run: { interactionId: string; phase: string }): boolean {
  const def = eng.content.interactions[run.interactionId];
  if (!def || run.interactionId === ENGINE_INTERACTIONS.exitLot || run.phase === 'exit') return false;
  return def.interruptible !== false || run.phase !== 'run';
}

/** Cancel a queued or active item. `player` respects the interruptible flag. */
export function cancelItem(eng: Engine, agent: AgentState, uid: number, reason?: string, player = false): boolean | string {
  if (agent.active && agent.active.uid === uid) {
    const run = agent.active;
    if (player && run.phase !== 'exit' && !playerCancellable(eng, run)) return "Can't stop now";
    requestCancel(eng, agent, reason ?? 'Canceled');
    return true;
  }
  const i = agent.queue.findIndex((q) => q.uid === uid);
  if (i >= 0) {
    if (player && agent.queue[i].interactionId === ENGINE_INTERACTIONS.exitLot) return "Can't stop now";
    agent.queue.splice(i, 1);
    return true;
  }
  return false;
}

/** Re-queueable copy of an interrupted item (new uid; keeps idempotency keys via _origUid). */
export function requeueCopy(eng: Engine, agent: AgentState, item: QueueItem): QueueItem | null {
  if (isIdleInteraction(item.interactionId) || item.interactionId === ENGINE_INTERACTIONS.respond) return null;
  if (item.interactionId === ENGINE_INTERACTIONS.passOut || item.interactionId === ENGINE_INTERACTIONS.exitLot) return null;
  if (item.params.partnerOf !== undefined) return null; // pair halves are re-created by their actor
  const params = { ...item.params };
  if (params._origUid === undefined) params._origUid = item.uid;
  const run = agent.active && agent.active.uid === item.uid ? agent.active : null;
  if (run && run.data._c) params._costPaid = true;
  const copy = queueItem(eng, agent, {
    interactionId: item.interactionId,
    target: item.target,
    params,
    source: item.source,
    priority: item.priority,
    front: true,
  });
  // W-131: an interrupted order that no longer fits a full queue is lost — say so instead of dropping it silently
  if (!copy && item.source !== 'auto' && agent.presence === 'onLot') dropOrder(eng, agent, item, 'queueFull');
  return copy;
}

/**
 * Immediately end the agent's current run so something else can start now (social respond, pair partner,
 * critical override). Player/system items (and auto items when `keepAuto`) are re-queued at the front.
 */
export function suspendActive(eng: Engine, agent: AgentState, reason: string, keepAuto: boolean): void {
  const run = agent.active;
  if (!run) return;
  if (run.source !== 'auto' || keepAuto) requeueCopy(eng, agent, run);
  finishRun(eng, agent, 'canceled', reason, { silent: true });
}
