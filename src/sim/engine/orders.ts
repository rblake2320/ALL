/**
 * W-131 order trace: a queued item that leaves the queue WITHOUT starting and without a failure notice used to vanish
 * silently (its target object removed, the agent leaving the lot, a full queue bumping it). The player saw their order
 * simply not happen. Every such drop now goes through `dropOrder`:
 *  - always emits `orderDropped` (closed `cause` vocabulary) so the session log and tools can see it;
 *  - for a PLAYER order bumped by a removed target or a full queue, also posts a "dropped" notice saying why.
 *    Leaving the lot is expected (work, school, an outing) and already announced, so it is event-only.
 */
import type { OrderDropCause } from '../contracts';
import type { AgentState, QueueItem } from '../types';
import { interactionLabel } from './labels';
import type { Engine } from './types';

export function dropOrder(eng: Engine, agent: AgentState, item: QueueItem, cause: OrderDropCause, reason?: string): void {
  eng.ctx.emit({ type: 'orderDropped', agentId: agent.id, uid: item.uid, interactionId: item.interactionId, source: item.source, cause });
  if (item.source !== 'player' || cause === 'leftLot') return;
  const def = eng.content.interactions[item.interactionId];
  let label = 'that';
  if (def) {
    try {
      label = interactionLabel(eng, agent, def, item.target, item.params) || def.label || 'that';
    } catch {
      label = def.label || 'that';
    }
  }
  const lower = label.length > 0 ? label[0].toLowerCase() + label.slice(1) : label;
  eng.ctx.notify({
    kind: 'bad',
    title: `${agent.firstName} dropped ${lower}`,
    text: cause === 'queueFull' ? 'Too many orders queued — something more urgent took its place.' : reason || "It's gone.",
    agentId: agent.id,
    objectId: item.target.kind === 'object' && eng.state.objects[item.target.id] ? item.target.id : null,
  });
}

/** Drop every queued item of `agent` matching `pred` (in queue order), reporting each. */
export function dropQueued(eng: Engine, agent: AgentState, pred: (q: QueueItem) => boolean, cause: OrderDropCause, reason?: string): void {
  if (!Array.isArray(agent.queue) || agent.queue.length === 0) return;
  const kept: QueueItem[] = [];
  const dropped: QueueItem[] = [];
  for (const q of agent.queue) (pred(q) ? dropped : kept).push(q);
  if (dropped.length === 0) return;
  agent.queue = kept;
  for (const q of dropped) dropOrder(eng, agent, q, cause, reason);
}
