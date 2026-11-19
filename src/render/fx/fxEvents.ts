/**
 * Where an FX event happens: an explicit tile position (+y), else the agent's rendered feet (or its sim pos),
 * else an object's bounds (a little below its middle — bursts add their own heights). Pure; unit-tested.
 */
import type { SimEvent } from '../../sim/contracts';

export interface FxAnchorSources {
  agentPos(id: string): { x: number; y: number; z: number } | null;
  agentSimPos(id: string): { x: number; y: number; z: number } | null;
  objectBounds(id: string): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
}

export function fxAnchor(ev: Extract<SimEvent, { type: 'fx' }>, src: FxAnchorSources, out: { x: number; y: number; z: number }): boolean {
  if (!ev || typeof ev !== 'object') return false;
  if (ev.pos && Number.isFinite(ev.pos.x) && Number.isFinite(ev.pos.z)) {
    out.x = ev.pos.x;
    out.z = ev.pos.z;
    out.y = typeof ev.y === 'number' && Number.isFinite(ev.y) ? ev.y : 0;
    return true;
  }
  if (typeof ev.agentId === 'string') {
    const p = src.agentPos(ev.agentId) ?? src.agentSimPos(ev.agentId);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      out.x = p.x;
      out.y = Number.isFinite(p.y) ? p.y : 0;
      out.z = p.z;
      return true;
    }
    return false;
  }
  if (typeof ev.objectId === 'string') {
    const b = src.objectBounds(ev.objectId);
    if (b && Number.isFinite(b.min.x) && Number.isFinite(b.max.x) && Number.isFinite(b.min.z) && Number.isFinite(b.max.z)) {
      out.x = (b.min.x + b.max.x) / 2;
      out.z = (b.min.z + b.max.z) / 2;
      const y0 = Number.isFinite(b.min.y) ? b.min.y : 0;
      const h = Number.isFinite(b.max.y) ? b.max.y - y0 : 0;
      out.y = y0 + Math.max(0, h * 0.5 - 0.3);
      return true;
    }
  }
  return false;
}
