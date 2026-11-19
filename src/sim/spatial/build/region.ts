/** Build/buy edits the household home. Every region has its own local coordinate frame. */
import { homeRegionIdOf } from '../../../shared/town';
import type { AgentState, ObjectState, WorldState } from '../../types';

export function agentAtBuildHome(state: WorldState, agent: AgentState): boolean {
  const home = homeRegionIdOf(state);
  return (agent.regionId ?? home) === home;
}

/** A read-only index: values remain live objects, but inserts/deletes must use the transaction's global map. */
export function buildHomeObjects(state: Pick<WorldState, 'objects' | 'town'> & Partial<Pick<WorldState, 'agents'>>): Record<string, ObjectState> {
  const home = homeRegionIdOf(state);
  const out: Record<string, ObjectState> = Object.create(null);
  const objects = state.objects && typeof state.objects === 'object' ? state.objects : {};
  for (const id of Object.keys(objects)) {
    const obj = objects[id];
    if (!obj || typeof obj !== 'object') continue;
    const holder = obj.placement?.kind === 'held' ? state.agents?.[obj.placement.agentId] : undefined;
    const region = holder ? holder.regionId ?? home : obj.regionId ?? home;
    if (region === home) out[id] = obj;
  }
  return out;
}
