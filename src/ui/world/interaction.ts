/** S11 adapters over the pinned shared contract. No simulation, pathfinding or second gesture classifier. */
import { classifyPointerGesture, REGION_MAX_TILES, type MapPinView, type PointerSample, type SelectedActorView, type SignView, type WorldPoint, type WorldRouteResult, type WorldRouteTarget } from '../../shared/world';
import { wt } from './strings';

const text = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const point = (p: unknown): p is WorldPoint => !!p && typeof p === 'object' && Number.isFinite((p as WorldPoint).x) && Number.isFinite((p as WorldPoint).z);
export function validRouteTarget(t: unknown): t is WorldRouteTarget {
  if (!t || typeof t !== 'object') return false;
  const p=t as WorldRouteTarget;
  return text(p.regionId) && Number.isInteger(p.x) && Number.isInteger(p.z) && p.x>=0 && p.z>=0 && p.x<REGION_MAX_TILES && p.z<REGION_MAX_TILES;
}

/** Preserve the same selected actor through a region crossing, refuse a selection change, use the canonical gesture rules. */
export function decideWorldGesture(samples: readonly PointerSample[], lastGestureEndT: number|null, actorAtDown: string|null, selected: SelectedActorView|null, target: unknown) {
  const gesture=classifyPointerGesture(samples,lastGestureEndT);
  const mayWalk=gesture==='tap' && text(actorAtDown) && selected?.agentId===actorAtDown && validRouteTarget(target);
  return { gesture, actorId: mayWalk ? actorAtDown : null, target: mayWalk ? target as WorldRouteTarget : null };
}

/** Duplicated identifiers are ambiguous: omit every copy and expose a visible invalid-data count. */
function uniqueValid<T>(items: readonly T[], id:(v:T)=>unknown, valid:(v:T)=>boolean) {
  const counts=new Map<string,number>();
  for (const item of items) { const k=id(item); if (text(k)) counts.set(k,(counts.get(k)||0)+1); }
  const accepted=items.filter(v=>valid(v) && counts.get(id(v) as string)===1);
  return { items:accepted, invalidCount:items.length-accepted.length };
}
export function preparePins(input: readonly MapPinView[]) {
  return uniqueValid(input,p=>p?.regionId,p=>!!p && text(p.regionId) && text(p.label) && text(p.statusText) && ['open','closed','locked','unfinished'].includes(p.status) && point(p.world));
}
export function prepareSigns(input: readonly SignView[], origin: WorldPoint|null) {
  const r=uniqueValid(input,s=>s?.id,s=>!!s && text(s.id) && text(s.regionId) && text(s.textKey) && text(s.text) && point(s.world));
  const distance=(s:SignView)=>point(origin) ? Math.hypot(s.world.x-origin.x,s.world.z-origin.z) : 0;
  r.items.sort((a,b)=>distance(a)-distance(b)||(a.id<b.id?-1:a.id>b.id?1:0));
  return r;
}

/** Do not present stale/malformed controller output as an arrival or a valid route. */
export function routeFeedback(result: unknown, requestedRegionId: string, label: string): {ok:boolean;message:string} {
  if (!result || typeof result!=='object') return {ok:false,message:wt('unavailable')};
  const r=result as WorldRouteResult;
  if (!validRouteTarget(r.target) || r.target.regionId!==requestedRegionId) return {ok:false,message:wt('unavailable')};
  if (r.ok===false) {
    const reason=r.reason;
    return {ok:false,message:['noPath','private','locked','unfinished'].includes(reason) ? wt(reason) : wt('unavailable')};
  }
  if (r.ok!==true || !Array.isArray(r.portals) || !r.portals.every(text) || !Number.isFinite(r.lengthTiles) || r.lengthTiles<0 || !Number.isFinite(r.etaGameMin) || r.etaGameMin<0) return {ok:false,message:wt('unavailable')};
  return {ok:true,message:wt('walking',{place:label,minutes:Math.ceil(r.etaGameMin)})};
}
