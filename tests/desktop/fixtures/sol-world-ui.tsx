/** Test-only ports: exercise real components/Modal/theme. This is not a simulated product world. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { applyThemeSettings, watchBrowserZoom } from '../../../src/ui/theme';
import { Modal } from '../../../src/ui/common/Modal';
import { WorldNavigationControls, WorldPlaces, WorldSignsDialog } from '../../../src/ui/world';
import type { MapPinView, SelectedActorView, SignView, WorldRouteResult } from '../../../src/shared/world';

const pins:MapPinView[]=['open','closed','locked','unfinished'].map((status,i)=>({
  regionId:`region-${status}`,label:i===0?'Old Graveyard':i===1?'Neighbour’s home':i===2?'Mausoleum Hills':'Swampside Bayou',
  status:status as MapPinView['status'],statusText:['Open','Closed — invitation required','Locked — earn access','Under construction'][i],
  world:{x:-i*100,z:0},memberIds:[],
}));
const signs:SignView[]=[{id:'far',regionId:'home',textKey:'far',text:'Bayou — under construction',world:{x:100,z:0}},
  {id:'near',regionId:'home',textKey:'near',text:'<img src=x onerror=alert(1)> Graveyard — public footpath',world:{x:-1,z:0}}];
const receipt={calls:[] as {regionId:string;actorId:string}[],camera:0,followed:'previous' as string|null,centredActor:null as string|null,errors:[] as string[],mode:'normal',cameraMode:'normal',ready:false};
applyThemeSettings({uiScale:1,reduceMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,colorblindNeeds:false,quality:'low'});
watchBrowserZoom();
let reply:((value:WorldRouteResult)=>void)|null=null;
let control:{select:(id:string|null)=>void;token:()=>void;unmount:()=>void;malformed:()=>void};
Object.assign(window,{solWorldFixture:{receipt,select:(id:string|null)=>control.select(id),token:()=>control.token(),
  unmount:()=>control.unmount(),malformed:()=>control.malformed(),resolve:()=>reply?.({ok:true,target:{regionId:receipt.calls[0].regionId,x:1,z:1},portals:[],lengthTiles:2,etaGameMin:3})}});
function App(){
  const [id,select]=useState<string|null>('a'),[dialog,setDialog]=useState<'map'|'signs'|null>(null),[token,bump]=useState(0),[mounted,setMounted]=useState(true),[bad,setBad]=useState(false);
  control={select,token:()=>bump(n=>n+1),unmount:()=>setMounted(false),malformed:()=>setBad(true)};
  const selected:SelectedActorView|null=id?{agentId:id,regionId:'home',world:{x:0,z:0},local:{x:1,z:1},renderTier:'active'}:null;
  const walk=(regionId:string,actorId:string):WorldRouteResult|Promise<WorldRouteResult>=>{
    receipt.calls.push({regionId,actorId});
    if(receipt.mode==='throw')throw Error('fixture route failure');
    if(receipt.mode==='defer')return new Promise(resolve=>{reply=resolve;});
    const target={regionId,x:1,z:1};
    if(regionId==='region-open')return {ok:true,target,portals:[],lengthTiles:12,etaGameMin:2};
    return {ok:false,target,reason:regionId==='region-closed'?'private':regionId==='region-locked'?'locked':'unfinished'};
  };
  receipt.ready=true;
  return <div class="ui-root" style="padding:16px;overflow:auto">
    <WorldNavigationControls selected={selected} selectedName={id==='b'?'Mina':'Frank'} restoreFocusToken={token}
      camera={{recentre:()=>{receipt.camera++;if(receipt.cameraMode==='throw')throw Error('fixture camera failure');receipt.centredActor=receipt.followed??id;return receipt.cameraMode!=='false';},follow:actorId=>{receipt.followed=actorId;},following:()=>receipt.followed}}
      onOpenMap={()=>setDialog('map')} onOpenSigns={()=>setDialog('signs')} onError={kind=>receipt.errors.push(kind)}/>
    <label class="ui-interactive" style="display:block;font-size:16px;margin:16px;color:white">Rename zombie <input aria-label="Rename zombie" /></label>
    {dialog==='map'?<Modal title="World map" class="world-signs-dialog" onClose={()=>setDialog(null)}>{mounted?<WorldPlaces pins={bad?[...pins,pins[0]]:pins} selectedAgentId={id} onWalk={walk} onError={()=>receipt.errors.push('route')}/>:<p>Fixture unmounted</p>}</Modal>:null}
    {dialog==='signs'?<WorldSignsDialog signs={signs} origin={{x:0,z:0}} onClose={()=>setDialog(null)}/>:null}
  </div>;
}
render(<App/>,document.querySelector('#fixture')!);
