import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CameraFollowApi, MapPinView, SelectedActorView, SignView, WorldPoint, WorldRouteResult } from '../../shared/world';
import { Modal, openModalCount } from '../common/Modal';
import { preparePins, prepareSigns, routeFeedback } from './interaction';
import { wt } from './strings';
import './world.css';

export interface WorldNavigationProps {
  selected: SelectedActorView|null;
  selectedName: string;
  camera: CameraFollowApi;
  onOpenMap: () => void;
  onOpenSigns: () => void;
  /** S5 increments after a world-owned transition. A modal or text editor keeps its focus. */
  restoreFocusToken?: number|string;
  onError?: (kind:'camera'|'map'|'signs')=>void;
}

/** Reusable controls for S5/S13. They never mount their own global key listener. S5 reuses focusSelected (F). */
export function WorldNavigationControls({selected,selectedName,camera,onOpenMap,onOpenSigns,restoreFocusToken,onError}:WorldNavigationProps) {
  const proxy=useRef<HTMLButtonElement>(null);
  const [message,setMessage]=useState('');
  const previousToken=useRef(restoreFocusToken);
  const previousActor=useRef(selected?.agentId);
  useLayoutEffect(()=> {
    const changed=previousToken.current!==restoreFocusToken;
    previousToken.current=restoreFocusToken;
    if (previousActor.current!==selected?.agentId) setMessage('');
    previousActor.current=selected?.agentId;
    const active=typeof document==='undefined'?null:document.activeElement;
    const editing=active instanceof HTMLElement && !!active.closest('input,textarea,select,[contenteditable="true"]');
    if (changed && selected && !editing && openModalCount()===0) proxy.current?.focus({preventScroll:true});
  },[restoreFocusToken,selected?.agentId]);
  const recentre=()=> {
    if (!selected) {setMessage(wt('select'));return;}
    try {
      camera.follow(selected.agentId);
      if (!camera.recentre()) {setMessage(wt('cameraUnavailable'));return;}
      setMessage(wt('cameraCentred',{name:selectedName}));
      proxy.current?.focus({preventScroll:true});
    } catch {setMessage(wt('cameraUnavailable'));onError?.('camera');}
  };
  const open=(kind:'map'|'signs',fn:()=>void)=> {
    try {fn();} catch {setMessage(wt('unavailable'));onError?.(kind);}
  };
  return <nav class="world-navigation ui-interactive" aria-label={wt('navigation')}>
    {selected?<button ref={proxy} type="button" class="world-control world-actor-proxy" data-world-actor={selected.agentId} aria-label={wt('selected',{name:selectedName})} onClick={recentre}>{selectedName}</button>:<p>{wt('select')}</p>}
    <div class="world-navigation__actions">
      <button type="button" class="world-control" onClick={recentre} disabled={!selected} aria-keyshortcuts="F">{wt('recentre')}</button>
      <button type="button" class="world-control" onClick={()=>open('map',onOpenMap)}>{wt('map')}</button>
      <button type="button" class="world-control" onClick={()=>open('signs',onOpenSigns)}>{wt('signs')}</button>
    </div>
    <p class="world-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</p>
  </nav>;
}

export interface WorldPlacesProps {
  pins: readonly MapPinView[];
  selectedAgentId: string|null;
  /** S13 resolves the pin to a region-local route target; UI does not infer ownership or geometry. */
  onWalk:(regionId:string,actorId:string)=>WorldRouteResult|Promise<WorldRouteResult>;
  onError?:()=>void;
}

/** Accessible list companion for S13's overview map. The map, route dispatch and permissions remain controller-owned. */
export function WorldPlaces({pins,selectedAgentId,onWalk,onError}:WorldPlacesProps) {
  const data=preparePins(pins);
  const [message,setMessage]=useState('');
  const [pending,setPending]=useState<string|null>(null);
  const actor=useRef(selectedAgentId);actor.current=selectedAgentId;
  const generation=useRef(0),busy=useRef(false),alive=useRef(true);
  useLayoutEffect(()=>{alive.current=true;return ()=>{alive.current=false;generation.current++;};},[]);
  useLayoutEffect(()=>{generation.current++;busy.current=false;setPending(null);setMessage('');},[selectedAgentId]);
  const walk=async(pin:MapPinView)=> {
    if (!selectedAgentId) {setMessage(wt('select'));return;}
    if (busy.current) return;
    const id=++generation.current,who=selectedAgentId;
    busy.current=true;setPending(pin.regionId);setMessage(wt('pending'));
    try {
      const result=await onWalk(pin.regionId,who);
      if (alive.current && id===generation.current && actor.current===who) setMessage(routeFeedback(result,pin.regionId,pin.label).message);
    } catch {
      if (alive.current && id===generation.current && actor.current===who) {setMessage(wt('unavailable'));onError?.();}
    } finally {
      if (alive.current && id===generation.current) {busy.current=false;setPending(null);}
    }
  };
  return <section class="world-places ui-interactive" aria-label={wt('places')}>
    {data.invalidCount>0?<p role="alert">{wt('invalid')}</p>:null}
    {data.items.length===0?<p>{wt('noPlaces')}</p>:<ul class="world-places__list">{data.items.map(pin=><li key={pin.regionId} class={`world-place world-place--${pin.status}`} data-world-region={pin.regionId}>
      <div class="world-place__copy"><strong>{pin.label}</strong><span class="world-place__status"><span aria-hidden="true">{pin.status==='unfinished'?'▧':pin.status==='locked'?'▣':pin.status==='closed'?'⊘':'◇'}</span> {pin.statusText}</span></div>
      <button type="button" class="world-control" aria-label={wt('walkName',{place:pin.label})} disabled={!selectedAgentId||pending!==null} aria-busy={pending===pin.regionId?'true':undefined} onClick={()=>void walk(pin)}>{wt('walk')}</button>
    </li>)}</ul>}
    {!selectedAgentId?<p>{wt('select')}</p>:null}
    <p class="world-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</p>
  </section>;
}

export function WorldSignsDialog({signs,origin,onClose}:{signs:readonly SignView[];origin:WorldPoint|null;onClose:()=>void}) {
  const data=prepareSigns(signs,origin);
  return <Modal title={wt('signs')} onClose={onClose} class="world-signs-dialog" footer={<button type="button" class="world-control" onClick={onClose}>{wt('close')}</button>}>
    <div class="world-signs">
      {data.invalidCount>0?<p role="alert">{wt('invalid')}</p>:null}
      {data.items.length===0?<p>{wt('noSigns')}</p>:<ol>{data.items.map(sign=><li key={sign.id} data-world-sign={sign.id}>{sign.text}</li>)}</ol>}
    </div>
  </Modal>;
}
